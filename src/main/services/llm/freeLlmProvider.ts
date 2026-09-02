/**
 * freeLlmProvider.ts — Integration of Free LLM APIs Catalog
 *
 * Source: https://github.com/open-free-llm-api/awesome-freellm-apis
 * Integrates free tier & open access model endpoints into JARVIS modelGateway.
 */

export interface FreeLlmEndpoint {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  defaultModel: string;
  requiresKey: boolean;
  notes: string;
}

export const FREE_LLM_ENDPOINTS: FreeLlmEndpoint[] = [
  {
    id: 'groq-free',
    name: 'Groq Cloud Free Tier',
    provider: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    requiresKey: true,
    notes: 'Ultra-fast Llama 3.3 70B & DeepSeek R1 reasoning models with free tier rate limits.',
  },
  {
    id: 'huggingface-inference',
    name: 'HuggingFace Serverless Inference',
    provider: 'HuggingFace',
    baseUrl: 'https://api-inference.huggingface.co/v1',
    defaultModel: 'Qwen/Qwen2.5-Coder-32B-Instruct',
    requiresKey: true,
    notes: 'Free serverless API access to thousands of open-source models.',
  },
  {
    id: 'together-free',
    name: 'Together AI Free Credits',
    provider: 'Together',
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    requiresKey: true,
    notes: 'Fast inference for Llama, Mistral, and Qwen models.',
  },
  {
    id: 'duckduckgo-ai',
    name: 'DuckDuckGo AI Chat Proxy',
    provider: 'DuckDuckGo',
    baseUrl: 'http://localhost:20128/v1', // Routed via OmniRoute
    defaultModel: 'gpt-4o-mini',
    requiresKey: false,
    notes: 'Free anonymous web AI access bridged via OmniRoute gateway.',
  },
  {
    id: 'cohere-free',
    name: 'Cohere Command R+ Free Tier',
    provider: 'Cohere',
    baseUrl: 'https://api.cohere.com/v2',
    defaultModel: 'command-r-plus',
    requiresKey: true,
    notes: 'RAG and multilingual specialized model endpoints.',
  },
  {
    id: 'ollama-local',
    name: 'Ollama Local Host Engine',
    provider: 'Ollama Local',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3:latest',
    requiresKey: false,
    notes: '100% offline local inference via local GPU/CPU.',
  },
];

export class FreeLlmManager {
  public listEndpoints(): FreeLlmEndpoint[] {
    return FREE_LLM_ENDPOINTS;
  }

  public getEndpoint(id: string): FreeLlmEndpoint | undefined {
    return FREE_LLM_ENDPOINTS.find((e) => e.id === id);
  }
}

export const freeLlmManager = new FreeLlmManager();
