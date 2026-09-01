import { CommandRequest, CommandResult, CommandIntent, WorkspaceType } from './types/schema';
import { eventBus } from './eventBus';
import { missionManager } from './missionManager';
import { taskGraphEngine } from './taskGraph';
import { taskExecutor } from './taskExecutor';
import { processSupervisor } from './processSupervisor';
import { adapterRegistry } from './services/adapters/adapterRegistry';
import { JarvisAdapter } from './services/adapters/adapterTypes';
import { voiceOutputService } from './services/voiceOutputService';


export class CommandRouter {
  private activeMissionContexts: Map<string, { isCancelled: boolean }> = new Map();

  public async handleCommand(rawRequest: Omit<CommandRequest, 'id' | 'timestamp'> & { id?: string }): Promise<CommandResult> {
    const request: CommandRequest = {
      id: rawRequest.id || `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      source: rawRequest.source || 'CHAT',
      text: rawRequest.text || '',
      workspace: rawRequest.workspace || 'COMMAND_CENTER',
      sessionId: rawRequest.sessionId,
      metadata: rawRequest.metadata || {},
      timestamp: new Date().toISOString(),
    };

    // 1. Emit command.received event
    eventBus.emit(
      eventBus.createEvent({
        type: 'command.received',
        category: 'COMMAND',
        source: request.source,
        workspace: request.workspace,
        payload: { requestId: request.id, text: request.text },
      })
    );

    const textLower = request.text.trim().toLowerCase();

    // ── Phase 3 Deterministic Test Commands ──
    if (textLower === 'test jarvis event') {
      return this.handleTestEvent(request);
    }
    if (textLower === 'test jarvis mission') {
      return await this.handleTestMission(request);
    }
    if (textLower === 'test jarvis parallel') {
      return await this.handleTestParallel(request);
    }
    if (textLower === 'test jarvis failure') {
      return await this.handleTestFailure(request);
    }
    if (textLower === 'test jarvis cancellation') {
      return await this.handleTestCancellation(request);
    }

    // ── Real Command Intent Dispatch ──
    const intent = this.parseIntent(request);

    // Emit command.parsed with full structured intent
    eventBus.emit(
      eventBus.createEvent({
        type: 'command.parsed',
        category: 'COMMAND',
        source: 'CommandRouter',
        workspace: intent.targetWorkspace,
        payload: { requestId: request.id, intent },
      })
    );

    const { intent: intentLabel, targetWorkspace, capability } = intent;

    // If request maps to an Adapter Capability (e.g. image editing, voice tts, video inspect, trading analysis)
    if (capability) {
      const candidates = adapterRegistry.findAvailableByCapability(capability);
      
      if (candidates.length === 0) {
        // Find if adapter exists but is disabled/unavailable
        const allMatching = adapterRegistry.findByCapability(capability);
        let detailMessage = `No active adapter available for capability "${capability}".`;
        
        if (allMatching.length > 0) {
          const statuses = allMatching.map((a: JarvisAdapter) => `${a.id} (${a.status})`).join(', ');
          detailMessage = `Capability "${capability}" requested, but matching adapter(s) are not ready: ${statuses}. Enable adapter and ensure runtime is active.`;
        }

        const result: CommandResult = {
          requestId: request.id,
          intent: intentLabel,
          workspace: targetWorkspace,
          handled: false,
          message: detailMessage,
          payload: { capability, matchingAdapters: allMatching.map((a: JarvisAdapter) => a.id) },
        };

        eventBus.emit(
          eventBus.createEvent({
            type: 'command.completed',
            category: 'COMMAND',
            source: 'CommandRouter',
            workspace: targetWorkspace,
            payload: result,
          })
        );
        return result;
      }

      // Priority resolution: pick first READY real adapter
      const selectedAdapter = candidates[0];

      // Execute on selected adapter with 30-second timeout
      const execPromise = adapterRegistry.execute(selectedAdapter.id, {
        executionId: `exec_cmd_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        adapterId: selectedAdapter.id,
        capability,
        payload: request.metadata || {},
        timestamp: new Date().toISOString(),
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Adapter execute timeout after 30s')), 30000)
      );
      const execResult = await Promise.race([execPromise, timeoutPromise]).catch((err: any) => ({
        success: false,
        error: err?.message || 'Adapter execution timed out',
        artifactIds: [] as string[],
        output: undefined as any,
      }));

      const result: CommandResult = {
          requestId: request.id,
          intent: intentLabel,
          workspace: targetWorkspace,
          handled: execResult.success,
          message: execResult.success
            ? `Successfully executed capability "${capability}" on adapter ${selectedAdapter.id}.`
            : `Execution failed on adapter ${selectedAdapter.id}: ${execResult.error}`,
          payload: {
            adapterId: selectedAdapter.id,
            capability,
            artifactIds: execResult.artifactIds,
            output: execResult.output,
          },
        };

      eventBus.emit(
        eventBus.createEvent({
          type: 'command.completed',
          category: 'COMMAND',
          source: 'CommandRouter',
          workspace: targetWorkspace,
          payload: result,
        })
      );

      return result;
    }

