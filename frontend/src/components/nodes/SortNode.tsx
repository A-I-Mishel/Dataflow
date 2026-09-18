import type { NodeProps } from "@xyflow/react";
import { ArrowUpDown } from "lucide-react";
import type { ChangeEvent } from "react";
import { useMemo } from "react";

import { useNodeColumns } from "../../lib/schema";
import { getNodeErrors } from "../../lib/validatePipeline";
import { usePipelineStore } from "../../stores/pipelineStore";
import type { NodeConfig } from "../../types";
import ColumnChecklist from "./ColumnChecklist";
import NodeShell from "./NodeShell";

export default function SortNode({ id, data, selected }: NodeProps) {
  const updateNodeConfig = usePipelineStore((state) => state.updateNodeConfig);
  const columnList = usePipelineStore((state) => state.columnList);
  const label = typeof data.label === "string" ? data.label : "Sort";
  // Memoized so downstream useMemo deps see a stable reference instead of a
  // fresh `{}` on every render when no config exists yet.
  const config = useMemo(() => (data.config ?? {}) as NodeConfig, [data.config]);
  const schemaCols = useNodeColumns(id);
  const errors = useMemo(
    () =>
      getNodeErrors(
        { id, type: "sort", position: { x: 0, y: 0 }, data: { label, config } },
        columnList,
        schemaCols,
      ),
    [id, label, config, columnList, schemaCols],
  );
  const by = config.by ?? [];
  const ascending = config.ascending !== false;

  const handleToggleColumn = (column: string): void => {
    const next = by.includes(column) ? by.filter((c) => c !== column) : [...by, column];
    const selected = new Set(next);
    // Preserve schema order so sort priority still follows list order,
    // exactly as the native multi-select did.
    updateNodeConfig(id, {
      by: [
        ...schemaCols.filter((c) => selected.has(c)),
        ...next.filter((c) => !schemaCols.includes(c)),
      ],
    });
  };

  const handleAscendingChange = (event: ChangeEvent<HTMLInputElement>): void => {
    updateNodeConfig(id, { ascending: event.target.checked });
  };

  return (
    <NodeShell
      nodeId={id}
      title={label}
      icon={ArrowUpDown}
      tone="purple"
      selected={selected}
      errors={errors}
      configured={by.length > 0 || !ascending}
    >
      <ColumnChecklist
        label="Sort by"
        columns={schemaCols}
        selected={by}
        onToggle={handleToggleColumn}
        emptyHint={<p className="mt-1 text-xs text-danger">Select at least one column</p>}
      />
      <label className="flex items-center gap-2 text-xs font-medium text-ink2">
        <input type="checkbox" checked={ascending} onChange={handleAscendingChange} />
        Ascending
      </label>
    </NodeShell>
  );
}
