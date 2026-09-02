/**
 * codeGenerator.ts — Multi-Stage AI Code Generation Pipeline
 *
 * Stage 1: Requirements Analysis
 * Stage 2: Architecture Plan (JSON)
 * Stage 3: File Manifest
 * Stage 4: Individual File Generation
 * Stage 5: API Contract Validation
 * Stage 6: Dependency Analysis
 */

import path from 'path';
import fs from 'fs-extra';
import { getApiKey } from './keyVault';
import { logAudit } from './auditLog';

// Vercel AI SDK
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProjectRequirements {
  projectName: string;
  projectType: 'static' | 'frontend-only' | 'fullstack' | 'backend-only';
  frontendFramework: 'react-vite' | 'next' | 'html' | 'none';
  backendFramework: 'express' | 'python-fastapi' | 'python-flask' | 'java-springboot' | 'go-gin' | 'none';
  database: 'sqlite' | 'mongodb' | 'postgresql' | 'mysql' | 'none';
  authentication: boolean;
  authStrategy: 'jwt' | 'session' | 'none';
  pages: string[];
  features: string[];
  apiRoutes: Array<{ method: string; path: string; description: string }>;
  externalServices: string[];
  hasAdminDashboard: boolean;
  requiresEnvVars: string[];
}

export interface GeneratedFile {
  filePath: string; // relative to project root
  content: string;
  description: string;
}

export interface CodeGenResult {
  success: boolean;
  requirements?: ProjectRequirements;
  files: GeneratedFile[];
  errors: string[];
  warnings: string[];
}

// ── AI Model Provider ────────────────────────────────────────────────────────

