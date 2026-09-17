import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { usePipelineStore } from '../stores/pipelineStore';
import type { Theme } from '../stores/pipelineStore';
import type { ColumnProfile, ProfileData } from '../types';
import { dtypeBadgeClass } from '../lib/dtype';

interface ProfileViewProps {
  profile: ProfileData;
}

function tooltipStyle(theme: Theme): Record<string, string> {
  return theme === 'light'
    ? { backgroundColor: '#ffffff', border: '1px solid #E4E9F0', borderRadius: '12px' }
    : { backgroundColor: '#171C27', border: '1px solid #2E3849', borderRadius: '12px' };
}

function tooltipLabelColor(theme: Theme): string {
  return theme === 'light' ? '#0D1526' : '#E7ECF3';
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
    <div className="bg-card/70 backdrop-blur-xl rounded-2xl p-4 border border-line shadow-card">
      <div className="flex flex-row justify-between items-center gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-extrabold tracking-tight text-ink truncate">{name}</span>
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${dtypeBadgeClass(column.dtype, theme)}`}
          >
            {column.dtype}
          </span>
        </div>
        <span className="text-xs font-semibold text-ink3 shrink-0">
          {column.null_count} null ({column.null_pct}%)
        </span>
      </div>
      <div className="h-2 w-full bg-elevated rounded-full mt-2 overflow-hidden">
        <div
          className={`h-2 rounded-full transition-all ${column.null_count > 0 ? 'bg-gradient-to-r from-rose-500 to-orange-500' : 'bg-gradient-to-r from-emerald-500 to-teal-500'}`}
          style={{ width: `${Math.min(100, Math.max(0, column.null_pct))}%` }}
        />
      </div>

      {isNumericColumn(column) && numericStats.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-3">
          {numericStats.map((stat) => (
            <div key={stat.label} className="rounded-xl bg-elevated/60 border border-linesoft px-2 py-1.5">
              <p className="text-[10px] font-bold tracking-widest uppercase text-ink3">{stat.label}</p>
              <p className="text-xs font-bold text-ink">
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
                  tick={{ fill: theme === 'light' ? '#43506A' : '#9AA6B8', fontSize: 11 }}
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
        <div className="rounded-2xl p-4 border border-line bg-accentsoft backdrop-blur-xl">
          <p className="text-[11px] font-extrabold tracking-widest uppercase text-ink3">Rows</p>
          <p className="text-2xl font-extrabold tracking-tight text-ink mt-1">{profile.shape[0].toLocaleString()}</p>
        </div>
        <div className="rounded-2xl p-4 border border-line bg-card/70 backdrop-blur-xl">
          <p className="text-[11px] font-extrabold tracking-widest uppercase text-ink3">Columns</p>
          <p className="text-2xl font-extrabold tracking-tight text-ink mt-1">{profile.shape[1]}</p>
        </div>
        <div className="rounded-2xl p-4 border border-line bg-card/70 backdrop-blur-xl">
          <p className="text-[11px] font-extrabold tracking-widest uppercase text-ink3">Missing Values</p>
          <p className={`text-2xl font-extrabold tracking-tight mt-1 ${profile.total_missing > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>{profile.total_missing}</p>
        </div>
        <div className="rounded-2xl p-4 border border-line bg-card/70 backdrop-blur-xl">
          <p className="text-[11px] font-extrabold tracking-widest uppercase text-ink3">Memory</p>
          <p className="text-2xl font-extrabold tracking-tight text-ink mt-1">{profile.memory_usage_mb} <span className="text-sm font-bold text-ink3">MB</span></p>
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
