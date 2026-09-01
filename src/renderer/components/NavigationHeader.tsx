import React, { useEffect, useState } from 'react';
import { Hexagon, Bell, Gauge, Zap, Settings2, Power, Code, TrendingUp, Globe, Search, Bot, Palette, Mic, Command, Minus, Square, X, Radio } from 'lucide-react';
import { useAppStore, Theme } from '../store';

const WORKSPACES = [
  { id: 'COMMAND_CENTER',  label: 'Command Center',  icon: Command },
  { id: 'DEVELOPMENT',    label: 'Development',     icon: Code },
  { id: 'TRADING',        label: 'Trading',         icon: TrendingUp },
  { id: 'WEBSITE_BUILDER',label: 'Website Builder', icon: Globe },
  { id: 'RESEARCH',       label: 'Research',        icon: Search },
  { id: 'AUTOMATION',     label: 'Automation',      icon: Bot },
  { id: 'CREATIVE',       label: 'Creative',        icon: Palette },
  { id: 'VOICE',          label: 'Voice',           icon: Mic },
];

export default function NavigationHeader() {
  const {
    theme, setTheme, activePanel, setActivePanel,
    activeWorkspace, setActiveWorkspace, activeProvider, status,
  } = useAppStore();

  const [time, setTime] = useState(new Date());
  const [xp] = useState({ level: 15, current: 8420, max: 12000 });
  const [energy] = useState(87);
  const [throughput] = useState(2450);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const handleThemeChange = async (newTheme: Theme) => {
    setTheme(newTheme);
    await window.electronAPI?.setTheme(newTheme);
  };

  const handleWorkspaceChange = async (ws: string) => {
    setActiveWorkspace(ws);
    if (ws === 'WEBSITE_BUILDER') setActivePanel('siteGenerator');
    else if (ws === 'SETTINGS') setActivePanel('settings');
    else setActivePanel('chat');
    await window.electronAPI?.setWorkspaceState?.(ws);
  };

  return (
    <header
      className="flex flex-col shrink-0 select-none"
      style={{ background: 'var(--hud)', borderBottom: '1px solid var(--hud-line)', WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* ── Top Bar: Logo · XP / Energy · Clock · Theme · Window Controls ── */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b" style={{ borderColor: 'var(--hud-line)' }}>
        {/* Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <Hexagon className="w-4 h-4 anim-spin-slow" style={{ color: 'var(--cyan)' }} />
          <span className="font-display text-xs tracking-[0.28em]" style={{ color: 'var(--color-text)' }}>
            JARVIS AI
          </span>
        </div>

        {/* Divider */}
        <div className="h-4 w-px" style={{ background: 'var(--hud-line)' }} />

        {/* Provider badge */}
        <div
          className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono border"
          style={{
            borderColor: activeProvider ? 'color-mix(in srgb, var(--success) 50%, transparent)' : 'color-mix(in srgb, var(--warn) 50%, transparent)',
            color: activeProvider ? 'var(--success)' : 'var(--warn)',
            background: activeProvider ? 'color-mix(in srgb, var(--success) 8%, transparent)' : 'color-mix(in srgb, var(--warn) 8%, transparent)',
          }}
        >
          <Radio className="w-2.5 h-2.5 anim-pulse-soft" />
          <span>{activeProvider ? `${activeProvider.toUpperCase()} ONLINE` : 'NO PROVIDER'}</span>
        </div>

        {/* ── XP Bar ── */}
        <div className="hidden md:flex items-center gap-2 ml-2">
          <span className="hud-label" style={{ color: 'var(--gold)' }}>Lv. {xp.level}</span>
          <div className="h-1 w-24 rounded-none" style={{ background: 'color-mix(in srgb, var(--color-text) 10%, transparent)' }}>
            <div
              className="h-full transition-all duration-700"
              style={{ width: `${(xp.current / xp.max) * 100}%`, background: 'var(--cyan)', boxShadow: '0 0 8px var(--cyan)' }}
            />
          </div>
          <span className="text-[10px] font-mono" style={{ color: 'var(--color-muted)' }}>
            {xp.current.toLocaleString()} / {xp.max.toLocaleString()} XP
          </span>
        </div>

        {/* Energy & Throughput */}
        <div className="hidden lg:flex items-center gap-3 ml-1">
          <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--warn)' }}>
            <Zap className="w-3 h-3" /> {energy} / 100
          </span>
          <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--violet)' }}>
            <Gauge className="w-3 h-3" /> {throughput.toLocaleString()}
          </span>
        </div>

        {/* Clock — Indian Standard Time (IST, 12-hour format) */}
        <span className="hidden xl:flex items-center gap-1 text-[10px] font-mono ml-1 text-cyan-400 font-bold">
          <span>{time.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}</span>
          <span className="text-[9px] px-1 bg-cyan-950 border border-cyan-800 rounded text-cyan-300">IST</span>
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Theme switcher */}
        <div
          className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono border"
          style={{ borderColor: 'var(--hud-line)', background: 'rgba(0,0,0,0.4)' }}
          // @ts-ignore
          style2={{ WebkitAppRegion: 'no-drag' }}
        >
          <span className="hud-label mr-1">THEME:</span>
          {(['cyan', 'crimson', 'emerald'] as const).map((t) => (
            <button
              key={t}
              onClick={() => handleThemeChange(t)}
              title={`Theme: ${t}`}
              className="w-3 h-3 rounded-full transition-transform"
              style={{
                background: t === 'cyan' ? '#22d3ee' : t === 'crimson' ? '#f43f5e' : '#10b981',
                transform: theme === t ? 'scale(1.3)' : 'scale(1)',
                opacity: theme === t ? 1 : 0.45,
                boxShadow: theme === t ? `0 0 8px ${t === 'cyan' ? '#22d3ee' : t === 'crimson' ? '#f43f5e' : '#10b981'}` : 'none',
                WebkitAppRegion: 'no-drag',
              } as React.CSSProperties}
            />
          ))}
        </div>

        {/* Right icons */}
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            className="p-1 transition-colors"
            style={{ color: 'var(--color-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-muted)')}
            title="Notifications"
          >
            <Bell className="w-3.5 h-3.5" />
          </button>
          <button
            className="p-1 transition-colors"
            style={{ color: 'var(--color-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-muted)')}
            onClick={() => { setActiveWorkspace('SETTINGS'); setActivePanel('settings'); }}
            title="Settings"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
          <div className="h-4 w-px mx-1" style={{ background: 'var(--hud-line)' }} />
          <button onClick={() => window.electronAPI?.minimizeWindow()} className="p-1 rounded hover:bg-white/10 transition-colors" style={{ color: 'var(--color-muted)' }}>
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => window.electronAPI?.maximizeWindow()} className="p-1 rounded hover:bg-white/10 transition-colors" style={{ color: 'var(--color-muted)' }}>
            <Square className="w-3 h-3" />
          </button>
          <button
            onClick={() => window.electronAPI?.closeWindow()}
            className="p-1 rounded transition-colors"
            style={{ color: 'var(--color-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--error)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-muted)')}
          >
            <Power className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Navigation Toolbar: Workspace Tabs + Panel Switcher ── */}
      <div
        className="flex items-center justify-between px-3 py-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Workspace Label */}
        <div className="flex items-center gap-1 overflow-x-auto">
          <span className="hud-label mr-1.5 shrink-0" style={{ color: 'var(--color-muted)' }}>WORKSPACE:</span>

          {WORKSPACES.map((ws) => {
            const Icon = ws.icon;
            const isActive = activeWorkspace === ws.id;
            return (
              <button
                key={ws.id}
                onClick={() => handleWorkspaceChange(ws.id)}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono border transition-all shrink-0"
                style={{
                  borderColor: isActive ? 'color-mix(in srgb, var(--cyan) 70%, transparent)' : 'transparent',
                  background: isActive ? 'color-mix(in srgb, var(--cyan) 14%, transparent)' : 'transparent',
                  color: isActive ? 'var(--color-text)' : 'var(--color-muted)',
                  boxShadow: isActive ? '0 0 10px -4px var(--cyan)' : 'none',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = 'var(--color-text)'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = 'var(--color-muted)'; }}
              >
                <Icon className="w-3 h-3" style={{ color: isActive ? 'var(--cyan)' : 'inherit' }} />
                <span>{ws.label}</span>
              </button>
            );
          })}
        </div>

        {/* Panel Switcher */}
        <div className="flex items-center gap-0.5 border p-0.5 shrink-0" style={{ borderColor: 'var(--hud-line)', background: 'rgba(0,0,0,0.4)' }}>
          {[
            { id: 'chat',          label: 'HUD VIEW' },
            { id: 'siteGenerator', label: 'BUILDER' },
            { id: 'settings',      label: 'SETTINGS' },
          ].map(p => (
            <button
              key={p.id}
              onClick={() => setActivePanel(p.id as any)}
              className="px-2.5 py-0.5 text-[10px] font-mono transition-colors"
              style={{
                background: activePanel === p.id ? 'color-mix(in srgb, var(--cyan) 18%, transparent)' : 'transparent',
                color: activePanel === p.id ? 'var(--cyan)' : 'var(--color-muted)',
                fontWeight: activePanel === p.id ? '700' : '400',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
