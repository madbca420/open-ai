import { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage } from 'electron';
import path from 'path';
import { initDatabase, getDatabase } from './db';
import { saveApiKey, getApiKey, deleteApiKey, listStoredProviders, Provider } from './keyVault';
import { streamChat, DEFAULT_MODELS, ChatMessage, resolveConfirmation } from './llmAdapter';
import { speak, stopSpeaking } from './tts';
import { executeTool } from './tools';
import { getAuditLogs, clearAuditLogs, logAudit } from './auditLog';
import { getToolConfirmationSettings, setToolConfirmationSetting, ToolConfirmationMode, ToolConfirmationSettings } from './confirmation';
import { generateSitePipeline, exportSiteAsZip, restartProjectServers, stopProjectServers, launchInChrome } from './siteGenerator';
import { computeLineDiff } from './siteDiff';
import { modelGateway } from './modelGateway';
import { unifiedToolRegistry } from './unifiedToolRegistry';
import { computerControl } from './computerControl';
import { projectIntelligence } from './projectIntelligence';
import { autonomousDevEngine } from './autonomousDevEngine';

import { eventBus } from './eventBus';
import { commandRouter } from './commandRouter';
import { missionManager } from './missionManager';
import { taskGraphEngine } from './taskGraph';
import { WorkspaceType } from './types/schema';
import { adapterRegistry } from './services/adapters/adapterRegistry';
import { featureFlags } from './services/adapters/featureFlags';
import { adapterHealth } from './services/adapters/adapterHealth';
import { registerMockAdapters } from './services/adapters/mockAdapters';
import { agentOrchestrator } from './agentOrchestrator';
import { ComfyUIAdapter } from './services/creative/comfyui_adapter';
import { IOPaintAdapter } from './services/creative/iopaint_adapter';
import { OmniVoiceAdapter, HandyAdapter, TradingAgentsAdapter, MiroFishAdapter, HeyGemAdapter, CapCutAdapter, VoiceStudioAdapter, DramaClawAdapter } from './services/voice/omnivoice_adapter';
import { voiceInputService } from './services/voiceInputService';
import { voiceOutputService } from './services/voiceOutputService';
import { ensureOmniRouteRunning, stopOmniRoute } from './omnirouteService';


let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

const SYSTEM_PROMPT = `You are JARVIS, a sophisticated AI desktop assistant with a sci-fi command-center interface.
You are knowledgeable, precise, and equipped with real desktop automation tools.
You can open applications, list active open windows, focus windows, copy to/read from the clipboard, run shell commands (with user permission), take desktop screenshots, and generate full React web applications with live previews.
Keep responses concise, clear, and helpful.`;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    show: true,
  });

  // Bind EventBus to main window for IPC forwarding
  eventBus.setMainWindow(mainWindow);

  if (isDev) {
    const loadDevServer = () => {
      mainWindow?.loadURL('http://localhost:5173').catch(() => {
        setTimeout(loadDevServer, 500);
      });
    };
    loadDevServer();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.on('dom-ready', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  mainWindow.on('closed', () => {
    eventBus.setMainWindow(null);
    mainWindow = null;
  });
}

function registerGlobalHotkeys() {
  const registered = globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus());
      mainWindow.webContents.send('hotkey-triggered');
    }
  });
  if (!registered) console.warn('[Main] Global hotkey Ctrl+Shift+Space registration failed.');
}

function createTray() {
  const icon = nativeImage.createFromBuffer(
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH6AgICg4oqNx6QAAAAT9JREFUOMuVkz1OAzEQhb/xbpINKSiQKEAPQIEQ3AAhKBAS9wAuQIEQFQ0VBRIFBRJHgIIDUCBxAHZDsmRjO4+CxGaz2WSTkSxZ4/HMmzfjGIBzDuccAM45nHMAOOcAYIwB4JwD4JwD4JwDwDkHgGMMAMYYAMYYAMYYAI4xABhjADDGAGCMAcAYA4AxBgBjDADGGACMMQAYYwAwxgBgjAHAGAOAMQYAYwwAxhgAjDEAGGMAMMYAYIwBwBgDgDEGAGMMAMYYAIwxABhjADDGAGCMAcAYA4AxBgBjDADGGACMMQAYYwAwxgBgjAHAGAOAMQYAYwwAxhgAjDEAGGMAMMYAYIwBwBgDgDEGAGMMAMYYAIwxABhjADDGAGCMAcAYA4AxBgBjDADGGACMMQAYYwAwxgBgjAHAGAOAMYYA4w+XEilMAAAAAElFTkSuQmCC', 'base64')
  );
  tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Summon / Dismiss (Ctrl+Shift+Space)', click: () => { mainWindow?.isVisible() ? mainWindow.hide() : (mainWindow?.show(), mainWindow?.focus()); } },
    { type: 'separator' },
    { label: 'Quit JARVIS', click: () => app.quit() },
  ]);
  tray.setToolTip('JARVIS AI Desktop Assistant');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { mainWindow?.isVisible() ? mainWindow.hide() : (mainWindow?.show(), mainWindow?.focus()); });
}

