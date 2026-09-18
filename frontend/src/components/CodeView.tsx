import { Suspense, lazy } from "react";
import { saveAs } from "file-saver";
import { Code } from "lucide-react";
import toast from "react-hot-toast";

import EmptyState from "./EmptyState";
import { usePipelineStore } from "../stores/pipelineStore";

// Split Monaco (~2MB) out of the initial bundle — it loads on first visit
// to the Code tab instead of blocking first paint.
const MonacoEditor = lazy(() => import("@monaco-editor/react"));

interface CodeViewProps {
  code: string;
}

export default function CodeView({ code }: CodeViewProps) {
  const theme = usePipelineStore((state) => state.theme);
  if (code === "") {
    return (
      <EmptyState
        icon={Code}
        title="No Code Generated"
        description="Run a pipeline to generate Python code."
      />
    );
  }

  const handleCopy = (): void => {
    navigator.clipboard
      .writeText(code)
      .then(() => {
        toast.success("Code copied");
      })
      .catch(() => {
        toast.error("Copy failed");
      });
  };

  const handleDownload = (): void => {
    const blob = new Blob([code], { type: "text/x-python" });
    saveAs(blob, "cleaning_pipeline.py");
    toast.success("Script downloaded");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex flex-row gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-xs font-bold text-panel transition-colors hover:bg-ink/90"
        >
          Copy
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-4 py-2 text-xs font-bold text-ink2 transition-colors hover:border-accent/30 hover:text-ink"
        >
          Download .py
        </button>
      </div>
      <div className="min-h-[420px] flex-1 overflow-hidden rounded-2xl border border-line bg-panel shadow-card">
        <Suspense
          fallback={
            <div className="h-full min-h-[420px] animate-pulse bg-elevated/60 p-4">
              <div className="h-4 w-3/4 rounded bg-line/60" />
              <div className="mt-2 h-4 w-full rounded bg-line/40" />
              <div className="mt-2 h-4 w-5/6 rounded bg-line/40" />
              <div className="mt-2 h-4 w-2/3 rounded bg-line/40" />
            </div>
          }
        >
          <MonacoEditor
            height="100%"
            language="python"
            value={code}
            theme={theme === "light" ? "vs" : "vs-dark"}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              wordWrap: "on",
              automaticLayout: true,
            }}
          />
        </Suspense>
      </div>
    </div>
  );
}
