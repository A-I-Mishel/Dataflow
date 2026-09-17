import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import type { ColumnDef } from '@tanstack/react-table';
import { Table } from 'lucide-react';
import { useMemo } from 'react';

import { usePipelineStore } from '../stores/pipelineStore';
import EmptyState from './EmptyState';
import { dtypeBadgeClass } from '../lib/dtype';

interface DataTableProps {
  data: Record<string, unknown>[];
  columns: string[];
  dtypes: Record<string, string>;
}

export default function DataTable({ data, columns, dtypes }: DataTableProps) {
  const theme = usePipelineStore((state) => state.theme);
  const tableColumns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () =>
      columns.map((column) => ({
        id: column,
        header: () => (
          <span>
            <span className="text-ink font-medium">{column}</span>{' '}
            <span
              className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] ${dtypeBadgeClass(
                dtypes[column] ?? '',
                theme,
              )}`}
            >
              {dtypes[column] ?? 'unknown'}
            </span>
          </span>
        ),
        accessorFn: (row) => row[column],
        cell: (info) => String(info.getValue() ?? ''),
      })),
    [columns, dtypes, theme],
  );

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

  return (
    <div>
      <div className="overflow-hidden rounded-2xl border border-line shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse bg-panel">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="bg-elevated/60 text-ink2 font-bold">
                  {headerGroup.headers.map((header) => (
                    <th key={header.id} className="text-left px-4 py-3 text-xs tracking-wide">
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
                  className={`border-t border-linesoft hover:bg-elevated/40 transition-colors ${
                    rowIndex % 2 === 1 ? 'bg-canvas/20' : 'bg-transparent'
                  }`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-2.5 text-ink2 text-[13px]">
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
