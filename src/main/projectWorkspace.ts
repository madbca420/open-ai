/**
 * projectWorkspace.ts — Project Registry & Lifecycle Manager
 *
 * Persists every generated project in SQLite (projects table, v4 migration).
 * Manages CREATE, OPEN, RUN, STOP, MODIFY, DELETE lifecycle.
 * Port allocation is coordinated here to prevent collisions.
 */

import path from 'path';
import fs from 'fs-extra';
import { getDatabase } from './db';
import { logAudit } from './auditLog';

export const SITES_DIR = path.join(process.cwd(), 'generated_sites');

export type ProjectStatus =
  | 'CREATED'
  | 'INSTALLING'
  | 'BUILDING'
  | 'RUNNING'
  | 'STOPPED'
  | 'FAILED'
  | 'MODIFYING';

export interface ProjectRecord {
  id: string;
  name: string;
  slug: string;
  project_dir: string;
  project_type: string;
  status: ProjectStatus;
  frontend_port: number | null;
  backend_port: number | null;
  frontend_url: string | null;
  backend_url: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export class ProjectWorkspace {
  // ── Port allocation: track which ports are in use ──────────────────
  private allocatedPorts = new Set<number>();

  public create(params: {
    id: string;
    name: string;
    slug: string;
    projectDir: string;
    projectType?: string;
  }): ProjectRecord {
    const now = new Date().toISOString();
    const db = getDatabase();
    db.prepare(`
      INSERT INTO projects (id, name, slug, project_dir, project_type, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'CREATED', ?, ?)
    `).run(params.id, params.name, params.slug, params.projectDir, params.projectType || 'fullstack', now, now);

    logAudit('PROJECT_CREATE', `Project "${params.name}" (${params.id}) created at ${params.projectDir}`, 'SUCCESS');
    return this.get(params.id)!;
  }

  public get(id: string): ProjectRecord | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRecord | undefined;
    return row ?? null;
  }

  public getBySlug(slug: string): ProjectRecord | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug) as ProjectRecord | undefined;
    return row ?? null;
  }

  public list(limit = 50): ProjectRecord[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM projects ORDER BY created_at DESC LIMIT ?').all(limit) as ProjectRecord[];
  }

  public updateStatus(
    id: string,
    status: ProjectStatus,
    extras?: {
      frontendPort?: number;
      backendPort?: number;
      frontendUrl?: string;
      backendUrl?: string;
      metadata?: Record<string, any>;
    }
  ): void {
    const now = new Date().toISOString();
    const db = getDatabase();
    db.prepare(`
      UPDATE projects SET
        status = ?,
        frontend_port = COALESCE(?, frontend_port),
        backend_port = COALESCE(?, backend_port),
        frontend_url = COALESCE(?, frontend_url),
        backend_url = COALESCE(?, backend_url),
        metadata = COALESCE(?, metadata),
        updated_at = ?
      WHERE id = ?
    `).run(
      status,
      extras?.frontendPort ?? null,
      extras?.backendPort ?? null,
      extras?.frontendUrl ?? null,
      extras?.backendUrl ?? null,
      extras?.metadata ? JSON.stringify(extras.metadata) : null,
      now,
      id
    );
  }

  public delete(id: string): boolean {
    const project = this.get(id);
    if (!project) return false;
    const db = getDatabase();
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    logAudit('PROJECT_DELETE', `Project ${id} removed from registry`, 'SUCCESS');
    return true;
  }

  // ── Log persistence ────────────────────────────────────────────────
  public appendLog(projectId: string, message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO'): void {
    try {
      const db = getDatabase();
      db.prepare(`
        INSERT INTO project_logs (project_id, level, message, created_at)
        VALUES (?, ?, ?, ?)
      `).run(projectId, level, message, new Date().toISOString());
    } catch {
      // Non-fatal: log writes should not crash the pipeline
    }
  }

  public getLogs(projectId: string, limit = 200): Array<{ level: string; message: string; created_at: string }> {
    try {
      const db = getDatabase();
      return db.prepare(`
        SELECT level, message, created_at FROM project_logs
        WHERE project_id = ? ORDER BY id DESC LIMIT ?
      `).all(projectId, limit) as any[];
    } catch {
      return [];
    }
  }

  // ── Port allocation ────────────────────────────────────────────────
  public reservePort(port: number): void {
    this.allocatedPorts.add(port);
  }

  public releasePort(port: number): void {
    this.allocatedPorts.delete(port);
  }

  public isPortAllocated(port: number): boolean {
    return this.allocatedPorts.has(port);
  }

  // ── Directory helpers ──────────────────────────────────────────────
  public getProjectDir(slug: string): string {
    return path.join(SITES_DIR, slug);
  }

  public async ensureProjectDir(slug: string): Promise<string> {
    const dir = this.getProjectDir(slug);
    await fs.ensureDir(dir);
    return dir;
  }

  public async deleteProjectFiles(slug: string): Promise<void> {
    const dir = this.getProjectDir(slug);
    if (await fs.pathExists(dir)) {
      await fs.remove(dir);
    }
  }
}

export const projectWorkspace = new ProjectWorkspace();
