import type { NodeProps } from "@xyflow/react";
import { Filter } from "lucide-react";
import type { ChangeEvent } from "react";
import { useMemo, useRef } from "react";

import { isMissingOption, isNumericDtype, useNodeColumns, withSelected } from "../../lib/schema";
import { getNodeErrors } from "../../lib/validatePipeline";
import { usePipelineStore } from "../../stores/pipelineStore";
import type { NodeConfig } from "../../types";
import NodeShell, {
  addBtnClass,
  fieldLabelClass,
  hintClass,
  inputClass,
  removeBtnClass,
} from "./NodeShell";

type Condition = NonNullable<NodeConfig["conditions"]>[number];

const OPERATORS = [">", "<", ">=", "<=", "==", "!=", "contains", "startswith", "endswith"];

const LOGIC_OPTIONS = ["AND", "OR"] as const;

function stripFirstLogic(conditions: Condition[]): Condition[] {
  if (conditions.length === 0) return conditions;
  const [first, ...rest] = conditions;
  // Rebuild without `logic` but keep everything else (including the
  // client-only stable `id`) so the first row never remounts.
  const { logic: _omitted, ...firstWithoutLogic } = first;
  return [firstWithoutLogic, ...rest];
}

function withIds(conditions: Condition[]): Condition[] {
  // Backfill stable ids for legacy configs that predate them. Assigned at
  // commit time (not render time) so identities survive re-renders and
  // sibling add/remove no longer shifts row state or focus.
  let changed = false;
  const next = conditions.map((condition) => {
    if (condition.id !== undefined) return condition;
    changed = true;
    return { ...condition, id: crypto.randomUUID() };
  });
  return changed ? next : conditions;
}

export default function FilterRowsNode({ id, data, selected }: NodeProps) {
  const updateNodeConfig = usePipelineStore((state) => state.updateNodeConfig);
  const columnList = usePipelineStore((state) => state.columnList);
  const schemaCols = useNodeColumns(id);
  const originalData = usePipelineStore((state) => state.originalData);
  const resultData = usePipelineStore((state) => state.resultData);
  const label = typeof data.label === "string" ? data.label : "Filter Rows";
  // Memoized so downstream useMemo deps see a stable reference instead of a
  // fresh `{}` on every render when no config exists yet.
  const config = useMemo(() => (data.config ?? {}) as NodeConfig, [data.config]);
  const errors = useMemo(
    () =>
      getNodeErrors(
        { id, type: "filter-rows", position: { x: 0, y: 0 }, data: { label, config } },
        columnList,
        schemaCols,
      ),
    [id, label, config, columnList, schemaCols],
  );
  // Keyed by stable client ids (see withIds): deleting a middle row no
  // longer shifts sibling row state or steals their focus.
  const conditions = useMemo(() => withIds(config.conditions ?? []), [config.conditions]);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const commit = (next: Condition[]): void => {
    updateNodeConfig(id, { conditions: stripFirstLogic(withIds(next)) });
  };

  const indexOf = (rowId: string): number => conditions.findIndex((c) => c.id === rowId);

  const handleAddCondition = (): void => {
    const row: Condition =
      conditions.length === 0
        ? { column: "", operator: "", value: "", id: crypto.randomUUID() }
        : { column: "", operator: "", value: "", logic: "AND", id: crypto.randomUUID() };
    commit([...conditions, row]);
  };

  const handleRemoveCondition = (rowId: string): void => {
    commit(conditions.filter((condition) => condition.id !== rowId));
    // The removed row's Remove button unmounts — land focus somewhere
    // predictable instead of dropping it to <body>.
    requestAnimationFrame(() => addButtonRef.current?.focus());
  };

  const handleColumnChange = (rowId: string, event: ChangeEvent<HTMLSelectElement>): void => {
    commit(
      conditions.map((condition) =>
        condition.id === rowId ? { ...condition, column: event.target.value } : condition,
      ),
    );
  };

  const handleOperatorChange = (rowId: string, event: ChangeEvent<HTMLSelectElement>): void => {
    commit(
      conditions.map((condition) =>
        condition.id === rowId ? { ...condition, operator: event.target.value } : condition,
      ),
    );
  };

  const handleValueChange = (rowId: string, event: ChangeEvent<HTMLInputElement>): void => {
    const raw = event.target.value;
    // Dtype-aware coercion: only parse numeric strings when the target
    // column is actually numeric. Otherwise "007", "1e5" or "18abc" would
    // be corrupted by parseFloat and never match string columns.
    const column = conditions[indexOf(rowId)]?.column ?? "";
    const dtype =
      (column !== "" ? originalData?.dtypes[column] : undefined) ??
      (column !== "" ? resultData?.dtypes[column] : undefined);
    let value: string | number = raw;
    if (raw !== "" && isNumericDtype(dtype)) {
      const parsed = parseFloat(raw);
      if (!Number.isNaN(parsed)) {
        value = parsed;
      }
    }
    commit(
      conditions.map((condition) => (condition.id === rowId ? { ...condition, value } : condition)),
    );
  };

  const handleLogicChange = (rowId: string, event: ChangeEvent<HTMLSelectElement>): void => {
    const logic = event.target.value;
    commit(
      conditions.map((condition) =>
        condition.id === rowId ? { ...condition, logic: logic === "OR" ? "OR" : "AND" } : condition,
      ),
    );
  };

  return (
    <NodeShell
      nodeId={id}
      title={label}
      icon={Filter}
      tone="purple"
      selected={selected}
      errors={errors}
      configured={conditions.length > 0}
    >
      {conditions.length === 0 && <p className={hintClass}>No conditions defined</p>}
      {conditions.map((condition, index) => (
        <div
          key={condition.id ?? `row-${index}`}
          className="space-y-2 rounded-md border border-line bg-panel p-2"
        >
          <div>
            <p className={fieldLabelClass}>Column</p>
            <select
              value={condition.column ?? ""}
              onChange={(event) => handleColumnChange(condition.id ?? "", event)}
              className={inputClass}
            >
              <option value="">Select column</option>
              {withSelected(schemaCols, condition.column ?? "").map((column) => (
                <option key={column} value={column}>
                  {column}
                  {isMissingOption(schemaCols, column) ? " (missing)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className={fieldLabelClass}>Operator</p>
            <select
              value={condition.operator ?? ""}
              onChange={(event) => handleOperatorChange(condition.id ?? "", event)}
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
              value={condition.value ?? ""}
              onChange={(event) => handleValueChange(condition.id ?? "", event)}
              placeholder="e.g. 18"
              className={inputClass}
            />
          </div>
          {index > 0 && (
            <div>
              <p className={fieldLabelClass}>Logic</p>
              <select
                value={condition.logic ?? "AND"}
                onChange={(event) => handleLogicChange(condition.id ?? "", event)}
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
            onClick={() => handleRemoveCondition(condition.id ?? "")}
            className={removeBtnClass}
          >
            Remove
          </button>
        </div>
      ))}
      <button ref={addButtonRef} type="button" onClick={handleAddCondition} className={addBtnClass}>
        Add Condition
      </button>
    </NodeShell>
  );
}
