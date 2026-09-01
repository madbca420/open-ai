/**
 * JARVIS Phase 4 — Feature Flags Engine
 *
 * Centralized feature flag manager for JARVIS adapters and internal workflow modules.
 *
 * ARCHITECTURAL & SECURITY RULES:
 *  - Booleans only! Stores NO API keys, tokens, passwords, or credentials.
 *  - Default-safe: unknown external flags default to false.
 *  - Persistence-resilient: gracefully degrades to in-memory state if `adapter_config` table
 *    does not exist yet (Step 5 migration). Automatically uses SQLite when table exists.
 *  - EventBus integration: emits `adapter.feature_flag.changed` with category `ADAPTER`.
 *  - Isolated: renderer can only access via safe IPC (future step).
 */

import { eventBus } from '../../eventBus';
import { getDatabase } from '../../db';

export interface FeatureFlagDefinition {
  key: string;
  defaultValue: boolean;
  description: string;
  adapterId?: string;
  requiresConfirmation?: boolean;
}

/**
 * All Phase 4 feature flag definitions and their default states.
 */
export const FEATURE_FLAG_DEFINITIONS: Record<string, FeatureFlagDefinition> = {
  COMFYUI_ENABLED: {
    key: 'COMFYUI_ENABLED',
    defaultValue: false,
    description: 'Enable ComfyUI visual AI generation adapter',
    adapterId: 'comfyui',
  },
  IOPAINT_ENABLED: {
    key: 'IOPAINT_ENABLED',
    defaultValue: false,
    description: 'Enable IOPaint image inpainting and editing adapter',
    adapterId: 'iopaint',
    requiresConfirmation: true,
  },
  OMNIVOICE_ENABLED: {
    key: 'OMNIVOICE_ENABLED',
    defaultValue: false,
    description: 'Enable OmniVoice TTS and voice design adapter',
    adapterId: 'omnivoice',
    requiresConfirmation: true,
  },
  HANDY_ENABLED: {
    key: 'HANDY_ENABLED',
    defaultValue: false,
    description: 'Enable Handy offline STT bridge adapter',
    adapterId: 'handy',
  },
  TRADING_ENABLED: {
    key: 'TRADING_ENABLED',
    defaultValue: false,
    description: 'Enable TradingAgents financial analysis adapter (Paper Trading only)',
    adapterId: 'tradingagents',
    requiresConfirmation: true,
  },
  HEYGEM_ENABLED: {
    key: 'HEYGEM_ENABLED',
    defaultValue: false,
    description: 'Enable HeyGem digital human avatar presentation adapter',
    adapterId: 'heygem',
  },
  MIROFISH_ENABLED: {
    key: 'MIROFISH_ENABLED',
    defaultValue: false,
    description: 'Enable MiroFish multi-agent simulation adapter',
    adapterId: 'mirofish',
  },
  CAPCUT_ENABLED: {
    key: 'CAPCUT_ENABLED',
    defaultValue: false,
    description: 'Enable CapCut-CLI draft inspect & lint adapter (capcut lint)',
    adapterId: 'capcut',
  },
  VOICE_STUDIO_ENABLED: {
    key: 'VOICE_STUDIO_ENABLED',
    defaultValue: false,
    description: 'Enable VoiceStudio local voice editing bridge adapter',
    adapterId: 'voicestudio',
  },
  DRAMACLAW_ENABLED: {
    key: 'DRAMACLAW_ENABLED',
    defaultValue: false,
    description: 'Enable DramaClaw creative video pipeline adapter',
    adapterId: 'dramaclaw',
  },
  PROMPT_INJECTION_TESTS_ENABLED: {
    key: 'PROMPT_INJECTION_TESTS_ENABLED',
    defaultValue: true,
    description: 'Enable offline security prompt injection test suite',
  },
  OPEN_GENERATIVE_AI_ENABLED: {
    key: 'OPEN_GENERATIVE_AI_ENABLED',
    defaultValue: false,
    description: 'Enable Open-Generative-AI multi-model media studio adapter',
    adapterId: 'open-generative-ai',
  },
  GSD_WORKFLOW_ENABLED: {
    key: 'GSD_WORKFLOW_ENABLED',
    defaultValue: true,
    description: 'Enable GSD spec-driven development methodology (Discuss -> Plan -> Ship)',
  },
  RALPH_WORKFLOW_ENABLED: {
    key: 'RALPH_WORKFLOW_ENABLED',
    defaultValue: true,
    description: 'Enable Ralph iterative autonomous execution loop (gated by user confirmation)',
    requiresConfirmation: true,
  },
  MOCK_ADAPTERS_ENABLED: {
    key: 'MOCK_ADAPTERS_ENABLED',
    defaultValue: true,
    description: 'Enable deterministic mock adapters for offline system pipeline testing',
  },
};

/**
 * Mapping from adapter ID to its controlling feature flag key.
 */
export const ADAPTER_TO_FLAG_MAP: Record<string, string> = {
  comfyui: 'COMFYUI_ENABLED',
  iopaint: 'IOPAINT_ENABLED',
  omnivoice: 'OMNIVOICE_ENABLED',
  handy: 'HANDY_ENABLED',
  tradingagents: 'TRADING_ENABLED',
  heygem: 'HEYGEM_ENABLED',
  mirofish: 'MIROFISH_ENABLED',
  capcut: 'CAPCUT_ENABLED',
  voicestudio: 'VOICE_STUDIO_ENABLED',
  dramaclaw: 'DRAMACLAW_ENABLED',
  'open-generative-ai': 'OPEN_GENERATIVE_AI_ENABLED',
  'mock-creative': 'MOCK_ADAPTERS_ENABLED',
  'mock-voice': 'MOCK_ADAPTERS_ENABLED',
  'mock-trading': 'MOCK_ADAPTERS_ENABLED',
  'mock-research': 'MOCK_ADAPTERS_ENABLED',
};

