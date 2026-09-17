import type { NodeProps } from '@xyflow/react';
import { Trash2 } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useMemo } from 'react';

import { useNodeColumns } from '../../lib/schema';
import { getNodeErrors } from '../../lib/validatePipeline';
import { usePipelineStore } from '../../stores/pipelineStore';
import type { NodeConfig } from '../../types';
import ColumnChecklist from './ColumnChecklist';
import NodeShell from './NodeShell';

export default function DropNaNode({ id, data, selected }: NodeProps) {
  const updateNodeConfig = usePipelineStore((state) => state.updateNodeConfig);
  const columnList = usePipelineStore((state) => state.columnList);
  const label = typeof data.label === 'string' ? data.label : 'Drop NA';
  const config = (data.config ?? {}) as NodeConfig;
  const schemaCols = useNodeColumns(id);
  const errors = useMemo(
    () =>
      getNodeErrors(
        { id, type: 'drop-na', position: { x: 0, y: 0 }, data: { label, config } },
        columnList,
        schemaCols,
      ),
    [id, label, config, columnList, schemaCols],
  );
  const subset = config.subset ?? false;
  const columns = config.columns ?? [];

  const handleSubsetChange = (event: ChangeEvent<HTMLInputElement>): void => {
    updateNodeConfig(id, { subset: event.target.checked });
  };

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
      icon={Trash2}
      tone="blue"
      selected={selected}
      errors={errors}
      configured={subset || columns.length > 0}
    >
        <label className="flex items-center gap-2 text-xs font-medium text-ink2">
          <input type="checkbox" checked={subset} onChange={handleSubsetChange} />
          Subset only selected columns
        </label>
        {subset && (
          <ColumnChecklist
            label="Columns"
            columns={schemaCols}
            selected={columns}
            onToggle={handleToggleColumn}
          />
        )}
    </NodeShell>
  );
}
