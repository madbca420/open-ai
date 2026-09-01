import { AgentState } from './types/schema';
import { eventBus } from './eventBus';
import { getDatabase } from './db';

export interface AgentDefinition {
  id: string;
  name: string;
  role: 'DEVELOPER' | 'ARCHITECT' | 'REVIEWER' | 'RESEARCH' | 'TRADING' | 'CREATIVE' | 'VOICE';
  defaultModel: string;
  state: AgentState;
  lastActiveAt: string;
}

export class AgentOrchestrator {
  private agents: Map<string, AgentDefinition> = new Map();
  private initialized = false;

  constructor() {
    // Do NOT access getDatabase() here — database may not be ready at import time.
    // Call initialize() explicitly from main.ts after initDatabase() completes.
  }

  /**
   * Must be called after initDatabase() has completed.
   * Seeds default agents and loads any existing state from the database.
   */
  public initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    console.log('[AgentOrchestrator] Initializing...');
    this.loadAndSeedAgents();
  }

  private loadAndSeedAgents(): void {
    const defaults: AgentDefinition[] = [
      {
        id: 'agent_developer',
        name: 'Developer Agent',
        role: 'DEVELOPER',
        // Primary coding / implementation via OmniRoute OxAlpha
        defaultModel: 'oxalpha',
        state: 'IDLE',
        lastActiveAt: new Date().toISOString(),
      },
      {
        id: 'agent_architect',
        name: 'Architect Agent',
        role: 'ARCHITECT',
        // Analysis / planning / reasoning support via OmniRoute Dots3-Note Preview
        defaultModel: 'dots3-note',
        state: 'IDLE',
        lastActiveAt: new Date().toISOString(),
      },
      {
        id: 'agent_reviewer',
        name: 'Code Reviewer Agent',
        role: 'REVIEWER',
        // Code review / verification / complex reasoning via OmniRoute NVIDIA Nemotron 3 Ultra
        defaultModel: 'nvidia/nemotron-3-ultra',
        state: 'IDLE',
        lastActiveAt: new Date().toISOString(),
      },
    ];

    for (const a of defaults) {
      this.agents.set(a.id, a);
      this.persistAgent(a);
      console.log(`[AgentOrchestrator] ${a.name} ready.`);
    }
    console.log('[AgentOrchestrator] Ready.');
  }

  public getAgentForRole(role: AgentDefinition['role']): AgentDefinition {
    for (const agent of this.agents.values()) {
      if (agent.role === role) return agent;
    }
    // Fallback to Developer Agent if role not found
    return this.agents.get('agent_developer')!;
  }

  public assignAgentToTask(role: AgentDefinition['role'], taskId: string, missionId: string): AgentDefinition {
    const agent = this.getAgentForRole(role);
    this.updateAgentState(agent.id, 'ROUTING', missionId, taskId);

    eventBus.emit(
      eventBus.createEvent({
        type: 'agent.assigned',
        category: 'AGENT',
        source: 'AgentOrchestrator',
        missionId,
        taskId,
        agentId: agent.id,
        payload: { agentId: agent.id, role: agent.role, model: agent.defaultModel },
      })
    );

    return agent;
  }

  public updateAgentState(agentId: string, state: AgentState, missionId?: string, taskId?: string): AgentDefinition | null {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    agent.state = state;
    agent.lastActiveAt = new Date().toISOString();
    this.agents.set(agent.id, agent);
    this.persistAgent(agent);

    eventBus.emit(
      eventBus.createEvent({
        type: `agent.${state.toLowerCase()}`,
        category: 'AGENT',
        source: 'AgentOrchestrator',
        missionId,
        taskId,
        agentId: agent.id,
        severity: state === 'ERROR' ? 'ERROR' : 'INFO',
        payload: { agentId: agent.id, state: agent.state, role: agent.role, model: agent.defaultModel },
      })
    );

    return agent;
  }

  public listAgents(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  private persistAgent(agent: AgentDefinition): void {
    try {
      const db = getDatabase();
      db.prepare(`
        INSERT INTO agents (id, name, role, assigned_model, state, last_active_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          state = excluded.state,
          last_active_at = excluded.last_active_at,
          assigned_model = excluded.assigned_model
      `).run(
        agent.id,
        agent.name,
        agent.role,
        agent.defaultModel,
        agent.state,
        agent.lastActiveAt
      );
    } catch (err) {
      console.error(`[AgentOrchestrator] Error persisting agent ${agent.id}:`, err);
    }
  }
}

// Module-level singleton — constructor is SAFE at import time (does not touch DB).
// main.ts MUST call agentOrchestrator.initialize() after initDatabase() completes.
export const agentOrchestrator = new AgentOrchestrator();
