import { ChevronDown, File, Folder } from "lucide-react";
import { Panel, Bar, Dot } from "./Panel";
import { AGENTS, STATE_META } from "@/lib/jarvis";
import type { AgentRuntime } from "./useJarvis";
import type { AgentId } from "@/lib/jarvis";

function Reactor() {
  return (
    <div className="relative size-[86px] shrink-0">
      <div className="absolute inset-0 rounded-full border border-[var(--hud-line)] anim-spin-slow" />
      <div
        className="absolute inset-2 rounded-full border-2 border-dashed"
        style={{ borderColor: "color-mix(in oklab, var(--cyan) 45%, transparent)", animation: "spin-slow 9s linear infinite reverse" }}
      />
      <div
        className="absolute inset-[26px] rounded-full anim-pulse-soft"
        style={{ background: "radial-gradient(circle, var(--cyan), transparent 70%)" }}
      />
      <div className="absolute inset-[38px] rounded-full" style={{ background: "var(--cyan)", boxShadow: "0 0 24px var(--cyan)" }} />
    </div>
  );
}

const FILES = [
  { name: "frontend", dir: true },
  { name: "backend", dir: true },
  { name: "database", dir: true },
  { name: "public", dir: true },
  { name: "README.md", dir: false },
  { name: "package.json", dir: false },
  { name: ".gitignore", dir: false },
];

export function LeftRail({ agents }: { agents: Record<AgentId, AgentRuntime> }) {
  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-0.5">
      <Panel title="System Status">
        <div className="flex items-center gap-3">
          <Reactor />
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-xs">
              <span className="font-display tracking-widest" style={{ color: "var(--cyan)" }}>JARVIS</span>{" "}
              <span className="text-muted-foreground">Online</span>
            </p>
            <p className="text-[10px] text-muted-foreground">System Performance</p>
            <div className="flex items-center gap-2">
              <Bar value={94} color="var(--success)" />
              <span className="text-[10px]">94%</span>
            </div>
            {[
              ["CPU", 61, "var(--cyan)"],
              ["Memory", 47, "var(--violet)"],
              ["Agent Load", 78, "var(--gold)"],
            ].map(([l, v, c]) => (
              <div key={l as string} className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="w-16 shrink-0">{l}</span>
                <Bar value={v as number} color={c as string} />
                <span className="w-7 text-right">{v}%</span>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <Panel title="Current Mission">
        <p className="font-display text-[13px] leading-5 text-foreground">
          Build Full Stack
          <br />
          E-Commerce Website
        </p>
        <div className="mt-2.5 space-y-1">
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Progress</span>
            <span style={{ color: "var(--cyan)" }}>67%</span>
          </div>
          <Bar value={67} />
        </div>
        <dl className="mt-2.5 space-y-1 border-t border-[var(--hud-line)] pt-2 text-[10px] text-muted-foreground">
          <div className="flex justify-between"><dt>Time Elapsed</dt><dd className="text-foreground">02:47:36</dd></div>
          <div className="flex justify-between"><dt>ETA</dt><dd className="text-foreground">01:23:11</dd></div>
        </dl>
      </Panel>

      <Panel title="AI Agents" right={<span className="text-[10px] text-muted-foreground">3 / 3 Active</span>}>
        <ul className="space-y-1.5">
          {AGENTS.map((a) => {
            const rt = agents[a.id];
            const meta = STATE_META[rt.state];
            return (
              <li key={a.id} className="flex items-center gap-2 border border-[var(--hud-line)] bg-[color-mix(in_oklab,black_25%,transparent)] p-1.5">
                <span
                  className="grid size-7 shrink-0 place-items-center border text-[9px] font-bold"
                  style={{ borderColor: a.accent, color: a.accent, boxShadow: `inset 0 0 12px -6px ${a.accent}` }}
                >
                  {a.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px]" style={{ color: a.accent }}>{a.name}</p>
                  <p className="truncate text-[10px] text-muted-foreground">{a.role}</p>
                </div>
                <span className="flex shrink-0 items-center gap-1 text-[9px]" style={{ color: meta.color }}>
                  <Dot color={meta.color} /> {meta.label}
                </span>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="Project Files" className="min-h-[170px]">
        <div className="flex items-center gap-1 text-[11px]">
          <ChevronDown className="size-3" style={{ color: "var(--cyan)" }} />
          <Folder className="size-3" style={{ color: "var(--gold)" }} />
          <span>ecommerce-website</span>
        </div>
        <ul className="mt-1 space-y-0.5 border-l border-[var(--hud-line)] pl-3">
          {FILES.map((f) => (
            <li key={f.name} className="flex items-center gap-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
              {f.dir ? (
                <Folder className="size-3" style={{ color: "var(--gold)" }} />
              ) : (
                <File className="size-3" style={{ color: "var(--blue)" }} />
              )}
              {f.name}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
