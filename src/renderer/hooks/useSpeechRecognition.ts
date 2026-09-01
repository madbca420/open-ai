/**
 * useSpeechRecognition.ts
 *
 * Web Speech API hook for the renderer.
 * Implements push-to-talk (PTT) mode:
 *   - Call startListening() to begin recognition
 *   - Call stopListening() to commit the transcript
 * Handles permission-denied and no-mic states gracefully.
 *
 * State machine:
 *   IDLE → LISTENING (startListening) → IDLE (transcript returned via onResult)
 *   IDLE → ERROR (permission denied / no mic / API unavailable)
 *
 * Fixes:
 *   - Uses statusRef to avoid stale closure in onend/onerror handlers
 *   - Removed `status` from startListening useCallback deps (was causing stale captures)
 *   - Idempotent start/stop (safe to call multiple times)
 *   - 8-second recognition timeout to prevent stuck LISTENING state
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export type SpeechStatus = 'idle' | 'listening' | 'error';
export type MicError = 'not-supported' | 'permission-denied' | 'no-mic' | 'aborted' | 'network';

export interface UseSpeechRecognitionOptions {
  onResult: (transcript: string) => void;
  onError?: (err: MicError) => void;
  lang?: string;
  continuous?: boolean;
}

export interface UseSpeechRecognitionReturn {
  status: SpeechStatus;
  micError: MicError | null;
  isSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
}

const SpeechRecognitionAPI =
  typeof window !== 'undefined'
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

export function useSpeechRecognition({
  onResult,
  onError,
  lang = 'en-US',
  continuous = false,
}: UseSpeechRecognitionOptions): UseSpeechRecognitionReturn {
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const [micError, setMicError] = useState<MicError | null>(null);
  const recognitionRef = useRef<any>(null);
  const committedRef = useRef(false);
  // Use ref to track status inside event handlers without stale closure issues
  const statusRef = useRef<SpeechStatus>('idle');
  // Timeout to auto-stop recognition if stuck in LISTENING > 8 seconds
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSupported = !!SpeechRecognitionAPI;

  // Keep statusRef in sync with actual status state
  const updateStatus = useCallback((s: SpeechStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const clearRecognitionTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const stopListening = useCallback(() => {
    clearRecognitionTimeout();
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    // Status moves to idle via onend handler
  }, [clearRecognitionTimeout]);

  const startListening = useCallback(() => {
    if (!isSupported) {
      const err: MicError = 'not-supported';
      setMicError(err);
      updateStatus('error');
      onError?.(err);
      return;
    }

    // Stop any existing session before starting a new one (idempotent)
    clearRecognitionTimeout();
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }

    setMicError(null);
    committedRef.current = false;

    const rec = new SpeechRecognitionAPI();
    rec.lang = lang;
    rec.continuous = continuous;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      console.log('[STT] Recognition started');
      updateStatus('listening');
      // Auto-stop after 8 seconds if no result (prevents stuck LISTENING)
      timeoutRef.current = setTimeout(() => {
        console.warn('[STT] Recognition timeout — auto-stopping');
        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch { /* ignore */ }
        }
      }, 8000);
    };

    rec.onresult = (event: any) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript.trim()) {
        console.log('[STT] Final transcript:', finalTranscript.trim());
        committedRef.current = true;
        clearRecognitionTimeout();
        onResult(finalTranscript.trim());
      }
    };

    rec.onerror = (event: any) => {
      clearRecognitionTimeout();
      console.warn('[STT] Recognition error:', event.error);
      let err: MicError = 'aborted';

      if (event.error === 'not-allowed' || event.error === 'permission-denied') {
        err = 'permission-denied';
      } else if (event.error === 'audio-capture') {
        err = 'no-mic';
      } else if (event.error === 'network') {
        err = 'network';
      } else if (event.error === 'aborted' || event.error === 'no-speech') {
        // User stopped PTT before speaking — not a hard error
        updateStatus('idle');
        recognitionRef.current = null;
        return;
      }

      // Hard errors — surface to user
      if (err === 'permission-denied' || err === 'no-mic' || err === 'network') {
        setMicError(err);
        updateStatus('error');
        onError?.(err);
      } else {
        updateStatus('idle');
      }
      recognitionRef.current = null;
    };

    rec.onend = () => {
      clearRecognitionTimeout();
      console.log('[STT] Recognition ended, committed:', committedRef.current, 'status:', statusRef.current);
      recognitionRef.current = null;
      // Only reset to idle if not already in error state
      if (statusRef.current !== 'error') {
        updateStatus('idle');
      }
    };

    recognitionRef.current = rec;

    try {
      rec.start();
    } catch (e) {
      console.error('[STT] start() threw:', e);
      clearRecognitionTimeout();
      setMicError('no-mic');
      updateStatus('error');
      onError?.('no-mic');
      recognitionRef.current = null;
    }
  }, [isSupported, lang, continuous, onResult, onError, updateStatus, clearRecognitionTimeout]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearRecognitionTimeout();
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch { /* ignore */ }
        recognitionRef.current = null;
      }
    };
  }, [clearRecognitionTimeout]);

  return { status, micError, isSupported, startListening, stopListening };
}
