import type { ReactNode } from 'react';

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
}

/**
 * Checkbox list replacing native <select multiple>, where a plain click
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
}: ColumnChecklistProps) {
  const selectedSet = new Set(selected);
  const options = withSelected(columns, selected);
  return (
    <div>
      <p className={fieldLabelClass}>{label}</p>
      <div className="max-h-24 overflow-y-auto rounded-xl bg-elevated/60 border border-line p-1 custom-scroll">
        {options.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-ink3">Upload a CSV to see columns</p>
        )}
        {options.map((column) => (
          <label
            key={column}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-ink2 hover:bg-elevated cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selectedSet.has(column)}
              onChange={() => onToggle(column)}
              className="h-3.5 w-3.5 shrink-0 accent-accent"
            />
            <span className="truncate">
              {column}
              {isMissingOption(columns, column) ? ' (missing)' : ''}
            </span>
          </label>
        ))}
      </div>
      {selected.length === 0 && emptyHint}
    </div>
  );
}