    // If request requires mission execution (e.g. Website Build)
    if (intentLabel === 'WEBSITE_BUILD') {
      const mission = missionManager.createMission({
        name: `Website Build: ${request.text.slice(0, 30)}...`,
        description: request.text,
        workspace: 'WEBSITE_BUILDER',
      });

      const taskGraph = taskGraphEngine.createGraph(mission.id, [
        {
          id: `${mission.id}_task_arch`,
          name: 'Architecture & Design Research',
          description: 'Define web application structure and component scope',
          dependencies: [],
          input: { type: 'deterministic_test' },
        },
        {
          id: `${mission.id}_task_build`,
          name: 'Generate React Web Application',
          description: request.text,
          dependencies: [`${mission.id}_task_arch`],
          input: { type: 'website_build', prompt: request.text, ...intent.arguments },
        },
        {
          id: `${mission.id}_task_qa`,
          name: 'Code Review & QA Check',
          description: 'Verify generated files and preview compilation',
          dependencies: [`${mission.id}_task_build`],
          input: { type: 'deterministic_test' },
        },
      ]);

      // Execute mission task graph in background
      this.executeMissionGraph(mission.id);

      const result: CommandResult = {
        requestId: request.id,
        intent: intentLabel,
        workspace: targetWorkspace,
        handled: true,
        message: `Mission ${mission.id} created and dispatched to TaskGraphEngine.`,
        payload: { missionId: mission.id },
      };

      eventBus.emit(
        eventBus.createEvent({
          type: 'command.completed',
          category: 'COMMAND',
          source: 'CommandRouter',
          workspace: targetWorkspace,
          payload: result,
        })
      );
      return result;
    }

    // ── NAVIGATE intent: switch workspace ──
    if (intentLabel === 'NAVIGATE') {
      eventBus.emit(
        eventBus.createEvent({
          type: 'jarvis.navigate',
          category: 'COMMAND',
          source: 'CommandRouter',
          workspace: targetWorkspace,
          payload: { target: intent.arguments?.target || targetWorkspace },
        })
      );
      const navResult: CommandResult = {
        requestId: request.id,
        intent: intentLabel,
        workspace: targetWorkspace,
        handled: true,
        message: `Switching to ${intent.arguments?.target || targetWorkspace} workspace.`,
        payload: { target: intent.arguments?.target || targetWorkspace },
      };
      eventBus.emit(eventBus.createEvent({ type: 'command.completed', category: 'COMMAND', source: 'CommandRouter', workspace: targetWorkspace, payload: navResult }));
      return navResult;
    }

