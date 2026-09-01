/**
 * JARVIS Phase 4 — Adapter Health Engine
 *
 * Centralized health monitoring service for all registered JARVIS adapters.
 *
 * ARCHITECTURAL RULES:
 *  - REAL status only: NEVER fakes READY status. READY requires adapter.healthCheck() === true.
 *  - Integrates with AdapterRegistry and featureFlags.
 *  - EventBus integration: emits safe `category: 'ADAPTER'` events when health state changes.
 *  - In-memory cache for Step 4: Step 5 DB migration will add SQLite persistence.
 *  - Concurrency isolation: Promise.allSettled() prevents any single adapter failure from stopping monitor.
 *  - Error sanitization: strips credentials, tokens, API keys, and sensitive headers from error messages.
 */

import { eventBus } from '../../eventBus';
import { AdapterStatus } from '../../types/schema';
import { adapterRegistry } from './adapterRegistry';
import { featureFlags } from './featureFlags';

export interface AdapterHealthState {
  adapterId: string;
  healthy: boolean;
  status: AdapterStatus;
  latencyMs: number | null;
  lastCheckedAt: string | null;
  lastSuccessfulAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
}

export class AdapterHealthEngine {
  private healthCache: Map<string, AdapterHealthState> = new Map();
  private timer: NodeJS.Timeout | null = null;
  private monitoringIntervalMs: number = 30_000;

  constructor(intervalMs: number = 30_000) {
    this.monitoringIntervalMs = intervalMs;
  }

