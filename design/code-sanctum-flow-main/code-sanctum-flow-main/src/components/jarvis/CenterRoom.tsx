import { AlertTriangle, Check, CircleDashed, Code2, Cpu, Rocket, ShieldCheck, Sparkles, FileCheck2, ShoppingCart } from "lucide-react";
import roomBg from "@/assets/room-bg.jpg";
import spriteDeepseek from "@/assets/agent-deepseek.png";
import spriteGlm from "@/assets/agent-glm.png";
import spriteGptoss from "@/assets/agent-gptoss.png";
import { AGENTS, MISSION_TASKS, STATE_META, type AgentId } from "@/lib/jarvis";
import type { AgentRuntime } from "./useJarvis";
import { Dot } from "./Panel";

const SPRITES: Record<AgentId, string> = {
  deepseek: spriteDeepseek,
  glm: spriteGlm,
  gptoss: spriteGptoss,
};

function StateIcon({ state, color }: { state: string; color: string }) {
  const cls = "size-3";
  const s = { color } as const;
  if (state === "completed") return <Check className={cls} style={{ color: "var(--success)" }} />;
  if (state === "debugging") return <AlertTriangle className={cls} style={{ color: "var(--error)" }} />;
  if (state === "reviewing") return <ShieldCheck className={cls} style={s} />;
  if (state === "thinking") return <Sparkles className={cls} style={s} />;
  if (state === "idle") return <CircleDashed className={cls} style={s} />;
  return <Code2 className={cls} style={s} />;
}

function Workstation({ id, rt }: { id: AgentId; rt: AgentRuntime }) {
  const def = AGENTS.find((a) => a.id === id)!;
  const meta = STATE_META[rt.state];
  const typing = rt.state === "working" || rt.state === "reviewing";
  return (
    <div className="relative flex flex-col items-center">
      {/* name plate */}
      <div
        className="hud-bracket w-full max-w-[210px] border px-2 py-1 text-center"
        style={{
          borderColor: `color-mix(in oklab, ${def.accent} 55%, transparent)`,
          background: `color-mix(in oklab, ${def.accent} 10%, color-mix(in oklab, black 65%, transparent))`,
          boxShadow: `0 0 22px -12px ${def.accent}`,
        }}
      >
        <p className="font-display text-[11px] tracking-wider" style={{ color: def.accent }}>{def.name}</p>
        <p className="text-[9px] text-muted-foreground">{def.role}</p>
      </div>

      {/* speech bubble */}
      <div
        key={rt.message}
        className="anim-bubble relative mt-2.5 max-w-[190px] border px-2 py-1 text-[10px] leading-snug"
        style={{
          borderColor: `color-mix(in oklab, ${meta.color} 50%, transparent)`,
          background: "color-mix(in oklab, black 72%, transparent)",
          color: meta.color,
        }}
      >
        <span className="flex items-start gap-1.5">
          <StateIcon state={rt.state} color={meta.color} />
          <span className="text-foreground/90">{rt.message}</span>
        </span>
        <span
          className="absolute -bottom-1 left-6 size-1.5 rotate-45 border-r border-b"
          style={{ borderColor: `color-mix(in oklab, ${meta.color} 50%, transparent)`, background: "color-mix(in oklab, black 72%, transparent)" }}
        />
      </div>

      {/* holo glyph for thinking */}
      <div className="relative mt-1 h-5 w-full">
        {rt.state === "thinking" && (
          <Cpu
            className="anim-bob absolute left-1/2 size-5 -translate-x-1/2"
            style={{ color: def.accent, filter: `drop-shadow(0 0 6px ${def.accent})` }}
          />
        )}
      </div>

      {/* character */}
      <div className="relative">
        <div
          className="absolute inset-x-4 bottom-2 h-16 blur-xl"
          style={{ background: `radial-gradient(ellipse, color-mix(in oklab, ${def.accent} 55%, transparent), transparent 70%)` }}
        />
        <img
          src={SPRITES[id]}
          alt={`${def.name} pixel art avatar working at a multi-monitor desk`}
          width={816}
          height={816}
          loading="lazy"
          className={`relative w-[146px] select-none [image-rendering:pixelated] ${typing ? "anim-type" : "anim-bob"}`}
          style={{ filter: `drop-shadow(0 0 14px color-mix(in oklab, ${def.accent} 45%, transparent))` }}
        />
        {/* data particles */}
        {typing && (
          <>
            <span className="absolute bottom-16 left-10 size-1" style={{ background: def.accent, animation: "rise 2.4s ease-out infinite" }} />
            <span className="absolute bottom-16 left-20 size-1" style={{ background: def.accent, animation: "rise 2.4s ease-out .9s infinite" }} />
          </>
        )}
        {rt.state === "completed" && (
          <span className="absolute top-6 right-6 grid size-6 place-items-center rounded-full anim-bubble" style={{ background: "color-mix(in oklab, var(--success) 25%, black)", boxShadow: "0 0 14px var(--success)" }}>
            <Check className="size-3.5" style={{ color: "var(--success)" }} />
          </span>
        )}
        {rt.state === "debugging" && (
          <span className="absolute top-6 right-6 grid size-6 place-items-center anim-pulse-soft" style={{ background: "color-mix(in oklab, var(--error) 30%, black)", boxShadow: "0 0 14px var(--error)" }}>
            <AlertTriangle className="size-3.5" style={{ color: "var(--error)" }} />
          </span>
        )}
      </div>

      {/* status strip */}
      <div className="-mt-2 flex w-[146px] items-center justify-between border border-[var(--hud-line)] bg-[color-mix(in_oklab,black_65%,transparent)] px-1.5 py-1 text-[9px]">
        <span className="flex items-center gap-1" style={{ color: meta.color }}>
          <Dot color={meta.color} /> {meta.label}
        </span>
        <span className="text-muted-foreground">{Math.round(rt.progress)}%</span>
      </div>
    </div>
  );
}

