/**
 * auditLog.ts — SQLite audit log manager for automation actions.
 * Logs timestamp, tool name, input, outcome, and result/error.
 * Supports early-startup log buffering when called before DB init.
 */

import { getDatabase } from './db';

export interface AuditLogEntry {
  id: number;
  action_type: string;
  details: string;
  status: string;
  created_at: string;
}

interface BufferedLog {
  actionType: string;
  details: string;
  status: 'ATTEMPTED' | 'CONFIRMED' | 'DENIED' | 'EXECUTED' | 'FAILED' | 'SUCCESS';
  timestamp: string;
}

const pendingAuditLogs: BufferedLog[] = [];

export function logAudit(
  actionType: string,
  details: string,
  status: 'ATTEMPTED' | 'CONFIRMED' | 'DENIED' | 'EXECUTED' | 'FAILED' | 'SUCCESS'
): void {
  try {
    const db = getDatabase();
    // Flush any pending logs first
    while (pendingAuditLogs.length > 0) {
      const item = pendingAuditLogs.shift();
      if (item) {
        db.prepare(`
          INSERT INTO system_audit_logs (action_type, details, status)
          VALUES (?, ?, ?)
        `).run(item.actionType, item.details, item.status);
      }
    }

    db.prepare(`
      INSERT INTO system_audit_logs (action_type, details, status)
      VALUES (?, ?, ?)
    `).run(actionType, details, status);
  } catch (err: any) {
    if (err?.message?.includes('Database not initialized')) {
      // Buffer early-boot logs safely without throwing stack traces
      pendingAuditLogs.push({ actionType, details, status, timestamp: new Date().toISOString() });
    } else {
      console.warn('[AuditLog] Audit log insert warning:', err?.message || String(err));
    }
  }
}

export function flushPendingAuditLogs(): void {
  if (pendingAuditLogs.length === 0) return;
  try {
    const db = getDatabase();
    while (pendingAuditLogs.length > 0) {
      const item = pendingAuditLogs.shift();
      if (item) {
        db.prepare(`
          INSERT INTO system_audit_logs (action_type, details, status)
          VALUES (?, ?, ?)
        `).run(item.actionType, item.details, item.status);
      }
    }
  } catch {
    // Ignore until DB is ready
  }
}

export function getAuditLogs(limit = 100): AuditLogEntry[] {
  try {
    flushPendingAuditLogs();
    const db = getDatabase();
    return db.prepare(`
      SELECT id, action_type, details, status, created_at
      FROM system_audit_logs
      ORDER BY id DESC
      LIMIT ?
    `).all(limit) as AuditLogEntry[];
  } catch {
    return [];
  }
}

export function clearAuditLogs(): void {
  try {
    pendingAuditLogs.length = 0;
    const db = getDatabase();
    db.prepare('DELETE FROM system_audit_logs').run();
  } catch {
    /* ignore */
  }
}
