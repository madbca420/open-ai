import { Task, TaskStatus, TaskGraph } from './types/schema';
import { eventBus } from './eventBus';
import { getDatabase } from './db';

export class TaskGraphEngine {
  private graphs: Map<string, TaskGraph> = new Map();

  public createGraph(missionId: string, tasks: Omit<Task, 'missionId' | 'status'>[]): TaskGraph {
    const taskMap: Record<string, Task> = {};
    const rootTaskIds: string[] = [];

    // 1. Build initial task map
    for (const t of tasks) {
      const task: Task = {
        ...t,
        missionId,
        dependencies: t.dependencies || [],
        status: (t.dependencies && t.dependencies.length > 0) ? 'BLOCKED' : 'PENDING',
      };
      taskMap[task.id] = task;

      if (!t.dependencies || t.dependencies.length === 0) {
        rootTaskIds.push(task.id);
      }
    }

    // 2. Validate cycle detection
    this.detectCycles(taskMap);

    const graph: TaskGraph = {
      missionId,
      tasks: taskMap,
      rootTaskIds,
    };

    this.graphs.set(missionId, graph);
    this.persistGraph(graph);

    // 3. Emit task.created events
    for (const task of Object.values(taskMap)) {
      eventBus.emit(
        eventBus.createEvent({
          type: 'task.created',
          category: 'TASK',
          source: 'TaskGraphEngine',
          missionId,
          taskId: task.id,
          payload: { task },
        })
      );
    }

    return graph;
  }

  public getGraph(missionId: string): TaskGraph | null {
    if (this.graphs.has(missionId)) {
      return this.graphs.get(missionId)!;
    }
    return this.loadGraphFromDb(missionId);
  }

  public getReadyTasks(missionId: string): Task[] {
    const graph = this.getGraph(missionId);
    if (!graph) return [];

    const ready: Task[] = [];
    for (const task of Object.values(graph.tasks)) {
      if (task.status === 'PENDING' || task.status === 'BLOCKED') {
        const dependenciesSatisfied = task.dependencies.every(
          (depId) => graph.tasks[depId]?.status === 'COMPLETED'
        );

        const hasFailedDependency = task.dependencies.some(
          (depId) => graph.tasks[depId]?.status === 'FAILED' || graph.tasks[depId]?.status === 'CANCELLED'
        );

        if (hasFailedDependency) {
          this.updateTaskStatus(missionId, task.id, 'CANCELLED', undefined, 'Dependency failed or cancelled');
        } else if (dependenciesSatisfied) {
          this.updateTaskStatus(missionId, task.id, 'READY');
          ready.push(task);
        }
      }
    }

    return ready;
  }

  public updateTaskStatus(
    missionId: string,
    taskId: string,
    status: TaskStatus,
    output?: any,
    error?: string
  ): Task | null {
    const graph = this.getGraph(missionId);
    if (!graph || !graph.tasks[taskId]) return null;

    const task = graph.tasks[taskId];
    const oldStatus = task.status;
    task.status = status;

    if (status === 'RUNNING' && !task.startTime) {
      task.startTime = new Date().toISOString();
    }
    if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') {
      task.endTime = new Date().toISOString();
    }
    if (output !== undefined) task.output = output;
    if (error !== undefined) task.error = error;

    this.persistTask(task);

    eventBus.emit(
      eventBus.createEvent({
        type: `task.${status.toLowerCase()}`,
        category: 'TASK',
        source: 'TaskGraphEngine',
        missionId,
        taskId: task.id,
        severity: status === 'FAILED' ? 'ERROR' : 'INFO',
        payload: { task, oldStatus },
      })
    );

