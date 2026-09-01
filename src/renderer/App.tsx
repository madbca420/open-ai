import React, { useEffect, useState } from 'react';
import { File, Folder, ChevronDown, Check, AlertTriangle, Sparkles, Code2, ShieldCheck, CircleDashed, Cpu } from 'lucide-react';
import { useAppStore, Theme } from './store';
import SettingsPanel from './components/SettingsPanel';
import ChatPanel from './components/ChatPanel';
import RightAutomationPane from './components/RightAutomationPane';
import SiteGeneratorPanel from './components/SiteGeneratorPanel';
import NavigationHeader from './components/NavigationHeader';
import MissionBoard from './components/MissionBoard';

/* ── Reactor (Left Rail orb — Code Sanctum design) ── */
function Reactor({ status }: { status: string }) {
  const glowing = status === 'SPEAKING' || status === 'THINKING' || status === 'EXECUTING';
  return (
    <div className="relative flex items-center justify-center" style={{ width: 88, height: 88, flexShrink: 0 }}>
      {/* Outer ring */}
      <div
        className="absolute inset-0 rounded-full border anim-spin-slow"
        style={{ borderColor: 'var(--hud-line)' }}
      />
      {/* Mid ring — dashed, reverse */}
      <div
        className="absolute rounded-full border-2 border-dashed anim-spin-rev"
        style={{
          inset: 8,
          borderColor: 'color-mix(in srgb, var(--cyan) 45%, transparent)',
        }}
      />
      {/* Inner glow */}
      <div
        className="absolute rounded-full anim-pulse-soft"
        style={{
          inset: 26,
          background: 'radial-gradient(circle, var(--cyan), transparent 70%)',
        }}
      />
      {/* Core */}
      <div
        className="absolute rounded-full"
        style={{
          inset: 38,
          background: 'var(--cyan)',
          boxShadow: glowing
            ? '0 0 28px 10px var(--cyan), 0 0 50px 16px color-mix(in srgb, var(--cyan) 40%, transparent)'
            : '0 0 16px 4px var(--cyan)',
        }}
      />
    </div>
  );
}

/* ── System Performance Bar ── */
function Bar({ value, color = 'var(--cyan)' }: { value: number; color?: string }) {
  return (
    <div className="h-1.5 w-full rounded-none" style={{ background: 'color-mix(in srgb, var(--color-text) 10%, transparent)' }}>
      <div
        className="h-full transition-all duration-700"
        style={{ width: `${Math.max(2, Math.min(100, value))}%`, background: color, boxShadow: `0 0 8px ${color}` }}
      />
    </div>
  );
}

