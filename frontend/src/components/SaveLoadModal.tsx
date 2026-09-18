import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";

import { useConfirm } from "../hooks/useConfirm";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { deletePipeline, getPipelines, loadPipeline, savePipeline } from "../lib/api";
import { validateLoadedPipeline } from "../lib/validatePipeline";
import { usePipelineStore } from "../stores/pipelineStore";

interface SaveLoadModalProps {
  onClose: () => void;
}

type ModalTab = "save" | "load";

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function SaveLoadModal({ onClose }: SaveLoadModalProps) {
  const [tab, setTab] = useState<ModalTab>("save");
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const nodes = usePipelineStore((state) => state.nodes);
  const savedPipelines = usePipelineStore((state) => state.savedPipelines);
  const setSavedPipelines = usePipelineStore((state) => state.setSavedPipelines);
  const setCanvas = usePipelineStore((state) => state.setCanvas);
  const { confirm, dialog: confirmDialog, isOpen: isConfirmOpen } = useConfirm();
  const nameInputRef = useRef<HTMLInputElement>(null);
  // Stack-aware: yields Tab to the nested confirm while it is open, and
  // restores focus to the Save/Load trigger on close.
  const trapRef = useFocusTrap<HTMLDivElement>({ initialFocus: nameInputRef });

  const refresh = useCallback((): void => {
    getPipelines()
      .then((list) => {
        setSavedPipelines(list);
      })
      .catch((error: unknown) => {
        toast.error(toMessage(error, "Failed to load pipelines"));
      });
  }, [setSavedPipelines]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // Let the nested confirm dialog own Esc while it is open.
      if (event.key === "Escape" && !isConfirmOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, isConfirmOpen]);

  const handleSave = (): void => {
    const trimmed = name.trim();
    // Read fresh nodes/edges at click time to avoid stale closure if modal was open while canvas changed
    const { nodes: freshNodes, edges: freshEdges } = usePipelineStore.getState();
    if (trimmed === "" || freshNodes.length === 0 || isSaving) return;
    setIsSaving(true);
    savePipeline(trimmed, freshNodes, freshEdges)
      .then(() => getPipelines())
      .then((list) => {
        setSavedPipelines(list);
        setName("");
        setTab("load");
        toast.success(`Saved pipeline "${trimmed}"`);
      })
      .catch((error: unknown) => {
        toast.error(toMessage(error, "Save failed"));
      })
      .finally(() => setIsSaving(false));
  };

  const handleLoad = (id: string, pipelineName: string): void => {
    const needsConfirm = usePipelineStore.getState().resultData !== null;
    const proceed = needsConfirm
      ? confirm({
          title: "Discard run result?",
          message:
            "This will discard the current run result (undo will not bring it back). Continue?",
          confirmLabel: "Discard",
          danger: true,
        })
      : Promise.resolve(true);
    void proceed.then((ok) => {
      if (!ok) return;
      loadPipeline(id)
        .then((data) => {
          let validated;
          try {
            validated = validateLoadedPipeline(data);
          } catch (error: unknown) {
            toast.error(toMessage(error, "Saved pipeline is corrupt"));
            return;
          }
          setCanvas(validated.nodes, validated.edges);
          toast.success(`Loaded pipeline "${pipelineName}"`);
          onClose();
        })
        .catch((error: unknown) => {
          toast.error(toMessage(error, "Load failed"));
        });
    });
  };

  const handleDelete = (id: string, pipelineName: string): void => {
    void confirm({
      title: "Delete saved pipeline?",
      message: `Delete saved pipeline "${pipelineName}"?`,
      confirmLabel: "Delete",
      danger: true,
    }).then((confirmed) => {
      if (!confirmed) return;
      deletePipeline(id)
        .then(() => getPipelines())
        .then((list) => {
          setSavedPipelines(list);
          toast.success(`Deleted pipeline "${pipelineName}"`);
        })
        .catch((error: unknown) => {
          toast.error(toMessage(error, "Delete failed"));
        });
    });
  };

  if (typeof document === "undefined") return null;
  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(var(--canvas)/0.72)] p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Save or load pipeline"
        className="flex max-h-[82vh] w-[30rem] flex-col overflow-hidden rounded-[24px] border border-line bg-panel shadow-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="m-2 flex rounded-full border border-line bg-elevated p-1">
          <button
            type="button"
            onClick={() => setTab("save")}
            className={`flex-1 rounded-full px-4 py-2 text-sm font-bold transition-all ${
              tab === "save" ? "bg-ink text-panel shadow-md" : "text-ink3 hover:text-ink"
            }`}
          >
            Save New
          </button>
          <button
            type="button"
            onClick={() => setTab("load")}
            className={`flex-1 rounded-full px-4 py-2 text-sm font-bold transition-all ${
              tab === "load" ? "bg-ink text-panel shadow-md" : "text-ink3 hover:text-ink"
            }`}
          >
            Load Saved
          </button>
        </div>

        {tab === "save" ? (
          <div className="space-y-4 p-5">
            <div>
              <label
                htmlFor="save-pipeline-name"
                className="mb-2 block text-[11px] font-extrabold uppercase tracking-widest text-ink3"
              >
                Pipeline name
              </label>
              <input
                ref={nameInputRef}
                id="save-pipeline-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    handleSave();
                  }
                }}
                placeholder="e.g. My Churn Cleaning"
                className="w-full rounded-2xl border border-line bg-elevated/60 px-4 py-3 text-sm text-ink placeholder:text-ink2 focus:border-accent/40 focus:outline-none focus:ring-4 focus:ring-accent/10"
              />
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={name.trim() === "" || nodes.length === 0 || isSaving}
              className={`inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-extrabold transition-all ${
                name.trim() === "" || nodes.length === 0 || isSaving
                  ? "cursor-not-allowed border border-line bg-elevated text-ink3"
                  : "bg-accentbtn text-white shadow-md hover:scale-[1.01] hover:bg-accentbtnhover active:scale-[0.99] active:bg-accentbtnpressed"
              }`}
            >
              {isSaving ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Saving…
                </>
              ) : (
                "Save Current Pipeline"
              )}
            </button>
            {nodes.length === 0 && (
              <p className="text-center text-xs font-medium text-warn">
                Add at least one node to save
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-y-auto p-5">
            {savedPipelines.length === 0 ? (
              <div className="py-8 text-center">
                <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl border border-line bg-elevated">
                  📂
                </div>
                <p className="text-sm font-bold text-ink">No saved pipelines yet</p>
                <p className="mt-1 text-xs text-ink3">Save one from the Save New tab.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {savedPipelines.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-card px-4 py-3 transition-colors hover:border-accent/20"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">{item.name}</p>
                      <p className="text-xs text-ink3">{timeAgo(item.created_at)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleLoad(item.id, item.name)}
                        className="rounded-full bg-ink px-4 py-1.5 text-xs font-bold text-panel hover:bg-ink/90"
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item.id, item.name)}
                        className="rounded-full border border-line bg-elevated px-3 py-1.5 text-xs font-bold text-ink3 hover:border-danger/30 hover:text-danger"
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
  return createPortal(
    <>
      {modal}
      {confirmDialog}
    </>,
    document.body,
  );
}
