import type { NodeProps } from '@xyflow/react';
import { Trash2 } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useMemo } from 'react';

import { getNodeErrors } from '../../lib/validatePipeline';
import { usePipelineStore } from '../../stores/pipelineStore';
import type { NodeConfig } from '../../types';
import NodeShell, { fieldLabelClass, inputClass } from './NodeShell';

export default function DropNaNode({ id, data, selected }: NodeProps) {
  const updateNodeConfig = usePipelineStore((state) => state.updateNodeConfig);
  const columnList = usePipelineStore((state) => state.columnList);
  const label = typeof data.label === 'string' ? data.label : 'Drop NA';
  const config = (data.config ?? {}) as NodeConfig;
  const errors = useMemo(
    () =>
      getNodeErrors(
        { id, type: 'drop-na', position: { x: 0, y: 0 }, data: { label, config } },
        columnList,
      ),
    [id, label, config, columnList],
  );
  const subset = config.subset ?? false;
  const columns = config.columns ?? [];

  const handleSubsetChange = (event: ChangeEvent<HTMLInputElement>): void => {
    updateNodeConfig(id, { subset: event.target.checked });
  };

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
          <div>
            <p className={fieldLabelClass}>Columns</p>
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
          </div>
        )}
    </NodeShell>
  );
}
