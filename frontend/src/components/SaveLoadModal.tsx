import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const [isSaving, setIsSaving] = useState(false);
  const nodes = usePipelineStore((state) => state.nodes);
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
    // Read fresh nodes/edges at click time to avoid stale closure if modal was open while canvas changed
    const { nodes: freshNodes, edges: freshEdges } = usePipelineStore.getState();
    if (trimmed === '' || freshNodes.length === 0 || isSaving) return;
    setIsSaving(true);
    savePipeline(trimmed, freshNodes, freshEdges)
      .then(() => getPipelines())
      .then((list) => {
        setSavedPipelines(list);
        setName('');
        setTab('load');
        toast.success(`Saved pipeline "${trimmed}"`);
      })
      .catch((error: unknown) => {
        toast.error(toMessage(error, 'Save failed'));
      })
      .finally(() => setIsSaving(false));
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

  if (typeof document === 'undefined') return null;
  const modal = (
    <div
      className="fixed inset-0 bg-[#050510]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-white/[0.08] rounded-[24px] w-[30rem] max-h-[82vh] flex flex-col shadow-card overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-1 m-2 rounded-full bg-elevated border border-white/[0.06] flex">
          <button
            type="button"
            onClick={() => setTab('save')}
            className={`flex-1 rounded-full px-4 py-2 text-sm font-bold transition-all ${
              tab === 'save'
                ? 'bg-ink text-panel shadow-md'
                : 'text-ink3 hover:text-ink'
            }`}
          >
            Save New
          </button>
          <button
            type="button"
            onClick={() => setTab('load')}
            className={`flex-1 rounded-full px-4 py-2 text-sm font-bold transition-all ${
              tab === 'load'
                ? 'bg-ink text-panel shadow-md'
                : 'text-ink3 hover:text-ink'
            }`}
          >
            Load Saved
          </button>
        </div>

        {tab === 'save' ? (
          <div className="p-5 space-y-4">
            <div>
              <p className="text-[11px] font-extrabold tracking-widest uppercase text-ink3 mb-2">Pipeline name</p>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleSave();
                  }
                }}
                placeholder="e.g. My Churn Cleaning"
                className="w-full rounded-2xl bg-elevated/60 border border-white/[0.06] px-4 py-3 text-sm text-ink placeholder:text-ink3 focus:outline-none focus:border-accent/40 focus:ring-4 focus:ring-accent/10"
              />
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={name.trim() === '' || nodes.length === 0 || isSaving}
              className={`w-full rounded-full px-4 py-3 text-sm font-extrabold transition-all inline-flex items-center justify-center gap-2 ${
                name.trim() === '' || nodes.length === 0 || isSaving
                  ? 'bg-elevated text-ink3 cursor-not-allowed border border-line'
                  : 'bg-gradient-to-r from-accent to-accent2 text-white shadow-glow hover:shadow-glow-lg hover:scale-[1.01] active:scale-[0.99]'
              }`}
            >
              {isSaving ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                  Saving…
                </>
              ) : (
                'Save Current Pipeline'
              )}
            </button>
            {nodes.length === 0 && <p className="text-xs text-center text-amber-500 font-medium">Add at least one node to save</p>}
          </div>
        ) : (
          <div className="p-5 overflow-y-auto">
            {savedPipelines.length === 0 ? (
              <div className="text-center py-8">
                <div className="mx-auto h-12 w-12 rounded-2xl bg-elevated border border-line grid place-items-center mb-3">📂</div>
                <p className="text-sm font-bold text-ink">No saved pipelines yet</p>
                <p className="text-xs text-ink3 mt-1">Save one from the Save New tab.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {savedPipelines.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-2xl bg-card border border-white/[0.06] px-4 py-3 hover:border-accent/20 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-ink truncate">
                        {item.name}
                      </p>
                      <p className="text-xs text-ink3">{timeAgo(item.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleLoad(item.id, item.name)}
                        className="rounded-full bg-ink text-panel hover:bg-ink/90 px-4 py-1.5 text-xs font-bold"
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item.id, item.name)}
                        className="rounded-full bg-elevated border border-line hover:border-red-500/30 px-3 py-1.5 text-xs font-bold text-ink3 hover:text-red-500"
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
  return createPortal(modal, document.body);
}
