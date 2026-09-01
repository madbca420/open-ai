import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { sanitizeErrorMessage } from './security';
import { getAnthropicToolsSchema, getOpenAIToolsSchema, getGoogleToolsSchema, executeTool } from './tools';
import { requiresConfirmation, markConfirmedInSession } from './confirmation';
import { logAudit } from './auditLog';

export type Provider = 'anthropic' | 'openai' | 'google' | 'ollama' | 'omniroute';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamChunk {
  type: 'delta' | 'done' | 'error' | 'confirmation_required';
  content?: string;
  error?: string;
  toolCall?: {
    callId: string;
    toolName: string;
    args: Record<string, any>;
    fullCommandText: string;
  };
}

export type StreamCallback = (chunk: StreamChunk) => void;
export type ConfirmationResolver = (allowed: boolean) => void;

const pendingConfirmations = new Map<string, ConfirmationResolver>();

export function resolveConfirmation(callId: string, allowed: boolean) {
  const resolver = pendingConfirmations.get(callId);
  if (resolver) {
    resolver(allowed);
    pendingConfirmations.delete(callId);
  }
}

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-3-5-sonnet-20241022',
  openai: 'gpt-4o',
  google: 'gemini-1.5-flash',
  ollama: 'llama3:latest',
  omniroute: 'auto',
};

/**
 * Executes a tool call with confirmation gating if needed.
 */
async function handleToolExecution(
  toolName: string,
  args: Record<string, any>,
  onChunk: StreamCallback
): Promise<any> {
  const callId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // Determine full command text to display in confirmation dialog
  let fullCommandText = `Tool: ${toolName}\nArguments: ${JSON.stringify(args, null, 2)}`;
  if (toolName === 'run_shell_command' && args.command) {
    fullCommandText = args.command;
  } else if (toolName === 'open_application' && args.name) {
    fullCommandText = `start "" "${args.name}"`;
  } else if (toolName === 'write_clipboard' && args.text) {
    fullCommandText = `Write to clipboard: "${args.text}"`;
  } else if (toolName === 'focus_window' && args.title) {
    fullCommandText = `Focus window matching: "${args.title}"`;
  }

  // Check if confirmation is required
  if (requiresConfirmation(toolName)) {
    logAudit('TOOL_GATE', `Requesting confirmation for tool: ${toolName}`, 'ATTEMPTED');

    onChunk({
      type: 'confirmation_required',
      toolCall: { callId, toolName, args, fullCommandText },
    });

    // Wait for user to allow or deny via UI
    const allowed = await new Promise<boolean>((resolve) => {
      pendingConfirmations.set(callId, resolve);
    });

    if (!allowed) {
      logAudit('TOOL_DENIED', `User denied execution of tool: ${toolName}`, 'DENIED');
      return { error: `User explicitly denied execution of tool "${toolName}".` };
    }

    markConfirmedInSession(toolName);
    logAudit('TOOL_CONFIRMED', `User allowed execution of tool: ${toolName}`, 'CONFIRMED');
  }

  // Execute tool
  const execResult = await executeTool(toolName, args);
  return execResult;
}

export async function streamChat(
  provider: Provider,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  systemPrompt: string,
  onChunk: StreamCallback
): Promise<void> {
  const currentIST = new Date().toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  const effectiveSystemPrompt = `${systemPrompt || 'You are JARVIS, an advanced AI assistant.'}\n[System Context: Current live time in India (IST) is ${currentIST}. Always reply with exact 12-hour IST time when queried about current time.]`;

  try {
    switch (provider) {
      case 'anthropic':
        await streamAnthropic(apiKey, model, messages, effectiveSystemPrompt, onChunk);
        break;
      case 'openai':
        await streamOpenAI(apiKey, model, messages, effectiveSystemPrompt, onChunk);
        break;
      case 'google':
        await streamGoogle(apiKey, model, messages, effectiveSystemPrompt, onChunk);
        break;
      case 'omniroute':
        await streamOmniRoute(model, messages, effectiveSystemPrompt, onChunk);
        break;
      case 'ollama':
        await streamOllama(model, messages, systemPrompt, onChunk);
        break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  } catch (err) {
    const safeMsg = sanitizeErrorMessage(err);
    console.error(`[LLMAdapter] Stream error (${provider}): ${safeMsg}`);
    onChunk({ type: 'error', error: safeMsg });
  }
}

async function streamAnthropic(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  systemPrompt: string,
  onChunk: StreamCallback
): Promise<void> {
  const client = new Anthropic({ apiKey });
  const tools = getAnthropicToolsSchema();

  const stream = client.messages.stream({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    tools: tools as any,
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      onChunk({ type: 'delta', content: event.delta.text });
    }
  }

  const finalMsg = await stream.finalMessage();
  const toolUseBlock = finalMsg.content.find((b: any) => b.type === 'tool_use');

  if (toolUseBlock && toolUseBlock.type === 'tool_use') {
    const { name, input } = toolUseBlock;
    onChunk({ type: 'delta', content: `\n\n⚙️ Executing Tool: **${name}**...\n` });

    const toolResult = await handleToolExecution(name, input as any, onChunk);
    const resultText = toolResult.error
      ? `❌ Tool Failed: ${toolResult.error}`
      : `✅ Result:\n\`\`\`json\n${JSON.stringify(toolResult.result, null, 2)}\n\`\`\``;

    onChunk({ type: 'delta', content: `${resultText}\n` });
  }

  onChunk({ type: 'done' });
}

async function streamOpenAI(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  systemPrompt: string,
  onChunk: StreamCallback
): Promise<void> {
  const client = new OpenAI({ apiKey });
  const tools = getOpenAIToolsSchema();

  const response = await client.chat.completions.create({
    model,
    stream: true,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ],
    tools: tools as any,
  });

  let toolCallsBuffer: any[] = [];

  for await (const chunk of response) {
    const delta = chunk.choices[0]?.delta;
    if (delta?.content) {
      onChunk({ type: 'delta', content: delta.content });
    }
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index;
        if (!toolCallsBuffer[idx]) toolCallsBuffer[idx] = { id: tc.id, name: '', arguments: '' };
        if (tc.function?.name) toolCallsBuffer[idx].name += tc.function.name;
        if (tc.function?.arguments) toolCallsBuffer[idx].arguments += tc.function.arguments;
      }
    }
  }

  for (const tc of toolCallsBuffer) {
    if (tc && tc.name) {
      onChunk({ type: 'delta', content: `\n\n⚙️ Executing Tool: **${tc.name}**...\n` });
      let parsedArgs = {};
      try { parsedArgs = JSON.parse(tc.arguments || '{}'); } catch { /* ignore */ }

      const toolResult = await handleToolExecution(tc.name, parsedArgs, onChunk);
      const resultText = toolResult.error
        ? `❌ Tool Failed: ${toolResult.error}`
        : `✅ Result:\n\`\`\`json\n${JSON.stringify(toolResult.result, null, 2)}\n\`\`\``;

      onChunk({ type: 'delta', content: `${resultText}\n` });
    }
  }

  onChunk({ type: 'done' });
}

