import { contextBridge, ipcRenderer } from 'electron';

export type Provider = 'anthropic' | 'openai' | 'google' | 'ollama' | 'omniroute';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamChunk {
  type: 'delta' | 'done' | 'error' | 'confirmation_required';
  content?: string;
  error?: string;
  routedProvider?: string;
  toolCall?: {
    callId: string;
    toolName: string;
    args: Record<string, any>;
    fullCommandText: string;
  };
}

export interface KeyVaultEntry {
  provider: Provider;
  hasKey: boolean;
}

export interface AuditLogEntry {
  id: number;
  action_type: string;
  details: string;
  status: string;
  created_at: string;
}

export type ToolConfirmationMode = 'always' | 'once_per_session';

export interface ToolConfirmationSettings {
  open_application: ToolConfirmationMode;
  focus_window: ToolConfirmationMode;
  write_clipboard: ToolConfirmationMode;
  run_shell_command: 'always';
}

export interface BuildLoopStatus {
  step: 'planning' | 'scaffolding' | 'writing' | 'building' | 'fixing' | 'starting' | 'success' | 'failed';
  attempt: number;
  maxAttempts: number;
  currentFile?: string;
  errorLog?: string;
  previewUrl?: string;
  backendUrl?: string;
  logs?: string[];
  health?: {
    frontend: 'RUNNING' | 'STOPPED' | 'ERROR';
    backend: 'RUNNING' | 'STOPPED' | 'ERROR' | 'UNAVAILABLE';
    api: 'CONNECTED' | 'DISCONNECTED' | 'UNAVAILABLE';
    database: 'CONNECTED' | 'DISCONNECTED' | 'UNAVAILABLE';
  };
  projectSlug?: string;
}

export interface DiffLine {
  type: 'add' | 'delete' | 'normal';
  lineNumberOld?: number;
  lineNumberNew?: number;
  content: string;
}

export interface DiffResult {
  filePath: string;
  oldCode: string;
  newCode: string;
  lines: DiffLine[];
  additions: number;
  deletions: number;
}

export interface IElectronAPI {
  // Window
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
  toggleWindow: () => void;
  onHotkeyTriggered: (cb: () => void) => () => void;
  getAppVersion: () => Promise<string>;
  testSQLite: () => Promise<{ dbPath: string; count: number }>;

  // OmniRoute Integration (Deliverable 8)
  checkOmniRouteStatus: () => Promise<{ reachable: boolean; endpoint: string; version?: string; error?: string }>;

  // Settings
  getActiveProvider: () => Promise<Provider | null>;
  setActiveProvider: (provider: Provider) => Promise<boolean>;
  getTheme: () => Promise<string>;
  setTheme: (theme: string) => Promise<boolean>;
  getTtsEnabled: () => Promise<boolean>;
  setTtsEnabled: (enabled: boolean) => Promise<boolean>;
  getToolConfirmations: () => Promise<ToolConfirmationSettings>;
  setToolConfirmation: (toolName: keyof ToolConfirmationSettings, mode: ToolConfirmationMode) => Promise<boolean>;

  // Site Generation (Deliverable 7)
  generateSite: (payload: { prompt: string; provider: string; modelName: string }) => Promise<{ success: boolean; siteId?: string; previewUrl?: string; backendUrl?: string; error?: string }>;
  onSiteStatusUpdate: (cb: (status: BuildLoopStatus) => void) => () => void;
  exportSiteZip: (siteId: string) => Promise<{ success: boolean; zipPath?: string; error?: string }>;
  computeSiteDiff: (payload: { filePath: string; oldCode: string; newCode: string }) => Promise<DiffResult>;
  restartProject: (slug: string) => Promise<{ success: boolean; previewUrl?: string }>;
  stopProject: (slug: string) => Promise<boolean>;
  launchChrome: (url: string) => Promise<{ success: boolean; error?: string }>;
  listProjects: () => Promise<any[]>;
  modifyProject: (payload: { slug: string; instruction: string; provider?: string; modelName?: string }) => Promise<{ success: boolean; step?: string; changesMade?: string[]; errorLog?: string }>;
  getProjectLogs: (slug: string) => Promise<any[]>;
  listFreeLlmEndpoints: () => Promise<any[]>;
  listAgenticSkills: () => Promise<any[]>;
  discoverKeyPool: () => Promise<any[]>;
  autoRouteModel: (prompt: string) => Promise<any>;

  // Tool Confirmations & Direct Exec
  respondConfirmation: (callId: string, allowed: boolean) => void;
  executeToolDirect: (toolName: string, args: Record<string, any>) => Promise<{ success: boolean; result?: any; error?: string }>;

  // Audit Log
  getAuditLogs: () => Promise<AuditLogEntry[]>;
  clearAuditLogs: () => Promise<boolean>;

  // Key Vault
  saveKey: (provider: Provider, key: string) => Promise<boolean>;
  deleteKey: (provider: Provider) => Promise<boolean>;
  listProviders: () => Promise<KeyVaultEntry[]>;
  hasKey: (provider: Provider) => Promise<boolean>;