/* ── System Status Panel (Left Rail top) ── */
function SystemStatusPanel({ status }: { status: string }) {
  const [cpu, setCpu] = useState(61);
  const [mem, setMem] = useState(47);
  const [agentLoad, setAgentLoad] = useState(78);
  const [perf, setPerf] = useState(94);

  useEffect(() => {
    const t = setInterval(() => {
      setCpu(prev => Math.max(20, Math.min(95, prev + (Math.random() - 0.5) * 6)));
      setMem(prev => Math.max(20, Math.min(90, prev + (Math.random() - 0.5) * 3)));
      setAgentLoad(prev => Math.max(10, Math.min(99, prev + (Math.random() - 0.5) * 8)));
      setPerf(prev => Math.max(70, Math.min(100, prev + (Math.random() - 0.5) * 4)));
    }, 2000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="hud-panel hud-bracket flex flex-col" style={{ padding: '10px' }}>
      <header className="flex items-center justify-between gap-2 border-b pb-1.5 mb-2" style={{ borderColor: 'var(--hud-line)' }}>
        <h2 className="hud-label">System Status</h2>
      </header>
      <div className="flex items-center gap-3">
        <Reactor status={status} />
        <div className="flex-1 min-w-0 space-y-1.5">
          <p className="text-xs">
            <span className="font-display tracking-widest" style={{ color: 'var(--cyan)', fontSize: '0.7rem' }}>JARVIS</span>{' '}
            <span style={{ color: 'var(--color-muted)' }}>Online</span>
          </p>
          <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>System Performance</p>
          <div className="flex items-center gap-2">
            <Bar value={perf} color="var(--success)" />
            <span className="text-[10px]">{Math.round(perf)}%</span>
          </div>
          {[
            { label: 'CPU', value: cpu, color: 'var(--cyan)' },
            { label: 'Memory', value: mem, color: 'var(--violet)' },
            { label: 'Agent Load', value: agentLoad, color: 'var(--gold)' },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--color-muted)' }}>
              <span className="w-16 shrink-0">{label}</span>
              <Bar value={value} color={color} />
              <span className="w-7 text-right">{Math.round(value)}%</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Current Mission Panel ── */
function CurrentMissionPanel() {
  const { status, activeWorkspace } = useAppStore();
  const isExecuting = status === 'EXECUTING' || status === 'THINKING';

  return (
    <section className="hud-panel hud-bracket flex flex-col" style={{ padding: '10px' }}>
      <header className="flex items-center justify-between gap-2 border-b pb-1.5 mb-2" style={{ borderColor: 'var(--hud-line)' }}>
        <h2 className="hud-label">Current Mission</h2>
      </header>
      <p className="font-display leading-5 text-[12px]" style={{ color: 'var(--color-text)' }}>
        {activeWorkspace} MISSION
      </p>
      <div className="mt-2.5 space-y-1">
        <div className="flex justify-between text-[10px]" style={{ color: 'var(--color-muted)' }}>
          <span>Status</span>
          <span style={{ color: isExecuting ? 'var(--cyan)' : 'var(--color-muted)' }}>
            {isExecuting ? 'ACTIVE' : 'STANDBY'}
          </span>
        </div>
        <Bar value={isExecuting ? 67 : 100} color={isExecuting ? 'var(--cyan)' : 'var(--success)'} />
      </div>
    </section>
  );
}

/* ── Project Files Panel ── */
const PROJECT_FILES = [
  { name: 'src', dir: true },
  { name: 'main', dir: true },
  { name: 'renderer', dir: true },
  { name: 'public', dir: true },
  { name: 'package.json', dir: false },
  { name: 'vite.config.ts', dir: false },
  { name: 'electron-builder.yml', dir: false },
];

function ProjectFilesPanel() {
  return (
    <section className="hud-panel hud-bracket flex flex-col" style={{ padding: '10px', minHeight: 150 }}>
      <header className="flex items-center justify-between gap-2 border-b pb-1.5 mb-2" style={{ borderColor: 'var(--hud-line)' }}>
        <h2 className="hud-label">Project Files</h2>
      </header>
      <div className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-text)' }}>
        <ChevronDown className="w-3 h-3" style={{ color: 'var(--cyan)' }} />
        <Folder className="w-3 h-3" style={{ color: 'var(--gold)' }} />
        <span>jarvis-ai-os</span>
      </div>
      <ul className="mt-1 space-y-0.5 border-l pl-3" style={{ borderColor: 'var(--hud-line)' }}>
        {PROJECT_FILES.map(f => (
          <li
            key={f.name}
            className="flex items-center gap-1.5 py-0.5 text-[11px] transition-colors cursor-pointer"
            style={{ color: 'var(--color-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-muted)')}
          >
            {f.dir
              ? <Folder className="w-3 h-3" style={{ color: 'var(--gold)' }} />
              : <File className="w-3 h-3" style={{ color: 'var(--blue)' }} />
            }
            {f.name}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ══════════════════════════════════════════
   MAIN APP
══════════════════════════════════════════ */
export default function App() {
  const {
    theme, setTheme, status, activePanel, setActivePanel,
    activeWorkspace, activeProvider, setProviders, setActiveProvider, setActiveModel,
    setTtsEnabled, setStatus,
  } = useAppStore();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // 10-Second Continuous Auto-Save Loop (Work & Chat Persistence)
  useEffect(() => {
    const autoSaveInterval = setInterval(() => {
      const state = useAppStore.getState();
      try {
        const payload = {
          messages: state.messages.slice(-30).map((m) => ({ id: m.id, role: m.role, content: m.content, timestamp: m.timestamp })),
          activeWorkspace: state.activeWorkspace,
          activePanel: state.activePanel,
          activeProvider: state.activeProvider,
          activeModel: state.activeModel,
          theme: state.theme,
          savedAt: new Date().toISOString(),
        };
        localStorage.setItem('jarvis_autosave_state', JSON.stringify(payload));

        if (window.electronAPI?.saveMessage) {
          const lastMsg = state.messages[state.messages.length - 1];
          if (lastMsg && !lastMsg.streaming) {
            window.electronAPI.saveMessage('autosave_session', lastMsg.role, lastMsg.content);
          }
        }
      } catch (err) {
        console.warn('[AutoSave] 10s state persist failed:', err);
      }
    }, 10000);

    return () => clearInterval(autoSaveInterval);
  }, []);

  // Boot: load persisted settings + subscribe to canonical events
  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI.listProviders?.()?.then(setProviders);
    window.electronAPI.getTheme?.()?.then((t) => { if (t) setTheme(t as Theme); });
    window.electronAPI.getTtsEnabled?.()?.then((enabled) => { setTtsEnabled(!!enabled); });
    window.electronAPI.getActiveProvider?.()?.then((p) => {
      if (p) {
        setActiveProvider(p);
        const DEFAULTS: Record<string, string> = {
          anthropic: 'claude-3-5-sonnet-20241022',
          openai: 'gpt-4o',
          google: 'gemini-1.5-flash',
        };
        setActiveModel(DEFAULTS[p] ?? '');
      }
    });

    const unsubscribeEvents = window.electronAPI.onJarvisEvent?.((evt) => {
      useAppStore.getState().addJarvisEvent(evt);

      if (evt.type === 'jarvis.navigate' && evt.payload?.target) {
        const target = evt.payload.target as string;
        useAppStore.getState().setActiveWorkspace(target);
        if (target === 'WEBSITE_BUILDER') useAppStore.getState().setActivePanel('siteGenerator');
        else if (target === 'SETTINGS') useAppStore.getState().setActivePanel('settings');
        else useAppStore.getState().setActivePanel('chat');
      }

      if (evt.type === 'voice.state') {
        const cur = useAppStore.getState().status;
        if (evt.payload?.isSpeaking && cur !== 'SPEAKING') useAppStore.getState().setStatus('SPEAKING');
        else if (!evt.payload?.isSpeaking && cur === 'SPEAKING') useAppStore.getState().setStatus('IDLE');
      }

      if (evt.type === 'command.completed') {
        if (useAppStore.getState().status === 'EXECUTING') useAppStore.getState().setStatus('IDLE');
      }
    });

    return () => { if (unsubscribeEvents) unsubscribeEvents(); };
  }, []);

  return (
    <div
      className="flex flex-col h-screen w-screen overflow-hidden select-none"
      style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}
    >
      {/* TopHud */}
      <NavigationHeader />

      {/* Browser fallback warning banner */}
      {!window.electronAPI && (
        <div
          className="px-4 py-1.5 text-xs font-mono flex items-center justify-between shrink-0 border-b"
          style={{ background: 'color-mix(in srgb, var(--warn) 12%, transparent)', borderColor: 'color-mix(in srgb, var(--warn) 40%, transparent)', color: 'var(--warn)' }}
        >
          <span>⚠️ Web Browser Mode — Native features (key vault, OS TTS, IPC) active inside the Electron Desktop App.</span>
        </div>
      )}

      {/* ── Main Three-Pane Layout ── */}
      <main className="flex-1 flex overflow-hidden p-2 gap-2">
        {/* ── LEFT RAIL ── */}
        <aside className="w-72 flex flex-col gap-2 shrink-0 overflow-y-auto">
          <SystemStatusPanel status={status} />
          <CurrentMissionPanel />
          <ProjectFilesPanel />
        </aside>

        {/* ── CENTER: Active Panel ── */}
        <section className="flex-1 overflow-hidden flex flex-col hud-panel" style={{ minWidth: 0 }}>
          {activePanel === 'chat' ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              <ChatPanel />
            </div>
          ) : activePanel === 'siteGenerator' ? (
            <SiteGeneratorPanel />
          ) : (
            <SettingsPanel />
          )}
        </section>

        {/* ── RIGHT RAIL ── */}
        <aside className="w-96 flex flex-col gap-2 shrink-0">
          <MissionBoard />
          <div className="flex-1 flex flex-col min-h-0">
            <RightAutomationPane />
          </div>
        </aside>
      </main>

      {/* ── Footer Status Bar ── */}
      <footer
        className="px-4 py-1 border-t flex items-center justify-between font-mono text-[10px] shrink-0"
        style={{ background: 'rgba(0,0,0,0.6)', borderColor: 'var(--hud-line)', color: 'var(--color-muted)' }}
      >
        <div className="flex items-center gap-4">
          <span>ELECTRON v33 · VITE · REACT 18</span>
          <span>AES-256-GCM KEY VAULT</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="w-1.5 h-1.5 rounded-full anim-pulse-soft"
            style={{ background: 'var(--success)', boxShadow: '0 0 6px var(--success)' }}
          />
          <span style={{ color: 'var(--cyan)', fontWeight: 700 }}>DELIVERABLE 7 ACTIVE // SITE GENERATOR ONLINE</span>
        </div>
      </footer>
    </div>
  );
}
