/**
 * confirmation.ts — Confirmation Gating & Settings Manager
 *
 * Manages tool confirmation rules:
 *  - run_shell_command: ALWAYS CONFIRM (Locked, cannot be disabled)
 *  - open_application, focus_window, write_clipboard: 'always' | 'once_per_session'
 *  - Read-only tools (list_open_windows, read_clipboard, take_screenshot): Auto-allowed
 */

import { getDatabase } from './db';
import { logAudit } from './auditLog';

export type ToolConfirmationMode = 'always' | 'once_per_session';

export interface ToolConfirmationSettings {
  open_application: ToolConfirmationMode;
  focus_window: ToolConfirmationMode;
  write_clipboard: ToolConfirmationMode;
  run_shell_command: 'always'; // Locked
}

const confirmedInSession = new Set<string>();

export function getToolConfirmationSettings(): ToolConfirmationSettings {
  const db = getDatabase();
  const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'confirm_%'").all() as { key: string; value: string }[];
  const map = new Map(rows.map(r => [r.key, r.value]));

  return {
    open_application: (map.get('confirm_open_application') as ToolConfirmationMode) || 'always',
    focus_window: (map.get('confirm_focus_window') as ToolConfirmationMode) || 'always',
    write_clipboard: (map.get('confirm_write_clipboard') as ToolConfirmationMode) || 'always',
    run_shell_command: 'always', // Strictly locked
  };
}

export function setToolConfirmationSetting(toolName: keyof ToolConfirmationSettings, mode: ToolConfirmationMode): void {
  if (toolName === 'run_shell_command') {
    throw new Error('run_shell_command is locked to always confirm for security.');
  }

  const db = getDatabase();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(`confirm_${toolName}`, mode);
  logAudit('SETTING_CHANGE', `Tool confirmation for ${toolName} set to ${mode}`, 'SUCCESS');
}

/**
 * Determines whether a tool call requires explicit user confirmation.
 */
export function requiresConfirmation(toolName: string): boolean {
  // Read-only tools never require confirmation
  const READ_ONLY_TOOLS = new Set(['list_open_windows', 'read_clipboard', 'take_screenshot']);
  if (READ_ONLY_TOOLS.has(toolName)) return false;

  // run_shell_command ALWAYS requires confirmation — non-negotiable
  if (toolName === 'run_shell_command') return true;

  const settings = getToolConfirmationSettings();
  const mode = settings[toolName as keyof ToolConfirmationSettings] || 'always';

  if (mode === 'always') return true;

  // Check if confirmed once in session
  return !confirmedInSession.has(toolName);
}

export function markConfirmedInSession(toolName: string): void {
  if (toolName !== 'run_shell_command') {
    confirmedInSession.add(toolName);
  }
}
