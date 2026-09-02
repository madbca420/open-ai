import { Task, Artifact } from './types/schema';
import { eventBus } from './eventBus';
import { agentOrchestrator, AgentDefinition } from './agentOrchestrator';
import { getDatabase } from './db';
import { generateSitePipeline } from './siteGenerator';
import { executeTool } from './tools';
import { adapterRegistry } from './services/adapters/adapterRegistry';

export interface ExecutionContext {
  missionId: string;
  isCancelled?: boolean;
}

export interface ExecutionAdapter {
  name: string;
  canHandle(task: Task): boolean;
  execute(task: Task, agent: AgentDefinition, context: ExecutionContext): Promise<any>;
  cancel?(task: Task): Promise<void>;
}

// ── 1. Deterministic Local Test Adapter ──
class DeterministicTestAdapter implements ExecutionAdapter {
  name = 'DeterministicTestAdapter';

  canHandle(task: Task): boolean {
    return task.name.startsWith('test_') || task.input?.type === 'deterministic_test';
  }

  async execute(task: Task, agent: AgentDefinition, context: ExecutionContext): Promise<any> {
    const delayMs = task.input?.delayMs || 300;
    const shouldFail = task.input?.shouldFail === true;

    // Check cancellation
    if (context.isCancelled) throw new Error('Task execution cancelled by user');

    await new Promise((res) => setTimeout(res, delayMs));

    if (context.isCancelled) throw new Error('Task execution cancelled by user');

    if (shouldFail) {
      throw new Error(`[DeterministicTestAdapter] Simulated failure for task ${task.id}`);
    }

    return {
      status: 'OK',
      taskId: task.id,
      executedBy: agent.id,
      modelUsed: agent.defaultModel,
      message: `Deterministic task ${task.name} executed successfully.`,
    };
  }
}

// ── 2. Website Builder Adapter ──
class WebsiteBuilderAdapter implements ExecutionAdapter {
  name = 'WebsiteBuilderAdapter';

  canHandle(task: Task): boolean {
    return task.input?.type === 'website_build' || task.name.toLowerCase().includes('website');
  }

