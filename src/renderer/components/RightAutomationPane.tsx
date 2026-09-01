import React, { useState, useEffect, useRef } from 'react';
import { Camera, Clipboard, Layout, RefreshCw, Activity, Terminal } from 'lucide-react';
import { useAppStore } from '../store';

/* ── Live Console data ── */
const CONSOLE_SEED = [
  { tone: 'cmd',  text: '[JARVIS] System boot complete. All agents ready.' },
  { tone: 'ok',   text: '[DB] SQLite initialized. Audit log count: 77' },
  { tone: 'info', text: '[AgentOrchestrator] Developer Agent ready.' },
  { tone: 'info', text: '[AgentOrchestrator] Architect Agent ready.' },
  { tone: 'info', text: '[AgentOrchestrator] Code Reviewer Agent ready.' },
  { tone: 'ok',   text: '[IPC] 47 endpoints registered.' },
  { tone: 'cmd',  text: '[JARVIS] JARVIS ONLINE ✓' },
];
const CONSOLE_STREAM = [
  { tone: 'info', text: '[EventBus] Heartbeat ping — all nodes healthy.' },
  { tone: 'ok',   text: '[AdapterRegistry] ComfyUI adapter health: OK.' },
  { tone: 'warn', text: '[VoiceOutput] SAPI fallback active.' },
  { tone: 'info', text: '[MissionManager] Queue depth: 0 missions.' },
  { tone: 'cmd',  text: '[CommandRouter] NAVIGATE intent dispatched.' },
  { tone: 'ok',   text: '[SecurityVault] AES-256-GCM key check passed.' },
  { tone: 'info', text: '[SiteGenerator] Template cache warm.' },
  { tone: 'ok',   text: '[TaskGraph] No active task graph executions.' },
  { tone: 'cmd',  text: 'jarvis@ai:~/project$ waiting for command...' },
];
const TONE_COLORS: Record<string, string> = {
  cmd:  'var(--cyan)',
  ok:   'var(--success)',
  info: 'var(--color-muted)',
  warn: 'var(--warn)',
  err:  'var(--error)',
};

/* ── Agents config (Right Rail activity) ── */
const AGENTS = [
  { id: 'dev',  name: 'Developer Agent',  role: 'Code Generation',  accent: '#06b6d4' },
  { id: 'arch', name: 'Architect Agent',  role: 'System Design',    accent: '#a855f7' },
  { id: 'rev',  name: 'Code Reviewer',    role: 'QA & Security',    accent: '#f59e0b' },
];

/* ── World Map nodes ── */
const MAP_NODES = [
  { x: 18, y: 30, active: true },
  { x: 46, y: 18, locked: true },
  { x: 74, y: 26, locked: true },
  { x: 30, y: 66, locked: true },
  { x: 62, y: 58, current: true },
  { x: 86, y: 70, locked: true },
];
const MAP_LINES = [[18,30,46,18],[46,18,74,26],[18,30,30,66],[30,66,62,58],[62,58,86,70]];

/* ── Achievements ── */
const ACHIEVEMENTS = [
  { title: 'Code Master',    desc: 'Write 1000+ lines of code',    color: 'var(--gold)' },
  { title: 'Problem Solver', desc: 'Fix 50+ bugs',                 color: 'var(--cyan)' },
  { title: 'Architect',      desc: 'Design 10 systems',            color: 'var(--violet)' },
];

/* ══════════════════════════════════ */

function Bar({ value, color = 'var(--cyan)' }: { value: number; color?: string }) {
  return (
    <div className="h-1.5 w-full" style={{ background: 'color-mix(in srgb, var(--color-text) 10%, transparent)' }}>
      <div
        className="h-full transition-all duration-700"
        style={{ width: `${Math.max(2, Math.min(100, value))}%`, background: color, boxShadow: `0 0 8px ${color}` }}
      />
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span
      className="inline-block rounded-full anim-pulse-soft"
      style={{ width: 6, height: 6, background: color, boxShadow: `0 0 6px ${color}`, flexShrink: 0 }}
    />
  );
}

