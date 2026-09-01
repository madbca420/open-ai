import { BrowserWindow } from 'electron';
import { JarvisEvent, EventCategory, EventSeverity, WorkspaceType } from './types/schema';
import { getDatabase } from './db';

type EventListener = (event: JarvisEvent) => void;

class EventBus {
  private listeners: Set<EventListener> = new Set();
  private mainWindow: BrowserWindow | null = null;

  public setMainWindow(window: BrowserWindow | null) {
    this.mainWindow = window;
  }

  public createEvent<T = any>(params: {
    type: string;
    category: EventCategory;
    source: string;
    payload: T;
    missionId?: string;
    taskId?: string;
    agentId?: string;
    workspace?: WorkspaceType;
    severity?: EventSeverity;
  }): JarvisEvent<T> {
    return {
      id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      type: params.type,
      category: params.category,
      timestamp: new Date().toISOString(),
      source: params.source,
      missionId: params.missionId,
      taskId: params.taskId,
      agentId: params.agentId,
      workspace: params.workspace,
      severity: params.severity || 'INFO',
      payload: params.payload,
    };
  }

  public emit(event: JarvisEvent): void {
    // 1. Notify in-process subscribers with error isolation
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error(`[EventBus] Subscriber error handling event ${event.type}:`, err);
      }
    }

    // 2. Broadcast to Renderer via IPC if main window exists and is not destroyed
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.webContents.send('jarvis:event', event);
      } catch (ipcErr) {
        console.error('[EventBus] Error broadcasting IPC event to renderer:', ipcErr);
      }
    }

    // 3. Persist significant canonical events to SQLite DB (skip high-frequency streaming events)
    if (this.shouldPersistEvent(event)) {
      try {
        const db = getDatabase();
        db.prepare(`
          INSERT INTO events (id, type, category, source, mission_id, task_id, agent_id, workspace, severity, payload, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          event.id,
          event.type,
          event.category,
          event.source,
          event.missionId || null,
          event.taskId || null,
          event.agentId || null,
          event.workspace || null,
          event.severity || 'INFO',
          JSON.stringify(event.payload || {}),
          event.timestamp
        );
      } catch (dbErr) {
        console.error('[EventBus] Database event persistence error:', dbErr);
      }
    }
  }

  public subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public unsubscribe(listener: EventListener): void {
    this.listeners.delete(listener);
  }

  private shouldPersistEvent(event: JarvisEvent): boolean {
    // Skip token stream deltas or high-frequency telemetry
    if (event.type.includes('stream-chunk') || event.type.includes('telemetry:tick')) {
      return false;
    }
    return true;
  }
}

export const eventBus = new EventBus();
