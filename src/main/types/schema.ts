/**
 * JARVIS Master System Schemas
 * Canonical types for Workspaces, Events, Missions, Tasks, Agents, Commands, Artifacts, and Memory.
 */

export type WorkspaceType =
  | 'COMMAND_CENTER'
  | 'DEVELOPMENT'
  | 'TRADING'
  | 'WEBSITE_BUILDER'
  | 'RESEARCH'
  | 'AUTOMATION'
  | 'CREATIVE'
  | 'VOICE'
  | 'SETTINGS';

export type AgentState =
  | 'IDLE'
  | 'ROUTING'
  | 'QUEUED'
  | 'WORKING'
  | 'REVIEWING'
  | 'WAITING_APPROVAL'
  | 'SUCCESS'
  | 'ERROR'
  | 'CANCELLED';

export type EventCategory =
  | 'SYSTEM'
  | 'COMMAND'
  | 'MISSION'
  | 'TASK'
  | 'AGENT'
  | 'MODEL'
  | 'TOOL'
  | 'VOICE'
  | 'TRADING'
  | 'RESEARCH'
  | 'CREATIVE'
  | 'WEBSITE'
  | 'PROCESS'
  | 'MEMORY'
  | 'ARTIFACT'
  | 'ADAPTER'
  | 'SECURITY'
  | 'ERROR';

export type EventSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

export interface JarvisEvent<T = any> {
  id: string;
  type: string;
  category: EventCategory;
  timestamp: string; // ISO 8601 UTC
  source: string;
  missionId?: string;
  taskId?: string;
  agentId?: string;
  workspace?: WorkspaceType;
  severity?: EventSeverity;
  payload: T;
}

export type CommandSource = 'CHAT' | 'VOICE' | 'SYSTEM' | 'AUTOMATION';

