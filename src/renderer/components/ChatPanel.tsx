import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Trash2, AlertTriangle, Bot, User, Loader2, Mic, Volume2, VolumeX } from 'lucide-react';
import { useAppStore, ChatMessage } from '../store';
import { useSpeechRecognition, MicError } from '../hooks/useSpeechRecognition';
import ConfirmationModal, { PendingToolCall } from './ConfirmationModal';
import { callBrowserAI } from '../browserApiConfig';

export default function ChatPanel() {
  const {
    messages, addMessage, appendToLastAssistantMessage, finalizeLastAssistantMessage,
    clearMessages, sessionId, activeProvider, activeModel, setStatus, status, ttsEnabled
  } = useAppStore();

  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [micNotice, setMicNotice] = useState<string | null>(null);
  const [ttsNotice, setTtsNotice] = useState<string | null>(null);
  const [pendingToolCall, setPendingToolCall] = useState<PendingToolCall | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastAssistantTextRef = useRef<string>('');
  const hasGreetedRef = useRef<boolean>(false);
  const stuckGuardRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Universal TTS Speaker Helper (Electron SAPI → Browser SpeechSynthesis) ──
  const speakText = useCallback((text: string): void => {
    const cleanSpeech = text.replace(/```[\s\S]*?```/g, '').replace(/[*_#~`]/g, '').trim();
    if (!cleanSpeech) return;

    setStatus('SPEAKING');

    if (window.electronAPI?.speak) {
      // Electron mode: use native Windows SAPI
      window.electronAPI.speak(cleanSpeech)
        .then(() => setStatus('IDLE'))
        .catch(() => setStatus('IDLE'));
    } else if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      // Browser mode: fire-and-forget (Chrome blocks autoplay before user gesture — that's fine)
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(cleanSpeech.slice(0, 300));
        utterance.rate = 1.0;
        utterance.onend = () => setStatus('IDLE');
        utterance.onerror = () => setStatus('IDLE');
        window.speechSynthesis.speak(utterance);
        // Fallback: if no onend fires within 8s, reset status
        setTimeout(() => setStatus('IDLE'), 8000);
      } catch {
        setStatus('IDLE');
      }
    } else {
      setStatus('IDLE');
    }
  }, [setStatus]);

  const startListeningRef = useRef<(() => void) | null>(null);

  // ── Startup JARVIS greeting — always shows in chat, speaks when audio permitted ──
  useEffect(() => {
    if (hasGreetedRef.current) return;
    hasGreetedRef.current = true;

    const timer = setTimeout(() => {
      const greetingText = 'Good morning. JARVIS is online and ready. How can I assist you?';

      // ALWAYS add greeting to message UI immediately (no await)
      const welcomeMsg: ChatMessage = {
        id: 'boot_welcome_msg',
        role: 'assistant',
        content: greetingText,
        streaming: false,
        timestamp: Date.now(),
      };
      addMessage(welcomeMsg);

      // Attempt TTS — fire and forget (Chrome may block before user gesture, that's OK)
      speakText(greetingText);

      // Auto-activate mic after a short delay
      setTimeout(() => {
        console.log('[JARVIS Startup] Activating microphone recognition...');
        if (startListeningRef.current) {
          try { startListeningRef.current(); } catch { /* ignore */ }
        }
      }, 2500);
    }, 800);

    return () => clearTimeout(timer);
  }, [addMessage, speakText]);

  // ── Clear stuck-state guard when status changes ──
  useEffect(() => {
    if (status === 'THINKING' || status === 'EXECUTING') {
      stuckGuardRef.current = setTimeout(() => {
        console.warn('[ChatPanel] Status stuck in', status, '— auto-resetting to IDLE');
        setIsStreaming(false);
        setStatus('IDLE');
      }, 60000);
    } else {
      if (stuckGuardRef.current) {
        clearTimeout(stuckGuardRef.current);
        stuckGuardRef.current = null;
      }
    }
    return () => {
      if (stuckGuardRef.current) clearTimeout(stuckGuardRef.current);
    };
  }, [status, setStatus]);

  // ── Web Fallback Command Parser for Browser Mode ──
  const processWebCommand = (text: string) => {
    const lower = text.toLowerCase().trim();
    const stripped = lower.replace(/^(jarvis[,.!?]?\s*)|(hey jarvis[,.!?]?\s*)|(please\s+)/i, '').trim();

    if (stripped === 'stop' || stripped === 'cancel' || stripped === 'abort') {
      useAppStore.getState().setStatus('IDLE');
      return { intent: 'STOP', handled: true, message: 'Stopped all active operations.' };
    }

    // Schedule / Reminder Intent Handler
    const scheduleMatch = stripped.match(/(?:send|remind|notify|message)\s+(?:the\s+message\s+|me\s+)?at\s+(\d{1,2}:\d{2})(?:\s*(am|pm))?\s*(?:"([^"]+)"|'([^']+)'|(.+))?/i);
    if (scheduleMatch) {
      const timeStr = scheduleMatch[1];
      const ampm = scheduleMatch[2] ? scheduleMatch[2].toUpperCase() : '';
      const customMsg = scheduleMatch[3] || scheduleMatch[4] || scheduleMatch[5] || 'Scheduled reminder notification';

      const [targetHoursStr, targetMinsStr] = timeStr.split(':');
      let targetHours = parseInt(targetHoursStr, 10);
      const targetMins = parseInt(targetMinsStr, 10);

      if (ampm === 'PM' && targetHours < 12) targetHours += 12;
      if (ampm === 'AM' && targetHours === 12) targetHours = 0;

      const now = new Date();
      const targetDate = new Date();
      targetDate.setHours(targetHours, targetMins, 0, 0);

      if (targetDate.getTime() <= now.getTime()) {
        targetDate.setDate(targetDate.getDate() + 1);
      }

      const delayMs = targetDate.getTime() - now.getTime();
      const formattedTargetTime = targetDate.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

      setTimeout(() => {
        const notifMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `⏰ **SCHEDULED REMINDER AT ${formattedTargetTime} IST**:\n"${customMsg.trim()}"`,
          streaming: false,
          timestamp: Date.now(),
        };
        useAppStore.getState().addMessage(notifMsg);

        if (useAppStore.getState().ttsEnabled && 'speechSynthesis' in window) {
          try {
            window.speechSynthesis.cancel();
            const utt = new SpeechSynthesisUtterance(`Reminder: ${customMsg.trim()}`);
            window.speechSynthesis.speak(utt);
          } catch {}
        }
      }, delayMs);

      return {
        intent: 'SCHEDULE_NOTIFICATION',
        handled: true,
        message: `✓ Scheduled reminder set for **${formattedTargetTime} IST**. Message: "${customMsg.trim()}"`,
      };
    }

    if (stripped.includes('development') || stripped === 'dev mode' || stripped === 'open dev') {
      useAppStore.getState().setActiveWorkspace('DEVELOPMENT');
      useAppStore.getState().setActivePanel('chat'); 
      useAppStore.getState().setActivePanel('settings');
      return { intent: 'NAVIGATE', handled: true, message: 'Opened SETTINGS panel.' };
    }
    if (stripped.includes('build') && (stripped.includes('website') || stripped.includes('site'))) {
      useAppStore.getState().setActiveWorkspace('WEBSITE_BUILDER');
      useAppStore.getState().setActivePanel('siteGenerator');
      return { intent: 'WEBSITE_BUILD', handled: true, message: 'Navigated to Website Builder for site generation.' };
    }

    return { intent: 'GENERAL_CHAT', handled: false, message: '' };
  };

  // ── Unified Command Execution Handler (Voice & Text) ──
  const executeCommand = useCallback(async (text: string, isVoice = false) => {
    const cleanText = text.trim();
    if (!cleanText || isStreaming) return;

    window.electronAPI?.stopSpeaking();

    // Add user message to UI
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: isVoice ? `🎤 ${cleanText}` : cleanText,
      streaming: false,
      timestamp: Date.now(),
    };
    addMessage(userMsg);
    if (!isVoice) setInput('');

    if (window.electronAPI) {
      await window.electronAPI.saveMessage(sessionId, 'user', cleanText);
    }

    setStatus('THINKING');
    setIsStreaming(true);

    try {
      let result: any = null;

      if (window.electronAPI) {
        result = await window.electronAPI.sendCommand({
          source: isVoice ? 'VOICE' : 'CHAT',
          text: cleanText,
          workspace: useAppStore.getState().activeWorkspace,
          sessionId,
        });
      } else {
        // Browser mode: check navigation intent first, otherwise go straight to AI
        result = processWebCommand(cleanText);
      }

      console.log('[ChatPanel] CommandRouter result:', result);

      // If CommandRouter processed a system intent (STOP, NAVIGATE, WEBSITE_BUILD, etc.)
      if (result && result.intent !== 'GENERAL_CHAT') {
        const responseText = result.message || `Command executed: ${result.intent}`;
        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: responseText,
          streaming: false,
          timestamp: Date.now(),
        };
        addMessage(assistantMsg);

        if (window.electronAPI) {
          await window.electronAPI.saveMessage(sessionId, 'assistant', responseText);
        }

        // Universal TTS helper: Web Speech Synthesis fallback + Electron SAPI
        if (ttsEnabled) {
          setStatus('SPEAKING');
          const cleanSpeech = responseText.replace(/```[\s\S]*?```/g, '').replace(/[*_#~`]/g, '').trim();
          if ('speechSynthesis' in window) {
            try {
              window.speechSynthesis.cancel();
              const utterance = new SpeechSynthesisUtterance(cleanSpeech.slice(0, 300));
              utterance.rate = 1.0;
              utterance.onend = () => setStatus('IDLE');
              utterance.onerror = () => setStatus('IDLE');
              window.speechSynthesis.speak(utterance);
            } catch { /* ignore */ }
          }
          if (window.electronAPI?.speak) {
            try { await window.electronAPI.speak(cleanSpeech); } catch { /* ignore */ }
          }
        }
        setStatus('IDLE');
        setIsStreaming(false);
        return;
      }

      // GENERAL_CHAT — In browser mode, always use direct Gemini/OpenAI fallback
      if (!window.electronAPI) {
        await streamLLMResponse(cleanText);
        return;
      }

      // Electron mode: require provider configured
      if (!activeProvider) {
        const noProviderMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '⚠️ No AI provider configured. Go to Settings → select a provider and add an API key.',
          error: true,
          streaming: false,
          timestamp: Date.now(),
        };
        addMessage(noProviderMsg);
        setStatus('ERROR');
        setTimeout(() => setStatus('IDLE'), 3000);
        setIsStreaming(false);
        return;
      }

      await streamLLMResponse(cleanText);
    } catch (err: any) {
      console.error('[ChatPanel] Command execution error:', err);
      setStatus('ERROR');
      setTimeout(() => setStatus('IDLE'), 3000);
      setIsStreaming(false);
    }
  }, [isStreaming, sessionId, activeProvider, ttsEnabled, addMessage, setStatus]);

  // ── LLM streaming response helper ──
  const streamLLMResponse = useCallback(async (text: string) => {
    lastAssistantTextRef.current = '';
    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      streaming: true,
      timestamp: Date.now(),
    };
    addMessage(assistantMsg);

    if (!window.electronAPI) {
      // Browser mode: Gemini first → 5 OpenRouter keys rotation (all keys configured)
      try {
        const context = [...useAppStore.getState().messages]
          .filter(m => !m.streaming)
          .slice(-12)
          .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content.replace(/^🎤\s*/, '') }));

        const reply = await callBrowserAI(context);

        appendToLastAssistantMessage(reply);
        finalizeLastAssistantMessage(false);
        setIsStreaming(false);

        if (useAppStore.getState().ttsEnabled) {
          speakText(reply);
        } else {
          setStatus('IDLE');
        }
      } catch (err: any) {
        finalizeLastAssistantMessage(true);
        appendToLastAssistantMessage(`⚠️ All AI providers failed: ${err?.message || String(err)}`);
        setIsStreaming(false);
        setStatus('ERROR');
        setTimeout(() => setStatus('IDLE'), 3000);
      }
      return;
    }

    const context = [...useAppStore.getState().messages]
      .filter(m => !m.streaming)
      .slice(-20)
      .map(m => ({ role: m.role, content: m.content.replace(/^🎤\s*/, '') }));

    const result = await window.electronAPI.streamChat({
      provider: activeProvider!,
      model: activeModel,
      messages: context,
    });

    if (result?.error) {
      finalizeLastAssistantMessage(true);
      appendToLastAssistantMessage(`⚠️ ${result.error}`);
      setIsStreaming(false);
      setStatus('ERROR');
      setTimeout(() => setStatus('IDLE'), 3000);
    }
  }, [activeProvider, activeModel, addMessage, appendToLastAssistantMessage, finalizeLastAssistantMessage, setStatus, speakText]);

  // ── Main text send handler ──
  const handleSendText = useCallback((textToSend: string) => {
    executeCommand(textToSend, false);
  }, [executeCommand]);

  // ── Voice PTT handler ──
  const handleVoiceCommand = useCallback((transcript: string) => {
    executeCommand(transcript, true);
  }, [executeCommand]);

  // ── PTT Speech Recognition Callbacks ──
  const handleSpeechResult = useCallback((transcript: string) => {
    if (transcript.trim()) {
      handleVoiceCommand(transcript.trim());
    }
  }, [handleVoiceCommand]);

  const handleSpeechError = useCallback((err: MicError) => {
    let msg = 'Speech recognition error.';
    if (err === 'permission-denied') {
      msg = '🎤 Mic permission denied. Please allow microphone access in browser/OS settings.';
    } else if (err === 'no-mic') {
      msg = '🎤 No microphone device detected on this system.';
    } else if (err === 'not-supported') {
      msg = '🎤 Web Speech API not supported in this context.';
    } else if (err === 'network') {
      msg = '🎤 Network connection required for Web Speech API recognition.';
    }
    setMicNotice(msg);
    setStatus('ERROR');
    setTimeout(() => {
      setMicNotice(null);
      setStatus('IDLE');
    }, 5000);
  }, [setStatus]);

  const { status: speechStatus, isSupported: isMicSupported, startListening, stopListening } = useSpeechRecognition({
    onResult: handleSpeechResult,
    onError: handleSpeechError,
  });

  startListeningRef.current = startListening;

  useEffect(() => {
    if (speechStatus === 'listening') {
      setStatus('LISTENING');
    } else if (speechStatus === 'idle' && status === 'LISTENING') {
      setStatus('TRANSCRIBING');
      setTimeout(() => {
        if (useAppStore.getState().status === 'TRANSCRIBING') setStatus('IDLE');
      }, 2000);
    }
  }, [speechStatus, status, setStatus]);

  // ── Subscribe to stream chunks + confirmation requests + TTS ──
  useEffect(() => {
    if (!window.electronAPI) return;
    const unsub = window.electronAPI.onStreamChunk(async (chunk) => {
      if (chunk.type === 'confirmation_required' && chunk.toolCall) {
        setPendingToolCall(chunk.toolCall);
      } else if (chunk.type === 'delta' && chunk.content) {
        appendToLastAssistantMessage(chunk.content);
        lastAssistantTextRef.current += chunk.content;
      } else if (chunk.type === 'done') {
        finalizeLastAssistantMessage(false);
        setIsStreaming(false);

        const fullResponse = lastAssistantTextRef.current;
        const isTtsEnabled = useAppStore.getState().ttsEnabled;

        if (isTtsEnabled && fullResponse.trim()) {
          setStatus('SPEAKING');
          const cleanSpeech = fullResponse.replace(/```[\s\S]*?```/g, '').replace(/[*_#~`]/g, '').trim();
          if ('speechSynthesis' in window) {
            try {
              window.speechSynthesis.cancel();
              const utterance = new SpeechSynthesisUtterance(cleanSpeech.slice(0, 300));
              utterance.rate = 1.0;
              utterance.onend = () => setStatus('IDLE');
              utterance.onerror = () => setStatus('IDLE');
              window.speechSynthesis.speak(utterance);
            } catch { /* ignore */ }
          }
          if (window.electronAPI?.speak) {
            try {
              const ttsRes = await window.electronAPI.speak(cleanSpeech);
              if (!ttsRes.success) {
                setTtsNotice(`TTS: ${ttsRes.error || 'Voice output unavailable'}`);
                setTimeout(() => setTtsNotice(null), 4000);
              }
            } catch { /* ignore */ }
          }
          setStatus('IDLE');
        } else {
          setStatus('IDLE');
        }

        if (fullResponse.trim()) {
          window.electronAPI.saveMessage(sessionId, 'assistant', fullResponse).catch(() => {});
        }
      } else if (chunk.type === 'error') {
        finalizeLastAssistantMessage(true);
        setIsStreaming(false);
        setStatus('ERROR');
        setTimeout(() => setStatus('IDLE'), 3000);
      }
    });
    return unsub;
  }, [appendToLastAssistantMessage, finalizeLastAssistantMessage, setStatus, sessionId]);

  const handleRespondConfirmation = (allowed: boolean) => {
    if (pendingToolCall && window.electronAPI) {
      window.electronAPI.respondConfirmation(pendingToolCall.callId, allowed);
      setPendingToolCall(null);
    }
  };

  const handleClear = async () => {
    window.electronAPI?.stopSpeaking();
    clearMessages();
    if (window.electronAPI) {
      await window.electronAPI.clearSession(sessionId);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendText(input);
    }
  };

  const handleMicToggle = () => {
    if (speechStatus === 'listening') {
      stopListening();
    } else {
      startListening();
    }
  };

  /* ── ProjectFlow steps for Center Room bottom bar ── */
  const FLOW_STEPS = [
    { label: 'Plan',   done: true,  active: false },
    { label: 'Code',   done: false, active: true  },
    { label: 'Test',   done: false, active: false },
    { label: 'Deploy', done: false, active: false },
    { label: 'Launch', done: false, active: false },
  ];

  return (
    <div className="flex flex-col h-full relative scanlines" style={{ background: 'rgba(0,0,0,0.15)' }}>
      {/* Confirmation Modal */}
      <ConfirmationModal
        toolCall={pendingToolCall}
        onRespond={handleRespondConfirmation}
      />

      {/* Mic/TTS Alerts */}
      {(micNotice || ttsNotice) && (
        <div className="absolute top-2 left-4 right-4 z-40 p-2.5 rounded-lg bg-amber-950/80 border border-amber-500/50 text-amber-300 font-mono text-xs flex items-center justify-between shadow-lg">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{micNotice || ttsNotice}</span>
          </div>
          <button onClick={() => { setMicNotice(null); setTtsNotice(null); }} className="text-amber-400 hover:text-white font-bold ml-2">✕</button>
        </div>
      )}

      {/* ── Fine grid overlay (Code Sanctum) ── */}
      <div className="pointer-events-none absolute inset-0 grid-fine opacity-30 z-0" />
      <div className="pointer-events-none absolute inset-0 z-0" style={{ background: 'radial-gradient(ellipse at center, transparent 40%, color-mix(in srgb, black 60%, transparent))' }} />

      {/* ── Center Room header title ── */}
      <div className="relative z-10 flex items-center justify-center py-2 shrink-0" style={{ borderBottom: '1px solid var(--hud-line)' }}>
        <h1
          className="px-6 py-0.5 font-display text-[10px] tracking-[0.35em] border"
          style={{ color: 'var(--cyan)', textShadow: '0 0 12px var(--cyan)', borderColor: 'var(--hud-line)', background: 'rgba(0,0,0,0.6)' }}
        >
          JARVIS // COMMAND CENTER
        </h1>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 relative z-10">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center font-mono space-y-3" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>
            <div className="relative grid place-items-center" style={{ width: 56, height: 56 }}>
              <div className="absolute inset-0 rounded-full border anim-spin-slow" style={{ borderColor: 'var(--hud-line)' }} />
              <div className="absolute rounded-full anim-pulse-soft" style={{ inset: 10, background: 'radial-gradient(circle, var(--cyan), transparent 70%)' }} />
              <span className="relative font-display text-[8px] tracking-widest" style={{ color: 'var(--cyan)' }}>JARVIS</span>
            </div>
            <p className="text-[11px] tracking-widest hud-label" style={{ color: 'var(--cyan)' }}>AWAITING INPUT</p>
            <p className="text-[11px]">Try: "Jarvis, open trading mode" or "build me a website"</p>
            {!activeProvider && (
              <p className="text-[11px]" style={{ color: 'var(--warn)' }}>
                💡 System commands work without an API key. Configure Settings for AI chat.
              </p>
            )}
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex anim-bubble ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[82%] flex items-start gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              {/* Avatar */}
              <div
                className="grid place-items-center border shrink-0 text-[9px] font-bold"
                style={{
                  width: 26, height: 26,
                  borderColor: msg.role === 'user' ? 'color-mix(in srgb, var(--blue) 60%, transparent)' : msg.error ? 'color-mix(in srgb, var(--warn) 60%, transparent)' : 'color-mix(in srgb, var(--cyan) 60%, transparent)',
                  color: msg.role === 'user' ? 'var(--blue)' : msg.error ? 'var(--warn)' : 'var(--cyan)',
                  background: msg.role === 'user' ? 'color-mix(in srgb, var(--blue) 12%, transparent)' : 'color-mix(in srgb, var(--cyan) 10%, transparent)',
                }}
              >
                {msg.role === 'user' ? 'U' : msg.error ? '!' : 'J'}
              </div>
              {/* Bubble */}
              <div
                className="hud-bracket px-3 py-2 text-[12px] font-mono leading-relaxed"
                style={{
                  border: '1px solid',
                  borderColor: msg.role === 'user'
                    ? 'color-mix(in srgb, var(--blue) 45%, transparent)'
                    : msg.error
                      ? 'color-mix(in srgb, var(--warn) 45%, transparent)'
                      : 'color-mix(in srgb, var(--cyan) 35%, transparent)',
                  background: msg.role === 'user'
                    ? 'color-mix(in srgb, var(--blue) 12%, rgba(0,0,0,0.6))'
                    : msg.error
                      ? 'color-mix(in srgb, var(--warn) 10%, rgba(0,0,0,0.7))'
                      : 'rgba(0,0,0,0.65)',
                  color: msg.error ? 'var(--warn)' : 'var(--color-text)',
                }}
              >
                {msg.content || (msg.streaming && (
                  <span className="flex items-center gap-2" style={{ color: 'var(--color-muted)' }}>
                    <Loader2 className="w-3 h-3 animate-spin" style={{ color: 'var(--cyan)' }} />
                    <span className="text-[11px]">Thinking…</span>
                  </span>
                ))}
                {msg.streaming && msg.content && (
                  <span className="inline-block ml-0.5 anim-blink" style={{ width: 6, height: 14, background: 'var(--cyan)' }} />
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* ── ProjectFlow Pipeline Bar (Code Sanctum) ── */}
      <div className="relative z-10 flex items-center justify-center py-1.5 border-t border-b shrink-0" style={{ borderColor: 'var(--hud-line)', background: 'rgba(0,0,0,0.5)' }}>
        <div className="hud-bracket flex items-center justify-center gap-1 px-4 py-1.5 border" style={{ borderColor: 'var(--hud-line)', background: 'rgba(0,0,0,0.4)' }}>
          {FLOW_STEPS.map((s, i) => {
            const color = s.done ? 'var(--success)' : s.active ? 'var(--cyan)' : 'var(--color-muted)';
            return (
              <div key={s.label} className="flex items-center gap-1">
                <div className="flex flex-col items-center gap-0.5">
                  <span
                    className={`grid place-items-center rounded-full border text-[8px] ${s.active ? 'anim-pulse-soft' : ''}`}
                    style={{ width: 26, height: 26, borderColor: color, color, boxShadow: (s.active || s.done) ? `0 0 10px -4px ${color}` : undefined }}
                  >
                    {s.done ? '✓' : s.active ? '→' : '○'}
                  </span>
                  <span className="text-[7px] tracking-widest uppercase" style={{ color }}>{s.label}</span>
                </div>
                {i < FLOW_STEPS.length - 1 && (
                  <div className="relative mb-3 w-6" style={{ height: 1, background: 'var(--hud-line)' }}>
                    <span
                      className="absolute top-1/2 rounded-full"
                      style={{ width: 5, height: 5, background: 'var(--cyan)', animation: `packet 2.4s linear ${i * 0.4}s infinite`, transform: 'translateY(-50%)' }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── HUD Terminal Input Area (Code Sanctum) ── */}
      <div className="relative z-10 border-t shrink-0" style={{ borderColor: 'var(--hud-line)', background: 'rgba(0,0,0,0.75)' }}>
        {/* Status bar */}
        <div className="flex items-center justify-between px-3 py-1 text-[10px] font-mono border-b" style={{ borderColor: 'var(--hud-line)' }}>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1" style={{ color: activeProvider ? 'var(--success)' : 'var(--warn)' }}>
              <span className="w-1.5 h-1.5 rounded-full anim-pulse-soft" style={{ background: activeProvider ? 'var(--success)' : 'var(--warn)' }} />
              {activeProvider
                ? `${activeProvider.toUpperCase()} · ${activeModel || 'default'}`
                : 'System Commands Active (No provider needed)'}
            </span>
            {speechStatus === 'listening' && (
              <span className="flex items-center gap-1 font-bold" style={{ color: 'var(--success)' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--success)', animation: 'ping 1s infinite' }} />
                LISTENING…
              </span>
            )}
          </div>
          <div className="flex items-center gap-3" style={{ color: 'var(--color-muted)' }}>
            <button
              onClick={() => {
                const hour = new Date().getHours();
                let greetingTime = 'Good morning';
                if (hour >= 12 && hour < 17) greetingTime = 'Good afternoon';
                else if (hour >= 17) greetingTime = 'Good evening';
                const statusText = `${greetingTime}, Boss. JARVIS Command Center status: System core performance 94%, all 3 agents Developer, Architect, and Reviewer are online. All 10 adapters active.`;
                speakText(statusText);
              }}
              className="flex items-center gap-1 hover:text-cyan-400 transition-colors"
              title="Click to hear verbal status update"
            >
              <Volume2 className="w-3 h-3 text-cyan-400" />
              <span className="text-cyan-400 font-bold">Speak Status Update</span>
            </button>
            <span className="flex items-center gap-1">
              {ttsEnabled ? <Volume2 className="w-3 h-3" style={{ color: 'var(--success)' }} /> : <VolumeX className="w-3 h-3" />}
              <span style={{ color: ttsEnabled ? 'var(--success)' : 'var(--color-muted)' }}>TTS {ttsEnabled ? 'ON' : 'OFF'}</span>
            </span>
            <button
              onClick={handleClear}
              className="flex items-center gap-1 transition-colors"
              style={{ color: 'var(--color-muted)' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--error)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-muted)')}
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear</span>
            </button>
          </div>
        </div>

        {/* Text Input + Voice PTT Controls */}
        <div className="flex items-end space-x-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Type a command… (e.g. "open trading mode", "open website builder", "stop")'
            rows={2}
            className="flex-1 bg-black/60 border border-theme-border rounded-lg text-sm text-theme-text placeholder-theme-muted px-3 py-2 resize-none focus:border-theme-primary focus:outline-none font-mono transition-colors"
          />

          {/* PTT Mic Button */}
          <button
            onMouseDown={() => startListening()}
            onMouseUp={() => stopListening()}
            onTouchStart={() => startListening()}
            onTouchEnd={() => stopListening()}
            onClick={handleMicToggle}
            disabled={isStreaming || !isMicSupported}
            title={
              !isMicSupported
                ? 'Web Speech API not available'
                : speechStatus === 'listening'
                  ? 'Listening... click to send'
                  : 'Push-to-Talk — Hold or Click to speak a command'
            }
            className={`h-12 w-12 rounded-lg border flex items-center justify-center transition-all shrink-0
              ${speechStatus === 'listening'
                ? 'border-emerald-400 bg-emerald-500/25 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.6)] animate-pulse'
                : !isMicSupported
                  ? 'border-theme-border/30 bg-black/20 text-theme-muted/30 cursor-not-allowed'
                  : 'border-theme-border bg-black/40 text-theme-muted hover:text-theme-primary hover:border-theme-primary/60'}
              disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            {speechStatus === 'listening'
              ? <Mic className="w-5 h-5 text-emerald-400 animate-bounce" />
              : <Mic className="w-5 h-5" />
            }
          </button>

          {/* Send Button */}
          <button
            onClick={() => handleSendText(input)}
            disabled={!input.trim() || isStreaming}
            className="h-12 w-12 rounded-lg border border-theme-primary bg-theme-primary/10 text-theme-primary hover:bg-theme-primary/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center shrink-0"
          >
            {isStreaming
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Send className="w-4 h-4" />
            }
          </button>
        </div>
      </div>
    </div>
  );
}