  /**
   * Sanitize error message to prevent accidental leakage of secrets, keys, or credentials.
   */
  private sanitizeError(rawError: any): string {
    if (!rawError) return 'Unknown error';
    let errStr = typeof rawError === 'string' ? rawError : rawError.message || String(rawError);

    // Strip common token/key/auth patterns
    errStr = errStr.replace(/(bearer\s+)[^\s"']+/gi, '$1[REDACTED]');
    errStr = errStr.replace(/(api[-_]?key=)[^\s&"']+/gi, '$1[REDACTED]');
    errStr = errStr.replace(/(secret=)[^\s&"']+/gi, '$1[REDACTED]');
    errStr = errStr.replace(/(password=)[^\s&"']+/gi, '$1[REDACTED]');

    return errStr.slice(0, 500); // Enforce reasonable string length bound
  }

  /**
   * Evaluate health for a single adapter by ID.
   * Does NOT crash if adapter is missing or healthCheck() throws.
   */
  public async checkAdapter(adapterId: string): Promise<AdapterHealthState | null> {
    const adapter = adapterRegistry.get(adapterId);
    if (!adapter) {
      this.healthCache.delete(adapterId);
      return null;
    }

    const previousState = this.healthCache.get(adapterId);
    const now = new Date().toISOString();
    const isEnabled = featureFlags.isAdapterEnabled(adapterId);

    // 1. If disabled via feature flags
    if (!isEnabled) {
      const newState: AdapterHealthState = {
        adapterId,
        healthy: false,
        status: 'DISABLED',
        latencyMs: null,
        lastCheckedAt: now,
        lastSuccessfulAt: previousState?.lastSuccessfulAt || null,
        consecutiveFailures: 0,
        lastError: null,
      };

      adapter.status = 'DISABLED';
      adapter.enabled = false;
      this.updateCacheAndEmit(previousState, newState);
      return newState;
    }

    // 2. Adapter is enabled -> perform real health check
    adapter.enabled = true;
    const startMs = Date.now();
    let healthy = false;
    let errorStr: string | null = null;

    try {
      healthy = await adapter.healthCheck();
    } catch (err: any) {
      healthy = false;
      errorStr = this.sanitizeError(err);
    }

    const latencyMs = Date.now() - startMs;
    const consecutiveFailures = healthy ? 0 : (previousState?.consecutiveFailures || 0) + 1;

    // Determine target status without overwriting active runtime states (BUSY / INITIALIZING / STOPPING)
    let newStatus: AdapterStatus = adapter.status;
    if (adapter.status !== 'BUSY' && adapter.status !== 'INITIALIZING' && adapter.status !== 'STOPPING') {
      if (healthy) {
        newStatus = 'READY';
      } else {
        newStatus = previousState && previousState.healthy ? 'ERROR' : 'UNAVAILABLE';
      }
      adapter.status = newStatus;
    }

    const newState: AdapterHealthState = {
      adapterId,
      healthy,
      status: newStatus,
      latencyMs,
      lastCheckedAt: now,
      lastSuccessfulAt: healthy ? now : previousState?.lastSuccessfulAt || null,
      consecutiveFailures,
      lastError: healthy ? null : errorStr || 'Health check returned false',
    };

    this.updateCacheAndEmit(previousState, newState);
    return newState;
  }

  /**
   * Check all currently registered adapters concurrently with isolation.
   */
  public async checkAll(): Promise<AdapterHealthState[]> {
    const adapters = adapterRegistry.getAll();
    const results = await Promise.allSettled(
      adapters.map((adapter) => this.checkAdapter(adapter.id))
    );

    const states: AdapterHealthState[] = [];
    for (const res of results) {
      if (res.status === 'fulfilled' && res.value !== null) {
        states.push(res.value);
      }
    }

    // Clean up stale cache entries for unregistered adapters
    const registeredIds = new Set(adapters.map((a) => a.id));
    for (const cachedId of this.healthCache.keys()) {
      if (!registeredIds.has(cachedId)) {
        this.healthCache.delete(cachedId);
      }
    }

    return states;
  }

  /**
   * Update cache and emit EventBus events when health state changes.
   */
  private updateCacheAndEmit(
    previous: AdapterHealthState | undefined,
    current: AdapterHealthState
  ): void {
    this.healthCache.set(current.adapterId, current);

    // Emit health check completed event
    eventBus.emit(
      eventBus.createEvent({
        type: 'adapter.health.check.completed',
        category: 'ADAPTER',
        source: 'AdapterHealthEngine',
        payload: {
          adapterId: current.adapterId,
          healthy: current.healthy,
          status: current.status,
          latencyMs: current.latencyMs,
          consecutiveFailures: current.consecutiveFailures,
        },
      })
    );

    // Emit health changed event ONLY when state or status actually changed
    const statusChanged = !previous || previous.status !== current.status;
    const healthChanged = !previous || previous.healthy !== current.healthy;

    if (statusChanged || healthChanged) {
      eventBus.emit(
        eventBus.createEvent({
          type: 'adapter.health.changed',
          category: 'ADAPTER',
          source: 'AdapterHealthEngine',
          payload: {
            adapterId: current.adapterId,
            previousStatus: previous?.status || 'UNKNOWN',
            currentStatus: current.status,
            healthy: current.healthy,
            consecutiveFailures: current.consecutiveFailures,
          },
        })
      );

      // Emit specific lifecycle state notification events
      if (current.status === 'READY') {
        eventBus.emit(
          eventBus.createEvent({
            type: 'adapter.ready',
            category: 'ADAPTER',
            source: 'AdapterHealthEngine',
            payload: { adapterId: current.adapterId, latencyMs: current.latencyMs },
          })
        );
      } else if (current.status === 'UNAVAILABLE') {
        eventBus.emit(
          eventBus.createEvent({
            type: 'adapter.unavailable',
            category: 'ADAPTER',
            source: 'AdapterHealthEngine',
            payload: { adapterId: current.adapterId, reason: current.lastError },
          })
        );
      } else if (current.status === 'ERROR') {
        eventBus.emit(
          eventBus.createEvent({
            type: 'adapter.error',
            category: 'ADAPTER',
            severity: 'ERROR',
            source: 'AdapterHealthEngine',
            payload: { adapterId: current.adapterId, error: current.lastError },
          })
        );
      }
    }
  }

  /**
   * Start periodic health monitoring.
   * Safe against duplicate calls — existing timer is cleared first.
   */
  public startMonitoring(intervalMs?: number): void {
    if (intervalMs && intervalMs > 0) {
      this.monitoringIntervalMs = intervalMs;
    }

    this.stopMonitoring();

    console.log(`[AdapterHealthEngine] Starting health monitoring (interval: ${this.monitoringIntervalMs}ms)...`);
    
    // Initial check
    this.checkAll().catch((err) =>
      console.error('[AdapterHealthEngine] Initial health check failed:', err)
    );

    this.timer = setInterval(() => {
      this.checkAll().catch((err) =>
        console.error('[AdapterHealthEngine] Periodic health check failed:', err)
      );
    }, this.monitoringIntervalMs);
  }

  /**
   * Stop periodic health monitoring safely.
   */
  public stopMonitoring(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[AdapterHealthEngine] Health monitoring stopped.');
    }
  }

  /**
   * Get cached health state for a single adapter by ID.
   */
  public getHealth(adapterId: string): AdapterHealthState | null {
    return this.healthCache.get(adapterId) || null;
  }

  /**
   * Get all cached health states.
   */
  public getAllHealth(): AdapterHealthState[] {
    return Array.from(this.healthCache.values());
  }

  /**
   * Returns true if adapter is registered, enabled, and healthy.
   */
  public isHealthy(adapterId: string): boolean {
    const state = this.healthCache.get(adapterId);
    return state ? state.healthy : false;
  }
}

export const adapterHealth = new AdapterHealthEngine();
