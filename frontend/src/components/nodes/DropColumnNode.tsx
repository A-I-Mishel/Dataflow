import type { NodeProps } from '@xyflow/react';
import { XCircle } from 'lucide-react';
import { useMemo } from 'react';

import { useNodeColumns } from '../../lib/schema';
import { getNodeErrors } from '../../lib/validatePipeline';
import { usePipelineStore } from '../../stores/pipelineStore';
import type { NodeConfig } from '../../types';
import ColumnChecklist from './ColumnChecklist';
import NodeShell from './NodeShell';

export default function DropColumnNode({ id, data, selected }: NodeProps) {
  const updateNodeConfig = usePipelineStore((state) => state.updateNodeConfig);
  const columnList = usePipelineStore((state) => state.columnList);
  const label = typeof data.label === 'string' ? data.label : 'Drop Column';
  const config = (data.config ?? {}) as NodeConfig;
  const errors = useMemo(
    () =>
      getNodeErrors(
        { id, type: 'drop-column', position: { x: 0, y: 0 }, data: { label, config } },
        columnList,
      ),
    [id, label, config, columnList],
  );
  const columns = config.columns ?? [];
  const schemaCols = useNodeColumns(id);

  const handleToggleColumn = (column: string): void => {
    const next = columns.includes(column)
      ? columns.filter((c) => c !== column)
      : [...columns, column];
    const selected = new Set(next);
    // Preserve schema order so multi-column semantics never depend on
    // click order; selections missing from the schema keep their place.
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
      icon={XCircle}
      tone="blue"
      selected={selected}
      errors={errors}
      configured={columns.length > 0}
    >
        <ColumnChecklist
          label="Columns to drop"
          columns={schemaCols}
          selected={columns}
          onToggle={handleToggleColumn}
          emptyHint={<p className="text-red-400 text-xs mt-1">Select at least one column</p>}
        />
    </NodeShell>
  );
}
