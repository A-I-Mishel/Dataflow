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
  'rename-column',
  'filter-rows',
  'normalize',
  'encode-categorical',
  'sort',
];

const CLEANING_TYPES: NodeType[] = ['drop-na', 'fill-na', 'drop-column', 'rename-column'];
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
  const isLoading = usePipelineStore((state) => state.isLoading);
  const isMobile = useMediaQuery('(max-width: 1023px)');
  const wrapperRef = useRef<HTMLDivElement>(null);

  const nodeTypes = useMemo(
    () => ({
      'drop-na': DropNaNode,
      'fill-na': FillNaNode,
      'drop-column': DropColumnNode,
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
    <div ref={wrapperRef} className="absolute inset-0" onDoubleClick={handleDoubleClick}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
        onPaneClick={() => setSelectedNodeId(null)}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        zoomOnPinch={true}
        minZoom={0.2}
        maxZoom={4}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={12}
          size={1}
          color="#1e293b"
          className="bg-slate-950"
        />
        <Controls
          showZoom={true}
          showFitView={true}
          showInteractive={true}
          className="bg-slate-800 text-slate-200 border border-slate-700"
        />
        {!isMobile && (
          <MiniMap
            nodeColor={minimapNodeColor}
            maskColor="rgba(15, 23, 42, 0.8)"
            className="bg-slate-900 border border-slate-700 rounded-lg"
          />
        )}
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
            <div className="bg-slate-900/80 backdrop-blur-sm border border-slate-700 rounded-2xl px-8 py-6 text-center">
              <p className="text-slate-400 text-lg mb-2">
                Drag or tap a node from the palette to start
              </p>
              <p className="text-slate-600 text-sm">
                Connect nodes with arrows to build your pipeline
              </p>
            </div>
          </div>
        )}
      </ReactFlow>
      {isLoading && (
        <div className="absolute inset-0 bg-slate-950/50 flex flex-col items-center justify-center gap-3 z-10">
          <Loader2 size={32} className="text-indigo-400 animate-spin" />
          <p className="text-sm text-slate-300">Processing pipeline...</p>
        </div>
      )}
    </div>
  );
}
