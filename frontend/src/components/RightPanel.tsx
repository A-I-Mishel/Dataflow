import { BarChart3 } from 'lucide-react';
import { Code } from 'lucide-react';
import { Table } from 'lucide-react';

import { selectIsResultStale, usePipelineStore } from '../stores/pipelineStore';
import type { ActiveTab } from '../stores/pipelineStore';
import type { ProfileData } from '../types';
import CodeView from './CodeView';
import DataTable from './DataTable';
import EmptyState from './EmptyState';
import ProfileView from './ProfileView';

const TABS: Array<{ key: ActiveTab; label: string; icon: typeof Table }> = [
  { key: 'preview', label: 'Preview', icon: Table },
  { key: 'profile', label: 'Profile', icon: BarChart3 },
  { key: 'code', label: 'Code', icon: Code },
];

function profileFromUpload(
  columns: string[],
  dtypes: Record<string, string>,
  rowCount: number,
  missingValues: Record<string, number>,
): ProfileData {
  const totalMissing = Object.values(missingValues).reduce((sum, value) => sum + value, 0);
  const profileColumns: ProfileData['columns'] = {};
  for (const column of columns) {
    const nullCount = missingValues[column] ?? 0;
    profileColumns[column] = {
      dtype: dtypes[column] ?? 'unknown',
      null_count: nullCount,
      null_pct: rowCount > 0 ? Math.round((nullCount / rowCount) * 10000) / 100 : 0,
      unique_count: 0,
    };
  }
  return {
    shape: [rowCount, columns.length],
    memory_usage_mb: 0,
    total_missing: totalMissing,
    columns: profileColumns,
  };
}

export default function RightPanel() {
  const activeTab = usePipelineStore((state) => state.activeTab);
  const setActiveTab = usePipelineStore((state) => state.setActiveTab);
  const resultData = usePipelineStore((state) => state.resultData);
  const originalData = usePipelineStore((state) => state.originalData);
  const generatedCode = usePipelineStore((state) => state.generatedCode);
  const isLoading = usePipelineStore((state) => state.isLoading);
  const isStale = usePipelineStore(selectIsResultStale);
  const viewingNodeId = usePipelineStore((state) => state.viewingNodeId);
  const setViewingNodeId = usePipelineStore((state) => state.setViewingNodeId);
  const nodes = usePipelineStore((state) => state.nodes);

  const viewingStep =
    viewingNodeId !== null
      ? (resultData?.intermediates?.find((step) => step.node_id === viewingNodeId) ?? null)
      : null;
  const viewingLabel =
    viewingNodeId !== null
      ? (nodes.find((node) => node.id === viewingNodeId)?.data.label ?? viewingNodeId)
      : null;

  const fallbackProfile =
    resultData === null && originalData !== null
      ? profileFromUpload(
          originalData.columns,
          originalData.dtypes,
          originalData.row_count,
          originalData.missing_values,
        )
      : null;

  const showSkeletons = isLoading && resultData === null;

  return (
    <div className="w-full h-full flex flex-col">
      <div className="p-2">
        <div className="flex gap-1 p-1 rounded-full bg-elevated border border-line">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold tracking-wide transition-all ${
                  isActive
                    ? 'bg-ink text-panel shadow-md'
                    : 'text-ink3 hover:text-ink hover:bg-card'
                }`}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === 'preview' &&
          (showSkeletons ? (
            <div className="space-y-2">
              <div className="h-10 bg-elevated rounded-2xl animate-pulse" />
              <div className="h-10 bg-elevated rounded-2xl animate-pulse" />
              <div className="h-10 bg-elevated rounded-2xl animate-pulse" />
            </div>
          ) : resultData ? (
            <div>
              {isStale && (
                <p className="mb-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-500">
                  Result is stale — re-run to refresh
                </p>
              )}
              {viewingStep !== null && viewingLabel !== null ? (
                <div>
                  <div className="mb-2 flex items-center gap-2 rounded-xl border border-line bg-elevated px-3 py-2">
                    <p className="text-xs font-semibold text-ink2">
                      Viewing: {viewingLabel} (output)
                    </p>
                    {viewingStep.approximate === true && (
                      <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold text-amber-500">
                        APPROXIMATE
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setViewingNodeId(null)}
                      className="ml-auto text-xs font-bold text-accent hover:underline"
                    >
                      Back to final result
                    </button>
                  </div>
                  <DataTable
                    data={viewingStep.preview}
                    columns={viewingStep.columns}
                    dtypes={viewingStep.dtypes}
                  />
                </div>
              ) : (
                <DataTable
                  data={resultData.preview}
                  columns={resultData.columns}
                  dtypes={resultData.dtypes}
                />
              )}
            </div>
          ) : originalData ? (
            <div>
              <p className="mb-2 rounded-xl border border-line bg-elevated px-3 py-2 text-xs font-semibold text-ink2">
                Original data (first {originalData.preview.length} rows) — run a
                pipeline to transform it
              </p>
              <DataTable
                data={originalData.preview}
                columns={originalData.columns}
                dtypes={originalData.dtypes}
              />
            </div>
          ) : (
            <EmptyState
              icon={Table}
              title="No Data Preview"
              description="Upload a CSV and run a pipeline to see results here."
            />
          ))}

        {activeTab === 'profile' &&
          (showSkeletons ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="h-24 bg-elevated rounded-2xl animate-pulse" />
              <div className="h-24 bg-elevated rounded-2xl animate-pulse" />
              <div className="h-24 bg-elevated rounded-2xl animate-pulse" />
              <div className="h-24 bg-elevated rounded-2xl animate-pulse" />
            </div>
          ) : resultData ? (
            <ProfileView profile={resultData.profile} />
          ) : fallbackProfile ? (
            <ProfileView profile={fallbackProfile} />
          ) : (
            <EmptyState
              icon={BarChart3}
              title="No Profile"
              description="Upload data to see profiling statistics."
            />
          ))}

        {activeTab === 'code' && <CodeView code={generatedCode} />}
      </div>
    </div>
  );
}