  // LLM Streaming
  streamChat: (payload: { provider: Provider; model: string; messages: ChatMessage[] }) => Promise<{ success?: boolean; error?: string }>;
  onStreamChunk: (cb: (chunk: StreamChunk) => void) => () => void;

  // TTS
  speak: (text: string) => Promise<{ success: boolean; error?: string }>;
  stopSpeaking: () => Promise<boolean>;

  // Voice Input & Output Services (Phase 21)
  getVoiceInputStatus: () => Promise<{ status: string; activeProvider: string; isListening: boolean; error?: string }>;
  getVoiceOutputStatus: () => Promise<{ status: string; activeEngine: string; isSpeaking: boolean }>;
  setVoiceListeningState: (listening: boolean) => Promise<boolean>;


  // Memory
  saveMessage: (sessionId: string, role: string, content: string) => Promise<boolean>;
  getSession: (sessionId: string) => Promise<ChatMessage[]>;
  clearSession: (sessionId: string) => Promise<boolean>;

  // Phase 2 Canonical Event Bus & Command Router Bridge
  onJarvisEvent: (cb: (event: any) => void) => () => void;
  sendCommand: (request: { source: 'CHAT' | 'VOICE' | 'SYSTEM' | 'AUTOMATION'; text: string; workspace?: string; sessionId?: string }) => Promise<any>;
  stopAllCommands: () => Promise<any>;
  getWorkspaceState: () => Promise<string>;
  setWorkspaceState: (workspace: string) => Promise<boolean>;

  // Phase 3 Mission & Task Engine Bridge
  listMissions: () => Promise<any[]>;
  getMission: (missionId: string) => Promise<any>;
  cancelMission: (missionId: string, reason?: string) => Promise<boolean>;

  // Phase 2 Model Gateway & Role Routing
  listModels: () => Promise<any[]>;
  assignRoleModel: (role: string, modelId: string) => Promise<boolean>;

  // Phase 3 Unified Tool System
  listUnifiedTools: () => Promise<any[]>;
  executeUnifiedTool: (toolId: string, args: Record<string, any>) => Promise<any>;

  // Phase 6 Computer Control
  launchApp: (name: string) => Promise<any>;
  takeScreenshot: () => Promise<any>;

  // Phase 7 Project Intelligence
  inspectProject: (dirPath: string) => Promise<any>;

  // Phase 8 Autonomous Development
  executeDevTask: (projectDir: string, taskDescription: string) => Promise<any>;
  getTaskGraph: (missionId: string) => Promise<any>;

  // Phase 4 Adapters Infrastructure Bridge
  listAdapters: () => Promise<any[]>;
  checkAllAdapters: () => Promise<any[]>;
  getAdapterStatus: (adapterId: string) => Promise<any>;
  enableAdapter: (adapterId: string) => Promise<{ success: boolean; adapterId: string; enabled: boolean; error?: string }>;
  disableAdapter: (adapterId: string) => Promise<{ success: boolean; adapterId: string; enabled: false; error?: string }>;
  executeAdapter: (input: { adapterId: string; capability?: string; missionId?: string; taskId?: string; payload?: Record<string, any> }) => Promise<any>;
  cancelAdapter: (adapterId: string, executionId: string) => Promise<{ success: boolean; adapterId: string; executionId: string; error?: string }>;
}


