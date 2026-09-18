import type { NodeProps } from "@xyflow/react";
import { Copy } from "lucide-react";
import { useMemo } from "react";

import { useNodeColumns } from "../../lib/schema";
import { getNodeErrors } from "../../lib/validatePipeline";
import { usePipelineStore } from "../../stores/pipelineStore";
import type { NodeConfig } from "../../types";
import ColumnChecklist from "./ColumnChecklist";
import NodeShell, { hintClass } from "./NodeShell";

export default function DropDuplicatesNode({ id, data, selected }: NodeProps) {
  const updateNodeConfig = usePipelineStore((state) => state.updateNodeConfig);
  const columnList = usePipelineStore((state) => state.columnList);
  const label = typeof data.label === "string" ? data.label : "Drop Duplicates";
  // Memoized so downstream useMemo deps see a stable reference instead of a
  // fresh `{}` on every render when no config exists yet.
  const config = useMemo(() => (data.config ?? {}) as NodeConfig, [data.config]);
  const schemaCols = useNodeColumns(id);
  const errors = useMemo(
    () =>
      getNodeErrors(
        { id, type: "drop-duplicates", position: { x: 0, y: 0 }, data: { label, config } },
        columnList,
        schemaCols,
      ),
    [id, label, config, columnList, schemaCols],
  );
  const columns = config.columns ?? [];

  const handleToggleColumn = (column: string): void => {
    const next = columns.includes(column)
      ? columns.filter((c) => c !== column)
      : [...columns, column];
    const selected = new Set(next);
    updateNodeConfig(id, {
      columns: [
        ...schemaCols.filter((c) => selected.has(c)),
        ...next.filter((c) => !schemaCols.includes(c)),
      ],
    });
  };

  return (
    <NodeShell
      nodeId={id}
      title={label}
      icon={Copy}
      tone="blue"
      selected={selected}
      errors={errors}
      configured
    >
      <ColumnChecklist
        label="Key columns (empty = whole row)"
        columns={schemaCols}
        selected={columns}
        onToggle={handleToggleColumn}
        emptyHint={
          <p className={hintClass}>No columns selected — full-row duplicates are removed.</p>
        }
      />
    </NodeShell>
  );
}
