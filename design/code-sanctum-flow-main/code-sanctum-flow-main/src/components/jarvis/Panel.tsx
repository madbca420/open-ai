import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({
  title,
  right,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("hud-panel hud-bracket flex min-h-0 flex-col", className)}>
      {title && (
        <header className="flex items-center justify-between gap-2 border-b border-[var(--hud-line)] px-2.5 py-1.5">
          <h2 className="hud-label truncate">{title}</h2>
          {right}
        </header>
      )}
      <div className={cn("min-h-0 flex-1 p-2.5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Bar({ value, color = "var(--cyan)" }: { value: number; color?: string }) {
  return (
    <div className="h-1.5 w-full bg-[color-mix(in_oklab,var(--foreground)_10%,transparent)]">
      <div
        className="h-full transition-all duration-700"
        style={{ width: `${Math.max(2, Math.min(100, value))}%`, background: color, boxShadow: `0 0 8px ${color}` }}
      />
    </div>
  );
}

export function Dot({ color, pulse = true }: { color: string; pulse?: boolean }) {
  return (
    <span
      className={cn("inline-block size-1.5 rounded-full", pulse && "anim-pulse-soft")}
      style={{ background: color, boxShadow: `0 0 6px ${color}` }}
    />
  );
}
