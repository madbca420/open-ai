/**
 * JARVIS Phase 4 — Universal Adapter Contract
 *
 * Every external service (ComfyUI, IOPaint, OmniVoice, TradingAgents, etc.)
 * MUST implement this interface. JARVIS remains the single orchestrator.
 *
 * Adapters are capabilities. They never replace:
 *   - CommandRouter
 *   - MissionManager
 *   - TaskGraphEngine
 *   - EventBus
 *   - ProcessSupervisor
 *   - KeyVault
 *   - SQLite
 *
 * Adapters are called only through:
 *   TaskExecutor → AdapterRegistry → JarvisAdapter
 */

import {
  AdapterStatus,
  AdapterCategory,
  AdapterCapability,
  AdapterInfo,
  AdapterInput,
  AdapterOutput,
} from '../../types/schema';

// Re-export canonical types for adapters to consume without deep imports
export type {
  AdapterStatus,
  AdapterCategory,
  AdapterCapability,
  AdapterInfo,
  AdapterInput,
  AdapterOutput,
};

// ─────────────────────────────────────────────────────────────────────────────
// Adapter Lifecycle Event (internal, for registry observability)
// ─────────────────────────────────────────────────────────────────────────────

export interface AdapterLifecycleEvent {
  adapterId: string;
  event:
    | 'initializing'
    | 'ready'
    | 'unavailable'
    | 'busy'
    | 'execution.started'
    | 'execution.progress'
    | 'execution.completed'
    | 'execution.failed'
    | 'cancelled'
    | 'error'
    | 'shutdown';
  executionId?: string;
  message?: string;
  payload?: Record<string, any>;
  timestamp: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Adapter Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every JARVIS external adapter must implement this interface.
 *
 * Lifecycle contract:
 *   DISABLED → initialize() → INITIALIZING → (healthCheck ok) → READY
 *   READY    → execute()   → BUSY          → READY (or ERROR)
 *   READY    → shutdown()  → STOPPING      → STOPPED
 *   *        → cancel()    → (if BUSY, abort current execution)
 */
export interface JarvisAdapter {
  /** Stable, unique adapter identifier (e.g. 'comfyui', 'iopaint', 'tradingagents') */
  readonly id: string;

  /** Human-readable display name */
  readonly name: string;

  /** SemVer string or 'unknown' */
  readonly version: string;

  /** Adapter category determines which workspace/command route resolves to it */
  readonly category: AdapterCategory;

  /** Current runtime status — MUST reflect real state, never faked for real adapters */
  status: AdapterStatus;

  /** Whether the feature flag for this adapter is enabled */
  enabled: boolean;

  /**
   * Perform a real dependency / connectivity check.
   * - For HTTP adapters: attempt GET to health endpoint.
   * - For process adapters: check binary existence.
   * - For mock adapters: always returns true.
   *
   * Must NOT throw — return false on any failure.
   */
  healthCheck(): Promise<boolean>;

  /**
   * Initialize the adapter. Called once after enable().
   * Must transition status: DISABLED → INITIALIZING → READY | UNAVAILABLE
   * Must NOT download models or install dependencies automatically.
   */
  initialize(): Promise<void>;

  /**
   * Execute a capability.
   * Must transition status: READY → BUSY → READY (or ERROR)
   * Must emit adapter EventBus events.
   * Must register produced artifacts in the Artifact Registry.
   */
  execute(input: AdapterInput): Promise<AdapterOutput>;

  /**
   * Cancel an in-progress execution.
   * Must propagate to ProcessSupervisor.kill() if a child process is running.
   * Must emit 'adapter.cancelled' event.
   */
  cancel(executionId: string): Promise<void>;

  /**
   * Gracefully shut down the adapter and release resources.
   * Must transition status: → STOPPING → STOPPED
   * Must kill any supervised processes.
   */
  shutdown(): Promise<void>;

  /**
   * Return the list of capabilities this adapter provides.
   * Used by AdapterRegistry.route() and the Settings UI.
   */
  getCapabilities(): AdapterCapability[];

  /**
   * Return a serialisable descriptor safe for the Settings UI / IPC.
   * MUST NOT include credentials, tokens, or raw process handles.
   */
  getInfo(): AdapterInfo;
}

// ─────────────────────────────────────────────────────────────────────────────
// Base Adapter — shared helpers for real adapter implementations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Abstract base class providing common adapter boilerplate.
 * All Phase 4 adapters should extend this.
 */
export abstract class BaseAdapter implements JarvisAdapter {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly category: AdapterCategory;

  status: AdapterStatus = 'DISABLED';
  enabled: boolean = false;

  abstract healthCheck(): Promise<boolean>;
  abstract initialize(): Promise<void>;
  abstract execute(input: AdapterInput): Promise<AdapterOutput>;
  abstract getCapabilities(): AdapterCapability[];

  async cancel(_executionId: string): Promise<void> {
    // Default: no-op. Override in adapters that manage child processes.
    console.warn(`[${this.id}] cancel() called but not implemented. Override in subclass.`);
  }

  async shutdown(): Promise<void> {
    this.status = 'STOPPING';
    // Subclasses should override to kill processes and release resources.
    this.status = 'STOPPED';
    console.log(`[${this.id}] Adapter shut down.`);
  }

  getInfo(): AdapterInfo {
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      category: this.category,
      status: this.status,
      enabled: this.enabled,
      capabilities: this.getCapabilities(),
      dependencies: this.getDependencies(),
      requiresGPU: this.requiresGPU(),
      requiresPython: this.requiresPython(),
      lastError: this.lastError,
      notes: this.notes,
    };
  }

  // Override these in concrete adapters
  protected getDependencies(): string[] { return []; }
  protected requiresGPU(): boolean { return false; }
  protected requiresPython(): boolean { return false; }
  protected lastError: string | undefined = undefined;
  protected notes: string | undefined = undefined;

  /** Convenience: generate a unique execution ID */
  protected newExecutionId(): string {
    return `exec_${this.id}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  }

  /** Convenience: create a timestamped AdapterOutput for errors */
  protected errorOutput(executionId: string, error: string): AdapterOutput {
    return {
      success: false,
      executionId,
      adapterId: this.id,
      error,
    };
  }
}
