/**
 * JARVIS IPC Contracts and Channel Definitions
 */

import { JarvisEvent, CommandRequest, CommandResult, WorkspaceType, Mission, Task, Artifact, AdapterInfo, AdapterOutput } from './schema';

export interface IpcResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export type EventListener = (event: JarvisEvent) => void;

export interface IpcChannels {
  // Commands
  'command:send': (request: Omit<CommandRequest, 'id' | 'timestamp'>) => Promise<CommandResult>;

  // Events
  'event:subscribe': (listener: EventListener) => () => void;

  // Workspace
  'workspace:get-active': () => Promise<WorkspaceType>;
  'workspace:set-active': (workspace: WorkspaceType) => Promise<boolean>;

  // Missions & Tasks (Read-only foundation for Phase 2)
  'mission:list': () => Promise<Mission[]>;
  'task:list': (missionId: string) => Promise<Task[]>;

  // Artifacts
  'artifact:list': () => Promise<Artifact[]>;

  // Phase 4 Adapters Infrastructure
  'adapter:list': () => Promise<AdapterInfo[]>;
  'adapter:status': (adapterId: string) => Promise<AdapterInfo | null>;
  'adapter:enable': (adapterId: string) => Promise<AdapterEnableResult>;
  'adapter:disable': (adapterId: string) => Promise<AdapterDisableResult>;
  'adapter:execute': (input: AdapterExecuteRequest) => Promise<AdapterOutput>;
  'adapter:cancel': (payload: { adapterId: string; executionId: string }) => Promise<AdapterCancelResult>;
}

export interface AdapterEnableResult {
  success: boolean;
  adapterId: string;
  enabled: boolean;
  error?: string;
}

export interface AdapterDisableResult {
  success: boolean;
  adapterId: string;
  enabled: false;
  error?: string;
}

export interface AdapterExecuteRequest {
  adapterId: string;
  capability?: string;
  missionId?: string;
  taskId?: string;
  payload?: Record<string, any>;
}

export interface AdapterCancelResult {
  success: boolean;
  adapterId: string;
  executionId: string;
  error?: string;
}