  async execute(task: Task, agent: AgentDefinition, context: ExecutionContext): Promise<any> {
    const prompt = task.input?.prompt || task.description || 'Create a sci-fi responsive web application';
    const provider = task.input?.provider || 'openai';
    const modelName = task.input?.modelName || 'gpt-4o';

    const result = await generateSitePipeline(prompt, provider, modelName, (status) => {
      eventBus.emit(
        eventBus.createEvent({
          type: 'website.build_step',
          category: 'WEBSITE',
          source: 'WebsiteBuilderAdapter',
          missionId: context.missionId,
          taskId: task.id,
          payload: status,
        })
      );
    });

    if (result.success && result.siteId) {
      // Register Artifact
      const artifact: Artifact = {
        id: `art_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        type: 'WEBSITE',
        name: `Site ${result.siteId}`,
        path: result.previewUrl || `generated_sites/${result.siteId}`,
        createdAt: new Date().toISOString(),
        createdBy: agent.id,
        missionId: context.missionId,
        taskId: task.id,
        metadata: { siteId: result.siteId },
      };
      registerArtifact(artifact);
    }

    return result;
  }
}

// ── 3. Desktop Automation Tool Adapter ──
class ToolAdapter implements ExecutionAdapter {
  name = 'ToolAdapter';

  canHandle(task: Task): boolean {
    return task.input?.type === 'tool_execution' || !!task.input?.toolName;
  }

  async execute(task: Task, agent: AgentDefinition, context: ExecutionContext): Promise<any> {
    const toolName = task.input.toolName;
    const args = task.input.args || {};
    return await executeTool(toolName, args);
  }
}

// ── 4. Universal Adapter Execution Adapter (routes to adapterRegistry) ──
// Handles any task with input.type === 'adapter_execute'
// This enables YouTube, Kimodo, Skills, Image, Voice adapters to
// be triggered from any chat/voice command through the task graph.
class AdapterExecutionAdapter implements ExecutionAdapter {
  name = 'AdapterExecutionAdapter';

  canHandle(task: Task): boolean {
    return task.input?.type === 'adapter_execute' && !!task.input?.adapterId && !!task.input?.capability;
  }

  async execute(task: Task, agent: AgentDefinition, context: ExecutionContext): Promise<any> {
    const { adapterId, capability, payload } = task.input;

    const execId = `exec_task_${task.id}_${Date.now()}`;

    // Check adapter is available
    const adapter = adapterRegistry.get(adapterId);
    if (!adapter) {
      throw new Error(`Adapter "${adapterId}" not found in registry.`);
    }
    if (adapter.status !== 'READY') {
      throw new Error(`Adapter "${adapterId}" is not READY (current status: ${adapter.status}).`);
    }

    const result = await adapterRegistry.execute(adapterId, {
      executionId: execId,
      adapterId,
      capability,
      missionId: context.missionId,
      taskId: task.id,
      payload: payload || task.input.args || {},
      timestamp: new Date().toISOString(),
    });

    // Register artifact if adapter returned output
    if (result.success && result.output) {
      const artifact: Artifact = {
        id: `art_${execId}`,
        type: 'REPORT',
        name: `${adapterId}:${capability}`,
        path: `adapters/${adapterId}/${capability}`,
        createdAt: new Date().toISOString(),
        createdBy: agent.id,
        missionId: context.missionId,
        taskId: task.id,
        metadata: { adapterId, capability, output: result.output },
      };
      registerArtifact(artifact);
    }

    return result;
  }
}

// Helper to register artifacts in SQLite
export function registerArtifact(artifact: Artifact): void {
  try {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO artifacts (id, type, name, path, checksum, created_at, created_by, mission_id, task_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      artifact.id,
      artifact.type,
      artifact.name,
      artifact.path,
      artifact.checksum || null,
      artifact.createdAt,
      artifact.createdBy,
      artifact.missionId || null,
      artifact.taskId || null,
      JSON.stringify(artifact.metadata || {})
    );

    eventBus.emit(
      eventBus.createEvent({
        type: 'artifact.created',
        category: 'ARTIFACT',
        source: 'ArtifactRegistry',
        missionId: artifact.missionId,
        taskId: artifact.taskId,
        payload: { artifact },
      })
    );
  } catch (err) {
    console.error(`[ArtifactRegistry] Error registering artifact ${artifact.id}:`, err);
  }
}

export class TaskExecutor {
  private adapters: ExecutionAdapter[] = [
    new AdapterExecutionAdapter(),   // ← Highest priority: all adapterRegistry-based tasks
    new DeterministicTestAdapter(),
    new WebsiteBuilderAdapter(),
    new ToolAdapter(),
  ];

  public async executeTask(task: Task, context: ExecutionContext): Promise<any> {
    // 1. Determine agent role based on task name or metadata
    let role: 'DEVELOPER' | 'ARCHITECT' | 'REVIEWER' = 'DEVELOPER';
    if (task.name.toLowerCase().includes('arch') || task.name.toLowerCase().includes('design')) {
      role = 'ARCHITECT';
    } else if (task.name.toLowerCase().includes('review') || task.name.toLowerCase().includes('qa')) {
      role = 'REVIEWER';
    }

    const agent = agentOrchestrator.assignAgentToTask(role, task.id, context.missionId);

    // 2. Select execution adapter
    const adapter = this.adapters.find((a) => a.canHandle(task)) || new DeterministicTestAdapter();

    try {
      agentOrchestrator.updateAgentState(agent.id, 'WORKING', context.missionId, task.id);

      const result = await adapter.execute(task, agent, context);

      agentOrchestrator.updateAgentState(agent.id, 'SUCCESS', context.missionId, task.id);
      setTimeout(() => agentOrchestrator.updateAgentState(agent.id, 'IDLE'), 1000);

      return result;
    } catch (err: any) {
      agentOrchestrator.updateAgentState(agent.id, 'ERROR', context.missionId, task.id);
      setTimeout(() => agentOrchestrator.updateAgentState(agent.id, 'IDLE'), 1000);
      throw err;
    }
  }
}

export const taskExecutor = new TaskExecutor();
