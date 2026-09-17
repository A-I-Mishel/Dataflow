import type { NodeProps } from '@xyflow/react';
import { Copy } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useMemo } from 'react';

import { getNodeErrors } from '../../lib/validatePipeline';
import { usePipelineStore } from '../../stores/pipelineStore';
import type { NodeConfig } from '../../types';
import NodeShell, { fieldLabelClass, hintClass, inputClass } from './NodeShell';

export default function DropDuplicatesNode({ id, data, selected }: NodeProps) {
  const updateNodeConfig = usePipelineStore((state) => state.updateNodeConfig);
  const columnList = usePipelineStore((state) => state.columnList);
  const label = typeof data.label === 'string' ? data.label : 'Drop Duplicates';
  const config = (data.config ?? {}) as NodeConfig;
  const errors = useMemo(
    () =>
      getNodeErrors(
        { id, type: 'drop-duplicates', position: { x: 0, y: 0 }, data: { label, config } },
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
      title={label}
      icon={Copy}
      tone="blue"
      selected={selected}
      errors={errors}
      configured
    >
      <div>
        <p className={fieldLabelClass}>Key columns (empty = whole row)</p>
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
          <p className={hintClass}>No columns selected — full-row duplicates are removed.</p>
        )}
      </div>
    </NodeShell>
  );
}
