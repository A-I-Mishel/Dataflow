import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
} from '@xyflow/react';
import type { Connection, EdgeChange, NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useMemo, useRef } from 'react';
import type { DragEvent } from 'react';

import { Loader2 } from 'lucide-react';
import { usePipelineStore } from '../stores/pipelineStore';
import { useMediaQuery } from '../hooks/useMediaQuery';
import type { NodeType } from '../types';
import DropColumnNode from './nodes/DropColumnNode';
import DropDuplicatesNode from './nodes/DropDuplicatesNode';
import DropNaNode from './nodes/DropNaNode';
import EncodeNode from './nodes/EncodeNode';
import FillNaNode from './nodes/FillNaNode';
import FilterRowsNode from './nodes/FilterRowsNode';
import NormalizeNode from './nodes/NormalizeNode';
import RenameColumnNode from './nodes/RenameColumnNode';
import SortNode from './nodes/SortNode';

const NODE_TYPES: NodeType[] = [
  'drop-na',
  'fill-na',
  'drop-column',
  'drop-duplicates',
  'rename-column',
  'filter-rows',
  'normalize',
  'encode-categorical',
  'sort',
];

const CLEANING_TYPES: NodeType[] = [
  'drop-na',
  'fill-na',
  'drop-column',
  'drop-duplicates',
  'rename-column',
];
const TRANSFORM_TYPES: NodeType[] = ['filter-rows', 'normalize', 'sort'];

function minimapNodeColor(node: { type?: string }): string {
  const type = node.type;
  if (type === 'encode-categorical') return '#f97316';
  if (type !== undefined && (TRANSFORM_TYPES as string[]).includes(type)) return '#a855f7';
  if (type !== undefined && (CLEANING_TYPES as string[]).includes(type)) return '#3b82f6';
  return '#64748b';
}

