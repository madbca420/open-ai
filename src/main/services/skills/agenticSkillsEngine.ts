/**
 * agenticSkillsEngine.ts — Agentic Awesome Skills Catalog & Execution Engine
 *
 * Source: https://github.com/sickn33/agentic-awesome-skills
 * Manages reusable specialist agent skills registered into JARVIS's SQLite DB skills table.
 */

import { getDatabase } from '../../db';
import { logAudit } from '../../auditLog';

export interface AgenticSkill {
  id: string;
  name: string;
  description: string;
  category: 'DEVELOPMENT' | 'SECURITY' | 'RESEARCH' | 'AUTOMATION' | 'DEVOPS' | 'DATA';
  version: string;
  systemPromptAddon: string;
  enabled: boolean;
}

export const AWESOME_AGENTIC_SKILLS: AgenticSkill[] = [
  {
    id: 'skill-code-reviewer',
    name: 'Master Code Reviewer',
    description: 'Performs deep static analysis, clean code checks, complexity measurement, and security audits.',
    category: 'DEVELOPMENT',
    version: '1.0.0',
    systemPromptAddon: 'Focus heavily on code maintainability, SOLID principles, type safety, performance edge cases, and architectural sanity.',
    enabled: true,
  },
  {
    id: 'skill-security-auditor',
    name: 'OWASP Security Auditor',
    description: 'Inspects code for OWASP Top 10 vulnerabilities, XSS, SQL injection, insecure dependencies, and secret leaks.',
    category: 'SECURITY',
    version: '1.0.0',
    systemPromptAddon: 'Check for exposed secrets, unsafe deserialization, missing input sanitization, dangerous shell invocations, and broken access controls.',
    enabled: true,
  },
  {
    id: 'skill-database-architect',
    name: 'Database Architect & Migration Expert',
    description: 'Designs normalized SQL & NoSQL database schemas, indexes, migrations, and query optimizations.',
    category: 'DATA',
    version: '1.0.0',
    systemPromptAddon: 'Enforce foreign key constraints, proper indexing strategies, transaction boundaries, and query performance.',
    enabled: true,
  },
  {
    id: 'skill-devops-docker',
    name: 'DevOps & Container Specialist',
    description: 'Generates multi-stage Dockerfiles, docker-compose configs, CI/CD GitHub Actions workflows, and healthchecks.',
    category: 'DEVOPS',
    version: '1.0.0',
    systemPromptAddon: 'Produce production-ready multi-stage Dockerfiles, non-root user execution, layer caching optimization, and clean environment templates.',
    enabled: true,
  },
  {
    id: 'skill-api-designer',
    name: 'REST & GraphQL API Architect',
    description: 'Designs RESTful endpoints, OpenAPI 3.0 schemas, error standards, rate limiting, and client SDK abstractions.',
    category: 'DEVELOPMENT',
    version: '1.0.0',
    systemPromptAddon: 'Ensure consistent JSON response envelopes, HTTP status codes, pagination headers, and clear error schemas.',
    enabled: true,
  },
  {
    id: 'skill-web-scraper',
    name: 'Resilient Web Scraper & Crawler',
    description: 'Extracts structured data from web pages using headless browser automation, rate limiting, and proxy handling.',
    category: 'AUTOMATION',
    version: '1.0.0',
    systemPromptAddon: 'Use modern DOM parsing heuristics, respect robots.txt, implement retry backoff, and handle dynamic JavaScript rendering.',
    enabled: true,
  },
];

export class AgenticSkillsEngine {
  public initialize(): void {
    try {
      const db = getDatabase();
      const insertStmt = db.prepare(`
        INSERT INTO skills (id, name, description, category, version, enabled, permission_level)
        VALUES (?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET
          description = excluded.description,
          version = excluded.version
      `);

      for (const skill of AWESOME_AGENTIC_SKILLS) {
        insertStmt.run(skill.id, skill.name, skill.description, skill.category, skill.version, skill.enabled ? 1 : 0);
      }

      logAudit('AGENTIC_SKILLS_INIT', `Registered ${AWESOME_AGENTIC_SKILLS.length} agentic skills into SQLite`, 'SUCCESS');
    } catch (err: any) {
      console.warn('[AgenticSkills] Skill registration warning:', err?.message);
    }
  }

  public listSkills(): AgenticSkill[] {
    return AWESOME_AGENTIC_SKILLS;
  }

  public getSkill(id: string): AgenticSkill | undefined {
    return AWESOME_AGENTIC_SKILLS.find((s) => s.id === id);
  }
}

export const agenticSkillsEngine = new AgenticSkillsEngine();
