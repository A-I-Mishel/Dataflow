import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Type } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useMemo } from 'react';

import { getNodeErrors } from '../../lib/validatePipeline';
import { usePipelineStore } from '../../stores/pipelineStore';
import type { NodeConfig } from '../../types';

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
    <div
      className={`w-64 rounded-xl border shadow-lg transition-all ${
        selected ? 'ring-2 ring-indigo-500 border-indigo-500' : 'border-slate-700'
      } ${errors.length > 0 ? 'ring-2 ring-rose-500 border-rose-500' : ''} bg-slate-800`}
    >
      <div className="flex items-center gap-2 rounded-t-xl px-3 py-2 border-b border-slate-700 bg-blue-500/20">
        <Type size={16} className="text-blue-400" />
        <span className="text-sm font-semibold text-slate-100">{label}</span>
      </div>
      {errors.length > 0 && (
        <div className="px-3 py-1.5 bg-rose-500/20 border-b border-rose-500/30">
          <p className="text-xs text-rose-300 font-medium">{errors[0]}</p>
        </div>
      )}
      <div className="p-3 space-y-3">
        {entries.length === 0 && (
          <p className="text-slate-500 text-xs">No mappings defined</p>
        )}
        {entries.map(([oldName, newName]) => (
          <div key={oldName} className="space-y-1">
            <div className="flex gap-2">
              <input
                type="text"
                value={oldName}
                onChange={(event) => handleOldNameChange(event, oldName)}
                placeholder="Old name"
                className="w-1/2 rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
              />
              <input
                type="text"
                value={newName}
                onChange={(event) => handleNewNameChange(event, oldName)}
                placeholder="New name"
                className="w-1/2 rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <button
              type="button"
              onClick={() => handleRemoveMapping(oldName)}
              className="text-xs text-slate-400 hover:text-red-400"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={handleAddMapping}
          className="w-full rounded-md bg-slate-700 hover:bg-slate-600 px-2 py-1.5 text-xs font-medium text-slate-200"
        >
          Add Mapping
        </button>
      </div>
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-slate-400 !w-3 !h-3 !-top-1.5"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-slate-400 !w-3 !h-3 !-bottom-1.5"
      />
    </div>
  );
}