async function streamGoogle(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  systemPrompt: string,
  onChunk: StreamCallback
): Promise<void> {
  const genAI = new GoogleGenAI({ apiKey });
  const tools = getGoogleToolsSchema();

  const history = messages.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const lastMessage = messages[messages.length - 1].content;
  const chat = genAI.chats.create({
    model,
    config: {
      systemInstruction: systemPrompt,
      tools: tools as any,
    },
    history,
  });

  const stream = await chat.sendMessageStream({ message: lastMessage });
  let functionCalls: any[] = [];

  for await (const chunk of stream) {
    if (chunk.text) {
      onChunk({ type: 'delta', content: chunk.text });
    }
    if ((chunk as any).functionCalls) {
      functionCalls.push(...(chunk as any).functionCalls);
    }
  }

  for (const fc of functionCalls) {
    if (fc.name) {
      onChunk({ type: 'delta', content: `\n\n⚙️ Executing Tool: **${fc.name}**...\n` });
      const toolResult = await handleToolExecution(fc.name, fc.args || {}, onChunk);
      const resultText = toolResult.error
        ? `❌ Tool Failed: ${toolResult.error}`
        : `✅ Result:\n\`\`\`json\n${JSON.stringify(toolResult.result, null, 2)}\n\`\`\``;

      onChunk({ type: 'delta', content: `${resultText}\n` });
    }
  }

  onChunk({ type: 'done' });
}

/**
 * OmniRoute Gateway — OpenAI-compatible streaming via http://localhost:20128/v1
 * No API key required for free tiers; key is passed if stored.
 */
async function streamOmniRoute(
  model: string,
  messages: ChatMessage[],
  systemPrompt: string,
  onChunk: StreamCallback
): Promise<void> {
  const OMNIROUTE_BASE = 'http://localhost:20128/v1';

  const body = JSON.stringify({
    model: model || 'auto',
    stream: true,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ],
  });

  const res = await fetch(`${OMNIROUTE_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`OmniRoute error ${res.status}: ${errText}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('OmniRoute response body is not readable.');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') break;
      try {
        const json = JSON.parse(data);
        const content = json.choices?.[0]?.delta?.content;
        if (content) onChunk({ type: 'delta', content });
      } catch { /* skip malformed SSE lines */ }
    }
  }

  onChunk({ type: 'done' });
}

/**
 * Ollama — OpenAI-compatible streaming via http://localhost:11434/v1
 */
async function streamOllama(
  model: string,
  messages: ChatMessage[],
  systemPrompt: string,
  onChunk: StreamCallback
): Promise<void> {
  const OLLAMA_BASE = 'http://localhost:11434/v1';

  const body = JSON.stringify({
    model: model || 'llama3:latest',
    stream: true,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ],
  });

  const res = await fetch(`${OLLAMA_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Ollama error ${res.status}: ${errText}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('Ollama response body is not readable.');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') break;
      try {
        const json = JSON.parse(data);
        const content = json.choices?.[0]?.delta?.content;
        if (content) onChunk({ type: 'delta', content });
      } catch { /* skip malformed SSE lines */ }
    }
  }

  onChunk({ type: 'done' });
}
