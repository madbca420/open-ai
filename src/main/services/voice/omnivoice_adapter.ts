// JARVIS Phase 4 — Real OmniVoice Adapter (CLI integration)

/**
 * Connects JARVIS to the OmniVoice Python CLI runtime (command: "omnivoice-infer").
 *
 * ARCHITECTURAL & SECURITY RULES:
 *  - JARVIS remains the sole orchestrator; OmniVoice is a pure TTS / voice design service.
 *  - Health check validates the executable is reachable via `omnivoice-infer --help` (no model load).
 *  - Disabled by default via feature flag "omnivoice".
 *  - Voice cloning requires explicit config flag allowVoiceCloning: true.
 *  - Generated audio files are sandboxed under generated_sites/artifacts/ and registered
 *    in the JARVIS Artifact Registry.
 *  - ALL CLI arguments are passed as a safe string array — no string concatenation.
 *  - OmniVoice runtime MUST be pre-installed by the user. This adapter does NOT install it.
 */

import path from 'path';
import fs from 'fs';
import http from 'http';
import { spawn, ChildProcess } from 'child_process';
import { BaseAdapter } from '../adapters/adapterTypes';
import {
  AdapterCapability,
  AdapterCategory,
  AdapterInput,
  AdapterOutput,
  Artifact,
} from '../../types/schema';
import { featureFlags } from '../adapters/featureFlags';
import { registerArtifact } from '../../taskExecutor';
import { eventBus } from '../../eventBus';

export interface OmniVoiceConfig {
  /** CLI executable name or absolute path, e.g. "omnivoice-infer" */
  executablePath: string;
  /** Model identifier – passed as --model <id>; omit to use runtime default */
  model?: string;
  /** Maximum text length accepted (characters) */
  maxTextLength: number;
  /** Whether voice cloning is permitted (requires explicit opt-in) */
  allowVoiceCloning: boolean;
  /** Maximum time (ms) to wait for a synthesis process to complete */
  executionTimeoutMs: number;
  /** Timeout (ms) for the --help health probe */
  healthCheckTimeoutMs: number;
}

export class OmniVoiceAdapter extends BaseAdapter {
  readonly id = 'omnivoice';
  readonly name = 'OmniVoice Synthesis Engine';
  readonly version = '2.0.0';
  readonly category: AdapterCategory = 'VOICE';

  private config: OmniVoiceConfig = {
    executablePath: 'omnivoice-infer',
    maxTextLength: 5000,
    allowVoiceCloning: false,
    executionTimeoutMs: 60_000,
    healthCheckTimeoutMs: 3_000,
  };

  /** executionId -> active ChildProcess (for cancellation) */
  private activeProcesses: Map<string, ChildProcess> = new Map();

  constructor(config?: Partial<OmniVoiceConfig>) {
    super();
    if (config) this.config = { ...this.config, ...config };
  }

  // -------------------------------------------------------------------------
  // Adapter metadata
  // -------------------------------------------------------------------------

  getCapabilities(): AdapterCapability[] {
    return [
      {
        id: 'voice.tts',
        name: 'OmniVoice Text-to-Speech',
        description: 'Zero-shot multilingual TTS via CLI',
        requiresGPU: true,
      },
      {
        id: 'voice.voice_design',
        name: 'OmniVoice Voice Design',
        description: 'Design a synthetic voice from a textual description',
        requiresGPU: true,
      },
      {
        id: 'voice.voice_clone',
        name: 'OmniVoice Voice Clone',
        description: 'Zero-shot voice cloning from a short reference audio clip',
        requiresGPU: true,
        requiresAuth: true,
        requiresConfirmation: true,
      },
    ];
  }

  protected requiresGPU(): boolean {
    return true;
  }

  // -------------------------------------------------------------------------
  // Health check
  // Spawns: omnivoice-infer --help
  // Resolves true if the binary exists and responds (exit code does not matter).
  // No model is loaded during this check.
  // -------------------------------------------------------------------------

