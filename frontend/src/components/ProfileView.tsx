import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { usePipelineStore } from '../stores/pipelineStore';
import type { Theme } from '../stores/pipelineStore';
import type { ColumnProfile, ProfileData } from '../types';

interface ProfileViewProps {
  profile: ProfileData;
}

function dtypeBadgeClass(dtype: string, theme: Theme): string {
  const dark = theme !== 'light';
  const lower = dtype.toLowerCase();
  if (lower.includes('int') || lower.includes('float')) {
    return dark ? 'bg-blue-500/20 text-blue-300' : 'bg-blue-500/15 text-blue-700';
  }
  if (lower.includes('date') || lower.includes('time')) {
    return dark ? 'bg-purple-500/20 text-purple-300' : 'bg-purple-500/15 text-purple-700';
  }
  return dark ? 'bg-green-500/20 text-green-300' : 'bg-green-500/15 text-green-700';
}

function tooltipStyle(theme: Theme): Record<string, string> {
  return theme === 'light'
    ? { backgroundColor: '#ffffff', border: '1px solid #e2e8f0' }
    : { backgroundColor: '#1e293b', border: '1px solid #334155' };
}

function tooltipLabelColor(theme: Theme): string {
  return theme === 'light' ? '#0f172a' : '#f1f5f9';
}

function isNumericColumn(column: ColumnProfile): boolean {
  return column.histogram !== undefined && column.histogram !== null;
}

function ColumnCard({ name, column }: { name: string; column: ColumnProfile }) {
  const theme = usePipelineStore((state) => state.theme);
  const stats: Array<{ label: string; value: number | undefined }> = [
    { label: 'Min', value: column.min },
    { label: 'Max', value: column.max },
    { label: 'Mean', value: column.mean },
    { label: 'Median', value: column.median },
    { label: 'Std', value: column.std },
  ];
  const numericStats = stats.filter((stat) => stat.value !== undefined);

  return (
    <div className="bg-card rounded-lg p-3 border border-line shadow-sm">
      <div className="flex flex-row justify-between items-center gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-ink truncate">{name}</span>
          <span
            className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] ${dtypeBadgeClass(column.dtype, theme)}`}
          >
            {column.dtype}
          </span>
        </div>
        <span className="text-xs text-ink3 shrink-0">
          {column.null_count} null ({column.null_pct}%)
        </span>
      </div>
      <div className="h-1.5 w-full bg-btn rounded-full mt-1">
        <div
          className={`h-1.5 rounded-full ${column.null_count > 0 ? 'bg-red-500' : 'bg-emerald-500'}`}
          style={{ width: `${Math.min(100, Math.max(0, column.null_pct))}%` }}
        />
      </div>

      {isNumericColumn(column) && numericStats.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1 mt-2">
          {numericStats.map((stat) => (
            <div key={stat.label}>
              <p className="text-[10px] text-ink3 uppercase">{stat.label}</p>
              <p className="text-xs text-ink">
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
                contentStyle={tooltipStyle(theme)}
                labelStyle={{ color: tooltipLabelColor(theme) }}
              />
              <Bar dataKey="count" fill="#6366f1" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {column.date_min !== undefined && column.date_max !== undefined && (
        <p className="text-xs text-ink3 mt-2">
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
                tick={{ fill: theme === 'light' ? '#64748b' : '#94a3b8', fontSize: 11 }}
              />
              <Tooltip
                contentStyle={tooltipStyle(theme)}
                labelStyle={{ color: tooltipLabelColor(theme) }}
              />
              <Bar dataKey="count" fill="#10b981" radius={[0, 3, 3, 0]} />
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
        <div className="bg-card border border-line rounded-lg p-3 shadow-sm">
          <p className="text-xs text-ink3 uppercase">Rows</p>
          <p className="text-xl font-bold text-ink">{profile.shape[0]}</p>
        </div>
        <div className="bg-card border border-line rounded-lg p-3 shadow-sm">
          <p className="text-xs text-ink3 uppercase">Columns</p>
          <p className="text-xl font-bold text-ink">{profile.shape[1]}</p>
        </div>
        <div className="bg-card border border-line rounded-lg p-3 shadow-sm">
          <p className="text-xs text-ink3 uppercase">Missing Values</p>
          <p className="text-xl font-bold text-ink">{profile.total_missing}</p>
        </div>
        <div className="bg-card border border-line rounded-lg p-3 shadow-sm">
          <p className="text-xs text-ink3 uppercase">Memory</p>
          <p className="text-xl font-bold text-ink">{profile.memory_usage_mb} MB</p>
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
