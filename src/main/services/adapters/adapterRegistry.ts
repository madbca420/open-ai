/**
 * JARVIS Phase 4 — Adapter Registry
 *
 * The central in-process registry for all JARVIS external adapters.
 *
 * ARCHITECTURAL RULES:
 *  - This is NOT an orchestrator. It does NOT create missions, tasks, graphs,
 *    assign agents, or schedule work.
 *  - All execution enters through TaskExecutor → AdapterRegistry → JarvisAdapter.
 *  - The renderer NEVER receives raw JarvisAdapter instances.
 *    Only serialisable AdapterInfo objects are returned from getInfo/getAllInfo.
 *  - No credentials, tokens, process handles, or sockets are exposed.
 *  - All lifecycle events use the EXISTING EventBus — no second event system.
 *
 * Correct dependency direction:
 *   schema types → EventBus → AdapterRegistry → Concrete Adapters
 */

import { eventBus } from '../../eventBus';
import {
  AdapterCategory,
  AdapterInfo,
  AdapterInput,
  AdapterOutput,
} from '../../types/schema';
import { JarvisAdapter } from './adapterTypes';

// ─────────────────────────────────────────────────────────────────────────────
// Registry Error Types
// ─────────────────────────────────────────────────────────────────────────────

export class AdapterNotFoundError extends Error {
  constructor(adapterId: string) {
    super(`Adapter not found: ${adapterId}`);
    this.name = 'AdapterNotFoundError';
  }
}

export class AdapterAlreadyRegisteredError extends Error {
  constructor(adapterId: string) {
    super(`Adapter already registered: ${adapterId}`);
    this.name = 'AdapterAlreadyRegisteredError';
  }
}

