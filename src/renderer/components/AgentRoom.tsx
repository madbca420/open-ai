import React, { useEffect, useState } from 'react';
import { Cpu, CheckCircle2, AlertTriangle, Loader2, Sparkles, User, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../store';

interface AgentInfo {
  id: string;
  name: string;
  role: 'DEVELOPER' | 'ARCHITECT' | 'REVIEWER';
  defaultModel: string;
  state: 'IDLE' | 'ROUTING' | 'WORKING' | 'REVIEWING' | 'SUCCESS' | 'ERROR' | 'CANCELLED';
  currentTask?: string;
}

export default function AgentRoom() {
  const { recentEvents } = useAppStore();

  const [agents, setAgents] = useState<Record<string, AgentInfo>>({
    agent_developer: {
      id: 'agent_developer',
      name: 'Developer Agent',
      role: 'DEVELOPER',
      defaultModel: 'DeepSeek V4 Flash',
      state: 'IDLE',
    },
    agent_architect: {
      id: 'agent_architect',
      name: 'Architect Agent',
      role: 'ARCHITECT',
      defaultModel: 'GLM-4.5-Air',
      state: 'IDLE',
    },
    agent_reviewer: {
      id: 'agent_reviewer',
      name: 'Code Reviewer Agent',
      role: 'REVIEWER',
      defaultModel: 'GPT-OSS 20B',
      state: 'IDLE',
    },
  });

  // Listen to canonical agent.* events from Zustand store
  useEffect(() => {
    if (!recentEvents || recentEvents.length === 0) return;
    const latest = recentEvents[0];
    if (latest && latest.category === 'AGENT') {
      const { agentId, state, role, model } = latest.payload || {};
      if (agentId && agents[agentId]) {
        setAgents((prev) => ({
          ...prev,
          [agentId]: {
            ...prev[agentId],
            state: state || 'IDLE',
            defaultModel: model || prev[agentId].defaultModel,
            currentTask: latest.taskId,
          },
        }));
      }
    }
  }, [recentEvents]);

  const getStateColor = (state: string) => {
    switch (state) {
      case 'WORKING':
      case 'ROUTING':
        return 'text-cyan-400 border-cyan-500/50 bg-cyan-950/30';
      case 'REVIEWING':
        return 'text-amber-400 border-amber-500/50 bg-amber-950/30';
      case 'SUCCESS':
        return 'text-emerald-400 border-emerald-500/50 bg-emerald-950/30';
      case 'ERROR':
      case 'CANCELLED':
        return 'text-rose-400 border-rose-500/50 bg-rose-950/30';
      default:
        return 'text-slate-400 border-slate-700 bg-black/40';
    }
  };

  return (
    <div className="glass-panel rounded-lg p-3 border border-theme-border flex flex-col space-y-3 shrink-0">
      <div className="flex items-center justify-between border-b border-theme-border pb-1.5 font-mono text-xs">
        <div className="flex items-center space-x-2">
          <Cpu className="w-4 h-4 text-theme-primary" />
          <span className="font-bold text-theme-primary tracking-wider uppercase">AI Agent Room</span>
        </div>
        <span className="text-[10px] text-theme-muted">3 AGENTS CONNECTED</span>
      </div>

      <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
        {Object.values(agents).map((agent) => (
          <div
            key={agent.id}
            className={`p-2.5 rounded-lg border flex flex-col space-y-1.5 transition-all duration-300 ${getStateColor(
              agent.state
            )}`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold tracking-wide">{agent.name}</span>
              {agent.state === 'WORKING' || agent.state === 'ROUTING' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
              ) : agent.state === 'SUCCESS' ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              ) : agent.state === 'ERROR' ? (
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
              ) : (
                <User className="w-3.5 h-3.5 opacity-50" />
              )}
            </div>

            <div className="text-[10px] opacity-80 flex justify-between">
              <span>MODEL:</span>
              <span className="font-bold">{agent.defaultModel}</span>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-white/10 text-[9px] uppercase font-bold tracking-wider">
              <span>STATUS:</span>
              <span className="px-1.5 py-0.5 rounded bg-black/40 border border-white/10">
                {agent.state}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
