import React from 'react';
import { GitCompare, Check, X, FileCode } from 'lucide-react';
import { DiffResult } from '../../main/preload';

interface DiffModalProps {
  diffResult: DiffResult | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DiffModal({ diffResult, onConfirm, onCancel }: DiffModalProps) {
  if (!diffResult) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md font-mono animate-fadeIn">
      <div className="w-full max-w-3xl rounded-xl glass-panel p-5 border-2 border-theme-primary/80 shadow-glow space-y-4 max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-theme-border pb-3 shrink-0">
          <div className="flex items-center space-x-2.5">
            <GitCompare className="w-6 h-6 text-theme-primary animate-pulse shrink-0" />
            <div>
              <h3 className="text-sm font-bold tracking-wider text-theme-primary uppercase">
                REVIEW CODE CHANGES (DIFF VIEW)
              </h3>
              <p className="text-[11px] text-theme-muted">
                Review proposed file modifications before overwriting.
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2 text-xs">
            <span className="text-emerald-400 font-bold">+{diffResult.additions}</span>
            <span className="text-rose-400 font-bold">-{diffResult.deletions}</span>
          </div>
        </div>

        {/* File Path */}
        <div className="flex items-center space-x-2 text-xs shrink-0">
          <FileCode className="w-4 h-4 text-theme-accent" />
          <span className="text-theme-text font-bold">{diffResult.filePath}</span>
        </div>

        {/* Diff Code Container */}
        <div className="flex-1 overflow-y-auto bg-black/90 border border-theme-border rounded-lg p-3 font-mono text-xs leading-relaxed space-y-0.5 max-h-[400px]">
          {diffResult.lines.map((line, idx) => (
            <div
              key={idx}
              className={`flex items-start px-2 py-0.5 rounded whitespace-pre-wrap
                ${line.type === 'add'
                  ? 'bg-emerald-950/40 text-emerald-300 border-l-2 border-emerald-500'
                  : line.type === 'delete'
                    ? 'bg-rose-950/40 text-rose-300 border-l-2 border-rose-500 line-through opacity-70'
                    : 'text-theme-muted'}`}
            >
              <span className="w-8 shrink-0 text-[10px] text-theme-muted/50 select-none">
                {line.lineNumberNew || line.lineNumberOld || ''}
              </span>
              <span className="w-4 shrink-0 font-bold select-none">
                {line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' '}
              </span>
              <span className="flex-1">{line.content}</span>
            </div>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end space-x-3 pt-2 shrink-0 border-t border-theme-border">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-red-500/40 bg-red-950/30 text-red-400 hover:bg-red-900/40 text-xs font-bold transition-all flex items-center space-x-1.5"
          >
            <X className="w-4 h-4" />
            <span>DISCARD CHANGES</span>
          </button>
          <button
            onClick={onConfirm}
            className="px-5 py-2 rounded-lg border border-emerald-500 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/60 shadow-[0_0_15px_rgba(16,185,129,0.4)] text-xs font-bold transition-all flex items-center space-x-1.5"
          >
            <Check className="w-4 h-4" />
            <span>CONFIRM & APPLY CHANGES</span>
          </button>
        </div>
      </div>
    </div>
  );
}
