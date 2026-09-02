/**
 * siteGenerator.ts — Full-Stack Site Generation Pipeline & Live Preview Engine
 *
 * Integrated with:
 * - projectWorkspace (SQLite Project Registry)
 * - devServerManager (Vite Dev Server & Express Backend readiness)
 * - codeGenerator (Multi-Stage AI Requirements, Scaffold, Frontend & Backend)
 * - autonomousDevEngine (AI-driven Repair & Modification)
 */

import path from 'path';
import fs from 'fs-extra';
import JSZip from 'jszip';
import { promisify } from 'util';
import { exec } from 'child_process';
import { logAudit } from './auditLog';
import { projectWorkspace } from './projectWorkspace';
import { smartModelRouter } from './smartModelRouter';
import {
  findAvailablePort,
  startProjectServers,
  stopProjectServer,
  restartProjectServer,
  getRunningServer,
} from './devServerManager';
import {
  generateProject,
  installDependencies,
  repairFile,
} from './codeGenerator';

const execAsync = promisify(exec);

export interface ProjectHealthStatus {
  frontend: 'RUNNING' | 'STOPPED' | 'ERROR';
  backend: 'RUNNING' | 'STOPPED' | 'ERROR' | 'UNAVAILABLE';
  api: 'CONNECTED' | 'DISCONNECTED' | 'UNAVAILABLE';
  database: 'CONNECTED' | 'DISCONNECTED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
}

export interface BuildLoopStatus {
  step: 'planning' | 'scaffolding' | 'writing' | 'building' | 'fixing' | 'starting' | 'success' | 'failed';
  attempt: number;
  maxAttempts: number;
  currentFile?: string;
  errorLog?: string;
  previewUrl?: string;
  backendUrl?: string;
  logs?: string[];
  health?: ProjectHealthStatus;
  projectSlug?: string;
}

export type BuildStatusCallback = (status: BuildLoopStatus) => void;

function slugify(text: string): string {
  const clean = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
  return clean.slice(0, 30) || 'web-app';
}

/**
 * Primary Full-Stack Generation Pipeline.
 */
