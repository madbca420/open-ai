/**
 * projectIntelligence.ts — Project Structure Inspection & Framework Detector
 *
 * Implements Phase 7: Automatically inspects project directories, identifies framework,
 * package managers, build/test scripts, database schemas, and git status.
 */

import path from 'path';
import fs from 'fs-extra';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ProjectMetadata {
  rootPath: string;
  projectName: string;
  language: 'TypeScript' | 'JavaScript' | 'Python' | 'Go' | 'Rust' | 'Unknown';
  framework: string[];
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'pip' | 'unknown';
  hasFrontend: boolean;
  hasBackend: boolean;
  hasDatabase: boolean;
  scripts: Record<string, string>;
  dependencies: string[];
  gitBranch?: string;
  isGitClean?: boolean;
}

export class ProjectIntelligenceEngine {
  public async inspectProject(projectDir: string): Promise<ProjectMetadata> {
    const rootPath = path.resolve(projectDir);
    const pkgJsonPath = path.join(rootPath, 'package.json');
    const pyReqPath = path.join(rootPath, 'requirements.txt');

    const meta: ProjectMetadata = {
      rootPath,
      projectName: path.basename(rootPath),
      language: 'Unknown',
      framework: [],
      packageManager: 'unknown',
      hasFrontend: false,
      hasBackend: false,
      hasDatabase: false,
      scripts: {},
      dependencies: [],
    };

    if (await fs.pathExists(pkgJsonPath)) {
      meta.language = 'TypeScript';
      meta.packageManager = 'npm';
      try {
        const pkg = await fs.readJson(pkgJsonPath);
        meta.projectName = pkg.name || meta.projectName;
        meta.scripts = pkg.scripts || {};
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        meta.dependencies = Object.keys(allDeps);

        if (allDeps.react || allDeps['@tanstack/react-router'] || allDeps.vue || allDeps.vite) {
          meta.hasFrontend = true;
          meta.framework.push('React/Vite');
        }
        if (allDeps.express || allDeps.fastify || allDeps.koa || allDeps.nestjs) {
          meta.hasBackend = true;
          meta.framework.push('Express/Node');
        }
        if (allDeps.sqlite3 || allDeps['better-sqlite3'] || allDeps.mongoose || allDeps.pg || allDeps.prisma) {
          meta.hasDatabase = true;
          meta.framework.push('Database');
        }
      } catch {}
    } else if (await fs.pathExists(pyReqPath)) {
      meta.language = 'Python';
      meta.packageManager = 'pip';
      const content = await fs.readFile(pyReqPath, 'utf8');
      if (content.includes('django') || content.includes('flask') || content.includes('fastapi')) {
        meta.hasBackend = true;
        meta.framework.push('Python Web');
      }
    }

    try {
      const { stdout: branch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: rootPath });
      meta.gitBranch = branch.trim();
      const { stdout: status } = await execAsync('git status --porcelain', { cwd: rootPath });
      meta.isGitClean = status.trim().length === 0;
    } catch {}

    return meta;
  }
}

export const projectIntelligence = new ProjectIntelligenceEngine();
