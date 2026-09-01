import { useEffect, useState } from "react";
import { Bug, Code2, FileCode2, Rocket, Settings2, ShieldCheck, BookOpen } from "lucide-react";
import { Panel } from "./Panel";

const CODE: { n: number; t: string }[] = [
  { n: 1, t: "const User = require('../models/User');" },
  { n: 2, t: "const bcrypt = require('bcryptjs');" },
  { n: 3, t: "const jwt = require('jsonwebtoken');" },
  { n: 4, t: "" },
  { n: 5, t: "exports.register = async (req, res) => {" },
  { n: 6, t: "  try {" },
  { n: 7, t: "    const { name, email, password } = req.body;" },
  { n: 8, t: "    const exists = await User.findOne({ email });" },
  { n: 9, t: "    if (exists) {" },
  { n: 10, t: "      return res.status(400).json({ message: 'User already exists' });" },
  { n: 11, t: "    }" },
  { n: 12, t: "    const hashed = await bcrypt.hash(password, 10);" },
  { n: 13, t: "    const user = await User.create({ name, email, password: hashed });" },
  { n: 14, t: "    return res.status(201).json({ token: sign(user) });" },
];

function highlight(line: string) {
  const parts = line.split(/(\b(?:const|await|async|return|if|try|require|exports)\b|'[^']*'|\{|\}|\(|\))/g);
  return parts.map((p, i) => {
    let color = "var(--foreground)";
    if (/^(const|await|async|return|if|try|exports)$/.test(p)) color = "var(--violet)";
    else if (p === "require") color = "var(--cyan)";
    else if (/^'.*'$/.test(p)) color = "var(--warn)";
    else if (/^[{}()]$/.test(p)) color = "var(--muted-foreground)";
    return (
      <span key={i} style={{ color }}>
        {p}
      </span>
    );
  });
}

export function CodeEditor() {
  const [active, setActive] = useState(7);
  useEffect(() => {
    const t = setInterval(() => setActive((a) => (a % 13) + 1), 1400);
    return () => clearInterval(t);
  }, []);
  return (
    <Panel
      title="Code Editor — userController.js"
      right={
        <span className="flex items-center gap-1 text-[9px] anim-pulse-soft" style={{ color: "var(--cyan)" }}>
          <FileCode2 className="size-3" /> AI WRITING...
        </span>
      }
      bodyClassName="p-0"
    >
      <div className="scanlines relative h-[168px] overflow-y-auto bg-[color-mix(in_oklab,black_55%,transparent)] py-1 text-[10px] leading-[1.5]">
        {CODE.map((l) => (
          <div
            key={l.n}
            className="flex gap-2 px-2"
            style={{
              background: l.n === active ? "color-mix(in oklab, var(--cyan) 10%, transparent)" : undefined,
              borderLeft: l.n === active ? "2px solid var(--cyan)" : "2px solid transparent",
            }}
          >
            <span className="w-5 shrink-0 text-right text-muted-foreground">{l.n}</span>
            <code className="whitespace-pre">
              {highlight(l.t)}
              {l.n === active && <span className="anim-blink" style={{ color: "var(--cyan)" }}>▌</span>}
            </code>
          </div>
        ))}
      </div>
    </Panel>
  );
}

const TERM = [
  { t: "npm run dev", c: "var(--foreground)" },
  { t: "> ecommerce-website@1.0.0 dev", c: "var(--muted-foreground)" },
  { t: "> nodemon server.js", c: "var(--muted-foreground)" },
  { t: "", c: "" },
  { t: "[nodemon] 2.0.22", c: "var(--warn)" },
  { t: "[nodemon] watching path(s): *.*", c: "var(--warn)" },
  { t: "[nodemon] starting `node server.js`", c: "var(--warn)" },
  { t: "Server running on port 5000", c: "var(--foreground)" },
  { t: "MongoDB Connected", c: "var(--success)" },
  { t: "API running at http://localhost:5000", c: "var(--cyan)" },
  { t: "PASS  tests/auth.spec.js (18 tests)", c: "var(--success)" },
  { t: "Build: ok · 312ms", c: "var(--muted-foreground)" },
];

export function Terminal() {
  return (
    <Panel title="Terminal" bodyClassName="p-0">
      <div className="scanlines relative h-[168px] overflow-y-auto bg-[color-mix(in_oklab,black_55%,transparent)] p-2 text-[10px] leading-[1.5]">
        {TERM.map((l, i) => (
          <p key={i} style={{ color: l.c }}>{l.t || "\u00a0"}</p>
        ))}
        <span className="anim-blink" style={{ color: "var(--cyan)" }}>▌</span>
      </div>
    </Panel>
  );
}

const MODES = [
  { label: "Build", icon: Code2, color: "var(--cyan)", active: true },
  { label: "Debug", icon: Bug, color: "var(--success)" },
  { label: "Test", icon: ShieldCheck, color: "var(--cyan)" },
  { label: "Deploy", icon: Rocket, color: "var(--violet)" },
  { label: "Docs", icon: BookOpen, color: "var(--gold)" },
  { label: "Settings", icon: Settings2, color: "var(--muted-foreground)" },
];

export function BottomHud() {
  const [sel, setSel] = useState(0);
  return (
    <div className="hud-panel flex items-center gap-3 px-3 py-1.5">
      {/* player status */}
      <div className="flex items-center gap-2 pr-3">
        <span className="grid size-9 place-items-center border border-[var(--hud-line)] font-display text-[9px]" style={{ color: "var(--cyan)" }}>
          JV
        </span>
        <div className="space-y-0.5 text-[9px]">
          {[
            ["HP", 100, 100, "var(--error)"],
            ["ENERGY", 87, 100, "var(--warn)"],
            ["EXP", 8420, 12000, "var(--gold)"],
          ].map(([l, v, m, c]) => (
            <div key={l as string} className="flex items-center gap-2">
              <span className="w-12 text-muted-foreground">{l}</span>
              <div className="h-1.5 w-32 bg-[color-mix(in_oklab,var(--foreground)_10%,transparent)]">
                <div className="h-full" style={{ width: `${((v as number) / (m as number)) * 100}%`, background: c as string, boxShadow: `0 0 6px ${c}` }} />
              </div>
              <span className="text-muted-foreground">
                {(v as number).toLocaleString()}/{(m as number).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto flex items-center gap-1.5">
        {MODES.map((m, i) => {
          const on = i === sel;
          return (
            <button
              key={m.label}
              onClick={() => setSel(i)}
              className="flex w-[70px] flex-col items-center gap-1 border px-2 py-1.5 transition-all"
              style={{
                borderColor: on ? m.color : "var(--hud-line)",
                background: on ? `color-mix(in oklab, ${m.color} 14%, transparent)` : "transparent",
                boxShadow: on ? `0 0 18px -8px ${m.color}` : undefined,
              }}
            >
              <m.icon className="size-4" style={{ color: on ? m.color : "var(--muted-foreground)" }} />
              <span className="text-[9px] tracking-widest uppercase" style={{ color: on ? m.color : "var(--muted-foreground)" }}>
                {m.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
