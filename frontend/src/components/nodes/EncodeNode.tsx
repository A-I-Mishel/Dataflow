import type { NodeProps } from "@xyflow/react";
import { Tags } from "lucide-react";
import type { ChangeEvent } from "react";
import { useId, useMemo } from "react";

import {
  calculateOneHotForecast,
  formatCompact,
  type OneHotForecast,
} from "../../lib/oneHotForecast";
import { useNodeColumns } from "../../lib/schema";
import { getNodeErrors } from "../../lib/validatePipeline";
import { usePipelineStore } from "../../stores/pipelineStore";
import type { NodeConfig } from "../../types";
import ColumnChecklist from "./ColumnChecklist";
import NodeShell, { fieldLabelClass, hintClass, inputClass } from "./NodeShell";

const METHODS = ["one-hot", "label"];

function ForecastPanel({
  forecast,
  serverLimit,
  isLargeFile,
}: {
  forecast: OneHotForecast;
  serverLimit: number | undefined;
  isLargeFile: boolean;
}) {
  if (forecast.status === "unavailable") {
    return (
      <div className="rounded-xl border border-line bg-elevated/60 px-3 py-2">
        <p className={fieldLabelClass}>One-hot forecast</p>
        {!forecast.cardinalityAvailable && isLargeFile ? (
          <p className="text-xs leading-relaxed text-ink2">
            Cardinality unavailable for large files. Upload-time one-hot width cannot be forecast
            before execution. Large-file mode currently does not support this Encode operation.
          </p>
        ) : !forecast.cardinalityAvailable ? (
          <p className="text-xs leading-relaxed text-ink2">
            One-hot width forecast unavailable for this dataset — re-upload the file to enable it.
          </p>
        ) : (
          <div className="space-y-1">
            <p className="text-xs leading-relaxed text-ink2">
              Upload-time width unavailable. Cardinality is unavailable for:
            </p>
            <ul className="text-xs text-ink2">
              {forecast.unknownColumns.map((column) => (
                <li key={column}>• {column}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  const drivers = forecast.expansionDrivers
    .map((column) => {
      const entry = forecast.perColumn.find((item) => item.column === column);
      const count = entry?.uniqueValues;
      return count === null || count === undefined
        ? column
        : `${column} (${formatCompact(count)} unique)`;
    })
    .join(", ");
  return (
    <div className="space-y-1.5 rounded-xl border border-line bg-elevated/60 px-3 py-2">
      <p className={fieldLabelClass}>One-hot forecast</p>
      <p className="text-xs text-ink2">
        ≈ {formatCompact(forecast.dummyColumns as number)} dummy columns
      </p>
      <p className="text-xs text-ink2">
        ≈ {formatCompact(forecast.estimatedColumns as number)} columns ×{" "}
        {(forecast.estimatedRows as number).toLocaleString("en-US")} rows
      </p>
      <p className="text-xs font-bold text-ink">
        ≈ {formatCompact(forecast.estimatedCells as number)} cells
      </p>
      {forecast.status === "exceeds" && serverLimit !== undefined && (
        <div className="space-y-1 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2">
          <p className="text-xs font-bold text-danger">
            Estimated size exceeds the server one-hot safety limit.
          </p>
          <p className="text-xs text-ink2">
            Estimated: ~{formatCompact(forecast.estimatedCells as number)} cells. Server limit:{" "}
            {formatCompact(serverLimit)} cells. Run may be refused by the server.
          </p>
          {drivers !== "" && <p className="text-xs text-ink2">Removing {drivers} would fit.</p>}
        </div>
      )}
      <p className={hintClass}>
        Forecast based on uploaded data. Upstream steps may change rows, columns, or cardinality.
        The server performs the final safety check when you run.
      </p>
    </div>
  );
}

export default function EncodeNode({ id, data, selected }: NodeProps) {
  const updateNodeConfig = usePipelineStore((state) => state.updateNodeConfig);
  const columnList = usePipelineStore((state) => state.columnList);
  const originalData = usePipelineStore((state) => state.originalData);
  const isLargeFile = usePipelineStore((state) => state.isLargeFile);
  const label = typeof data.label === "string" ? data.label : "Encode";
  // Memoized so downstream useMemo deps see a stable reference instead of a
  // fresh `{}` on every render when no config exists yet.
  const config = useMemo(() => (data.config ?? {}) as NodeConfig, [data.config]);
  const schemaCols = useNodeColumns(id);
  const errors = useMemo(
    () =>
      getNodeErrors(
        {
          id,
          type: "encode-categorical",
          position: { x: 0, y: 0 },
          data: { label, config },
        },
        columnList,
        schemaCols,
      ),
    [id, label, config, columnList, schemaCols],
  );
  const uid = useId().replace(/:/g, "");
  const method = config.method ?? "";
  // Memoized for the same reason as `config` above: a fresh `[]` every
  // render would defeat the forecast useMemo below.
  const columns = useMemo(() => config.columns ?? [], [config.columns]);
  const isOneHot = (config.method ?? "one-hot") === "one-hot";

  // Per-column cardinality labels for known upload-time columns only.
  // Renamed/unmapped names get no label: unknown stays unknown.
  const cardinalityLabels = useMemo(() => {
    const uniqueCounts = originalData?.unique_counts;
    if (!isOneHot || !originalData?.cardinality_available || uniqueCounts == null) {
      return {};
    }
    const labels: Record<string, string> = {};
    for (const column of schemaCols) {
      const value = uniqueCounts[column];
      if (typeof value === "number") {
        labels[column] = `${formatCompact(value)} unique values`;
      }
    }
    return labels;
  }, [isOneHot, originalData, schemaCols]);

  // Live forecast. Deliberately NOT computed for auto-detect (empty
  // selection): the backend treats that as encode-ALL, i.e. unbounded —
  // routing it through the helper's identity fold would display a finite,
  // reassuring, wrong number.
  const forecast: OneHotForecast | null = useMemo(() => {
    if (!isOneHot || originalData === null || columns.length === 0) return null;
    return calculateOneHotForecast({
      schemaCols,
      selected: columns,
      rowCount: originalData.row_count,
      uniqueCounts: originalData.unique_counts ?? null,
      cardinalityAvailable: originalData.cardinality_available === true,
      oneHotMaxCells: originalData.one_hot_max_cells,
    });
  }, [isOneHot, originalData, schemaCols, columns]);

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
      configured={method !== "" || columns.length > 0}
    >
      <div>
        <label htmlFor={`${uid}-method`} className={`${fieldLabelClass} block`}>
          Method
        </label>
        <select
          id={`${uid}-method`}
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
        secondaryLabels={cardinalityLabels}
      />
      {isOneHot && originalData !== null && columns.length === 0 && (
        <p className={hintClass}>One-hot width unavailable while auto-detect is enabled.</p>
      )}
      {forecast !== null && (
        <ForecastPanel
          forecast={forecast}
          serverLimit={originalData?.one_hot_max_cells}
          isLargeFile={isLargeFile}
        />
      )}
    </NodeShell>
  );
}