export interface CommandRequest {
  id: string;
  source: CommandSource;
  text: string;
  workspace?: WorkspaceType;
  sessionId?: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

export interface CommandResult {
  requestId: string;
  intent: string;
  workspace: WorkspaceType;
  handled: boolean;
  message: string;
  payload?: any;
  error?: string;
}

/**
 * Structured intent produced by CommandRouter.parseIntent().
 * Carries confidence, extracted arguments, and routing hints.
 */
export interface CommandIntent {
  /** Unique intent instance ID */
  id: string;
  /** High-level intent label (e.g. 'WEBSITE_BUILD', 'IMAGE_GENERATE') */
  intent: string;
  /** Adapter capability to invoke, if applicable (e.g. 'creative.image.generate') */
  capability?: string;
  /** Target workspace for this intent */
  targetWorkspace: WorkspaceType;
  /** Extracted named arguments from the raw text */
  arguments: Record<string, any>;
  /**
   * Confidence score 0.0–1.0.
   * ≥0.8 = high-confidence deterministic match
   * 0.5–0.8 = probable match (keyword heuristic)
   * <0.5 = low-confidence / general chat fallback
   */
  confidence: number;
  /** Whether this intent must be confirmed before execution */
  requiresConfirmation: boolean;
  /** Original command source */
  source: CommandSource;
  /** ISO 8601 timestamp */
  timestamp: string;
}

export type TaskStatus =
  | 'PENDING'
  | 'BLOCKED'
  | 'READY'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'SKIPPED';

export interface Task {
  id: string;
  missionId: string;
  parentTaskId?: string;
  name: string;
  description: string;
  dependencies: string[];
  assignedAgent?: string;
  assignedModel?: string;
  status: TaskStatus;
  startTime?: string;
  endTime?: string;
  input?: any;
  output?: any;
  error?: string;
  artifacts?: string[];
}

export interface TaskGraph {
  missionId: string;
  tasks: Record<string, Task>;
  rootTaskIds: string[];
}

export type MissionStatus =
  | 'CREATED'
  | 'PLANNING'
  | 'READY'
  | 'RUNNING'
  | 'PAUSED'
  | 'RESEARCHING'
  | 'WORKING'
  | 'WAITING'
  | 'TESTING'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface Mission {
  id: string;
  name: string;
  description: string;
  workspace: WorkspaceType;
  status: MissionStatus;
  progress: number; // 0 to 100
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, any>;
}

export type ArtifactType =
  | 'CODE'
  | 'WEBSITE'
  | 'IMAGE'
  | 'VIDEO'
  | 'AUDIO'
  | 'VOICE'
  | 'REPORT'
  | 'DATASET'
  | 'DIFF'
  | 'BACKTEST'
  | 'ANALYSIS'
  | 'TRADING_ANALYSIS'
  | 'SIMULATION'
  | 'AVATAR'
  | 'DOCUMENT';

export interface Artifact {
  id: string;
  type: ArtifactType;
  name: string;
  path: string;
  checksum?: string;
  createdAt: string;
  createdBy: string;
  missionId?: string;
  taskId?: string;
  metadata?: Record<string, any>;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  enabled: boolean;
  permissionLevel: number; // 0 (read-only) to 4 (restricted)
}

export interface MemoryRecord {
  id: string;
  category: 'CONVERSATION' | 'PROJECT' | 'TASK' | 'PREFERENCE' | 'FACT' | 'DECISION' | 'SYSTEM';
  sessionId?: string;
  key?: string;
  content: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface ProcessInfo {
  processId: string;
  pid?: number;
  type: string;
  command: string;
  status: 'RUNNING' | 'EXITED' | 'KILLED' | 'FAILED';
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  missionId?: string;
  taskId?: string;
}

// Financial Trading Contract (Schemas only - logic un-implemented in Phase 2)
export type TradeAction = 'BUY' | 'SELL' | 'HOLD' | 'NO_TRADE';

export interface TradingDecision {
  symbol: string;
  action: TradeAction;
  confidence: number;
  conviction: number;
  entry?: number;
  stopLoss?: number;
  target?: number;
  positionSize?: number;
  riskReward?: number;
  riskScore?: number;
  riskStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  executionMode: 'PAPER' | 'LIVE_DISABLED';
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4 — Adapter System Types
// ─────────────────────────────────────────────────────────────────────────────

export type AdapterStatus =
  | 'UNAVAILABLE'
  | 'DISABLED'
  | 'INITIALIZING'
  | 'READY'
  | 'BUSY'
  | 'ERROR'
  | 'STOPPING'
  | 'STOPPED';

export type AdapterCategory =
  | 'CREATIVE'
  | 'VOICE'
  | 'AVATAR'
  | 'TRADING'
  | 'RESEARCH'
  | 'AUTOMATION'
  | 'DEVELOPMENT'
  | 'SECURITY';

export interface AdapterCapability {
  /** Unique capability identifier, e.g. 'image.generate' */
  id: string;
  name: string;
  description?: string;
  requiresGPU?: boolean;
  requiresPython?: boolean;
  requiresAuth?: boolean;
  requiresConfirmation?: boolean;
}

export interface AdapterInput {
  executionId: string;
  adapterId: string;
  capability: string;
  missionId?: string;
  taskId?: string;
  payload: Record<string, any>;
  timestamp: string;
}

export interface AdapterOutput {
  success: boolean;
  executionId: string;
  adapterId: string;
  output?: any;
  /** Artifact IDs registered in the Artifact Registry */
  artifactIds?: string[];
  error?: string;
  metadata?: Record<string, any>;
  duration_ms?: number;
}

/**
 * Serialisable adapter descriptor — used by the registry and Settings UI.
 * Does NOT include runtime handles or sensitive credentials.
 */
export interface AdapterInfo {
  id: string;
  name: string;
  version: string;
  category: AdapterCategory;
  status: AdapterStatus;
  enabled: boolean;
  capabilities: AdapterCapability[];
  /** Human-readable dependency list, e.g. ['python>=3.10', 'iopaint'] */
  dependencies: string[];
  requiresGPU: boolean;
  requiresPython: boolean;
  lastHealthCheck?: string;
  lastError?: string;
  notes?: string;
}

export interface RiskEvaluation {
  id: string;
  symbol: string;
  approved: boolean;
  reason: string;
  riskScore: number;
  timestamp: string;
}