function getModel(provider: string, modelName: string) {
  const providersToTry = [
    provider,
    'google',
    'openai',
    'anthropic',
    'groq',
    'together',
    'omniroute',
  ];

  for (const p of providersToTry) {
    try {
      if (p === 'google') {
        const apiKey = getApiKey('google') || process.env.GEMINI_API_KEY;
        if (apiKey) return createGoogleGenerativeAI({ apiKey })(modelName || 'gemini-1.5-flash');
      }
      if (p === 'openai') {
        const apiKey = getApiKey('openai') || process.env.OPENAI_API_KEY;
        if (apiKey) return createOpenAI({ apiKey })(modelName || 'gpt-4o');
      }
      if (p === 'anthropic') {
        const apiKey = getApiKey('anthropic') || process.env.ANTHROPIC_API_KEY;
        if (apiKey) return createAnthropic({ apiKey })(modelName || 'claude-3-5-sonnet-20241022');
      }
      if (p === 'groq') {
        const apiKey = getApiKey('groq') || process.env.GROQ_API_KEY;
        if (apiKey) return createOpenAI({ baseURL: 'https://api.groq.com/openai/v1', apiKey })(modelName || 'llama-3.3-70b-versatile');
      }
      if (p === 'together') {
        const apiKey = getApiKey('together') || process.env.TOGETHER_API_KEY;
        if (apiKey) return createOpenAI({ baseURL: 'https://api.together.xyz/v1', apiKey })(modelName || 'meta-llama/Llama-3.3-70B-Instruct-Turbo');
      }
      if (p === 'omniroute' || p === 'ollama') {
        return createOpenAI({
          baseURL: p === 'omniroute' ? 'http://localhost:20128/v1' : 'http://localhost:11434/v1',
          apiKey: 'local',
        })(modelName || 'auto');
      }
    } catch {
      continue;
    }
  }

  // Final fallback: try OmniRoute
  return createOpenAI({ baseURL: 'http://localhost:20128/v1', apiKey: 'local' })('auto');
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\w]*\n?/g, '')
    .replace(/```/g, '')
    .trim();
}

function extractJson<T>(text: string): T | null {
  const clean = stripMarkdown(text);
  // Try to find JSON block
  const jsonMatch = clean.match(/\{[\s\S]*\}/s) || clean.match(/\[[\s\S]*\]/s);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch { /* fall through */ }
  }
  try { return JSON.parse(clean); } catch { return null; }
}

// ── Stage 1: Requirements Analysis ───────────────────────────────────────────

export async function analyzeRequirements(
  prompt: string,
  provider: string,
  modelName: string
): Promise<ProjectRequirements> {
  const model = getModel(provider, modelName);

  const systemPrompt = `You are a senior software architect. Analyze the user's project request and return ONLY a JSON object with the project requirements. No explanation, no markdown fences, just raw JSON.

Return this exact schema:
{
  "projectName": "kebab-case-name",
  "projectType": "static|frontend-only|fullstack|backend-only",
  "frontendFramework": "react-vite|next|html|none",
  "backendFramework": "express|python-fastapi|python-flask|java-springboot|go-gin|none",
  "database": "sqlite|mongodb|postgresql|mysql|none",
  "authentication": true|false,
  "authStrategy": "jwt|session|none",
  "pages": ["list of page names"],
  "features": ["list of features"],
  "apiRoutes": [{"method": "GET|POST|PUT|DELETE", "path": "/api/...", "description": "..."}],
  "externalServices": ["stripe", "sendgrid", etc.],
  "hasAdminDashboard": true|false,
  "requiresEnvVars": ["VAR_NAME_1", "VAR_NAME_2"]
}

Rules:
- If user requests Python/FastAPI/Flask, use python-fastapi or python-flask
- If user requests Java/Spring, use java-springboot
- If user requests Go/Gin, use go-gin
- Default backend is express
- Use SQLite when ANY database is needed unless specifically requested otherwise
- Use JWT for auth (stateless)
- React+Vite is default frontend`;

  const { text } = await generateText({
    model,
    messages: [
      { role: 'user', content: `Analyze this project request: "${prompt}"` },
    ],
    system: systemPrompt,
  });

  const parsed = extractJson<ProjectRequirements>(text);
  if (!parsed) {
    // Fallback: return sensible defaults
    const slugName = prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
    const needsBackend = /backend|api|express|auth|database|server|rest/i.test(prompt);
    const needsDB = /database|sqlite|mongo|sql|data|storage|crud/i.test(prompt);
    const needsAuth = /auth|login|register|user|account|sign in|sign up/i.test(prompt);
    return {
      projectName: slugName || 'my-app',
      projectType: needsBackend ? 'fullstack' : 'frontend-only',
      frontendFramework: 'react-vite',
      backendFramework: needsBackend ? 'express' : 'none',
      database: needsDB ? 'sqlite' : 'none',
      authentication: needsAuth,
      authStrategy: needsAuth ? 'jwt' : 'none',
      pages: ['Home', 'About'],
      features: ['Responsive design', 'Dark theme'],
      apiRoutes: [],
      externalServices: [],
      hasAdminDashboard: /admin|dashboard/i.test(prompt),
      requiresEnvVars: [],
    };
  }

  return parsed;
}

// ── Stage 2: Frontend Code Generation ────────────────────────────────────────

export async function generateFrontendFiles(
  requirements: ProjectRequirements,
  prompt: string,
  provider: string,
  modelName: string,
  onProgress: (file: string) => void
): Promise<GeneratedFile[]> {
  const model = getModel(provider, modelName);
  const files: GeneratedFile[] = [];

  const backendBase = requirements.backendFramework !== 'none'
    ? 'http://localhost:3001'
    : '';

  // Generate App.tsx
  onProgress('frontend/src/App.tsx');
  const appPrompt = `You are a senior React/TypeScript developer. Generate a COMPLETE, production-quality React app for: "${prompt}"

Requirements:
- Pages: ${requirements.pages.join(', ')}
- Features: ${requirements.features.join(', ')}
- Authentication: ${requirements.authentication}
- Has admin dashboard: ${requirements.hasAdminDashboard}
${backendBase ? `- Backend API base URL: ${backendBase}/api` : ''}
${requirements.apiRoutes.length > 0 ? `- API routes to call:\n${requirements.apiRoutes.map(r => `  ${r.method} ${r.path}: ${r.description}`).join('\n')}` : ''}

Rules:
- Return ONLY valid TypeScript/TSX. No markdown, no explanation.
- Use React hooks (useState, useEffect, useCallback)
- Beautiful dark-theme UI using Tailwind CSS classes (loaded via CDN in index.html)
- Responsive layout
- Working navigation between pages using React state (no react-router needed)
- If authentication: show login/register forms with state management
- If admin dashboard: show stats cards, data table placeholder
- Lucide-react icons available
- framer-motion available for animations
- All API calls use fetch() to the backend URL
- Handle loading and error states
- No placeholder text like "Lorem ipsum" or "TODO"
- Complete implementation, no stubs`;

  const { text: appCode } = await generateText({ model, prompt: appPrompt });
  files.push({
    filePath: 'frontend/src/App.tsx',
    content: stripMarkdown(appCode),
    description: 'Main React application component',
  });

  // Generate main.tsx
  files.push({
    filePath: 'frontend/src/main.tsx',
    content: `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)`,
    description: 'React entry point',
  });

  // Generate index.css
  files.push({
    filePath: 'frontend/src/index.css',
    content: `/* Base styles */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { font-family: 'Inter', system-ui, sans-serif; }
