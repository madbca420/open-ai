/**
 * smartModelRouter.ts — Autonomous Model Selection, API Key Pooling & Task Decomposition Engine
 *
 * Capabilities:
 *  - Discovers all stored API keys (KeyVault & process.env)
 *  - Categorizes task intent (REASONING_ARCH | CODE_GEN | FAST_CHAT | CREATIVE_MEDIA)
 *  - Automatically selects the optimal provider & model without requiring manual user selection
 *  - Manages provider key pooling and multi-tier failover (Google -> OpenAI -> Anthropic -> Groq -> Local/OmniRoute)
 *  - Divides complex multi-domain user requests into specialized agent subtasks
 */

import { getApiKey } from './keyVault';
import { logAudit } from './auditLog';

export type TaskCategory = 'REASONING_ARCH' | 'CODE_GEN' | 'FAST_CHAT' | 'CREATIVE_MEDIA';

export interface ModelProviderInfo {
  provider: 'google' | 'openai' | 'anthropic' | 'groq' | 'together' | 'huggingface' | 'omniroute' | 'ollama';
  hasKey: boolean;
  priority: number;
  models: string[];
}

export interface AutoRouteResult {
  provider: string;
  modelName: string;
  category: TaskCategory;
  failoverChain: Array<{ provider: string; modelName: string }>;
  subtasks?: Array<{ id: string; role: string; category: TaskCategory; provider: string; modelName: string }>;
}

export class SmartModelRouter {
  /**
   * Scans KeyVault and process.env to discover all active API keys and available provider tiers.
   */
  public discoverActiveProviders(): ModelProviderInfo[] {
    const providers: ModelProviderInfo[] = [];

    // 1. Google Gemini
    const googleKey = getApiKey('google') || process.env.GEMINI_API_KEY;
    providers.push({
      provider: 'google',
      hasKey: !!googleKey,
      priority: 1,
      models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash-exp'],
    });

    // 2. OpenAI
    const openAiKey = getApiKey('openai') || process.env.OPENAI_API_KEY;
    providers.push({
      provider: 'openai',
      hasKey: !!openAiKey,
      priority: 2,
      models: ['gpt-4o', 'gpt-4o-mini', 'o1-preview'],
    });

    // 3. Anthropic Claude
    const anthropicKey = getApiKey('anthropic') || process.env.ANTHROPIC_API_KEY;
    providers.push({
      provider: 'anthropic',
      hasKey: !!anthropicKey,
      priority: 3,
      models: ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'],
    });

    // 4. Groq Free Tier
    const groqKey = getApiKey('groq') || process.env.GROQ_API_KEY;
    providers.push({
      provider: 'groq',
      hasKey: !!groqKey,
      priority: 4,
      models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
    });

    // 5. Together AI
    const togetherKey = getApiKey('together') || process.env.TOGETHER_API_KEY;
    providers.push({
      provider: 'together',
      hasKey: !!togetherKey,
      priority: 5,
      models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-Coder-32B-Instruct'],
    });

    // 6. Local / OmniRoute (Always available fallback)
    providers.push({
      provider: 'omniroute',
      hasKey: true,
      priority: 99,
      models: ['auto', 'llama3:latest', 'qwen2.5-coder'],
    });

    return providers;
  }

  /**
   * Classifies a task prompt into a TaskCategory.
   */
  public classifyTask(prompt: string): TaskCategory {
    const lower = prompt.toLowerCase();

    if (/image|draw|paint|picture|video|capcut|audio|tts|voice|3d|avatar|kimodo/i.test(lower)) {
      return 'CREATIVE_MEDIA';
    }
    if (/build|create site|react|express|code|typescript|javascript|bug|fix|function|backend|frontend|schema|api/i.test(lower)) {
      return 'CODE_GEN';
    }
    if (/architect|design|plan|system|reason|analyze|strategy|structure|trade|financial|security audit/i.test(lower)) {
      return 'REASONING_ARCH';
    }
    return 'FAST_CHAT';
  }