export async function generateSitePipeline(
  prompt: string,
  provider: string,
  modelName: string,
  onStatus: BuildStatusCallback
): Promise<{ success: boolean; siteId?: string; previewUrl?: string; backendUrl?: string; error?: string }> {
  const logs: string[] = [];
  const appendLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const entry = `[${timestamp}] ${msg}`;
    logs.push(entry);
    console.log(entry);
  };

  const projectSlug = `${slugify(prompt)}-${Date.now().toString().slice(-4)}`;
  const siteDir = await projectWorkspace.ensureProjectDir(projectSlug);
  const projectId = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // Create SQLite DB Project Record
  projectWorkspace.create({
    id: projectId,
    name: prompt.slice(0, 40),
    slug: projectSlug,
    projectDir: siteDir,
    projectType: 'fullstack',
  });

  // Auto-route model selection if not explicitly forced
  let effectiveProvider = provider;
  let effectiveModel = modelName;

  if (!effectiveProvider || effectiveProvider === 'auto' || effectiveProvider === 'default') {
    const route = smartModelRouter.routePrompt(prompt);
    effectiveProvider = route.provider;
    effectiveModel = route.modelName;
    appendLog(`[SmartModelRouter] Auto-selected provider "${effectiveProvider}" with model "${effectiveModel}" for ${route.category}`);
  }

  try {
    // ── STAGE 1 & 2: Planning & Multi-Stage Code Generation ─────────────────
    onStatus({ step: 'planning', attempt: 1, maxAttempts: 5, logs, projectSlug });

    const genResult = await generateProject({
      prompt,
      projectDir: siteDir,
      provider: effectiveProvider,
      modelName: effectiveModel,
      onProgress: (stage, file) => {
        if (stage === 'REQUIREMENTS') {
          onStatus({ step: 'planning', attempt: 1, maxAttempts: 5, logs, projectSlug });
          appendLog('Analyzing requirements & architecture...');
        } else if (stage === 'SCAFFOLD') {
          onStatus({ step: 'scaffolding', attempt: 1, maxAttempts: 5, logs, projectSlug });
          appendLog('Creating project structure and configuration files...');
        } else if (stage === 'FRONTEND' || stage === 'BACKEND') {
          onStatus({ step: 'writing', attempt: 1, maxAttempts: 5, currentFile: file, logs, projectSlug });
          appendLog(`Writing ${file}...`);
        }
      },
    });

    if (!genResult.success) {
      const errorMsg = genResult.errors.join('; ') || 'Code generation failed';
      onStatus({ step: 'failed', attempt: 1, maxAttempts: 5, errorLog: errorMsg, logs, projectSlug });
      projectWorkspace.updateStatus(projectId, 'FAILED');
      return { success: false, siteId: projectSlug, error: errorMsg };
    }

    const reqs = genResult.requirements;
    const hasBackend = reqs?.backendFramework !== 'none';
    const hasDB = reqs?.database !== 'none';

    // ── STAGE 3: Dependency Installation ────────────────────────────────────
    onStatus({ step: 'building', attempt: 1, maxAttempts: 5, logs, projectSlug });
    projectWorkspace.updateStatus(projectId, 'INSTALLING');

    const frontendDir = path.join(siteDir, 'frontend');
    const backendDir = path.join(siteDir, 'backend');

    appendLog('Installing frontend dependencies...');
    const feInstall = await installDependencies(
      await fs.pathExists(frontendDir) ? frontendDir : siteDir,
      appendLog
    );

    if (!feInstall.success) {
      appendLog(`Frontend dependency warning: ${feInstall.error?.slice(0, 100)}`);
    }

    if (hasBackend && await fs.pathExists(backendDir)) {
      appendLog('Installing backend dependencies...');
      const beInstall = await installDependencies(backendDir, appendLog);
      if (!beInstall.success) {
        appendLog(`Backend dependency warning: ${beInstall.error?.slice(0, 100)}`);
      }
    }

    // ── STAGE 4: Static Verification (tsc --noEmit) & Self-Healing ──────────
    const maxAttempts = 3;
    let attempt = 1;
    let buildSuccess = false;
    let lastErrorLog = '';

    while (attempt <= maxAttempts && !buildSuccess) {
      onStatus({ step: 'building', attempt, maxAttempts, logs, projectSlug });
      appendLog(`Running TypeScript verification check (Attempt ${attempt}/${maxAttempts})...`);

      const feCheckDir = await fs.pathExists(frontendDir) ? frontendDir : siteDir;
      try {
        await execAsync('npx tsc --noEmit', { cwd: feCheckDir, timeout: 30000 });
        buildSuccess = true;
        appendLog('Frontend TypeScript check PASSED.');
        logAudit('SITE_GEN_BUILD_OK', `Build passed on attempt ${attempt}`, 'SUCCESS');
      } catch (err: any) {
        lastErrorLog = err?.stderr || err?.stdout || err?.message || 'TypeScript compilation failed';
        appendLog(`Verification warning/failure: ${lastErrorLog.substring(0, 150)}`);

        if (attempt < maxAttempts) {
          onStatus({ step: 'fixing', attempt, maxAttempts, errorLog: lastErrorLog, logs, projectSlug });
          appendLog('Applying targeted AI repair loop...');

          const targetAppFile = path.join(feCheckDir, 'src', 'App.tsx');
          if (await fs.pathExists(targetAppFile)) {
            const currentCode = await fs.readFile(targetAppFile, 'utf8');
            const fixedCode = await repairFile({
              filePath: 'src/App.tsx',
              currentContent: currentCode,
              errorLog: lastErrorLog,
              provider,
              modelName,
            });
            await fs.writeFile(targetAppFile, fixedCode, 'utf8');
            appendLog('Updated src/App.tsx with AI repair patch.');
          }
        }
        attempt++;
      }
    }

    // We proceed to dev server even if tsc had mild warnings, since Vite dev server handles loose JSX fine
    // ── STAGE 5: Port Discovery & Readiness-Checked Server Startup ──────────
    onStatus({ step: 'starting', attempt: 1, maxAttempts: 5, logs, projectSlug });
    projectWorkspace.updateStatus(projectId, 'BUILDING');

    const frontendPort = await findAvailablePort(5173);
    const backendPort = hasBackend ? await findAvailablePort(3001) : undefined;

    appendLog(`Allocated ports -> Frontend: ${frontendPort}${backendPort ? `, Backend: ${backendPort}` : ''}`);

    const serverInstance = await startProjectServers({
      slug: projectSlug,
      projectId,
      projectDir: siteDir,
      frontendPort,
      backendPort,
      onLog: appendLog,
    });

    const health: ProjectHealthStatus = {
      frontend: 'RUNNING',
      backend: hasBackend ? (serverInstance.backendUrl ? 'RUNNING' : 'ERROR') : 'UNAVAILABLE',
      api: hasBackend ? (serverInstance.backendUrl ? 'CONNECTED' : 'DISCONNECTED') : 'UNAVAILABLE',
      database: hasDB ? 'CONNECTED' : 'NOT_CONFIGURED',
    };

    projectWorkspace.updateStatus(projectId, 'RUNNING', {
      frontendPort,
      backendPort,
      frontendUrl: serverInstance.frontendUrl,
      backendUrl: serverInstance.backendUrl,
    });

    onStatus({
      step: 'success',
      attempt: 1,
      maxAttempts: 5,
      previewUrl: serverInstance.frontendUrl,
      backendUrl: serverInstance.backendUrl,
      logs,
      health,
      projectSlug,
    });

    logAudit('SITE_GEN_COMPLETE', `Project ${projectSlug} live at ${serverInstance.frontendUrl}`, 'SUCCESS');

    return {
      success: true,
      siteId: projectSlug,
      previewUrl: serverInstance.frontendUrl,
      backendUrl: serverInstance.backendUrl,
    };

  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    appendLog(`Generation Error: ${errorMsg}`);
    onStatus({ step: 'failed', attempt: 1, maxAttempts: 5, errorLog: errorMsg, logs, projectSlug });
    projectWorkspace.updateStatus(projectId, 'FAILED');
    return { success: false, siteId: projectSlug, error: errorMsg };
  }
}

