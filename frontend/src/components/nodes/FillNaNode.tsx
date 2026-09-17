import type { NodeProps } from '@xyflow/react';
import { Droplets } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useMemo } from 'react';

import { isMissingOption, useNodeColumns, withSelected } from '../../lib/schema';
import { getNodeErrors } from '../../lib/validatePipeline';
import { usePipelineStore } from '../../stores/pipelineStore';
import type { NodeConfig } from '../../types';
import NodeShell, { fieldLabelClass, inputClass } from './NodeShell';

const STRATEGIES = ['mean', 'median', 'mode', 'constant'] as const;

export default function FillNaNode({ id, data, selected }: NodeProps) {
  const updateNodeConfig = usePipelineStore((state) => state.updateNodeConfig);
  const columnList = usePipelineStore((state) => state.columnList);
  const label = typeof data.label === 'string' ? data.label : 'Fill NA';
  const config = (data.config ?? {}) as NodeConfig;
  const errors = useMemo(
    () =>
      getNodeErrors(
        { id, type: 'fill-na', position: { x: 0, y: 0 }, data: { label, config } },
        columnList,
      ),
    [id, label, config, columnList],
  );
  const strategy = config.strategy ?? '';
  const value = config.value ?? '';
  const columns = config.columns ?? [];
  const schemaCols = useNodeColumns(id);
  const options = useMemo(() => withSelected(schemaCols, columns), [schemaCols, columns]);

  const handleStrategyChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const next = event.target.value;
    if (next === '') {
      updateNodeConfig(id, { strategy: undefined });
    } else {
      updateNodeConfig(id, {
        strategy: next as NodeConfig['strategy'],
      });
    }
  };

  const handleValueChange = (event: ChangeEvent<HTMLInputElement>): void => {
    updateNodeConfig(id, { value: event.target.value });
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
      icon={Droplets}
      tone="blue"
      selected={selected}
      errors={errors}
      configured={strategy !== ''}
    >
        <div>
          <p className={fieldLabelClass}>Strategy</p>
          <select
            value={strategy}
            onChange={handleStrategyChange}
            className={inputClass}
          >
            <option value="">Select strategy</option>
            {STRATEGIES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        {strategy === 'constant' && (
          <div>
            <p className={fieldLabelClass}>Value</p>
            <input
              type="text"
              value={value}
              onChange={handleValueChange}
              className={inputClass}
            />
          </div>
        )}
        <div>
            <p className={fieldLabelClass}>Columns</p>
          <select
            multiple
            value={columns}
            onChange={handleColumnsChange}
              className={`${inputClass} h-24`}
          >
            {options.map((column) => (
              <option key={column} value={column}>
                {column}
                {isMissingOption(schemaCols, column) ? ' (missing)' : ''}
              </option>
            ))}
          </select>
        </div>
    </NodeShell>
  );
}
