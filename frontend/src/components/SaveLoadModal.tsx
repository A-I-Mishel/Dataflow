import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';

import { deletePipeline, getPipelines, loadPipeline, savePipeline } from '../lib/api';
import { usePipelineStore } from '../stores/pipelineStore';

interface SaveLoadModalProps {
  onClose: () => void;
}

type ModalTab = 'save' | 'load';

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function SaveLoadModal({ onClose }: SaveLoadModalProps) {
  const [tab, setTab] = useState<ModalTab>('save');
  const [name, setName] = useState('');
  const nodes = usePipelineStore((state) => state.nodes);
  const edges = usePipelineStore((state) => state.edges);
  const savedPipelines = usePipelineStore((state) => state.savedPipelines);
  const setSavedPipelines = usePipelineStore((state) => state.setSavedPipelines);
  const setCanvas = usePipelineStore((state) => state.setCanvas);

  const refresh = useCallback((): void => {
    getPipelines()
      .then((list) => {
        setSavedPipelines(list);
      })
      .catch((error: unknown) => {
        toast.error(toMessage(error, 'Failed to load pipelines'));
      });
  }, [setSavedPipelines]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const handleSave = (): void => {
    const trimmed = name.trim();
    if (trimmed === '' || nodes.length === 0) return;
    savePipeline(trimmed, nodes, edges)
      .then(() => getPipelines())
      .then((list) => {
        setSavedPipelines(list);
        setName('');
        toast.success(`Saved pipeline "${trimmed}"`);
      })
      .catch((error: unknown) => {
        toast.error(toMessage(error, 'Save failed'));
      });
  };

  const handleLoad = (id: string, pipelineName: string): void => {
    loadPipeline(id)
      .then((data) => {
        setCanvas(data.nodes, data.edges);
        toast.success(`Loaded pipeline "${pipelineName}"`);
        onClose();
      })
      .catch((error: unknown) => {
        toast.error(toMessage(error, 'Load failed'));
      });
  };

  const handleDelete = (id: string, pipelineName: string): void => {
    const confirmed = window.confirm(`Delete saved pipeline "${pipelineName}"?`);
    if (!confirmed) return;
    deletePipeline(id)
      .then(() => getPipelines())
      .then((list) => {
        setSavedPipelines(list);
        toast.success(`Deleted pipeline "${pipelineName}"`);
      })
      .catch((error: unknown) => {
        toast.error(toMessage(error, 'Delete failed'));
      });
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl w-[28rem] max-h-[80vh] flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-row border-b border-slate-800">
          <button
            type="button"
            onClick={() => setTab('save')}
            className={`flex-1 px-2 py-2.5 text-sm ${
              tab === 'save'
                ? 'border-b-2 border-indigo-500 text-indigo-400 font-medium'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Save New
          </button>
          <button
            type="button"
            onClick={() => setTab('load')}
            className={`flex-1 px-2 py-2.5 text-sm ${
              tab === 'load'
                ? 'border-b-2 border-indigo-500 text-indigo-400 font-medium'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Load Saved
          </button>
        </div>

        {tab === 'save' ? (
          <div className="p-4 space-y-3">
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleSave();
                }
              }}
              placeholder="Pipeline name"
              className="w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={name.trim() === '' || nodes.length === 0}
              className={`w-full rounded-lg px-3 py-2 text-sm font-medium text-white ${
                name.trim() === '' || nodes.length === 0
                  ? 'bg-indigo-600 opacity-50 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              Save Current Pipeline
            </button>
          </div>
        ) : (
          <div className="p-4 overflow-y-auto">
            {savedPipelines.length === 0 ? (
              <p className="text-sm text-slate-500">
                No saved pipelines yet. Save one from the &apos;Save New&apos; tab.
              </p>
            ) : (
              <div className="space-y-2">
                {savedPipelines.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-slate-800 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-200 truncate">
                        {item.name}
                      </p>
                      <p className="text-xs text-slate-500">{timeAgo(item.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleLoad(item.id, item.name)}
                        className="rounded-md bg-indigo-600 hover:bg-indigo-700 px-2.5 py-1.5 text-xs font-medium text-white"
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item.id, item.name)}
                        className="rounded-md bg-slate-700 hover:bg-slate-600 px-2.5 py-1.5 text-xs font-medium text-slate-200"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
