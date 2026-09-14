import { Handle, Position } from '@xyflow/react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export type NodeTone = 'blue' | 'purple' | 'orange';

const TONE_STYLES: Record<NodeTone, { gradient: string; iconWrap: string; icon: string; accent: string }> = {
  blue: {
    gradient: 'from-sky-500/20 via-blue-500/20 to-indigo-500/20',
    iconWrap: 'bg-gradient-to-br from-sky-500 to-indigo-600 shadow-[0_4px_16px_rgba(14,165,233,0.35)]',
    icon: 'text-white',
    accent: 'bg-sky-500',
  },
  purple: {
    gradient: 'from-violet-500/20 via-purple-500/20 to-fuchsia-500/20',
    iconWrap: 'bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-[0_4px_16px_rgba(139,92,246,0.35)]',
    icon: 'text-white',
    accent: 'bg-violet-500',
  },
  orange: {
    gradient: 'from-amber-500/20 via-orange-500/20 to-red-500/20',
    iconWrap: 'bg-gradient-to-br from-amber-500 to-orange-600 shadow-[0_4px_16px_rgba(249,115,22,0.35)]',
    icon: 'text-white',
    accent: 'bg-orange-500',
  },
};

export const fieldInput =
  'rounded-xl bg-elevated/60 border border-white/[0.06] px-3 py-2 text-sm text-ink placeholder:text-ink3 focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20 backdrop-blur-sm transition-all';
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
}

export default function NodeShell({ title, icon: Icon, tone, selected = false, errors, configured, children }: NodeShellProps) {
  const s = TONE_STYLES[tone];
  const hasError = errors.length > 0;
  return (
    <div
      className={`w-[300px] rounded-[20px] border bg-card/90 backdrop-blur-xl shadow-card overflow-hidden transition-all duration-200 hover:shadow-[0_12px_40px_rgba(0,0,0,0.32)] hover:-translate-y-1 ${
        selected ? 'ring-2 ring-accent border-accent shadow-glow' : 'border-white/[0.08]'
      } ${hasError ? 'ring-2 ring-rose-500 border-rose-500' : ''}`}
    >
      <div className={`relative flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.06] bg-gradient-to-r ${s.gradient}`}>
        <div className={`h-9 w-9 rounded-xl grid place-items-center shrink-0 ${s.iconWrap}`}>
          <Icon size={18} className={s.icon} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-extrabold tracking-tight text-ink leading-none">{title}</p>
          <p className="text-[11px] font-semibold tracking-wide text-ink3 mt-0.5 capitalize">{tone} • transform</p>
        </div>
        <span
          title={hasError ? 'Needs attention' : configured ? 'Configured' : 'Default'}
          className={`ml-auto h-2.5 w-2.5 rounded-full shrink-0 ring-4 ${hasError ? 'bg-rose-500 ring-rose-500/20' : configured ? 'bg-emerald-500 ring-emerald-500/20' : 'bg-muted ring-white/10'}`}
        />
      </div>
      {hasError && (
        <div className="px-4 py-2 bg-rose-500/10 border-b border-rose-500/20 flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0" />
          <p className="text-xs font-semibold text-rose-500">{errors[0]}</p>
        </div>
      )}
      <div className="p-4 space-y-3 bg-gradient-to-b from-transparent to-elevated/30">{children}</div>
      <Handle type="target" position={Position.Top} className="!bg-white !border-2 !border-accent !w-3.5 !h-3.5 !-top-1.5 shadow-md" />
      <Handle type="source" position={Position.Bottom} className="!bg-white !border-2 !border-accent !w-3.5 !h-3.5 !-bottom-1.5 shadow-md" />
    </div>
  );
}
