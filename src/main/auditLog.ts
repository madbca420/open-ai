/**
 * auditLog.ts — SQLite audit log manager for automation actions.
 * Logs timestamp, tool name, input, outcome, and result/error.
 */

import { getDatabase } from './db';

export interface AuditLogEntry {
  id: number;
  action_type: string;
  details: string;
  status: string;
  created_at: string;
}

export function logAudit(actionType: string, details: string, status: 'ATTEMPTED' | 'CONFIRMED' | 'DENIED' | 'EXECUTED' | 'FAILED' | 'SUCCESS'): void {
  try {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO system_audit_logs (action_type, details, status)
      VALUES (?, ?, ?)
    `).run(actionType, details, status);
  } catch (err) {
    console.error('[AuditLog] Failed to record audit log:', err);
  }
}

export function getAuditLogs(limit = 100): AuditLogEntry[] {
  try {
    const db = getDatabase();
    return db.prepare(`
      SELECT id, action_type, details, status, created_at
      FROM system_audit_logs
      ORDER BY id DESC
      LIMIT ?
    `).all(limit) as AuditLogEntry[];
  } catch (err) {
    console.error('[AuditLog] Failed to fetch audit logs:', err);
    return [];
  }
}

export function clearAuditLogs(): void {
  try {
    const db = getDatabase();
    db.prepare('DELETE FROM system_audit_logs').run();
  } catch (err) {
    console.error('[AuditLog] Failed to clear audit logs:', err);
  }
}
