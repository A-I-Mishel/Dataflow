import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Tags } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useMemo } from 'react';

import { getNodeErrors } from '../../lib/validatePipeline';
import { usePipelineStore } from '../../stores/pipelineStore';
import type { NodeConfig } from '../../types';

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

  const handleMethodChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    updateNodeConfig(id, { method: event.target.value });
  };

  const handleColumnsChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const selectedColumns = Array.from(event.target.selectedOptions).map(
      (option) => option.value,
    );
    updateNodeConfig(id, { columns: selectedColumns });
  };

  return (
    <div
      className={`w-64 rounded-xl border shadow-lg transition-all ${
        selected ? 'ring-2 ring-indigo-500 border-indigo-500' : 'border-slate-700'
      } ${errors.length > 0 ? 'ring-2 ring-rose-500 border-rose-500' : ''} bg-slate-800`}
    >
      <div className="flex items-center gap-2 rounded-t-xl px-3 py-2 border-b border-slate-700 bg-orange-500/20">
        <Tags size={16} className="text-orange-400" />
        <span className="text-sm font-semibold text-slate-100">{label}</span>
      </div>
      {errors.length > 0 && (
        <div className="px-3 py-1.5 bg-rose-500/20 border-b border-rose-500/30">
          <p className="text-xs text-rose-300 font-medium">{errors[0]}</p>
        </div>
      )}
      <div className="p-3 space-y-3">
        <div>
          <p className="text-xs font-medium text-slate-300 mb-1">Method</p>
          <select
            value={method}
            onChange={handleMethodChange}
            className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            <option value="">Select method</option>
            {METHODS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-300 mb-1">Columns</p>
          <select
            multiple
            value={columns}
            onChange={handleColumnsChange}
            className="w-full h-24 rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            {columnList.map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </select>
        </div>
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