body { background: #0a0a0f; color: #e2e8f0; min-height: 100vh; }
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: #1a1a2e; }
::-webkit-scrollbar-thumb { background: #4a5568; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #718096; }`,
    description: 'Global CSS styles',
  });

  return files;
}

// ── Stage 3: Backend Code Generation ─────────────────────────────────────────

export async function generateBackendFiles(
  requirements: ProjectRequirements,
  prompt: string,
  provider: string,
  modelName: string,
  onProgress: (file: string) => void
): Promise<GeneratedFile[]> {
  if (requirements.backendFramework === 'none') return [];

  const model = getModel(provider, modelName);
  const files: GeneratedFile[] = [];
  const useDB = requirements.database !== 'none';
  const useAuth = requirements.authentication;

  // ── PYTHON FASTAPI / FLASK BACKEND ──────────────────────────────────────────
  if (requirements.backendFramework === 'python-fastapi' || requirements.backendFramework === 'python-flask') {
    onProgress('backend/main.py');
    const isFastAPI = requirements.backendFramework === 'python-fastapi';
    const pyPrompt = `Generate a complete, production-ready Python ${isFastAPI ? 'FastAPI' : 'Flask'} main backend file for prompt: "${prompt}".
API routes needed:
${requirements.apiRoutes.map(r => `${r.method} ${r.path}: ${r.description}`).join('\n')}

Rules:
- Return ONLY valid Python code (no markdown fences)
- Include CORS middleware, health endpoint /health, error handling
- ${useDB ? 'Use SQLite via sqlite3 or SQLAlchemy' : ''}
- Port 3001`;

    const { text: pyCode } = await generateText({ model, prompt: pyPrompt });
    files.push({
      filePath: 'backend/main.py',
      content: stripMarkdown(pyCode),
      description: `Python ${isFastAPI ? 'FastAPI' : 'Flask'} main server entry`,
    });

    files.push({
      filePath: 'backend/requirements.txt',
      content: `${isFastAPI ? 'fastapi\nuvicorn\npydantic\n' : 'flask\nflask-cors\n'}requests\nsqlite3\npython-dotenv\n`,
      description: 'Python dependencies file',
    });

    return files;
  }

  // ── JAVA SPRING BOOT BACKEND ────────────────────────────────────────────────
  if (requirements.backendFramework === 'java-springboot') {
    onProgress('backend/src/main/java/com/app/Application.java');
    const javaPrompt = `Generate a complete Java Spring Boot Controller class for prompt: "${prompt}".
Routes:
${requirements.apiRoutes.map(r => `${r.method} ${r.path}: ${r.description}`).join('\n')}

Rules:
- Return ONLY valid Java code (no markdown fences)
- Use @RestController, @CrossOrigin, @GetMapping, @PostMapping`;

    const { text: javaCode } = await generateText({ model, prompt: javaPrompt });
    files.push({
      filePath: 'backend/src/main/java/com/app/controller/ApiController.java',
      content: stripMarkdown(javaCode),
      description: 'Java Spring Boot REST Controller',
    });

    files.push({
      filePath: 'backend/pom.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.app</groupId>
    <artifactId>${requirements.projectName}-backend</artifactId>
    <version>1.0.0</version>
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
            <version>3.2.0</version>
        </dependency>
    </dependencies>
</project>`,
      description: 'Maven dependencies configuration',
    });

    return files;
  }

  // ── GO GIN BACKEND ──────────────────────────────────────────────────────────
  if (requirements.backendFramework === 'go-gin') {
    onProgress('backend/main.go');
    const goPrompt = `Generate a complete Go Gin REST API server for prompt: "${prompt}".
Routes:
${requirements.apiRoutes.map(r => `${r.method} ${r.path}: ${r.description}`).join('\n')}

Rules:
- Return ONLY valid Go code (no markdown fences)
- Use gin.Default(), gin.CORSMiddleware(), port 3001`;

    const { text: goCode } = await generateText({ model, prompt: goPrompt });
    files.push({
      filePath: 'backend/main.go',
      content: stripMarkdown(goCode),
      description: 'Go Gin REST API main server',
    });

    files.push({
      filePath: 'backend/go.mod',
      content: `module ${requirements.projectName}-backend\n\ngo 1.21\n\nrequire github.com/gin-gonic/gin v1.9.1\n`,
      description: 'Go module configuration',
    });

    return files;
  }

  // ── server.ts (Express entry) ──
  onProgress('backend/server.ts');
  const serverEntry = `import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
${useDB ? `import { initDatabase } from './config/database';` : ''}
import { errorHandler } from './middleware/errorHandler';
import apiRouter from './routes';

const app = express();
const PORT = process.env.PORT || 3001;

// Security & middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:3000'], credentials: true }));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: '${requirements.projectName}-api' });
});

// API routes
app.use('/api', apiRouter);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Central error handler
app.use(errorHandler);

async function start() {
  ${useDB ? `await initDatabase();` : ''}
  app.listen(PORT, () => {
    console.log(\`[Server] ${requirements.projectName} API running on http://localhost:\${PORT}\`);
    console.log(\`[Server] Health check: http://localhost:\${PORT}/health\`);
  });
}

start().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});

export default app;
`;

  files.push({ filePath: 'backend/server.ts', content: serverEntry, description: 'Express server entry point' });

  // ── routes/index.ts ──
  onProgress('backend/routes/index.ts');
  const routePrompt = `Generate a complete Express router index file for: "${prompt}"

API routes needed:
${requirements.apiRoutes.map(r => `${r.method} /api${r.path}: ${r.description}`).join('\n')}
${useAuth ? '- POST /auth/register\n- POST /auth/login\n- GET /auth/me (protected)\n- POST /auth/logout' : ''}

Rules:
- Return ONLY TypeScript code (no markdown, no explanation)
- Use express.Router()
- Import from '../controllers/...' for each route group
- Add proper JSDoc comments
- Handle both authenticated and public routes
- Use express async wrapper pattern`;

  const { text: routeCode } = await generateText({ model, prompt: routePrompt });
  files.push({
    filePath: 'backend/routes/index.ts',
    content: stripMarkdown(routeCode),
    description: 'Express routes index',
  });

  // ── controllers ──
  if (requirements.apiRoutes.length > 0 || useAuth) {
    onProgress('backend/controllers/...');
    const ctrlPrompt = `Generate complete Express controller functions for: "${prompt}"

Include controllers for:
${requirements.apiRoutes.map(r => `- ${r.method} ${r.path}: ${r.description}`).join('\n')}
${useAuth ? '- register, login, getMe, logout' : ''}
${useDB ? `- Use SQLite via better-sqlite3 (imported from '../config/database')` : ''}
${useAuth ? '- Hash passwords with bcryptjs\n- Sign JWT tokens using jsonwebtoken\n- JWT_SECRET from process.env.JWT_SECRET or \'dev-secret-change-in-production\'' : ''}

Rules:
- Return ONLY TypeScript. No markdown.
- Proper error handling with try/catch
- Return consistent JSON responses: { data, error, message }
- Status codes: 200 OK, 201 Created, 400 Bad Request, 401 Unauthorized, 404 Not Found, 500 Server Error
- Input validation before DB operations`;

    const { text: ctrlCode } = await generateText({ model, prompt: ctrlPrompt });
    files.push({
      filePath: 'backend/controllers/index.ts',
      content: stripMarkdown(ctrlCode),
      description: 'Express controllers',
    });
  }

  // ── middleware/errorHandler.ts ──
  files.push({
    filePath: 'backend/middleware/errorHandler.ts',
    content: `import { Request, Response, NextFunction } from 'express';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export function errorHandler(
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err.statusCode || 500;
  const message = err.isOperational ? err.message : 'Internal server error';

  console.error('[ErrorHandler]', { statusCode, message: err.message, stack: err.stack });

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
}

export function createError(message: string, statusCode = 500): AppError {
  const err: AppError = new Error(message);
  err.statusCode = statusCode;
  err.isOperational = true;
  return err;
}
`,
    description: 'Centralized Express error handler',
  });

  // ── middleware/auth.ts (if auth required) ──
  if (useAuth) {
    files.push({
      filePath: 'backend/middleware/auth.ts',
      content: `import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

export interface AuthRequest extends Request {
  user?: { id: string; email: string; role: string };
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization token required' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; email: string; role: string };
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(role: string) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) { res.status(401).json({ error: 'Not authenticated' }); return; }
    if (req.user.role !== role && req.user.role !== 'admin') {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
`,
      description: 'JWT authentication middleware',
    });
  }

  // ── config/database.ts (if DB required) ──
  if (useDB) {
    onProgress('backend/config/database.ts');
    if (requirements.database === 'sqlite') {
      files.push({
        filePath: 'backend/config/database.ts',
        content: `import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let db: Database.Database;

export function initDatabase(): Database.Database {
  const dbDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  const dbPath = path.join(dbDir, 'app.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);
  console.log('[Database] SQLite initialized at', dbPath);
  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(\`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  \`);

  const version = (db.prepare('SELECT MAX(version) as v FROM schema_version').get() as any)?.v ?? 0;

  if (version < 1) {
    db.exec(\`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT,
        role TEXT DEFAULT 'user',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'active',
        user_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    \`);
    db.prepare('INSERT INTO schema_version (version) VALUES (1)').run();
    console.log('[Database] Applied migration v1');
  }
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

export default { initDatabase, getDatabase };
`,
        description: 'SQLite database configuration with migrations',
      });
    } else if (requirements.database === 'mongodb') {
      files.push({
        filePath: 'backend/config/database.ts',
        content: `import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

export async function initDatabase(): Promise<void> {
  if (!MONGODB_URI) {
    console.warn('[Database] MONGODB_URI not set — database features will be unavailable');
    return;
  }
  await mongoose.connect(MONGODB_URI);
  console.log('[Database] MongoDB connected');
}

export default { initDatabase };
`,
        description: 'MongoDB database configuration',
      });
    }
  }

  return files;
}

// ── Stage 4: Scaffold Files ───────────────────────────────────────────────────

export async function generateScaffoldFiles(
  requirements: ProjectRequirements,
  projectDir: string
): Promise<GeneratedFile[]> {
  const files: GeneratedFile[] = [];
  const needsBackend = requirements.backendFramework !== 'none';
  const needsDB = requirements.database !== 'none';
  const useAuth = requirements.authentication;
  const slug = requirements.projectName;

  // ── Frontend package.json ──
  const frontendPkg: Record<string, any> = {
    name: `${slug}-frontend`,
    private: true,
    version: '0.1.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'tsc && vite build',
      preview: 'vite preview',
      typecheck: 'tsc --noEmit',
    },
    dependencies: {
      react: '^18.3.1',
      'react-dom': '^18.3.1',
      'lucide-react': '^0.453.0',
      'framer-motion': '^11.11.11',
    },
    devDependencies: {
      '@types/react': '^18.3.12',
      '@types/react-dom': '^18.3.1',
      '@vitejs/plugin-react': '^4.3.3',
      typescript: '^5.6.3',
      vite: '^5.4.9',
    },
  };
  files.push({
    filePath: 'frontend/package.json',
    content: JSON.stringify(frontendPkg, null, 2),
    description: 'Frontend package.json',
  });

  // ── Frontend tsconfig.json ──
  files.push({
    filePath: 'frontend/tsconfig.json',
    content: JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        useDefineForClassFields: true,
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        skipLibCheck: true,
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: 'react-jsx',
        strict: true,
        noUnusedLocals: false,
        noUnusedParameters: false,
        noFallthroughCasesInSwitch: true,
      },
      include: ['src'],
      references: [{ path: './tsconfig.node.json' }],
    }, null, 2),
    description: 'Frontend TypeScript config',
  });

  files.push({
    filePath: 'frontend/tsconfig.node.json',
    content: JSON.stringify({
      compilerOptions: {
        composite: true,
        skipLibCheck: true,
        module: 'ESNext',
        moduleResolution: 'bundler',
        allowSyntheticDefaultImports: true,
      },
      include: ['vite.config.ts'],
    }, null, 2),
    description: 'Frontend TypeScript node config',
  });

  // ── Frontend vite.config.ts ──
  const proxyConfig = needsBackend
    ? `
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },`
    : '';

  files.push({
    filePath: 'frontend/vite.config.ts',
    content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,${proxyConfig}
  },
})
`,
    description: 'Vite configuration with optional API proxy',
  });

  // ── Frontend index.html ──
  files.push({
    filePath: 'frontend/index.html',
    content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${slug}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;900&family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
  </head>
  <body class="bg-gray-950 text-white min-h-screen" style="font-family: 'Inter', system-ui, sans-serif;">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    description: 'Frontend HTML entry',
  });

  // ── Backend scaffold (if needed) ──
  if (needsBackend) {
    const backendDeps: Record<string, string> = {
      express: '^4.21.1',
      cors: '^2.8.5',
      helmet: '^8.0.0',
      morgan: '^1.10.0',
    };
    const backendDevDeps: Record<string, string> = {
      '@types/express': '^5.0.0',
      '@types/cors': '^2.8.17',
      '@types/morgan': '^1.9.9',
      '@types/node': '^20.19.43',
      typescript: '^5.6.3',
      'ts-node': '^10.9.2',
      nodemon: '^3.1.7',
    };

    if (useAuth) {
      backendDeps['bcryptjs'] = '^2.4.3';
      backendDeps['jsonwebtoken'] = '^9.0.2';
      backendDevDeps['@types/bcryptjs'] = '^2.4.6';
      backendDevDeps['@types/jsonwebtoken'] = '^9.0.7';
    }

    if (needsDB && requirements.database === 'sqlite') {
      backendDeps['better-sqlite3'] = '^11.5.0';
      backendDevDeps['@types/better-sqlite3'] = '^7.6.11';
    } else if (needsDB && requirements.database === 'mongodb') {
      backendDeps['mongoose'] = '^8.7.1';
    } else if (needsDB && requirements.database === 'postgresql') {
      backendDeps['pg'] = '^8.13.0';
      backendDevDeps['@types/pg'] = '^8.11.10';
    }

    const backendPkg: Record<string, any> = {
      name: `${slug}-backend`,
      private: true,
      version: '0.1.0',
      scripts: {
        dev: 'nodemon --exec ts-node server.ts',
        start: 'ts-node server.ts',
        build: 'tsc',
        typecheck: 'tsc --noEmit',
      },
      dependencies: backendDeps,
      devDependencies: backendDevDeps,
    };

    files.push({
      filePath: 'backend/package.json',
      content: JSON.stringify(backendPkg, null, 2),
      description: 'Backend package.json (CommonJS)',
    });

    files.push({
      filePath: 'backend/tsconfig.json',
      content: JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          lib: ['ES2020'],
          outDir: './dist',
          rootDir: '.',
          strict: false,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          resolveJsonModule: true,
          skipLibCheck: true,
          noEmit: false,
        },
        include: ['.'],
        exclude: ['node_modules', 'dist'],
      }, null, 2),
      description: 'Backend TypeScript config (CommonJS)',
    });

    // Nodemon config
    files.push({
      filePath: 'backend/nodemon.json',
      content: JSON.stringify({
        watch: ['.'],
        ext: 'ts,json',
        ignore: ['dist/', 'node_modules/'],
        exec: 'ts-node server.ts',
      }, null, 2),
      description: 'Nodemon configuration',
    });

    // Ensure required directories exist
    files.push({ filePath: 'backend/routes/.gitkeep', content: '', description: 'Routes directory' });
    files.push({ filePath: 'backend/controllers/.gitkeep', content: '', description: 'Controllers directory' });
    files.push({ filePath: 'backend/middleware/.gitkeep', content: '', description: 'Middleware directory' });
    files.push({ filePath: 'backend/config/.gitkeep', content: '', description: 'Config directory' });
    if (needsDB) files.push({ filePath: 'backend/data/.gitkeep', content: '', description: 'Data directory' });
  }

  // ── .env.example ──
  const envLines: string[] = [
    '# Environment Configuration',
    '# Copy to .env and fill in your values',
    '',
    `NODE_ENV=development`,
  ];
  if (needsBackend) envLines.push('PORT=3001');
  if (useAuth) envLines.push('JWT_SECRET=change-this-to-a-random-secret-in-production');
  if (requirements.database === 'mongodb') envLines.push('MONGODB_URI=mongodb://localhost:27017/your-db-name');
  if (requirements.database === 'postgresql') envLines.push('DATABASE_URL=postgresql://user:password@localhost:5432/your-db-name');
  requirements.externalServices.forEach((svc) => {
    envLines.push(`${svc.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY=REQUIRED`);
  });

  files.push({
    filePath: '.env.example',
    content: envLines.join('\n'),
    description: 'Environment variables template',
  });

  // ── README.md ──
  const readmeLines = [
    `# ${slug}`,
    '',
    requirements.projectType === 'fullstack'
      ? `A full-stack application with React frontend and Express backend.`
      : `A React frontend application.`,
    '',
    '## Getting Started',
    '',
    '### Prerequisites',
    '- Node.js 18+',
    '- npm',
    '',
    '### Setup',
    '',
    '```bash',
    '# Copy environment template',
    'cp .env.example .env',
    '```',
    '',
  ];

  if (needsBackend) {
    readmeLines.push(
      '### Start Frontend',
      '```bash',
      'cd frontend',
      'npm install',
      'npm run dev',
      '```',
      '',
      '### Start Backend',
      '```bash',
      'cd backend',
      'npm install',
      'npm run dev',
      '```',
    );
  } else {
    readmeLines.push(
      '### Start Development Server',
      '```bash',
      'cd frontend',
      'npm install',
      'npm run dev',
      '```',
    );
  }

  readmeLines.push(
    '',
    '## Features',
    ...requirements.features.map((f) => `- ${f}`),
    '',
    '## Tech Stack',
    `- Frontend: React + Vite + TypeScript + Tailwind CSS`,
    ...(needsBackend ? [`- Backend: Express + TypeScript`] : []),
    ...(needsDB ? [`- Database: ${requirements.database}`] : []),
    ...(useAuth ? ['- Authentication: JWT'] : []),
  );

  files.push({
    filePath: 'README.md',
    content: readmeLines.join('\n'),
    description: 'Project README',
  });

  return files;
}

