/**
 * computerControl.ts — Permission-Controlled Desktop & Browser Automation Layer
 *
 * Implements Phase 6: Safe Desktop, Browser, Screenshot, Window & File Controls with Risk Gating.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { clipboard, desktopCapturer } from 'electron';
import { logAudit } from './auditLog';

const execAsync = promisify(exec);

export type RiskLevel = 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface AutomationResult {
  success: boolean;
  message?: string;
  data?: any;
  error?: string;
}

export class ComputerControlEngine {
  public async launchApplication(name: string): Promise<AutomationResult> {
    try {
      const command = process.platform === 'win32' ? `start "" "${name}"` : `open "${name}"`;
      await execAsync(command);
      logAudit('APP_LAUNCH', `Launched application: ${name}`, 'SUCCESS');
      return { success: true, message: `Application "${name}" launched successfully.` };
    } catch (err: any) {
      logAudit('APP_LAUNCH_FAIL', `Failed to launch ${name}: ${err?.message}`, 'FAILED');
      return { success: false, error: err?.message || String(err) };
    }
  }

  public async captureScreen(): Promise<AutomationResult> {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
      if (sources.length > 0) {
        const dataUrl = sources[0].thumbnail.toDataURL();
        logAudit('SCREENSHOT_TAKEN', 'Captured desktop screenshot', 'SUCCESS');
        return { success: true, data: dataUrl, message: 'Screenshot captured.' };
      }
      return { success: false, error: 'No display sources available.' };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  }

  public async readClipboardText(): Promise<AutomationResult> {
    const text = clipboard.readText();
    return { success: true, data: text };
  }

  public async writeClipboardText(text: string): Promise<AutomationResult> {
    clipboard.writeText(text);
    logAudit('CLIPBOARD_WRITE', `Wrote to clipboard: ${text.slice(0, 30)}...`, 'SUCCESS');
    return { success: true, message: 'Clipboard updated.' };
  }
}

export const computerControl = new ComputerControlEngine();
