/**
 * modelGateway.ts — Unified Model Gateway & Configurable Role Router
 *
 * Implements Phase 2 Architecture:
 * JARVIS → Model Gateway → Provider Registry → Model Router → Selected Model
 *
 * Supported Roles:
 * - ORCHESTRATOR
 * - ARCHITECT
 * - DEVELOPER
 * - RESEARCHER
 * - ANALYST
 * - VISION
 * - CODER
 * - REVIEWER
 * - PLANNER
 * - VOICE
 * - EMBEDDING
 * - FAST_RESPONSE
 */

import { getDatabase } from './db';
import { logAudit } from './auditLog';

export type ModelRole =
  | 'ORCHESTRATOR'
  | 'ARCHITECT'
  | 'DEVELOPER'
  | 'RESEARCHER'
  | 'ANALYST'
  | 'VISION'
  | 'CODER'
  | 'REVIEWER'
  | 'PLANNER'
  | 'VOICE'
  | 'EMBEDDING'
  | 'FAST_RESPONSE';

export interface ModelMetadata {
  id: string;
  provider: 'openai' | 'google' | 'anthropic' | 'omniroute' | 'ollama' | 'nvidia';
  displayName: string;
  capabilities: string[];
  contextWindow: number;
  vision: boolean;
  toolCalling: boolean;
  reasoning: boolean;
  streaming: boolean;
  isLocal: boolean;
  enabled: boolean;
  priority: number;
}

export class ModelGateway {
  private registry: Map<string, ModelMetadata> = new Map();
  private roleAssignments: Map<ModelRole, string> = new Map();

  constructor() {
    this.seedDefaultRegistry();
  }

  private seedDefaultRegistry() {
    const defaults: ModelMetadata[] = [
      {
        id: 'oxalpha',
        provider: 'omniroute',
        displayName: 'OxAlpha (Primary Coding)',
        capabilities: ['coding', 'reasoning', 'tools'],
        contextWindow: 128000,
        vision: false,
        toolCalling: true,
        reasoning: true,
        streaming: true,
        isLocal: false,
        enabled: true,
        priority: 1,
      },
      {
        id: 'dots3-note',
        provider: 'omniroute',
        displayName: 'Dots3-Note Preview (Analysis & Planning)',
        capabilities: ['planning', 'analysis', 'notes'],
        contextWindow: 128000,
        vision: false,
        toolCalling: true,
        reasoning: true,
        streaming: true,
        isLocal: false,
        enabled: true,
        priority: 1,
      },
      {
        id: 'nvidia/nemotron-3-ultra',
        provider: 'omniroute',
        displayName: 'NVIDIA Nemotron 3 Ultra (Code Review & Security)',
        capabilities: ['code-review', 'security', 'complex-reasoning'],
        contextWindow: 128000,
        vision: false,
        toolCalling: true,
        reasoning: true,
        streaming: true,
        isLocal: false,
        enabled: true,
        priority: 1,
      },
      {
        id: 'lfm2.5-embedding-350m',
        provider: 'omniroute',
        displayName: 'LFM2.5-Embedding-350M (Memory & RAG)',
        capabilities: ['embeddings', 'rag', 'semantic-search'],
        contextWindow: 32000,
        vision: false,
        toolCalling: false,
        reasoning: false,
        streaming: false,
        isLocal: false,
        enabled: true,
        priority: 1,
      },
      {
        id: 'gemini-1.5-flash',
        provider: 'google',
        displayName: 'Google Gemini 1.5 Flash (Fast Response)',
        capabilities: ['fast', 'multimodal', 'chat'],
        contextWindow: 1000000,
        vision: true,
        toolCalling: true,
        reasoning: false,
        streaming: true,
        isLocal: false,
        enabled: true,
        priority: 2,
      },
      {
        id: 'gpt-4o',
        provider: 'openai',
        displayName: 'OpenAI GPT-4o',
        capabilities: ['general', 'coding', 'vision', 'reasoning'],
        contextWindow: 128000,
        vision: true,
        toolCalling: true,
        reasoning: true,
        streaming: true,
        isLocal: false,
        enabled: true,
        priority: 2,
      },
    ];

    for (const model of defaults) {
      this.registry.set(model.id, model);
    }

    // Default Role Mappings
    this.roleAssignments.set('ORCHESTRATOR', 'oxalpha');
    this.roleAssignments.set('DEVELOPER', 'oxalpha');
    this.roleAssignments.set('CODER', 'oxalpha');
    this.roleAssignments.set('ARCHITECT', 'dots3-note');
    this.roleAssignments.set('PLANNER', 'dots3-note');
    this.roleAssignments.set('RESEARCHER', 'dots3-note');
    this.roleAssignments.set('ANALYST', 'dots3-note');
    this.roleAssignments.set('REVIEWER', 'nvidia/nemotron-3-ultra');
    this.roleAssignments.set('VISION', 'gemini-1.5-flash');
    this.roleAssignments.set('FAST_RESPONSE', 'gemini-1.5-flash');
    this.roleAssignments.set('EMBEDDING', 'lfm2.5-embedding-350m');
  }

  public getModelForRole(role: ModelRole): ModelMetadata {
    const modelId = this.roleAssignments.get(role) || 'oxalpha';
    const meta = this.registry.get(modelId);
    if (meta && meta.enabled) return meta;

    // Fallback search
    for (const item of this.registry.values()) {
      if (item.enabled) return item;
    }
    return this.registry.get('oxalpha')!;
  }

  public listModels(): ModelMetadata[] {
    return Array.from(this.registry.values());
  }

  public assignRoleModel(role: ModelRole, modelId: string): boolean {
    if (!this.registry.has(modelId)) return false;
    this.roleAssignments.set(role, modelId);
    logAudit('MODEL_ROLE_UPDATE', `Role ${role} mapped to ${modelId}`, 'SUCCESS');
    return true;
  }
}

export const modelGateway = new ModelGateway();
