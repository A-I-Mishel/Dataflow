import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Filter } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useMemo } from 'react';

import { getNodeErrors } from '../../lib/validatePipeline';
import { usePipelineStore } from '../../stores/pipelineStore';
import type { NodeConfig } from '../../types';

type Condition = NonNullable<NodeConfig['conditions']>[number];

const OPERATORS = ['>', '<', '>=', '<=', '==', '!=', 'contains', 'startswith', 'endswith'];

const LOGIC_OPTIONS = ['AND', 'OR'] as const;

const inputClass =
  'w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500';

function stripFirstLogic(conditions: Condition[]): Condition[] {
  if (conditions.length === 0) return conditions;
  const [first, ...rest] = conditions;
  return [{ column: first.column, operator: first.operator, value: first.value }, ...rest];
}

export default function FilterRowsNode({ id, data, selected }: NodeProps) {
  const updateNodeConfig = usePipelineStore((state) => state.updateNodeConfig);
  const columnList = usePipelineStore((state) => state.columnList);
  const label = typeof data.label === 'string' ? data.label : 'Filter Rows';
  const config = (data.config ?? {}) as NodeConfig;
  const errors = useMemo(
    () =>
      getNodeErrors(
        { id, type: 'filter-rows', position: { x: 0, y: 0 }, data: { label, config } },
        columnList,
      ),
    [id, label, config, columnList],
  );
  const conditions = config.conditions ?? [];

  const commit = (next: Condition[]): void => {
    updateNodeConfig(id, { conditions: stripFirstLogic(next) });
  };

  const handleAddCondition = (): void => {
    const row: Condition =
      conditions.length === 0
        ? { column: '', operator: '', value: '' }
        : { column: '', operator: '', value: '', logic: 'AND' };
    commit([...conditions, row]);
  };

  const handleRemoveCondition = (index: number): void => {
    commit(conditions.filter((_, i) => i !== index));
  };

  const handleColumnChange = (index: number, event: ChangeEvent<HTMLSelectElement>): void => {
    commit(
      conditions.map((condition, i) =>
        i === index ? { ...condition, column: event.target.value } : condition,
      ),
    );
  };

  const handleOperatorChange = (
    index: number,
    event: ChangeEvent<HTMLSelectElement>,
  ): void => {
    commit(
      conditions.map((condition, i) =>
        i === index ? { ...condition, operator: event.target.value } : condition,
      ),
    );
  };

  const handleValueChange = (index: number, event: ChangeEvent<HTMLInputElement>): void => {
    const raw = event.target.value;
    const parsed = parseFloat(raw);
    const value = raw !== '' && !Number.isNaN(parsed) ? parsed : raw;
    commit(
      conditions.map((condition, i) =>
        i === index ? { ...condition, value } : condition,
      ),
    );
  };

  const handleLogicChange = (index: number, event: ChangeEvent<HTMLSelectElement>): void => {
    const logic = event.target.value;
    commit(
      conditions.map((condition, i) =>
        i === index
          ? { ...condition, logic: logic === 'OR' ? 'OR' : 'AND' }
          : condition,
      ),
    );
  };

  return (
    <div
      className={`w-64 rounded-xl border shadow-lg transition-all ${
        selected ? 'ring-2 ring-indigo-500 border-indigo-500' : 'border-slate-700'
      } ${errors.length > 0 ? 'ring-2 ring-rose-500 border-rose-500' : ''} bg-slate-800`}
    >
      <div className="flex items-center gap-2 rounded-t-xl px-3 py-2 border-b border-slate-700 bg-purple-500/20">
        <Filter size={16} className="text-purple-400" />
        <span className="text-sm font-semibold text-slate-100">{label}</span>
      </div>
      {errors.length > 0 && (
        <div className="px-3 py-1.5 bg-rose-500/20 border-b border-rose-500/30">
          <p className="text-xs text-rose-300 font-medium">{errors[0]}</p>
        </div>
      )}
      <div className="p-3 space-y-3">
        {conditions.length === 0 && (
          <p className="text-slate-500 text-xs">No conditions defined</p>
        )}
        {conditions.map((condition, index) => (
          <div key={index} className="space-y-2 rounded-md border border-slate-700 p-2">
            <div>
              <p className="text-xs font-medium text-slate-300 mb-1">Column</p>
              <select
                value={condition.column ?? ''}
                onChange={(event) => handleColumnChange(index, event)}
                className={inputClass}
              >
                <option value="">Select column</option>
                {columnList.map((column) => (
                  <option key={column} value={column}>
                    {column}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-300 mb-1">Operator</p>
              <select
                value={condition.operator ?? ''}
                onChange={(event) => handleOperatorChange(index, event)}
                className={inputClass}
              >
                <option value="">Select operator</option>
                {OPERATORS.map((operator) => (
                  <option key={operator} value={operator}>
                    {operator}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-300 mb-1">Value</p>
              <input
                type="text"
                value={condition.value ?? ''}
                onChange={(event) => handleValueChange(index, event)}
                placeholder="e.g. 18"
                className={inputClass}
              />
            </div>
            {index > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-300 mb-1">Logic</p>
                <select
                  value={condition.logic ?? 'AND'}
                  onChange={(event) => handleLogicChange(index, event)}
                  className={inputClass}
                >
                  {LOGIC_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button
              type="button"
              onClick={() => handleRemoveCondition(index)}
              className="text-xs text-slate-400 hover:text-red-400"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={handleAddCondition}
          className="w-full rounded-md bg-slate-700 hover:bg-slate-600 px-2 py-1.5 text-xs font-medium text-slate-200"
        >
          Add Condition
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