  async healthCheck(): Promise<boolean> {
    if (!featureFlags.isAdapterEnabled(this.id)) {
      return false;
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (value: boolean) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };

      let child: ChildProcess;
      try {
        child = spawn(this.config.executablePath, ['--help'], {
          shell: false,
          windowsHide: true,
        });
      } catch {
        return settle(false);
      }

      const timeout = setTimeout(() => {
        try { child.kill(); } catch { /* ignore */ }
        settle(false);
      }, this.config.healthCheckTimeoutMs);

      child.on('close', (code) => {
        clearTimeout(timeout);
        // Any non-null exit code means the binary exists and ran
        settle(code !== null);
      });

      child.on('error', () => {
        clearTimeout(timeout);
        settle(false);
      });
    });
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  async initialize(): Promise<void> {
    this.enabled = featureFlags.isAdapterEnabled(this.id);
    if (!this.enabled) {
      this.status = 'DISABLED';
      return;
    }

    this.status = 'INITIALIZING';
    const healthy = await this.healthCheck();
    if (healthy) {
      this.status = 'READY';
      this.lastError = undefined;
    } else {
      this.status = 'UNAVAILABLE';
      this.lastError = `OmniVoice CLI not found: "${this.config.executablePath}". Please install OmniVoice and ensure the binary is on PATH.`;
    }
  }

  // -------------------------------------------------------------------------
  // Execute
  // Spawns: omnivoice-infer --text <text> --output <file> [--model <id>]
  //                         [--language <lang>] [--reference-audio <path>]
  //                         [--voice-design <prompt>]
  // -------------------------------------------------------------------------

  async execute(input: AdapterInput): Promise<AdapterOutput> {
    // Feature flag gate
    if (!featureFlags.isAdapterEnabled(this.id)) {
      this.status = 'DISABLED';
      return this.errorOutput(input.executionId, 'OMNIVOICE_DISABLED: adapter feature flag is off');
    }

    // Health gate
    const healthy = await this.healthCheck();
    if (!healthy) {
      this.status = 'UNAVAILABLE';
      return this.errorOutput(
        input.executionId,
        `OMNIVOICE_UNAVAILABLE: CLI "${this.config.executablePath}" not reachable`
      );
    }

    // Input validation
    const text = (input.payload?.text ?? '').trim();
    if (!text) {
      return this.errorOutput(input.executionId, 'OMNIVOICE_INVALID_INPUT: "text" is required and must be non-empty');
    }
    if (text.length > this.config.maxTextLength) {
      return this.errorOutput(
        input.executionId,
        `OMNIVOICE_INVALID_TEXT: text length ${text.length} exceeds limit of ${this.config.maxTextLength}`
      );
    }

    // Voice-clone authorization
    if (input.capability === 'voice.voice_clone' && !this.config.allowVoiceCloning) {
      return this.errorOutput(
        input.executionId,
        'OMNIVOICE_UNAUTHORIZED: voice cloning is disabled (allowVoiceCloning: false)'
      );
    }

    // Reference-audio sandbox validation
    let referenceAudioArg: string[] = [];
    if (input.payload?.referenceAudioPath) {
      const refPath = path.resolve(input.payload.referenceAudioPath as string);
      const sandboxRoot = path.resolve(process.cwd(), 'generated_sites');
      if (!refPath.startsWith(sandboxRoot)) {
        return this.errorOutput(input.executionId, 'OMNIVOICE_SECURITY: referenceAudioPath is outside the sandbox');
      }
      if (!fs.existsSync(refPath)) {
        return this.errorOutput(input.executionId, 'OMNIVOICE_INVALID_REFERENCE_AUDIO: file does not exist');
      }
      referenceAudioArg = ['--reference-audio', refPath];
    }

    // Prepare output file
    const outputDir = path.join(process.cwd(), 'generated_sites', 'artifacts');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const outputFileName = `omnivoice_${input.executionId}.wav`;
    const outputFilePath = path.join(outputDir, outputFileName);
    const relOutputPath = `generated_sites/artifacts/${outputFileName}`;

    // Build CLI argument array — no string concatenation
    const args: string[] = ['--text', text, '--output', outputFilePath];
    if (this.config.model) args.push('--model', this.config.model);
    if (input.payload?.language) args.push('--language', String(input.payload.language));
    if (input.payload?.voiceDesignPrompt) args.push('--voice-design', String(input.payload.voiceDesignPrompt));
    args.push(...referenceAudioArg);

    this.status = 'BUSY';
    const startTime = Date.now();

    eventBus.emit(
      eventBus.createEvent({
        type: 'adapter.execution.started',
        category: 'ADAPTER',
        source: 'OmniVoiceAdapter',
        payload: { adapterId: this.id, executionId: input.executionId },
      })
    );

    const result = await this.runCLI(input.executionId, args, outputFilePath);
    const duration_ms = Date.now() - startTime;
    this.status = 'READY';

    if (!result.success) {
      eventBus.emit(
        eventBus.createEvent({
          type: 'adapter.execution.failed',
          category: 'ADAPTER',
          source: 'OmniVoiceAdapter',
          payload: { adapterId: this.id, executionId: input.executionId, error: result.error },
        })
      );
      return this.errorOutput(input.executionId, result.error!);
    }

    // Register artifact
    const artifactId = `art_omnivoice_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const artifact: Artifact = {
      id: artifactId,
      type: 'VOICE',
      name: outputFileName,
      path: relOutputPath,
      createdAt: new Date().toISOString(),
      createdBy: 'OmniVoiceAdapter',
      missionId: input.missionId,
      taskId: input.taskId,
      metadata: {
        source: 'OmniVoice',
        capability: input.capability,
        textLength: text.length,
        language: input.payload?.language ?? 'en',
        model: this.config.model ?? 'default',
        voiceClone: input.capability === 'voice.voice_clone',
      },
    };
    registerArtifact(artifact);

    eventBus.emit(
      eventBus.createEvent({
        type: 'adapter.execution.completed',
        category: 'ADAPTER',
        source: 'OmniVoiceAdapter',
        payload: { adapterId: this.id, executionId: input.executionId, artifactIds: [artifactId] },
      })
    );

    return {
      success: true,
      executionId: input.executionId,
      adapterId: this.id,
      artifactIds: [artifactId],
      output: {
        audioPath: relOutputPath,
        textLength: text.length,
        language: input.payload?.language ?? 'en',
        source: 'OmniVoice',
      },
      duration_ms,
    };
  }

  // -------------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------------

  async cancel(executionId: string): Promise<void> {
    const child = this.activeProcesses.get(executionId);
    if (child) {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      this.activeProcesses.delete(executionId);
      this.status = 'READY';
      eventBus.emit(
        eventBus.createEvent({
          type: 'adapter.execution.cancelled',
          category: 'ADAPTER',
          source: 'OmniVoiceAdapter',
          payload: { adapterId: this.id, executionId },
        })
      );
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private runCLI(
    executionId: string,
    args: string[],
    outputFilePath: string
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn(this.config.executablePath, args, {
          shell: false,
          windowsHide: true,
          env: process.env,
        });
      } catch (err: any) {
        return resolve({ success: false, error: `OMNIVOICE_SPAWN_FAILED: ${err?.message ?? err}` });
      }

      this.activeProcesses.set(executionId, child);

      let stderr = '';
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString('utf8');
      });

      // Execution timeout
      const timeout = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
        this.activeProcesses.delete(executionId);
        resolve({ success: false, error: 'OMNIVOICE_TIMEOUT: inference exceeded time limit' });
      }, this.config.executionTimeoutMs);

      child.on('error', (err) => {
        clearTimeout(timeout);
        this.activeProcesses.delete(executionId);
        resolve({ success: false, error: `OMNIVOICE_PROCESS_ERROR: ${err.message}` });
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        this.activeProcesses.delete(executionId);

        if (code !== 0) {
          resolve({
            success: false,
            error: `OMNIVOICE_EXECUTION_FAILED: CLI exited with code ${code}. stderr: ${stderr.slice(0, 400)}`,
          });
          return;
        }

        if (!fs.existsSync(outputFilePath)) {
          resolve({ success: false, error: 'OMNIVOICE_ARTIFACT_MISSING: output file not produced' });
          return;
        }

        resolve({ success: true });
      });
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JARVIS Phase 4 — Step 11 — Handy STT Bridge Adapter
// ─────────────────────────────────────────────────────────────────────────────

export interface HandyConfig {
  executablePath: string;
  healthCheckTimeoutMs: number;
  signalTimeoutMs: number;
}

export class HandyAdapter extends BaseAdapter {
  readonly id = 'handy';
  readonly name = 'Handy STT Bridge';
  readonly version = '1.0.0';
  readonly category: AdapterCategory = 'VOICE';

  private config: HandyConfig = {
    executablePath: 'handy',
    healthCheckTimeoutMs: 3_000,
    signalTimeoutMs: 3_000,
  };

  private activeProcesses: Map<string, ChildProcess> = new Map();

  constructor(config?: Partial<HandyConfig>) {
    super();
    if (config) this.config = { ...this.config, ...config };
  }

  getCapabilities(): AdapterCapability[] {
    return [
      {
        id: 'voice.listen',
        name: 'Handy Toggle Transcription',
        description: 'Toggle Handy microphone recording on/off. Transcribed text is injected by Handy directly into focused UI element.',
        requiresGPU: false,
      },
      {
        id: 'voice.listen.postprocess',
        name: 'Handy Toggle Post-Process Transcription',
        description: 'Toggle Handy recording with post-processing on/off.',
        requiresGPU: false,
      },
      {
        id: 'voice.cancel',
        name: 'Handy Cancel Operation',
        description: 'Cancel current Handy recording or transcription operation.',
        requiresGPU: false,
      },
    ];
  }

  protected requiresGPU(): boolean { return false; }
  protected requiresPython(): boolean { return false; }

  protected getDependencies(): string[] {
    return ['Handy desktop application (https://github.com/cjpais/Handy)'];
  }

  protected override notes = 'Handy injects transcribed text directly into focused UI element.';

  async healthCheck(): Promise<boolean> {
    if (!featureFlags.isAdapterEnabled(this.id)) {
      return false;
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (val: boolean) => {
        if (!settled) {
          settled = true;
          resolve(val);
        }
      };

      let child: ChildProcess;
      try {
        child = spawn(this.config.executablePath, ['--help'], {
          shell: false,
          windowsHide: true,
        });
      } catch {
        return settle(false);
      }

      const timeout = setTimeout(() => {
        try { child.kill(); } catch {}
        settle(false);
      }, this.config.healthCheckTimeoutMs);

      child.on('close', (code) => {
        clearTimeout(timeout);
        settle(code !== null);
      });

      child.on('error', () => {
        clearTimeout(timeout);
        settle(false);
      });
    });
  }

  async initialize(): Promise<void> {
    this.enabled = featureFlags.isAdapterEnabled(this.id);
    if (!this.enabled) {
      this.status = 'DISABLED';
      return;
    }

    this.status = 'INITIALIZING';
    const healthy = await this.healthCheck();
    if (healthy) {
      this.status = 'READY';
      this.lastError = undefined;
    } else {
      this.status = 'UNAVAILABLE';
      this.lastError = `Handy executable not found: "${this.config.executablePath}". Please install Handy and ensure it is on PATH.`;
    }
  }

  async execute(input: AdapterInput): Promise<AdapterOutput> {
    if (!featureFlags.isAdapterEnabled(this.id)) {
      this.status = 'DISABLED';
      return this.errorOutput(input.executionId, 'HANDY_DISABLED: adapter feature flag is off');
    }

    const healthy = await this.healthCheck();
    if (!healthy) {
      this.status = 'UNAVAILABLE';
      return this.errorOutput(
        input.executionId,
        `HANDY_UNAVAILABLE: "${this.config.executablePath}" not found on PATH.`
      );
    }

    const capabilityFlagMap: Record<string, string> = {
      'voice.listen': '--toggle-transcription',
      'voice.listen.postprocess': '--toggle-post-process',
      'voice.cancel': '--cancel',
    };

    const cliFlag = capabilityFlagMap[input.capability];
    if (!cliFlag) {
      return this.errorOutput(
        input.executionId,
        `HANDY_INVALID_INPUT: unsupported capability "${input.capability}".`
      );
    }

    this.status = 'BUSY';
    const startTime = Date.now();

    eventBus.emit(
      eventBus.createEvent({
        type: 'adapter.execution.started',
        category: 'ADAPTER',
        source: 'HandyAdapter',
        payload: {
          adapterId: this.id,
          executionId: input.executionId,
          capability: input.capability,
        },
      })
    );

    const result = await this.sendSignal(input.executionId, cliFlag);
    const duration_ms = Date.now() - startTime;
    this.status = 'READY';

    if (!result.success) {
      eventBus.emit(
        eventBus.createEvent({
          type: 'adapter.execution.failed',
          category: 'ADAPTER',
          source: 'HandyAdapter',
          payload: {
            adapterId: this.id,
            executionId: input.executionId,
            errorCode: result.error?.split(':')[0] ?? 'HANDY_EXECUTION_FAILED',
          },
        })
      );
      return this.errorOutput(input.executionId, result.error!);
    }

    eventBus.emit(
      eventBus.createEvent({
        type: 'adapter.execution.completed',
        category: 'ADAPTER',
        source: 'HandyAdapter',
        payload: {
          adapterId: this.id,
          executionId: input.executionId,
          capability: input.capability,
          duration_ms,
        },
      })
    );

    return {
      success: true,
      executionId: input.executionId,
      adapterId: this.id,
      output: {
        signalSent: cliFlag,
        capability: input.capability,
        duration_ms,
        note: 'Control signal sent to Handy successfully. Transcription text is injected by Handy directly into the focused UI element.',
      },
      duration_ms,
    };
  }

  async cancel(executionId: string): Promise<void> {
    const child = this.activeProcesses.get(executionId);
    if (child) {
      try { child.kill('SIGTERM'); } catch {}
      this.activeProcesses.delete(executionId);
      this.status = 'READY';
      eventBus.emit(
        eventBus.createEvent({
          type: 'adapter.execution.cancelled',
          category: 'ADAPTER',
          source: 'HandyAdapter',
          payload: {
            adapterId: this.id,
            executionId,
            cancellationType: 'LOCAL_PROCESS_CANCELLED',
          },
        })
      );
    }
  }

  async shutdown(): Promise<void> {
    this.status = 'STOPPING';
    for (const [execId, child] of this.activeProcesses.entries()) {
      try { child.kill('SIGTERM'); } catch {}
      this.activeProcesses.delete(execId);
    }
    this.status = 'STOPPED';
  }

  private sendSignal(
    executionId: string,
    cliFlag: string
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn(this.config.executablePath, [cliFlag], {
          shell: false,
          windowsHide: true,
          env: process.env,
        });
      } catch (err: any) {
        return resolve({
          success: false,
          error: `HANDY_SPAWN_FAILED: ${err?.message ?? err}`,
        });
      }

      this.activeProcesses.set(executionId, child);

      let stderr = '';
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString('utf8');
      });

      const timeout = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch {}
        this.activeProcesses.delete(executionId);
        resolve({ success: false, error: 'HANDY_TIMEOUT: signal spawn exceeded time limit' });
      }, this.config.signalTimeoutMs);

      child.on('error', (err) => {
        clearTimeout(timeout);
        this.activeProcesses.delete(executionId);
        resolve({ success: false, error: `HANDY_PROCESS_ERROR: ${err.message}` });
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        this.activeProcesses.delete(executionId);

        if (code !== 0) {
          const sanitizedStderr = stderr.slice(0, 200).replace(/[A-Z]:\\.+?(?=\s|$)/gi, '<path>');
          resolve({
            success: false,
            error: `HANDY_EXECUTION_FAILED: CLI exited with code ${code}. stderr: ${sanitizedStderr}`,
          });
          return;
        }

        resolve({ success: true });
      });
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JARVIS Phase 4 — Step 12 — TradingAgents Adapter
// ─────────────────────────────────────────────────────────────────────────────

export interface TradingAgentsConfig {
  executablePath: string;
  pythonPath: string;
  requestTimeoutMs: number;
  executionTimeoutMs: number;
  healthCheckTimeoutMs: number;
}

export class TradingAgentsAdapter extends BaseAdapter {
  readonly id = 'tradingagents';
  readonly name = 'TradingAgents Multi-Agent Financial Framework';
  readonly version = '0.3.1';
  readonly category: AdapterCategory = 'TRADING';

  private config: TradingAgentsConfig = {
    executablePath: 'tradingagents',
    pythonPath: 'python',
    requestTimeoutMs: 10_000,
    executionTimeoutMs: 120_000,
    healthCheckTimeoutMs: 3_000,
  };

  private activeProcesses: Map<string, ChildProcess> = new Map();

  constructor(config?: Partial<TradingAgentsConfig>) {
    super();
    if (config) this.config = { ...this.config, ...config };
  }

  getCapabilities(): AdapterCapability[] {
    return [
      {
        id: 'trading.analyze',
        name: 'TradingAgents Market Analysis',
        description: 'Multi-agent LLM financial fundamental, technical, and sentiment market analysis',
        requiresGPU: false,
        requiresPython: true,
      },
      {
        id: 'trading.backtest',
        name: 'TradingAgents Strategy Backtesting',
        description: 'Backtest quantitative multi-agent trading strategies over historical data',
        requiresGPU: false,
        requiresPython: true,
      },
    ];
  }

  protected requiresGPU(): boolean { return false; }
  protected requiresPython(): boolean { return true; }
  protected getDependencies(): string[] { return ['TradingAgents Python Package (>=0.3.1)', 'Python >=3.10']; }

  async healthCheck(): Promise<boolean> {
    if (!featureFlags.isAdapterEnabled(this.id)) {
      return false;
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (val: boolean) => {
        if (!settled) {
          settled = true;
          resolve(val);
        }
      };

      let child: ChildProcess;
      try {
        child = spawn(this.config.executablePath, ['--help'], {
          shell: false,
          windowsHide: true,
        });
      } catch {
        return this.pythonModuleProbe().then(settle);
      }

      const timeout = setTimeout(() => {
        try { child.kill(); } catch {}
        settle(false);
      }, this.config.healthCheckTimeoutMs);

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== null) settle(true);
        else this.pythonModuleProbe().then(settle);
      });

      child.on('error', () => {
        clearTimeout(timeout);
        this.pythonModuleProbe().then(settle);
      });
    });
  }

  private async pythonModuleProbe(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn(this.config.pythonPath, ['-m', 'tradingagents', '--help'], {
          shell: false,
          windowsHide: true,
        });
      } catch {
        return resolve(false);
      }

      const timeout = setTimeout(() => {
        try { child.kill(); } catch {}
        resolve(false);
      }, this.config.healthCheckTimeoutMs);

      child.on('close', (code) => {
        clearTimeout(timeout);
        resolve(code !== null && code === 0);
      });

      child.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  }

  async initialize(): Promise<void> {
    this.enabled = featureFlags.isAdapterEnabled(this.id);
    if (!this.enabled) {
      this.status = 'DISABLED';
      return;
    }

    this.status = 'INITIALIZING';
    const healthy = await this.healthCheck();
    if (healthy) {
      this.status = 'READY';
      this.lastError = undefined;
    } else {
      this.status = 'UNAVAILABLE';
      this.lastError = `TradingAgents runtime unavailable. Ensure Python >=3.10 and tradingagents package are installed.`;
    }
  }

  async execute(input: AdapterInput): Promise<AdapterOutput> {
    if (
      input.capability === 'trading.live' ||
      input.payload?.mode === 'LIVE' ||
      input.payload?.live === true ||
      input.payload?.executeOrders === true
    ) {
      return this.errorOutput(
        input.executionId,
        'TRADING_LIVE_DISABLED: Live broker order placement is permanently disabled for financial safety.'
      );
    }

    if (!featureFlags.isAdapterEnabled(this.id)) {
      this.status = 'DISABLED';
      return this.errorOutput(input.executionId, 'TRADING_DISABLED: Adapter feature flag is off');
    }

    const healthy = await this.healthCheck();
    if (!healthy) {
      this.status = 'UNAVAILABLE';
      return this.errorOutput(
        input.executionId,
        'TRADING_UNAVAILABLE: TradingAgents runtime or Python environment not reachable'
      );
    }

    const symbol = input.payload?.symbol ? String(input.payload.symbol).trim().toUpperCase() : 'AAPL';
    if (!/^[A-Z0-9.\-=]{1,15}$/.test(symbol)) {
      return this.errorOutput(input.executionId, 'TRADING_INVALID_INPUT: Invalid ticker symbol format');
    }

    const mode = input.capability === 'trading.backtest' ? 'BACKTEST' : 'ANALYSIS';

    this.status = 'BUSY';
    const startTime = Date.now();

    eventBus.emit(
      eventBus.createEvent({
        type: 'adapter.execution.started',
        category: 'ADAPTER',
        source: 'TradingAgentsAdapter',
        payload: {
          adapterId: this.id,
          executionId: input.executionId,
          capability: input.capability,
          symbol,
          mode,
        },
      })
    );

    const outputDir = path.join(process.cwd(), 'generated_sites', 'artifacts');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const outputFileName = `tradingagents_${symbol.toLowerCase()}_${input.executionId}.json`;
    const outputFilePath = path.join(outputDir, outputFileName);
    const relOutputPath = `generated_sites/artifacts/${outputFileName}`;

    const args = [
      '--symbol', symbol,
      '--output', outputFilePath,
      '--mode', mode.toLowerCase(),
    ];

    if (input.payload?.startDate) args.push('--start-date', String(input.payload.startDate));
    if (input.payload?.endDate) args.push('--end-date', String(input.payload.endDate));

    const result = await this.runProcess(input.executionId, args, outputFilePath);
    const duration_ms = Date.now() - startTime;
    this.status = 'READY';

    if (!result.success) {
      eventBus.emit(
        eventBus.createEvent({
          type: 'adapter.execution.failed',
          category: 'ADAPTER',
          source: 'TradingAgentsAdapter',
          payload: {
            adapterId: this.id,
            executionId: input.executionId,
            error: result.error,
          },
        })
      );
      return this.errorOutput(input.executionId, result.error!);
    }

    const artifactId = `art_tradingagents_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const artifact: Artifact = {
      id: artifactId,
      type: 'TRADING_ANALYSIS',
      name: outputFileName,
      path: relOutputPath,
      createdAt: new Date().toISOString(),
      createdBy: 'TradingAgentsAdapter',
      missionId: input.missionId,
      taskId: input.taskId,
      metadata: {
        source: 'TradingAgents',
        capability: input.capability,
        symbol,
        mode,
        executionMode: mode,
      },
    };

    registerArtifact(artifact);

    eventBus.emit(
      eventBus.createEvent({
        type: 'adapter.execution.completed',
        category: 'ADAPTER',
        source: 'TradingAgentsAdapter',
        payload: {
          adapterId: this.id,
          executionId: input.executionId,
          artifactIds: [artifactId],
          symbol,
          mode,
        },
      })
    );

    return {
      success: true,
      executionId: input.executionId,
      adapterId: this.id,
      artifactIds: [artifactId],
      output: {
        symbol,
        mode,
        reportPath: relOutputPath,
        executionMode: mode,
        sourceType: 'REAL_TRADINGAGENTS',
      },
      duration_ms,
    };
  }

  async cancel(executionId: string): Promise<void> {
    const child = this.activeProcesses.get(executionId);
    if (child) {
      try { child.kill('SIGTERM'); } catch {}
      this.activeProcesses.delete(executionId);
      this.status = 'READY';
      eventBus.emit(
        eventBus.createEvent({
          type: 'adapter.execution.cancelled',
          category: 'ADAPTER',
          source: 'TradingAgentsAdapter',
          payload: {
            adapterId: this.id,
            executionId,
            cancellationType: 'LOCAL_PROCESS_CANCELLED',
          },
        })
      );
    }
  }

  async shutdown(): Promise<void> {
    this.status = 'STOPPING';
    for (const [execId, child] of this.activeProcesses.entries()) {
      try { child.kill('SIGTERM'); } catch {}
      this.activeProcesses.delete(execId);
    }
    this.status = 'STOPPED';
  }

  private runProcess(
    executionId: string,
    args: string[],
    outputFilePath: string
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn(this.config.executablePath, args, {
          shell: false,
          windowsHide: true,
          env: process.env,
        });
      } catch (err: any) {
        return resolve({
          success: false,
          error: `TRADING_SPAWN_FAILED: ${err?.message ?? err}`,
        });
      }

      this.activeProcesses.set(executionId, child);
      let stderr = '';

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString('utf8');
      });

      const timeout = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch {}
        this.activeProcesses.delete(executionId);
        resolve({ success: false, error: 'TRADING_TIMEOUT: Analysis run exceeded time limit' });
      }, this.config.executionTimeoutMs);

      child.on('error', (err) => {
        clearTimeout(timeout);
        this.activeProcesses.delete(executionId);
        resolve({ success: false, error: `TRADING_PROCESS_ERROR: ${err.message}` });
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        this.activeProcesses.delete(executionId);

        if (code !== 0) {
          const sanitizedStderr = stderr.slice(0, 300).replace(/[A-Z]:\\.+?(?=\s|$)/gi, '<path>');
          resolve({
            success: false,
            error: `TRADING_EXECUTION_FAILED: Process exited with code ${code}. ${sanitizedStderr}`,
          });
          return;
        }

        if (!fs.existsSync(outputFilePath)) {
          resolve({ success: false, error: 'TRADING_ARTIFACT_MISSING: Analysis report file not produced' });
          return;
        }

        resolve({ success: true });
      });
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JARVIS Phase 4 — Step 13 — MiroFish Adapter
// ─────────────────────────────────────────────────────────────────────────────

