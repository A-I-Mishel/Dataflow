import type { NodeProps } from '@xyflow/react';
import { XCircle } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useMemo } from 'react';

import { getNodeErrors } from '../../lib/validatePipeline';
import { usePipelineStore } from '../../stores/pipelineStore';
import type { NodeConfig } from '../../types';
import NodeShell, { fieldLabelClass, inputClass } from './NodeShell';

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

  const handleColumnsChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const selectedColumns = Array.from(event.target.selectedOptions).map(
      (option) => option.value,
    );
    updateNodeConfig(id, { columns: selectedColumns });
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
        <div>
            <p className={fieldLabelClass}>Columns to drop</p>
          <select
            multiple
            value={columns}
            onChange={handleColumnsChange}
              className={`${inputClass} h-24`}
          >
            {columnList.map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </select>
          {columns.length === 0 && (
            <p className="text-red-400 text-xs mt-1">Select at least one column</p>
          )}
        </div>
    </NodeShell>
  );
}
