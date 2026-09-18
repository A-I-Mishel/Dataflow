import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import type { ColumnDef } from "@tanstack/react-table";
import { Table } from "lucide-react";
import { useMemo } from "react";

import { usePipelineStore } from "../stores/pipelineStore";
import EmptyState from "./EmptyState";
import { dtypeBadgeClass } from "../lib/dtype";

interface DataTableProps {
  data: Record<string, unknown>[];
  columns: string[];
  dtypes: Record<string, string>;
  /** Full dataset shape — preview may be truncated, so show "first N of M". */
  shape?: [number, number];
}

function formatCell(value: unknown): { text: string; isNull: boolean } {
  if (value === null || value === undefined) return { text: "null", isNull: true };
  const text = typeof value === "string" ? value : String(value);
  if (text === "") return { text: "—", isNull: true };
  return {
    text: text.length > 120 ? `${text.slice(0, 120)}…` : text,
    isNull: false,
  };
}

export default function DataTable({ data, columns, dtypes, shape }: DataTableProps) {
  const theme = usePipelineStore((state) => state.theme);
  const tableColumns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () =>
      columns.map((column) => ({
        id: column,
        header: () => (
          <span className="inline-flex min-w-0 items-center gap-1.5" title={column}>
            <span className="max-w-[12rem] truncate font-medium text-ink">{column}</span>{" "}
            <span
              className={`inline-block shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${dtypeBadgeClass(
                dtypes[column] ?? "",
                theme,
              )}`}
            >
              {dtypes[column] ?? "unknown"}
            </span>
          </span>
        ),
        accessorFn: (row) => row[column],
        cell: (info) => {
          const raw = info.getValue();
          const { text, isNull } = formatCell(raw);
          const full = raw === null || raw === undefined ? "null" : String(raw);
          if (isNull) {
            return (
              <span className="italic text-ink3" title={full}>
                {text}
              </span>
            );
          }
          return (
            <span className="block max-w-[16rem] truncate" title={full}>
              {text}
            </span>
          );
        },
      })),
    [columns, dtypes, theme],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- non-memoizable by design (TanStack docs)
  const table = useReactTable({
    data,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (data.length === 0) {
    return (
      <EmptyState
        icon={Table}
        title="No Data Preview"
        description="Upload a CSV and run a pipeline to see results here."
      />
    );
  }

  const totalRows = shape?.[0] ?? data.length;
  const truncated = shape !== undefined && shape[0] > data.length;

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold tracking-wide text-ink3">
        Showing {data.length.toLocaleString()} of {totalRows.toLocaleString()} rows
        {truncated ? " (first rows)" : ""} · {columns.length} cols
      </p>
      <div className="overflow-hidden rounded-2xl border border-line shadow-card">
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full border-collapse bg-panel text-sm">
            <thead className="sticky top-0 z-10">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr
                  key={headerGroup.id}
                  className="bg-elevated font-bold text-ink2 shadow-[0_1px_0_rgb(var(--line))]"
                >
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="whitespace-nowrap bg-elevated px-4 py-3 text-left text-xs tracking-wide"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row, rowIndex) => (
                <tr
                  key={row.id}
                  className={`border-t border-linesoft transition-colors hover:bg-elevated/40 ${
                    rowIndex % 2 === 1 ? "bg-canvas/20" : "bg-transparent"
                  }`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-2.5 text-[13px] text-ink2">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
