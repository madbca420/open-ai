/**
 * devServerManager.ts — Managed Dev Server Process Pool
 *
 * Responsibilities:
 * - Start Vite dev server (NOT vite build) and Node/ts-node backend
 * - Parse stdout to detect real localhost URL ("Local: http://localhost:XXXX")
 * - Poll the endpoint until it responds with HTTP 200 (readiness check)
 * - Register processes with ProcessSupervisor for STOP integration
 * - Stream logs back via a provided callback
 * - Track which project owns which port/process
 */

import { spawn, ChildProcess } from 'child_process';
import net from 'net';
import path from 'path';
import fs from 'fs-extra';
import { processSupervisor } from './processSupervisor';
import { logAudit } from './auditLog';

const SERVER_READY_TIMEOUT_MS = 90_000; // 90 seconds
const SERVER_POLL_INTERVAL_MS = 1_000;  // 1 second between polls

export interface RunningServer {
  slug: string;
  projectId: string;
  frontendPid?: number;
  backendPid?: number;
  frontendPort: number;
  backendPort?: number;
  frontendUrl: string;
  backendUrl?: string;
  frontendProcess?: ChildProcess;
  backendProcess?: ChildProcess;
  logs: string[];
  status: 'STARTING' | 'READY' | 'FAILED' | 'STOPPED';
}

// Active servers map: slug → RunningServer
const activeServers = new Map<string, RunningServer>();

// ── Port utilities ────────────────────────────────────────────────────────────

export async function findAvailablePort(start: number): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.once('listening', () => srv.close(() => resolve(true)));
      srv.listen(port, '127.0.0.1');
    });
    if (free) return port;
  }
  throw new Error(`No free port found in range ${start}–${start + 99}`);
}

// ── Readiness check ───────────────────────────────────────────────────────────

async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const reachable = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ port, host: '127.0.0.1' });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => { socket.destroy(); resolve(false); });
      socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
    });
    if (reachable) return true;
    await new Promise((r) => setTimeout(r, SERVER_POLL_INTERVAL_MS));
  }
  return false;
}

async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(tid);
      if (res.status < 500) return true;
    } catch { /* keep polling */ }
    await new Promise((r) => setTimeout(r, SERVER_POLL_INTERVAL_MS));
  }
  return false;
}

// ── Start frontend Vite dev server ─────────────────────────────────────────────

export async function startFrontendServer(params: {
  slug: string;
  projectId: string;
  projectDir: string;
  port: number;
  onLog: (msg: string) => void;
}): Promise<{ process: ChildProcess; url: string; pid?: number }> {
  const { slug, projectId, projectDir, port, onLog } = params;
  const frontendDir = path.join(projectDir, 'frontend');
  const cwd = (await fs.pathExists(frontendDir)) ? frontendDir : projectDir;

  onLog(`[DevServer] Starting Vite dev server in ${cwd} on port ${port}`);

  const proc = spawn('npx', ['vite', '--port', String(port), '--host', '0.0.0.0', '--strictPort'], {
    cwd,
    shell: true,
    env: { ...process.env, FORCE_COLOR: '0' },
  });

  let urlDetected = `http://localhost:${port}`;

  proc.stdout?.on('data', (d: Buffer) => {
    const text = d.toString().trim();
    if (text) {
      // Detect URL from Vite output: "Local:   http://localhost:XXXX/"
      const match = text.match(/Local:\s+(https?:\/\/localhost:\d+)/i);
      if (match) urlDetected = match[1];
      onLog(`[Vite] ${text}`);
    }
  });

  proc.stderr?.on('data', (d: Buffer) => {
    const text = d.toString().trim();
    if (text) onLog(`[Vite:ERR] ${text}`);
  });

  proc.on('error', (err) => onLog(`[Vite:SPAWN_ERR] ${err.message}`));

  // Register with ProcessSupervisor for STOP integration
  const procInfo = processSupervisor.spawnManagedProcess({
    processId: `vite_${slug}_${Date.now()}`,
    type: 'VITE_DEV',
    command: `npx vite --port ${port}`,
    cwd,
    missionId: projectId,
  });

  onLog(`[DevServer] Vite PID ${proc.pid ?? 'unknown'}, waiting for readiness on port ${port}...`);

  const ready = await waitForPort(port, SERVER_READY_TIMEOUT_MS);
  if (!ready) {
    proc.kill();
    throw new Error(`Frontend dev server did not become ready on port ${port} within ${SERVER_READY_TIMEOUT_MS / 1000}s`);
  }

  onLog(`[DevServer] ✅ Frontend READY at ${urlDetected}`);
  logAudit('DEV_SERVER_STARTED', `Frontend ${slug} ready at ${urlDetected}`, 'SUCCESS');

  return { process: proc, url: urlDetected, pid: proc.pid };
}

// ── Start backend Express/ts-node server ──────────────────────────────────────