async function bootstrap() {
  console.log('[JARVIS] Booting...');

  // ── PHASE 1: Database ──
  console.log('[JARVIS] Database initialization...');
  let dbInfo: { dbPath: string; count: number };
  try {
    dbInfo = initDatabase();
  } catch (dbErr: any) {
    console.error('[JARVIS] FATAL: Database initialization failed:', dbErr?.message || dbErr);
    // Show a native error dialog before quitting
    const { dialog } = await import('electron');
    dialog.showErrorBox(
      'JARVIS DATABASE ERROR',
      `Unable to initialize local database.\n\nReason:\n${dbErr?.message || String(dbErr)}`
    );
    app.quit();
    return;
  }
  console.log('[JARVIS] Database READY');

  // ── PHASE 1.5: OmniRoute Gateway ──
  console.log('[JARVIS] Checking OmniRoute Gateway...');
  ensureOmniRouteRunning().catch((err) => {
    console.warn('[JARVIS] OmniRoute Gateway auto-start warning:', err);
  });

  // ── PHASE 2: Core Services (require DB) ──
  console.log('[JARVIS] Initializing core services...');

  // AgentOrchestrator: must initialize AFTER database is ready
  agentOrchestrator.initialize();
  console.log('[JARVIS] AgentOrchestrator READY');

  // EventBus does not need DB but we confirm it
  console.log('[JARVIS] EventBus READY');

  // ── PHASE 3: Adapter Registry ──
  console.log('[JARVIS] Initializing adapters...');

  // Register deterministic Phase 4 mock adapters for offline system testing
  registerMockAdapters();

  // Register Phase 4 Step 8 Real ComfyUI Adapter
  const comfyUIAdapter = new ComfyUIAdapter();
  comfyUIAdapter.initialize().then(() => {
    adapterRegistry.register(comfyUIAdapter);
  }).catch((err) => {
    console.error('[Main] ComfyUIAdapter init error:', err);
  });

  // Register Phase 4 Step 9 Real IOPaint Adapter
  const ioPaintAdapter = new IOPaintAdapter();
  ioPaintAdapter.initialize().then(() => {
    adapterRegistry.register(ioPaintAdapter);
  }).catch((err) => {
    console.error('[Main] IOPaintAdapter init error:', err);
  });

  // Register Phase 4 Step 10 Real OmniVoice Adapter
  const omniVoiceAdapter = new OmniVoiceAdapter();
  omniVoiceAdapter.initialize().then(() => {
    adapterRegistry.register(omniVoiceAdapter);
  }).catch((err) => {
    console.error('[Main] OmniVoiceAdapter init error:', err);
  });

  // Register Phase 4 Step 11 Real Handy Adapter
  const handyAdapter = new HandyAdapter();
  handyAdapter.initialize().then(() => {
    adapterRegistry.register(handyAdapter);
  }).catch((err) => {
    console.error('[Main] HandyAdapter init error:', err);
  });

  // Register Phase 4 Step 12 Real TradingAgents Adapter
  const tradingAgentsAdapter = new TradingAgentsAdapter();
  tradingAgentsAdapter.initialize().then(() => {
    adapterRegistry.register(tradingAgentsAdapter);
  }).catch((err) => {
    console.error('[Main] TradingAgentsAdapter init error:', err);
  });

  // Register Phase 4 Step 13 Real MiroFish Adapter
  const miroFishAdapter = new MiroFishAdapter();
  miroFishAdapter.initialize().then(() => {
    adapterRegistry.register(miroFishAdapter);
  }).catch((err) => {
    console.error('[Main] MiroFishAdapter init error:', err);
  });

  // Register Phase 4 Step 14 Real HeyGem Adapter
  const heygemAdapter = new HeyGemAdapter();
  heygemAdapter.initialize().then(() => {
    adapterRegistry.register(heygemAdapter);
  }).catch((err) => {
    console.error('[Main] HeyGemAdapter init error:', err);
  });

  // Register Phase 4 Step 15 Real CapCut CLI Adapter
  const capcutAdapter = new CapCutAdapter();
  capcutAdapter.initialize().then(() => {
    adapterRegistry.register(capcutAdapter);
  }).catch((err) => {
    console.error('[Main] CapCutAdapter init error:', err);
  });

  // Register Phase 4 Step 16 Real VoiceStudio Adapter
  const voiceStudioAdapter = new VoiceStudioAdapter();
  voiceStudioAdapter.initialize().then(() => {
    adapterRegistry.register(voiceStudioAdapter);
  }).catch((err) => {
    console.error('[Main] VoiceStudioAdapter init error:', err);
  });

  // Register Phase 4 Step 17 Real DramaClaw Adapter
  const dramaClawAdapter = new DramaClawAdapter();
  dramaClawAdapter.initialize().then(() => {
    adapterRegistry.register(dramaClawAdapter);
  }).catch((err) => {
    console.error('[Main] DramaClawAdapter init error:', err);
  });

  console.log('[JARVIS] AdapterRegistry READY');
  console.log('[JARVIS] CommandRouter READY');

  // ── PHASE 4: IPC Registration ──
  console.log('[JARVIS] Registering IPC handlers...');
  registerIPC(dbInfo);
  console.log('[JARVIS] IPC READY');

  // ── PHASE 5: Window ──
  createWindow();
  registerGlobalHotkeys();
  createTray();
  console.log('[JARVIS] Window READY');

  // Emit system.ready event on startup
  eventBus.emit(
    eventBus.createEvent({
      type: 'system.ready',
      category: 'SYSTEM',
      source: 'ElectronMain',
      payload: { dbPath: dbInfo.dbPath, version: app.getVersion() },
    })
  );

  console.log('[JARVIS] JARVIS ONLINE');
}

