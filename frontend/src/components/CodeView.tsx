import Editor from '@monaco-editor/react';
import { saveAs } from 'file-saver';
import { Code } from 'lucide-react';
import toast from 'react-hot-toast';

import EmptyState from './EmptyState';

interface CodeViewProps {
  code: string;
}

export default function CodeView({ code }: CodeViewProps) {
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
      <div className="flex flex-row gap-2 mb-2">
        <button
          type="button"
          onClick={handleCopy}
          className="bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium"
        >
          Copy
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium"
        >
          Download .py
        </button>
      </div>
      <div className="flex-1 min-h-[400px]">
        <Editor
          height="100%"
          language="python"
          value={code}
          theme="vs-dark"
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
