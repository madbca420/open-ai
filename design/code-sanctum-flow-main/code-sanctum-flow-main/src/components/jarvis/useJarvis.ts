import { useEffect, useState } from "react";
import { AGENTS, type AgentId, type AgentState } from "@/lib/jarvis";

const CYCLE: AgentState[] = ["working", "thinking", "working", "reviewing", "debugging", "completed", "idle"];

export interface AgentRuntime {
  state: AgentState;
  message: string;
  progress: number;
  file: string;
  time: string;
}

const clock = () => {
  const d = new Date();
  return d.toLocaleTimeString("en-US", { hour12: true, hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

function pick<T>(arr: readonly T[]) {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function nextFor(id: AgentId, prev: AgentRuntime): AgentRuntime {
  const def = AGENTS.find((a) => a.id === id)!;
  const idx = CYCLE.indexOf(prev.state);
  const state = CYCLE[(idx + 1) % CYCLE.length]!;
  const bank = state === "completed" || state === "idle" ? null : def.lines[state];
  const message =
    state === "completed"
      ? "Task complete ✓"
      : state === "idle"
        ? "Awaiting next task..."
        : pick(bank!);
  const progress = state === "completed" ? 100 : state === "idle" ? 0 : Math.min(96, 20 + Math.random() * 70);
  return { state, message, progress, file: pick(def.files), time: clock() };
}

export function useJarvis() {
  const [agents, setAgents] = useState<Record<AgentId, AgentRuntime>>(() => ({
    deepseek: { state: "working", message: "Writing API routes...", progress: 72, file: "userController.js", time: "10:24:31 PM" },
    glm: { state: "thinking", message: "Designing database schema...", progress: 58, file: "schema.prisma", time: "10:24:28 PM" },
    gptoss: { state: "reviewing", message: "Reviewing code...", progress: 45, file: "auth.middleware.js", time: "10:24:25 PM" },
  }));
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timers = AGENTS.map((a, i) =>
      setInterval(
        () => setAgents((prev) => ({ ...prev, [a.id]: nextFor(a.id, prev[a.id]) })),
        4200 + i * 1700,
      ),
    );
    const drift = setInterval(() => {
      setAgents((prev) => {
        const out = { ...prev };
        for (const a of AGENTS) {
          const cur = out[a.id];
          if (cur.state !== "completed" && cur.state !== "idle") {
            out[a.id] = { ...cur, progress: Math.min(99, cur.progress + Math.random() * 2), time: clock() };
          }
        }
        return out;
      });
      setTick((t) => t + 1);
    }, 1200);
    return () => {
      timers.forEach(clearInterval);
      clearInterval(drift);
    };
  }, []);

  return { agents, tick };
}