const electronAPI: IElectronAPI = {
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  toggleWindow: () => ipcRenderer.send('window-toggle'),
  onHotkeyTriggered: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('hotkey-triggered', handler);
    return () => ipcRenderer.removeListener('hotkey-triggered', handler);
  },
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  testSQLite: () => ipcRenderer.invoke('test-sqlite'),
  checkOmniRouteStatus: () => ipcRenderer.invoke('omniroute:check-status'),

  getActiveProvider: () => ipcRenderer.invoke('settings:get-active-provider'),
  setActiveProvider: (p) => ipcRenderer.invoke('settings:set-active-provider', p),
  getTheme: () => ipcRenderer.invoke('settings:get-theme'),
  setTheme: (t) => ipcRenderer.invoke('settings:set-theme', t),
  getTtsEnabled: () => ipcRenderer.invoke('settings:get-tts-enabled'),
  setTtsEnabled: (e) => ipcRenderer.invoke('settings:set-tts-enabled', e),
  getToolConfirmations: () => ipcRenderer.invoke('settings:get-tool-confirmations'),
  setToolConfirmation: (t, m) => ipcRenderer.invoke('settings:set-tool-confirmation', t, m),

  generateSite: (payload) => ipcRenderer.invoke('site:generate', payload),
  onSiteStatusUpdate: (cb) => {
    const handler = (_e: any, status: BuildLoopStatus) => cb(status);
    ipcRenderer.on('site:status-update', handler);
    return () => ipcRenderer.removeListener('site:status-update', handler);
  },
  exportSiteZip: (siteId) => ipcRenderer.invoke('site:export-zip', siteId),
  computeSiteDiff: (payload) => ipcRenderer.invoke('site:compute-diff', payload),
  restartProject: (slug) => ipcRenderer.invoke('site:restart', slug),
  stopProject: (slug) => ipcRenderer.invoke('site:stop', slug),
  launchChrome: (url) => ipcRenderer.invoke('site:launch-chrome', url),
  listProjects: () => ipcRenderer.invoke('site:list-projects'),
  modifyProject: (payload) => ipcRenderer.invoke('site:modify-project', payload),
  getProjectLogs: (slug) => ipcRenderer.invoke('site:get-logs', slug),
  listFreeLlmEndpoints: () => ipcRenderer.invoke('free-llm:list-endpoints'),
  listAgenticSkills: () => ipcRenderer.invoke('skills:list-agentic'),
  discoverKeyPool: () => ipcRenderer.invoke('model:discover-keys'),
  autoRouteModel: (prompt) => ipcRenderer.invoke('model:auto-route', prompt),

  respondConfirmation: (callId, allowed) => ipcRenderer.send('tool:respond-confirmation', { callId, allowed }),
  executeToolDirect: (name, args) => ipcRenderer.invoke('tool:execute-direct', name, args),

  getAuditLogs: () => ipcRenderer.invoke('audit:get-logs'),
  clearAuditLogs: () => ipcRenderer.invoke('audit:clear-logs'),

  saveKey: (p, k) => ipcRenderer.invoke('vault:save-key', p, k),
  deleteKey: (p) => ipcRenderer.invoke('vault:delete-key', p),
  listProviders: () => ipcRenderer.invoke('vault:list-providers'),
  hasKey: (p) => ipcRenderer.invoke('vault:has-key', p),

  streamChat: (payload) => ipcRenderer.invoke('llm:stream-chat', payload),
  onStreamChunk: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, chunk: StreamChunk) => cb(chunk);
    ipcRenderer.on('llm:stream-chunk', handler);
    return () => ipcRenderer.removeListener('llm:stream-chunk', handler);
  },

  speak: (t) => ipcRenderer.invoke('tts:speak', t),
  stopSpeaking: () => ipcRenderer.invoke('tts:stop'),

  getVoiceInputStatus: () => ipcRenderer.invoke('voice:input-status'),
  getVoiceOutputStatus: () => ipcRenderer.invoke('voice:output-status'),
  setVoiceListeningState: (listening) => ipcRenderer.invoke('voice:set-listening', listening),


  saveMessage: (s, r, c) => ipcRenderer.invoke('memory:save-message', s, r, c),
  getSession: (s) => ipcRenderer.invoke('memory:get-session', s),
  clearSession: (s) => ipcRenderer.invoke('memory:clear-session', s),

  onJarvisEvent: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, event: any) => cb(event);
    ipcRenderer.on('jarvis:event', handler);
    return () => ipcRenderer.removeListener('jarvis:event', handler);
  },
  sendCommand: (request) => ipcRenderer.invoke('command:send', request),
  stopAllCommands: () => ipcRenderer.invoke('command:stop-all'),
  getWorkspaceState: () => ipcRenderer.invoke('workspace:get-active'),
  setWorkspaceState: (w) => ipcRenderer.invoke('workspace:set-active', w),

  listMissions: () => ipcRenderer.invoke('mission:list'),
  getMission: (mId: string) => ipcRenderer.invoke('mission:get', mId),
  cancelMission: (mId: string, r?: string) => ipcRenderer.invoke('mission:cancel', { missionId: mId, reason: r }),
  getTaskGraph: (mId) => ipcRenderer.invoke('task:get-graph', mId),

  // Phase 2 Model Gateway Bridge
  listModels: () => ipcRenderer.invoke('model:list'),
  assignRoleModel: (role, modelId) => ipcRenderer.invoke('model:assign-role', { role, modelId }),

  // Phase 3 Unified Tool System Bridge
  listUnifiedTools: () => ipcRenderer.invoke('tool:list-unified'),
  executeUnifiedTool: (toolId, args) => ipcRenderer.invoke('tool:execute-unified', { toolId, args }),

  // Phase 6 Computer Control Bridge
  launchApp: (name) => ipcRenderer.invoke('computer:launch-app', name),
  takeScreenshot: () => ipcRenderer.invoke('computer:screenshot'),

  // Phase 7 Project Intelligence Bridge
  inspectProject: (dirPath) => ipcRenderer.invoke('project:inspect', dirPath),

  // Phase 8 Autonomous Dev Bridge
  executeDevTask: (projectDir, taskDescription) => ipcRenderer.invoke('dev:execute-task', { projectDir, taskDescription }),

  listAdapters: () => ipcRenderer.invoke('adapter:list'),
  checkAllAdapters: () => ipcRenderer.invoke('adapter:check-all'),
  getAdapterStatus: (aId) => ipcRenderer.invoke('adapter:status', aId),

  enableAdapter: (aId) => ipcRenderer.invoke('adapter:enable', aId),
  disableAdapter: (aId) => ipcRenderer.invoke('adapter:disable', aId),
  executeAdapter: (input) => ipcRenderer.invoke('adapter:execute', input),
  cancelAdapter: (aId, eId) => ipcRenderer.invoke('adapter:cancel', { adapterId: aId, executionId: eId }),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
