import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import { Download } from 'lucide-react';
import { LayoutTemplate } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { Play } from 'lucide-react';
import { Redo2 } from 'lucide-react';
import { Save } from 'lucide-react';
import { Trash2 } from 'lucide-react';
import { Undo2 } from 'lucide-react';
import { Upload } from 'lucide-react';
import { Workflow } from 'lucide-react';
import toast from 'react-hot-toast';

import { useRunPipeline } from '../hooks/useRunPipeline';
import { downloadCSV, uploadFile } from '../lib/api';
import { usePipelineStore } from '../stores/pipelineStore';
import SaveLoadModal from './SaveLoadModal';

const REQUIREMENTS_TXT = 'pandas\nnumpy\nscikit-learn\n';

// Must stay in sync with backend MAX_UPLOAD_SIZE_BYTES.
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

function readmeText(): string {
  return [
    'DataFlow Cleaner export bundle',
    '===============================',
    '',
    'Files:',
    '- cleaned_data.csv .... full cleaned dataset (same as the app preview)',
    '- cleaning_pipeline.py  standalone script that reproduces the cleaning',
    '- requirements.txt .... Python dependencies for the script',
    '',
    'How to run the script:',
    '1. pip install -r requirements.txt',
    '2. Place your original CSV next to the script as data.csv',
    '   (or edit the filename passed to pd.read_csv in the script)',
    '3. python cleaning_pipeline.py',
    '4. The script writes cleaned_data.csv',
    '',
  ].join('\n');
}

