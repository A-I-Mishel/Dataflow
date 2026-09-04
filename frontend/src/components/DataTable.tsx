import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import type { ColumnDef } from '@tanstack/react-table';
import { Table } from 'lucide-react';
import { useMemo } from 'react';

import EmptyState from './EmptyState';

interface DataTableProps {
  data: Record<string, unknown>[];
  columns: string[];
  dtypes: Record<string, string>;
}

function dtypeBadgeClass(dtype: string): string {
  const lower = dtype.toLowerCase();
  if (lower.includes('int64') || lower.includes('float64')) {
    return 'bg-blue-500/20 text-blue-300';
  }
  if (lower.includes('object')) {
    return 'bg-green-500/20 text-green-300';
  }
  if (lower.includes('datetime64')) {
    return 'bg-purple-500/20 text-purple-300';
  }
  return 'bg-slate-500/20 text-slate-300';
}

const MAX_ROWS = 100;

export default function DataTable({ data, columns, dtypes }: DataTableProps) {
  const tableColumns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () =>
      columns.map((column) => ({
        id: column,
        header: () => (
          <span>
            <span className="text-slate-200 font-medium">{column}</span>{' '}
            <span
              className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] ${dtypeBadgeClass(
                dtypes[column] ?? '',
              )}`}
            >
              {dtypes[column] ?? 'unknown'}
            </span>
          </span>
        ),
        accessorFn: (row) => row[column],
        cell: (info) => String(info.getValue() ?? ''),
      })),
    [columns, dtypes],
  );

  const visibleData = useMemo(() => data.slice(0, MAX_ROWS), [data]);

  const table = useReactTable({
    data: visibleData,
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
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="bg-slate-800 text-slate-300 font-medium">
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="text-left px-3 py-2">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2 text-slate-300">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.length > MAX_ROWS && (
        <p className="text-xs text-slate-500 mt-2">
          Showing first {MAX_ROWS} of {data.length} rows
        </p>
      )}
    </div>
  );
}
