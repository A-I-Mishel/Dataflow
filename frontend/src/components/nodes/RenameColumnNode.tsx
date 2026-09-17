import type { NodeProps } from '@xyflow/react';
import { Type } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useMemo } from 'react';

import { getNodeErrors } from '../../lib/validatePipeline';
import { usePipelineStore } from '../../stores/pipelineStore';
import type { NodeConfig } from '../../types';
import NodeShell, { addBtnClass, fieldInput, hintClass, removeBtnClass } from './NodeShell';

export default function RenameColumnNode({ id, data, selected }: NodeProps) {
  const updateNodeConfig = usePipelineStore((state) => state.updateNodeConfig);
  const columnList = usePipelineStore((state) => state.columnList);
  const label = typeof data.label === 'string' ? data.label : 'Rename Column';
  const config = (data.config ?? {}) as NodeConfig;
  const errors = useMemo(
    () =>
      getNodeErrors(
        { id, type: 'rename-column', position: { x: 0, y: 0 }, data: { label, config } },
        columnList,
      ),
    [id, label, config, columnList],
  );
  const mapping = config.mapping ?? {};
  const entries = Object.entries(mapping);

  const handleAddMapping = (): void => {
    const base = 'new_column';
    let key = base;
    let counter = 1;
    while (Object.prototype.hasOwnProperty.call(mapping, key)) {
      counter += 1;
      key = `${base}_${counter}`;
    }
    updateNodeConfig(id, { mapping: { ...mapping, [key]: '' } });
  };

  const handleRemoveMapping = (oldKey: string): void => {
    const next = { ...mapping };
    delete next[oldKey];
    updateNodeConfig(id, { mapping: next });
  };

  const handleOldNameChange = (
    event: ChangeEvent<HTMLInputElement>,
    oldKey: string,
  ): void => {
    const newKey = event.target.value;
    const next: Record<string, string> = {};
    for (const [key, value] of entries) {
      if (key === oldKey) {
        next[newKey] = value;
      } else {
        next[key] = value;
      }
    }
    updateNodeConfig(id, { mapping: next });
  };

  const handleNewNameChange = (
    event: ChangeEvent<HTMLInputElement>,
    key: string,
  ): void => {
    updateNodeConfig(id, { mapping: { ...mapping, [key]: event.target.value } });
  };

  return (
    <NodeShell
      nodeId={id}
      title={label}
      icon={Type}
      tone="blue"
      selected={selected}
      errors={errors}
      configured={entries.length > 0}
    >
        {entries.length === 0 && (
            <p className={hintClass}>No mappings defined</p>
        )}
        {entries.map(([oldName, newName]) => (
          <div key={oldName} className="space-y-1">
            <div className="flex gap-2">
              <input
                type="text"
                value={oldName}
                onChange={(event) => handleOldNameChange(event, oldName)}
                placeholder="Old name"
                className={`${fieldInput} w-1/2`}
              />
              <input
                type="text"
                value={newName}
                onChange={(event) => handleNewNameChange(event, oldName)}
                placeholder="New name"
                className={`${fieldInput} w-1/2`}
              />
            </div>
            <button
              type="button"
              onClick={() => handleRemoveMapping(oldName)}
              className={removeBtnClass}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={handleAddMapping}
          className={addBtnClass}
        >
          Add Mapping
        </button>
    </NodeShell>
  );
}