function registerIPC(dbInfo: { dbPath: string; count: number }) {
  // ── Command Router & Workspace State IPC Channels ──
  ipcMain.handle('command:send', async (_e, request) => {
    return await commandRouter.handleCommand(request);
  });
  ipcMain.handle('command:stop-all', async () => {
    return await commandRouter.handleCommand({ source: 'SYSTEM', text: 'stop' });
  });
  ipcMain.handle('omniroute:check-status', async () => {
    const OMNIROUTE_ENDPOINT = 'http://localhost:20128';
    try {
      const res = await fetch(`${OMNIROUTE_ENDPOINT}/v1/models`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        return { reachable: true, endpoint: OMNIROUTE_ENDPOINT, error: null };
      }
      return { reachable: false, endpoint: OMNIROUTE_ENDPOINT, error: `HTTP ${res.status}` };
    } catch (err: any) {
      return { reachable: false, endpoint: OMNIROUTE_ENDPOINT, error: err?.message || 'Connection refused' };
    }
  });
  ipcMain.handle('workspace:get-active', () => {
    const row = getDatabase().prepare('SELECT value FROM settings WHERE key = ?').get('active_workspace') as { value: string } | undefined;
    return row?.value ?? 'COMMAND_CENTER';
  });
  ipcMain.handle('workspace:set-active', (_e, workspace: WorkspaceType) => {
    getDatabase().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('active_workspace', workspace);
    eventBus.emit(
      eventBus.createEvent({
        type: 'workspace.changed',
        category: 'SYSTEM',
        source: 'UserInterface',
        workspace,
        payload: { workspace },
      })
    );
    return true;
  });

  // ── Mission & Task Engine IPC Channels ──
  ipcMain.handle('mission:list', () => {
    return missionManager.listMissions(50);
  });
  ipcMain.handle('mission:get', (_e, missionId: string) => {
    return missionManager.getMission(missionId);
  });
  ipcMain.handle('mission:cancel', (_e, payload: { missionId: string; reason?: string }) => {
    return commandRouter.cancelMission(payload.missionId, payload.reason);
  });
  ipcMain.handle('task:get-graph', (_e, missionId: string) => {
    return taskGraphEngine.getGraph(missionId);
  });

  // ── Phase 4 Adapter Infrastructure IPC Channels ──
  ipcMain.handle('adapter:list', () => {
    return adapterRegistry.getAllInfo();
  });

  ipcMain.handle('adapter:check-all', async () => {
    return await adapterHealth.checkAll();
  });

  ipcMain.handle('adapter:status', (_e, adapterId: string) => {
    const info = adapterRegistry.getInfo(adapterId);
    if (!info) return null;
    const health = adapterHealth.getHealth(adapterId);
    return {
      ...info,
      healthy: health ? health.healthy : false,
      latencyMs: health ? health.latencyMs : null,
      lastHealthCheck: health ? health.lastCheckedAt : info.lastHealthCheck,
    };
  });

  ipcMain.handle('adapter:enable', (_e, adapterId: string) => {
    if (!adapterId || typeof adapterId !== 'string') {
      return { success: false, adapterId: '', enabled: false, error: 'INVALID_ADAPTER_ID' };
    }
    if (!adapterRegistry.has(adapterId)) {
      return { success: false, adapterId, enabled: false, error: 'ADAPTER_NOT_FOUND' };
    }
    featureFlags.setAdapterEnabled(adapterId, true);
    return { success: true, adapterId, enabled: true };
  });

  ipcMain.handle('adapter:disable', (_e, adapterId: string) => {
    if (!adapterId || typeof adapterId !== 'string') {
      return { success: false, adapterId: '', enabled: false, error: 'INVALID_ADAPTER_ID' };
    }
    if (!adapterRegistry.has(adapterId)) {
      return { success: false, adapterId, enabled: false, error: 'ADAPTER_NOT_FOUND' };
    }
    featureFlags.setAdapterEnabled(adapterId, false);
    return { success: true, adapterId, enabled: false };
  });

  ipcMain.handle('adapter:execute', async (_e, input: { adapterId: string; capability?: string; missionId?: string; taskId?: string; payload?: Record<string, any> }) => {
    if (!input || !input.adapterId || typeof input.adapterId !== 'string') {
      return { success: false, executionId: '', adapterId: input?.adapterId || '', error: 'INVALID_ADAPTER_ID' };
    }

    if (!adapterRegistry.has(input.adapterId)) {
      return { success: false, executionId: '', adapterId: input.adapterId, error: 'ADAPTER_NOT_FOUND' };
    }

    if (!featureFlags.isAdapterEnabled(input.adapterId)) {
      return { success: false, executionId: '', adapterId: input.adapterId, error: 'ADAPTER_DISABLED' };
    }

    const adapter = adapterRegistry.get(input.adapterId);
    if (!adapter) {
      return { success: false, executionId: '', adapterId: input.adapterId, error: 'ADAPTER_NOT_FOUND' };
    }

    if (input.capability) {
      const caps = adapter.getCapabilities();
      const hasCap = caps.some((c) => c.id === input.capability);
      if (!hasCap) {
        return { success: false, executionId: '', adapterId: input.adapterId, error: 'CAPABILITY_UNAVAILABLE' };
      }
    }

    const executionInput = {
      executionId: `exec_${input.adapterId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      adapterId: input.adapterId,
      capability: input.capability || 'default',
      missionId: input.missionId,
      taskId: input.taskId,
      payload: input.payload || {},
      timestamp: new Date().toISOString(),
    };

    return await adapterRegistry.execute(input.adapterId, executionInput);
  });

  ipcMain.handle('adapter:cancel', async (_e, payload: { adapterId: string; executionId: string }) => {
    if (!payload || !payload.adapterId || !payload.executionId) {
      return { success: false, adapterId: payload?.adapterId || '', executionId: payload?.executionId || '', error: 'INVALID_CANCEL_PAYLOAD' };
    }

    if (!adapterRegistry.has(payload.adapterId)) {
      return { success: false, adapterId: payload.adapterId, executionId: payload.executionId, error: 'ADAPTER_NOT_FOUND' };
    }

    try {
      await adapterRegistry.cancel(payload.adapterId, payload.executionId);
      return { success: true, adapterId: payload.adapterId, executionId: payload.executionId };
    } catch (err: any) {
      return { success: false, adapterId: payload.adapterId, executionId: payload.executionId, error: err?.message || String(err) };
    }
  });

  // ── Site Generation Pipeline (Deliverable 7) ──
  ipcMain.handle('site:generate', async (event, payload: { prompt: string; provider: string; modelName: string }) => {
    return await generateSitePipeline(
      payload.prompt,
      payload.provider,
      payload.modelName,
      (status) => event.sender.send('site:status-update', status)
    );
  });

  ipcMain.handle('site:export-zip', async (_e, siteId: string) => {
    return await exportSiteAsZip(siteId);
  });

  ipcMain.handle('site:compute-diff', (_e, payload: { filePath: string; oldCode: string; newCode: string }) => {
    return computeLineDiff(payload.filePath, payload.oldCode, payload.newCode);
  });

  ipcMain.handle('site:restart', async (_e, slug: string) => {
    const active = await restartProjectServers(slug);
    return { success: !!active, previewUrl: active?.frontendUrl };
  });

  ipcMain.handle('site:stop', async (_e, slug: string) => {
    return await stopProjectServers(slug);
  });

  ipcMain.handle('site:launch-chrome', async (_e, url: string) => {
    return await launchInChrome(url);
  });

  // ── Phase 2 Model Gateway IPC ──
  ipcMain.handle('model:list', () => modelGateway.listModels());
  ipcMain.handle('model:assign-role', (_e, payload: { role: any; modelId: string }) => modelGateway.assignRoleModel(payload.role, payload.modelId));

  // ── Phase 3 Unified Tool Registry IPC ──
  ipcMain.handle('tool:list-unified', () => unifiedToolRegistry.listTools());
  ipcMain.handle('tool:execute-unified', async (_e, payload: { toolId: string; args: Record<string, any> }) => unifiedToolRegistry.execute(payload.toolId, payload.args));

  // ── Phase 6 Computer Control IPC ──
  ipcMain.handle('computer:launch-app', async (_e, name: string) => computerControl.launchApplication(name));
  ipcMain.handle('computer:screenshot', async () => computerControl.captureScreen());

  // ── Phase 7 Project Intelligence IPC ──
  ipcMain.handle('project:inspect', async (_e, dirPath: string) => projectIntelligence.inspectProject(dirPath));

  // ── Phase 8 Autonomous Dev Engine IPC ──
  ipcMain.handle('dev:execute-task', async (_e, payload: { projectDir: string; taskDescription: string }) => autonomousDevEngine.executeTask(payload.projectDir, payload.taskDescription));

  // ── Settings ──
  ipcMain.handle('settings:get-active-provider', () => {
    const row = getDatabase().prepare('SELECT value FROM settings WHERE key = ?').get('active_provider') as { value: string } | undefined;
    return row?.value ?? null;
  });
  ipcMain.handle('settings:set-active-provider', (_e, provider: string) => {
    getDatabase().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('active_provider', provider);
    return true;
  });

  ipcMain.handle('settings:get-theme', () => {
    const row = getDatabase().prepare('SELECT value FROM settings WHERE key = ?').get('theme') as { value: string } | undefined;
    return row?.value ?? 'cyan';
  });
  ipcMain.handle('settings:set-theme', (_e, theme: string) => {
    getDatabase().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('theme', theme);
    return true;
  });

  ipcMain.handle('settings:get-tts-enabled', () => {
    const row = getDatabase().prepare('SELECT value FROM settings WHERE key = ?').get('tts_enabled') as { value: string } | undefined;
    return row ? row.value === 'true' : true;
  });
  ipcMain.handle('settings:set-tts-enabled', (_e, enabled: boolean) => {
    getDatabase().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('tts_enabled', enabled ? 'true' : 'false');
    return true;
  });

  ipcMain.handle('settings:get-tool-confirmations', () => getToolConfirmationSettings());
  ipcMain.handle('settings:set-tool-confirmation', (_e, toolName: keyof ToolConfirmationSettings, mode: ToolConfirmationMode) => {
    setToolConfirmationSetting(toolName, mode);
    return true;
  });

  // ── Confirmation Resolution ──
  ipcMain.on('tool:respond-confirmation', (_e, payload: { callId: string; allowed: boolean }) => {
    resolveConfirmation(payload.callId, payload.allowed);
  });

  // ── Audit Logs ──
  ipcMain.handle('audit:get-logs', () => getAuditLogs(100));
  ipcMain.handle('audit:clear-logs', () => {
    clearAuditLogs();
    return true;
  });

  // ── Tool Direct Execution ──
  ipcMain.handle('tool:execute-direct', (_e, toolName: string, args: Record<string, any>) => executeTool(toolName, args));

  // ── TTS & Voice Output Router Service (Phase 21) ──
  ipcMain.handle('tts:speak', async (_e, text: string) => {
    try {
      const cleanText = text
        .replace(/```[\s\S]*?```/g, 'Code block omitted.')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/[*_#~]/g, '')
        .trim();

      if (!cleanText) return { success: true };
      return await voiceOutputService.speak(cleanText);
    } catch (err: any) {
      console.error('[TTS] Error speaking text:', err?.message || err);
      return { success: false, error: err?.message || 'TTS engine failed' };
    }
  });

  ipcMain.handle('tts:stop', () => {
    voiceOutputService.stop();
    return true;
  });

  // ── Voice Input & Output Service IPC Channels (Phase 21) ──
  ipcMain.handle('voice:input-status', async () => {
    return await voiceInputService.getStatus();
  });

  ipcMain.handle('voice:output-status', () => {
    return voiceOutputService.getStatus();
  });

  ipcMain.handle('voice:set-listening', (_e, listening: boolean) => {
    voiceInputService.setListeningState(Boolean(listening));
    return true;
  });


  // ── Key Vault ──
  ipcMain.handle('vault:save-key', (_e, provider: Provider, key: string) => {
    saveApiKey(provider, key);
    return true;
  });
  ipcMain.handle('vault:delete-key', (_e, provider: Provider) => {
    deleteApiKey(provider);
    return true;
  });
  ipcMain.handle('vault:list-providers', () => listStoredProviders());
  ipcMain.handle('vault:has-key', (_e, provider: Provider) => {
    try { return getApiKey(provider) !== null; } catch { return false; }
  });

  // ── LLM Streaming ──
  ipcMain.handle('llm:stream-chat', async (event, payload: {
    provider: Provider;
    model: string;
    messages: ChatMessage[];
  }) => {
    const { provider, model, messages } = payload;
    let apiKey: string | null = null;

    try {
      apiKey = getApiKey(provider);
    } catch (err) {
      return { error: `Key decryption failed for ${provider}.` };
    }

    if (!apiKey) return { error: `No API key configured for ${provider}. Add one in Settings.` };

    await streamChat(provider, apiKey, model || DEFAULT_MODELS[provider], messages, SYSTEM_PROMPT, (chunk) => {
      event.sender.send('llm:stream-chunk', chunk);
    });

    return { success: true };
  });

  // ── Chat Memory in SQLite ──
  ipcMain.handle('memory:save-message', (_e, sessionId: string, role: string, content: string) => {
    getDatabase().prepare('INSERT INTO conversation_memory (session_id, role, content) VALUES (?, ?, ?)').run(sessionId, role, content);
    return true;
  });
  ipcMain.handle('memory:get-session', (_e, sessionId: string) => {
    return getDatabase().prepare('SELECT role, content FROM conversation_memory WHERE session_id = ? ORDER BY id ASC').all(sessionId);
  });
  ipcMain.handle('memory:clear-session', (_e, sessionId: string) => {
    getDatabase().prepare('DELETE FROM conversation_memory WHERE session_id = ?').run(sessionId);
    return true;
  });

  // ── Dev/Debug ──
  ipcMain.handle('test-sqlite', () => dbInfo);
  ipcMain.handle('get-app-version', () => app.getVersion());

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}

app.whenReady().then(bootstrap);

app.on('will-quit', () => {
  stopOmniRoute();
  stopSpeaking();
  globalShortcut.unregisterAll();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// Window controls
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
ipcMain.on('window-close', () => mainWindow?.close());
ipcMain.on('window-toggle', () => mainWindow?.isVisible() ? mainWindow.hide() : (mainWindow?.show(), mainWindow?.focus()));
