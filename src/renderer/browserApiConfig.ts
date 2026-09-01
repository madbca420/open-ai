/**
 * browserApiConfig.ts — Browser-mode AI (OpenRouter Gateway)
 *
 * Uses OpenRouter API with key rotation across all 5 user keys.
 * Note: Model slugs DO NOT use :free suffix.
 */

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** OpenRouter key entries (retrieved dynamically from KeyVault / LocalStorage) */
export const OPENROUTER_KEYS = [
  { name: 'oxalpha',              key: (typeof process !== 'undefined' && process.env?.OPENROUTER_KEY_OXALPHA) || '' },
  { name: 'dots3-note',           key: (typeof process !== 'undefined' && process.env?.OPENROUTER_KEY_DOTS3) || '' },
  { name: 'nemotron-3-ultra',     key: (typeof process !== 'undefined' && process.env?.OPENROUTER_KEY_NEMOTRON) || '' },
  { name: 'nvidia-nemotron-3-ultra', key: (typeof process !== 'undefined' && process.env?.OPENROUTER_KEY_NVIDIA_NEMOTRON) || '' },
  { name: 'lfm2.5-embedding',     key: (typeof process !== 'undefined' && process.env?.OPENROUTER_KEY_LFM25) || '' },
];

/**
 * Standard model slugs for OpenRouter (without :free suffix)
 */
export const OPENROUTER_CHAT_MODELS = [
  'meta-llama/llama-3.1-8b-instruct',
  'google/gemma-2-9b-it',
  'mistralai/mistral-7b-instruct',
  'qwen/qwen-2.5-7b-instruct',
  'deepseek/deepseek-chat-v3-0324',
];

/** Site generation models */
export const OPENROUTER_SITE_MODELS = [
  'meta-llama/llama-3.1-8b-instruct',
  'google/gemma-2-9b-it',
  'mistralai/mistral-7b-instruct',
  'deepseek/deepseek-chat-v3-0324',
];

/**
 * Core OpenRouter API call — tries key/model combinations sequentially until success.
 */
export async function callOpenRouterWithRotation(
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  models = OPENROUTER_CHAT_MODELS,
  maxTokens = 1024,
): Promise<string> {
  const errors: string[] = [];

  for (const model of models) {
    for (const { name, key } of OPENROUTER_KEYS) {
      try {
        const response = await fetch(OPENROUTER_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`,
            'HTTP-Referer': 'http://localhost:5173',
            'X-Title': 'JARVIS AI Assistant',
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.7,
            max_tokens: maxTokens,
          }),
        });

        if (!response.ok) {
          const errJson = await response.json().catch(() => ({}));
          const msg = errJson.error?.message || `HTTP ${response.status}`;
          errors.push(`[${name}/${model}]: ${msg}`);
          console.warn(`[BrowserAPI] ${name} + ${model} → ${msg}`);
          continue;
        }

        const data = await response.json();
        const reply = data.choices?.[0]?.message?.content?.trim();
        if (!reply) {
          errors.push(`[${name}/${model}]: empty response`);
          continue;
        }

        console.log(`[BrowserAPI] ✓ key="${name}" model="${model}"`);
        return reply;
      } catch (err: any) {
        const msg = err?.message || String(err);
        errors.push(`[${name}/${model}]: ${msg}`);
        console.warn(`[BrowserAPI] ${name} error: ${msg}`);
      }
    }
  }

  throw new Error(`All OpenRouter attempts failed:\n${errors.slice(0, 3).join('\n')}`);
}

/**
 * Master browser-mode chat call.
 */
export async function callBrowserAI(
  messages: { role: 'user' | 'assistant'; content: string }[],
  systemPrompt?: string,
): Promise<string> {
  const currentIST = new Date().toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  const prompt = systemPrompt || `You are JARVIS, an advanced AI assistant. Current live time in India (IST): ${currentIST}.
SPECIAL CAPABILITIES:
- If the user asks to generate, create, show, or draw an image: ALWAYS generate high quality image markdown using Pollinations AI: ![Generated Image](https://pollinations.ai/p/<URL_ENCODED_PROMPT>?width=1024&height=768&seed=42) or Unsplash image links.
- If asked about time: reply with exact 12-hour IST time.
- Be concise, helpful, direct, and powerful.`;

  return callOpenRouterWithRotation(
    [{ role: 'system', content: prompt }, ...messages],
    OPENROUTER_CHAT_MODELS,
    1024,
  );
}

/**
 * Browser-mode site HTML generation.
 */
export async function callBrowserSiteGenAI(userPrompt: string): Promise<string> {
  const instruction = `You are an expert full-stack web designer and developer. Generate a complete, visually stunning single-file HTML web application based on this prompt: "${userPrompt}".
STRICT RULES:
- Output ONLY valid raw HTML starting with <!DOCTYPE html>. Absolutely no markdown backticks, no explanations outside HTML.
- Use Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script> inside <head>.
- Include real, high-quality Unsplash image URLs (e.g. https://images.unsplash.com/photo-...) for all media, cards, heroes, and galleries.
- For trading/finance sites: include interactive Canvas/Chart.js stock/crypto charts, buy/sell forms, real-time ticker updates via JS.
- For 3D/Travel/E-Commerce sites: include interactive booking forms, product cards, rating stars, animated heroes, filter tabs, and full styling.
- Design theme: futuristic dark mode (#0a0a0f), cyan/purple/emerald neon gradients, smooth CSS transitions.
- Import Google Fonts (Inter / Outfit / JetBrains Mono).
- Provide complete working JavaScript inside <script> tags for state management, interactive tabs, form submissions, and notifications.
- Include a live clock showing Indian Standard Time (IST, 12-hour format hh:mm:ss AM/PM).
- The VERY FIRST CHARACTER of your response must be "<".`;

  let html = await callOpenRouterWithRotation(
    [{ role: 'user', content: instruction }],
    OPENROUTER_SITE_MODELS,
    8192,
  );

  html = html
    .replace(/^```html\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  if (!html || !html.includes('<')) {
    throw new Error('AI returned invalid HTML. Please try again.');
  }

  return html;
}