export default function Header() {
  const nodes = usePipelineStore((state) => state.nodes);
  const sessionId = usePipelineStore((state) => state.sessionId);
  const resultData = usePipelineStore((state) => state.resultData);
  const generatedCode = usePipelineStore((state) => state.generatedCode);
  const isLoading = usePipelineStore((state) => state.isLoading);
  const resetPipeline = usePipelineStore((state) => state.resetPipeline);
  const setSession = usePipelineStore((state) => state.setSession);
  const pastLength = usePipelineStore((state) => state.past.length);
  const futureLength = usePipelineStore((state) => state.future.length);
  const undo = usePipelineStore((state) => state.undo);
  const redo = usePipelineStore((state) => state.redo);
  const loadTemplate = usePipelineStore((state) => state.loadTemplate);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { run } = useRunPipeline();

  const handleRun = (): void => {
    void run();
  };

  const handleClear = (): void => {
    const nodeCount = usePipelineStore.getState().nodes.length;
    if (nodeCount === 0) return;
    const confirmed = window.confirm(
      `Clear all ${nodeCount} node${nodeCount > 1 ? 's' : ''} and connections? This cannot be undone.`,
    );
    if (confirmed) {
      resetPipeline();
      toast.success('Canvas cleared');
    }
  };

  const handleUploadClick = (): void => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error('File too large. Maximum 200MB.');
      return;
    }
    setIsUploading(true);
    setUploadProgress(0);
    uploadFile(file, (percent) => setUploadProgress(percent))
      .then((data) => {
        setSession(data);
        toast.success(
          `Uploaded ${file.name} — ${data.row_count} rows, ${data.columns.length} columns`,
        );
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Upload failed';
        toast.error(message);
      })
      .finally(() => {
        setIsUploading(false);
        setUploadProgress(0);
      });
  };

  const handleExport = (): void => {
    if (sessionId === null || !resultData || generatedCode === '') return;
    setIsExporting(true);
    downloadCSV(sessionId)
      .then(async (blob) => {
        const zip = new JSZip();
        zip.file('cleaned_data.csv', blob);
        zip.file('cleaning_pipeline.py', generatedCode);
        zip.file('README.txt', readmeText());
        zip.file('requirements.txt', REQUIREMENTS_TXT);
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        saveAs(zipBlob, 'dataflow_cleaned_bundle.zip');
        toast.success('Export downloaded');
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Export failed';
        toast.error(message);
      })
      .finally(() => {
        setIsExporting(false);
      });
  };

  const runDisabled = sessionId === null || nodes.length === 0 || isLoading;
  const exportDisabled = !resultData || generatedCode === '' || isExporting;

  return (
    <header className="h-16 bg-slate-900 border-b border-slate-800 flex flex-row items-center justify-between gap-2 px-2 sm:px-4 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <Workflow size={24} className="text-indigo-400 shrink-0" />
        <span className="truncate text-base sm:text-xl font-bold text-slate-100">
          DataFlow Cleaner
        </span>
      </div>

      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        <button
          type="button"
          onClick={handleRun}
          disabled={runDisabled}
          className={`bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-2 ${
            runDisabled ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          <span className="hidden md:inline">{isLoading ? 'Running...' : 'Run Pipeline'}</span>
        </button>
        <button
          type="button"
          onClick={handleClear}
          className="bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg px-3 py-2 text-sm font-medium flex items-center gap-2"
        >
          <Trash2 size={16} />
          <span className="hidden md:inline">Clear Canvas</span>
        </button>
        <button
          type="button"
          onClick={undo}
          disabled={pastLength === 0}
          title="Undo (Ctrl+Z)"
          className={`bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg px-2.5 py-2 text-sm font-medium flex items-center ${
            pastLength === 0 ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={futureLength === 0}
          title="Redo (Ctrl+Shift+Z)"
          className={`bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg px-2.5 py-2 text-sm font-medium flex items-center ${
            futureLength === 0 ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          <Redo2 size={16} />
        </button>
      </div>

      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        <div className="relative">
          <button
            type="button"
            onClick={handleUploadClick}
            disabled={isUploading}
            className={`bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg px-3 py-2 text-sm font-medium flex items-center gap-2 ${
              isUploading ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {isUploading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Upload size={16} />
            )}
            <span className="hidden md:inline">Upload CSV</span>
          </button>
        {uploadProgress > 0 && uploadProgress < 100 && (
          <div className="absolute top-full left-0 right-0 mt-1">
            <div className="h-1 rounded bg-slate-700">
              <div
                className="h-1 rounded bg-indigo-500 transition-all"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <p className="mt-0.5 text-center text-[11px] text-slate-400">
              {uploadProgress}%
            </p>
          </div>
        )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          type="button"
          onClick={handleExport}
          disabled={exportDisabled}
          className={`bg-slate-700 text-slate-400 rounded-lg px-3 py-2 text-sm font-medium flex items-center gap-2 ${
            exportDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-600'
          }`}
        >
          {isExporting ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Download size={16} />
          )}
          <span className="hidden md:inline">Export</span>
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsTemplatesOpen((open) => !open)}
            className="bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg px-3 py-2 text-sm font-medium flex items-center gap-2"
          >
            <LayoutTemplate size={16} />
            <span className="hidden md:inline">Templates</span>
          </button>
          {isTemplatesOpen && (
            <>
              <button
                type="button"
                aria-label="Close templates menu"
                onClick={() => setIsTemplatesOpen(false)}
                className="fixed inset-0 z-10 cursor-default"
              />
              <div className="absolute right-0 top-full mt-1 w-64 z-20 rounded-lg border border-slate-700 bg-slate-800 shadow-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    loadTemplate('quick-clean');
                    setIsTemplatesOpen(false);
                    toast.success('Loaded quick-clean template');
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-slate-700"
                >
                  <p className="text-sm font-medium text-slate-200">Quick Clean</p>
                  <p className="text-xs text-slate-500">Drop Missing → Fill Missing → Sort</p>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    loadTemplate('full-clean');
                    setIsTemplatesOpen(false);
                    toast.success('Loaded full-clean template');
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-slate-700 border-t border-slate-700"
                >
                  <p className="text-sm font-medium text-slate-200">Full Clean</p>
                  <p className="text-xs text-slate-500">
                    Drop Missing → Fill Missing → Normalize → Encode
                  </p>
                </button>
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg px-3 py-2 text-sm font-medium flex items-center gap-2"
        >
          <Save size={16} />
          <span className="hidden md:inline">Save/Load</span>
        </button>
      </div>
      {isModalOpen && <SaveLoadModal onClose={() => setIsModalOpen(false)} />}
    </header>
  );
}