// ── Main Generation Entry Point ───────────────────────────────────────────────

export async function generateProject(params: {
  prompt: string;
  projectDir: string;
  provider: string;
  modelName: string;
  onProgress: (stage: string, file?: string) => void;
}): Promise<CodeGenResult> {
  const { prompt, projectDir, provider, modelName, onProgress } = params;
  const result: CodeGenResult = { success: false, files: [], errors: [], warnings: [] };

  try {
    // Stage 1: Requirements
    onProgress('REQUIREMENTS');
    const requirements = await analyzeRequirements(prompt, provider, modelName);
    result.requirements = requirements;
    logAudit('CODE_GEN_REQUIREMENTS', `Project type: ${requirements.projectType}, DB: ${requirements.database}`, 'SUCCESS');

    // Stage 2: Scaffold files (no AI needed)
    onProgress('SCAFFOLD');
    const scaffoldFiles = await generateScaffoldFiles(requirements, projectDir);
    result.files.push(...scaffoldFiles);

    // Stage 3: Frontend
    onProgress('FRONTEND', 'frontend/src/App.tsx');
    const frontendFiles = await generateFrontendFiles(requirements, prompt, provider, modelName, (f) => onProgress('FRONTEND', f));
    result.files.push(...frontendFiles);

    // Stage 4: Backend (if needed)
    if (requirements.backendFramework !== 'none') {
      onProgress('BACKEND', 'backend/server.ts');
      const backendFiles = await generateBackendFiles(requirements, prompt, provider, modelName, (f) => onProgress('BACKEND', f));
      result.files.push(...backendFiles);
    }

    // Write all files to disk
    onProgress('WRITING_FILES');
    for (const file of result.files) {
      if (!file.content && !file.filePath.endsWith('.gitkeep')) continue;
      const fullPath = path.join(projectDir, file.filePath);
      await fs.ensureDir(path.dirname(fullPath));
      await fs.writeFile(fullPath, file.content, 'utf8');
    }

    result.success = true;
    logAudit('CODE_GEN_COMPLETE', `Generated ${result.files.length} files for ${requirements.projectName}`, 'SUCCESS');
    return result;

  } catch (err: any) {
    result.errors.push(err.message || String(err));
    logAudit('CODE_GEN_FAILED', err.message, 'FAILED');
    return result;
  }
}

