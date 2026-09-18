import { useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { usePipelineStore } from "../stores/pipelineStore";
import type { ColumnProfile, ProfileData } from "../types";
import { dtypeBadgeClass } from "../lib/dtype";

interface ProfileViewProps {
  profile: ProfileData;
}

// Token-sourced so charts follow theme changes with no duplicated literals:
// recharts passes these strings straight to SVG/inline styles, where
// rgb(var(--*)) resolves against the current .light/.dark palette.
const TOOLTIP_STYLE: Record<string, string> = {
  backgroundColor: "rgb(var(--panel))",
  border: "1px solid rgb(var(--line))",
  borderRadius: "12px",
};
const TOOLTIP_LABEL_STYLE: Record<string, string> = { color: "rgb(var(--ink))" };
const AXIS_TICK = { fill: "rgb(var(--ink2))", fontSize: 11 };

function isNumericColumn(column: ColumnProfile): boolean {
  return column.histogram !== undefined && column.histogram !== null;
}

function ColumnCard({ name, column }: { name: string; column: ColumnProfile }) {
  const theme = usePipelineStore((state) => state.theme);
  const stats: Array<{ label: string; value: number | undefined }> = [
    { label: "Min", value: column.min },
    { label: "Max", value: column.max },
    { label: "Mean", value: column.mean },
    { label: "Median", value: column.median },
    { label: "Std", value: column.std },
  ];
  const numericStats = stats.filter((stat) => stat.value !== undefined);

  return (
    <div className="rounded-2xl border border-line bg-card/70 p-4 shadow-card backdrop-blur-xl">
      <div className="flex flex-row items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-extrabold tracking-tight text-ink">{name}</span>
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${dtypeBadgeClass(column.dtype, theme)}`}
          >
            {column.dtype}
          </span>
        </div>
        <span className="shrink-0 text-xs font-semibold text-ink3">
          {column.null_count} null ({column.null_pct}%)
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-elevated">
        <div
          className={`h-2 rounded-full transition-all ${column.null_count > 0 ? "bg-gradient-to-r from-rose-500 to-orange-500" : "bg-gradient-to-r from-emerald-500 to-teal-500"}`}
          style={{ width: `${Math.min(100, Math.max(0, column.null_pct))}%` }}
        />
      </div>

      {isNumericColumn(column) && numericStats.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {numericStats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-linesoft bg-elevated/60 px-2 py-1.5"
            >
              <p className="text-[10px] font-bold uppercase tracking-widest text-ink3">
                {stat.label}
              </p>
              <p className="text-xs font-bold text-ink">
                {typeof stat.value === "number" ? stat.value.toFixed(2) : ""}
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
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} />
              <Bar dataKey="count" fill="rgb(var(--accent))" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {column.date_min !== undefined && column.date_max !== undefined && (
        <p className="mt-2 text-xs text-ink3">
          {column.date_min} to {column.date_max}
        </p>
      )}

      {column.top_values !== undefined && column.top_values !== null && (
        <div className="mt-2 h-[120px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={column.top_values}>
              <XAxis type="number" hide={true} />
              <YAxis type="category" dataKey="value" width={80} tick={AXIS_TICK} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} />
              <Bar dataKey="count" fill="rgb(var(--ok))" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

type ColumnSort = "name" | "missing";

export default function ProfileView({ profile }: ProfileViewProps) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ColumnSort>("missing");

  const entries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = Object.entries(profile.columns).filter(([name]) =>
      needle === "" ? true : name.toLowerCase().includes(needle),
    );
    filtered.sort(([nameA, colA], [nameB, colB]) =>
      sort === "missing" ? colB.null_count - colA.null_count : nameA.localeCompare(nameB),
    );
    return filtered;
  }, [profile.columns, query, sort]);

  return (
    <div>
      <div className="mb-3 flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search columns…"
          aria-label="Search columns"
          className="min-w-0 flex-1 rounded-full border border-line bg-elevated/60 px-4 py-2 text-xs text-ink placeholder:text-ink3 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value === "name" ? "name" : "missing")}
          aria-label="Sort columns"
          className="shrink-0 rounded-full border border-line bg-elevated/60 px-3 py-2 text-xs font-bold text-ink2 focus:border-accent/50 focus:outline-none"
        >
          <option value="missing">Most missing</option>
          <option value="name">A–Z</option>
        </select>
      </div>
      <p className="mb-3 text-[11px] font-semibold tracking-wide text-ink3">
        {entries.length} of {Object.keys(profile.columns).length} columns
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-line bg-accentsoft p-4 backdrop-blur-xl">
          <p className="text-[11px] font-extrabold uppercase tracking-widest text-ink3">Rows</p>
          <p className="mt-1 text-2xl font-extrabold tracking-tight text-ink">
            {profile.shape[0].toLocaleString()}
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-card/70 p-4 backdrop-blur-xl">
          <p className="text-[11px] font-extrabold uppercase tracking-widest text-ink3">Columns</p>
          <p className="mt-1 text-2xl font-extrabold tracking-tight text-ink">{profile.shape[1]}</p>
        </div>
        <div className="rounded-2xl border border-line bg-card/70 p-4 backdrop-blur-xl">
          <p className="text-[11px] font-extrabold uppercase tracking-widest text-ink3">
            Missing Values
          </p>
          <p
            className={`mt-1 text-2xl font-extrabold tracking-tight ${profile.total_missing > 0 ? "text-warn" : "text-ok"}`}
          >
            {profile.total_missing}
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-card/70 p-4 backdrop-blur-xl">
          <p className="text-[11px] font-extrabold uppercase tracking-widest text-ink3">Memory</p>
          <p className="mt-1 text-2xl font-extrabold tracking-tight text-ink">
            {profile.memory_usage_mb === null ? (
              <span title="Not scanned before the first run">—</span>
            ) : (
              <>
                {profile.memory_usage_mb} <span className="text-sm font-bold text-ink3">MB</span>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {entries.length === 0 ? (
          <p className="rounded-2xl border border-line bg-elevated/60 px-4 py-6 text-center text-xs font-semibold text-ink3">
            No columns match “{query.trim()}”.
          </p>
        ) : (
          entries.map(([name, column]) => <ColumnCard key={name} name={name} column={column} />)
        )}
      </div>
    </div>
  );
}
