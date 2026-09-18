import { Handle, Position } from "@xyflow/react";
import { Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { usePipelineStore } from "../../stores/pipelineStore";

export type NodeTone = "blue" | "purple" | "orange";

const TONE_STYLES: Record<NodeTone, { dot: string; iconBox: string; icon: string }> = {
  blue: {
    dot: "bg-sky-500",
    iconBox: "bg-elevated border border-line",
    icon: "text-sky-500",
  },
  purple: {
    dot: "bg-violet-500",
    iconBox: "bg-elevated border border-line",
    icon: "text-violet-500",
  },
  orange: {
    dot: "bg-orange-500",
    iconBox: "bg-elevated border border-line",
    icon: "text-orange-500",
  },
};

export const fieldInput =
  "rounded-xl bg-elevated/60 border border-line px-3 py-2 text-sm text-ink placeholder:text-ink2 focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20 backdrop-blur-sm transition-all";
export const inputClass = `w-full ${fieldInput}`;
export const fieldLabelClass = "text-[11px] font-bold tracking-widest uppercase text-ink3 mb-1.5";
export const hintClass = "text-xs text-ink3";
export const removeBtnClass = "text-xs font-medium text-ink3 hover:text-red-400 transition-colors";
export const addBtnClass =
  "w-full rounded-xl bg-card border border-line hover:border-accent/30 hover:bg-elevated px-3 py-2 text-xs font-bold text-ink2 hover:text-ink transition-all";

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

export default function NodeShell({
  title,
  icon: Icon,
  tone,
  selected = false,
  errors,
  configured,
  children,
  nodeId,
}: NodeShellProps) {
  const s = TONE_STYLES[tone];
  const hasError = errors.length > 0;
  // Honest run states only: set for all nodes together on run settle.
  const runStatus = usePipelineStore((state) =>
    nodeId !== undefined ? state.nodeStatus[nodeId] : undefined,
  );
  const runFailed = runStatus === "error";
  return (
    <div
      className={`w-[300px] cursor-default overflow-visible rounded-[20px] border bg-card/90 shadow-card backdrop-blur-xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.22)] ${
        selected ? "border-accent/50 shadow-glow ring-2 ring-accent/70" : "border-line"
      } ${hasError || runFailed ? "border-rose-500 ring-2 ring-rose-500" : ""}`}
    >
      <div className="overflow-hidden rounded-[20px]">
        <div className="node-drag-handle relative flex cursor-grab select-none items-center gap-2.5 border-b border-linesoft px-3.5 py-2.5 active:cursor-grabbing">
          <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${s.iconBox}`}>
            <Icon size={16} className={s.icon} />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-bold leading-none tracking-tight text-ink">{title}</p>
            <p className="mt-1 flex items-center gap-1.5 text-[11px] font-medium capitalize leading-none tracking-wide text-ink3">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} />
              {tone} • transform
            </p>
          </div>
          {runStatus === "running" && (
            <Loader2 size={14} className="text-accenttext ml-auto shrink-0 animate-spin" />
          )}
          {runStatus === "done" && (
            <span
              title="Ran successfully"
              className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20"
            />
          )}
          {runStatus === "error" && (
            <span
              title="Run failed"
              className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full bg-rose-500 ring-4 ring-rose-500/20"
            />
          )}
          {runStatus === undefined && (
            <span
              title={hasError ? "Needs attention" : configured ? "Configured" : "Default"}
              className={`ml-auto h-2.5 w-2.5 shrink-0 rounded-full ring-4 ${hasError ? "bg-rose-500 ring-rose-500/20" : configured ? "bg-emerald-500 ring-emerald-500/20" : "bg-muted ring-ink3/20"}`}
            />
          )}
        </div>
        {hasError && (
          <div className="space-y-1 border-b border-rose-500/20 bg-rose-500/10 px-4 py-2">
            {errors.slice(0, 3).map((error) => (
              <div key={error} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
                <p className="text-xs font-semibold text-rose-500">{error}</p>
              </div>
            ))}
            {errors.length > 3 && (
              <p className="pl-3.5 text-[11px] font-semibold text-rose-500/80">
                +{errors.length - 3} more — fix these first
              </p>
            )}
          </div>
        )}
        <div className="nowheel nopan nodrag node-scroll max-h-[280px] cursor-default space-y-2.5 overflow-y-auto p-3.5">
          {children}
        </div>
      </div>
      <Handle
        type="target"
        position={Position.Top}
        className="!-top-2 !h-4 !w-4 !border-[2.5px] !border-accent !bg-panel shadow-md hover:!bg-accent/20"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!-bottom-2 !h-4 !w-4 !border-[2.5px] !border-accent !bg-panel shadow-md hover:!bg-accent/20"
      />
    </div>
  );
}