  /**
   * Automatically routes a prompt to the optimal provider & model, constructing a multi-tier failover chain.
   */
  public routePrompt(prompt: string): AutoRouteResult {
    const category = this.classifyTask(prompt);
    const available = this.discoverActiveProviders().filter((p) => p.hasKey);

    const failoverChain: Array<{ provider: string; modelName: string }> = [];

    // Build preference order based on task category
    if (category === 'REASONING_ARCH') {
      if (available.some((p) => p.provider === 'google')) failoverChain.push({ provider: 'google', modelName: 'gemini-1.5-pro' });
      if (available.some((p) => p.provider === 'openai')) failoverChain.push({ provider: 'openai', modelName: 'gpt-4o' });
      if (available.some((p) => p.provider === 'anthropic')) failoverChain.push({ provider: 'anthropic', modelName: 'claude-3-5-sonnet-20241022' });
      if (available.some((p) => p.provider === 'groq')) failoverChain.push({ provider: 'groq', modelName: 'llama-3.3-70b-versatile' });
    } else if (category === 'CODE_GEN') {
      if (available.some((p) => p.provider === 'google')) failoverChain.push({ provider: 'google', modelName: 'gemini-1.5-flash' });
      if (available.some((p) => p.provider === 'openai')) failoverChain.push({ provider: 'openai', modelName: 'gpt-4o' });
      if (available.some((p) => p.provider === 'anthropic')) failoverChain.push({ provider: 'anthropic', modelName: 'claude-3-5-sonnet-20241022' });
      if (available.some((p) => p.provider === 'together')) failoverChain.push({ provider: 'together', modelName: 'Qwen/Qwen2.5-Coder-32B-Instruct' });
    } else {
      if (available.some((p) => p.provider === 'google')) failoverChain.push({ provider: 'google', modelName: 'gemini-1.5-flash' });
      if (available.some((p) => p.provider === 'openai')) failoverChain.push({ provider: 'openai', modelName: 'gpt-4o-mini' });
      if (available.some((p) => p.provider === 'groq')) failoverChain.push({ provider: 'groq', modelName: 'llama-3.3-70b-versatile' });
    }

    // Always add OmniRoute local fallback
    failoverChain.push({ provider: 'omniroute', modelName: 'auto' });

    const primary = failoverChain[0];

    // Decompose complex fullstack tasks into subtasks
    const subtasks = this.decomposeTask(prompt);

    logAudit('SMART_MODEL_ROUTE', `Auto-selected ${primary.provider}/${primary.modelName} for ${category}`, 'SUCCESS');

    return {
      provider: primary.provider,
      modelName: primary.modelName,
      category,
      failoverChain,
      subtasks,
    };
  }

  /**
   * Divides complex prompts into specialized subtasks for agent roles.
   */
  public decomposeTask(prompt: string): Array<{ id: string; role: string; category: TaskCategory; provider: string; modelName: string }> {
    const isFullStack = /fullstack|frontend|backend|database|auth|site|web app/i.test(prompt);
    if (!isFullStack) return [];

    const available = this.discoverActiveProviders().filter((p) => p.hasKey);
    const defaultProvider = available[0]?.provider || 'google';
    const defaultModel = available[0]?.models[0] || 'gemini-1.5-flash';

    return [
      {
        id: 'subtask-arch',
        role: 'ARCHITECT',
        category: 'REASONING_ARCH',
        provider: available.find((p) => p.provider === 'google')?.provider || defaultProvider,
        modelName: available.find((p) => p.provider === 'google') ? 'gemini-1.5-pro' : defaultModel,
      },
      {
        id: 'subtask-frontend',
        role: 'DEVELOPER_FRONTEND',
        category: 'CODE_GEN',
        provider: defaultProvider,
        modelName: defaultModel,
      },
      {
        id: 'subtask-backend',
        role: 'DEVELOPER_BACKEND',
        category: 'CODE_GEN',
        provider: defaultProvider,
        modelName: defaultModel,
      },
      {
        id: 'subtask-qa',
        role: 'REVIEWER_QA',
        category: 'REASONING_ARCH',
        provider: defaultProvider,
        modelName: defaultModel,
      },
    ];
  }
}

export const smartModelRouter = new SmartModelRouter();
