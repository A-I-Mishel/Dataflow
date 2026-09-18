import { useEffect, useState } from "react";

import Header from "./components/Header";
import NodePalette, { ITEMS as PALETTE_ITEMS } from "./components/NodePalette";
import PipelineCanvas from "./components/PipelineCanvas";
import RightPanel from "./components/RightPanel";
import { useRunPipeline } from "./hooks/useRunPipeline";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { usePipelineStore } from "./stores/pipelineStore";
import { Layers } from "lucide-react";
import { PanelRight } from "lucide-react";
import { Workflow } from "lucide-react";

type MobileView = "canvas" | "palette" | "panel";

const MOBILE_VIEWS: Array<{ key: MobileView; label: string; icon: typeof Workflow }> = [
  { key: "canvas", label: "Canvas", icon: Workflow },
  { key: "palette", label: "Palette", icon: Layers },
  { key: "panel", label: "Output", icon: PanelRight },
];

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

export default function App() {
  const { run, cancel } = useRunPipeline();
  const isMobile = useMediaQuery("(max-width: 1023px)");
  const theme = usePipelineStore((state) => state.theme);
  const [mobileView, setMobileView] = useState<MobileView>("canvas");

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.classList.toggle("dark", theme !== "light");
  }, [theme]);

  useEffect(() => {
    usePipelineStore.getState().checkSession();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        if (usePipelineStore.getState().isLoading) return;
        void run();
        return;
      }
      if (event.key === "Escape" && usePipelineStore.getState().isLoading) {
        event.preventDefault();
        cancel();
        return;
      }
      if (isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "z" && !event.shiftKey) {
        event.preventDefault();
        if (usePipelineStore.getState().past.length === 0) return;
        // Silent on purpose: undo is high-frequency and the canvas change
        // is its own feedback — a toast on every Ctrl+Z is pure noise.
        usePipelineStore.getState().undo();
      } else if (
        (event.ctrlKey || event.metaKey) &&
        (key === "y" || (key === "z" && event.shiftKey))
      ) {
        event.preventDefault();
        if (usePipelineStore.getState().future.length === 0) return;
        usePipelineStore.getState().redo();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        const { selectedNodeId, selectedEdgeId } = usePipelineStore.getState();
        if (selectedNodeId !== null) {
          event.preventDefault();
          usePipelineStore.getState().removeNode(selectedNodeId);
          usePipelineStore.getState().setSelectedNodeId(null);
        } else if (selectedEdgeId !== null) {
          event.preventDefault();
          usePipelineStore.getState().removeEdge(selectedEdgeId);
          usePipelineStore.getState().setSelectedEdgeId(null);
        }
      } else if (event.key === "Escape") {
        usePipelineStore.getState().setSelectedNodeId(null);
        usePipelineStore.getState().setSelectedEdgeId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [run, cancel]);

  if (isMobile) {
    return (
      <div className="relative flex min-h-screen flex-col bg-canvas text-ink">
        <div className="canvas-mesh" aria-hidden />
        <Header />
        <div className="flex-1 pb-16">
          {mobileView === "canvas" && (
            <div
              className="relative h-[calc(100vh-8rem)]"
              style={{ height: "calc(100dvh - 8rem)" }}
            >
              <PipelineCanvas onRequestPalette={() => setMobileView("palette")} />
            </div>
          )}
          {mobileView === "palette" && (
            <div className="overflow-y-auto p-2">
              <NodePalette onNodeAdded={() => setMobileView("canvas")} />
            </div>
          )}
          {mobileView === "panel" && (
            <div className="overflow-y-auto p-3">
              <RightPanel />
            </div>
          )}
        </div>
        <nav className="fixed bottom-0 left-0 right-0 z-20 flex h-16 flex-row border-t border-linesoft bg-panel">
          {MOBILE_VIEWS.map((view) => {
            const Icon = view.icon;
            const isActive = mobileView === view.key;
            return (
              <button
                key={view.key}
                type="button"
                onClick={() => setMobileView(view.key)}
                aria-label={`Show ${view.label}`}
                aria-pressed={isActive}
                className={`flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium ${
                  isActive ? "text-accenttext" : "text-ink3 hover:text-ink2"
                }`}
              >
                <Icon size={20} />
                {view.label}
              </button>
            );
          })}
        </nav>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-canvas text-ink lg:h-screen">
      <div className="canvas-mesh" aria-hidden />
      <Header />
      <div className="relative z-10 flex flex-1 flex-col lg:flex-row lg:overflow-hidden">
        <aside className="flex w-full shrink-0 flex-col overflow-hidden border-b border-line bg-panel/70 backdrop-blur-xl lg:m-3 lg:w-[280px] lg:rounded-2xl lg:border lg:border-b-0 lg:border-r lg:shadow-card">
          <div className="flex items-center justify-between border-b border-linesoft px-4 py-3.5">
            <h2 className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-ink3">
              Nodes
            </h2>
            <span className="rounded-full border border-line bg-elevated px-2 py-0.5 text-[11px] font-medium text-ink3">
              {PALETTE_ITEMS.length}
            </span>
          </div>
          <div className="custom-scroll max-h-64 overflow-y-auto p-3 lg:max-h-none lg:flex-1">
            <NodePalette />
          </div>
        </aside>

        <main className="relative h-[70vh] shrink-0 overflow-hidden border border-line bg-transparent lg:m-3 lg:h-auto lg:flex-1 lg:shrink lg:rounded-2xl lg:shadow-card">
          <PipelineCanvas />
        </main>

        <aside className="flex w-full shrink-0 flex-col overflow-hidden border-t border-line bg-panel/70 backdrop-blur-xl lg:m-3 lg:w-[380px] lg:rounded-2xl lg:border lg:border-l-0 lg:border-t-0 lg:shadow-card">
          <div className="flex items-center justify-between border-b border-linesoft px-4 py-3.5">
            <h2 className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-ink3">
              Output
            </h2>
            <span
              className="h-2 w-2 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"
              title="live"
            />
          </div>
          <div className="custom-scroll max-h-[70vh] overflow-y-auto p-3 lg:max-h-none lg:flex-1">
            <RightPanel />
          </div>
        </aside>
      </div>
    </div>
  );
}
