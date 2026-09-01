export type AgentState = "working" | "thinking" | "reviewing" | "debugging" | "completed" | "idle";

export type AgentId = "deepseek" | "glm" | "gptoss";

export interface AgentDef {
  id: AgentId;
  name: string;
  role: string;
  accent: string; // css var
  lines: Record<Exclude<AgentState, "idle" | "completed">, string[]>;
  files: string[];
}

export const AGENTS: AgentDef[] = [
  {
    id: "deepseek",
    name: "DeepSeek V4 Flash",
    role: "Primary Developer",
    accent: "var(--cyan)",
    files: ["userController.js", "auth.routes.js", "cart.service.js", "order.model.js"],
    lines: {
      working: [
        "Writing API routes...",
        "Implementing authentication...",
        "Creating userController.js...",
        "Running backend tests...",
      ],
      thinking: ["Resolving dependency graph...", "Planning route handlers..."],
      reviewing: ["Re-reading diff...", "Verifying response shapes..."],
      debugging: ["Fixing validation error...", "Trace: 500 on /api/cart"],
    },
  },
  {
    id: "glm",
    name: "GLM-4.5-Air",
    role: "Architect",
    accent: "var(--gold)",
    files: ["schema.prisma", "architecture.md", "services.map", "indexes.sql"],
    lines: {
      working: ["Designing database schema...", "Mapping API dependencies...", "Optimizing database structure..."],
      thinking: ["Planning service architecture...", "Weighing normalization tradeoffs..."],
      reviewing: ["Validating entity relations...", "Checking migration order..."],
      debugging: ["Schema drift detected...", "Repairing relation index..."],
    },
  },
  {
    id: "gptoss",
    name: "GPT-OSS 20B",
    role: "Code Reviewer",
    accent: "var(--violet)",
    files: ["auth.middleware.js", "rateLimit.js", "payment.spec.ts", "sanitize.js"],
    lines: {
      working: ["Analyzing middleware...", "Static analysis pass 2..."],
      thinking: ["Modeling threat surface...", "Considering token rotation..."],
      reviewing: ["Reviewing code...", "Checking security...", "Found 2 potential issues..."],
      debugging: ["Blocking merge: unsafe input...", "Suspect regex backtracking..."],
    },
  },
];

export const STATE_META: Record<AgentState, { label: string; color: string }> = {
  working: { label: "WORKING", color: "var(--cyan)" },
  thinking: { label: "THINKING", color: "var(--blue)" },
  reviewing: { label: "REVIEWING", color: "var(--violet)" },
  debugging: { label: "DEBUGGING", color: "var(--error)" },
  completed: { label: "COMPLETED", color: "var(--success)" },
  idle: { label: "IDLE", color: "var(--muted-foreground)" },
};

export const MISSION_TASKS = [
  { label: "Project Setup", status: "done" },
  { label: "Database Design", status: "done" },
  { label: "API Development", status: "active" },
  { label: "Frontend Setup", status: "todo" },
  { label: "Authentication", status: "todo" },
  { label: "Payment Integration", status: "todo" },
  { label: "Testing & Deployment", status: "todo" },
] as const;

export const CONSOLE_SEED: { text: string; tone: "cmd" | "ok" | "info" | "warn" | "err" }[] = [
  { text: "> jarvis start --mission ecommerce", tone: "cmd" },
  { text: "Initializing JARVIS AI...", tone: "info" },
  { text: "> Loading AI Agents...", tone: "cmd" },
  { text: "[✓] DeepSeek V4 Flash — Online", tone: "ok" },
  { text: "[✓] GLM-4.5-Air — Online", tone: "ok" },
  { text: "[✓] GPT-OSS 20B — Online", tone: "ok" },
  { text: "> Mission Accepted", tone: "cmd" },
  { text: "> Analyzing Requirements...", tone: "cmd" },
  { text: "> Creating Project Structure...", tone: "cmd" },
  { text: "> Installing Dependencies...", tone: "cmd" },
  { text: "> Starting Development Server...", tone: "cmd" },
  { text: "> All systems operational.", tone: "ok" },
  { text: "> Agents are working...", tone: "info" },
];

export const CONSOLE_STREAM: { text: string; tone: "cmd" | "ok" | "info" | "warn" | "err" }[] = [
  { text: "> GET /api/products 200 · 14ms", tone: "info" },
  { text: "[✓] schema.prisma migrated", tone: "ok" },
  { text: "! deprecated: crypto.createCipher", tone: "warn" },
  { text: "> DeepSeek → GPT-OSS : diff #241", tone: "cmd" },
  { text: "[✓] 18 tests passed", tone: "ok" },
  { text: "x 401 unauthorized /api/cart", tone: "err" },
  { text: "> GPT-OSS → DeepSeek : review notes", tone: "cmd" },
  { text: "[✓] Code approved", tone: "ok" },
  { text: "> hot reload · 312ms", tone: "info" },
];
