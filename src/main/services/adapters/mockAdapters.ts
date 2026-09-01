/**
 * JARVIS Phase 4 — Deterministic Mock Adapters
 *
 * Provides safe, local test adapters for system-wide pipeline testing without:
 *  - Python / GPU requirements
 *  - External network calls or multi-GB model downloads
 *  - Broker credentials or real money
 *  - Microphone / audio device access
 *
 * Implements canonical `JarvisAdapter` interface via `BaseAdapter`.
 * Registers artifacts in Artifact Registry with `sourceType: "MOCK"`.
 */

import { BaseAdapter } from './adapterTypes';
import {
  AdapterCapability,
  AdapterCategory,
  AdapterInput,
  AdapterOutput,
  AdapterStatus,
  Artifact,
} from '../../types/schema';
import { adapterRegistry } from './adapterRegistry';
import { registerArtifact } from '../../taskExecutor';
import { eventBus } from '../../eventBus';

// ─────────────────────────────────────────────────────────────────────────────
// 1. MockCreativeAdapter
// ─────────────────────────────────────────────────────────────────────────────

export class MockCreativeAdapter extends BaseAdapter {
  readonly id = 'mock-creative';
  readonly name = 'Mock Creative Visual AI Adapter';
  readonly version = '1.0.0-mock';
  readonly category: AdapterCategory = 'CREATIVE';

  private activeTimeouts: Map<string, NodeJS.Timeout> = new Map();

  getCapabilities(): AdapterCapability[] {
    return [
      { id: 'creative.image.generate', name: 'Mock Image Generation', description: 'Simulate visual image generation' },
      { id: 'creative.image.edit', name: 'Mock Image Editing', description: 'Simulate inpainting/editing' },
      { id: 'creative.video.generate', name: 'Mock Video Generation', description: 'Simulate video rendering' },
    ];
  }

  async healthCheck(): Promise<boolean> {
    return true; // Mock adapters are always healthy
  }

  async initialize(): Promise<void> {
    this.status = 'READY';
    this.enabled = true;
  }

