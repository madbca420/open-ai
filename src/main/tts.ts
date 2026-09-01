/**
 * tts.ts — OS-native Text-to-Speech via `say` (Windows SAPI)
 *
 * Runs entirely in the main process (spawns OS TTS engine as child process).
 * Never blocks the text response from appearing — failures are logged and
 * surfaced to the renderer as { success: false, error: string }.
 *
 * State transitions emitted to renderer:
 *   tts:speaking-start → tts:speaking-end (or tts:speaking-error on failure)
 */

import say from 'say';

export interface TTSOptions {
  speed?: number; // 1.0 = normal, <1 = slower, >1 = faster
  voice?: string; // null = OS default voice
}

// Keep reference to cancel ongoing speech
let isSpeaking = false;

/**
 * Speaks text using the OS default TTS engine.
 * Returns a Promise that resolves when speech is done, or rejects on error.
 * If TTS is already speaking, the previous utterance is cancelled first.
 */
export function speak(text: string, opts: TTSOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isSpeaking) {
      try { say.stop(); } catch { /* ignore */ }
    }

    const speed = opts.speed ?? 1.0;
    const voice = opts.voice ?? undefined;

    isSpeaking = true;

    // say.speak(text, voice, speed, callback)
    say.speak(text, voice as any, speed, (err: any) => {
      isSpeaking = false;
      if (err) {
        reject(typeof err === 'string' ? new Error(err) : err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Immediately cancel any ongoing TTS utterance.
 */
export function stopSpeaking(): void {
  try {
    say.stop();
  } catch { /* ignore */ }
  isSpeaking = false;
}

export function getIsSpeaking(): boolean {
  return isSpeaking;
}