function MissionBoard() {
  return (
    <div className="hud-panel hud-bracket w-[230px] p-1.5">
      <p className="hud-label mb-1.5 text-center">Mission Board</p>
      <ul className="space-y-1">
        {MISSION_TASKS.map((t) => (
          <li
            key={t.label}
            className="flex items-center gap-2 border px-1.5 py-[3px] text-[10px]"
            style={{
              borderColor: t.status === "active" ? "color-mix(in oklab, var(--cyan) 60%, transparent)" : "transparent",
              background: t.status === "active" ? "color-mix(in oklab, var(--cyan) 12%, transparent)" : "transparent",
              color: t.status === "todo" ? "var(--muted-foreground)" : "var(--foreground)",
              boxShadow: t.status === "active" ? "0 0 16px -8px var(--cyan)" : undefined,
            }}
          >
            {t.status === "done" ? (
              <Check className="size-3" style={{ color: "var(--success)" }} />
            ) : t.status === "active" ? (
              <span className="anim-pulse-soft" style={{ color: "var(--cyan)" }}>→</span>
            ) : (
              <span className="inline-block size-2.5 border border-[var(--hud-line)]" />
            )}
            {t.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function WebsitePreview() {
  return (
    <div className="hud-panel hud-bracket w-[290px] p-2">
      <p className="hud-label mb-1.5 flex items-center gap-1.5">
        <Sparkles className="size-3" /> Website Preview
      </p>
      <div className="scanlines relative overflow-hidden bg-[oklch(0.98_0_0)] text-[oklch(0.2_0.02_260)]">
        <div className="flex items-center justify-between border-b border-black/10 px-2 py-1 text-[8px]">
          <span className="font-display text-[9px]">ShopNest</span>
          <span className="flex gap-2 text-black/60">
            <span>Home</span><span>Shop</span><span>Categories</span>
          </span>
          <ShoppingCart className="size-2.5" />
        </div>
        <div className="flex items-center gap-2 px-2 py-2.5">
          <div className="flex-1">
            <p className="text-[11px] leading-tight font-semibold">New Arrivals</p>
            <p className="text-[11px] leading-tight font-semibold">Summer Collection</p>
            <p className="mt-0.5 text-[7px] text-black/50">Discover the latest trends</p>
            <span className="mt-1.5 inline-block bg-[oklch(0.55_0.2_262)] px-2 py-0.5 text-[7px] text-white">Shop Now</span>
          </div>
          <div className="h-12 w-16 rounded bg-[radial-gradient(circle_at_30%_30%,#3b3b52,#0b0b12)]" />
        </div>
        <div className="h-1 w-full bg-black/10">
          <div className="h-full w-1/3" style={{ background: "var(--cyan)", animation: "sweep 3s linear infinite" }} />
        </div>
      </div>
    </div>
  );
}

const FLOW = [
  { label: "Plan", icon: FileCheck2, done: true },
  { label: "Code", icon: Code2, active: true },
  { label: "Test", icon: ShieldCheck },
  { label: "Deploy", icon: Rocket },
  { label: "Launch", icon: Sparkles },
];

function ProjectFlow() {
  return (
    <div className="hud-panel hud-bracket flex items-center justify-center gap-1 px-4 py-2">
      {FLOW.map((s, i) => {
        const color = s.done ? "var(--success)" : s.active ? "var(--cyan)" : "var(--muted-foreground)";
        return (
          <div key={s.label} className="flex items-center gap-1">
            <div className="flex w-14 flex-col items-center gap-1">
              <span
                className={`grid size-8 place-items-center rounded-full border ${s.active ? "anim-pulse-soft" : ""}`}
                style={{ borderColor: color, color, boxShadow: s.active || s.done ? `0 0 14px -4px ${color}` : undefined }}
              >
                <s.icon className="size-3.5" />
              </span>
              <span className="text-[8px] tracking-widest uppercase" style={{ color }}>{s.label}</span>
            </div>
            {i < FLOW.length - 1 && (
              <div className="relative mb-3 h-px w-8 bg-[var(--hud-line)]">
                <span
                  className="absolute top-1/2 size-1 -translate-y-1/2 rounded-full"
                  style={{ background: "var(--cyan)", animation: `packet 2.4s linear ${i * 0.4}s infinite` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function JarvisCore() {
  return (
    <div className="relative grid size-16 place-items-center">
      <div className="absolute inset-0 rounded-full border border-[var(--hud-line)] anim-spin-slow" />
      <div className="absolute inset-3 rounded-full anim-pulse-soft" style={{ background: "radial-gradient(circle, var(--cyan), transparent 70%)" }} />
      <span className="relative font-display text-[8px] tracking-widest" style={{ color: "var(--cyan)" }}>JARVIS</span>
    </div>
  );
}

export function CenterRoom({ agents }: { agents: Record<AgentId, AgentRuntime> }) {
  return (
    <div className="hud-panel scanlines relative min-h-0 overflow-hidden">
      <img
        src={roomBg}
        alt="Underground cyberpunk AI development laboratory"
        width={1536}
        height={1024}
        className="pointer-events-none absolute inset-0 size-full object-cover opacity-70 anim-flicker [image-rendering:pixelated]"
      />
      <div className="pointer-events-none absolute inset-0 grid-fine opacity-40" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,color-mix(in_oklab,black_75%,transparent))]" />

      <div className="relative flex h-full min-h-0 flex-col overflow-y-auto p-3 pb-[74px]">
        <h1
          className="mx-auto border border-[var(--hud-line)] bg-[color-mix(in_oklab,black_60%,transparent)] px-6 py-1 font-display text-xs tracking-[0.35em]"
          style={{ color: "var(--cyan)", textShadow: "0 0 12px var(--cyan)" }}
        >
          THE AI SQUAD — WORKING
        </h1>

        {/* agent link lines */}
        <div className="relative mt-2">
          <div className="pointer-events-none absolute top-[46%] right-[14%] left-[14%] h-px bg-[var(--hud-line)]">
            <span className="absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full" style={{ background: "var(--cyan)", boxShadow: "0 0 8px var(--cyan)", animation: "packet 3.6s linear infinite" }} />
            <span className="absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full" style={{ background: "var(--violet)", boxShadow: "0 0 8px var(--violet)", animation: "packet 4.8s linear 1.4s infinite" }} />
          </div>
          <div className="relative flex items-start justify-center gap-4">
            {AGENTS.map((a) => (
              <Workstation key={a.id} id={a.id} rt={agents[a.id]} />
            ))}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-start justify-center gap-4">
          <MissionBoard />
          <JarvisCore />
          <WebsitePreview />
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-2 flex justify-center">
        <ProjectFlow />
      </div>

    </div>
  );
}
