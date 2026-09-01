import React from 'react';
import { AlertOctagon, Terminal, ShieldAlert, Check, X } from 'lucide-react';

export interface PendingToolCall {
  callId: string;
  toolName: string;
  args: Record<string, any>;
  fullCommandText: string;
}

interface ConfirmationModalProps {
  toolCall: PendingToolCall | null;
  onRespond: (allowed: boolean) => void;
}

export default function ConfirmationModal({ toolCall, onRespond }: ConfirmationModalProps) {
  if (!toolCall) return null;

  const isShellCommand = toolCall.toolName === 'run_shell_command';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn font-mono">
      <div className={`w-full max-w-xl rounded-xl glass-panel p-5 border-2 shadow-2xl space-y-4 transition-all
        ${isShellCommand ? 'border-red-500/80 shadow-[0_0_30px_rgba(239,68,68,0.4)]' : 'border-theme-primary/80 shadow-glow'}`}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-theme-border pb-3">
          <div className="flex items-center space-x-2.5">
            {isShellCommand ? (
              <AlertOctagon className="w-6 h-6 text-red-500 animate-pulse shrink-0" />
            ) : (
              <ShieldAlert className="w-6 h-6 text-amber-400 animate-pulse shrink-0" />
            )}
            <div>
              <h3 className={`text-sm font-bold tracking-wider uppercase ${isShellCommand ? 'text-red-400' : 'text-amber-400'}`}>
                {isShellCommand ? '⚠️ HIGH-RISK SHELL COMMAND CONFIRMATION' : 'AUTOMATION ACTION CONFIRMATION REQUIRED'}
              </h3>
              <p className="text-[11px] text-theme-muted">
                {isShellCommand
                  ? 'Shell commands must be explicitly confirmed. Auto-execution is locked for safety.'
                  : 'Review the exact system command before proceeding.'}
              </p>
            </div>
          </div>
        </div>

        {/* Tool Name Badge */}
        <div className="flex items-center space-x-2 text-xs">
          <span className="text-theme-muted uppercase tracking-wider">Tool:</span>
          <span className="px-2 py-0.5 rounded bg-theme-primary/20 border border-theme-primary text-theme-accent font-bold">
            {toolCall.toolName}
          </span>
        </div>

        {/* Full Command Text (Non-negotiable: full text, not a summary) */}
        <div className="space-y-1.5">
          <div className="flex items-center space-x-1.5 text-[11px] text-theme-muted uppercase tracking-wider">
            <Terminal className="w-3.5 h-3.5 text-theme-primary" />
            <span>Full Execution Details (Exact Command):</span>
          </div>
          <div className="p-3 rounded-lg bg-black/90 border border-theme-border font-mono text-xs text-emerald-400 overflow-x-auto max-h-48 leading-relaxed whitespace-pre-wrap select-text">
            {toolCall.fullCommandText}
          </div>
        </div>

        {/* Safety Warning */}
        <div className="text-[11px] text-amber-400/90 bg-amber-950/40 p-2.5 rounded border border-amber-500/30 flex items-start space-x-2">
          <span className="text-amber-400 font-bold shrink-0">NOTICE:</span>
          <span>Only allow execution if you trust the assistant's intent. Denying will safely cancel execution.</span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end space-x-3 pt-2">
          <button
            onClick={() => onRespond(false)}
            className="px-4 py-2 rounded-lg border border-red-500/50 bg-red-950/30 text-red-400 hover:bg-red-900/40 hover:border-red-500 text-xs font-bold transition-all flex items-center space-x-1.5"
          >
            <X className="w-4 h-4" />
            <span>DENY / CANCEL</span>
          </button>
          <button
            onClick={() => onRespond(true)}
            className="px-5 py-2 rounded-lg border border-emerald-500 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/60 shadow-[0_0_15px_rgba(16,185,129,0.4)] text-xs font-bold transition-all flex items-center space-x-1.5"
          >
            <Check className="w-4 h-4" />
            <span>ALLOW EXECUTION</span>
          </button>
        </div>
      </div>
    </div>
  );
}
