import { create } from 'zustand';

export type Provider = 'anthropic' | 'openai' | 'google' | 'ollama' | 'omniroute';
export type AssistantStatus = 'IDLE' | 'LISTENING' | 'TRANSCRIBING' | 'THINKING' | 'EXECUTING' | 'SPEAKING' | 'ERROR';
export type Theme = 'cyan' | 'crimson' | 'emerald';


export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  error?: boolean;
  timestamp: number;
}

export interface ProviderEntry {
  provider: Provider;
  hasKey: boolean;
}

export interface AppState {
  // Theme
  theme: Theme;
  setTheme: (t: Theme) => void;

  // Assistant state (IDLE | LISTENING | THINKING | SPEAKING | ERROR)
  status: AssistantStatus;
  setStatus: (s: AssistantStatus) => void;

  // Panel
  activePanel: 'chat' | 'settings' | 'siteGenerator';
  setActivePanel: (p: 'chat' | 'settings' | 'siteGenerator') => void;

  // Phase 2 Workspaces
  activeWorkspace: string;
  setActiveWorkspace: (w: string) => void;

  // Phase 2 Canonical Events Stream
  recentEvents: any[];
  addJarvisEvent: (evt: any) => void;

  // Provider & model
  activeProvider: Provider | null;
  activeModel: string;
  setActiveProvider: (p: Provider | null) => void;
  setActiveModel: (m: string) => void;

  // Key vault state
  providers: ProviderEntry[];
  setProviders: (p: ProviderEntry[]) => void;

  // Voice / TTS
  ttsEnabled: boolean;
  setTtsEnabled: (enabled: boolean) => void;

  // Chat
  sessionId: string;
  messages: ChatMessage[];
  addMessage: (msg: ChatMessage) => void;
  appendToLastAssistantMessage: (chunk: string) => void;
  finalizeLastAssistantMessage: (error?: boolean) => void;
  clearMessages: () => void;
}

const SESSION_ID = `session_${Date.now()}`;

export const useAppStore = create<AppState>((set) => ({
  theme: 'cyan',
  setTheme: (theme) => set({ theme }),

  status: 'IDLE',
  setStatus: (status) => set({ status }),

  activePanel: 'chat' as 'chat' | 'settings' | 'siteGenerator',
  setActivePanel: (activePanel) => set({ activePanel }),

  activeWorkspace: 'COMMAND_CENTER',
  setActiveWorkspace: (activeWorkspace) => set({ activeWorkspace }),

  recentEvents: [],
  addJarvisEvent: (evt) => set((s) => ({ recentEvents: [evt, ...s.recentEvents].slice(0, 50) })),

  activeProvider: 'google',
  activeModel: 'gemini-1.5-flash',
  setActiveProvider: (activeProvider) => set({ activeProvider }),
  setActiveModel: (activeModel) => set({ activeModel }),

  providers: [
    { provider: 'google', hasKey: true },
    { provider: 'openai', hasKey: true },
    { provider: 'omniroute', hasKey: true },
  ],
  setProviders: (providers) => set({ providers }),

  ttsEnabled: true,
  setTtsEnabled: (ttsEnabled) => set({ ttsEnabled }),

  sessionId: SESSION_ID,
  messages: [],

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  appendToLastAssistantMessage: (chunk) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant' && last.streaming) {
        msgs[msgs.length - 1] = { ...last, content: last.content + chunk };
      }
      return { messages: msgs };
    }),

  finalizeLastAssistantMessage: (error = false) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, streaming: false, error };
      }
      return { messages: msgs };
    }),

  clearMessages: () => set({ messages: [] }),
}));