class FeatureFlagsManager {
  private inMemoryFlags: Map<string, boolean> = new Map();

  constructor() {
    // Initialize in-memory cache with default values
    for (const [key, def] of Object.entries(FEATURE_FLAG_DEFINITIONS)) {
      this.inMemoryFlags.set(key, def.defaultValue);
    }
  }

  /**
   * Check if the `adapter_config` table exists in SQLite DB.
   * Safe check that prevents crashes before Step 5 DB migration.
   */
  private isTableAvailable(): boolean {
    try {
      const db = getDatabase();
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='adapter_config'")
        .get();
      return !!row;
    } catch {
      return false;
    }
  }

  /**
   * Get the boolean state of a feature flag.
   * Order of evaluation:
   * 1. Try SQLite `adapter_config` table if available.
   * 2. Fall back to in-memory cache.
   * 3. Fall back to defined default value.
   * 4. Unknown flags default to false.
   */
  public get(key: string): boolean {
    const def = FEATURE_FLAG_DEFINITIONS[key];
    const defaultVal = def ? def.defaultValue : false;

    if (this.isTableAvailable()) {
      try {
        const db = getDatabase();
        const row = db
          .prepare("SELECT value FROM adapter_config WHERE adapter_id = 'SYSTEM' AND key = ?")
          .get(key) as { value: string } | undefined;

        if (row && row.value !== undefined) {
          return row.value === 'true' || row.value === '1';
        }
      } catch (err) {
        console.warn(`[FeatureFlags] Error reading flag '${key}' from DB, falling back to memory/default:`, err);
      }
    }

    return this.inMemoryFlags.get(key) ?? defaultVal;
  }

  /**
   * Convenience alias for get(key).
   */
  public isEnabled(key: string): boolean {
    return this.get(key);
  }

  /**
   * Set the boolean state of a feature flag.
   * Updates in-memory state, attempts SQLite persistence if table exists,
   * and emits an `adapter.feature_flag.changed` EventBus event.
   */
  public set(key: string, value: boolean): void {
    const previous = this.get(key);
    const boolValue = Boolean(value);

    // Update in-memory state
    this.inMemoryFlags.set(key, boolValue);

    // Attempt SQLite persistence if table is ready (Step 5+)
    if (this.isTableAvailable()) {
      try {
        const db = getDatabase();
        db.prepare(`
          INSERT INTO adapter_config (adapter_id, key, value, updated_at)
          VALUES ('SYSTEM', ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(adapter_id, key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        `).run(key, boolValue ? 'true' : 'false');
      } catch (err) {
        console.warn(`[FeatureFlags] Could not persist flag '${key}' to SQLite (table unavailable or error):`, err);
      }
    }

    // Emit EventBus event if state changed
    if (previous !== boolValue) {
      const def = FEATURE_FLAG_DEFINITIONS[key];
      eventBus.emit(
        eventBus.createEvent({
          type: 'adapter.feature_flag.changed',
          category: 'ADAPTER',
          source: 'FeatureFlagsManager',
          payload: {
            flag: key,
            adapterId: def?.adapterId || null,
            enabled: boolValue,
          },
        })
      );
    }
  }

  /**
   * Return dictionary of all registered feature flags and their current boolean values.
   */
  public getAll(): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    for (const key of Object.keys(FEATURE_FLAG_DEFINITIONS)) {
      result[key] = this.get(key);
    }
    return result;
  }

  /**
   * Return metadata definition for a feature flag.
   */
  public getDefinition(key: string): FeatureFlagDefinition | undefined {
    return FEATURE_FLAG_DEFINITIONS[key];
  }

  /**
   * Reset a feature flag to its declared default value.
   */
  public reset(key: string): void {
    const def = FEATURE_FLAG_DEFINITIONS[key];
    if (def) {
      this.set(key, def.defaultValue);
    }
  }

  /**
   * Reset all feature flags to their declared default values.
   */
  public resetAll(): void {
    for (const key of Object.keys(FEATURE_FLAG_DEFINITIONS)) {
      this.reset(key);
    }
  }

  /**
   * Check if a specific adapter is enabled by its adapter ID.
   */
  public isAdapterEnabled(adapterId: string): boolean {
    const flagKey = ADAPTER_TO_FLAG_MAP[adapterId];
    if (!flagKey) {
      // Unknown external adapter -> default safe false
      return false;
    }
    return this.isEnabled(flagKey);
  }

  /**
   * Set feature flag state for an adapter by its adapter ID.
   */
  public setAdapterEnabled(adapterId: string, enabled: boolean): void {
    const flagKey = ADAPTER_TO_FLAG_MAP[adapterId];
    if (flagKey) {
      this.set(flagKey, enabled);
    } else {
      console.warn(`[FeatureFlags] No feature flag mapped for adapterId '${adapterId}'`);
    }
  }
}

export const featureFlags = new FeatureFlagsManager();