export default function PipelineCanvas({
  onRequestPalette,
}: {
  onRequestPalette?: () => void;
}) {
  const nodes = usePipelineStore((state) => state.nodes);
  const edges = usePipelineStore((state) => state.edges);
  const onNodesChangeAction = usePipelineStore((state) => state.onNodesChange);
  const onEdgesChangeAction = usePipelineStore((state) => state.onEdgesChange);
  const onConnectAction = usePipelineStore((state) => state.onConnect);
  const addNode = usePipelineStore((state) => state.addNode);
  const setSelectedNodeId = usePipelineStore((state) => state.setSelectedNodeId);
  const setSelectedEdgeId = usePipelineStore((state) => state.setSelectedEdgeId);
  const setViewingNodeId = usePipelineStore((state) => state.setViewingNodeId);
  const setActiveTab = usePipelineStore((state) => state.setActiveTab);
  const isLoading = usePipelineStore((state) => state.isLoading);
  const isLargeFile = usePipelineStore((state) => state.isLargeFile);
  const theme = usePipelineStore((state) => state.theme);
  const isMobile = useMediaQuery('(max-width: 1023px)');
  const wrapperRef = useRef<HTMLDivElement>(null);

  const nodeTypes = useMemo(
    () => ({
      'drop-na': DropNaNode,
      'fill-na': FillNaNode,
      'drop-column': DropColumnNode,
      'drop-duplicates': DropDuplicatesNode,
      'rename-column': RenameColumnNode,
      'filter-rows': FilterRowsNode,
      normalize: NormalizeNode,
      'encode-categorical': EncodeNode,
      sort: SortNode,
    }),
    [],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChangeAction(changes);
    },
    [onNodesChangeAction],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChangeAction(changes);
    },
    [onEdgesChangeAction],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) {
        onConnectAction({ source: connection.source, target: connection.target });
      }
    },
    [onConnectAction],
  );

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: { nodes: { id: string }[]; edges: { id: string }[] }) => {
      // Single-selection UX: track the first selected node, else the first
      // selected edge, so Delete can remove either. Agrees with onNodeClick
      // (same node id) and pane-click clearing (empty selection).
      setSelectedNodeId(selectedNodes.length > 0 ? (selectedNodes[0]?.id ?? null) : null);
      setSelectedEdgeId(
        selectedNodes.length === 0 && selectedEdges.length > 0
          ? (selectedEdges[0]?.id ?? null)
          : null,
      );
    },
    [setSelectedNodeId, setSelectedEdgeId],
  );

  const handleNodeClick = useCallback(
    (_event: unknown, node: { id: string }) => {
      setSelectedNodeId(node.id);
      // After a run, clicking a node inspects that step's output.
      const intermediates = usePipelineStore.getState().resultData?.intermediates;
      if (intermediates?.some((step) => step.node_id === node.id) === true) {
        setViewingNodeId(node.id);
        setActiveTab('preview');
      }
    },
    [setSelectedNodeId, setViewingNodeId, setActiveTab],
  );

  const handleEdgeClick = useCallback(
    (_event: unknown, edge: { id: string }) => {
      // Clicking a thin edge must win over any still-selected node,
      // otherwise Delete keeps targeting the node and the edge feels stuck.
      setSelectedNodeId(null);
      setSelectedEdgeId(edge.id);
    },
    [setSelectedNodeId, setSelectedEdgeId],
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/reactflow');
      if (type === '' || !(NODE_TYPES as string[]).includes(type)) return;
      const bounds = wrapperRef.current?.getBoundingClientRect();
      const position =
        bounds === undefined
          ? { x: event.clientX, y: event.clientY }
          : { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      addNode(type as NodeType, position);
    },
    [addNode],
  );

  const handleDoubleClick = useCallback((): void => {
    // On touch screens double-tap is the fastest way to add a node:
    // open the palette so the next tap drops a node onto the canvas.
    // (Pinch-to-zoom is handled natively by React Flow via zoomOnPinch,
    // and connection handles are enlarged for coarse pointers in index.css.)
    if (isMobile) {
      onRequestPalette?.();
    }
  }, [isMobile, onRequestPalette]);

  return (
    <div ref={wrapperRef} className="absolute inset-0 bg-canvas flex flex-col" onDoubleClick={handleDoubleClick}>
      {isLargeFile && (
        <p className="shrink-0 border-b border-amber-400/30 bg-amber-400/10 px-4 py-2 text-center text-xs font-semibold text-amber-500 z-10">
          Large-file mode: processed in chunks. Sort / Normalize / Encode are disabled; step
          previews are approximate.
        </p>
      )}
      <div className="relative flex-1">
      {/* mesh behind canvas */}
      <div className="canvas-mesh" aria-hidden />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        proOptions={{ hideAttribution: true }}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onSelectionChange={handleSelectionChange}
        deleteKeyCode={['Backspace', 'Delete']}
        onPaneClick={() => {
          setSelectedNodeId(null);
          setSelectedEdgeId(null);
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        zoomOnDoubleClick={!isMobile}
        zoomOnPinch={true}
        minZoom={0.2}
        maxZoom={4}
        defaultEdgeOptions={{ type: 'smoothstep', animated: isLoading, interactionWidth: 20 }}
        colorMode={theme}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1.1}
          color={theme === 'light' ? 'rgba(150,165,185,0.55)' : 'rgba(70,85,110,0.5)'}
          className="bg-transparent"
        />
        <Controls
          showZoom={true}
          showFitView={true}
          showInteractive={true}
          className="rounded-2xl border border-line shadow-card backdrop-blur-md overflow-hidden opacity-90"
        />
        {!isMobile && (
          <MiniMap
            nodeColor={minimapNodeColor}
            maskColor={theme === 'light' ? 'rgba(235, 239, 244, 0.9)' : 'rgba(12, 16, 23, 0.82)'}
            className="rounded-2xl border border-line shadow-card overflow-hidden backdrop-blur-md opacity-90"
          />
        )}
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 pointer-events-none z-10">
            <div className="max-w-[420px] w-full rounded-[28px] border border-line bg-panel/75 backdrop-blur-xl shadow-card p-8 text-center">
              <div className="mx-auto h-14 w-14 rounded-2xl bg-accentbtn grid place-items-center shadow-sm mb-5">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.93 19.07l2.83-2.83"/><path d="M16.24 7.76l2.83-2.83"/></svg>
              </div>
              <h3 className="text-[18px] font-extrabold tracking-tight text-ink">Build your pipeline</h3>
              <p className="text-sm text-ink2 mt-1.5 leading-relaxed">
                Drag nodes from the left palette onto the canvas. Connect them with arrows — order matters.
              </p>
              <div className="mt-5 flex items-center justify-center gap-2 text-[11px] font-medium tracking-wide text-ink3">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-elevated border border-line px-2.5 py-1"><span className="h-1.5 w-1.5 rounded-full bg-accent/70" /> Drag to add</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-elevated border border-line px-2.5 py-1"><span className="h-1.5 w-1.5 rounded-full bg-accent/70" /> Connect</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-accentbtn text-white px-2.5 py-1 shadow-sm">Run ▶</span>
              </div>
              <p className="text-[11px] text-ink3 mt-3">Tip: double-tap canvas on mobile to open palette</p>
            </div>
          </div>
        )}
      </ReactFlow>
      {isLoading && (
        <div className="absolute inset-0 bg-canvas/60 backdrop-blur-[2px] flex flex-col items-center justify-center gap-3 z-10">
          <div className="h-12 w-12 rounded-2xl bg-accentbtn grid place-items-center shadow-sm animate-pulse">
            <Loader2 size={22} className="text-white animate-spin" />
          </div>
          <p className="text-sm font-semibold text-ink2">Running pipeline…</p>
          <p className="text-xs text-ink3">
            {isLargeFile ? 'Large file: processing in chunks' : 'Crunching your data'}
          </p>
        </div>
      )}
      </div>
    </div>
  );
}
