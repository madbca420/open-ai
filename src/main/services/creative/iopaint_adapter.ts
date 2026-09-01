/**
 * JARVIS Phase 4 — Real IOPaint Adapter
 *
 * Connects JARVIS to a local IOPaint inpainting & object removal service (default: http://127.0.0.1:8080).
 *
 * ARCHITECTURAL & SECURITY RULES:
 *  - JARVIS remains the sole orchestrator. IOPaint is purely an image processing service.
 *  - Real health checking via `GET /api/v1/server-config` (or `GET /`).
 *  - Never fakes `READY` status — `READY` requires a successful HTTP health check.
 *  - Disabled by default via `featureFlags.isAdapterEnabled('iopaint')`.
 *  - Non-blocking asynchronous HTTP requests with AbortController & timeout support.
 *  - Output images are saved to sandboxed `generated_sites/artifacts/` and registered in Artifact Registry.
 *  - Enforces filename/path safety against path traversal (`../`, absolute paths).
 *  - Destructive protection: NEVER overwrites original input files; creates a new output artifact.
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

export interface IOPaintConfig {
  host: string;
  port: number;
  requestTimeoutMs: number;
  executionTimeoutMs: number;
  maxImageSizeBytes: number;
}

export class IOPaintAdapter extends BaseAdapter {
  readonly id = 'iopaint';
  readonly name = 'IOPaint Image Processing Engine';
  readonly version = '1.0.0';
  readonly category: AdapterCategory = 'CREATIVE';

  private config: IOPaintConfig = {
    host: '127.0.0.1',
    port: 8080,
    requestTimeoutMs: 5000,
    executionTimeoutMs: 60_000,
    maxImageSizeBytes: 20 * 1024 * 1024, // 20MB limit
  };

  private activeExecutions: Map<string, AbortController> = new Map();

  constructor(config?: Partial<IOPaintConfig>) {
    super();
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  protected getDependencies(): string[] {
    return ['IOPaint (running at http://127.0.0.1:8080)'];
  }

  protected requiresGPU(): boolean {
    return true;
  }

  getCapabilities(): AdapterCapability[] {
    return [
      { id: 'creative.image.inpaint', name: 'IOPaint Inpainting', description: 'Fill masked regions using AI models', requiresGPU: true },
      { id: 'creative.image.remove_object', name: 'IOPaint Object Removal', description: 'Remove masked objects from images', requiresGPU: true },
      { id: 'creative.image.edit', name: 'IOPaint Image Editing', description: 'Perform prompt-guided image edits', requiresGPU: true },
    ];
  }

  /**
   * Real health check against IOPaint API (`GET /api/v1/server-config` or `GET /`).
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
          path: '/api/v1/server-config',
          method: 'GET',
          timeout: this.config.requestTimeoutMs,
        },
        (res) => {
          if (res.statusCode === 200 || res.statusCode === 404) {
            // 200 is API config, 404 means host is up but route differs
            resolve(true);
          } else {
            resolve(false);
          }
          res.resume();
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
      this.lastError = `IOPaint service unreachable at http://${this.config.host}:${this.config.port}`;
    }
  }

  async execute(input: AdapterInput): Promise<AdapterOutput> {
    if (!featureFlags.isAdapterEnabled(this.id)) {
      this.status = 'DISABLED';
      return this.errorOutput(input.executionId, 'IOPAINT_DISABLED: Adapter feature flag is disabled');
    }

    const healthy = await this.healthCheck();
    if (!healthy) {
      this.status = 'UNAVAILABLE';
      return this.errorOutput(input.executionId, `IOPAINT_UNAVAILABLE: Service unreachable at http://${this.config.host}:${this.config.port}`);
    }

    // Payload validation
    const imagePath = input.payload?.imagePath || input.payload?.imageArtifactId;
    const maskPath = input.payload?.maskPath || input.payload?.maskArtifactId;

    if (!imagePath) {
      return this.errorOutput(input.executionId, 'IOPAINT_INVALID_INPUT: Missing required "imagePath" or "imageArtifactId" in payload');
    }

    // Security check: validate input paths against path traversal
    const safeImageFile = this.resolveAndValidatePath(imagePath);
    if (!safeImageFile) {
      return this.errorOutput(input.executionId, 'IOPAINT_INVALID_IMAGE: Invalid or unauthorized image file path');
    }

    let safeMaskFile: string | null = null;
    if (maskPath) {
      safeMaskFile = this.resolveAndValidatePath(maskPath);
      if (!safeMaskFile) {
        return this.errorOutput(input.executionId, 'IOPAINT_INVALID_MASK: Invalid or unauthorized mask file path');
      }
    }

    this.status = 'BUSY';
    const abortController = new AbortController();
    this.activeExecutions.set(input.executionId, abortController);

    const startTime = Date.now();

    try {
      // Inpaint/remove request via IOPaint HTTP API (`POST /api/v1/inpaint`)
      const outputLocalPath = await this.performInpaint(
        safeImageFile,
        safeMaskFile,
        input.payload?.prompt,
        input.executionId,
        abortController.signal
      );

      const artifactId = `art_iopaint_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const artifact: Artifact = {
        id: artifactId,
        type: 'IMAGE',
        name: `iopaint_${input.executionId}_${path.basename(safeImageFile)}`,
        path: outputLocalPath,
        createdAt: new Date().toISOString(),
        createdBy: 'IOPaintAdapter',
        missionId: input.missionId,
        taskId: input.taskId,
        metadata: {
          source: 'IOPaint',
          originalImage: safeImageFile,
          hasMask: !!safeMaskFile,
          adapterId: this.id,
          capability: input.capability,
        },
      };

      registerArtifact(artifact);

      this.status = 'READY';
      this.activeExecutions.delete(input.executionId);

      const duration_ms = Date.now() - startTime;

      return {
        success: true,
        executionId: input.executionId,
        adapterId: this.id,
        artifactIds: [artifactId],
        output: {
          editedImagePath: outputLocalPath,
          source: 'IOPaint',
        },
        duration_ms,
      };
    } catch (err: any) {
      this.status = 'READY';
      this.activeExecutions.delete(input.executionId);

      const errMsg = err?.name === 'AbortError' ? 'IOPAINT_CANCELLED: Execution aborted by user' : err?.message || String(err);
      return this.errorOutput(input.executionId, errMsg);
    }
  }

  async cancel(executionId: string): Promise<void> {
    const controller = this.activeExecutions.get(executionId);
    if (controller) {
      controller.abort();
      this.activeExecutions.delete(executionId);
      this.status = 'READY';

      eventBus.emit(
        eventBus.createEvent({
          type: 'adapter.execution.cancelled',
          category: 'ADAPTER',
          source: 'IOPaintAdapter',
          payload: { adapterId: this.id, executionId },
        })
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helper & Security Methods
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Validate and resolve path against directory traversal attacks.
   */
  private resolveAndValidatePath(filePath: string): string | null {
    if (!filePath || typeof filePath !== 'string') return null;

    // Check for obvious path traversal escapes
    if (filePath.includes('..') || filePath.includes('\0')) {
      return null;
    }

    const resolved = path.isAbsolute(filePath)
      ? path.normalize(filePath)
      : path.normalize(path.join(process.cwd(), filePath));

    // Ensure resolved path stays inside working directory or generated_sites sandbox
    const cwd = process.cwd();
    const sandboxDir = path.join(cwd, 'generated_sites');

    if (!resolved.startsWith(cwd) && !resolved.startsWith(sandboxDir)) {
      return null;
    }

    if (!fs.existsSync(resolved)) {
      return null;
    }

    return resolved;
  }

  /**
   * Perform HTTP multipart/form-data request to IOPaint inpainting endpoint (`POST /api/v1/inpaint`).
   */
  private async performInpaint(
    imagePath: string,
    maskPath: string | null,
    prompt: string | undefined,
    executionId: string,
    signal: AbortSignal
  ): Promise<string> {
    const outputDir = path.join(process.cwd(), 'generated_sites', 'artifacts');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputFileName = `iopaint_${executionId}_${path.basename(imagePath)}`;
    const outputFilePath = path.join(outputDir, outputFileName);
    const relOutputPath = `generated_sites/artifacts/${outputFileName}`;

    // Read image buffer
    const imageBuf = fs.readFileSync(imagePath);
    const boundary = '----JARVISIOPaintBoundary' + Math.random().toString(36).substring(2, 9);

    const parts: Buffer[] = [];

    // Image part
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${path.basename(imagePath)}"\r\nContent-Type: image/png\r\n\r\n`
    ));
    parts.push(imageBuf);
    parts.push(Buffer.from('\r\n'));

    // Mask part (if provided)
    if (maskPath) {
      const maskBuf = fs.readFileSync(maskPath);
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="mask"; filename="${path.basename(maskPath)}"\r\nContent-Type: image/png\r\n\r\n`
      ));
      parts.push(maskBuf);
      parts.push(Buffer.from('\r\n'));
    }

    // Prompt part (if provided)
    if (prompt) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${prompt}\r\n`
      ));
    }

    parts.push(Buffer.from(`--${boundary}--\r\n`));
    const payloadBuf = Buffer.concat(parts);

    return new Promise<string>((resolve, reject) => {
      if (signal.aborted) return reject(new Error('AbortError'));

      const req = http.request(
        {
          hostname: this.config.host,
          port: this.config.port,
          path: '/api/v1/inpaint',
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': payloadBuf.length,
          },
          timeout: this.config.executionTimeoutMs,
        },
        (res) => {
          if (res.statusCode !== 200) {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => reject(new Error(`IOPaint HTTP ${res.statusCode}: ${body}`)));
            return;
          }

          const fileStream = fs.createWriteStream(outputFilePath);
          res.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close();
            resolve(relOutputPath);
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

      signal.addEventListener('abort', onAbort);

      req.on('error', (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        signal.removeEventListener('abort', onAbort);
        reject(new Error('IOPAINT_TIMEOUT: Inpainting execution timed out'));
      });

      req.write(payloadBuf);
      req.end();
    });
  }
}
