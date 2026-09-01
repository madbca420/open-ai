import { spawn, ChildProcess } from 'child_process';
import { ProcessInfo } from './types/schema';
import { eventBus } from './eventBus';
import { getDatabase } from './db';

export class ProcessSupervisor {
  private activeProcesses: Map<string, { proc: ChildProcess; info: ProcessInfo }> = new Map();

  public spawnManagedProcess(params: {
    processId?: string;
    type: string;
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    missionId?: string;
    taskId?: string;
  }): ProcessInfo {
    const processId = params.processId || `proc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const info: ProcessInfo = {
      processId,
      type: params.type,
      command: `${params.command} ${(params.args || []).join(' ')}`.trim(),
      status: 'RUNNING',
      startedAt: now,
      missionId: params.missionId,
      taskId: params.taskId,
    };

    try {
      const child = spawn(params.command, params.args || [], {
        cwd: params.cwd || process.cwd(),
        env: { ...process.env, ...(params.env || {}) },
        shell: true,
      });

      info.pid = child.pid;
      this.activeProcesses.set(processId, { proc: child, info });
      this.persistProcess(info);

      eventBus.emit(
        eventBus.createEvent({
          type: 'process.started',
          category: 'PROCESS',
          source: 'ProcessSupervisor',
          missionId: params.missionId,
          taskId: params.taskId,
          payload: { processId, pid: child.pid, command: info.command },
        })
      );

      // Stdout stream monitoring
      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString('utf8').trim();
        if (text) {
          eventBus.emit(
            eventBus.createEvent({
              type: 'process.stdout',
              category: 'PROCESS',
              source: 'ProcessSupervisor',
              missionId: params.missionId,
              taskId: params.taskId,
              payload: { processId, text },
            })
          );
        }
      });

      // Stderr stream monitoring
      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString('utf8').trim();
        if (text) {
          eventBus.emit(
            eventBus.createEvent({
              type: 'process.stderr',
              category: 'PROCESS',
              source: 'ProcessSupervisor',
              missionId: params.missionId,
              taskId: params.taskId,
              severity: 'WARNING',
              payload: { processId, text },
            })
          );
        }
      });

      // Process Exit
      child.on('close', (code: number | null) => {
        info.status = code === 0 ? 'EXITED' : 'FAILED';
        info.endedAt = new Date().toISOString();
        info.exitCode = code ?? -1;

        this.activeProcesses.delete(processId);
        this.persistProcess(info);

        eventBus.emit(
          eventBus.createEvent({
            type: code === 0 ? 'process.stopped' : 'process.failed',
            category: 'PROCESS',
            source: 'ProcessSupervisor',
            missionId: params.missionId,
            taskId: params.taskId,
            severity: code === 0 ? 'INFO' : 'ERROR',
            payload: { processId, exitCode: code },
          })
        );
      });

      child.on('error', (err) => {
        console.error(`[ProcessSupervisor] Process ${processId} error:`, err);
        info.status = 'FAILED';
        info.endedAt = new Date().toISOString();
        this.activeProcesses.delete(processId);
        this.persistProcess(info);

        eventBus.emit(
          eventBus.createEvent({
            type: 'process.failed',
            category: 'PROCESS',
            source: 'ProcessSupervisor',
            missionId: params.missionId,
            taskId: params.taskId,
            severity: 'ERROR',
            payload: { processId, error: err.message },
          })
        );
      });

      return info;
    } catch (err: any) {
      console.error(`[ProcessSupervisor] Spawn failed for ${processId}:`, err);
      info.status = 'FAILED';
      info.endedAt = new Date().toISOString();
      this.persistProcess(info);
      return info;
    }
  }

  public killProcess(processId: string): boolean {
    const entry = this.activeProcesses.get(processId);
    if (!entry) return false;

    try {
      entry.proc.kill('SIGTERM');
      setTimeout(() => {
        if (!entry.proc.killed) {
          entry.proc.kill('SIGKILL');
        }
      }, 2000);

      entry.info.status = 'KILLED';
      entry.info.endedAt = new Date().toISOString();
      this.activeProcesses.delete(processId);
      this.persistProcess(entry.info);

      eventBus.emit(
        eventBus.createEvent({
          type: 'process.killed',
          category: 'PROCESS',
          source: 'ProcessSupervisor',
          missionId: entry.info.missionId,
          taskId: entry.info.taskId,
          payload: { processId },
        })
      );
      return true;
    } catch (err) {
      console.error(`[ProcessSupervisor] Error killing process ${processId}:`, err);
      return false;
    }
  }

  public killMissionProcesses(missionId: string): number {
    let killedCount = 0;
    for (const [processId, entry] of this.activeProcesses.entries()) {
      if (entry.info.missionId === missionId) {
        if (this.killProcess(processId)) {
          killedCount++;
        }
      }
    }
    return killedCount;
  }

  public getActiveProcesses(): ProcessInfo[] {
    return Array.from(this.activeProcesses.values()).map((e) => e.info);
  }

  private persistProcess(info: ProcessInfo): void {
    try {
      const db = getDatabase();
      db.prepare(`
        INSERT INTO processes (process_id, pid, type, command, status, started_at, ended_at, exit_code, mission_id, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(process_id) DO UPDATE SET
          status = excluded.status,
          ended_at = excluded.ended_at,
          exit_code = excluded.exit_code
      `).run(
        info.processId,
        info.pid || null,
        info.type,
        info.command,
        info.status,
        info.startedAt,
        info.endedAt || null,
        info.exitCode ?? null,
        info.missionId || null,
        info.taskId || null
      );
    } catch (err) {
      console.error(`[ProcessSupervisor] Error persisting process ${info.processId}:`, err);
    }
  }
}

export const processSupervisor = new ProcessSupervisor();