    return task;
  }

  public cancelGraph(missionId: string, reason = 'Mission cancelled'): void {
    const graph = this.getGraph(missionId);
    if (!graph) return;

    for (const task of Object.values(graph.tasks)) {
      if (task.status !== 'COMPLETED' && task.status !== 'FAILED' && task.status !== 'CANCELLED') {
        this.updateTaskStatus(missionId, task.id, 'CANCELLED', undefined, reason);
      }
    }
  }

  private detectCycles(taskMap: Record<string, Task>): void {
    const visited: Record<string, boolean> = {};
    const recursionStack: Record<string, boolean> = {};

    const dfs = (taskId: string, path: string[]) => {
      visited[taskId] = true;
      recursionStack[taskId] = true;

      const task = taskMap[taskId];
      if (task) {
        for (const depId of task.dependencies) {
          if (!visited[depId]) {
            dfs(depId, [...path, taskId]);
          } else if (recursionStack[depId]) {
            const cyclePath = [...path, taskId, depId].join(' -> ');
            throw new Error(`[TaskGraphEngine] Cyclic dependency detected in task graph: ${cyclePath}`);
          }
        }
      }

      recursionStack[taskId] = false;
    };

    for (const taskId of Object.keys(taskMap)) {
      if (!visited[taskId]) {
        dfs(taskId, []);
      }
    }
  }

  private persistGraph(graph: TaskGraph): void {
    const db = getDatabase();
    const transaction = db.transaction(() => {
      for (const task of Object.values(graph.tasks)) {
        this.persistTask(task);
      }
    });
    transaction();
  }

  private persistTask(task: Task): void {
    try {
      const db = getDatabase();
      db.prepare(`
        INSERT INTO tasks (id, mission_id, parent_task_id, name, description, assigned_agent, assigned_model, status, start_time, end_time, input, output, error, artifacts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          assigned_agent = excluded.assigned_agent,
          assigned_model = excluded.assigned_model,
          start_time = excluded.start_time,
          end_time = excluded.end_time,
          output = excluded.output,
          error = excluded.error,
          artifacts = excluded.artifacts
      `).run(
        task.id,
        task.missionId,
        task.parentTaskId || null,
        task.name,
        task.description,
        task.assignedAgent || null,
        task.assignedModel || null,
        task.status,
        task.startTime || null,
        task.endTime || null,
        JSON.stringify(task.input || null),
        JSON.stringify(task.output || null),
        task.error || null,
        JSON.stringify(task.artifacts || [])
      );

      for (const depId of task.dependencies) {
        db.prepare('INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)').run(
          task.id,
          depId
        );
      }
    } catch (err) {
      console.error(`[TaskGraphEngine] Error persisting task ${task.id}:`, err);
    }
  }

  private loadGraphFromDb(missionId: string): TaskGraph | null {
    try {
      const db = getDatabase();
      const rows = db.prepare('SELECT * FROM tasks WHERE mission_id = ?').all(missionId) as any[];
      if (rows.length === 0) return null;

      const taskMap: Record<string, Task> = {};
      const rootTaskIds: string[] = [];

      for (const row of rows) {
        const depRows = db.prepare('SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?').all(row.id) as { depends_on_task_id: string }[];
        const dependencies = depRows.map((d) => d.depends_on_task_id);

        const task: Task = {
          id: row.id,
          missionId: row.mission_id,
          parentTaskId: row.parent_task_id,
          name: row.name,
          description: row.description,
          assignedAgent: row.assigned_agent,
          assignedModel: row.assigned_model,
          status: row.status as TaskStatus,
          startTime: row.start_time,
          endTime: row.end_time,
          input: row.input ? JSON.parse(row.input) : undefined,
          output: row.output ? JSON.parse(row.output) : undefined,
          error: row.error,
          artifacts: row.artifacts ? JSON.parse(row.artifacts) : [],
          dependencies,
        };
        taskMap[task.id] = task;
        if (dependencies.length === 0) rootTaskIds.push(task.id);
      }

      const graph: TaskGraph = { missionId, tasks: taskMap, rootTaskIds };
      this.graphs.set(missionId, graph);
      return graph;
    } catch (err) {
      console.error(`[TaskGraphEngine] Error loading graph for mission ${missionId}:`, err);
      return null;
    }
  }
}

export const taskGraphEngine = new TaskGraphEngine();
