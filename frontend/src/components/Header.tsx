import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { saveAs } from "file-saver";
import JSZip from "jszip";
import { Download } from "lucide-react";
import { Keyboard } from "lucide-react";
import { LayoutTemplate } from "lucide-react";
import { Loader2 } from "lucide-react";
import { Moon } from "lucide-react";
import { Play } from "lucide-react";
import { Redo2 } from "lucide-react";
import { Save } from "lucide-react";
import { Sparkles } from "lucide-react";
import { Sun } from "lucide-react";
import { Trash2 } from "lucide-react";
import { Undo2 } from "lucide-react";
import { Upload } from "lucide-react";
import { X } from "lucide-react";
import toast from "react-hot-toast";

import { useConfirm } from "../hooks/useConfirm";
import { useRunPipeline } from "../hooks/useRunPipeline";
import { downloadCSV, uploadFile } from "../lib/api";
import { selectIsResultStale, usePipelineStore } from "../stores/pipelineStore";
import SaveLoadModal from "./SaveLoadModal";

const REQUIREMENTS_TXT = "pandas\nnumpy\nscikit-learn\n";
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

// Mirrors the key handler in App.tsx — update both together.
const SHORTCUTS: Array<{ action: string; keys: string[] }> = [
  { action: "Run pipeline", keys: ["Ctrl/⌘", "Enter"] },
  { action: "Cancel run / clear selection", keys: ["Esc"] },
  { action: "Undo", keys: ["Ctrl/⌘", "Z"] },
  { action: "Redo", keys: ["Ctrl/⌘", "Shift", "Z"] },
  { action: "Delete selection", keys: ["Del", "⌫"] },
];

function readmeText(): string {
  return [
    "DataFlow Cleaner export bundle",
    "===============================",
    "",
    "Files:",
    "- cleaned_data.csv .... full cleaned dataset (the app shows a preview of the first rows)",
    "- cleaning_pipeline.py  standalone script that reproduces the cleaning",
    "- requirements.txt .... Python dependencies for the script",
    "",
    "How to run the script:",
    "1. pip install -r requirements.txt",
    "2. Place your original CSV next to the script as data.csv",
    "3. python cleaning_pipeline.py",
    "4. The script writes cleaned_data.csv",
    "",
  ].join("\n");
}

