import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

import Header from './components/Header';
import NodePalette from './components/NodePalette';
import PipelineCanvas from './components/PipelineCanvas';
import RightPanel from './components/RightPanel';
import { useRunPipeline } from './hooks/useRunPipeline';
import { useMediaQuery } from './hooks/useMediaQuery';
import { usePipelineStore } from './stores/pipelineStore';
import { Layers } from 'lucide-react';
import { PanelRight } from 'lucide-react';
import { Workflow } from 'lucide-react';

type MobileView = 'canvas' | 'palette' | 'panel';

const MOBILE_VIEWS: Array<{ key: MobileView; label: string; icon: typeof Workflow }> = [
  { key: 'canvas', label: 'Canvas', icon: Workflow },
  { key: 'palette', label: 'Palette', icon: Layers },
  { key: 'panel', label: 'Output', icon: PanelRight },
];

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

export default function App() {
  const { run } = useRunPipeline();
  const isMobile = useMediaQuery('(max-width: 1023px)');
  const theme = usePipelineStore((state) => state.theme);
  const [mobileView, setMobileView] = useState<MobileView>('canvas');

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    document.documentElement.classList.toggle('dark', theme !== 'light');
  }, [theme]);

  useEffect(() => {
    usePipelineStore.getState().checkSession();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        void run();
        return;
      }
      if (isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        if (usePipelineStore.getState().past.length === 0) return;
        usePipelineStore.getState().undo();
        toast.success('Undo');
      } else if (
        (event.ctrlKey || event.metaKey) &&
        (key === 'y' || (key === 'z' && event.shiftKey))
      ) {
        event.preventDefault();
        if (usePipelineStore.getState().future.length === 0) return;
        usePipelineStore.getState().redo();
        toast.success('Redo');
      } else if (event.key === 'Delete') {
        const selectedNodeId = usePipelineStore.getState().selectedNodeId;
        if (selectedNodeId !== null) {
          usePipelineStore.getState().removeNode(selectedNodeId);
          usePipelineStore.getState().setSelectedNodeId(null);
        }
      } else if (event.key === 'Escape') {
        usePipelineStore.getState().setSelectedNodeId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [run]);

  if (isMobile) {
    return (
      <div className="flex flex-col min-h-screen bg-canvas text-ink relative">
        <div className="canvas-mesh" aria-hidden />
        <Header />
        <div className="flex-1 pb-16">
          {mobileView === 'canvas' && (
            <div
              className="relative h-[calc(100vh-8rem)]"
              style={{ height: 'calc(100dvh - 8rem)' }}
            >
              <PipelineCanvas onRequestPalette={() => setMobileView('palette')} />
            </div>
          )}
          {mobileView === 'palette' && (
            <div className="overflow-y-auto p-2">
              <NodePalette onNodeAdded={() => setMobileView('canvas')} />
            </div>
          )}
          {mobileView === 'panel' && (
            <div className="overflow-y-auto p-3">
              <RightPanel />
            </div>
          )}
        </div>
        <nav className="fixed bottom-0 left-0 right-0 h-16 bg-panel border-t border-linesoft flex flex-row z-20">
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
                className={`flex-1 flex flex-col items-center justify-center gap-1 text-xs font-medium ${
                  isActive ? 'text-indigo-500 dark:text-indigo-400' : 'text-ink3 hover:text-ink2'
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
    <div className="flex flex-col min-h-screen lg:h-screen bg-canvas text-ink relative overflow-hidden">
      <div className="canvas-mesh" aria-hidden />
      <Header />
      <div className="flex flex-1 flex-col lg:flex-row lg:overflow-hidden relative z-10">
        <aside className="w-full lg:w-[280px] border-b lg:border-b-0 lg:border-r border-white/[0.06] bg-panel/70 backdrop-blur-xl flex flex-col shrink-0 lg:m-3 lg:rounded-2xl lg:border lg:shadow-card overflow-hidden">
          <div className="px-4 py-3.5 flex items-center justify-between border-b border-white/[0.06]">
            <h2 className="text-[11px] font-extrabold tracking-[0.16em] text-ink3 uppercase">Nodes</h2>
            <span className="text-[11px] font-medium text-ink3 bg-elevated border border-line px-2 py-0.5 rounded-full">8</span>
          </div>
          <div className="overflow-y-auto p-3 max-h-64 lg:max-h-none lg:flex-1 custom-scroll">
            <NodePalette />
          </div>
        </aside>

        <main className="relative bg-transparent h-[70vh] lg:h-auto lg:flex-1 shrink-0 lg:shrink lg:m-3 lg:rounded-2xl overflow-hidden border border-white/[0.06] lg:shadow-card">
          <PipelineCanvas />
        </main>

        <aside className="w-full lg:w-[380px] border-t lg:border-t-0 lg:border-l-0 border-white/[0.06] bg-panel/70 backdrop-blur-xl flex flex-col shrink-0 lg:m-3 lg:rounded-2xl lg:border lg:shadow-card overflow-hidden">
          <div className="px-4 py-3.5 flex items-center justify-between border-b border-white/[0.06]">
            <h2 className="text-[11px] font-extrabold tracking-[0.16em] text-ink3 uppercase">Output</h2>
            <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse" title="live" />
          </div>
          <div className="overflow-y-auto p-3 max-h-[70vh] lg:max-h-none lg:flex-1 custom-scroll">
            <RightPanel />
          </div>
        </aside>
      </div>
    </div>
  );
}
