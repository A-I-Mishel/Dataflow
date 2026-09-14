import Editor from '@monaco-editor/react';
import { saveAs } from 'file-saver';
import { Code } from 'lucide-react';
import toast from 'react-hot-toast';

import EmptyState from './EmptyState';
import { usePipelineStore } from '../stores/pipelineStore';

interface CodeViewProps {
  code: string;
}

export default function CodeView({ code }: CodeViewProps) {
  const theme = usePipelineStore((state) => state.theme);
  if (code === '') {
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
        toast.success('Code copied');
      })
      .catch(() => {
        toast.error('Copy failed');
      });
  };

  const handleDownload = (): void => {
    const blob = new Blob([code], { type: 'text/x-python' });
    saveAs(blob, 'cleaning_pipeline.py');
    toast.success('Script downloaded');
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-row gap-2 mb-3">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-full bg-ink text-panel px-4 py-2 text-xs font-bold hover:bg-ink/90 transition-colors"
        >
          Copy
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex items-center gap-1.5 rounded-full bg-card border border-line px-4 py-2 text-xs font-bold text-ink2 hover:border-accent/30 hover:text-ink transition-colors"
        >
          Download .py
        </button>
      </div>
      <div className="flex-1 min-h-[420px] rounded-2xl overflow-hidden border border-white/[0.06] shadow-card bg-panel">
        <Editor
          height="100%"
          language="python"
          value={code}
          theme={theme === 'light' ? 'vs' : 'vs-dark'}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 14,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
          }}
        />
      </div>
    </div>
  );
}