/* ── Agent Activity Panel ── */
function AgentActivityPanel() {
  const { status } = useAppStore();
  const [progresses, setProgresses] = useState({ dev: 78, arch: 54, rev: 91 });

  useEffect(() => {
    const t = setInterval(() => {
      setProgresses(p => ({
        dev:  Math.max(5, Math.min(99, p.dev  + (Math.random() - 0.48) * 5)),
        arch: Math.max(5, Math.min(99, p.arch + (Math.random() - 0.52) * 5)),
        rev:  Math.max(5, Math.min(99, p.rev  + (Math.random() - 0.45) * 4)),
      }));
    }, 2500);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="hud-panel hud-bracket flex flex-col shrink-0">
      <header className="flex items-center justify-between gap-2 border-b px-2.5 py-1.5" style={{ borderColor: 'var(--hud-line)' }}>
        <h2 className="hud-label">Agent Activity</h2>
        <span className="flex items-center gap-1 text-[9px]" style={{ color: 'var(--error)' }}>
          <Dot color="var(--error)" /> LIVE
        </span>
      </header>
      <ul className="p-2.5 space-y-1.5">
        {AGENTS.map((a) => {
          const prog = progresses[a.id as keyof typeof progresses] ?? 0;
          const active = status !== 'IDLE';
          return (
            <li key={a.id} className="border p-1.5" style={{
              borderColor: `color-mix(in srgb, ${a.accent} 30%, transparent)`,
              background: `color-mix(in srgb, ${a.accent} 7%, rgba(0,0,0,0.3))`,
            }}>
              <div className="flex items-start gap-2">
                <span className="grid place-items-center border text-[9px] font-bold shrink-0" style={{
                  width: 28, height: 28,
                  borderColor: a.accent, color: a.accent,
                  boxShadow: `inset 0 0 12px -6px ${a.accent}`,
                }}>
                  {a.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-[11px]" style={{ color: a.accent }}>{a.name}</p>
                    <span className="shrink-0 text-[9px]" style={{ color: 'var(--color-muted)' }}>
                      {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="truncate text-[10px]" style={{ color: 'var(--color-muted)' }}>{a.role}</p>
                  <p className="truncate text-[10px]" style={{ color: active ? a.accent : 'var(--color-muted)' }}>
                    Status: {active ? 'ACTIVE' : 'IDLE'}
                  </p>
                </div>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <Bar value={prog} color={a.accent} />
                <span className="text-[9px] text-right w-8 shrink-0" style={{ color: 'var(--color-muted)' }}>
                  {Math.round(prog)}%
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ── Live Console Panel ── */
function LiveConsolePanel() {
  const [lines, setLines] = useState(CONSOLE_SEED);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let i = 0;
    const t = setInterval(() => {
      const next = CONSOLE_STREAM[i % CONSOLE_STREAM.length]!;
      i++;
      setLines(prev => [...prev.slice(-30), next]);
    }, 2200);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  return (
    <section className="hud-panel hud-bracket flex flex-col" style={{ minHeight: 180 }}>
      <header className="flex items-center justify-between gap-2 border-b px-2.5 py-1.5" style={{ borderColor: 'var(--hud-line)' }}>
        <h2 className="hud-label">Live Console</h2>
        <span className="flex items-center gap-1 text-[9px]" style={{ color: 'var(--success)' }}>
          <Dot color="var(--success)" /> STREAM
        </span>
      </header>
      <div
        className="scanlines overflow-y-auto p-2 text-[10px] leading-[1.45] flex-1"
        style={{ height: 160, background: 'rgba(0,0,0,0.55)' }}
      >
        {lines.map((l, i) => (
          <p key={i} style={{ color: TONE_COLORS[l.tone] ?? 'var(--color-text)' }}>{l.text}</p>
        ))}
        <p style={{ color: 'var(--cyan)', marginTop: 4 }}>
          jarvis@ai:~/project$ <span className="anim-blink">▌</span>
        </p>
        <div ref={bottomRef} />
      </div>
    </section>
  );
}

/* ── World Map Panel ── */
function WorldMapPanel() {
  return (
    <section className="hud-panel hud-bracket flex flex-col shrink-0">
      <header className="flex items-center justify-between gap-2 border-b px-2.5 py-1.5" style={{ borderColor: 'var(--hud-line)' }}>
        <h2 className="hud-label">World Map</h2>
        <span className="text-[9px]" style={{ color: 'var(--color-muted)' }}>SECTOR 04</span>
      </header>
      <div className="p-2.5">
        <div
          className="relative overflow-hidden border grid-fine"
          style={{
            height: 130,
            borderColor: 'var(--hud-line)',
            background: 'radial-gradient(ellipse at 40% 40%, rgba(34,211,238,0.1), oklch(0.14 0.03 265))',
          }}
        >
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {MAP_LINES.map((l, i) => (
              <line key={i} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} stroke="var(--hud-line)" strokeWidth="0.5" strokeDasharray="2 2" />
            ))}
          </svg>
          {MAP_NODES.map((n, i) => (
            <span
              key={i}
              className={`absolute border rotate-45 ${n.current ? 'anim-pulse-soft' : ''}`}
              style={{
                width: 12, height: 12,
                left: `${n.x}%`, top: `${n.y}%`,
                transform: 'rotate(45deg) translate(-50%, -50%)',
                borderColor: n.locked ? 'var(--color-muted)' : n.current ? 'var(--gold)' : 'var(--cyan)',
                background: n.locked ? 'transparent' : `color-mix(in srgb, ${n.current ? 'var(--gold)' : 'var(--cyan)'} 40%, transparent)`,
                boxShadow: n.locked ? undefined : `0 0 10px ${n.current ? 'var(--gold)' : 'var(--cyan)'}`,
              }}
            />
          ))}
          <span
            className="absolute bottom-2 left-1/2 -translate-x-1/2 border px-1.5 py-0.5 text-[9px]"
            style={{ borderColor: 'var(--hud-line)', background: 'rgba(0,0,0,0.65)', color: 'var(--gold)' }}
          >
            ◆ Current Mission
          </span>
        </div>
      </div>
    </section>
  );
}

/* ── Achievements Panel ── */
function AchievementsPanel() {
  return (
    <section className="hud-panel hud-bracket flex flex-col shrink-0">
      <header className="flex items-center justify-between gap-2 border-b px-2.5 py-1.5" style={{ borderColor: 'var(--hud-line)' }}>
        <h2 className="hud-label">Achievements</h2>
      </header>
      <ul className="p-2.5 space-y-1.5">
        {ACHIEVEMENTS.map((a) => (
          <li key={a.title} className="flex items-center gap-2 border p-1.5" style={{ borderColor: 'var(--hud-line)' }}>
            <span
              className="grid place-items-center border rotate-45 shrink-0"
              style={{ width: 24, height: 24, borderColor: a.color, boxShadow: `0 0 12px -6px ${a.color}` }}
            >
              <span className="-rotate-45 text-[9px]" style={{ color: a.color }}>★</span>
            </span>
            <div className="min-w-0">
              <p className="truncate text-[11px]">{a.title}</p>
              <p className="truncate text-[9px]" style={{ color: 'var(--color-muted)' }}>{a.desc}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── Quick Tools Panel ── */
function QuickToolsPanel() {
  const [loadingTool, setLoadingTool] = useState<string | null>(null);

  const handleQuickTool = async (toolName: string) => {
    setLoadingTool(toolName);
    try {
      await window.electronAPI?.executeToolDirect?.(toolName, {});
    } catch { /* ignore */ }
    setLoadingTool(null);
  };

  return (
    <section className="hud-panel hud-bracket flex flex-col shrink-0">
      <header className="flex items-center justify-between gap-2 border-b px-2.5 py-1.5" style={{ borderColor: 'var(--hud-line)' }}>
        <h2 className="hud-label">Quick Tools</h2>
      </header>
      <div className="p-2.5 grid grid-cols-1 gap-1.5">
        {[
          { id: 'take_screenshot',  label: 'Take Screenshot',   Icon: Camera },
          { id: 'read_clipboard',   label: 'Read Clipboard',    Icon: Clipboard },
          { id: 'list_open_windows',label: 'List Open Windows', Icon: Layout },
        ].map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => handleQuickTool(id)}
            disabled={loadingTool === id}
            className="p-1.5 border flex items-center gap-2 text-[11px] font-mono transition-all disabled:opacity-40"
            style={{
              borderColor: 'var(--hud-line)',
              background: 'rgba(0,0,0,0.4)',
              color: 'var(--color-text)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--cyan) 60%, transparent)';
              e.currentTarget.style.background = 'color-mix(in srgb, var(--cyan) 10%, transparent)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--hud-line)';
              e.currentTarget.style.background = 'rgba(0,0,0,0.4)';
            }}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--cyan)' }} />
            <span>{loadingTool === id ? 'Running…' : label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ── Event Stream ── */
function EventStreamPanel() {
  const { recentEvents } = useAppStore();
  const [activeTab, setActiveTab] = useState<'events' | 'audit'>('events');
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        if (!window.electronAPI) return;
        const data = await window.electronAPI.getAuditLogs();
        setLogs(data.slice(0, 20));
      } catch { /* ignore */ }
    };
    fetchLogs();
    const t = setInterval(fetchLogs, 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="hud-panel hud-bracket flex flex-col flex-1 min-h-0">
      <header className="flex items-center justify-between gap-2 border-b px-2.5 py-1.5 shrink-0" style={{ borderColor: 'var(--hud-line)' }}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveTab('events')}
            className="flex items-center gap-1 text-[10px] font-mono transition-colors"
            style={{ color: activeTab === 'events' ? 'var(--cyan)' : 'var(--color-muted)', fontWeight: activeTab === 'events' ? 700 : 400 }}
          >
            <Activity className="w-3.5 h-3.5" />
            EVENT STREAM ({recentEvents.length})
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className="flex items-center gap-1 text-[10px] font-mono transition-colors"
            style={{ color: activeTab === 'audit' ? 'var(--cyan)' : 'var(--color-muted)', fontWeight: activeTab === 'audit' ? 700 : 400 }}
          >
            <Terminal className="w-3.5 h-3.5" />
            AUDIT LOG
          </button>
        </div>
        <span className="flex items-center gap-1 text-[9px]" style={{ color: 'var(--success)' }}>
          <Dot color="var(--success)" /> LIVE
        </span>
      </header>
      <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
        {activeTab === 'events' ? (
          recentEvents.length === 0 ? (
            <p className="text-[10px] text-center pt-4" style={{ color: 'var(--color-muted)', opacity: 0.6 }}>
              Awaiting system events…
            </p>
          ) : (
            recentEvents.map((evt: any) => (
              <div key={evt.id || Math.random()} className="p-1.5 border space-y-0.5" style={{ borderColor: 'var(--hud-line)', background: 'rgba(0,0,0,0.3)' }}>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-bold truncate" style={{ color: 'var(--cyan)' }}>{evt.type}</span>
                  <span className="text-[9px] font-bold px-1 rounded" style={{
                    color: evt.severity === 'ERROR' ? 'var(--error)' : evt.severity === 'WARNING' ? 'var(--warn)' : 'var(--cyan)',
                    background: evt.severity === 'ERROR' ? 'color-mix(in srgb, var(--error) 15%, transparent)' : 'color-mix(in srgb, var(--cyan) 12%, transparent)',
                  }}>
                    {evt.category ?? 'EVENT'}
                  </span>
                </div>
                <p className="text-[10px] truncate" style={{ color: 'var(--color-muted)' }}>
                  {evt.source}: {evt.payload?.message ?? evt.payload?.text ?? evt.payload?.intent ?? '—'}
                </p>
              </div>
            ))
          )
        ) : logs.length === 0 ? (
          <p className="text-[10px] text-center pt-4" style={{ color: 'var(--color-muted)', opacity: 0.6 }}>
            No audit logs yet.
          </p>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="p-1.5 border space-y-0.5" style={{ borderColor: 'var(--hud-line)', background: 'rgba(0,0,0,0.3)' }}>
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-bold truncate" style={{ color: 'var(--color-text)' }}>{log.action_type}</span>
                <span className="text-[9px] font-bold" style={{
                  color: log.status === 'SUCCESS' || log.status === 'CONFIRMED' ? 'var(--success)' : log.status === 'FAILED' ? 'var(--error)' : 'var(--warn)',
                }}>{log.status}</span>
              </div>
              <p className="text-[10px] truncate" style={{ color: 'var(--color-muted)' }}>{log.details}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════
   EXPORTED COMPONENT
══════════════════════════════════════════ */
export default function RightAutomationPane() {
  return (
    <div className="flex flex-col h-full gap-2 overflow-y-auto font-mono text-[11px]">
      <QuickToolsPanel />
      <AgentActivityPanel />
      <LiveConsolePanel />
      <WorldMapPanel />
      <AchievementsPanel />
      <EventStreamPanel />
    </div>
  );
}
