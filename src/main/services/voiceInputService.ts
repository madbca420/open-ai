/**
 * voiceInputService.ts — Voice Input Service for Main Process & Renderer Bridge
 *
 * Provides a unified STT service abstraction across available adapters/engines
 * (Handy STT, Whisper, Web Speech API fallback).
 *
 * ARCHITECTURAL & SECURITY RULES:
 *  - JARVIS remains the sole orchestrator.
 *  - Sanitizes and validates status: READY, UNAVAILABLE, DISABLED, ERROR.
 *  - Never emits credentials or secrets in EventBus events.
 */

import { eventBus } from '../eventBus';
import { adapterRegistry } from './adapters/adapterRegistry';
import { featureFlags } from './adapters/featureFlags';

export type VoiceInputStatus = 'READY' | 'UNAVAILABLE' | 'DISABLED' | 'ERROR';

export interface VoiceInputState {
  status: VoiceInputStatus;
  activeProvider: string;
  isListening: boolean;
  lastTranscript?: string;
  error?: string;
}

class VoiceInputService {
  private activeProvider: string = 'web-speech-api';
  private isListening: boolean = false;

  /**
   * Evaluates the current STT service status across adapters and configuration.
   */
  public async getStatus(): Promise<VoiceInputState> {
    const handyEnabled = featureFlags.isAdapterEnabled('handy');
    
    if (handyEnabled) {
      const handy = adapterRegistry.get('handy');
      if (handy && handy.status === 'READY') {
        this.activeProvider = 'handy';
        return {
          status: 'READY',
          activeProvider: 'handy',
          isListening: this.isListening,
        };
      } else if (handy) {
        return {
          status: 'UNAVAILABLE',
          activeProvider: 'handy',
          isListening: false,
          error: `Handy STT bridge status is ${handy.status}`,
        };
      }
    }

    // Default Web Speech API fallback (always available in Electron browser context when permission granted)
    this.activeProvider = 'web-speech-api';
    return {
      status: 'READY',
      activeProvider: 'web-speech-api',
      isListening: this.isListening,
    };
  }

  public setListeningState(listening: boolean): void {
    this.isListening = listening;
    eventBus.emit(
      eventBus.createEvent({
        type: 'voice.state',
        category: 'SYSTEM',
        source: 'VoiceInputService',
        payload: {
          isListening: listening,
          provider: this.activeProvider,
        },
      })
    );
  }

  public recordTranscript(transcript: string, source: 'voice' | 'push_to_talk' = 'voice'): void {
    eventBus.emit(
      eventBus.createEvent({
        type: 'voice.transcript',
        category: 'COMMAND',
        source: 'VoiceInputService',
        payload: {
          transcript,
          source,
        },
      })
    );
  }
}

export const voiceInputService = new VoiceInputService();
