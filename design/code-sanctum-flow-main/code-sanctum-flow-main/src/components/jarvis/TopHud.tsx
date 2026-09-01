import { Bell, Gauge, Power, Settings2, Zap, Hexagon } from "lucide-react";

const NAV = ["Dashboard", "Missions", "Skills", "Memory", "Settings"];

export function TopHud() {
  return (
    <header className="hud-panel flex items-center gap-4 px-3 py-2">
      <div className="flex items-center gap-2 pr-3">
        <Hexagon className="size-4 anim-spin-slow" style={{ color: "var(--cyan)" }} />
        <span className="font-display text-sm tracking-[0.28em] text-foreground">JARVIS AI</span>
      </div>
      <nav className="flex items-center gap-1">
        {NAV.map((n, i) => (
          <button
            key={n}
            className={
              i === 0
                ? "hud-label border border-[var(--hud-line)] bg-[color-mix(in_oklab,var(--cyan)_14%,transparent)] px-3 py-1 text-foreground"
                : "hud-label px-3 py-1 text-muted-foreground transition-colors hover:text-foreground"
            }
          >
            {n}
          </button>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-4 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="hud-label" style={{ color: "var(--gold)" }}>Lv. 15</span>
          <span className="text-muted-foreground">8,420 / 12,000 XP</span>
          <div className="h-1 w-28 bg-[color-mix(in_oklab,var(--foreground)_10%,transparent)]">
            <div className="h-full w-[70%]" style={{ background: "var(--cyan)", boxShadow: "0 0 8px var(--cyan)" }} />
          </div>
        </div>
        <span className="flex items-center gap-1" style={{ color: "var(--warn)" }}>
          <Zap className="size-3.5" /> 87 / 100
        </span>
        <span className="flex items-center gap-1" style={{ color: "var(--violet)" }}>
          <Gauge className="size-3.5" /> 2,450
        </span>
        <div className="flex items-center gap-3 pl-2 text-muted-foreground">
          <Bell className="size-3.5 transition-colors hover:text-foreground" />
          <Settings2 className="size-3.5 transition-colors hover:text-foreground" />
          <Power className="size-3.5 transition-colors hover:text-[var(--error)]" />
        </div>
      </div>
    </header>
  );
}
