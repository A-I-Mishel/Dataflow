import type { NodeProps } from '@xyflow/react';
import { Filter } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useMemo } from 'react';

import { getNodeErrors } from '../../lib/validatePipeline';
import { usePipelineStore } from '../../stores/pipelineStore';
import type { NodeConfig } from '../../types';
import NodeShell, {
  addBtnClass,
  fieldLabelClass,
  hintClass,
  inputClass,
  removeBtnClass,
} from './NodeShell';

type Condition = NonNullable<NodeConfig['conditions']>[number];

const OPERATORS = ['>', '<', '>=', '<=', '==', '!=', 'contains', 'startswith', 'endswith'];

const LOGIC_OPTIONS = ['AND', 'OR'] as const;

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
    <NodeShell
      title={label}
      icon={Filter}
      tone="purple"
      selected={selected}
      errors={errors}
      configured={conditions.length > 0}
    >
        {conditions.length === 0 && (
            <p className={hintClass}>No conditions defined</p>
        )}
        {conditions.map((condition, index) => (
            <div key={index} className="space-y-2 rounded-md border border-line bg-panel p-2">
            <div>
              <p className={fieldLabelClass}>Column</p>
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
              <p className={fieldLabelClass}>Operator</p>
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
              <p className={fieldLabelClass}>Value</p>
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
                <p className={fieldLabelClass}>Logic</p>
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
              className={removeBtnClass}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={handleAddCondition}
          className={addBtnClass}
        >
          Add Condition
        </button>
    </NodeShell>
  );
}