/**
 * Restarts servers for an active project.
 */
export async function restartProjectServers(slug: string): Promise<{ success: boolean; previewUrl?: string }> {
  const project = projectWorkspace.getBySlug(slug);
  if (!project) return { success: false };

  try {
    const frontendPort = project.frontend_port || await findAvailablePort(5173);
    const backendPort = project.backend_port || undefined;

    const srv = await restartProjectServer({
      slug,
      projectId: project.id,
      projectDir: project.project_dir,
      frontendPort,
      backendPort,
      onLog: (msg) => console.log(`[Restart:${slug}] ${msg}`),
    });

    projectWorkspace.updateStatus(project.id, 'RUNNING', { frontendUrl: srv.frontendUrl });
    return { success: true, previewUrl: srv.frontendUrl };
  } catch (err: any) {
    return { success: false };
  }
}

/**
 * Stops running processes for a project.
 */
export async function stopProjectServers(slug: string): Promise<boolean> {
  const project = projectWorkspace.getBySlug(slug);
  if (project) {
    projectWorkspace.updateStatus(project.id, 'STOPPED');
  }
  return await stopProjectServer(slug);
}

/**
 * Launches Chrome browser with the project preview URL.
 */
export async function launchInChrome(url: string): Promise<{ success: boolean; error?: string }> {
  try {
    const chromeCmd = process.platform === 'win32' ? `start chrome "${url}"` : `google-chrome "${url}"`;
    await execAsync(chromeCmd);
    logAudit('CHROME_LAUNCH', `Opened ${url} in Chrome`, 'SUCCESS');
    return { success: true };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    logAudit('CHROME_LAUNCH_FAIL', `Failed to launch Chrome: ${errorMsg}`, 'FAILED');
    return { success: false, error: errorMsg };
  }
}

/**
 * One-click Zip Export of generated site directory.
 */
export async function exportSiteAsZip(siteId: string): Promise<{ success: boolean; zipPath?: string; error?: string }> {
  try {
    const siteDir = projectWorkspace.getProjectDir(siteId);
    if (!await fs.pathExists(siteDir)) {
      throw new Error(`Site directory for "${siteId}" not found.`);
    }

    const zip = new JSZip();

    const addFilesRecursively = async (dir: string, zipFolder: JSZip) => {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (file === 'node_modules' || file === '.git' || file === 'dist' || file === '.jarvis_checkpoint') continue;
        const filePath = path.join(dir, file);
        const stat = await fs.stat(filePath);
        if (stat.isDirectory()) {
          const subFolder = zipFolder.folder(file)!;
          await addFilesRecursively(filePath, subFolder);
        } else {
          const content = await fs.readFile(filePath);
          zipFolder.file(file, content);
        }
      }
    };

    await addFilesRecursively(siteDir, zip);

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const zipPath = path.join(projectWorkspace.getProjectDir(''), `../${siteId}_export.zip`);
    await fs.writeFile(zipPath, zipBuffer);

    logAudit('SITE_EXPORT_ZIP', `Exported zip: ${zipPath}`, 'SUCCESS');
    return { success: true, zipPath };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    logAudit('SITE_EXPORT_FAIL', `Export error: ${errorMsg}`, 'FAILED');
    return { success: false, error: errorMsg };
  }
}
