import type { NodeProps } from '@xyflow/react';
import { Droplets } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useMemo } from 'react';

import { useNodeColumns } from '../../lib/schema';
import { getNodeErrors } from '../../lib/validatePipeline';
import { usePipelineStore } from '../../stores/pipelineStore';
import type { NodeConfig } from '../../types';
import ColumnChecklist from './ColumnChecklist';
import NodeShell, { fieldLabelClass, inputClass } from './NodeShell';

const STRATEGIES = ['mean', 'median', 'mode', 'constant'] as const;

export default function FillNaNode({ id, data, selected }: NodeProps) {
  const updateNodeConfig = usePipelineStore((state) => state.updateNodeConfig);
  const columnList = usePipelineStore((state) => state.columnList);
  const label = typeof data.label === 'string' ? data.label : 'Fill NA';
  const config = (data.config ?? {}) as NodeConfig;
  const schemaCols = useNodeColumns(id);
  const errors = useMemo(
    () =>
      getNodeErrors(
        { id, type: 'fill-na', position: { x: 0, y: 0 }, data: { label, config } },
        columnList,
        schemaCols,
      ),
    [id, label, config, columnList, schemaCols],
  );
  const strategy = config.strategy ?? '';
  const value = config.value ?? '';
  const columns = config.columns ?? [];

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
        <ColumnChecklist
          label="Columns"
          columns={schemaCols}
          selected={columns}
          onToggle={handleToggleColumn}
        />
    </NodeShell>
  );
}
