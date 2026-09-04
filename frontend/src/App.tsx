import { useEffect } from 'react';
import toast from 'react-hot-toast';

import Header from './components/Header';
import NodePalette from './components/NodePalette';
import PipelineCanvas from './components/PipelineCanvas';
import RightPanel from './components/RightPanel';
import { useRunPipeline } from './hooks/useRunPipeline';
import { usePipelineStore } from './stores/pipelineStore';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

export default function App() {
  const { run } = useRunPipeline();

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
