import { useEffect, useState } from "react";
import { Panel, Bar, Dot } from "./Panel";
import { AGENTS, CONSOLE_SEED, CONSOLE_STREAM, STATE_META, type AgentId } from "@/lib/jarvis";
import type { AgentRuntime } from "./useJarvis";

const TONE: Record<string, string> = {
  cmd: "var(--cyan)",
  ok: "var(--success)",
  info: "var(--muted-foreground)",
  warn: "var(--warn)",
  err: "var(--error)",
};

function LiveConsole() {
  const [lines, setLines] = useState(CONSOLE_SEED);
  useEffect(() => {
    let i = 0;
    const t = setInterval(() => {
      const next = CONSOLE_STREAM[i % CONSOLE_STREAM.length]!;
      i++;
      setLines((prev) => [...prev.slice(-24), next]);
    }, 2200);
    return () => clearInterval(t);
  }, []);
  return (
    <Panel title="Live Console" className="min-h-[190px]" bodyClassName="p-0">
      <div className="scanlines relative h-[170px] overflow-y-auto bg-[color-mix(in_oklab,black_55%,transparent)] p-2 text-[10px] leading-[1.45]">
        {lines.map((l, i) => (
          <p key={i} style={{ color: TONE[l.tone] }}>{l.text}</p>
        ))}
        <p className="mt-1" style={{ color: "var(--cyan)" }}>
          jarvis@ai:~/ecommerce$ <span className="anim-blink">▌</span>
        </p>
      </div>
    </Panel>
  );
}

export function RightRail({ agents }: { agents: Record<AgentId, AgentRuntime> }) {
  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pl-0.5">
      <Panel
        title="Agent Activity"
        right={
          <span className="flex items-center gap-1 text-[9px]" style={{ color: "var(--error)" }}>
            <Dot color="var(--error)" /> LIVE
          </span>
        }
      >
        <ul className="space-y-1.5">
          {AGENTS.map((a) => {
            const rt = agents[a.id];
            const meta = STATE_META[rt.state];
            return (
              <li
                key={a.id}
                className="border p-1.5"
                style={{
                  borderColor: `color-mix(in oklab, ${a.accent} 30%, transparent)`,
                  background: `color-mix(in oklab, ${a.accent} 7%, color-mix(in oklab, black 30%, transparent))`,
                }}
              >
                <div className="flex items-start gap-2">
                  <span
                    className="grid size-7 shrink-0 place-items-center border text-[9px] font-bold"
                    style={{ borderColor: a.accent, color: a.accent }}
                  >
                    {a.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-[11px]" style={{ color: a.accent }}>{a.name}</p>
                      <span className="shrink-0 text-[9px] text-muted-foreground">{rt.time}</span>
                    </div>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {rt.state === "reviewing" ? "Reviewing" : rt.state === "completed" ? "Finalized" : "Updated"}:{" "}
                      <span className="text-foreground">{rt.file}</span>
                    </p>
                    <p className="truncate text-[10px]" style={{ color: meta.color }}>Status: {rt.message}</p>
                  </div>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <Bar value={rt.progress} color={a.accent} />
                  <span className="w-8 shrink-0 text-right text-[9px] text-muted-foreground">{Math.round(rt.progress)}%</span>
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      <LiveConsole />
      <WorldMap />
      <Achievements />
    </div>
  );
}

function WorldMap() {
  const nodes = [
    { x: 18, y: 30, locked: false, active: true },
    { x: 46, y: 18, locked: true },
    { x: 74, y: 26, locked: true },
    { x: 30, y: 66, locked: true },
    { x: 62, y: 58, locked: false, current: true },
    { x: 86, y: 70, locked: true },
  ];
  return (
    <Panel title="World Map" right={<span className="text-[9px] text-muted-foreground">SECTOR 04</span>}>
      <div className="relative h-[150px] overflow-hidden border border-[var(--hud-line)] bg-[radial-gradient(ellipse_at_40%_40%,oklch(0.28_0.06_180_/_60%),oklch(0.14_0.03_265))] grid-fine">
        <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {[[18, 30, 46, 18], [46, 18, 74, 26], [18, 30, 30, 66], [30, 66, 62, 58], [62, 58, 86, 70]].map((l, i) => (
            <line key={i} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} stroke="var(--hud-line)" strokeWidth="0.5" strokeDasharray="2 2" />
          ))}
        </svg>
        {nodes.map((n, i) => (
          <span
            key={i}
            className={`absolute size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border ${n.current ? "anim-pulse-soft" : ""}`}
            style={{
              left: `${n.x}%`,
              top: `${n.y}%`,
              borderColor: n.locked ? "var(--muted-foreground)" : n.current ? "var(--gold)" : "var(--cyan)",
              background: n.locked ? "transparent" : `color-mix(in oklab, ${n.current ? "var(--gold)" : "var(--cyan)"} 40%, transparent)`,
              boxShadow: n.locked ? undefined : `0 0 10px ${n.current ? "var(--gold)" : "var(--cyan)"}`,
            }}
          />
        ))}
        <span className="absolute bottom-2 left-1/2 -translate-x-1/2 border border-[var(--hud-line)] bg-[color-mix(in_oklab,black_65%,transparent)] px-1.5 py-0.5 text-[9px]" style={{ color: "var(--gold)" }}>
          ◆ Current Mission
        </span>
      </div>
    </Panel>
  );
}

const ACHIEVEMENTS = [
  { title: "Code Master", desc: "Write 1000+ lines of code", color: "var(--gold)" },
  { title: "Problem Solver", desc: "Fix 50+ bugs", color: "var(--cyan)" },
  { title: "Architect", desc: "Design 10 systems", color: "var(--violet)" },
];

function Achievements() {
  return (
    <Panel title="Achievements">
      <ul className="space-y-1.5">
        {ACHIEVEMENTS.map((a) => (
          <li key={a.title} className="flex items-center gap-2 border border-[var(--hud-line)] p-1.5">
            <span
              className="grid size-6 shrink-0 rotate-45 place-items-center border"
              style={{ borderColor: a.color, boxShadow: `0 0 12px -6px ${a.color}` }}
            >
              <span className="-rotate-45 text-[9px]" style={{ color: a.color }}>★</span>
            </span>
            <div className="min-w-0">
              <p className="truncate text-[11px]">{a.title}</p>
              <p className="truncate text-[9px] text-muted-foreground">{a.desc}</p>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