export default function Header() {
  const nodes = usePipelineStore((state) => state.nodes);
  const sessionId = usePipelineStore((state) => state.sessionId);
  const resultData = usePipelineStore((state) => state.resultData);
  const generatedCode = usePipelineStore((state) => state.generatedCode);
  const isLoading = usePipelineStore((state) => state.isLoading);
  const resetPipeline = usePipelineStore((state) => state.resetPipeline);
  const setSession = usePipelineStore((state) => state.setSession);
  const originalData = usePipelineStore((state) => state.originalData);
  const clearSession = usePipelineStore((state) => state.clearSession);
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
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { run, cancel } = useRunPipeline();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const uploadAbortRef = useRef<AbortController | null>(null);

  const handleRun = (): void => {
    if (isLoading) {
      cancel();
      return;
    }
    void run();
  };
  const confirmDiscardIfNeeded = async (): Promise<boolean> => {
    if (usePipelineStore.getState().resultData === null) return true;
    return confirm({
      title: "Discard run result?",
      message: "This will discard the current run result (undo will not bring it back). Continue?",
      confirmLabel: "Discard",
      danger: true,
    });
  };
  const handleClear = (): void => {
    const nodeCount = usePipelineStore.getState().nodes.length;
    if (nodeCount === 0) return;
    void confirm({
      title: "Clear canvas?",
      message: `Clear all ${nodeCount} node${nodeCount > 1 ? "s" : ""} and connections? This cannot be undone.`,
      confirmLabel: "Clear",
      danger: true,
    }).then((confirmed) => {
      if (confirmed) {
        resetPipeline();
        toast.success("Canvas cleared");
      }
    });
  };
  const handleUploadClick = (): void => {
    if (isUploading) {
      uploadAbortRef.current?.abort();
      return;
    }
    fileInputRef.current?.click();
  };
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("File too large. Maximum 200MB.");
      return;
    }
    uploadAbortRef.current?.abort();
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setIsUploading(true);
    setUploadProgress(0);
    uploadFile(file, (percent) => setUploadProgress(percent), controller.signal)
      .then((data) => {
        setSession(data);
        toast.success(
          `Uploaded ${file.name} — ${data.row_count} rows, ${data.columns.length} columns`,
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          toast.success("Upload cancelled");
          return;
        }
        const message = error instanceof Error ? error.message : "Upload failed";
        toast.error(message);
      })
      .finally(() => {
        if (uploadAbortRef.current === controller) uploadAbortRef.current = null;
        setIsUploading(false);
        setUploadProgress(0);
      });
  };
  const handleUnload = (): void => {
    clearSession();
    toast.success("Dataset removed");
  };
  const handleExport = (): void => {
    if (sessionId === null || !resultData || generatedCode === "") return;
    setIsExporting(true);
    downloadCSV(sessionId)
      .then(async (blob) => {
        const zip = new JSZip();
        zip.file("cleaned_data.csv", blob);
        zip.file("cleaning_pipeline.py", generatedCode);
        zip.file("README.txt", readmeText());
        zip.file("requirements.txt", REQUIREMENTS_TXT);
        const zipBlob = await zip.generateAsync({ type: "blob" });
        saveAs(zipBlob, "dataflow_cleaned_bundle.zip");
        toast.success("Export downloaded");
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Export failed";
        toast.error(message);
      })
      .finally(() => {
        setIsExporting(false);
      });
  };

  const runBlocked = sessionId === null || nodes.length === 0;
  const runDisabled = runBlocked && !isLoading;
  const exportDisabled = !resultData || generatedCode === "" || isExporting;

  return (
    <header className="relative z-30 h-[64px] shrink-0 border-b border-linesoft bg-panel/80 backdrop-blur-xl">
      {/* gradient hairline */}
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
      <div className="flex h-full items-center justify-between gap-3 px-3 lg:px-5">
        {/* Brand */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="bg-accentbtn flex h-9 w-9 shrink-0 items-center justify-center rounded-xl opacity-95 shadow-sm">
            <Sparkles size={18} className="text-white" />
          </div>
          <div className="hidden min-w-0 sm:block">
            <p className="text-[16px] font-extrabold leading-none tracking-tight text-ink">
              DataFlow
            </p>
            <p className="mt-0.5 text-[11px] font-semibold uppercase leading-none tracking-[0.14em] text-ink3">
              Cleaner
            </p>
          </div>
          <span className="truncate text-[16px] font-extrabold tracking-tight text-ink sm:hidden">
            DataFlow
          </span>
          <span className="ml-2 hidden items-center gap-1.5 rounded-full border border-accent/20 bg-accent/10 px-2.5 py-1 lg:inline-flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            <span className="text-accenttext text-[11px] font-semibold tracking-wide">
              PIPELINE
            </span>
          </span>
        </div>

        {/* Center actions — grouped pill */}
        <div className="flex shrink-0 items-center gap-1.5 lg:gap-2">
          <button
            type="button"
            onClick={handleRun}
            disabled={runDisabled}
            title={
              isLoading
                ? "Cancel run (Esc)"
                : isStale
                  ? "Result is stale — re-run to refresh (Ctrl+Enter)"
                  : "Run pipeline (Ctrl+Enter)"
            }
            className={`relative inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold shadow-sm transition-all ${
              runDisabled
                ? "cursor-not-allowed bg-elevated text-ink3 opacity-50"
                : isLoading
                  ? "border border-line bg-card text-ink2 hover:border-accent/40 hover:text-ink"
                  : "bg-accentbtn hover:bg-accentbtnhover active:bg-accentbtnpressed text-white opacity-95 hover:opacity-100 hover:shadow-md active:scale-[0.98]"
            }`}
          >
            {isLoading ? <X size={16} /> : <Play size={16} className="fill-white" />}
            <span className="hidden md:inline">{isLoading ? "Cancel" : "Run Pipeline"}</span>
            {isStale && !isLoading && (
              <span
                title="Result is stale"
                className="absolute -right-1 -top-1 h-3 w-3 animate-pulse rounded-full bg-amber-400 ring-2 ring-panel"
              />
            )}
          </button>
          <div className="hidden items-center gap-1 rounded-full border border-line bg-card p-1 md:flex">
            <button
              type="button"
              onClick={handleClear}
              title="Clear canvas"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-ink2 transition-colors hover:bg-elevated"
            >
              <Trash2 size={14} /> Clear
            </button>
            <div className="h-4 w-px bg-line" />
            <button
              type="button"
              onClick={undo}
              disabled={pastLength === 0}
              title="Undo (Ctrl+Z)"
              className={`rounded-full p-1.5 ${pastLength === 0 ? "text-ink3 opacity-40" : "text-ink2 hover:bg-elevated"}`}
            >
              <Undo2 size={14} />
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={futureLength === 0}
              title="Redo (Ctrl+Shift+Z)"
              className={`rounded-full p-1.5 ${futureLength === 0 ? "text-ink3 opacity-40" : "text-ink2 hover:bg-elevated"}`}
            >
              <Redo2 size={14} />
            </button>
          </div>
        </div>

        {/* Right actions */}
        <div className="flex shrink-0 items-center gap-1.5 lg:gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            title={theme === "light" ? "Switch to dark" : "Switch to light"}
            aria-label="Toggle theme"
            className="grid h-9 w-9 place-items-center rounded-full border border-line bg-card text-ink2 transition-colors hover:border-accent/30 hover:text-ink"
          >
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setIsShortcutsOpen((o) => !o)}
              title="Keyboard shortcuts"
              aria-label="Keyboard shortcuts"
              aria-expanded={isShortcutsOpen}
              className="grid h-9 w-9 place-items-center rounded-full border border-line bg-card text-ink2 transition-colors hover:border-accent/30 hover:text-ink"
            >
              <Keyboard size={16} />
            </button>
            {isShortcutsOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setIsShortcutsOpen(false)}
                  className="fixed inset-0 z-10 cursor-default"
                />
                <div
                  role="dialog"
                  aria-label="Keyboard shortcuts"
                  onKeyDown={(event) => {
                    // Swallow Esc so the global handler doesn't also clear
                    // the canvas selection while dismissing this panel.
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      setIsShortcutsOpen(false);
                    }
                  }}
                  className="absolute right-0 top-full z-20 mt-2 w-72 overflow-hidden rounded-2xl border border-line bg-panel shadow-card"
                >
                  <div className="border-b border-linesoft px-4 py-3">
                    <p className="text-xs font-bold uppercase tracking-widest text-ink3">
                      Keyboard shortcuts
                    </p>
                  </div>
                  <ul className="space-y-2.5 px-4 py-3.5">
                    {SHORTCUTS.map((shortcut) => (
                      <li key={shortcut.action} className="flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold text-ink2">{shortcut.action}</span>
                        <span className="flex shrink-0 gap-1">
                          {shortcut.keys.map((key) => (
                            <kbd
                              key={key}
                              className="rounded-md border border-line bg-elevated px-1.5 py-0.5 font-mono text-[10px] font-medium text-ink"
                            >
                              {key}
                            </kbd>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>

          {originalData !== null && (
            <span
              title={originalData.filename ?? "Uploaded file"}
              className="inline-flex max-w-[8rem] items-center gap-2 rounded-full border border-line bg-card px-3.5 py-2 text-xs font-semibold text-ink2 sm:max-w-[16rem]"
            >
              <span className="truncate">{originalData.filename ?? "Uploaded file"}</span>
              <span className="hidden shrink-0 text-ink3 sm:inline">
                {originalData.row_count} rows · {originalData.columns.length} cols
              </span>
              <button
                type="button"
                onClick={handleUnload}
                title="Remove dataset"
                aria-label="Remove dataset"
                className="shrink-0 rounded-full p-0.5 text-ink3 transition-colors hover:text-red-500"
              >
                <X size={14} />
              </button>
            </span>
          )}

          <div className="relative">
            <button
              type="button"
              onClick={handleUploadClick}
              title={isUploading ? "Cancel upload" : "Upload CSV (max 200MB)"}
              className={`hidden items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors sm:inline-flex ${
                isUploading
                  ? "border-line bg-card text-ink2 hover:border-accent/40 hover:text-ink"
                  : "border-line bg-card text-ink2 hover:border-accent/40 hover:text-ink"
              }`}
            >
              {isUploading ? <X size={16} /> : <Upload size={16} />}
              {isUploading ? "Cancel" : "Upload CSV"}
            </button>
            <button
              type="button"
              onClick={handleUploadClick}
              title={isUploading ? "Cancel upload" : "Upload CSV"}
              aria-label={isUploading ? "Cancel upload" : "Upload CSV"}
              className="grid h-9 w-9 place-items-center rounded-full border border-line bg-card text-ink2 sm:hidden"
            >
              {isUploading ? <X size={16} /> : <Upload size={16} />}
            </button>
            {uploadProgress > 0 && uploadProgress < 100 && (
              <div className="absolute left-0 right-0 top-full mt-1.5">
                <div className="h-1 overflow-hidden rounded-full bg-line">
                  <div
                    className="bg-accentbtn h-full transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="mt-1 text-center text-[11px] font-medium text-ink3">
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
            title="Download bundle"
            className={`hidden items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors lg:inline-flex ${
              exportDisabled
                ? "cursor-not-allowed border-line bg-card text-ink3 opacity-50"
                : "border-line bg-card text-ink2 hover:border-accent/40 hover:text-ink"
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
              className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3.5 py-2 text-sm font-semibold text-ink2 transition-colors hover:border-accent/30 hover:text-ink"
            >
              <LayoutTemplate size={14} />
              <span className="hidden lg:inline">Templates</span>
            </button>
            {isTemplatesOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setIsTemplatesOpen(false)}
                  className="fixed inset-0 z-10 cursor-default"
                />
                <div className="absolute right-0 top-full z-20 mt-2 w-72 overflow-hidden rounded-2xl border border-line bg-panel shadow-card">
                  <div className="border-b border-linesoft px-4 py-3">
                    <p className="text-xs font-bold uppercase tracking-widest text-ink3">
                      Starter templates
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void confirmDiscardIfNeeded().then((ok) => {
                        if (!ok) return;
                        loadTemplate("quick-clean");
                        setIsTemplatesOpen(false);
                        toast.success("Loaded quick-clean template");
                      });
                    }}
                    className="group w-full px-4 py-3.5 text-left transition-colors hover:bg-elevated"
                  >
                    <p className="group-hover:text-accenttext text-sm font-semibold text-ink transition-colors">
                      Quick Clean
                    </p>
                    <p className="mt-0.5 text-xs text-ink3">Drop Missing → Fill Missing → Sort</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void confirmDiscardIfNeeded().then((ok) => {
                        if (!ok) return;
                        loadTemplate("full-clean");
                        setIsTemplatesOpen(false);
                        toast.success("Loaded full-clean template");
                      });
                    }}
                    className="group w-full border-t border-linesoft px-4 py-3.5 text-left transition-colors hover:bg-elevated"
                  >
                    <p className="group-hover:text-accenttext text-sm font-semibold text-ink transition-colors">
                      Full Clean
                    </p>
                    <p className="mt-0.5 text-xs text-ink3">
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
            title="Save / Load"
            className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-bold text-panel transition-colors hover:bg-ink/90"
          >
            <Save size={14} />
            <span className="hidden lg:inline">Save / Load</span>
          </button>
        </div>
      </div>
      {isModalOpen && <SaveLoadModal onClose={() => setIsModalOpen(false)} />}
      {confirmDialog}
    </header>
  );
}
