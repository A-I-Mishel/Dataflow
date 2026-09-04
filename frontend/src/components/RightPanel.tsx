import { BarChart3 } from 'lucide-react';
import { Code } from 'lucide-react';
import { Table } from 'lucide-react';

import { usePipelineStore } from '../stores/pipelineStore';
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
      <div className="flex flex-row border-b border-slate-800">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-sm ${
                isActive
                  ? 'border-b-2 border-indigo-500 text-indigo-400 font-medium'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'preview' &&
          (showSkeletons ? (
            <div className="space-y-2">
              <div className="h-8 bg-slate-800 rounded animate-pulse" />
              <div className="h-8 bg-slate-800 rounded animate-pulse" />
              <div className="h-8 bg-slate-800 rounded animate-pulse" />
            </div>
          ) : resultData ? (
            <DataTable
              data={resultData.preview}
              columns={resultData.columns}
              dtypes={resultData.dtypes}
            />
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
              <div className="h-20 bg-slate-800 rounded-lg animate-pulse" />
              <div className="h-20 bg-slate-800 rounded-lg animate-pulse" />
              <div className="h-20 bg-slate-800 rounded-lg animate-pulse" />
              <div className="h-20 bg-slate-800 rounded-lg animate-pulse" />
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
