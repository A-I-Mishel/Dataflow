import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { ColumnProfile, ProfileData } from '../types';

interface ProfileViewProps {
  profile: ProfileData;
}

function dtypeBadgeClass(dtype: string): string {
  const lower = dtype.toLowerCase();
  if (lower.includes('int') || lower.includes('float')) {
    return 'bg-blue-500/20 text-blue-300';
  }
  if (lower.includes('date') || lower.includes('time')) {
    return 'bg-purple-500/20 text-purple-300';
  }
  return 'bg-green-500/20 text-green-300';
}

function isNumericColumn(column: ColumnProfile): boolean {
  return column.histogram !== undefined && column.histogram !== null;
}

function ColumnCard({ name, column }: { name: string; column: ColumnProfile }) {
  const stats: Array<{ label: string; value: number | undefined }> = [
    { label: 'Min', value: column.min },
    { label: 'Max', value: column.max },
    { label: 'Mean', value: column.mean },
    { label: 'Median', value: column.median },
    { label: 'Std', value: column.std },
  ];
  const numericStats = stats.filter((stat) => stat.value !== undefined);

  return (
    <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
      <div className="flex flex-row justify-between items-center gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-slate-200 truncate">{name}</span>
          <span
            className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] ${dtypeBadgeClass(column.dtype)}`}
          >
            {column.dtype}
          </span>
        </div>
        <span className="text-xs text-slate-400 shrink-0">
          {column.null_count} null ({column.null_pct}%)
        </span>
      </div>
      <div className="h-1.5 w-full bg-slate-700 rounded-full mt-1">
        <div
          className={`h-1.5 rounded-full ${column.null_count > 0 ? 'bg-red-500' : 'bg-emerald-500'}`}
          style={{ width: `${Math.min(100, Math.max(0, column.null_pct))}%` }}
        />
      </div>

      {isNumericColumn(column) && numericStats.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1 mt-2">
          {numericStats.map((stat) => (
            <div key={stat.label}>
              <p className="text-[10px] text-slate-500 uppercase">{stat.label}</p>
              <p className="text-xs text-slate-200">
                {typeof stat.value === 'number' ? stat.value.toFixed(2) : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      {column.histogram !== undefined && column.histogram !== null && (
        <div className="mt-2 h-[120px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={column.histogram}>
              <XAxis dataKey="bin_start" hide={true} />
              <YAxis hide={true} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                labelStyle={{ color: '#f1f5f9' }}
              />
              <Bar dataKey="count" fill="#6366f1" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {column.date_min !== undefined && column.date_max !== undefined && (
        <p className="text-xs text-slate-400 mt-2">
          {column.date_min} to {column.date_max}
        </p>
      )}

      {column.top_values !== undefined && column.top_values !== null && (
        <div className="mt-2 h-[120px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={column.top_values}>
              <XAxis type="number" hide={true} />
              <YAxis
                type="category"
                dataKey="value"
                width={80}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                labelStyle={{ color: '#f1f5f9' }}
              />
              <Bar dataKey="count" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default function ProfileView({ profile }: ProfileViewProps) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-800 rounded-lg p-3">
          <p className="text-xs text-slate-500 uppercase">Rows</p>
          <p className="text-xl font-bold text-slate-200">{profile.shape[0]}</p>
        </div>
        <div className="bg-slate-800 rounded-lg p-3">
          <p className="text-xs text-slate-500 uppercase">Columns</p>
          <p className="text-xl font-bold text-slate-200">{profile.shape[1]}</p>
        </div>
        <div className="bg-slate-800 rounded-lg p-3">
          <p className="text-xs text-slate-500 uppercase">Missing Values</p>
          <p className="text-xl font-bold text-slate-200">{profile.total_missing}</p>
        </div>
        <div className="bg-slate-800 rounded-lg p-3">
          <p className="text-xs text-slate-500 uppercase">Memory</p>
          <p className="text-xl font-bold text-slate-200">{profile.memory_usage_mb} MB</p>
        </div>
      </div>

      <div className="space-y-3 mt-4">
        {Object.entries(profile.columns).map(([name, column]) => (
          <ColumnCard key={name} name={name} column={column} />
        ))}
      </div>
    </div>
  );
}
