import type { NodeProps } from '@xyflow/react';
import { Tags } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useMemo } from 'react';

import { useNodeColumns } from '../../lib/schema';
import { getNodeErrors } from '../../lib/validatePipeline';
import { usePipelineStore } from '../../stores/pipelineStore';
import type { NodeConfig } from '../../types';
import ColumnChecklist from './ColumnChecklist';
import NodeShell, { fieldLabelClass, inputClass } from './NodeShell';

const METHODS = ['one-hot', 'label'];

export default function EncodeNode({ id, data, selected }: NodeProps) {
  const updateNodeConfig = usePipelineStore((state) => state.updateNodeConfig);
  const columnList = usePipelineStore((state) => state.columnList);
  const label = typeof data.label === 'string' ? data.label : 'Encode';
  const config = (data.config ?? {}) as NodeConfig;
  const errors = useMemo(
    () =>
      getNodeErrors(
        {
          id,
          type: 'encode-categorical',
          position: { x: 0, y: 0 },
          data: { label, config },
        },
        columnList,
      ),
    [id, label, config, columnList],
  );
  const method = config.method ?? '';
  const columns = config.columns ?? [];
  const schemaCols = useNodeColumns(id);

  const handleMethodChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    updateNodeConfig(id, { method: event.target.value });
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
      icon={Tags}
      tone="orange"
      selected={selected}
      errors={errors}
      configured={method !== '' || columns.length > 0}
    >
        <div>
          <p className={fieldLabelClass}>Method</p>
          <select
            value={method}
            onChange={handleMethodChange}
            className={inputClass}
          >
            <option value="">Select method</option>
            {METHODS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <ColumnChecklist
          label="Columns (empty = auto-detect all)"
          columns={schemaCols}
          selected={columns}
          onToggle={handleToggleColumn}
        />
    </NodeShell>
  );
}
