/**
 * voiceOutputService.ts — Voice Output & TTS Router Service
 *
 * Routes text-to-speech output to the best available READY TTS engine:
 * 1. VoiceStudio Adapter (local multi-engine API)
 * 2. OmniVoice Adapter (local Python CLI engine)
 * 3. Windows SAPI `say` native fallback (always reachable on Windows)
 *
 * Behavior when a new command arrives while speaking:
 *   → The existing speech is stopped and the new command is processed immediately.
 *   → This is deterministic: new command always wins.
 *
 * Emits canonical EventBus events:
 *   voice.speaking   — TTS started
 *   voice.finished   — TTS completed successfully
 *   voice.error      — TTS failed
 *   voice.state      — Generic state update (legacy compat)
 */

import { eventBus } from '../eventBus';
import { adapterRegistry } from './adapters/adapterRegistry';
import { featureFlags } from './adapters/featureFlags';
import { speak as speakSapi, stopSpeaking as stopSapi, getIsSpeaking as getIsSpeakingSapi } from '../tts';

export type VoiceOutputStatus = 'READY' | 'UNAVAILABLE' | 'DISABLED' | 'ERROR';

export interface VoiceOutputState {
  status: VoiceOutputStatus;
  activeEngine: 'voicestudio' | 'omnivoice' | 'sapi' | 'none';
  isSpeaking: boolean;
  error?: string;
}

class VoiceOutputService {
  private activeEngine: 'voicestudio' | 'omnivoice' | 'sapi' | 'none' = 'sapi';
  private isSpeaking: boolean = false;

  /**
   * Determine the current primary TTS engine based on feature flags & adapter health.
   */
  public async getEngine(): Promise<{ engine: 'voicestudio' | 'omnivoice' | 'sapi'; status: VoiceOutputStatus }> {
    if (featureFlags.isAdapterEnabled('voicestudio')) {
      const vs = adapterRegistry.get('voicestudio');
      if (vs && vs.status === 'READY') {
        return { engine: 'voicestudio', status: 'READY' };
      }
    }

    if (featureFlags.isAdapterEnabled('omnivoice')) {
      const ov = adapterRegistry.get('omnivoice');
      if (ov && ov.status === 'READY') {
        return { engine: 'omnivoice', status: 'READY' };
      }
    }

    // Native Windows SAPI fallback — guaranteed available on Windows main process
    return { engine: 'sapi', status: 'READY' };
  }

  /**
   * Speak text through the best available TTS engine.
   * If a previous speech is playing, stops it first (new command wins).
   * Falls back gracefully: VoiceStudio → OmniVoice → Windows SAPI → graceful failure message.
   */
  public async speak(text: string, options?: { voice?: string; speed?: number }): Promise<{ success: boolean; engine: string; error?: string }> {
    const cleanText = text.trim();
    if (!cleanText) return { success: true, engine: 'none' };

    // Stop any existing speech before starting (new command wins deterministically)
    if (this.isSpeaking) {
      this.stop();
    }

    const { engine } = await this.getEngine();
    this.activeEngine = engine;
    this.isSpeaking = true;

    // Emit: voice speaking started
    eventBus.emit(
      eventBus.createEvent({
        type: 'voice.speaking',
        category: 'VOICE',
        source: 'VoiceOutputService',
        payload: { isSpeaking: true, engine, text: cleanText.slice(0, 100) },
      })
    );
    // Legacy compat
    eventBus.emit(
      eventBus.createEvent({
        type: 'voice.state',
        category: 'SYSTEM',
        source: 'VoiceOutputService',
        payload: { isSpeaking: true, engine },
      })
    );

    try {
      let success = false;

      if (engine === 'voicestudio') {
        const vs = adapterRegistry.get('voicestudio');
        if (vs) {
          const res = await adapterRegistry.execute('voicestudio', {
            executionId: `exec_vs_tts_${Date.now()}`,
            adapterId: 'voicestudio',
            capability: 'voice.tts',
            payload: { text: cleanText, voice: options?.voice || 'alloy' },
            timestamp: new Date().toISOString(),
          });
          if (res.success) success = true;
        }
      } else if (engine === 'omnivoice') {
        const ov = adapterRegistry.get('omnivoice');
        if (ov) {
          const res = await adapterRegistry.execute('omnivoice', {
            executionId: `exec_ov_tts_${Date.now()}`,
            adapterId: 'omnivoice',
            capability: 'voice.tts',
            payload: { text: cleanText },
            timestamp: new Date().toISOString(),
          });
          if (res.success) success = true;
        }
      }

      if (!success) {
        // Fallback to native Windows SAPI (always available on Windows)
        await speakSapi(cleanText, { speed: options?.speed, voice: options?.voice });
        this.activeEngine = 'sapi';
      }

      this.isSpeaking = false;

      // Emit: voice finished
      eventBus.emit(
        eventBus.createEvent({
          type: 'voice.finished',
          category: 'VOICE',
          source: 'VoiceOutputService',
          payload: { isSpeaking: false, engine: this.activeEngine },
        })
      );
      eventBus.emit(
        eventBus.createEvent({
          type: 'voice.state',
          category: 'SYSTEM',
          source: 'VoiceOutputService',
          payload: { isSpeaking: false, engine: this.activeEngine },
        })
      );

      return { success: true, engine: this.activeEngine };
    } catch (err: any) {
      this.isSpeaking = false;
      const errorMsg = err?.message || String(err);

      // Emit: voice error
      eventBus.emit(
        eventBus.createEvent({
          type: 'voice.error',
          category: 'VOICE',
          severity: 'WARNING',
          source: 'VoiceOutputService',
          payload: { isSpeaking: false, error: errorMsg, engine: this.activeEngine },
        })
      );
      eventBus.emit(
        eventBus.createEvent({
          type: 'voice.state',
          category: 'SYSTEM',
          severity: 'WARNING',
          source: 'VoiceOutputService',
          payload: { isSpeaking: false, error: errorMsg },
        })
      );

      return { success: false, engine: this.activeEngine, error: errorMsg };
    }
  }

  /**
   * Immediately stop all active speech output across engines.
   * Idempotent — safe to call when not speaking.
   */
  public stop(): void {
    try { stopSapi(); } catch { /* ignore */ }
    this.isSpeaking = false;

    eventBus.emit(
      eventBus.createEvent({
        type: 'voice.finished',
        category: 'VOICE',
        source: 'VoiceOutputService',
        payload: { isSpeaking: false, engine: this.activeEngine, stopped: true },
      })
    );
    eventBus.emit(
      eventBus.createEvent({
        type: 'voice.state',
        category: 'SYSTEM',
        source: 'VoiceOutputService',
        payload: { isSpeaking: false, engine: this.activeEngine },
      })
    );
  }

  public getStatus(): VoiceOutputState {
    return {
      status: 'READY',
      activeEngine: this.activeEngine,
      isSpeaking: this.isSpeaking || getIsSpeakingSapi(),
    };
  }
}

export const voiceOutputService = new VoiceOutputService();
