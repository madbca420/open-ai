import React, { useEffect, useState } from 'react';
import { Layers, Play, StopCircle, RefreshCw, CheckCircle, XCircle, Clock, Activity, Terminal } from 'lucide-react';
import { useAppStore } from '../store';

export default function MissionBoard() {
  const { recentEvents } = useAppStore();
  const [missions, setMissions] = useState<any[]>([]);
  const [activeMission, setActiveMission] = useState<any | null>(null);
  const [taskGraph, setTaskGraph] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchMissions = async () => {
    if (!window.electronAPI?.listMissions) return;
    try {
      const list = await window.electronAPI.listMissions();
      setMissions(list || []);
      if (list && list.length > 0) {
        const latest = list[0];
        setActiveMission(latest);
        const graph = await window.electronAPI.getTaskGraph(latest.id);
        setTaskGraph(graph);
      }
    } catch (err) {
      console.error('[MissionBoard] Error fetching missions:', err);
    }
  };

  useEffect(() => {
    fetchMissions();
  }, []);

  // Refresh on canonical events
  useEffect(() => {
    if (recentEvents.length === 0) return;
    const latest = recentEvents[0];
    if (latest.category === 'MISSION' || latest.category === 'TASK') {
      fetchMissions();
    }
  }, [recentEvents]);

  const handleRunTestCommand = async (commandText: string) => {
    if (!window.electronAPI?.sendCommand) return;
    setLoading(true);
    try {
      await window.electronAPI.sendCommand({
        source: 'SYSTEM',
        text: commandText,
        workspace: 'DEVELOPMENT',
      });
      await fetchMissions();
    } catch (err) {
      console.error('[MissionBoard] Test command error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelMission = async (missionId: string) => {
    if (!window.electronAPI?.cancelMission) return;
    try {
      await window.electronAPI.cancelMission(missionId, 'Cancelled via MissionBoard HUD');
      await fetchMissions();
    } catch (err) {
      console.error('[MissionBoard] Cancel mission error:', err);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'text-emerald-400 border-emerald-500/50 bg-emerald-950/40';
      case 'RUNNING':
      case 'PLANNING':
        return 'text-cyan-400 border-cyan-500/50 bg-cyan-950/40';
      case 'FAILED':
      case 'CANCELLED':
        return 'text-rose-400 border-rose-500/50 bg-rose-950/40';
      default:
        return 'text-slate-400 border-slate-700 bg-black/40';
    }
  };

  return (
    <div className="flex-1 glass-panel rounded-lg p-3 border border-theme-border flex flex-col space-y-3 overflow-hidden font-mono text-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-theme-border pb-2 shrink-0">
        <div className="flex items-center space-x-2">
          <Layers className="w-4 h-4 text-theme-primary animate-pulse" />
          <span className="font-bold text-theme-primary tracking-wider uppercase">Mission Control Board</span>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={fetchMissions}
            className="p-1 rounded hover:bg-white/10 text-theme-muted hover:text-white"
            title="Refresh Missions"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Quick Test Execution Bar */}
      <div className="bg-black/50 rounded-lg p-2 border border-theme-border flex items-center justify-between shrink-0">
        <span className="text-[10px] text-theme-muted font-bold uppercase">Phase 3 Test Actions:</span>
        <div className="flex items-center space-x-1.5 text-[10px]">
          <button
            disabled={loading}
            onClick={() => handleRunTestCommand('test jarvis mission')}
            className="px-2 py-1 rounded bg-cyan-950/60 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-900/60 flex items-center space-x-1"
          >
            <Play className="w-3 h-3" /><span>Test Mission</span>
          </button>
          <button
            disabled={loading}
            onClick={() => handleRunTestCommand('test jarvis parallel')}
            className="px-2 py-1 rounded bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/60 flex items-center space-x-1"
          >
            <Play className="w-3 h-3" /><span>Parallel</span>
          </button>
          <button
            disabled={loading}
            onClick={() => handleRunTestCommand('test jarvis failure')}
            className="px-2 py-1 rounded bg-rose-950/60 border border-rose-500/40 text-rose-300 hover:bg-rose-900/60 flex items-center space-x-1"
          >
            <Play className="w-3 h-3" /><span>Failure</span>
          </button>
          <button
            disabled={loading}
            onClick={() => handleRunTestCommand('test jarvis cancellation')}
            className="px-2 py-1 rounded bg-amber-950/60 border border-amber-500/40 text-amber-300 hover:bg-amber-900/60 flex items-center space-x-1"
          >
            <StopCircle className="w-3 h-3" /><span>Cancel Test</span>
          </button>
        </div>
      </div>

      {/* Main Content Area: Active Mission & Task Graph */}
      <div className="flex-1 flex gap-3 overflow-hidden">
        {/* Left Sub-pane: Mission List */}
        <div className="w-1/3 glass-panel rounded p-2 border border-theme-border flex flex-col space-y-2 overflow-y-auto">
          <span className="text-[10px] text-theme-muted font-bold uppercase border-b border-theme-border/50 pb-1">
            Missions ({missions.length})
          </span>
          {missions.length === 0 ? (
            <div className="text-[10px] text-theme-muted italic p-2 text-center">No active missions</div>
          ) : (
            missions.map((m) => (
              <div
                key={m.id}
                onClick={() => {
                  setActiveMission(m);
                  window.electronAPI?.getTaskGraph(m.id).then(setTaskGraph);
                }}
                className={`p-2 rounded border cursor-pointer transition-colors text-[11px] space-y-1 ${
                  activeMission?.id === m.id
                    ? 'border-theme-primary bg-theme-primary/10'
                    : 'border-theme-border/50 bg-black/40 hover:border-theme-border'
                }`}
              >
                <div className="flex justify-between items-center font-bold text-theme-text truncate">
                  <span className="truncate">{m.name}</span>
                </div>
                <div className="flex justify-between items-center text-[9px]">
                  <span className={`px-1 rounded border ${getStatusBadge(m.status)}`}>{m.status}</span>
                  <span className="text-theme-muted">{m.progress}%</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Right Sub-pane: Selected Mission & Task Graph Visualizer */}
        <div className="flex-1 glass-panel rounded p-3 border border-theme-border flex flex-col space-y-3 overflow-y-auto">
          {activeMission ? (
            <>
              <div className="flex justify-between items-start border-b border-theme-border/50 pb-2">
                <div>
                  <h3 className="font-bold text-sm text-theme-primary">{activeMission.name}</h3>
                  <p className="text-[10px] text-theme-muted">{activeMission.description}</p>
                </div>
                {activeMission.status === 'RUNNING' && (
                  <button
                    onClick={() => handleCancelMission(activeMission.id)}
                    className="px-2 py-1 rounded bg-rose-950 border border-rose-500 text-rose-300 text-[10px] flex items-center space-x-1 hover:bg-rose-900"
                  >
                    <StopCircle className="w-3 h-3" />
                    <span>Cancel Mission</span>
                  </button>
                )}
              </div>

              {/* Progress Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-theme-muted">
                  <span>PROGRESS</span>
                  <span className="font-bold text-theme-accent">{activeMission.progress}%</span>
                </div>
                <div className="w-full bg-black/60 rounded-full h-1.5 border border-theme-border/50 overflow-hidden">
                  <div
                    className="bg-theme-primary h-full transition-all duration-300"
                    style={{ width: `${activeMission.progress}%` }}
                  />
                </div>
              </div>

              {/* Task Graph Nodes */}
              <div className="space-y-2 pt-2 border-t border-theme-border/40">
                <span className="text-[10px] font-bold text-theme-muted uppercase">Task Execution Graph:</span>
                {taskGraph && taskGraph.tasks ? (
                  <div className="space-y-1.5">
                    {Object.values(taskGraph.tasks).map((task: any) => (
                      <div
                        key={task.id}
                        className="p-2 rounded bg-black/60 border border-theme-border flex justify-between items-center text-[10px]"
                      >
                        <div className="space-y-0.5">
                          <span className="font-bold text-theme-text block">{task.name}</span>
                          <span className="text-theme-muted text-[9px]">
                            Deps: {task.dependencies?.join(', ') || 'None'}
                          </span>
                        </div>
                        <span className={`px-1.5 py-0.5 rounded border ${getStatusBadge(task.status)}`}>
                          {task.status}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[10px] text-theme-muted italic">No task graph nodes available</div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-theme-muted text-xs italic">
              Select or create a mission to view execution status
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
