import type { NodeProps } from "@xyflow/react";
import { Droplets } from "lucide-react";
import type { ChangeEvent } from "react";
import { useId, useMemo } from "react";

import { useNodeColumns } from "../../lib/schema";
import { getNodeErrors } from "../../lib/validatePipeline";
import { usePipelineStore } from "../../stores/pipelineStore";
import type { NodeConfig } from "../../types";
import ColumnChecklist from "./ColumnChecklist";
import NodeShell, { fieldLabelClass, inputClass } from "./NodeShell";

const STRATEGIES = ["mean", "median", "mode", "constant"] as const;

export default function FillNaNode({ id, data, selected }: NodeProps) {
  const updateNodeConfig = usePipelineStore((state) => state.updateNodeConfig);
  const columnList = usePipelineStore((state) => state.columnList);
  const originalData = usePipelineStore((state) => state.originalData);
  const resultData = usePipelineStore((state) => state.resultData);
  const label = typeof data.label === "string" ? data.label : "Fill NA";
  // Memoized so downstream useMemo deps see a stable reference instead of a
  // fresh `{}` on every render when no config exists yet.
  const config = useMemo(() => (data.config ?? {}) as NodeConfig, [data.config]);
  const schemaCols = useNodeColumns(id);
  const dtypes = originalData?.dtypes ?? resultData?.dtypes;
  const errors = useMemo(
    () =>
      getNodeErrors(
        { id, type: "fill-na", position: { x: 0, y: 0 }, data: { label, config } },
        columnList,
        schemaCols,
        dtypes,
      ),
    [id, label, config, columnList, schemaCols, dtypes],
  );
  const strategy = config.strategy ?? "";
  const value = config.value ?? "";
  const columns = config.columns ?? [];
  // Unique field ids so <label> associates correctly with many nodes mounted.
  const uid = useId().replace(/:/g, "");

  const handleStrategyChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const next = event.target.value;
    if (next === "") {
      updateNodeConfig(id, { strategy: undefined });
    } else {
      updateNodeConfig(id, {
        strategy: next as NodeConfig["strategy"],
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
      configured={strategy !== ""}
    >
      <div>
        <label htmlFor={`${uid}-strategy`} className={`${fieldLabelClass} block`}>
          Strategy
        </label>
        <select
          id={`${uid}-strategy`}
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
      {strategy === "constant" && (
        <div>
          <label htmlFor={`${uid}-value`} className={`${fieldLabelClass} block`}>
            Value
          </label>
          <input
            id={`${uid}-value`}
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
