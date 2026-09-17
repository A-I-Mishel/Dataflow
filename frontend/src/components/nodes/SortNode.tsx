import type { NodeProps } from '@xyflow/react';
import { ArrowUpDown } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useMemo } from 'react';

import { isMissingOption, useNodeColumns, withSelected } from '../../lib/schema';
import { getNodeErrors } from '../../lib/validatePipeline';
import { usePipelineStore } from '../../stores/pipelineStore';
import type { NodeConfig } from '../../types';
import NodeShell, { fieldLabelClass, inputClass } from './NodeShell';

export default function SortNode({ id, data, selected }: NodeProps) {
  const updateNodeConfig = usePipelineStore((state) => state.updateNodeConfig);
  const columnList = usePipelineStore((state) => state.columnList);
  const label = typeof data.label === 'string' ? data.label : 'Sort';
  const config = (data.config ?? {}) as NodeConfig;
  const errors = useMemo(
    () =>
      getNodeErrors(
        { id, type: 'sort', position: { x: 0, y: 0 }, data: { label, config } },
        columnList,
      ),
    [id, label, config, columnList],
  );
  const by = config.by ?? [];
  const ascending = config.ascending !== false;
  const schemaCols = useNodeColumns(id);
  const options = useMemo(() => withSelected(schemaCols, by), [schemaCols, by]);

  const handleByChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const selectedColumns = Array.from(event.target.selectedOptions).map(
      (option) => option.value,
    );
    updateNodeConfig(id, { by: selectedColumns });
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
        <div>
          <p className={fieldLabelClass}>Sort by</p>
          <select
            multiple
            value={by}
            onChange={handleByChange}
            className={`${inputClass} h-24`}
          >
            {options.map((column) => (
              <option key={column} value={column}>
                {column}
                {isMissingOption(schemaCols, column) ? ' (missing)' : ''}
              </option>
            ))}
          </select>
          {by.length === 0 && (
            <p className="text-red-400 text-xs mt-1">Select at least one column</p>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-ink2">
          <input type="checkbox" checked={ascending} onChange={handleAscendingChange} />
          Ascending
        </label>
    </NodeShell>
  );
}