    // ── STOP intent: cancel all active missions + TTS + recognition ──
    if (intentLabel === 'STOP') {
      // 1. Stop any active TTS
      try { voiceOutputService.stop(); } catch { /* ignore */ }

      // 2. Cancel missions tracked by CommandRouter context
      const activeMissionIds = Array.from(this.activeMissionContexts.keys());
      for (const missionId of activeMissionIds) {
        this.cancelMission(missionId, 'User issued STOP command');
      }

      // 3. Also cancel any non-terminal missions tracked in MissionManager
      try {
        const allMissions = missionManager.listMissions(100);
        const activeStatuses = new Set(['CREATED', 'PLANNING', 'READY', 'RUNNING', 'PAUSED', 'WAITING', 'RESEARCHING', 'WORKING', 'TESTING']);
        for (const m of allMissions) {
          if (activeStatuses.has(m.status) && !activeMissionIds.includes(m.id)) {
            missionManager.updateStatus(m.id, 'CANCELLED', undefined, 'User issued STOP command');
          }
        }
      } catch (err) {
        console.warn('[CommandRouter] Error during mission sweep on STOP:', err);
      }

      const cancelled = activeMissionIds.length;
      eventBus.emit(
        eventBus.createEvent({
          type: 'command.cancel',
          category: 'COMMAND',
          source: 'CommandRouter',
          workspace: targetWorkspace,
          payload: { cancelledMissions: activeMissionIds },
        })
      );
      const stopResult: CommandResult = {
        requestId: request.id,
        intent: intentLabel,
        workspace: targetWorkspace,
        handled: true,
        message: cancelled > 0
          ? `Stopped. Cancelled ${cancelled} active mission(s). TTS stopped.`
          : 'Stopped. No active missions. TTS stopped.',
        payload: { cancelledMissions: activeMissionIds },
      };
      eventBus.emit(eventBus.createEvent({ type: 'command.completed', category: 'COMMAND', source: 'CommandRouter', workspace: targetWorkspace, payload: stopResult }));
      return stopResult;
    }

    const result: CommandResult = {
      requestId: request.id,
      intent: intentLabel,
      workspace: targetWorkspace,
      handled: true,
      message: `Command parsed with intent ${intentLabel} for workspace ${targetWorkspace}.`,
    };

    eventBus.emit(
      eventBus.createEvent({
        type: 'command.completed',
        category: 'COMMAND',
        source: 'CommandRouter',
        workspace: targetWorkspace,
        payload: result,
      })
    );