export class AdapterUnavailableError extends Error {
  constructor(adapterId: string, status: string) {
    super(`Adapter unavailable: ${adapterId} (status: ${status})`);
    this.name = 'AdapterUnavailableError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Statuses that allow execution
// ─────────────────────────────────────────────────────────────────────────────

const EXECUTABLE_STATUSES = new Set<string>(['READY']);

// ─────────────────────────────────────────────────────────────────────────────
// Adapter Registry
// ─────────────────────────────────────────────────────────────────────────────

class AdapterRegistry {
  /** Primary registry: adapterId → JarvisAdapter runtime instance */
  private readonly adapters: Map<string, JarvisAdapter> = new Map();

  // ───────────────────────────────────────────────────────────────────────────
  // Registration
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Register a new adapter.
   *
   * Validates that the adapter exposes the minimum required contract.
   * Does NOT perform a health check (lightweight — no I/O on registration).
   * Emits 'adapter.registered' through the existing EventBus.
   *
   * @throws AdapterAlreadyRegisteredError if an adapter with the same id exists.
   */
  register(adapter: JarvisAdapter): void {
    this.validateContract(adapter);

    if (this.adapters.has(adapter.id)) {
      throw new AdapterAlreadyRegisteredError(adapter.id);
    }

    this.adapters.set(adapter.id, adapter);

    console.log(`[AdapterRegistry] Registered adapter: ${adapter.id} (${adapter.name} v${adapter.version})`);

    eventBus.emit(
      eventBus.createEvent({
        type: 'adapter.registered',
        category: 'ADAPTER',
        source: 'AdapterRegistry',
        payload: {
          adapterId: adapter.id,
          name: adapter.name,
          version: adapter.version,
          category: adapter.category,
          status: adapter.status,
        },
      })
    );
  }

  /**
   * Unregister an adapter by ID.
   *
   * Does NOT call adapter.shutdown() — the caller is responsible for
   * shutting down the adapter before unregistering if it is active.
   *
   * @returns true if the adapter was found and removed, false otherwise.
   */
  unregister(adapterId: string): boolean {
    const existed = this.adapters.delete(adapterId);

    if (existed) {
      console.log(`[AdapterRegistry] Unregistered adapter: ${adapterId}`);

      eventBus.emit(
        eventBus.createEvent({
          type: 'adapter.unregistered',
          category: 'ADAPTER',
          source: 'AdapterRegistry',
          payload: { adapterId },
        })
      );
    }

    return existed;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Retrieval
  // ───────────────────────────────────────────────────────────────────────────

  /** Return the runtime adapter instance (main-process only). */
  get(adapterId: string): JarvisAdapter | undefined {
    return this.adapters.get(adapterId);
  }

  /** Returns true if an adapter with the given ID is registered. */
  has(adapterId: string): boolean {
    return this.adapters.has(adapterId);
  }

  /** Return all runtime adapter instances (main-process only). */
  getAll(): JarvisAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Return a safe, serialisable AdapterInfo for the given adapter.
   * Safe to send over IPC to the renderer.
   */
  getInfo(adapterId: string): AdapterInfo | undefined {
    return this.adapters.get(adapterId)?.getInfo();
  }

  /**
   * Return all safe AdapterInfo objects.
   * Safe to send over IPC to the renderer.
   */
  getAllInfo(): AdapterInfo[] {
    return Array.from(this.adapters.values()).map((a) => a.getInfo());
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Discovery
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Return all adapters belonging to a given category.
   * Includes adapters in any status (disabled, unavailable, ready, etc.).
   */
  findByCategory(category: AdapterCategory): JarvisAdapter[] {
    return Array.from(this.adapters.values()).filter(
      (a) => a.category === category
    );
  }

  /**
   * Return all adapters that expose a given capability ID.
   * Includes adapters in any status.
   */
  findByCapability(capabilityId: string): JarvisAdapter[] {
    return Array.from(this.adapters.values()).filter((a) =>
      a.getCapabilities().some((cap) => cap.id === capabilityId)
    );
  }

  /**
   * Return all adapters that expose a given capability AND are currently
   * executable (status === READY).
   *
   * Use this to route execution — only READY adapters should receive tasks.
   */
  findAvailableByCapability(capabilityId: string): JarvisAdapter[] {
    return this.findByCapability(capabilityId).filter((a) =>
      EXECUTABLE_STATUSES.has(a.status)
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Execution
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Execute a capability on the specified adapter.
   *
   * Rules:
   *  - Locates adapter by ID; throws AdapterNotFoundError if missing.
   *  - Rejects if adapter is not in READY status (AdapterUnavailableError).
   *  - Delegates entirely to adapter.execute() — no adapter-specific logic here.
   *  - Emits adapter.execution.started before, and .completed/.failed after.
   *  - Returns AdapterOutput unchanged from the adapter.
   *  - On unexpected throw, wraps it into a failure AdapterOutput so the
   *    caller (TaskExecutor) receives a deterministic result contract.
   */
  async execute(adapterId: string, input: AdapterInput): Promise<AdapterOutput> {
    const adapter = this.adapters.get(adapterId);

    if (!adapter) {
      throw new AdapterNotFoundError(adapterId);
    }

    if (!EXECUTABLE_STATUSES.has(adapter.status)) {
      throw new AdapterUnavailableError(adapterId, adapter.status);
    }

    const startTime = Date.now();

    // Emit safe subset of input — never include full payload which may have secrets
    eventBus.emit(
      eventBus.createEvent({
        type: 'adapter.execution.started',
        category: 'ADAPTER',
        source: 'AdapterRegistry',
        missionId: input.missionId,
        taskId: input.taskId,
        payload: {
          adapterId,
          executionId: input.executionId,
          capability: input.capability,
        },
      })
    );

    try {
      const output = await adapter.execute(input);
      const duration_ms = Date.now() - startTime;

      eventBus.emit(
        eventBus.createEvent({
          type: output.success ? 'adapter.execution.completed' : 'adapter.execution.failed',
          category: 'ADAPTER',
          source: 'AdapterRegistry',
          missionId: input.missionId,
          taskId: input.taskId,
          payload: {
            adapterId,
            executionId: input.executionId,
            success: output.success,
            artifactIds: output.artifactIds,
            duration_ms,
            error: output.error,
          },
        })
      );

      return { ...output, duration_ms };
    } catch (err: any) {
      const errorMessage = err?.message ?? String(err);
      const duration_ms = Date.now() - startTime;

      console.error(`[AdapterRegistry] Adapter execution threw: ${adapterId} —`, errorMessage);

      eventBus.emit(
        eventBus.createEvent({
          type: 'adapter.execution.failed',
          category: 'ADAPTER',
          severity: 'ERROR',
          source: 'AdapterRegistry',
          missionId: input.missionId,
          taskId: input.taskId,
          payload: {
            adapterId,
            executionId: input.executionId,
            error: errorMessage,
            duration_ms,
          },
        })
      );

      // Return a deterministic failure output rather than propagating the throw,
      // so TaskExecutor receives a consistent AdapterOutput contract.
      return {
        success: false,
        executionId: input.executionId,
        adapterId,
        error: `Adapter execution failed: ${adapterId} — ${errorMessage}`,
        duration_ms,
      };
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Cancellation
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Cancel an in-progress execution on the specified adapter.
   *
   * Delegates to adapter.cancel(executionId) which is responsible for
   * propagating the cancellation to ProcessSupervisor.kill() if applicable.
   *
   * @throws AdapterNotFoundError if adapter is not registered.
   */
  async cancel(adapterId: string, executionId: string): Promise<void> {
    const adapter = this.adapters.get(adapterId);

    if (!adapter) {
      throw new AdapterNotFoundError(adapterId);
    }

    console.log(`[AdapterRegistry] Cancelling execution ${executionId} on adapter: ${adapterId}`);

    try {
      await adapter.cancel(executionId);

      eventBus.emit(
        eventBus.createEvent({
          type: 'adapter.execution.cancelled',
          category: 'ADAPTER',
          source: 'AdapterRegistry',
          payload: { adapterId, executionId },
        })
      );
    } catch (err: any) {
      console.error(`[AdapterRegistry] Cancel error for ${adapterId}:`, err?.message);
      // Do not rethrow — cancellation errors must not crash JARVIS
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Shutdown
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Shut down a single adapter by ID.
   * Delegates to adapter.shutdown() — the adapter owns its cleanup.
   *
   * @throws AdapterNotFoundError if adapter is not registered.
   */
  async shutdown(adapterId: string): Promise<void> {
    const adapter = this.adapters.get(adapterId);

    if (!adapter) {
      throw new AdapterNotFoundError(adapterId);
    }

    console.log(`[AdapterRegistry] Shutting down adapter: ${adapterId}`);

    try {
      await adapter.shutdown();

      eventBus.emit(
        eventBus.createEvent({
          type: 'adapter.shutdown',
          category: 'ADAPTER',
          source: 'AdapterRegistry',
          payload: { adapterId, status: adapter.status },
        })
      );
    } catch (err: any) {
      console.error(`[AdapterRegistry] Shutdown error for ${adapterId}:`, err?.message);
      // Record the error but do not rethrow
    }
  }

  /**
   * Shut down ALL registered adapters.
   *
   * Isolation guarantee: one adapter failing to shut down must NOT prevent
   * the remaining adapters from completing their shutdown sequence.
   *
   * All failures are collected and logged; none are rethrown.
   */
  async shutdownAll(): Promise<void> {
    const ids = Array.from(this.adapters.keys());
    console.log(`[AdapterRegistry] Shutting down all adapters (${ids.length} registered)...`);

    const failures: Array<{ id: string; error: string }> = [];

    await Promise.allSettled(
      ids.map(async (id) => {
        try {
          await this.shutdown(id);
        } catch (err: any) {
          const errorMessage = err?.message ?? String(err);
          failures.push({ id, error: errorMessage });
          console.error(`[AdapterRegistry] shutdownAll: error shutting down ${id}: ${errorMessage}`);
        }
      })
    );

    if (failures.length > 0) {
      console.error(
        `[AdapterRegistry] shutdownAll completed with ${failures.length} failure(s):`,
        failures
      );
    } else {
      console.log('[AdapterRegistry] All adapters shut down successfully.');
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internal Utilities
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Validate that an object satisfies the minimum JarvisAdapter contract.
   * Checks for required properties and callable methods.
   * Does NOT perform any I/O or healthCheck calls.
   *
   * @throws Error with a descriptive message if validation fails.
   */
  private validateContract(adapter: JarvisAdapter): void {
    const requiredStrings: Array<keyof JarvisAdapter> = ['id', 'name', 'version', 'category'];
    const requiredFunctions: Array<keyof JarvisAdapter> = [
      'healthCheck',
      'initialize',
      'execute',
      'cancel',
      'shutdown',
      'getCapabilities',
      'getInfo',
    ];

    for (const field of requiredStrings) {
      if (!adapter[field] || typeof adapter[field] !== 'string') {
        throw new Error(
          `[AdapterRegistry] Invalid adapter contract: '${field}' must be a non-empty string. Adapter: ${JSON.stringify(adapter.id)}`
        );
      }
    }

    for (const method of requiredFunctions) {
      if (typeof adapter[method] !== 'function') {
        throw new Error(
          `[AdapterRegistry] Invalid adapter contract: '${String(method)}' must be a function. Adapter: ${adapter.id}`
        );
      }
    }

    const capabilities = adapter.getCapabilities();
    if (!Array.isArray(capabilities)) {
      throw new Error(
        `[AdapterRegistry] Invalid adapter contract: getCapabilities() must return an array. Adapter: ${adapter.id}`
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Diagnostics (main-process safe)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Return a summary of all registered adapters for diagnostic logging.
   * Safe for console output — no secrets included.
   */
  getSummary(): Array<{ id: string; name: string; status: string; category: string; enabled: boolean }> {
    return Array.from(this.adapters.values()).map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      category: a.category,
      enabled: a.enabled,
    }));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The single AdapterRegistry instance for the JARVIS main process.
 *
 * Why singleton: consistent with existing JARVIS singletons (eventBus,
 * missionManager, taskGraphEngine, processSupervisor, commandRouter).
 * All Phase 4 adapters register here at JARVIS startup.
 */
export const adapterRegistry = new AdapterRegistry();
export { AdapterRegistry };
