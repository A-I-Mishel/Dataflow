import { Handle, Position } from '@xyflow/react';
import { Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { usePipelineStore } from '../../stores/pipelineStore';

export type NodeTone = 'blue' | 'purple' | 'orange';

const TONE_STYLES: Record<NodeTone, { dot: string; iconBox: string; icon: string }> = {
  blue: {
    dot: 'bg-sky-500',
    iconBox: 'bg-elevated border border-line',
    icon: 'text-sky-500',
  },
  purple: {
    dot: 'bg-violet-500',
    iconBox: 'bg-elevated border border-line',
    icon: 'text-violet-500',
  },
  orange: {
    dot: 'bg-orange-500',
    iconBox: 'bg-elevated border border-line',
    icon: 'text-orange-500',
  },
};

export const fieldInput =
  'rounded-xl bg-elevated/60 border border-line px-3 py-2 text-sm text-ink placeholder:text-ink2 focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20 backdrop-blur-sm transition-all';
export const inputClass = `w-full ${fieldInput}`;
export const fieldLabelClass = 'text-[11px] font-bold tracking-widest uppercase text-ink3 mb-1.5';
export const hintClass = 'text-xs text-ink3';
export const removeBtnClass = 'text-xs font-medium text-ink3 hover:text-red-400 transition-colors';
export const addBtnClass =
  'w-full rounded-xl bg-card border border-line hover:border-accent/30 hover:bg-elevated px-3 py-2 text-xs font-bold text-ink2 hover:text-ink transition-all';

interface NodeShellProps {
  title: string;
  icon: LucideIcon;
  tone: NodeTone;
  selected?: boolean;
  errors: string[];
  configured: boolean;
  children: ReactNode;
  nodeId?: string;
}

export default function NodeShell({ title, icon: Icon, tone, selected = false, errors, configured, children, nodeId }: NodeShellProps) {
  const s = TONE_STYLES[tone];
  const hasError = errors.length > 0;
  // Honest run states only: set for all nodes together on run settle.
  const runStatus = usePipelineStore((state) =>
    nodeId !== undefined ? state.nodeStatus[nodeId] : undefined,
  );
  const runFailed = runStatus === 'error';
  return (
    <div
      className={`w-[300px] rounded-[20px] border bg-card/90 backdrop-blur-xl shadow-card overflow-visible transition-all duration-200 hover:shadow-[0_8px_24px_rgba(0,0,0,0.22)] hover:-translate-y-0.5 cursor-default ${
        selected ? 'ring-2 ring-accent/70 border-accent/50 shadow-glow' : 'border-line'
      } ${hasError || runFailed ? 'ring-2 ring-rose-500 border-rose-500' : ''}`}
    >
      <div className="rounded-[20px] overflow-hidden">
        <div className="node-drag-handle relative flex items-center gap-2.5 px-3.5 py-2.5 border-b border-linesoft cursor-grab active:cursor-grabbing select-none">
          <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${s.iconBox}`}>
            <Icon size={16} className={s.icon} />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-bold tracking-tight text-ink leading-none">{title}</p>
            <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-ink3 mt-1 leading-none capitalize">
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${s.dot}`} />
              {tone} • transform
            </p>
          </div>
          {runStatus === 'running' && (
            <Loader2 size={14} className="ml-auto animate-spin text-accenttext shrink-0" />
          )}
          {runStatus === 'done' && (
            <span
              title="Ran successfully"
              className="ml-auto h-2.5 w-2.5 rounded-full shrink-0 ring-4 bg-emerald-500 ring-emerald-500/20"
            />
          )}
          {runStatus === 'error' && (
            <span
              title="Run failed"
              className="ml-auto h-2.5 w-2.5 rounded-full shrink-0 ring-4 bg-rose-500 ring-rose-500/20"
            />
          )}
          {runStatus === undefined && (
            <span
              title={hasError ? 'Needs attention' : configured ? 'Configured' : 'Default'}
              className={`ml-auto h-2.5 w-2.5 rounded-full shrink-0 ring-4 ${hasError ? 'bg-rose-500 ring-rose-500/20' : configured ? 'bg-emerald-500 ring-emerald-500/20' : 'bg-muted ring-ink3/20'}`}
            />
          )}
        </div>
        {hasError && (
          <div className="px-4 py-2 bg-rose-500/10 border-b border-rose-500/20 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0" />
            <p className="text-xs font-semibold text-rose-500">{errors[0]}</p>
          </div>
        )}
        <div className="p-3.5 space-y-2.5 max-h-[280px] overflow-y-auto nowheel nopan nodrag node-scroll cursor-default">{children}</div>
      </div>
      <Handle type="target" position={Position.Top} className="!bg-panel !border-[2.5px] !border-accent !w-4 !h-4 !-top-2 shadow-md hover:!bg-accent/20" />
      <Handle type="source" position={Position.Bottom} className="!bg-panel !border-[2.5px] !border-accent !w-4 !h-4 !-bottom-2 shadow-md hover:!bg-accent/20" />
    </div>
  );
}