// ── Repair Engine ────────────────────────────────────────────────────────────

export async function repairFile(params: {
  filePath: string;
  currentContent: string;
  errorLog: string;
  provider: string;
  modelName: string;
  context?: string;
}): Promise<string> {
  const model = getModel(params.provider, params.modelName);
  const ext = path.extname(params.filePath);
  const lang = ext === '.tsx' || ext === '.ts' ? 'TypeScript' : ext === '.js' ? 'JavaScript' : 'code';

  const repairPrompt = `You are an expert ${lang} developer. Fix the following ${lang} file that has compilation/runtime errors.

FILE: ${params.filePath}
${params.context ? `CONTEXT: ${params.context}` : ''}

ERROR:
${params.errorLog.slice(0, 2000)}

CURRENT CODE:
${params.currentContent.slice(0, 6000)}

Rules:
- Return ONLY the corrected complete file content. No markdown, no explanation.
- Fix ALL errors shown
- Do not add new features, only fix errors
- Maintain the same overall structure and logic
- The very first character must be the actual code`;

  const { text } = await generateText({ model, prompt: repairPrompt });
  return stripMarkdown(text);
}

// ── Install Dependencies ─────────────────────────────────────────────────────

export async function installDependencies(
  dir: string,
  onLog: (msg: string) => void
): Promise<{ success: boolean; error?: string }> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  try {
    onLog(`[Install] Running npm install in ${dir}`);
    const { stdout, stderr } = await execAsync('npm install --no-audit --prefer-offline', {
      cwd: dir,
      timeout: 120_000, // 2 minutes
    });
    if (stdout) onLog(`[Install] ${stdout.trim().slice(0, 500)}`);
    if (stderr && !stderr.includes('npm warn') && !stderr.includes('WARN')) {
      onLog(`[Install:WARN] ${stderr.trim().slice(0, 300)}`);
    }
    onLog(`[Install] ✅ Dependencies installed in ${dir}`);
    return { success: true };
  } catch (err: any) {
    const msg = err.stderr || err.stdout || err.message || String(err);
    onLog(`[Install:ERR] ${msg.slice(0, 500)}`);
    return { success: false, error: msg };
  }
}