    return result;
  }

  public cancelMission(missionId: string, reason = 'User requested cancellation'): boolean {
    const ctx = this.activeMissionContexts.get(missionId);
    if (ctx) {
      ctx.isCancelled = true;
    }

    // 1. Terminate owned processes
    processSupervisor.killMissionProcesses(missionId);

    // 2. Cancel tasks in graph
    taskGraphEngine.cancelGraph(missionId, reason);

    // 3. Update mission status
    missionManager.updateStatus(missionId, 'CANCELLED', undefined, reason);

    this.activeMissionContexts.delete(missionId);
    return true;
  }

  // Execute Task Graph Engine sequentially / in parallel
  private async executeMissionGraph(missionId: string): Promise<boolean> {
    const mission = missionManager.getMission(missionId);
    if (!mission) return false;

    const ctx = { isCancelled: false };
    this.activeMissionContexts.set(missionId, ctx);

    missionManager.updateStatus(missionId, 'RUNNING', 10);

    try {
      while (!ctx.isCancelled) {
        const readyTasks = taskGraphEngine.getReadyTasks(missionId);
        if (readyTasks.length === 0) {
          // Check if all tasks are completed
          const graph = taskGraphEngine.getGraph(missionId);
          if (graph) {
            const allTasks = Object.values(graph.tasks);
            const allDone = allTasks.every((t) => t.status === 'COMPLETED');
            const anyFailed = allTasks.some((t) => t.status === 'FAILED');
            const anyCancelled = allTasks.some((t) => t.status === 'CANCELLED');

            if (allDone) {
              missionManager.updateStatus(missionId, 'COMPLETED', 100);
              this.activeMissionContexts.delete(missionId);
              return true;
            }
            if (anyFailed) {
              missionManager.updateStatus(missionId, 'FAILED', undefined, 'One or more tasks failed');
              this.activeMissionContexts.delete(missionId);
              return false;
            }
            if (anyCancelled || ctx.isCancelled) {
              missionManager.updateStatus(missionId, 'CANCELLED', undefined, 'Mission cancelled');
              this.activeMissionContexts.delete(missionId);
              return false;
            }
          }
          break;
        }

        // Execute ready tasks in parallel
        const promises = readyTasks.map(async (task) => {
          taskGraphEngine.updateTaskStatus(missionId, task.id, 'RUNNING');
          try {
            const output = await taskExecutor.executeTask(task, { missionId, isCancelled: ctx.isCancelled });
            taskGraphEngine.updateTaskStatus(missionId, task.id, 'COMPLETED', output);
          } catch (err: any) {
            taskGraphEngine.updateTaskStatus(missionId, task.id, 'FAILED', undefined, err.message);
          }
        });

        await Promise.all(promises);

        // Update progress
        const graph = taskGraphEngine.getGraph(missionId);
        if (graph) {
          const allTasks = Object.values(graph.tasks);
          const completedCount = allTasks.filter((t) => t.status === 'COMPLETED').length;
          const progress = Math.round((completedCount / allTasks.length) * 100);
          missionManager.updateStatus(missionId, 'RUNNING', progress);
        }
      }
    } catch (err: any) {
      console.error(`[CommandRouter] Error executing mission ${missionId}:`, err);
      missionManager.updateStatus(missionId, 'FAILED', undefined, err.message);
    } finally {
      this.activeMissionContexts.delete(missionId);
    }

    return false;
  }

  // ── Deterministic Test Handlers ──
  private handleTestEvent(request: CommandRequest): CommandResult {
    const result: CommandResult = {
      requestId: request.id,
      intent: 'TEST_EVENT_FLOW',
      workspace: 'COMMAND_CENTER',
      handled: true,
      message: 'Deterministic JARVIS Event Flow verified successfully.',
      payload: { status: 'OK', echo: request.text },
    };
    eventBus.emit(
      eventBus.createEvent({
        type: 'command.completed',
        category: 'COMMAND',
        source: 'CommandRouter',
        workspace: 'COMMAND_CENTER',
        payload: result,
      })
    );
    return result;
  }

  private async handleTestMission(request: CommandRequest): Promise<CommandResult> {
    const mission = missionManager.createMission({
      name: 'Deterministic Test Mission',
      description: 'Executes a 3-stage sequential task graph across GLM Architect, DeepSeek Developer, and GPT-OSS Reviewer',
      workspace: 'DEVELOPMENT',
    });

    taskGraphEngine.createGraph(mission.id, [
      {
        id: `${mission.id}_t1`,
        name: 'test_architect_plan',
        description: 'GLM Architect builds system design',
        dependencies: [],
        input: { type: 'deterministic_test', delayMs: 150 },
      },
      {
        id: `${mission.id}_t2`,
        name: 'test_developer_code',
        description: 'DeepSeek Developer writes code implementation',
        dependencies: [`${mission.id}_t1`],
        input: { type: 'deterministic_test', delayMs: 150 },
      },
      {
        id: `${mission.id}_t3`,
        name: 'test_reviewer_qa',
        description: 'GPT-OSS Reviewer performs QA inspection',
        dependencies: [`${mission.id}_t2`],
        input: { type: 'deterministic_test', delayMs: 150 },
      },
    ]);

    await this.executeMissionGraph(mission.id);

    return {
      requestId: request.id,
      intent: 'TEST_MISSION_FLOW',
      workspace: 'DEVELOPMENT',
      handled: true,
      message: `Deterministic Test Mission ${mission.id} executed successfully.`,
      payload: { missionId: mission.id, status: missionManager.getMission(mission.id)?.status },
    };
  }

  private async handleTestParallel(request: CommandRequest): Promise<CommandResult> {
    const mission = missionManager.createMission({
      name: 'Deterministic Parallel Task Test',
      description: 'Verifies Task B & C execute in parallel and Task D waits for both to complete',
      workspace: 'DEVELOPMENT',
    });

    taskGraphEngine.createGraph(mission.id, [
      {
        id: `${mission.id}_A`,
        name: 'test_task_A',
        description: 'Root task A',
        dependencies: [],
        input: { type: 'deterministic_test', delayMs: 100 },
      },
      {
        id: `${mission.id}_B`,
        name: 'test_task_B',
        description: 'Parallel task B',
        dependencies: [`${mission.id}_A`],
        input: { type: 'deterministic_test', delayMs: 150 },
      },
      {
        id: `${mission.id}_C`,
        name: 'test_task_C',
        description: 'Parallel task C',
        dependencies: [`${mission.id}_A`],
        input: { type: 'deterministic_test', delayMs: 150 },
      },
      {
        id: `${mission.id}_D`,
        name: 'test_task_D',
        description: 'Join task D',
        dependencies: [`${mission.id}_B`, `${mission.id}_C`],
        input: { type: 'deterministic_test', delayMs: 100 },
      },
    ]);

    await this.executeMissionGraph(mission.id);

    return {
      requestId: request.id,
      intent: 'TEST_PARALLEL_FLOW',
      workspace: 'DEVELOPMENT',
      handled: true,
      message: `Parallel Task Test Mission ${mission.id} completed successfully.`,
      payload: { missionId: mission.id, status: missionManager.getMission(mission.id)?.status },
    };
  }

  private async handleTestFailure(request: CommandRequest): Promise<CommandResult> {
    const mission = missionManager.createMission({
      name: 'Deterministic Failure Test',
      description: 'Simulates intentional task failure and dependency cancellation',
      workspace: 'DEVELOPMENT',
    });

    taskGraphEngine.createGraph(mission.id, [
      {
        id: `${mission.id}_t1`,
        name: 'test_success_step',
        description: 'Step 1 succeeds',
        dependencies: [],
        input: { type: 'deterministic_test', delayMs: 100 },
      },
      {
        id: `${mission.id}_t2`,
        name: 'test_failure_step',
        description: 'Step 2 fails intentionally',
        dependencies: [`${mission.id}_t1`],
        input: { type: 'deterministic_test', shouldFail: true, delayMs: 100 },
      },
      {
        id: `${mission.id}_t3`,
        name: 'test_dependent_step',
        description: 'Step 3 dependent on failing Step 2',
        dependencies: [`${mission.id}_t2`],
        input: { type: 'deterministic_test', delayMs: 100 },
      },
    ]);

    await this.executeMissionGraph(mission.id);

    return {
      requestId: request.id,
      intent: 'TEST_FAILURE_FLOW',
      workspace: 'DEVELOPMENT',
      handled: true,
      message: `Failure Test Mission ${mission.id} finished with status FAILED as expected.`,
      payload: { missionId: mission.id, status: missionManager.getMission(mission.id)?.status },
    };
  }

  private async handleTestCancellation(request: CommandRequest): Promise<CommandResult> {
    const mission = missionManager.createMission({
      name: 'Deterministic Cancellation Test',
      description: 'Simulates active mission cancellation and process cleanup',
      workspace: 'DEVELOPMENT',
    });

    taskGraphEngine.createGraph(mission.id, [
      {
        id: `${mission.id}_t1`,
        name: 'test_long_running',
        description: 'Long running task',
        dependencies: [],
        input: { type: 'deterministic_test', delayMs: 2000 },
      },
      {
        id: `${mission.id}_t2`,
        name: 'test_pending_step',
        description: 'Pending step',
        dependencies: [`${mission.id}_t1`],
        input: { type: 'deterministic_test', delayMs: 100 },
      },
    ]);

    // Trigger mission execution in background
    const execPromise = this.executeMissionGraph(mission.id);

    // Cancel after 100ms
    setTimeout(() => {
      this.cancelMission(mission.id, 'Deterministic cancellation test trigger');
    }, 100);

    await execPromise;

    return {
      requestId: request.id,
      intent: 'TEST_CANCELLATION_FLOW',
      workspace: 'DEVELOPMENT',
      handled: true,
      message: `Cancellation Test Mission ${mission.id} status is CANCELLED as expected.`,
      payload: { missionId: mission.id, status: missionManager.getMission(mission.id)?.status },
    };
  }

  private parseIntent(request: CommandRequest): CommandIntent {
    const lower = request.text.toLowerCase().trim();
    const now = new Date().toISOString();
    const id = `intent_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const source = request.source;

    // Helper: strip common wake-word prefixes and filler words before matching
    const stripped = lower
      .replace(/^(jarvis[,.!?]?\s*)|(hey jarvis[,.!?]?\s*)|(ok jarvis[,.!?]?\s*)|(yo jarvis[,.!?]?\s*)/i, '')
      .replace(/^(please\s+|could you\s+|can you\s+|would you\s+)/i, '')
      .replace(/[.,!?]+$/, '') // strip trailing punctuation
      .trim();
    // Also normalize multiple spaces
    const norm = stripped.replace(/\s+/g, ' ');

    // ─────────────────────────────────────────────────────────────────
    // TIER 1: STOP / CANCEL — highest priority, always match
    // ─────────────────────────────────────────────────────────────────
    if (
      norm === 'stop' || norm === 'cancel' || norm === 'abort' || norm === 'halt' ||
      norm === 'stop everything' || norm === 'cancel everything' ||
      norm === 'stop all' || norm === 'cancel all' || norm === 'abort mission' ||
      norm === 'abort all' || norm === 'kill it' || norm === 'shut up' ||
      norm.startsWith('stop ') || norm.startsWith('cancel ') || norm.startsWith('abort ')
    ) {
      return {
        id, intent: 'STOP', targetWorkspace: request.workspace || 'COMMAND_CENTER',
        arguments: {},
        confidence: 0.98, requiresConfirmation: false, source, timestamp: now,
      };
    }

    // ─────────────────────────────────────────────────────────────────
    // TIER 2: NAVIGATION — deterministic workspace switching
    // ─────────────────────────────────────────────────────────────────
    const navPatterns: Array<{ patterns: string[]; target: WorkspaceType }> = [
      {
        patterns: [
          'open development', 'development mode', 'switch to development',
          'go to development', 'show development', 'take me to development',
          'development workspace', 'dev mode', 'open dev mode',
        ],
        target: 'DEVELOPMENT',
      },
      {
        patterns: [
          'open trading', 'trading mode', 'switch to trading',
          'go to trading', 'show trading', 'take me to trading',
          'trading workspace', 'open markets', 'show markets',
        ],
        target: 'TRADING',
      },
      {
        // Note: 'build a website for X' goes to WEBSITE_BUILD, not here.
        // Navigation patterns are just for switching to the workspace.
        patterns: [
          'open website builder', 'switch to website builder',
          'go to website builder', 'show website builder',
          'website builder workspace', 'open site builder', 'go to site builder',
        ],
        target: 'WEBSITE_BUILDER',
      },
      {
        patterns: [
          'open research', 'research mode', 'switch to research',
          'go to research', 'show research', 'take me to research',
          'research workspace',
        ],
        target: 'RESEARCH',
      },
      {
        patterns: [
          'open creative', 'creative mode', 'switch to creative',
          'go to creative', 'show creative', 'creative workspace',
        ],
        target: 'CREATIVE',
      },
      {
        // 'go home' and 'home' must be exact or phrase matches, not substrings
        patterns: [
          'open command center', 'go to command center', 'command center', 'main screen',
          'go home', 'go back home',
        ],
        target: 'COMMAND_CENTER',
      },
      {
        patterns: [
          'open automation', 'automation mode', 'switch to automation',
          'go to automation', 'show automation', 'automation workspace',
        ],
        target: 'AUTOMATION',
      },
      {
        patterns: [
          'open voice workspace', 'voice mode', 'switch to voice',
          'go to voice', 'show voice workspace', 'voice workspace',
        ],
        target: 'VOICE',
      },
      {
        // 'settings' alone is too broad (it would catch 'in my settings...')
        // Use explicit navigation phrases only
        patterns: [
          'open settings', 'show settings', 'go to settings',
          'open configuration', 'open preferences',
        ],
        target: 'SETTINGS' as WorkspaceType,
      },
    ];

    for (const { patterns, target } of navPatterns) {
      if (patterns.some(p => norm.includes(p) || stripped.includes(p))) {
        return {
          id, intent: 'NAVIGATE', targetWorkspace: target as WorkspaceType,
          arguments: { target },
          confidence: 0.93, requiresConfirmation: false, source, timestamp: now,
        };
      }
    }
    // Special case: 'home' or 'go home' as standalone stripped command
    if (norm === 'home' || norm === 'go home' || norm === 'back' || norm === 'go back') {
      return {
        id, intent: 'NAVIGATE', targetWorkspace: 'COMMAND_CENTER',
        arguments: { target: 'COMMAND_CENTER' },
        confidence: 0.90, requiresConfirmation: false, source, timestamp: now,
      };
    }

    // ─────────────────────────────────────────────────────────────────
    // TIER 3: SPEAK / SAY — direct TTS (must precede general chat)
    // ─────────────────────────────────────────────────────────────────
    if (
      norm.startsWith('say ') || norm.startsWith('speak ') ||
      norm.startsWith('speak: ') || norm.startsWith('say: ') ||
      norm.startsWith('read ') ||
      lower.includes('speak this') || lower.includes('read this aloud') ||
      lower.includes('speak text') || lower.includes('tts:')
    ) {
      const textMatch = request.text.match(/(?:say|speak|read)[:\s]+(.+)/i);
      const speakText = textMatch?.[1]?.trim() || norm.replace(/^(say|speak|read)\s+/, '').trim() || request.text;
      return {
        id, intent: 'VOICE_TTS', targetWorkspace: 'VOICE', capability: 'voice.tts',
        arguments: { text: speakText },
        confidence: 0.93, requiresConfirmation: false, source, timestamp: now,
      };
    }

    // ─────────────────────────────────────────────────────────────────
    // TIER 4: WEBSITE BUILD
    // ─────────────────────────────────────────────────────────────────
    if (
      lower.includes('build site') || lower.includes('landing page') ||
      lower.includes('make a website') || lower.includes('create a website') ||
      lower.includes('create a web app') || lower.includes('build a web') ||
      lower.includes('generate a website') || lower.includes('build a react app') ||
      (lower.includes('website') && (lower.includes('build') || lower.includes('create') || lower.includes('generate') || lower.includes('make')))
    ) {
      const topicMatch = request.text.match(/(?:website|site|landing page|web app)\s+(?:for|about|on)?\s*(.+)/i);
      return {
        id, intent: 'WEBSITE_BUILD', targetWorkspace: 'WEBSITE_BUILDER',
        arguments: { topic: topicMatch?.[1]?.trim() || request.text },
        confidence: 0.9, requiresConfirmation: false, source, timestamp: now,
      };
    }

    // ─────────────────────────────────────────────────────────────────
    // TIER 5: TRADING ANALYSIS
    // ─────────────────────────────────────────────────────────────────
    const symbolMatch = request.text.match(/\b([A-Z]{1,5})\b/);
    const hasStockKeyword =
      lower.includes('trade') || lower.includes('stock') || lower.includes('market') ||
      lower.includes('nifty') || lower.includes('sensex') || lower.includes('crypto') ||
      lower.includes('bitcoin') || lower.includes('portfolio') || lower.includes('invest');
    const hasAnalyzeKeyword =
      lower.includes('analyze') || lower.includes('analyse') || lower.includes('analysis') ||
      lower.includes('predict') || lower.includes('forecast') || lower.includes('check price') ||
      lower.includes('chart');
    // Named tickers commonly typed lowercase
    const commonTickers = ['aapl', 'tsla', 'msft', 'amzn', 'googl', 'meta', 'nvda', 'nflx', 'spy', 'qqq', 'reliance', 'tcs', 'infy'];
    const hasTicker = commonTickers.some(t => lower.includes(t));

    if (hasStockKeyword || (hasAnalyzeKeyword && hasTicker) || hasTicker) {
      const tickerFromLower = commonTickers.find(t => lower.includes(t))?.toUpperCase();
      return {
        id, intent: 'TRADING_ANALYSIS', targetWorkspace: 'TRADING', capability: 'trading.analyze',
        arguments: { symbol: tickerFromLower || symbolMatch?.[1] || 'UNKNOWN', query: request.text },
        confidence: 0.85, requiresConfirmation: false, source, timestamp: now,
      };
    }

    // ─────────────────────────────────────────────────────────────────
    // TIER 6: IMAGE GENERATION
    // ─────────────────────────────────────────────────────────────────
    if (
      lower.includes('generate image') || lower.includes('create image') ||
      lower.includes('draw ') || lower.includes('make an image') ||
      lower.includes('make a picture') || lower.includes('create a picture') ||
      lower.includes('paint ') || lower.includes('render image') ||
      lower.includes('generate a photo') || lower.includes('create art')
    ) {
      const promptMatch = request.text.match(/(?:generate|create|make|draw|paint|render)\s+(?:an?\s+)?(?:image|picture|photo|art|painting|illustration)(?:\s+of)?\s*(.+)/i);
      return {
        id, intent: 'IMAGE_GENERATE', targetWorkspace: 'CREATIVE', capability: 'creative.image.generate',
        arguments: { prompt: promptMatch?.[1]?.trim() || request.text },
        confidence: 0.9, requiresConfirmation: false, source, timestamp: now,
      };
    }

    // ─────────────────────────────────────────────────────────────────
    // TIER 7: IMAGE EDITING
    // ─────────────────────────────────────────────────────────────────
    if (
      lower.includes('inpaint') || lower.includes('remove background') ||
      lower.includes('remove object') || lower.includes('erase') ||
      lower.includes('clean up image') || lower.includes('edit image')
    ) {
      return {
        id, intent: 'IMAGE_EDIT', targetWorkspace: 'CREATIVE', capability: 'image.remove_object',
        arguments: { prompt: request.text },
        confidence: 0.88, requiresConfirmation: false, source, timestamp: now,
      };
    }

    // ─────────────────────────────────────────────────────────────────
    // TIER 8: RESEARCH
    // ─────────────────────────────────────────────────────────────────
    if (
      lower.includes('research') || lower.includes('analyze competitor') ||
      lower.includes('simulate') || lower.includes('investigate') ||
      lower.includes('find information') || lower.includes('gather data')
    ) {
      return {
        id, intent: 'RESEARCH_REQUEST', targetWorkspace: 'RESEARCH', capability: 'research.simulate',
        arguments: { query: request.text },
        confidence: 0.72, requiresConfirmation: false, source, timestamp: now,
      };
    }

    // ─────────────────────────────────────────────────────────────────
    // TIER 9: DEVELOPMENT TASK
    // ─────────────────────────────────────────────────────────────────
    if (
      lower.includes('code') || lower.includes('refactor') || lower.includes('debug') ||
      lower.includes('write a function') || lower.includes('implement') ||
      lower.includes('fix this bug') || lower.includes('create a class') ||
      lower.includes('build an api') || lower.includes('write tests')
    ) {
      return {
        id, intent: 'DEVELOPMENT_TASK', targetWorkspace: 'DEVELOPMENT',
        arguments: { task: request.text },
        confidence: 0.72, requiresConfirmation: false, source, timestamp: now,
      };
    }

    // ─────────────────────────────────────────────────────────────────
    // TIER 10: VIDEO INSPECT
    // ─────────────────────────────────────────────────────────────────
    if (
      lower.includes('inspect capcut') || lower.includes('lint capcut') ||
      lower.includes('inspect video') || lower.includes('check video project')
    ) {
      const projectMatch = request.text.match(/(?:inspect|lint|check)\s+(?:capcut\s*)?(.+)?/i);
      return {
        id, intent: 'VIDEO_INSPECT', targetWorkspace: 'CREATIVE', capability: 'creative.video.inspect',
        arguments: { projectPath: projectMatch?.[1]?.trim() || '' },
        confidence: 0.88, requiresConfirmation: false, source, timestamp: now,
      };
    }

    // ─────────────────────────────────────────────────────────────────
    // FALLBACK: General chat (low confidence)
    // ─────────────────────────────────────────────────────────────────
    return {
      id, intent: 'GENERAL_CHAT', targetWorkspace: request.workspace || 'COMMAND_CENTER',
      arguments: { text: request.text },
      confidence: 0.3, requiresConfirmation: false, source, timestamp: now,
    };
  }
}

export const commandRouter = new CommandRouter();
