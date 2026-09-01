import { spawn, ChildProcess } from 'child_process';
import path from 'path';

let omnirouteProcess: ChildProcess | null = null;

export async function ensureOmniRouteRunning(): Promise<boolean> {
  // First check if already running on http://localhost:20128
  try {
    const res = await fetch('http://localhost:20128/v1/models', {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      console.log('[OmniRouteService] OmniRoute Gateway is already active at http://localhost:20128');
      return true;
    }
  } catch {
    // Not running yet, start daemon
  }

  console.log('[OmniRouteService] Starting OmniRoute Gateway daemon on port 20128...');

  try {
    // Attempt spawning npx omniroute --port 20128 or npx omniroute start
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'npx.cmd' : 'npx';

    omnirouteProcess = spawn(cmd, ['omniroute', 'start', '--port', '20128'], {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'ignore',
      shell: true,
      detached: false,
    });

    omnirouteProcess.on('error', (err) => {
      console.error('[OmniRouteService] Failed to spawn OmniRoute daemon:', err.message);
    });

    // Give it 3 seconds to spin up
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Verify status again
    const verifyRes = await fetch('http://localhost:20128/v1/models', {
      signal: AbortSignal.timeout(2000),
    }).catch(() => null);

    if (verifyRes && verifyRes.ok) {
      console.log('[OmniRouteService] OmniRoute Gateway successfully started and verified!');
      return true;
    }
  } catch (err: any) {
    console.error('[OmniRouteService] Error initializing OmniRoute service:', err?.message || err);
  }

  return false;
}

export function stopOmniRoute(): void {
  if (omnirouteProcess) {
    console.log('[OmniRouteService] Terminating OmniRoute daemon...');
    omnirouteProcess.kill();
    omnirouteProcess = null;
  }
}
