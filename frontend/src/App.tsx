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
  const [mobileView, setMobileView] = useState<MobileView>('canvas');

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
        usePipelineStore.getState().undo();
        toast.success('Undo');
      } else if (
        (event.ctrlKey || event.metaKey) &&
        (key === 'y' || (key === 'z' && event.shiftKey))
      ) {
        event.preventDefault();
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
      <div className="flex flex-col min-h-screen bg-slate-950 text-slate-100">
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
        <nav className="fixed bottom-0 left-0 right-0 h-16 bg-slate-900 border-t border-slate-800 flex flex-row z-20">
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
                  isActive ? 'text-indigo-400' : 'text-slate-500 hover:text-slate-300'
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
    <div className="flex flex-col min-h-screen lg:h-screen bg-slate-950 text-slate-100">
      <Header />
      <div className="flex flex-1 flex-col lg:flex-row lg:overflow-hidden">
        <aside className="w-full lg:w-64 border-b lg:border-b-0 lg:border-r border-slate-800 bg-slate-900 flex flex-col shrink-0">
          <div className="p-3 border-b border-slate-800">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Nodes
            </h2>
          </div>
          <div className="overflow-y-auto p-3 max-h-64 lg:max-h-none lg:flex-1">
            <NodePalette />
          </div>
        </aside>

        <main className="relative bg-slate-950 h-[70vh] lg:h-auto lg:flex-1 shrink-0 lg:shrink">
          <PipelineCanvas />
        </main>

        <aside className="w-full lg:w-96 border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-900 flex flex-col shrink-0">
          <div className="p-3 border-b border-slate-800">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Output
            </h2>
          </div>
          <div className="overflow-y-auto p-3 max-h-[70vh] lg:max-h-none lg:flex-1">
            <RightPanel />
          </div>
        </aside>
      </div>
    </div>
  );
}
