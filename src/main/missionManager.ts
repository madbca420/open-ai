import { Mission, MissionStatus, WorkspaceType } from './types/schema';
import { eventBus } from './eventBus';
import { getDatabase } from './db';

export class MissionManager {
  private activeMissions: Map<string, Mission> = new Map();

  public createMission(params: {
    id?: string;
    name: string;
    description: string;
    workspace: WorkspaceType;
    metadata?: Record<string, any>;
  }): Mission {
    const missionId = params.id || `mission_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const mission: Mission = {
      id: missionId,
      name: params.name,
      description: params.description,
      workspace: params.workspace,
      status: 'CREATED',
      progress: 0,
      createdAt: now,
      updatedAt: now,
      metadata: params.metadata || {},
    };

    this.activeMissions.set(mission.id, mission);
    this.persistMission(mission);

    eventBus.emit(
      eventBus.createEvent({
        type: 'mission.created',
        category: 'MISSION',
        source: 'MissionManager',
        missionId: mission.id,
        workspace: mission.workspace,
        payload: { mission },
      })
    );

    return mission;
  }

  public updateStatus(missionId: string, status: MissionStatus, progress?: number, error?: string): Mission | null {
    const mission = this.getMission(missionId);
    if (!mission) {
      console.warn(`[MissionManager] Mission not found: ${missionId}`);
      return null;
    }

    // Validate state transitions
    if (!this.isValidTransition(mission.status, status)) {
      console.warn(`[MissionManager] Invalid state transition: ${mission.status} -> ${status} for mission ${missionId}`);
      return mission;
    }

    mission.status = status;
    if (progress !== undefined) {
      mission.progress = Math.max(0, Math.min(100, progress));
    }
    mission.updatedAt = new Date().toISOString();

    this.activeMissions.set(mission.id, mission);
    this.persistMission(mission);

    const eventType = `mission.${status.toLowerCase()}`;
    eventBus.emit(
      eventBus.createEvent({
        type: eventType,
        category: 'MISSION',
        source: 'MissionManager',
        missionId: mission.id,
        workspace: mission.workspace,
        severity: status === 'FAILED' ? 'ERROR' : 'INFO',
        payload: { mission, error },
      })
    );

    return mission;
  }

  public getMission(missionId: string): Mission | null {
    if (this.activeMissions.has(missionId)) {
      return this.activeMissions.get(missionId)!;
    }
    try {
      const db = getDatabase();
      const row = db.prepare('SELECT * FROM missions WHERE id = ?').get(missionId) as any;
      if (!row) return null;

      const mission: Mission = {
        id: row.id,
        name: row.name,
        description: row.description,
        workspace: row.workspace as WorkspaceType,
        status: row.status as MissionStatus,
        progress: row.progress,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
      };
      this.activeMissions.set(mission.id, mission);
      return mission;
    } catch (err) {
      console.error(`[MissionManager] Error reading mission ${missionId} from DB:`, err);
      return null;
    }
  }

  public listMissions(limit = 50): Mission[] {
    try {
      const db = getDatabase();
      const rows = db.prepare('SELECT * FROM missions ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        workspace: row.workspace as WorkspaceType,
        status: row.status as MissionStatus,
        progress: row.progress,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
      }));
    } catch (err) {
      console.error('[MissionManager] Error listing missions:', err);
      return Array.from(this.activeMissions.values());
    }
  }

  private isValidTransition(current: MissionStatus, next: MissionStatus): boolean {
    if (current === next) return true;
    if (current === 'COMPLETED' || current === 'FAILED' || current === 'CANCELLED') {
      return false; // Terminal states
    }

    const allowedTransitions: Record<MissionStatus, MissionStatus[]> = {
      CREATED: ['PLANNING', 'READY', 'RUNNING', 'CANCELLED'],
      PLANNING: ['READY', 'RUNNING', 'FAILED', 'CANCELLED'],
      READY: ['RUNNING', 'PAUSED', 'FAILED', 'CANCELLED'],
      RUNNING: ['PAUSED', 'WAITING', 'TESTING', 'RESEARCHING', 'WORKING', 'COMPLETED', 'FAILED', 'CANCELLED'],
      PAUSED: ['RUNNING', 'CANCELLED'],
      WAITING: ['RUNNING', 'FAILED', 'CANCELLED'],
      TESTING: ['COMPLETED', 'FAILED', 'CANCELLED'],
      RESEARCHING: ['RUNNING', 'WORKING', 'COMPLETED', 'FAILED', 'CANCELLED'],
      WORKING: ['RUNNING', 'TESTING', 'COMPLETED', 'FAILED', 'CANCELLED'],
      BLOCKED: ['READY', 'RUNNING', 'CANCELLED'],
      COMPLETED: [],
      FAILED: [],
      CANCELLED: [],
    };

    return allowedTransitions[current]?.includes(next) ?? false;
  }

  private persistMission(mission: Mission): void {
    try {
      const db = getDatabase();
      db.prepare(`
        INSERT INTO missions (id, name, description, workspace, status, progress, created_at, updated_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          progress = excluded.progress,
          updated_at = excluded.updated_at,
          metadata = excluded.metadata
      `).run(
        mission.id,
        mission.name,
        mission.description,
        mission.workspace,
        mission.status,
        mission.progress,
        mission.createdAt,
        mission.updatedAt,
        JSON.stringify(mission.metadata || {})
      );
    } catch (err) {
      console.error('[MissionManager] Error persisting mission:', err);
    }
  }
}

export const missionManager = new MissionManager();