export interface MiroFishConfig {
  host: string;
  port: number;
  requestTimeoutMs: number;
  executionTimeoutMs: number;
  healthCheckTimeoutMs: number;
}

export class MiroFishAdapter extends BaseAdapter {
  readonly id = 'mirofish';
  readonly name = 'MiroFish Swarm Intelligence Prediction Engine';
  readonly version = '1.0.0';
  readonly category: AdapterCategory = 'RESEARCH';

  private config: MiroFishConfig = {
    host: '127.0.0.1',
    port: 3000,
    requestTimeoutMs: 5_000,
    executionTimeoutMs: 120_000,
    healthCheckTimeoutMs: 3_000,
  };

  private activeAbortControllers: Map<string, AbortController> = new Map();

  constructor(config?: Partial<MiroFishConfig>) {
    super();
    if (config) this.config = { ...this.config, ...config };
  }

  getCapabilities(): AdapterCapability[] {
    return [
      {
        id: 'research.simulate',
        name: 'MiroFish Multi-Agent Simulation',
        description: 'Construct a parallel digital world to simulate multi-agent interactions and policy trajectories',
        requiresGPU: false,
      },
      {
        id: 'research.predict',
        name: 'MiroFish Swarm Intelligence Prediction',
        description: 'Deduce future outcomes and trends from seed materials using swarm intelligence',
        requiresGPU: false,
      },
    ];
  }

