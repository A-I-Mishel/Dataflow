import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import { Download } from 'lucide-react';
import { LayoutTemplate } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { Moon } from 'lucide-react';
import { Play } from 'lucide-react';
import { Redo2 } from 'lucide-react';
import { Save } from 'lucide-react';
import { Sparkles } from 'lucide-react';
import { Sun } from 'lucide-react';
import { Trash2 } from 'lucide-react';
import { Undo2 } from 'lucide-react';
import { Upload } from 'lucide-react';
import toast from 'react-hot-toast';

import { useRunPipeline } from '../hooks/useRunPipeline';
import { downloadCSV, uploadFile } from '../lib/api';
import { selectIsResultStale, usePipelineStore } from '../stores/pipelineStore';
import SaveLoadModal from './SaveLoadModal';

const REQUIREMENTS_TXT = 'pandas\nnumpy\nscikit-learn\n';
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

function readmeText(): string {
  return [
    'DataFlow Cleaner export bundle',
    '===============================',
    '',
    'Files:',
    '- cleaned_data.csv .... full cleaned dataset (the app shows a preview of the first rows)',
    '- cleaning_pipeline.py  standalone script that reproduces the cleaning',
    '- requirements.txt .... Python dependencies for the script',
    '',
    'How to run the script:',
    '1. pip install -r requirements.txt',
    '2. Place your original CSV next to the script as data.csv',
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
  const theme = usePipelineStore((state) => state.theme);
  const toggleTheme = usePipelineStore((state) => state.toggleTheme);
  const isStale = usePipelineStore(selectIsResultStale);
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
        toast.success(`Uploaded ${file.name} — ${data.row_count} rows, ${data.columns.length} columns`);
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
    <header className="h-[64px] shrink-0 relative z-30 border-b border-linesoft bg-panel/80 backdrop-blur-xl">
      {/* gradient hairline */}
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
      <div className="h-full flex items-center justify-between gap-3 px-3 lg:px-5">
        {/* Brand */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-accent to-accent2 flex items-center justify-center shadow-sm shrink-0 opacity-90">
            <Sparkles size={18} className="text-white" />
          </div>
          <div className="min-w-0 hidden sm:block">
            <p className="text-[16px] font-extrabold tracking-tight text-ink leading-none">DataFlow</p>
            <p className="text-[11px] font-semibold tracking-[0.14em] text-ink3 uppercase leading-none mt-0.5">Cleaner</p>
          </div>
          <span className="sm:hidden truncate text-[16px] font-extrabold tracking-tight text-ink">DataFlow</span>
          <span className="hidden lg:inline-flex ml-2 items-center gap-1.5 rounded-full bg-accent/10 border border-accent/20 px-2.5 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[11px] font-semibold text-accent tracking-wide">PIPELINE</span>
          </span>
        </div>

        {/* Center actions — grouped pill */}
        <div className="flex items-center gap-1.5 lg:gap-2 shrink-0">
          <button
            type="button"
            onClick={handleRun}
            disabled={runDisabled}
            title={isStale ? 'Result is stale — re-run to refresh (Ctrl+Enter)' : 'Run pipeline (Ctrl+Enter)'}
            className={`relative inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold shadow-sm transition-all ${
              runDisabled
                ? 'bg-elevated text-ink3 opacity-50 cursor-not-allowed'
                : 'bg-gradient-to-r from-accent to-accent2 text-white hover:shadow-md hover:brightness-[1.05] active:scale-[0.98] opacity-95 hover:opacity-100'
            }`}
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} className="fill-white" />}
            <span className="hidden md:inline">{isLoading ? 'Running…' : 'Run Pipeline'}</span>
            {isStale && !isLoading && (
              <span
                title="Result is stale"
                className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-amber-400 ring-2 ring-panel animate-pulse"
              />
            )}
          </button>
          <div className="hidden md:flex items-center gap-1 rounded-full bg-card border border-line p-1">
            <button
              type="button"
              onClick={handleClear}
              title="Clear canvas"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-ink2 hover:bg-elevated transition-colors"
            >
              <Trash2 size={14} /> Clear
            </button>
            <div className="w-px h-4 bg-line" />
            <button
              type="button"
              onClick={undo}
              disabled={pastLength === 0}
              title="Undo (Ctrl+Z)"
              className={`p-1.5 rounded-full ${pastLength === 0 ? 'text-ink3 opacity-40' : 'text-ink2 hover:bg-elevated'}`}
            >
              <Undo2 size={14} />
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={futureLength === 0}
              title="Redo (Ctrl+Shift+Z)"
              className={`p-1.5 rounded-full ${futureLength === 0 ? 'text-ink3 opacity-40' : 'text-ink2 hover:bg-elevated'}`}
            >
              <Redo2 size={14} />
            </button>
          </div>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1.5 lg:gap-2 shrink-0">
          <button
            type="button"
            onClick={toggleTheme}
            title={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
            aria-label="Toggle theme"
            className="h-9 w-9 grid place-items-center rounded-full bg-card border border-line text-ink2 hover:text-ink hover:border-accent/30 transition-colors"
          >
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={handleUploadClick}
              disabled={isUploading}
              title="Upload CSV (max 200MB)"
              className={`hidden sm:inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                isUploading
                  ? 'bg-card border-line text-ink3 opacity-60'
                  : 'bg-card border-line text-ink2 hover:border-accent/40 hover:text-ink'
              }`}
            >
              {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              Upload CSV
            </button>
            <button
              type="button"
              onClick={handleUploadClick}
              disabled={isUploading}
              className="sm:hidden h-9 w-9 grid place-items-center rounded-full bg-card border border-line text-ink2"
            >
              <Upload size={16} />
            </button>
            {uploadProgress > 0 && uploadProgress < 100 && (
              <div className="absolute top-full left-0 right-0 mt-1.5">
                <div className="h-1 rounded-full bg-line overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-accent to-accent2 transition-all" style={{ width: `${uploadProgress}%` }} />
                </div>
                <p className="mt-1 text-center text-[11px] font-medium text-ink3">{uploadProgress}%</p>
              </div>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />

          <button
            type="button"
            onClick={handleExport}
            disabled={exportDisabled}
            title="Download bundle"
            className={`hidden lg:inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border transition-colors ${
              exportDisabled
                ? 'bg-card border-line text-ink3 opacity-50 cursor-not-allowed'
                : 'bg-card border-line text-ink2 hover:border-accent/40 hover:text-ink'
            }`}
          >
            {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Export
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setIsTemplatesOpen((o) => !o)}
              title="Templates"
              className="inline-flex items-center gap-2 rounded-full bg-card border border-line px-3.5 py-2 text-sm font-semibold text-ink2 hover:border-accent/30 hover:text-ink transition-colors"
            >
              <LayoutTemplate size={14} />
              <span className="hidden lg:inline">Templates</span>
            </button>
            {isTemplatesOpen && (
              <>
                <button type="button" aria-label="Close" onClick={() => setIsTemplatesOpen(false)} className="fixed inset-0 z-10 cursor-default" />
                <div className="absolute right-0 top-full mt-2 w-72 z-20 rounded-2xl border border-line bg-panel shadow-card overflow-hidden">
                  <div className="px-4 py-3 border-b border-linesoft">
                    <p className="text-xs font-bold tracking-widest text-ink3 uppercase">Starter templates</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      loadTemplate('quick-clean');
                      setIsTemplatesOpen(false);
                      toast.success('Loaded quick-clean template');
                    }}
                    className="w-full text-left px-4 py-3.5 hover:bg-elevated transition-colors group"
                  >
                    <p className="text-sm font-semibold text-ink group-hover:text-accent transition-colors">Quick Clean</p>
                    <p className="text-xs text-ink3 mt-0.5">Drop Missing → Fill Missing → Sort</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      loadTemplate('full-clean');
                      setIsTemplatesOpen(false);
                      toast.success('Loaded full-clean template');
                    }}
                    className="w-full text-left px-4 py-3.5 hover:bg-elevated transition-colors border-t border-linesoft group"
                  >
                    <p className="text-sm font-semibold text-ink group-hover:text-accent transition-colors">Full Clean</p>
                    <p className="text-xs text-ink3 mt-0.5">Drop Missing → Fill Missing → Normalize → Encode</p>
                  </button>
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            title="Save / Load"
            className="inline-flex items-center gap-2 rounded-full bg-ink text-panel px-4 py-2 text-sm font-bold hover:bg-ink/90 transition-colors"
          >
            <Save size={14} />
            <span className="hidden lg:inline">Save / Load</span>
          </button>
        </div>
      </div>
      {isModalOpen && <SaveLoadModal onClose={() => setIsModalOpen(false)} />}
    </header>
  );
}
