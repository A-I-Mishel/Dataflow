import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

import { isMissingOption, withSelected } from '../../lib/schema';
import { fieldLabelClass } from './NodeShell';

interface ColumnChecklistProps {
  label: string;
  /** Columns offered, in display order (usually the node's input schema). */
  columns: string[];
  /** Currently selected values. */
  selected: string[];
  onToggle: (column: string) => void;
  /** Rendered when nothing is selected (e.g. per-node empty-state hints). */
  emptyHint?: ReactNode;
  /**
   * Optional per-column suffix text (e.g. "8 unique values"), keyed by
   * column name. Ignored for selections missing from the schema, which
   * keep their "(missing)" flag — unknown is never given a number.
   */
  secondaryLabels?: Record<string, string>;
}

/**
 * Chip multi-select replacing native <select multiple>, where a plain click
 * replaces the whole selection and multi-pick needs an undiscoverable
 * Ctrl+Click (unavailable on touch screens entirely). Selections missing
 * from the schema are preserved and flagged rather than silently dropped.
 */
export default function ColumnChecklist({
  label,
  columns,
  selected,
  onToggle,
  emptyHint,
  secondaryLabels,
}: ColumnChecklistProps) {
  const selectedSet = new Set(selected);
  const options = withSelected(columns, selected);
  const remaining = options.filter((column) => !selectedSet.has(column));
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current?.contains(event.target as Node) !== true) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open ]);

  const secondaryFor = (column: string): string | undefined => {
    if (isMissingOption(columns, column) || secondaryLabels === undefined) return undefined;
    return secondaryLabels[column];
  };

  return (
    <div ref={rootRef}>
      <p className={fieldLabelClass}>{label}</p>
      <div className="relative">
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-elevated/60 border border-line p-1.5 min-h-[38px]">
          {options.length === 0 && (
            <span className="px-1 py-1 text-xs text-ink2">Upload a CSV to see columns</span>
          )}
          {options.length > 0 &&
            selected.length === 0 && (
              <span className="px-1 py-1 text-xs text-ink2">Pick columns…</span>
            )}
          {selected.map((column) => {
            const missing = isMissingOption(columns, column);
            return (
              <span
                key={column}
                className={`inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${
                  missing
                    ? 'bg-warnsoft border-warn/30 text-warn'
                    : 'bg-accentsoft border-accent/25 text-accenttext'
                }`}
              >
                <span className="truncate max-w-[140px]">
                  {column}
                  {missing ? ' (missing)' : ''}
                </span>
                <button
                  type="button"
                  onClick={() => onToggle(column)}
                  aria-label={`Remove ${column}`}
                  className="grid place-items-center rounded opacity-65 hover:opacity-100 shrink-0"
                >
                  <X size={10} />
                </button>
              </span>
            );
          })}
          {options.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-card px-1.5 py-0.5 text-[11px] font-semibold text-ink2 hover:text-ink hover:border-line-strong transition-colors"
            >
              + Add
            </button>
          )}
        </div>
        {open && options.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 z-30 max-h-40 overflow-y-auto nowheel nopan nodrag rounded-xl bg-panel border border-line shadow-card p-1">
            {remaining.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-ink3">All columns selected</p>
            )}
            {remaining.map((column) => {
              const secondary = secondaryFor(column);
              return (
                <button
                  key={column}
                  type="button"
                  onClick={() => onToggle(column)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-ink2 hover:bg-elevated text-left transition-colors"
                >
                  <span className="truncate">{column}</span>
                  {secondary !== undefined ? (
                    <span className="text-xs text-ink3 shrink-0">· {secondary}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {selected.length === 0 && emptyHint}
    </div>
  );
}
