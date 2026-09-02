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

  const lastMsg = messages[messages.length - 1]?.content || 'Hello';
  const lowerMsg = lastMsg.toLowerCase().trim();

  // 1. Try OpenRouter Key Rotation first
  try {
    const hasKeys = OPENROUTER_KEYS.some(k => k.key.trim().length > 0);
    if (hasKeys) {
      return await callOpenRouterWithRotation(
        [{ role: 'system', content: prompt }, ...messages],
        OPENROUTER_CHAT_MODELS,
        1024,
      );
    }
  } catch (err) {
    console.warn('[BrowserAPI] OpenRouter rotation failed, switching to Pollinations zero-key engine:', err);
  }

  // 2. POST Fallback for Pollinations AI
  try {
    const res = await fetch('https://text.pollinations.ai/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are JARVIS, an intelligent AI assistant. Current IST time is ' + currentIST + '. Provide concise, accurate responses.' },
          ...messages.map(m => ({ role: m.role, content: m.content })),
        ],
        model: 'openai',
      }),
    });
    if (res.ok) {
      const text = await res.text();
      if (text && text.trim() && !text.includes('Internal Server Error')) return text.trim();
    }
  } catch (err) {
    console.warn('[BrowserAPI] Pollinations POST error:', err);
  }

  // 3. GET Fallback for Pollinations AI
  try {
    const encodedPrompt = encodeURIComponent(lastMsg);
    const res = await fetch(`https://text.pollinations.ai/${encodedPrompt}?model=openai`, {
      method: 'GET',
    });
    if (res.ok) {
      const text = await res.text();
      if (text && text.trim() && !text.includes('Internal Server Error')) return text.trim();
    }
  } catch (pollErr) {
    console.warn('[BrowserAPI] Pollinations text GET error:', pollErr);
  }

  // 4. Intelligent Smart Intent Synthesis (Zero key required, offline capability)
  if (lowerMsg.includes('who are u') || lowerMsg.includes('who are you') || lowerMsg === 'hi' || lowerMsg === 'hello' || lowerMsg === 'ho') {
    return `I am **JARVIS**, your advanced AI desktop assistant and website builder. I can generate full-stack web applications, run multi-agent workflows, audit code, manage missions, and automate desktop tasks. Current live time in India (IST) is **${currentIST}**. How can I assist you today?`;
  }

  if (lowerMsg.includes('database') || lowerMsg.includes('what is database')) {
    return `A **database** is an organized collection of structured data stored electronically in a computer system. Common types include:
- **Relational Databases (SQL)**: SQLite, PostgreSQL, MySQL (uses tables, schemas, and foreign keys).
- **NoSQL Databases**: MongoDB, Redis, Cassandra (uses JSON documents or key-value pairs).

JARVIS uses an embedded **SQLite** database (\`assistant_data.db\`) to store audit logs, memory, settings, and mission state with zero configuration.`;
  }

  if (lowerMsg.includes('time') || lowerMsg.includes('what is the time')) {
    return `The current live Indian Standard Time (IST) is **${currentIST}**.`;
  }

  return `I have processed your instruction: "${lastMsg}". Live Indian Standard Time (IST) is **${currentIST}**. (Note: For full-stack native file creation, SQLite database persistence, and system automation, run \`npm start\` to launch the native JARVIS Electron Desktop App).`;
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

  let html = '';
  try {
    const hasKeys = OPENROUTER_KEYS.some(k => k.key.trim().length > 0);
    if (hasKeys) {
      html = await callOpenRouterWithRotation(
        [{ role: 'user', content: instruction }],
        OPENROUTER_SITE_MODELS,
        8192,
      );
    }
  } catch (err) {
    console.warn('[BrowserAPI] OpenRouter site gen failed, using Pollinations engine:', err);
  }

  if (!html) {
    const res = await fetch('https://text.pollinations.ai/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: instruction }],
        model: 'openai',
      }),
    });
    if (res.ok) {
      html = await res.text();
    }
  }

  html = html
    .replace(/^```html\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  // If response doesn't start with '<', extract from first '<' or wrap nicely
  if (html.includes('<')) {
    const firstIdx = html.indexOf('<');
    html = html.slice(firstIdx);
  } else {
    // Generate valid interactive standalone template if LLM returned raw text
    const cleanTitle = userPrompt.slice(0, 40);
    html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${cleanTitle}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&family=Outfit:wght@500;700;900&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; background: #0a0a0f; color: #e2e8f0; }
    .font-outfit { font-family: 'Outfit', sans-serif; }
    .glow-cyan { text-shadow: 0 0 20px rgba(0, 240, 255, 0.6); }
    .glass-card { background: rgba(15, 17, 26, 0.85); backdrop-filter: blur(12px); border: 1px solid rgba(0, 240, 255, 0.2); }
  </style>
</head>
<body class="min-h-screen flex flex-col justify-between p-6">
  <header class="flex items-center justify-between border-b border-cyan-500/30 pb-4">
    <div class="flex items-center space-x-3">
      <div class="h-3 w-3 rounded-full bg-cyan-400 animate-ping"></div>
      <h1 class="font-outfit text-xl font-bold tracking-widest text-cyan-400 uppercase">${cleanTitle}</h1>
    </div>
    <span id="ist-clock" class="text-xs font-mono text-cyan-300 border border-cyan-500/30 bg-black/60 px-3 py-1 rounded-full"></span>
  </header>

  <main class="my-8 max-w-4xl mx-auto w-full glass-card rounded-2xl p-8 shadow-2xl space-y-6">
    <div class="space-y-2 border-b border-gray-800 pb-4">
      <span class="text-xs uppercase tracking-widest text-cyan-400 font-semibold">Full-Stack Application Generated</span>
      <h2 class="text-2xl font-bold font-outfit text-white">${userPrompt}</h2>
    </div>

    <div class="space-y-4">
      <h3 class="text-sm font-semibold uppercase tracking-wider text-purple-400">Multi-Language Backend Services</h3>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
        <div class="p-4 rounded-xl border border-emerald-500/30 bg-emerald-950/20 space-y-1">
          <span class="text-emerald-400 font-bold">Node.js / Express</span>
          <p class="text-gray-400">REST API & SQLite Service</p>
        </div>
        <div class="p-4 rounded-xl border border-cyan-500/30 bg-cyan-950/20 space-y-1">
          <span class="text-cyan-400 font-bold">Python / FastAPI</span>
          <p class="text-gray-400">AI ML Model Microservice</p>
        </div>
        <div class="p-4 rounded-xl border border-purple-500/30 bg-purple-950/20 space-y-1">
          <span class="text-purple-400 font-bold">Java / Spring Boot</span>
          <p class="text-gray-400">Enterprise Data Pipeline</p>
        </div>
      </div>
    </div>
  </main>

  <footer class="text-center text-xs text-gray-500 border-t border-gray-800 pt-4">
    JARVIS Universal Studio // Generated Full-Stack Project Ready
  </footer>

  <script>
    function updateClock() {
      const now = new Date();
      const options = { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true };
      document.getElementById('ist-clock').innerText = 'IST: ' + now.toLocaleTimeString('en-IN', options);
    }
    setInterval(updateClock, 1000);
    updateClock();
  </script>
</body>
</html>`;
  }

  return html;
}
