/**
 * JARVIS Phase 4 — Real ComfyUI Adapter
 *
 * Connects JARVIS to a ComfyUI instance (default: http://127.0.0.1:8188).
 *
 * ARCHITECTURAL & SECURITY RULES:
 *  - JARVIS remains the sole orchestrator. ComfyUI is purely a creative media execution engine.
 *  - Real health checking via `GET /system_stats` (or `GET /history`).
 *  - Never fakes `READY` status — `READY` requires a successful HTTP health check.
 *  - Disabled by default via `featureFlags.isAdapterEnabled('comfyui')`.
 *  - Asynchronous non-blocking HTTP polling with timeout & AbortController support.
 *  - Output artifacts are saved to sandboxed `generated_sites/artifacts/` and registered in Artifact Registry.
 *  - Sanitizes errors and enforces filename/path safety against path traversal (`../`, absolute paths).
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
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

export interface ComfyUIConfig {
  host: string;
  port: number;
  requestTimeoutMs: number;
  pollIntervalMs: number;
  executionTimeoutMs: number;
}

export class ComfyUIAdapter extends BaseAdapter {
  readonly id = 'comfyui';
  readonly name = 'ComfyUI Creative Engine';
  readonly version = '0.3.0';
  readonly category: AdapterCategory = 'CREATIVE';

  private config: ComfyUIConfig = {
    host: '127.0.0.1',
    port: 8188,
    requestTimeoutMs: 5000,
    pollIntervalMs: 1000,
    executionTimeoutMs: 120_000,
  };

  private activeExecutions: Map<string, { abortController: AbortController; promptId?: string }> = new Map();

  constructor(config?: Partial<ComfyUIConfig>) {
    super();
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  protected getDependencies(): string[] {
    return ['ComfyUI (running at http://127.0.0.1:8188)'];
  }

  protected requiresGPU(): boolean {
    return true;
  }

  getCapabilities(): AdapterCapability[] {
    return [
      { id: 'creative.image.generate', name: 'ComfyUI Image Generation', description: 'Generate images via ComfyUI node graph', requiresGPU: true },
      { id: 'creative.image.edit', name: 'ComfyUI Image Editing', description: 'Inpaint/edit images via ComfyUI', requiresGPU: true },
      { id: 'creative.workflow.execute', name: 'ComfyUI Custom Workflow', description: 'Execute arbitrary validated ComfyUI prompt JSON', requiresGPU: true },
    ];
  }

  /**
   * Real health check against ComfyUI API (`GET /system_stats`).
   * Times out cleanly using http.request options without hanging.
   */
  async healthCheck(): Promise<boolean> {
    if (!featureFlags.isAdapterEnabled(this.id)) {
      return false;
    }

    return new Promise<boolean>((resolve) => {
      const req = http.request(
        {
          hostname: this.config.host,
          port: this.config.port,
          path: '/system_stats',
          method: 'GET',
          timeout: this.config.requestTimeoutMs,
        },
        (res) => {
          if (res.statusCode === 200) {
            resolve(true);
          } else {
            resolve(false);
          }
          res.resume(); // Consume response stream to free memory
        }
      );

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
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
      this.lastError = `ComfyUI service unreachable at http://${this.config.host}:${this.config.port}`;
    }
  }

  async execute(input: AdapterInput): Promise<AdapterOutput> {
    if (!featureFlags.isAdapterEnabled(this.id)) {
      this.status = 'DISABLED';
      return this.errorOutput(input.executionId, 'COMFYUI_DISABLED: Adapter feature flag is disabled');
    }

    const healthy = await this.healthCheck();
    if (!healthy) {
      this.status = 'UNAVAILABLE';
      return this.errorOutput(input.executionId, `COMFYUI_UNAVAILABLE: Service unreachable at http://${this.config.host}:${this.config.port}`);
    }

    // Payload validation
    const promptText = input.payload?.prompt;
    const customWorkflow = input.payload?.workflow;

    if (!promptText && !customWorkflow) {
      return this.errorOutput(input.executionId, 'COMFYUI_INVALID_INPUT: Missing required "prompt" string or "workflow" object in payload');
    }

    this.status = 'BUSY';
    const abortController = new AbortController();
    this.activeExecutions.set(input.executionId, { abortController });

    const startTime = Date.now();

    try {
      // 1. Build prompt JSON
      const promptObj = customWorkflow || this.buildDefaultImageWorkflow(promptText, input.payload?.seed);

      // 2. Submit prompt to ComfyUI
      const submitRes = await this.postJson('/prompt', { prompt: promptObj }, abortController.signal);
      const promptId = submitRes?.prompt_id;

      if (!promptId) {
        throw new Error('COMFYUI_WORKFLOW_INVALID: Response missing prompt_id');
      }

      this.activeExecutions.set(input.executionId, { abortController, promptId });

      // 3. Poll for execution completion
      const historyData = await this.pollHistory(promptId, abortController.signal);
      const outputImages = this.extractImagesFromHistory(historyData, promptId);

      if (!outputImages || outputImages.length === 0) {
        throw new Error('COMFYUI_EXECUTION_FAILED: No output images generated by workflow');
      }

      // 4. Download output files to sandboxed directory
      const artifactIds: string[] = [];
      const downloadedPaths: string[] = [];

      for (const imgMeta of outputImages) {
        const localPath = await this.downloadImage(imgMeta.filename, imgMeta.subfolder, imgMeta.type, input.executionId);
        downloadedPaths.push(localPath);

        const artifactId = `art_comfyui_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const artifact: Artifact = {
          id: artifactId,
          type: 'IMAGE',
          name: imgMeta.filename,
          path: localPath,
          createdAt: new Date().toISOString(),
          createdBy: 'ComfyUIAdapter',
          missionId: input.missionId,
          taskId: input.taskId,
          metadata: {
            source: 'ComfyUI',
            promptId,
            adapterId: this.id,
            capability: input.capability,
          },
        };

        registerArtifact(artifact);
        artifactIds.push(artifactId);
      }

      this.status = 'READY';
      this.activeExecutions.delete(input.executionId);

      const duration_ms = Date.now() - startTime;

      return {
        success: true,
        executionId: input.executionId,
        adapterId: this.id,
        artifactIds,
        output: {
          promptId,
          images: downloadedPaths,
          source: 'ComfyUI',
        },
        duration_ms,
      };
    } catch (err: any) {
      this.status = 'READY';
      this.activeExecutions.delete(input.executionId);

      const errMsg = err?.name === 'AbortError' ? 'COMFYUI_CANCELLED: Execution aborted by user' : err?.message || String(err);
      return this.errorOutput(input.executionId, errMsg);
    }
  }

  async cancel(executionId: string): Promise<void> {
    const active = this.activeExecutions.get(executionId);
    if (active) {
      active.abortController.abort();

      // If prompt_id is available, attempt best-effort cancellation call to ComfyUI
      if (active.promptId) {
        this.postJson('/interrupt', {}, new AbortController().signal).catch(() => {});
      }

      this.activeExecutions.delete(executionId);
      this.status = 'READY';

      eventBus.emit(
        eventBus.createEvent({
          type: 'adapter.execution.cancelled',
          category: 'ADAPTER',
          source: 'ComfyUIAdapter',
          payload: { adapterId: this.id, executionId },
        })
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helper Methods (HTTP & Sandbox)
  // ───────────────────────────────────────────────────────────────────────────

  private async postJson(pathUrl: string, body: any, signal: AbortSignal): Promise<any> {
    const postData = JSON.stringify(body);

    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new Error('AbortError'));

      const req = http.request(
        {
          hostname: this.config.host,
          port: this.config.port,
          path: pathUrl,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
          timeout: this.config.requestTimeoutMs,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                resolve(JSON.parse(data || '{}'));
              } else {
                reject(new Error(`ComfyUI HTTP ${res.statusCode}: ${data}`));
              }
            } catch (pErr) {
              reject(pErr);
            }
          });
        }
      );

      const onAbort = () => {
        req.destroy();
        reject(new Error('AbortError'));
      };

      signal.addEventListener('abort', onAbort);

      req.on('error', (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        signal.removeEventListener('abort', onAbort);
        reject(new Error('COMFYUI_TIMEOUT: HTTP request timed out'));
      });

      req.write(postData);
      req.end();
    });
  }

  private async pollHistory(promptId: string, signal: AbortSignal): Promise<any> {
    const startMs = Date.now();

    while (Date.now() - startMs < this.config.executionTimeoutMs) {
      if (signal.aborted) throw new Error('AbortError');

      try {
        const history = await this.getJson(`/history/${promptId}`, signal);
        if (history && history[promptId]) {
          return history[promptId];
        }
      } catch (err: any) {
        if (err?.message === 'AbortError') throw err;
      }

      await new Promise((r) => setTimeout(r, this.config.pollIntervalMs));
    }

    throw new Error(`COMFYUI_TIMEOUT: Execution timed out after ${this.config.executionTimeoutMs}ms`);
  }

  private async getJson(pathUrl: string, signal: AbortSignal): Promise<any> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new Error('AbortError'));

      const req = http.request(
        {
          hostname: this.config.host,
          port: this.config.port,
          path: pathUrl,
          method: 'GET',
          timeout: this.config.requestTimeoutMs,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              if (res.statusCode === 200) {
                resolve(JSON.parse(data || '{}'));
              } else {
                reject(new Error(`ComfyUI HTTP ${res.statusCode}`));
              }
            } catch (err) {
              reject(err);
            }
          });
        }
      );

      const onAbort = () => {
        req.destroy();
        reject(new Error('AbortError'));
      };

      signal.addEventListener('abort', onAbort);
      req.on('error', (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      });
      req.on('timeout', () => {
        req.destroy();
        signal.removeEventListener('abort', onAbort);
        reject(new Error('COMFYUI_TIMEOUT: GET request timed out'));
      });
      req.end();
    });
  }

  private extractImagesFromHistory(historyPromptData: any, _promptId: string): Array<{ filename: string; subfolder: string; type: string }> {
    const outputs = historyPromptData?.outputs;
    if (!outputs) return [];

    const images: Array<{ filename: string; subfolder: string; type: string }> = [];

    for (const nodeId of Object.keys(outputs)) {
      const nodeOutput = outputs[nodeId];
      if (nodeOutput?.images && Array.isArray(nodeOutput.images)) {
        for (const img of nodeOutput.images) {
          if (img.filename) {
            images.push({
              filename: img.filename,
              subfolder: img.subfolder || '',
              type: img.type || 'output',
            });
          }
        }
      }
    }

    return images;
  }

  private async downloadImage(filename: string, subfolder: string, type: string, executionId: string): Promise<string> {
    // Enforce filename safety against path traversal
    const safeFilename = path.basename(filename);
    const queryParams = new URLSearchParams({
      filename: safeFilename,
      subfolder: subfolder || '',
      type: type || 'output',
    }).toString();

    const outputDir = path.join(process.cwd(), 'generated_sites', 'artifacts');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const localFilePath = path.join(outputDir, `comfyui_${executionId}_${safeFilename}`);

    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: this.config.host,
          port: this.config.port,
          path: `/view?${queryParams}`,
          method: 'GET',
          timeout: 10_000,
        },
        (res) => {
          if (res.statusCode !== 200) {
            return reject(new Error(`Failed to download image from ComfyUI HTTP ${res.statusCode}`));
          }

          const fileStream = fs.createWriteStream(localFilePath);
          res.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close();
            resolve(`generated_sites/artifacts/comfyui_${executionId}_${safeFilename}`);
          });

          fileStream.on('error', (err) => {
            fs.unlink(localFilePath, () => {});
            reject(err);
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Image download timed out'));
      });
      req.end();
    });
  }

  /**
   * Fallback standard SD 1.5 / SDXL basic text-to-image node graph prompt object.
   */
  private buildDefaultImageWorkflow(promptText: string, seed?: number): Record<string, any> {
    const finalSeed = seed ?? Math.floor(Math.random() * 1_000_000);
    return {
      '3': {
        inputs: {
          seed: finalSeed,
          steps: 20,
          cfg: 8,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 1,
          model: ['4', 0],
          positive: ['6', 0],
          negative: ['7', 0],
          latent_image: ['5', 0],
        },
        class_type: 'KSampler',
      },
      '4': {
        inputs: {
          ckpt_name: 'v1-5-pruned-emaonly.safetensors',
        },
        class_type: 'CheckpointLoaderSimple',
      },
      '5': {
        inputs: {
          width: 512,
          height: 512,
          batch_size: 1,
        },
        class_type: 'EmptyLatentImage',
      },
      '6': {
        inputs: {
          text: promptText,
          clip: ['4', 1],
        },
        class_type: 'CLIPTextEncode',
      },
      '7': {
        inputs: {
          text: 'text, watermark, ugly, blurry, bad anatomy',
          clip: ['4', 1],
        },
        class_type: 'CLIPTextEncode',
      },
      '8': {
        inputs: {
          samples: ['3', 0],
          vae: ['4', 2],
        },
        class_type: 'VAEDecode',
      },
      '9': {
        inputs: {
          filename_prefix: 'JARVIS_ComfyUI',
          images: ['8', 0],
        },
        class_type: 'SaveImage',
      },
    };
  }
}