  protected requiresGPU(): boolean { return false; }
  protected getDependencies(): string[] { return ['MiroFish Engine (docker / service at port 3000)']; }

  // -------------------------------------------------------------------------
  // Health check — real HTTP health check against local MiroFish service
  // -------------------------------------------------------------------------
  async healthCheck(): Promise<boolean> {
    if (!featureFlags.isAdapterEnabled(this.id)) {
      return false;
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (val: boolean) => {
        if (!settled) {
          settled = true;
          resolve(val);
        }
      };

      const timeout = setTimeout(() => settle(false), this.config.healthCheckTimeoutMs);

      try {
        const req = http.request(
          {
            hostname: this.config.host,
            port: this.config.port,
            path: '/api/health',
            method: 'GET',
            timeout: this.config.healthCheckTimeoutMs,
          },
          (res) => {
            clearTimeout(timeout);
            settle(res.statusCode === 200 || res.statusCode === 204);
            res.resume();
          }
        );

        req.on('error', () => {
          clearTimeout(timeout);
          settle(false);
        });

        req.on('timeout', () => {
          req.destroy();
          clearTimeout(timeout);
          settle(false);
        });

        req.end();
      } catch {
        clearTimeout(timeout);
        settle(false);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------
  async initialize(): Promise<void> {
    this.enabled = featureFlags.isAdapterEnabled(this.id);
    if (!this.enabled) {
      this.status = 'DISABLED';
      return;
    }

    this.status = 'INITIALIZING';
    const healthy = await this.healthCheck();
    if (healthy) {
      this.status = 'READY';
      this.lastError = undefined;
    } else {
      this.status = 'UNAVAILABLE';
      this.lastError = `MiroFish engine unreachable at http://${this.config.host}:${this.config.port}`;
    }
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------
  async execute(input: AdapterInput): Promise<AdapterOutput> {
    if (!featureFlags.isAdapterEnabled(this.id)) {
      this.status = 'DISABLED';
      return this.errorOutput(input.executionId, 'MIROFISH_DISABLED: Adapter feature flag is off');
    }

    const healthy = await this.healthCheck();
    if (!healthy) {
      this.status = 'UNAVAILABLE';
      return this.errorOutput(
        input.executionId,
        `MIROFISH_UNAVAILABLE: Engine unreachable at http://${this.config.host}:${this.config.port}`
      );
    }

    const scenario = input.payload?.scenario ? String(input.payload.scenario).trim() : '';
    if (!scenario && !input.payload?.seedMaterial) {
      return this.errorOutput(input.executionId, 'MIROFISH_INVALID_INPUT: Scenario or seedMaterial required');
    }

    this.status = 'BUSY';
    const startTime = Date.now();
    const abortController = new AbortController();
    this.activeAbortControllers.set(input.executionId, abortController);

    eventBus.emit(
      eventBus.createEvent({
        type: 'adapter.execution.started',
        category: 'ADAPTER',
        source: 'MiroFishAdapter',
        payload: {
          adapterId: this.id,
          executionId: input.executionId,
          capability: input.capability,
        },
      })
    );

    const outputDir = path.join(process.cwd(), 'generated_sites', 'artifacts');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const outputFileName = `mirofish_report_${input.executionId}.json`;
    const outputFilePath = path.join(outputDir, outputFileName);
    const relOutputPath = `generated_sites/artifacts/${outputFileName}`;

    try {
      const payloadData = JSON.stringify({
        scenario,
        capability: input.capability,
        seedMaterial: input.payload?.seedMaterial ?? '',
        parameters: input.payload?.parameters ?? {},
      });

      const responseText = await new Promise<string>((resolve, reject) => {
        if (abortController.signal.aborted) {
          return reject(new Error('AbortError'));
        }

        const req = http.request(
          {
            hostname: this.config.host,
            port: this.config.port,
            path: '/api/simulate',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payloadData),
            },
            timeout: this.config.executionTimeoutMs,
          },
          (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => {
              if (res.statusCode === 200 || res.statusCode === 201) {
                resolve(body);
              } else {
                reject(new Error(`MiroFish HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
              }
            });
          }
        );

        const onAbort = () => {
          req.destroy();
          reject(new Error('AbortError'));
        };

        abortController.signal.addEventListener('abort', onAbort);

        req.on('error', (err) => {
          abortController.signal.removeEventListener('abort', onAbort);
          reject(err);
        });

        req.on('timeout', () => {
          req.destroy();
          abortController.signal.removeEventListener('abort', onAbort);
          reject(new Error('MIROFISH_TIMEOUT: Simulation run exceeded time limit'));
        });

        req.write(payloadData);
        req.end();
      });

      fs.writeFileSync(outputFilePath, responseText, 'utf8');

      const duration_ms = Date.now() - startTime;
      this.status = 'READY';
      this.activeAbortControllers.delete(input.executionId);

      const artifactId = `art_mirofish_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const artifact: Artifact = {
        id: artifactId,
        type: 'SIMULATION',
        name: outputFileName,
        path: relOutputPath,
        createdAt: new Date().toISOString(),
        createdBy: 'MiroFishAdapter',
        missionId: input.missionId,
        taskId: input.taskId,
        metadata: {
          source: 'MiroFish',
          capability: input.capability,
          scenario,
        },
      };

      registerArtifact(artifact);

      eventBus.emit(
        eventBus.createEvent({
          type: 'adapter.execution.completed',
          category: 'ADAPTER',
          source: 'MiroFishAdapter',
          payload: {
            adapterId: this.id,
            executionId: input.executionId,
            artifactIds: [artifactId],
          },
        })
      );

      return {
        success: true,
        executionId: input.executionId,
        adapterId: this.id,
        artifactIds: [artifactId],
        output: {
          scenario,
          reportPath: relOutputPath,
          sourceType: 'REAL_MIROFISH',
        },
        duration_ms,
      };
    } catch (err: any) {
      this.status = 'READY';
      this.activeAbortControllers.delete(input.executionId);

      const isCancel = err?.message === 'AbortError' || err?.name === 'AbortError';
      const errMsg = isCancel
        ? 'MIROFISH_CANCELLED: Execution aborted by user'
        : err?.message || 'MIROFISH_EXECUTION_FAILED';

      eventBus.emit(
        eventBus.createEvent({
          type: isCancel ? 'adapter.execution.cancelled' : 'adapter.execution.failed',
          category: 'ADAPTER',
          source: 'MiroFishAdapter',
          payload: {
            adapterId: this.id,
            executionId: input.executionId,
            error: errMsg,
          },
        })
      );

      return this.errorOutput(input.executionId, errMsg);
    }
  }

  async cancel(executionId: string): Promise<void> {
    const controller = this.activeAbortControllers.get(executionId);
    if (controller) {
      controller.abort();
      this.activeAbortControllers.delete(executionId);
      this.status = 'READY';
    }
  }

  async shutdown(): Promise<void> {
    this.status = 'STOPPING';
    for (const [execId, controller] of this.activeAbortControllers.entries()) {
      controller.abort();
      this.activeAbortControllers.delete(execId);
    }
    this.status = 'STOPPED';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JARVIS Phase 4 — Step 14 — HeyGem.ai Adapter
// ─────────────────────────────────────────────────────────────────────────────

export interface HeyGemConfig {
  host: string;
  port: number;
  requestTimeoutMs: number;
  executionTimeoutMs: number;
  healthCheckTimeoutMs: number;
}

export class HeyGemAdapter extends BaseAdapter {
  readonly id = 'heygem';
  readonly name = 'HeyGem.ai Digital Avatar Generator';
  readonly version = '1.0.0';
  readonly category: AdapterCategory = 'CREATIVE';

  private config: HeyGemConfig = {
    host: '127.0.0.1',
    port: 8000,
    requestTimeoutMs: 5_000,
    executionTimeoutMs: 180_000,
    healthCheckTimeoutMs: 3_000,
  };

  private activeAbortControllers: Map<string, AbortController> = new Map();

  constructor(config?: Partial<HeyGemConfig>) {
    super();
    if (config) this.config = { ...this.config, ...config };
  }

  getCapabilities(): AdapterCapability[] {
    return [
      {
        id: 'creative.avatar.generate',
        name: 'HeyGem Digital Avatar Generation',
        description: 'Generate realistic digital human avatar video with lip sync from source video and audio track',
        requiresGPU: true,
      },
    ];
  }

  protected requiresGPU(): boolean { return true; }
  protected getDependencies(): string[] { return ['HeyGem.ai Local Service (listening on http://127.0.0.1:8000)']; }

  // -------------------------------------------------------------------------
  // Health check — real HTTP health probe against local HeyGem service
  // -------------------------------------------------------------------------
  async healthCheck(): Promise<boolean> {
    if (!featureFlags.isAdapterEnabled(this.id)) {
      return false;
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (val: boolean) => {
        if (!settled) {
          settled = true;
          resolve(val);
        }
      };

      const timeout = setTimeout(() => settle(false), this.config.healthCheckTimeoutMs);

      try {
        const req = http.request(
          {
            hostname: this.config.host,
            port: this.config.port,
            path: '/api/health',
            method: 'GET',
            timeout: this.config.healthCheckTimeoutMs,
          },
          (res) => {
            clearTimeout(timeout);
            settle(res.statusCode === 200 || res.statusCode === 204);
            res.resume();
          }
        );

        req.on('error', () => {
          clearTimeout(timeout);
          settle(false);
        });

        req.on('timeout', () => {
          req.destroy();
          clearTimeout(timeout);
          settle(false);
        });

        req.end();
      } catch {
        clearTimeout(timeout);
        settle(false);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------
  async initialize(): Promise<void> {
    this.enabled = featureFlags.isAdapterEnabled(this.id);
    if (!this.enabled) {
      this.status = 'DISABLED';
      return;
    }

    this.status = 'INITIALIZING';
    const healthy = await this.healthCheck();
    if (healthy) {
      this.status = 'READY';
      this.lastError = undefined;
    } else {
      this.status = 'UNAVAILABLE';
      this.lastError = `HeyGem service unreachable at http://${this.config.host}:${this.config.port}`;
    }
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------
  async execute(input: AdapterInput): Promise<AdapterOutput> {
    if (!featureFlags.isAdapterEnabled(this.id)) {
      this.status = 'DISABLED';
      return this.errorOutput(input.executionId, 'HEYGEM_DISABLED: Adapter feature flag is off');
    }

    const healthy = await this.healthCheck();
    if (!healthy) {
      this.status = 'UNAVAILABLE';
      return this.errorOutput(
        input.executionId,
        `HEYGEM_UNAVAILABLE: Service unreachable at http://${this.config.host}:${this.config.port}`
      );
    }

    // Media sandbox validation
    const sourceVideo = input.payload?.videoPath ? String(input.payload.videoPath) : '';
    const audioPath = input.payload?.audioPath ? String(input.payload.audioPath) : '';

    if (!sourceVideo || !audioPath) {
      return this.errorOutput(input.executionId, 'HEYGEM_INVALID_INPUT: videoPath and audioPath are required');
    }

    const sandboxRoot = path.resolve(process.cwd(), 'generated_sites');
    const absVideo = path.resolve(sourceVideo);
    const absAudio = path.resolve(audioPath);

    if (!absVideo.startsWith(sandboxRoot) || !absAudio.startsWith(sandboxRoot)) {
      return this.errorOutput(input.executionId, 'HEYGEM_SECURITY: Input media files must be inside generated_sites sandbox');
    }

    if (!fs.existsSync(absVideo) || !fs.existsSync(absAudio)) {
      return this.errorOutput(input.executionId, 'HEYGEM_INVALID_MEDIA: Input video or audio file does not exist');
    }

    this.status = 'BUSY';
    const startTime = Date.now();
    const abortController = new AbortController();
    this.activeAbortControllers.set(input.executionId, abortController);

    eventBus.emit(
      eventBus.createEvent({
        type: 'adapter.execution.started',
        category: 'ADAPTER',
        source: 'HeyGemAdapter',
        payload: {
          adapterId: this.id,
          executionId: input.executionId,
          capability: input.capability,
        },
      })
    );

    const outputDir = path.join(process.cwd(), 'generated_sites', 'artifacts');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const outputFileName = `heygem_avatar_${input.executionId}.mp4`;
    const outputFilePath = path.join(outputDir, outputFileName);
    const relOutputPath = `generated_sites/artifacts/${outputFileName}`;

    try {
      const payloadData = JSON.stringify({
        video_path: absVideo,
        audio_path: absAudio,
        output_path: outputFilePath,
      });

      await new Promise<void>((resolve, reject) => {
        if (abortController.signal.aborted) return reject(new Error('AbortError'));

        const req = http.request(
          {
            hostname: this.config.host,
            port: this.config.port,
            path: '/api/v1/generate-avatar',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payloadData),
            },
            timeout: this.config.executionTimeoutMs,
          },
          (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => {
              if (res.statusCode === 200 || res.statusCode === 201) {
                resolve();
              } else {
                reject(new Error(`HeyGem HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
              }
            });
          }
        );

        const onAbort = () => {
          req.destroy();
          reject(new Error('AbortError'));
        };

        abortController.signal.addEventListener('abort', onAbort);

        req.on('error', (err) => {
          abortController.signal.removeEventListener('abort', onAbort);
          reject(err);
        });

        req.on('timeout', () => {
          req.destroy();
          abortController.signal.removeEventListener('abort', onAbort);
          reject(new Error('HEYGEM_TIMEOUT: Avatar generation timed out'));
        });

        req.write(payloadData);
        req.end();
      });

      if (!fs.existsSync(outputFilePath)) {
        throw new Error('HEYGEM_ARTIFACT_FAILED: Output video file not produced');
      }

      const duration_ms = Date.now() - startTime;
      this.status = 'READY';
      this.activeAbortControllers.delete(input.executionId);

      const artifactId = `art_heygem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const artifact: Artifact = {
        id: artifactId,
        type: 'VIDEO',
        name: outputFileName,
        path: relOutputPath,
        createdAt: new Date().toISOString(),
        createdBy: 'HeyGemAdapter',
        missionId: input.missionId,
        taskId: input.taskId,
        metadata: {
          source: 'HeyGem',
          capability: input.capability,
        },
      };

      registerArtifact(artifact);

      eventBus.emit(
        eventBus.createEvent({
          type: 'adapter.execution.completed',
          category: 'ADAPTER',
          source: 'HeyGemAdapter',
          payload: {
            adapterId: this.id,
            executionId: input.executionId,
            artifactIds: [artifactId],
          },
        })
      );

      return {
        success: true,
        executionId: input.executionId,
        adapterId: this.id,
        artifactIds: [artifactId],
        output: {
          videoPath: relOutputPath,
          sourceType: 'REAL_HEYGEM',
        },
        duration_ms,
      };
    } catch (err: any) {
      this.status = 'READY';
      this.activeAbortControllers.delete(input.executionId);

      const isCancel = err?.message === 'AbortError' || err?.name === 'AbortError';
      const errMsg = isCancel
        ? 'HEYGEM_CANCELLED: Execution aborted by user'
        : err?.message || 'HEYGEM_EXECUTION_FAILED';

      eventBus.emit(
        eventBus.createEvent({
          type: isCancel ? 'adapter.execution.cancelled' : 'adapter.execution.failed',
          category: 'ADAPTER',
          source: 'HeyGemAdapter',
          payload: {
            adapterId: this.id,
            executionId: input.executionId,
            error: errMsg,
          },
        })
      );

      return this.errorOutput(input.executionId, errMsg);
    }
  }

  async cancel(executionId: string): Promise<void> {
    const controller = this.activeAbortControllers.get(executionId);
    if (controller) {
      controller.abort();
      this.activeAbortControllers.delete(executionId);
      this.status = 'READY';
    }
  }

  async shutdown(): Promise<void> {
    this.status = 'STOPPING';
    for (const [execId, controller] of this.activeAbortControllers.entries()) {
      controller.abort();
      this.activeAbortControllers.delete(execId);
    }
    this.status = 'STOPPED';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JARVIS Phase 4 — Step 15 — CapCut CLI Adapter
// ─────────────────────────────────────────────────────────────────────────────

export interface CapCutConfig {
  executablePath: string;
  healthCheckTimeoutMs: number;
  executionTimeoutMs: number;
}

export class CapCutAdapter extends BaseAdapter {
  readonly id = 'capcut';
  readonly name = 'CapCut CLI Video Editing Engine';
  readonly version = '1.0.0';
  readonly category: AdapterCategory = 'CREATIVE';

  private config: CapCutConfig = {
    executablePath: 'capcut',
    healthCheckTimeoutMs: 3_000,
    executionTimeoutMs: 120_000,
  };

  private activeProcesses: Map<string, ChildProcess> = new Map();

  constructor(config?: Partial<CapCutConfig>) {
    super();
    if (config) this.config = { ...this.config, ...config };
  }

  getCapabilities(): AdapterCapability[] {
    return [
      {
        id: 'creative.video.inspect',
        name: 'CapCut Draft Inspect & Lint',
        description: 'Inspect and lint a CapCut draft_content.json file via capcut-cli (capcut lint <draftPath>). Reports issues in the draft timeline.',
        requiresGPU: false,
      },
    ];
  }

  protected requiresGPU(): boolean { return false; }
  protected getDependencies(): string[] { return ['capcut CLI (npm install -g capcut-cli)']; }

  // -------------------------------------------------------------------------
  // Health check — safe executable probe via `capcut doctor` or `capcut --help`
  // -------------------------------------------------------------------------
  async healthCheck(): Promise<boolean> {
    if (!featureFlags.isAdapterEnabled(this.id)) {
      return false;
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (val: boolean) => {
        if (!settled) {
          settled = true;
          resolve(val);
        }
      };

      let child: ChildProcess;
      try {
        child = spawn(this.config.executablePath, ['doctor'], {
          shell: false,
          windowsHide: true,
        });
      } catch {
        return this.helpProbe().then(settle);
      }

      const timeout = setTimeout(() => {
        try { child.kill(); } catch {}
        settle(false);
      }, this.config.healthCheckTimeoutMs);

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== null) settle(true);
        else this.helpProbe().then(settle);
      });

      child.on('error', () => {
        clearTimeout(timeout);
        this.helpProbe().then(settle);
      });
    });
  }

  private async helpProbe(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn(this.config.executablePath, ['--help'], {
          shell: false,
          windowsHide: true,
        });
      } catch {
        return resolve(false);
      }

      const timeout = setTimeout(() => {
        try { child.kill(); } catch {}
        resolve(false);
      }, this.config.healthCheckTimeoutMs);

      child.on('close', (code) => {
        clearTimeout(timeout);
        resolve(code !== null);
      });

      child.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------
  async initialize(): Promise<void> {
    this.enabled = featureFlags.isAdapterEnabled(this.id);
    if (!this.enabled) {
      this.status = 'DISABLED';
      return;
    }

    this.status = 'INITIALIZING';
    const healthy = await this.healthCheck();
    if (healthy) {
      this.status = 'READY';
      this.lastError = undefined;
    } else {
      this.status = 'UNAVAILABLE';
      this.lastError = `CapCut CLI not found: "${this.config.executablePath}". Install via: npm install -g capcut-cli`;
    }
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------
  async execute(input: AdapterInput): Promise<AdapterOutput> {
    if (!featureFlags.isAdapterEnabled(this.id)) {
      this.status = 'DISABLED';
      return this.errorOutput(input.executionId, 'CAPCUT_DISABLED: Adapter feature flag is off');
    }

    const healthy = await this.healthCheck();
    if (!healthy) {
      this.status = 'UNAVAILABLE';
      return this.errorOutput(
        input.executionId,
        `CAPCUT_UNAVAILABLE: CLI "${this.config.executablePath}" not reachable`
      );
    }

    const draftPath = input.payload?.draftPath ? String(input.payload.draftPath) : '';

    if (!draftPath) {
      return this.errorOutput(input.executionId, 'CAPCUT_INVALID_INPUT: draftPath is required (path to a CapCut draft_content.json or draft folder)');
    }

    // Sandbox validation
    const sandboxRoot = path.resolve(process.cwd(), 'generated_sites');
    const absDraft = path.resolve(draftPath);

    if (!absDraft.startsWith(sandboxRoot)) {
      return this.errorOutput(input.executionId, 'CAPCUT_SECURITY: draftPath must reside within generated_sites sandbox');
    }

    if (!fs.existsSync(absDraft)) {
      return this.errorOutput(input.executionId, 'CAPCUT_INVALID_DRAFT: Draft path does not exist');
    }

    if (input.capability !== 'creative.video.inspect') {
      return this.errorOutput(input.executionId, `CAPCUT_INVALID_CAPABILITY: Unsupported capability "${input.capability}"`);
    }

    this.status = 'BUSY';
    const startTime = Date.now();

    eventBus.emit(
      eventBus.createEvent({
        type: 'adapter.execution.started',
        category: 'ADAPTER',
        source: 'CapCutAdapter',
        payload: {
          adapterId: this.id,
          executionId: input.executionId,
          capability: input.capability,
        },
      })
    );

    const outputDir = path.join(process.cwd(), 'generated_sites', 'artifacts');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const outputFileName = `capcut_lint_${input.executionId}.json`;
    const outputFilePath = path.join(outputDir, outputFileName);
    const relOutputPath = `generated_sites/artifacts/${outputFileName}`;

    // Real capcut-cli command: capcut lint <draftPath> --json
    const args = ['lint', absDraft, '--json'];

    const result = await this.runProcess(input.executionId, args, outputFilePath);
    const duration_ms = Date.now() - startTime;
    this.status = 'READY';

    if (!result.success) {
      eventBus.emit(
        eventBus.createEvent({
          type: 'adapter.execution.failed',
          category: 'ADAPTER',
          source: 'CapCutAdapter',
          payload: {
            adapterId: this.id,
            executionId: input.executionId,
            error: result.error,
          },
        })
      );
      return this.errorOutput(input.executionId, result.error!);
    }

    const artifactId = `art_capcut_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const artifact: Artifact = {
      id: artifactId,
      type: 'DOCUMENT',
      name: outputFileName,
      path: relOutputPath,
      createdAt: new Date().toISOString(),
      createdBy: 'CapCutAdapter',
      missionId: input.missionId,
      taskId: input.taskId,
      metadata: {
        source: 'CapCutCLI',
        capability: input.capability,
        draftPath: absDraft.replace(/[A-Z]:\\.+?(?=\s|$)/gi, '<path>'),
      },
    };

    registerArtifact(artifact);

    eventBus.emit(
      eventBus.createEvent({
        type: 'adapter.execution.completed',
        category: 'ADAPTER',
        source: 'CapCutAdapter',
        payload: {
          adapterId: this.id,
          executionId: input.executionId,
          artifactIds: [artifactId],
        },
      })
    );

    return {
      success: true,
      executionId: input.executionId,
      adapterId: this.id,
      artifactIds: [artifactId],
      output: {
        lintReportPath: relOutputPath,
        sourceType: 'REAL_CAPCUT_CLI',
      },
      duration_ms,
    };
  }

  async cancel(executionId: string): Promise<void> {
    const child = this.activeProcesses.get(executionId);
    if (child) {
      try { child.kill('SIGTERM'); } catch {}
      this.activeProcesses.delete(executionId);
      this.status = 'READY';
      eventBus.emit(
        eventBus.createEvent({
          type: 'adapter.execution.cancelled',
          category: 'ADAPTER',
          source: 'CapCutAdapter',
          payload: {
            adapterId: this.id,
            executionId,
            cancellationType: 'LOCAL_PROCESS_CANCELLED',
          },
        })
      );
    }
  }

  async shutdown(): Promise<void> {
    this.status = 'STOPPING';
    for (const [execId, child] of this.activeProcesses.entries()) {
      try { child.kill('SIGTERM'); } catch {}
      this.activeProcesses.delete(execId);
    }
    this.status = 'STOPPED';
  }

  private runProcess(
    executionId: string,
    args: string[],
    outputFilePath: string
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn(this.config.executablePath, args, {
          shell: false,
          windowsHide: true,
          env: process.env,
        });
      } catch (err: any) {
        return resolve({
          success: false,
          error: `CAPCUT_SPAWN_FAILED: ${err?.message ?? err}`,
        });
      }

      this.activeProcesses.set(executionId, child);
      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString('utf8');
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString('utf8');
      });

      const timeout = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch {}
        this.activeProcesses.delete(executionId);
        resolve({ success: false, error: 'CAPCUT_TIMEOUT: Lint run exceeded time limit' });
      }, this.config.executionTimeoutMs);

      child.on('error', (err) => {
        clearTimeout(timeout);
        this.activeProcesses.delete(executionId);
        resolve({ success: false, error: `CAPCUT_PROCESS_ERROR: ${err.message}` });
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        this.activeProcesses.delete(executionId);

        if (code !== 0) {
          const sanitizedStderr = stderr.slice(0, 300).replace(/[A-Z]:\\.+?(?=\s|$)/gi, '<path>');
          resolve({
            success: false,
            error: `CAPCUT_EXECUTION_FAILED: Process exited with code ${code}. ${sanitizedStderr}`,
          });
          return;
        }

        // capcut lint --json writes JSON to stdout; write it to the output file
        if (!stdout.trim()) {
          resolve({ success: false, error: 'CAPCUT_ARTIFACT_MISSING: No lint output produced' });
          return;
        }

        try {
          fs.writeFileSync(outputFilePath, stdout, 'utf8');
        } catch (writeErr: any) {
          resolve({ success: false, error: `CAPCUT_ARTIFACT_FAILED: Could not write lint report: ${writeErr?.message}` });
          return;
        }

        resolve({ success: true });
      });
    });
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// JARVIS Phase 4 — Step 16 — VoiceStudio Adapter
// ─────────────────────────────────────────────────────────────────────────────

export interface VoiceStudioConfig {
  host: string;
  port: number;
  requestTimeoutMs: number;
  executionTimeoutMs: number;
  healthCheckTimeoutMs: number;
}

export class VoiceStudioAdapter extends BaseAdapter {
  readonly id = 'voicestudio';
  readonly name = 'VoiceStudio Local Voice Engine';
  readonly version = '1.0.0';
  readonly category: AdapterCategory = 'VOICE';

  private config: VoiceStudioConfig = {
    host: '127.0.0.1',
    port: 8888,
    requestTimeoutMs: 5_000,
    executionTimeoutMs: 120_000,
    healthCheckTimeoutMs: 3_000,
  };

  private activeAbortControllers: Map<string, AbortController> = new Map();

  constructor(config?: Partial<VoiceStudioConfig>) {
    super();
    if (config) this.config = { ...this.config, ...config };
  }

  getCapabilities(): AdapterCapability[] {
    return [
      {
        id: 'voice.tts',
        name: 'VoiceStudio Multi-Engine Text-to-Speech',
        description: 'Local multi-engine voice cloning and text-to-speech synthesis (OpenAI Audio API compatible)',
        requiresGPU: false,
      },
    ];
  }

  protected requiresGPU(): boolean { return false; }
  protected getDependencies(): string[] { return ['VoiceStudio Desktop Application / Local REST API (port 8888)']; }

  // -------------------------------------------------------------------------
  // Health check — real HTTP probe against local VoiceStudio service
  // -------------------------------------------------------------------------
  async healthCheck(): Promise<boolean> {
    if (!featureFlags.isAdapterEnabled(this.id)) {
      return false;
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (val: boolean) => {
        if (!settled) {
          settled = true;
          resolve(val);
        }
      };

      const timeout = setTimeout(() => settle(false), this.config.healthCheckTimeoutMs);

      try {
        const req = http.request(
          {
            hostname: this.config.host,
            port: this.config.port,
            path: '/v1/models',
            method: 'GET',
            timeout: this.config.healthCheckTimeoutMs,
          },
          (res) => {
            clearTimeout(timeout);
            settle(res.statusCode === 200 || res.statusCode === 204);
            res.resume();
          }
        );

        req.on('error', () => {
          clearTimeout(timeout);
          settle(false);
        });

        req.on('timeout', () => {
          req.destroy();
          clearTimeout(timeout);
          settle(false);
        });

        req.end();
      } catch {
        clearTimeout(timeout);
        settle(false);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------
  async initialize(): Promise<void> {
    this.enabled = featureFlags.isAdapterEnabled(this.id);
    if (!this.enabled) {
      this.status = 'DISABLED';
      return;
    }

    this.status = 'INITIALIZING';
    const healthy = await this.healthCheck();
    if (healthy) {
      this.status = 'READY';
      this.lastError = undefined;
    } else {
      this.status = 'UNAVAILABLE';
      this.lastError = `VoiceStudio service unreachable at http://${this.config.host}:${this.config.port}`;
    }
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------
  async execute(input: AdapterInput): Promise<AdapterOutput> {
    if (!featureFlags.isAdapterEnabled(this.id)) {
      this.status = 'DISABLED';
      return this.errorOutput(input.executionId, 'VOICESTUDIO_DISABLED: Adapter feature flag is off');
    }

    const healthy = await this.healthCheck();
    if (!healthy) {
      this.status = 'UNAVAILABLE';
      return this.errorOutput(
        input.executionId,
        `VOICESTUDIO_UNAVAILABLE: Service unreachable at http://${this.config.host}:${this.config.port}`
      );
    }

    const text = input.payload?.text ? String(input.payload.text).trim() : '';
    if (!text) {
      return this.errorOutput(input.executionId, 'VOICESTUDIO_INVALID_INPUT: Text payload is required');
    }

    this.status = 'BUSY';
    const startTime = Date.now();
    const abortController = new AbortController();
    this.activeAbortControllers.set(input.executionId, abortController);

    eventBus.emit(
      eventBus.createEvent({
        type: 'adapter.execution.started',
        category: 'ADAPTER',
        source: 'VoiceStudioAdapter',
        payload: {
          adapterId: this.id,
          executionId: input.executionId,
          capability: input.capability,
        },
      })
    );

    const outputDir = path.join(process.cwd(), 'generated_sites', 'artifacts');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const outputFileName = `voicestudio_${input.executionId}.wav`;
    const outputFilePath = path.join(outputDir, outputFileName);
    const relOutputPath = `generated_sites/artifacts/${outputFileName}`;

    try {
      const payloadData = JSON.stringify({
        model: input.payload?.model ?? 'tts-1',
        input: text,
        voice: input.payload?.voice ?? 'alloy',
        response_format: 'wav',
      });

      await new Promise<void>((resolve, reject) => {
        if (abortController.signal.aborted) return reject(new Error('AbortError'));

        const req = http.request(
          {
            hostname: this.config.host,
            port: this.config.port,
            path: '/v1/audio/speech',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payloadData),
            },
            timeout: this.config.executionTimeoutMs,
          },
          (res) => {
            if (res.statusCode !== 200) {
              let body = '';
              res.on('data', (c) => (body += c));
              res.on('end', () => reject(new Error(`VoiceStudio HTTP ${res.statusCode}: ${body.slice(0, 200)}`)));
              return;
            }

            const fileStream = fs.createWriteStream(outputFilePath);
            res.pipe(fileStream);
            fileStream.on('finish', () => {
              fileStream.close();
              resolve();
            });
            fileStream.on('error', (err) => {
              fs.unlink(outputFilePath, () => {});
              reject(err);
            });
          }
        );

        const onAbort = () => {
          req.destroy();
          reject(new Error('AbortError'));
        };

        abortController.signal.addEventListener('abort', onAbort);

        req.on('error', (err) => {
          abortController.signal.removeEventListener('abort', onAbort);
          reject(err);
        });

        req.on('timeout', () => {
          req.destroy();
          abortController.signal.removeEventListener('abort', onAbort);
          reject(new Error('VOICESTUDIO_TIMEOUT: Voice synthesis timed out'));
        });

        req.write(payloadData);
        req.end();
      });

      if (!fs.existsSync(outputFilePath)) {
        throw new Error('VOICESTUDIO_ARTIFACT_FAILED: Output audio file not produced');
      }

      const duration_ms = Date.now() - startTime;
      this.status = 'READY';
      this.activeAbortControllers.delete(input.executionId);

      const artifactId = `art_voicestudio_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const artifact: Artifact = {
        id: artifactId,
        type: 'VOICE',
        name: outputFileName,
        path: relOutputPath,
        createdAt: new Date().toISOString(),
        createdBy: 'VoiceStudioAdapter',
        missionId: input.missionId,
        taskId: input.taskId,
        metadata: {
          source: 'VoiceStudio',
          capability: input.capability,
        },
      };

      registerArtifact(artifact);

      eventBus.emit(
        eventBus.createEvent({
          type: 'adapter.execution.completed',
          category: 'ADAPTER',
          source: 'VoiceStudioAdapter',
          payload: {
            adapterId: this.id,
            executionId: input.executionId,
            artifactIds: [artifactId],
          },
        })
      );

      return {
        success: true,
        executionId: input.executionId,
        adapterId: this.id,
        artifactIds: [artifactId],
        output: {
          audioPath: relOutputPath,
          sourceType: 'REAL_VOICESTUDIO',
        },
        duration_ms,
      };
    } catch (err: any) {
      this.status = 'READY';
      this.activeAbortControllers.delete(input.executionId);

      const isCancel = err?.message === 'AbortError' || err?.name === 'AbortError';
      const errMsg = isCancel
        ? 'VOICESTUDIO_CANCELLED: Execution aborted by user'
        : err?.message || 'VOICESTUDIO_EXECUTION_FAILED';

      eventBus.emit(
        eventBus.createEvent({
          type: isCancel ? 'adapter.execution.cancelled' : 'adapter.execution.failed',
          category: 'ADAPTER',
          source: 'VoiceStudioAdapter',
          payload: {
            adapterId: this.id,
            executionId: input.executionId,
            error: errMsg,
          },
        })
      );

      return this.errorOutput(input.executionId, errMsg);
    }
  }

  async cancel(executionId: string): Promise<void> {
    const controller = this.activeAbortControllers.get(executionId);
    if (controller) {
      controller.abort();
      this.activeAbortControllers.delete(executionId);
      this.status = 'READY';
    }
  }

  async shutdown(): Promise<void> {
    this.status = 'STOPPING';
    for (const [execId, controller] of this.activeAbortControllers.entries()) {
      controller.abort();
      this.activeAbortControllers.delete(execId);
    }
    this.status = 'STOPPED';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JARVIS Phase 4 — Step 17 — DramaClaw Adapter
// ─────────────────────────────────────────────────────────────────────────────

export interface DramaClawConfig {
  host: string;
  port: number;
  requestTimeoutMs: number;
  executionTimeoutMs: number;
  healthCheckTimeoutMs: number;
}

export class DramaClawAdapter extends BaseAdapter {
  readonly id = 'dramaclaw';
  readonly name = 'DramaClaw AI Video Production Factory';
  readonly version = '1.0.0';
  readonly category: AdapterCategory = 'CREATIVE';

  private config: DramaClawConfig = {
    host: '127.0.0.1',
    port: 5000,
    requestTimeoutMs: 5_000,
    executionTimeoutMs: 300_000,
    healthCheckTimeoutMs: 3_000,
  };

  private activeAbortControllers: Map<string, AbortController> = new Map();

  constructor(config?: Partial<DramaClawConfig>) {
    super();
    if (config) this.config = { ...this.config, ...config };
  }

  getCapabilities(): AdapterCapability[] {
    return [
      {
        id: 'creative.video.generate',
        name: 'DramaClaw End-to-End AI Video Generation',
        description: 'Industrialized manuscript-to-film pipeline (scripting, storyboards, voiceover, rendering)',
        requiresGPU: true,
      },
    ];
  }

  protected requiresGPU(): boolean { return true; }
  protected getDependencies(): string[] { return ['DramaClaw Local Engine / Docker Compose (port 5000)']; }

  // -------------------------------------------------------------------------
  // Health check — real HTTP health probe against local DramaClaw service
  // -------------------------------------------------------------------------
  async healthCheck(): Promise<boolean> {
    if (!featureFlags.isAdapterEnabled(this.id)) {
      return false;
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (val: boolean) => {
        if (!settled) {
          settled = true;
          resolve(val);
        }
      };

      const timeout = setTimeout(() => settle(false), this.config.healthCheckTimeoutMs);

      try {
        const req = http.request(
          {
            hostname: this.config.host,
            port: this.config.port,
            path: '/api/health',
            method: 'GET',
            timeout: this.config.healthCheckTimeoutMs,
          },
          (res) => {
            clearTimeout(timeout);
            settle(res.statusCode === 200 || res.statusCode === 204);
            res.resume();
          }
        );

        req.on('error', () => {
          clearTimeout(timeout);
          settle(false);
        });

        req.on('timeout', () => {
          req.destroy();
          clearTimeout(timeout);
          settle(false);
        });

        req.end();
      } catch {
        clearTimeout(timeout);
        settle(false);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------
  async initialize(): Promise<void> {
    this.enabled = featureFlags.isAdapterEnabled(this.id);
    if (!this.enabled) {
      this.status = 'DISABLED';
      return;
    }

    this.status = 'INITIALIZING';
    const healthy = await this.healthCheck();
    if (healthy) {
      this.status = 'READY';
      this.lastError = undefined;
    } else {
      this.status = 'UNAVAILABLE';
      this.lastError = `DramaClaw service unreachable at http://${this.config.host}:${this.config.port}`;
    }
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------
  async execute(input: AdapterInput): Promise<AdapterOutput> {
    if (!featureFlags.isAdapterEnabled(this.id)) {
      this.status = 'DISABLED';
      return this.errorOutput(input.executionId, 'DRAMACLAW_DISABLED: Adapter feature flag is off');
    }

    const healthy = await this.healthCheck();
    if (!healthy) {
      this.status = 'UNAVAILABLE';
      return this.errorOutput(
        input.executionId,
        `DRAMACLAW_UNAVAILABLE: Service unreachable at http://${this.config.host}:${this.config.port}`
      );
    }

    const manuscript = input.payload?.manuscript ? String(input.payload.manuscript).trim() : '';
    if (!manuscript) {
      return this.errorOutput(input.executionId, 'DRAMACLAW_INVALID_INPUT: manuscript text is required');
    }

    this.status = 'BUSY';
    const startTime = Date.now();
    const abortController = new AbortController();
    this.activeAbortControllers.set(input.executionId, abortController);

    eventBus.emit(
      eventBus.createEvent({
        type: 'adapter.execution.started',
        category: 'ADAPTER',
        source: 'DramaClawAdapter',
        payload: {
          adapterId: this.id,
          executionId: input.executionId,
          capability: input.capability,
        },
      })
    );

    const outputDir = path.join(process.cwd(), 'generated_sites', 'artifacts');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const outputFileName = `dramaclaw_film_${input.executionId}.mp4`;
    const outputFilePath = path.join(outputDir, outputFileName);
    const relOutputPath = `generated_sites/artifacts/${outputFileName}`;

    try {
      const payloadData = JSON.stringify({
        manuscript,
        title: input.payload?.title ?? `Film_${input.executionId}`,
        output_path: outputFilePath,
      });

      await new Promise<void>((resolve, reject) => {
        if (abortController.signal.aborted) return reject(new Error('AbortError'));

        const req = http.request(
          {
            hostname: this.config.host,
            port: this.config.port,
            path: '/api/v1/produce-film',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payloadData),
            },
            timeout: this.config.executionTimeoutMs,
          },
          (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => {
              if (res.statusCode === 200 || res.statusCode === 201) {
                resolve();
              } else {
                reject(new Error(`DramaClaw HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
              }
            });
          }
        );

        const onAbort = () => {
          req.destroy();
          reject(new Error('AbortError'));
        };

        abortController.signal.addEventListener('abort', onAbort);

        req.on('error', (err) => {
          abortController.signal.removeEventListener('abort', onAbort);
          reject(err);
        });

        req.on('timeout', () => {
          req.destroy();
          abortController.signal.removeEventListener('abort', onAbort);
          reject(new Error('DRAMACLAW_TIMEOUT: Film production pipeline timed out'));
        });

        req.write(payloadData);
        req.end();
      });

      if (!fs.existsSync(outputFilePath)) {
        throw new Error('DRAMACLAW_ARTIFACT_FAILED: Output film video file not produced');
      }

      const duration_ms = Date.now() - startTime;
      this.status = 'READY';
      this.activeAbortControllers.delete(input.executionId);

      const artifactId = `art_dramaclaw_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const artifact: Artifact = {
        id: artifactId,
        type: 'VIDEO',
        name: outputFileName,
        path: relOutputPath,
        createdAt: new Date().toISOString(),
        createdBy: 'DramaClawAdapter',
        missionId: input.missionId,
        taskId: input.taskId,
        metadata: {
          source: 'DramaClaw',
          capability: input.capability,
        },
      };

      registerArtifact(artifact);

      eventBus.emit(
        eventBus.createEvent({
          type: 'adapter.execution.completed',
          category: 'ADAPTER',
          source: 'DramaClawAdapter',
          payload: {
            adapterId: this.id,
            executionId: input.executionId,
            artifactIds: [artifactId],
          },
        })
      );

      return {
        success: true,
        executionId: input.executionId,
        adapterId: this.id,
        artifactIds: [artifactId],
        output: {
          videoPath: relOutputPath,
          sourceType: 'REAL_DRAMACLAW',
        },
        duration_ms,
      };
    } catch (err: any) {
      this.status = 'READY';
      this.activeAbortControllers.delete(input.executionId);

      const isCancel = err?.message === 'AbortError' || err?.name === 'AbortError';
      const errMsg = isCancel
        ? 'DRAMACLAW_CANCELLED: Execution aborted by user'
        : err?.message || 'DRAMACLAW_EXECUTION_FAILED';

      eventBus.emit(
        eventBus.createEvent({
          type: isCancel ? 'adapter.execution.cancelled' : 'adapter.execution.failed',
          category: 'ADAPTER',
          source: 'DramaClawAdapter',
          payload: {
            adapterId: this.id,
            executionId: input.executionId,
            error: errMsg,
          },
        })
      );

      return this.errorOutput(input.executionId, errMsg);
    }
  }

  async cancel(executionId: string): Promise<void> {
    const controller = this.activeAbortControllers.get(executionId);
    if (controller) {
      controller.abort();
      this.activeAbortControllers.delete(executionId);
      this.status = 'READY';
    }
  }

  async shutdown(): Promise<void> {
    this.status = 'STOPPING';
    for (const [execId, controller] of this.activeAbortControllers.entries()) {
      controller.abort();
      this.activeAbortControllers.delete(execId);
    }
    this.status = 'STOPPED';
  }
}