  async execute(input: AdapterInput): Promise<AdapterOutput> {
    if (input.payload?.testMode === 'FAIL') {
      this.status = 'ERROR';
      this.lastError = 'Forced deterministic mock failure (testMode: FAIL)';
      setTimeout(() => {
        this.status = 'READY';
      }, 500);
      return this.errorOutput(input.executionId, 'Forced deterministic mock failure (testMode: FAIL)');
    }

    this.status = 'BUSY';
    const duration_ms = input.payload?.durationMs ?? 1200;

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.activeTimeouts.delete(input.executionId);
          resolve();
        }, duration_ms);

        this.activeTimeouts.set(input.executionId, timer);
      });

      // Register mock artifact in SQLite Artifact Registry
      const artifactId = `art_mock_creative_${Date.now()}`;
      const mockArtifact: Artifact = {
        id: artifactId,
        type: input.capability === 'creative.video.generate' ? 'VIDEO' : 'IMAGE',
        name: `mock-generated-creative-${input.executionId}.png`,
        path: `generated_sites/artifacts/mock-creative-${input.executionId}.png`,
        createdAt: new Date().toISOString(),
        createdBy: 'MockCreativeAdapter',
        missionId: input.missionId,
        taskId: input.taskId,
        metadata: {
          sourceType: 'MOCK',
          capability: input.capability,
          simulatedDurationMs: duration_ms,
        },
      };

      registerArtifact(mockArtifact);

      this.status = 'READY';

      return {
        success: true,
        executionId: input.executionId,
        adapterId: this.id,
        artifactIds: [artifactId],
        output: {
          message: 'Mock creative media task completed',
          artifactName: mockArtifact.name,
          previewUrl: mockArtifact.path,
          sourceType: 'MOCK',
        },
        duration_ms,
      };
    } catch (err: any) {
      this.status = 'READY';
      return this.errorOutput(input.executionId, err?.message || 'Mock creative task aborted');
    }
  }

  async cancel(executionId: string): Promise<void> {
    const timer = this.activeTimeouts.get(executionId);
    if (timer) {
      clearTimeout(timer);
      this.activeTimeouts.delete(executionId);
      this.status = 'READY';

      eventBus.emit(
        eventBus.createEvent({
          type: 'adapter.execution.cancelled',
          category: 'ADAPTER',
          source: 'MockCreativeAdapter',
          payload: { adapterId: this.id, executionId },
        })
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. MockVoiceAdapter
// ─────────────────────────────────────────────────────────────────────────────

export class MockVoiceAdapter extends BaseAdapter {
  readonly id = 'mock-voice';
  readonly name = 'Mock Voice Synthesis & STT Adapter';
  readonly version = '1.0.0-mock';
  readonly category: AdapterCategory = 'VOICE';

  private activeTimeouts: Map<string, NodeJS.Timeout> = new Map();

  getCapabilities(): AdapterCapability[] {
    return [
      { id: 'voice.tts', name: 'Mock Text-to-Speech', description: 'Simulate voice synthesis' },
      { id: 'voice.transcribe', name: 'Mock Speech-to-Text', description: 'Simulate speech transcription' },
    ];
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async initialize(): Promise<void> {
    this.status = 'READY';
    this.enabled = true;
  }

  async execute(input: AdapterInput): Promise<AdapterOutput> {
    if (input.payload?.testMode === 'FAIL') {
      this.status = 'ERROR';
      this.lastError = 'Forced deterministic mock failure (testMode: FAIL)';
      setTimeout(() => {
        this.status = 'READY';
      }, 500);
      return this.errorOutput(input.executionId, 'Forced deterministic mock failure (testMode: FAIL)');
    }

    this.status = 'BUSY';
    const duration_ms = input.payload?.durationMs ?? 800;

    try {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.activeTimeouts.delete(input.executionId);
          resolve();
        }, duration_ms);
        this.activeTimeouts.set(input.executionId, timer);
      });

      const artifactId = `art_mock_voice_${Date.now()}`;
      const mockArtifact: Artifact = {
        id: artifactId,
        type: 'VOICE',
        name: `mock-voice-audio-${input.executionId}.mp3`,
        path: `generated_sites/artifacts/mock-voice-${input.executionId}.mp3`,
        createdAt: new Date().toISOString(),
        createdBy: 'MockVoiceAdapter',
        missionId: input.missionId,
        taskId: input.taskId,
        metadata: {
          sourceType: 'MOCK',
          capability: input.capability,
          simulatedDurationMs: duration_ms,
        },
      };

      registerArtifact(mockArtifact);

      this.status = 'READY';

      return {
        success: true,
        executionId: input.executionId,
        adapterId: this.id,
        artifactIds: [artifactId],
        output: {
          text: input.payload?.text || 'Mock voice synthesis completed',
          audioUrl: mockArtifact.path,
          durationMs: 1200,
          sourceType: 'MOCK',
        },
        duration_ms,
      };
    } catch (err: any) {
      this.status = 'READY';
      return this.errorOutput(input.executionId, err?.message || 'Mock voice task aborted');
    }
  }

  async cancel(executionId: string): Promise<void> {
    const timer = this.activeTimeouts.get(executionId);
    if (timer) {
      clearTimeout(timer);
      this.activeTimeouts.delete(executionId);
      this.status = 'READY';

      eventBus.emit(
        eventBus.createEvent({
          type: 'adapter.execution.cancelled',
          category: 'ADAPTER',
          source: 'MockVoiceAdapter',
          payload: { adapterId: this.id, executionId },
        })
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. MockTradingAdapter
// ─────────────────────────────────────────────────────────────────────────────

export class MockTradingAdapter extends BaseAdapter {
  readonly id = 'mock-trading';
  readonly name = 'Mock Financial Analysis Adapter';
  readonly version = '1.0.0-mock';
  readonly category: AdapterCategory = 'TRADING';

  private activeTimeouts: Map<string, NodeJS.Timeout> = new Map();

  getCapabilities(): AdapterCapability[] {
    return [
      { id: 'trading.analyze', name: 'Mock Market Analysis', description: 'Simulate paper market reasoning' },
      { id: 'trading.backtest', name: 'Mock Strategy Backtest', description: 'Simulate paper strategy backtesting' },
    ];
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async initialize(): Promise<void> {
    this.status = 'READY';
    this.enabled = true;
  }

  async execute(input: AdapterInput): Promise<AdapterOutput> {
    if (input.payload?.testMode === 'FAIL') {
      this.status = 'ERROR';
      this.lastError = 'Forced deterministic mock failure (testMode: FAIL)';
      setTimeout(() => {
        this.status = 'READY';
      }, 500);
      return this.errorOutput(input.executionId, 'Forced deterministic mock failure (testMode: FAIL)');
    }

    this.status = 'BUSY';
    const duration_ms = input.payload?.durationMs ?? 1000;

    try {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.activeTimeouts.delete(input.executionId);
          resolve();
        }, duration_ms);
        this.activeTimeouts.set(input.executionId, timer);
      });

      const artifactId = `art_mock_trading_${Date.now()}`;
      const mockArtifact: Artifact = {
        id: artifactId,
        type: 'TRADING_ANALYSIS',
        name: `mock-trading-report-${input.executionId}.json`,
        path: `generated_sites/artifacts/mock-trading-${input.executionId}.json`,
        createdAt: new Date().toISOString(),
        createdBy: 'MockTradingAdapter',
        missionId: input.missionId,
        taskId: input.taskId,
        metadata: {
          sourceType: 'MOCK',
          capability: input.capability,
          mode: 'PAPER',
        },
      };

      registerArtifact(mockArtifact);

      this.status = 'READY';

      return {
        success: true,
        executionId: input.executionId,
        adapterId: this.id,
        artifactIds: [artifactId],
        output: {
          symbol: input.payload?.symbol || 'MOCK',
          signal: 'NEUTRAL',
          confidence: 0.75,
          mode: 'PAPER',
          riskScore: 2.5,
          executionMode: 'PAPER',
          sourceType: 'MOCK',
        },
        duration_ms,
      };
    } catch (err: any) {
      this.status = 'READY';
      return this.errorOutput(input.executionId, err?.message || 'Mock trading task aborted');
    }
  }

  async cancel(executionId: string): Promise<void> {
    const timer = this.activeTimeouts.get(executionId);
    if (timer) {
      clearTimeout(timer);
      this.activeTimeouts.delete(executionId);
      this.status = 'READY';

      eventBus.emit(
        eventBus.createEvent({
          type: 'adapter.execution.cancelled',
          category: 'ADAPTER',
          source: 'MockTradingAdapter',
          payload: { adapterId: this.id, executionId },
        })
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. MockResearchAdapter
// ─────────────────────────────────────────────────────────────────────────────

export class MockResearchAdapter extends BaseAdapter {
  readonly id = 'mock-research';
  readonly name = 'Mock Scenario Research Adapter';
  readonly version = '1.0.0-mock';
  readonly category: AdapterCategory = 'RESEARCH';

  private activeTimeouts: Map<string, NodeJS.Timeout> = new Map();

  getCapabilities(): AdapterCapability[] {
    return [
      { id: 'research.search', name: 'Mock Scenario Search', description: 'Simulate scenario discovery' },
      { id: 'research.summarize', name: 'Mock Research Synthesis', description: 'Simulate research synthesis' },
    ];
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async initialize(): Promise<void> {
    this.status = 'READY';
    this.enabled = true;
  }

  async execute(input: AdapterInput): Promise<AdapterOutput> {
    if (input.payload?.testMode === 'FAIL') {
      this.status = 'ERROR';
      this.lastError = 'Forced deterministic mock failure (testMode: FAIL)';
      setTimeout(() => {
        this.status = 'READY';
      }, 500);
      return this.errorOutput(input.executionId, 'Forced deterministic mock failure (testMode: FAIL)');
    }

    this.status = 'BUSY';
    const duration_ms = input.payload?.durationMs ?? 900;

    try {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.activeTimeouts.delete(input.executionId);
          resolve();
        }, duration_ms);
        this.activeTimeouts.set(input.executionId, timer);
      });

      const artifactId = `art_mock_research_${Date.now()}`;
      const mockArtifact: Artifact = {
        id: artifactId,
        type: 'SIMULATION',
        name: `mock-research-summary-${input.executionId}.md`,
        path: `generated_sites/artifacts/mock-research-${input.executionId}.md`,
        createdAt: new Date().toISOString(),
        createdBy: 'MockResearchAdapter',
        missionId: input.missionId,
        taskId: input.taskId,
        metadata: {
          sourceType: 'MOCK',
          capability: input.capability,
        },
      };

      registerArtifact(mockArtifact);

      this.status = 'READY';

      return {
        success: true,
        executionId: input.executionId,
        adapterId: this.id,
        artifactIds: [artifactId],
        output: {
          topic: input.payload?.topic || 'Mock Research Topic',
          summary: 'Deterministic mock research simulation output completed.',
          sourceType: 'MOCK',
        },
        duration_ms,
      };
    } catch (err: any) {
      this.status = 'READY';
      return this.errorOutput(input.executionId, err?.message || 'Mock research task aborted');
    }
  }

  async cancel(executionId: string): Promise<void> {
    const timer = this.activeTimeouts.get(executionId);
    if (timer) {
      clearTimeout(timer);
      this.activeTimeouts.delete(executionId);
      this.status = 'READY';

      eventBus.emit(
        eventBus.createEvent({
          type: 'adapter.execution.cancelled',
          category: 'ADAPTER',
          source: 'MockResearchAdapter',
          payload: { adapterId: this.id, executionId },
        })
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration Helper
// ─────────────────────────────────────────────────────────────────────────────

export function registerMockAdapters(): void {
  const mocks = [
    new MockCreativeAdapter(),
    new MockVoiceAdapter(),
    new MockTradingAdapter(),
    new MockResearchAdapter(),
  ];

  for (const mock of mocks) {
    if (!adapterRegistry.has(mock.id)) {
      mock.initialize().then(() => {
        adapterRegistry.register(mock);
      }).catch((err) => {
        console.error(`[MockAdapters] Error initializing mock adapter ${mock.id}:`, err);
      });
    }
  }
}
