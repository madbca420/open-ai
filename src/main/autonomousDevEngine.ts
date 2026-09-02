/**
 * autonomousDevEngine.ts — Autonomous Project Maintenance & AI Code Modification Loop
 *
 * Implements Phase 8/18/20: Understand Request → Inspect → Plan → Checkpoint → Modify → Typecheck → Build → Verify → Rollback.
 */

import path from 'path';
import fs from 'fs-extra';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logAudit } from './auditLog';
import { getApiKey } from './keyVault';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';

const execAsync = promisify(exec);

export interface DevLoopResult {
  success: boolean;
  step: 'INSPECT' | 'PLAN' | 'CHECKPOINT' | 'MODIFY' | 'VERIFY' | 'ROLLBACK' | 'SUCCESS';
  changesMade: string[];
  errorLog?: string;
  diffSummary?: string;
}

function getModel(provider = 'google', modelName = 'gemini-1.5-flash') {
  try {
    if (provider === 'google') {
      const apiKey = getApiKey('google') || process.env.GEMINI_API_KEY || '';
      if (apiKey) return createGoogleGenerativeAI({ apiKey })(modelName);
    }
    if (provider === 'openai') {
      const apiKey = getApiKey('openai') || '';
      if (apiKey) return createOpenAI({ apiKey })(modelName || 'gpt-4o');
    }
    if (provider === 'anthropic') {
      const apiKey = getApiKey('anthropic') || '';
      if (apiKey) return createAnthropic({ apiKey })(modelName || 'claude-3-5-sonnet-20241022');
    }
    return createOpenAI({ baseURL: 'http://localhost:20128/v1', apiKey: 'local' })('auto');
  } catch {
    return createOpenAI({ baseURL: 'http://localhost:20128/v1', apiKey: 'local' })('auto');
  }
}

export class AutonomousDevEngine {
  /**
   * Modifies an existing project based on natural language instructions.
   */
  public async modifyProject(
    projectDir: string,
    instruction: string,
    provider = 'google',
    modelName = 'gemini-1.5-flash'
  ): Promise<DevLoopResult> {
    const rootPath = path.resolve(projectDir);
    logAudit('AUTO_DEV_MODIFY_START', `Instruction: "${instruction}" in ${rootPath}`, 'ATTEMPTED');

    const backupDir = path.join(rootPath, '.jarvis_checkpoint');

    try {
      // Step 1: Create Safety Checkpoint
      await fs.copy(rootPath, backupDir, {
        filter: (src) => !src.includes('node_modules') && !src.includes('.git') && !src.includes('.jarvis_checkpoint'),
      });
      logAudit('AUTO_DEV_CHECKPOINT', `Created checkpoint at ${backupDir}`, 'SUCCESS');

      // Step 2: Inspect existing project files to build context
      const projectMap = await this.inspectCodebase(rootPath);

      // Step 3: AI Code Modification Plan & Execution
      const model = getModel(provider, modelName);
      const changesMade: string[] = [];

      // Determine key target files to inspect/modify
      const appFile = path.join(rootPath, 'frontend', 'src', 'App.tsx');
      const fallbackAppFile = path.join(rootPath, 'src', 'App.tsx');
      const targetAppPath = (await fs.pathExists(appFile)) ? appFile : (await fs.pathExists(fallbackAppFile)) ? fallbackAppFile : null;

      if (targetAppPath) {
        const currentCode = await fs.readFile(targetAppPath, 'utf8');

        const prompt = `You are a senior full-stack developer modifying an existing React web application.
Project Instruction: "${instruction}"

CURRENT FILE: ${path.relative(rootPath, targetAppPath)}
CODEBASE CONTEXT:
Files: ${projectMap.files.slice(0, 15).join(', ')}

EXISTING CODE:
${currentCode.slice(0, 7000)}

Modify the existing code to fulfill the user's request: "${instruction}".
Rules:
- Return ONLY valid, updated complete TypeScript/React TSX code.
- Do NOT use Markdown fences (\`\`\`tsx).
- Preserve existing working state, variables, imports, and styling where applicable.
- Make targeted additions/modifications to fulfill the user's instruction seamlessly.`;

        const { text: updatedCode } = await generateText({ model, prompt });
        const cleanCode = updatedCode.replace(/```[\w]*\n?/g, '').replace(/```/g, '').trim();

        await fs.writeFile(targetAppPath, cleanCode, 'utf8');
        changesMade.push(`Modified ${path.relative(rootPath, targetAppPath)} to implement "${instruction}"`);
      }

      // Step 4: Verification Check (tsc --noEmit)
      const feDir = (await fs.pathExists(path.join(rootPath, 'frontend'))) ? path.join(rootPath, 'frontend') : rootPath;
      try {
        await execAsync('npx tsc --noEmit', { cwd: feDir, timeout: 25000 });
        logAudit('AUTO_DEV_VERIFY', 'Verification check passed.', 'SUCCESS');
        await fs.remove(backupDir);
        return {
          success: true,
          step: 'SUCCESS',
          changesMade,
        };
      } catch (err: any) {
        const errorLog = err?.stderr || err?.stdout || err?.message || 'Verification failed';
        logAudit('AUTO_DEV_FAIL', `Verification failed: ${errorLog.slice(0, 150)}`, 'FAILED');

        // Rollback to checkpoint on failure
        if (await fs.pathExists(backupDir)) {
          await fs.copy(backupDir, rootPath);
          await fs.remove(backupDir);
        }

        return {
          success: false,
          step: 'ROLLBACK',
          changesMade: [],
          errorLog,
        };
      }
    } catch (err: any) {
      if (await fs.pathExists(backupDir)) {
        await fs.copy(backupDir, rootPath);
        await fs.remove(backupDir);
      }
      return {
        success: false,
        step: 'ROLLBACK',
        changesMade: [],
        errorLog: err?.message || String(err),
      };
    }
  }

  public async inspectCodebase(rootPath: string): Promise<{ files: string[]; hasFrontend: boolean; hasBackend: boolean }> {
    const files: string[] = [];
    const readDir = async (dir: string) => {
      const items = await fs.readdir(dir);
      for (const item of items) {
        if (item === 'node_modules' || item === '.git' || item === 'dist' || item === '.jarvis_checkpoint') continue;
        const full = path.join(dir, item);
        const stat = await fs.stat(full);
        if (stat.isDirectory()) await readDir(full);
        else files.push(path.relative(rootPath, full));
      }
    };
    await readDir(rootPath);

    return {
      files,
      hasFrontend: files.some((f) => f.includes('frontend') || f.includes('App.tsx')),
      hasBackend: files.some((f) => f.includes('backend') || f.includes('server.ts')),
    };
  }

  public async executeTask(projectDir: string, taskDescription: string): Promise<DevLoopResult> {
    return this.modifyProject(projectDir, taskDescription);
  }
}

export const autonomousDevEngine = new AutonomousDevEngine();