export async function startBackendServer(params: {
  slug: string;
  projectId: string;
  projectDir: string;
  port: number;
  onLog: (msg: string) => void;
}): Promise<{ process: ChildProcess; url: string; pid?: number } | null> {
  const { slug, projectId, projectDir, port, onLog } = params;
  const backendDir = path.join(projectDir, 'backend');

  if (!await fs.pathExists(backendDir)) {
    onLog(`[DevServer] No backend directory found — skipping backend server`);
    return null;
  }

  // Check for entry point
  const entryPoints = ['src/index.ts', 'server.ts', 'src/server.ts', 'index.ts'];
  let entryPoint = 'server.ts';
  for (const ep of entryPoints) {
    if (await fs.pathExists(path.join(backendDir, ep))) {
      entryPoint = ep;
      break;
    }
  }

  onLog(`[DevServer] Starting backend (ts-node ${entryPoint}) in ${backendDir} on port ${port}`);

  const proc = spawn('npx', ['ts-node', '--esm', entryPoint], {
    cwd: backendDir,
    shell: true,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'development', FORCE_COLOR: '0' },
  });

  proc.stdout?.on('data', (d: Buffer) => {
    const text = d.toString().trim();
    if (text) onLog(`[Backend] ${text}`);
  });

  proc.stderr?.on('data', (d: Buffer) => {
    const text = d.toString().trim();
    if (text) onLog(`[Backend:ERR] ${text}`);
  });

  proc.on('error', (err) => onLog(`[Backend:SPAWN_ERR] ${err.message}`));

  processSupervisor.spawnManagedProcess({
    processId: `backend_${slug}_${Date.now()}`,
    type: 'NODE_BACKEND',
    command: `npx ts-node ${entryPoint}`,
    cwd: backendDir,
    env: { PORT: String(port) },
    missionId: projectId,
  });

  onLog(`[DevServer] Backend PID ${proc.pid ?? 'unknown'}, waiting for readiness on port ${port}...`);

  const ready = await waitForPort(port, 30_000);
  if (!ready) {
    proc.kill();
    onLog(`[DevServer] ⚠️ Backend did not become ready on port ${port} — check backend logs`);
    return null;
  }

  const backendUrl = `http://localhost:${port}`;
  onLog(`[DevServer] ✅ Backend READY at ${backendUrl}`);
  logAudit('BACKEND_SERVER_STARTED', `Backend ${slug} ready at ${backendUrl}`, 'SUCCESS');

  return { process: proc, url: backendUrl, pid: proc.pid };
}

// ── Orchestrate both servers ──────────────────────────────────────────────────

export async function startProjectServers(params: {
  slug: string;
  projectId: string;
  projectDir: string;
  frontendPort: number;
  backendPort?: number;
  onLog: (msg: string) => void;
}): Promise<RunningServer> {
  // Stop existing instance if running
  await stopProjectServer(params.slug);

  const server: RunningServer = {
    slug: params.slug,
    projectId: params.projectId,
    frontendPort: params.frontendPort,
    backendPort: params.backendPort,
    frontendUrl: `http://localhost:${params.frontendPort}`,
    logs: [],
    status: 'STARTING',
  };

  const log = (msg: string) => {
    server.logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    params.onLog(msg);
  };

  try {
    // Start frontend
    const frontend = await startFrontendServer({
      slug: params.slug,
      projectId: params.projectId,
      projectDir: params.projectDir,
      port: params.frontendPort,
      onLog: log,
    });
    server.frontendProcess = frontend.process;
    server.frontendPid = frontend.pid;
    server.frontendUrl = frontend.url;

    // Start backend if port specified
    if (params.backendPort) {
      const backend = await startBackendServer({
        slug: params.slug,
        projectId: params.projectId,
        projectDir: params.projectDir,
        port: params.backendPort,
        onLog: log,
      });
      if (backend) {
        server.backendProcess = backend.process;
        server.backendPid = backend.pid;
        server.backendUrl = backend.url;
      }
    }

    server.status = 'READY';
    activeServers.set(params.slug, server);
    return server;
  } catch (err: any) {
    server.status = 'FAILED';
    log(`[DevServer] FAILED: ${err.message}`);
    throw err;
  }
}

// ── Stop servers ──────────────────────────────────────────────────────────────

export async function stopProjectServer(slug: string): Promise<boolean> {
  const server = activeServers.get(slug);
  if (!server) return false;

  try {
    if (server.frontendProcess && !server.frontendProcess.killed) {
      server.frontendProcess.kill('SIGTERM');
    }
    if (server.backendProcess && !server.backendProcess.killed) {
      server.backendProcess.kill('SIGTERM');
    }
  } catch { /* ignore */ }

  server.status = 'STOPPED';
  activeServers.delete(slug);
  logAudit('DEV_SERVER_STOPPED', `Project ${slug} servers stopped`, 'SUCCESS');
  return true;
}

// ── Restart servers ───────────────────────────────────────────────────────────

export async function restartProjectServer(params: {
  slug: string;
  projectId: string;
  projectDir: string;
  frontendPort: number;
  backendPort?: number;
  onLog: (msg: string) => void;
}): Promise<RunningServer> {
  await stopProjectServer(params.slug);
  return startProjectServers(params);
}

// ── Getters ───────────────────────────────────────────────────────────────────

export function getRunningServer(slug: string): RunningServer | undefined {
  return activeServers.get(slug);
}

export function getAllRunningServers(): RunningServer[] {
  return Array.from(activeServers.values());
}

// ── HTTP API test ─────────────────────────────────────────────────────────────

export async function testEndpoint(
  url: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, any>
): Promise<{ status: number; ok: boolean; body: string; error?: string }> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    clearTimeout(tid);
    const text = await res.text().catch(() => '');
    return { status: res.status, ok: res.ok, body: text };
  } catch (err: any) {
    return { status: 0, ok: false, body: '', error: err.message };
  }
}
