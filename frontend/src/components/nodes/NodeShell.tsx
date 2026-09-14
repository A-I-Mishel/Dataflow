import { Handle, Position } from '@xyflow/react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export type NodeTone = 'blue' | 'purple' | 'orange';

const TONE_STYLES: Record<NodeTone, { header: string; icon: string }> = {
  blue: { header: 'bg-blue-500/20', icon: 'text-blue-500 dark:text-blue-400' },
  purple: { header: 'bg-purple-500/20', icon: 'text-purple-500 dark:text-purple-400' },
  orange: { header: 'bg-orange-500/20', icon: 'text-orange-500 dark:text-orange-400' },
};

/** Shared input styling for node config fields (theme-aware). */
export const fieldInput =
  'rounded-md bg-panel border border-line px-2 py-1.5 text-sm text-ink focus:outline-none focus:border-indigo-500';

/** Full-width version of fieldInput. */
export const inputClass = `w-full ${fieldInput}`;

/** Shared label styling for node config fields. */
export const fieldLabelClass = 'text-xs font-medium text-ink2 mb-1';

/** Shared muted hint text inside nodes. */
export const hintClass = 'text-xs text-ink3';

/** Shared "Remove" link-button inside nodes. */
export const removeBtnClass = 'text-xs text-ink3 hover:text-red-400';

/** Shared full-width "Add ..." button inside nodes. */
export const addBtnClass =
  'w-full rounded-md bg-btn hover:bg-btnhover px-2 py-1.5 text-xs font-medium text-btnink';

interface NodeShellProps {
  title: string;
  icon: LucideIcon;
  tone: NodeTone;
  selected?: boolean;
  errors: string[];
  /** Whether the node has meaningful (non-default) configuration. */
  configured: boolean;
  children: ReactNode;
}

export default function NodeShell({
  title,
  icon: Icon,
  tone,
  selected = false,
  errors,
  configured,
  children,
}: NodeShellProps) {
  const toneStyle = TONE_STYLES[tone];
  const hasError = errors.length > 0;
  return (
    <div
      className={`w-64 rounded-xl border bg-card shadow-lg transition-all hover:shadow-xl hover:-translate-y-0.5 ${
        selected ? 'ring-2 ring-indigo-500 border-indigo-500' : 'border-line'
      } ${hasError ? 'ring-2 ring-rose-500 border-rose-500' : ''}`}
    >
      <div
        className={`flex items-center gap-2 rounded-t-xl px-3 py-2 border-b border-line ${toneStyle.header}`}
      >
        <Icon size={16} className={`${toneStyle.icon} shrink-0`} />
        <span className="text-sm font-semibold text-ink truncate">{title}</span>
        <span
          title={hasError ? 'Needs attention' : configured ? 'Configured' : 'Default settings'}
          className={`ml-auto h-2 w-2 rounded-full shrink-0 ${
            hasError ? 'bg-rose-500' : configured ? 'bg-emerald-500' : 'bg-muted'
          }`}
        />
      </div>
      {hasError && (
        <div className="px-3 py-1.5 bg-rose-500/20 border-b border-rose-500/30">
          <p className="text-xs text-rose-500 dark:text-rose-300 font-medium">{errors[0]}</p>
        </div>
      )}
      <div className="p-3 space-y-3">{children}</div>
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-slate-400 !w-3 !h-3 !-top-1.5"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-slate-400 !w-3 !h-3 !-bottom-1.5"
      />
    </div>
  );
}
