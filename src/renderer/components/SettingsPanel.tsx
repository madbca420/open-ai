import React, { useState, useEffect } from 'react';
import { Shield, Eye, EyeOff, CheckCircle, XCircle, Trash2, ChevronDown, Volume2, VolumeX, Terminal, Lock, RefreshCw, FileText, Cpu, Activity, Play, Power, AlertTriangle } from 'lucide-react';
import { useAppStore, Provider } from '../store';
import { AuditLogEntry, ToolConfirmationSettings, ToolConfirmationMode } from '../../main/preload';

const PROVIDERS: { id: Provider; label: string; placeholder: string }[] = [
  { id: 'anthropic', label: 'Anthropic Claude', placeholder: 'sk-ant-api03-...' },
  { id: 'openai',    label: 'OpenAI GPT',       placeholder: 'sk-proj-...' },
  { id: 'google',    label: 'Google Gemini',     placeholder: 'AIzaSy...' },
  { id: 'ollama',    label: 'Ollama (Local AI)', placeholder: 'http://localhost:11434 (No key required)' },
  { id: 'omniroute', label: 'OmniRoute Gateway', placeholder: 'OmniRoute Gateway Token' },
];

const MODELS: Record<Provider, { id: string; label: string }[]> = {
  anthropic: [
    { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-5-haiku-20241022',  label: 'Claude 3.5 Haiku (Fast)' },
    { id: 'claude-3-opus-20240229',     label: 'Claude 3 Opus (Powerful)' },
  ],
  openai: [
    { id: 'gpt-4o',      label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini (Fast)' },
    { id: 'nvidia/nemotron-3-ultra', label: 'NVIDIA Nemotron 3 Ultra' },
    { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  ],
  google: [
    { id: 'gemini-1.5-flash',   label: 'Gemini 1.5 Flash (Fast)' },
    { id: 'gemini-1.5-pro',     label: 'Gemini 1.5 Pro' },
    { id: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash Exp' },
  ],
  ollama: [
    { id: 'llama3:latest', label: 'Llama 3 (Local)' },
    { id: 'deepseek-r1:latest', label: 'DeepSeek R1 (Local)' },
  ],
  omniroute: [
    { id: 'oxalpha', label: 'OxAlpha (Primary Coding / Dev)' },
    { id: 'dots3-note', label: 'Dots3-Note Preview (Analysis / Planning)' },
    { id: 'nvidia/nemotron-3-ultra', label: 'NVIDIA Nemotron 3 Ultra (Code Review)' },
    { id: 'lfm2.5-embedding-350m', label: 'LFM2.5-Embedding-350M (Memory / RAG)' },
    { id: 'auto', label: 'OmniRoute Auto Router' },
  ],
};

export default function SettingsPanel() {
  const {
    providers, setProviders, activeProvider, setActiveProvider,
    activeModel, setActiveModel, ttsEnabled, setTtsEnabled,
  } = useAppStore();

  const [keyInputs, setKeyInputs] = useState<Record<Provider, string>>({ anthropic: '', openai: '', google: '', ollama: '', omniroute: '' });
  const [showKey, setShowKey] = useState<Record<Provider, boolean>>({ anthropic: false, openai: false, google: false, ollama: false, omniroute: false });
  const [saving, setSaving] = useState<Record<Provider, 'idle' | 'saving' | 'ok' | 'err'>>({ anthropic: 'idle', openai: 'idle', google: 'idle', ollama: 'idle', omniroute: 'idle' });
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Tool Confirmations, Audit Logs & Adapters
  const [toolConfirmations, setToolConfirmations] = useState<ToolConfirmationSettings>({
    open_application: 'always',
    focus_window: 'always',
    write_clipboard: 'always',
    run_shell_command: 'always',
  });
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [adaptersList, setAdaptersList] = useState<any[]>([]);
  const [selectedAdapter, setSelectedAdapter] = useState<any | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [activeTab, setActiveTab] = useState<'security' | 'tools' | 'adapters' | 'audit'>('security');


  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const refreshProviders = async () => {
    if (!window.electronAPI) return;
    const list = await window.electronAPI.listProviders();
    setProviders(list);
  };

  const refreshAuditLogs = async () => {
    if (!window.electronAPI) return;
    const logs = await window.electronAPI.getAuditLogs();
    setAuditLogs(logs);
  };

  const refreshToolConfirmations = async () => {
    if (!window.electronAPI) return;
    const confs = await window.electronAPI.getToolConfirmations();
    setToolConfirmations(confs);
  };

  const refreshAdapters = async () => {
    if (!window.electronAPI) return;
    try {
      const list = await window.electronAPI.listAdapters();
      setAdaptersList(list);
    } catch {
      showToast('Failed to load adapters list', 'error');
    }
  };

  const handleCheckAllHealth = async () => {
    if (!window.electronAPI || checkingHealth) return;
    setCheckingHealth(true);
    showToast('Running real health checks for all registered adapters...');
    try {
      await window.electronAPI.checkAllAdapters();
      await refreshAdapters();
      showToast('Adapter health check complete.');
    } catch {
      showToast('Failed to complete health check', 'error');
    } finally {
      setCheckingHealth(false);
    }
  };

  const handleToggleAdapter = async (adapterId: string, currentEnabled: boolean) => {
    if (!window.electronAPI) return;
    try {
      if (currentEnabled) {
        await window.electronAPI.disableAdapter(adapterId);
        showToast(`Disabled adapter "${adapterId}"`);
      } else {
        await window.electronAPI.enableAdapter(adapterId);
        showToast(`Enabled adapter "${adapterId}"`);
      }
      await refreshAdapters();
    } catch {
      showToast(`Failed to toggle adapter "${adapterId}"`, 'error');
    }
  };

  useEffect(() => {
    if (!window.electronAPI) return;
    refreshProviders();
    refreshToolConfirmations();
    refreshAuditLogs();
    refreshAdapters();


    window.electronAPI.getActiveProvider()?.then((p) => {
      if (p) {
        setActiveProvider(p);
        const firstModel = MODELS[p][0].id;
        setActiveModel(activeModel || firstModel);
      }
    });
    window.electronAPI.getTtsEnabled()?.then((enabled) => {
      setTtsEnabled(enabled);
    });
  }, []);

  const handleToggleTts = async () => {
    const next = !ttsEnabled;
    setTtsEnabled(next);
    if (window.electronAPI) await window.electronAPI.setTtsEnabled(next);
    showToast(next ? 'Voice output (TTS) enabled.' : 'Voice output (TTS) disabled.');
  };

  const handleToggleToolConfirmation = async (toolName: keyof ToolConfirmationSettings) => {
    if (!window.electronAPI) {
      showToast('Tool confirmations require Electron desktop mode.', 'error');
      return;
    }
    if (toolName === 'run_shell_command') {
      showToast('run_shell_command is locked to ALWAYS CONFIRM for security.', 'error');
      return;
    }
    const currentMode = toolConfirmations[toolName];
    const newMode: ToolConfirmationMode = currentMode === 'always' ? 'once_per_session' : 'always';

    await window.electronAPI.setToolConfirmation(toolName, newMode);
    await refreshToolConfirmations();
    showToast(`Confirmation for ${toolName} set to "${newMode}".`);
  };

  const handleClearAuditLogs = async () => {
    if (!window.electronAPI) { showToast('Requires Electron desktop mode.', 'error'); return; }
    await window.electronAPI.clearAuditLogs();
    await refreshAuditLogs();
    showToast('Audit log cleared.');
  };

  const handleSaveKey = async (provider: Provider) => {
    const key = keyInputs[provider].trim();
    if (!key) return;

    setSaving((s) => ({ ...s, [provider]: 'saving' }));
    try {
      if (window.electronAPI) {
        await window.electronAPI.saveKey(provider, key);
        await refreshProviders();
      } else {
        localStorage.setItem(`jarvis_key_${provider}`, key);
        setProviders(providers.map(p => p.provider === provider ? { ...p, hasKey: true } : p));
      }
      setKeyInputs((s) => ({ ...s, [provider]: '' }));
      setSaving((s) => ({ ...s, [provider]: 'ok' }));
      showToast(`${PROVIDERS.find(p => p.id === provider)?.label} key saved.`);
    } catch {
      setSaving((s) => ({ ...s, [provider]: 'err' }));
      showToast('Failed to save key.', 'error');
    }
    setTimeout(() => setSaving((s) => ({ ...s, [provider]: 'idle' })), 2000);
  };

  const handleDeleteKey = async (provider: Provider) => {
    if (window.electronAPI) {
      await window.electronAPI.deleteKey(provider);
      await refreshProviders();
      if (activeProvider === provider) {
        setActiveProvider(null);
        await window.electronAPI.setActiveProvider(null as any);
      }
    } else {
      localStorage.removeItem(`jarvis_key_${provider}`);
      setProviders(providers.map(p => p.provider === provider ? { ...p, hasKey: false } : p));
      if (activeProvider === provider) setActiveProvider(null);
    }
    showToast(`${PROVIDERS.find(p => p.id === provider)?.label} key removed.`);
  };

  const handleSelectProvider = async (provider: Provider) => {
    const hasKey = providers.find(p => p.provider === provider)?.hasKey || provider === 'ollama';
    if (!hasKey) {
      showToast('Add an API key for this provider first.', 'error');
      return;
    }
    setActiveProvider(provider);
    if (window.electronAPI) {
      await window.electronAPI.setActiveProvider(provider);
    }
    const defaultModel = MODELS[provider]?.[0]?.id || 'auto';
    setActiveModel(defaultModel);
    showToast(`Active provider set to ${PROVIDERS.find(p => p.id === provider)?.label}`);
  };

  return (
    <div className="flex flex-col h-full overflow-auto p-4 space-y-4 font-mono relative">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg text-xs font-mono shadow-glow transition-all
          ${toast.type === 'success' ? 'bg-theme-primary/20 border border-theme-primary text-theme-accent' : 'bg-red-900/40 border border-red-500 text-red-300'}`}>
          {toast.msg}
        </div>
      )}

      {/* Sub-Navigation Tabs */}
      <div className="flex items-center space-x-2 border-b border-theme-border pb-2">
        <button
          onClick={() => setActiveTab('security')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5
            ${activeTab === 'security' ? 'bg-theme-primary/20 text-theme-primary border border-theme-primary' : 'text-theme-muted hover:text-theme-text'}`}
        >
          <Shield className="w-3.5 h-3.5" />
          <span>SECURITY & KEYS</span>
        </button>
        <button
          onClick={() => setActiveTab('tools')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5
            ${activeTab === 'tools' ? 'bg-theme-primary/20 text-theme-primary border border-theme-primary' : 'text-theme-muted hover:text-theme-text'}`}
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>TOOL CONFIRMATIONS</span>
        </button>
        <button
          onClick={() => { setActiveTab('adapters'); refreshAdapters(); }}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5
            ${activeTab === 'adapters' ? 'bg-theme-primary/20 text-theme-primary border border-theme-primary' : 'text-theme-muted hover:text-theme-text'}`}
        >
          <Cpu className="w-3.5 h-3.5" />
          <span>ADAPTER CONTROL CENTER ({adaptersList.length})</span>
        </button>
        <button
          onClick={() => { setActiveTab('audit'); refreshAuditLogs(); }}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5
            ${activeTab === 'audit' ? 'bg-theme-primary/20 text-theme-primary border border-theme-primary' : 'text-theme-muted hover:text-theme-text'}`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>AUDIT LOG ({auditLogs.length})</span>
        </button>
      </div>


      {/* TAB 1: SECURITY & KEYS */}
      {activeTab === 'security' && (
        <div className="space-y-5">
          {/* Voice Output (TTS) Toggle */}
          <div className="p-3 rounded-lg glass-panel border border-theme-border flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {ttsEnabled
                ? <Volume2 className="w-5 h-5 text-theme-success" />
                : <VolumeX className="w-5 h-5 text-theme-muted" />}
              <div>
                <div className="text-xs font-bold text-theme-text">Voice Output (Text-To-Speech)</div>
                <div className="text-[11px] text-theme-muted">
                  {ttsEnabled ? 'Assistant will speak completed responses via Windows SAPI' : 'Voice output disabled (Text response only)'}
                </div>
              </div>
            </div>
            <button
              onClick={handleToggleTts}
              className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all flex items-center space-x-1.5
                ${ttsEnabled
                  ? 'border-theme-success bg-theme-success/20 text-theme-accent glow-border'
                  : 'border-theme-border bg-black/40 text-theme-muted hover:text-theme-text'}`}
            >
              <span>{ttsEnabled ? 'VOICE ON' : 'VOICE OFF'}</span>
            </button>
          </div>

          {/* Active Provider Selector */}
          <div className="p-3 rounded-lg glass-panel border border-theme-border space-y-2">
            <div className="text-[11px] text-theme-muted uppercase tracking-wider mb-2">Active Provider (Required)</div>
            <div className="grid grid-cols-3 gap-2">
              {PROVIDERS.map(({ id, label }) => {
                const hasKey = providers.find(p => p.provider === id)?.hasKey;
                const isActive = activeProvider === id;
                return (
                  <button
                    key={id}
                    onClick={() => handleSelectProvider(id)}
                    className={`py-2 px-3 rounded-lg text-[11px] border transition-all text-left flex items-center space-x-1.5
                      ${isActive ? 'border-theme-primary bg-theme-primary/20 text-theme-accent glow-border' : 'border-theme-border hover:border-theme-primary/50 text-theme-muted hover:text-theme-text'}
                      ${!hasKey ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                    disabled={!hasKey}
                    title={!hasKey ? 'Add an API key first' : undefined}
                  >
                    {isActive ? <CheckCircle className="w-3 h-3 text-theme-success flex-shrink-0" /> : <div className="w-3 h-3 rounded-full border border-theme-muted flex-shrink-0" />}
                    <span className="truncate">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Model Selector */}
          {activeProvider && (
            <div className="p-3 rounded-lg glass-panel border border-theme-border space-y-2">
              <div className="text-[11px] text-theme-muted uppercase tracking-wider mb-2">Active Model</div>
              <div className="relative">
                <select
                  value={activeModel}
                  onChange={(e) => setActiveModel(e.target.value)}
                  className="w-full bg-black/60 border border-theme-border rounded text-xs text-theme-text p-2 pr-8 appearance-none focus:border-theme-primary focus:outline-none"
                >
                  {MODELS[activeProvider].map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-2.5 w-3.5 h-3.5 text-theme-muted pointer-events-none" />
              </div>
            </div>
          )}

          {/* API Keys */}
          <div className="space-y-3">
            <div className="text-[11px] text-theme-muted uppercase tracking-wider">API Keys (Encrypted AES-256-GCM)</div>
            {PROVIDERS.map(({ id, label, placeholder }) => {
              const entry = providers.find(p => p.provider === id);
              const hasKey = entry?.hasKey ?? false;
              const st = saving[id];
              return (
                <div key={id} className="p-3 rounded-lg bg-black/40 border border-theme-border/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-theme-text">{label}</span>
                    <div className="flex items-center space-x-1.5">
                      {hasKey && <span title="Key stored"><CheckCircle className="w-3.5 h-3.5 text-theme-success" /></span>}
                      {!hasKey && <span title="No key"><XCircle className="w-3.5 h-3.5 text-theme-muted" /></span>}
                      <span className={`text-[11px] ${hasKey ? 'text-theme-success' : 'text-theme-muted'}`}>
                        {hasKey ? 'CONFIGURED' : 'NOT SET'}
                      </span>
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <div className="relative flex-1">
                      <input
                        type={showKey[id] ? 'text' : 'password'}
                        value={keyInputs[id]}
                        onChange={(e) => setKeyInputs((s) => ({ ...s, [id]: e.target.value }))}
                        placeholder={hasKey ? '••••••••• (enter to overwrite)' : placeholder}
                        className="w-full bg-black/60 border border-theme-border rounded text-[11px] text-theme-text px-2 py-1.5 pr-8 focus:border-theme-primary focus:outline-none font-mono"
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveKey(id)}
                      />
                      <button
                        onClick={() => setShowKey((s) => ({ ...s, [id]: !s[id] }))}
                        className="absolute right-2 top-1.5 text-theme-muted hover:text-theme-text"
                      >
                        {showKey[id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <button
                      onClick={() => handleSaveKey(id)}
                      disabled={!keyInputs[id].trim() || st === 'saving'}
                      className={`px-3 py-1.5 rounded text-[11px] border transition-all
                        ${st === 'ok' ? 'border-theme-success text-theme-success' : st === 'err' ? 'border-red-500 text-red-400' : 'border-theme-primary text-theme-primary hover:bg-theme-primary/10'}
                        disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      {st === 'saving' ? '...' : st === 'ok' ? '✓' : st === 'err' ? '✗' : 'Save'}
                    </button>
                    {hasKey && (
                      <button
                        onClick={() => handleDeleteKey(id)}
                        className="p-1.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-all"
                        title="Remove key"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: TOOL CONFIRMATION GATING SETTINGS */}
      {activeTab === 'tools' && (
        <div className="space-y-4">
          <div className="text-xs text-theme-muted">
            Configure safety confirmation gates for system automation tools.
          </div>

          <div className="space-y-2.5">
            {/* run_shell_command (LOCKED) */}
            <div className="p-3 rounded-lg border border-red-500/50 bg-red-950/20 flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold text-red-400">run_shell_command</span>
                  <span title="Locked to Always Confirm"><Lock className="w-3.5 h-3.5 text-red-400" /></span>
                  <span className="px-1.5 py-0.2 text-[10px] rounded bg-red-500/20 text-red-300 font-bold">LOCKED</span>
                </div>
                <div className="text-[11px] text-theme-muted">
                  Executes PowerShell commands on user system. Always requires explicit confirmation.
                </div>
              </div>
              <button
                disabled
                className="px-3 py-1.5 rounded border border-red-500/40 bg-red-900/30 text-red-300 text-xs font-bold opacity-80 cursor-not-allowed"
              >
                ALWAYS CONFIRM
              </button>
            </div>

            {/* open_application */}
            <div className="p-3 rounded-lg border border-theme-border glass-panel flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-theme-text">open_application</span>
                <div className="text-[11px] text-theme-muted">
                  Launches or opens desktop applications by name or command.
                </div>
              </div>
              <button
                onClick={() => handleToggleToolConfirmation('open_application')}
                className={`px-3 py-1.5 rounded border text-xs font-bold transition-all
                  ${toolConfirmations.open_application === 'always'
                    ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                    : 'border-theme-primary bg-theme-primary/20 text-theme-accent'}`}
              >
                {toolConfirmations.open_application === 'always' ? 'ALWAYS CONFIRM' : 'ONCE PER SESSION'}
              </button>
            </div>

            {/* focus_window */}
            <div className="p-3 rounded-lg border border-theme-border glass-panel flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-theme-text">focus_window</span>
                <div className="text-[11px] text-theme-muted">
                  Brings specified window to front.
                </div>
              </div>
              <button
                onClick={() => handleToggleToolConfirmation('focus_window')}
                className={`px-3 py-1.5 rounded border text-xs font-bold transition-all
                  ${toolConfirmations.focus_window === 'always'
                    ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                    : 'border-theme-primary bg-theme-primary/20 text-theme-accent'}`}
              >
                {toolConfirmations.focus_window === 'always' ? 'ALWAYS CONFIRM' : 'ONCE PER SESSION'}
              </button>
            </div>

            {/* write_clipboard */}
            <div className="p-3 rounded-lg border border-theme-border glass-panel flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-theme-text">write_clipboard</span>
                <div className="text-[11px] text-theme-muted">
                  Copies content to user system clipboard.
                </div>
              </div>
              <button
                onClick={() => handleToggleToolConfirmation('write_clipboard')}
                className={`px-3 py-1.5 rounded border text-xs font-bold transition-all
                  ${toolConfirmations.write_clipboard === 'always'
                    ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                    : 'border-theme-primary bg-theme-primary/20 text-theme-accent'}`}
              >
                {toolConfirmations.write_clipboard === 'always' ? 'ALWAYS CONFIRM' : 'ONCE PER SESSION'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* TAB 3: ADAPTER CONTROL CENTER */}
      {activeTab === 'adapters' && (
        <div className="space-y-4 flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between shrink-0">
            <div>
              <span className="text-xs font-bold text-theme-text uppercase tracking-wider">JARVIS Phase 4 Adapter Registry</span>
              <div className="text-[11px] text-theme-muted">
                {adaptersList.length} adapters registered | Enabled: {adaptersList.filter(a => a.enabled).length} | Ready: {adaptersList.filter(a => a.status === 'READY').length}
              </div>
            </div>
            <button
              onClick={handleCheckAllHealth}
              disabled={checkingHealth}
              className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all flex items-center space-x-1.5
                ${checkingHealth
                  ? 'border-theme-border bg-black/40 text-theme-muted cursor-not-allowed'
                  : 'border-theme-primary bg-theme-primary/20 text-theme-accent hover:bg-theme-primary/30 glow-border'}`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checkingHealth ? 'animate-spin' : ''}`} />
              <span>{checkingHealth ? 'CHECKING...' : 'CHECK ALL HEALTH'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 overflow-y-auto max-h-[500px] pr-1">
            {adaptersList.map((adapter) => {
              const isSelected = selectedAdapter?.id === adapter.id;
              const isReady = adapter.status === 'READY';
              const isDisabled = !adapter.enabled || adapter.status === 'DISABLED';

              return (
                <div
                  key={adapter.id}
                  onClick={() => setSelectedAdapter(isSelected ? null : adapter)}
                  className={`p-3 rounded-lg border transition-all cursor-pointer space-y-2.5 glass-panel
                    ${isSelected ? 'border-theme-primary bg-theme-primary/10 glow-border' : 'border-theme-border hover:border-theme-primary/50'}`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold text-theme-text">{adapter.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/40 border border-theme-border/40 text-theme-muted uppercase">
                          {adapter.category}
                        </span>
                      </div>
                      <div className="text-[10px] text-theme-muted">ID: {adapter.id} | v{adapter.version}</div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleAdapter(adapter.id, adapter.enabled);
                      }}
                      className={`px-2 py-1 rounded text-[10px] font-bold border transition-all flex items-center space-x-1
                        ${adapter.enabled
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                          : 'border-theme-border bg-black/40 text-theme-muted hover:text-theme-text'}`}
                    >
                      <Power className="w-3 h-3" />
                      <span>{adapter.enabled ? 'ENABLED' : 'DISABLED'}</span>
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center space-x-1.5">
                      <span className={`w-2 h-2 rounded-full ${
                        isDisabled ? 'bg-zinc-500' : isReady ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                      }`} />
                      <span className={`font-bold ${
                        isDisabled ? 'text-theme-muted' : isReady ? 'text-emerald-400' : 'text-amber-400'
                      }`}>
                        ● {adapter.status}
                      </span>
                    </div>
                    {adapter.requiresGPU && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40">
                        GPU REQUIRED
                      </span>
                    )}
                  </div>

                  {adapter.lastError && (
                    <div className="p-2 rounded bg-red-950/40 border border-red-500/30 text-[10px] text-red-300 flex items-start space-x-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-red-400 mt-0.5" />
                      <span className="truncate">{adapter.lastError}</span>
                    </div>
                  )}

                  {/* Capabilities tags */}
                  <div className="flex flex-wrap gap-1 pt-1">
                    {(adapter.capabilities || []).map((cap: any) => (
                      <span key={cap.id} className="text-[9px] px-1.5 py-0.5 rounded bg-black/40 border border-theme-border/40 text-theme-accent">
                        • {cap.id}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Expanded Selected Adapter Detail Drawer */}
          {selectedAdapter && (
            <div className="p-3 rounded-lg border border-theme-primary/50 bg-theme-primary/5 space-y-2 text-[11px]">
              <div className="flex items-center justify-between border-b border-theme-border/40 pb-1.5">
                <span className="font-bold text-theme-accent">Adapter Details: {selectedAdapter.name} ({selectedAdapter.id})</span>
                <button
                  onClick={() => setSelectedAdapter(null)}
                  className="text-theme-muted hover:text-theme-text text-[10px]"
                >
                  ✕ CLOSE
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div><span className="text-theme-muted">Category:</span> {selectedAdapter.category}</div>
                <div><span className="text-theme-muted">Version:</span> {selectedAdapter.version}</div>
                <div><span className="text-theme-muted">Status:</span> {selectedAdapter.status}</div>
                <div><span className="text-theme-muted">Feature Flag:</span> {selectedAdapter.enabled ? 'ENABLED' : 'DISABLED'}</div>
              </div>

              {selectedAdapter.dependencies && selectedAdapter.dependencies.length > 0 && (
                <div>
                  <span className="text-theme-muted font-bold">Runtime Dependencies:</span>
                  <ul className="list-disc list-inside text-theme-text text-[10px] space-y-0.5 mt-0.5">
                    {selectedAdapter.dependencies.map((dep: string, i: number) => (
                      <li key={i}>{dep}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: AUDIT LOG VIEWER */}
      {activeTab === 'audit' && (

        <div className="space-y-3 flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between shrink-0">
            <span className="text-xs text-theme-muted">Local SQLite Audit Trail ({auditLogs.length} events logged)</span>
            <div className="flex items-center space-x-2">
              <button
                onClick={refreshAuditLogs}
                className="p-1 rounded border border-theme-border text-theme-muted hover:text-theme-text hover:border-theme-primary"
                title="Refresh audit log"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleClearAuditLogs}
                className="px-2 py-1 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 text-[11px]"
              >
                Clear Log
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto border border-theme-border rounded-lg glass-panel max-h-[450px]">
            {auditLogs.length === 0 ? (
              <div className="p-6 text-center text-theme-muted text-xs">No audit entries recorded yet.</div>
            ) : (
              <table className="w-full text-left text-[11px] border-collapse">
                <thead className="sticky top-0 bg-black/80 border-b border-theme-border text-theme-primary">
                  <tr>
                    <th className="p-2 border-r border-theme-border/40">ID</th>
                    <th className="p-2 border-r border-theme-border/40">Timestamp</th>
                    <th className="p-2 border-r border-theme-border/40">Action</th>
                    <th className="p-2 border-r border-theme-border/40">Details</th>
                    <th className="p-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-theme-border/20 font-mono">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-theme-primary/5 transition-colors">
                      <td className="p-2 text-theme-muted border-r border-theme-border/20">{log.id}</td>
                      <td className="p-2 text-theme-muted whitespace-nowrap border-r border-theme-border/20">{log.created_at}</td>
                      <td className="p-2 font-bold text-theme-text border-r border-theme-border/20">{log.action_type}</td>
                      <td className="p-2 text-theme-text truncate max-w-xs border-r border-theme-border/20" title={log.details}>
                        {log.details}
                      </td>
                      <td className="p-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase
                          ${log.status === 'CONFIRMED' || log.status === 'SUCCESS' || log.status === 'EXECUTED'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : log.status === 'DENIED' || log.status === 'FAILED'
                              ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'}`}>
                          {log.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
