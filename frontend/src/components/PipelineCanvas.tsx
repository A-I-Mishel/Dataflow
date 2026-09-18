import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow } from "@xyflow/react";
import type { Connection, EdgeChange, NodeChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useMemo, useRef } from "react";
import type { DragEvent } from "react";

import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";

import { cancelRun } from "../hooks/useRunPipeline";
import { LARGE_BLOCKED_MESSAGE, LARGE_BLOCKED_TYPES } from "../lib/pipelineConfig";
import { usePipelineStore } from "../stores/pipelineStore";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { NODE_TYPES } from "../types";
import type { NodeType } from "../types";
import FitOnLoad from "./FitOnLoad";
import DropColumnNode from "./nodes/DropColumnNode";
import DropDuplicatesNode from "./nodes/DropDuplicatesNode";
import DropNaNode from "./nodes/DropNaNode";
import EncodeNode from "./nodes/EncodeNode";
import FillNaNode from "./nodes/FillNaNode";
import FilterRowsNode from "./nodes/FilterRowsNode";
import NormalizeNode from "./nodes/NormalizeNode";
import RenameColumnNode from "./nodes/RenameColumnNode";
import SortNode from "./nodes/SortNode";

const CLEANING_TYPES: NodeType[] = [
  "drop-na",
  "fill-na",
  "drop-column",
  "drop-duplicates",
  "rename-column",
];
const TRANSFORM_TYPES: NodeType[] = ["filter-rows", "normalize", "sort"];

function minimapNodeColor(node: { type?: string }): string {
  const type = node.type;
  if (type === "encode-categorical") return "#f97316";
  if (type !== undefined && (TRANSFORM_TYPES as string[]).includes(type)) return "#a855f7";
  if (type !== undefined && (CLEANING_TYPES as string[]).includes(type)) return "#3b82f6";
  return "#64748b";
}

export default function PipelineCanvas({ onRequestPalette }: { onRequestPalette?: () => void }) {
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
  const isMobile = useMediaQuery("(max-width: 1023px)");
  const wrapperRef = useRef<HTMLDivElement>(null);

  const nodeTypes = useMemo(
    () => ({
      "drop-na": DropNaNode,
      "fill-na": FillNaNode,
      "drop-column": DropColumnNode,
      "drop-duplicates": DropDuplicatesNode,
      "rename-column": RenameColumnNode,
      "filter-rows": FilterRowsNode,
      normalize: NormalizeNode,
      "encode-categorical": EncodeNode,
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
    ({
      nodes: selectedNodes,
      edges: selectedEdges,
    }: {
      nodes: { id: string }[];
      edges: { id: string }[];
    }) => {
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
        setActiveTab("preview");
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
    event.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/reactflow");
      if (type === "" || !(NODE_TYPES as readonly string[]).includes(type)) return;
      if (isLargeFile && LARGE_BLOCKED_TYPES.has(type as NodeType)) {
        toast.error(LARGE_BLOCKED_MESSAGE);
        return;
      }
      const bounds = wrapperRef.current?.getBoundingClientRect();
      const position =
        bounds === undefined
          ? { x: event.clientX, y: event.clientY }
          : { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      addNode(type as NodeType, position);
    },
    [addNode, isLargeFile],
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
    <div
      ref={wrapperRef}
      className="absolute inset-0 flex flex-col bg-canvas"
      onDoubleClick={handleDoubleClick}
    >
      {isLargeFile && (
        <p className="z-10 shrink-0 border-b border-amber-400/30 bg-amber-400/10 px-4 py-2 text-center text-xs font-semibold text-amber-500">
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
          // Deletion is owned solely by App.tsx's key handler (which pushes
          // undo history via removeNode/removeEdge). ReactFlow's built-in
          // delete would bypass history via onNodesChange, causing
          // double-handling — so it stays disabled.
          deleteKeyCode={[]}
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
          defaultEdgeOptions={{ type: "smoothstep", animated: isLoading, interactionWidth: 20 }}
          colorMode={theme}
        >
          <FitOnLoad />
          <Background
            variant={BackgroundVariant.Dots}
            gap={16}
            size={1.1}
            color={theme === "light" ? "rgba(150,165,185,0.55)" : "rgba(12, 16, 23, 0.82)"}
            className="bg-transparent"
          />
          <Controls
            showZoom={true}
            showFitView={true}
            showInteractive={true}
            className="overflow-hidden rounded-2xl border border-line opacity-90 shadow-card backdrop-blur-md"
          />
          {!isMobile && (
            <MiniMap
              nodeColor={minimapNodeColor}
              maskColor={theme === "light" ? "rgba(235, 239, 244, 0.9)" : "rgba(12, 16, 23, 0.82)"}
              className="overflow-hidden rounded-2xl border border-line opacity-90 shadow-card backdrop-blur-md"
            />
          )}
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center p-6">
              <div className="w-full max-w-[420px] rounded-[28px] border border-line bg-panel/75 p-8 text-center shadow-card backdrop-blur-xl">
                <div className="bg-accentbtn mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl shadow-sm">
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 2v4" />
                    <path d="M12 18v4" />
                    <path d="M4.93 4.93l2.83 2.83" />
                    <path d="M16.24 16.24l2.83 2.83" />
                    <path d="M2 12h4" />
                    <path d="M18 12h4" />
                    <path d="M4.93 19.07l2.83-2.83" />
                    <path d="M16.24 7.76l2.83-2.83" />
                  </svg>
                </div>
                <h3 className="text-[18px] font-extrabold tracking-tight text-ink">
                  Build your pipeline
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink2">
                  Drag nodes from the left palette onto the canvas. Connect them with arrows — order
                  matters.
                </p>
                <div className="mt-5 flex items-center justify-center gap-2 text-[11px] font-medium tracking-wide text-ink3">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-elevated px-2.5 py-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent/70" /> Drag to add
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-elevated px-2.5 py-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent/70" /> Connect
                  </span>
                  <span className="bg-accentbtn inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-white shadow-sm">
                    Run ▶
                  </span>
                </div>
                <p className="mt-3 text-[11px] text-ink3">
                  Tip: double-tap canvas on mobile to open palette
                </p>
              </div>
            </div>
          )}
        </ReactFlow>
        {isLoading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-canvas/60 backdrop-blur-[2px]">
            <div className="bg-accentbtn grid h-12 w-12 animate-pulse place-items-center rounded-2xl shadow-sm">
              <Loader2 size={22} className="animate-spin text-white" />
            </div>
            <p className="text-sm font-semibold text-ink2">Running pipeline…</p>
            <p className="text-xs text-ink3">
              {isLargeFile ? "Large file: processing in chunks" : "Crunching your data"}
            </p>
            <button
              type="button"
              onClick={cancelRun}
              className="mt-1 rounded-full border border-line bg-card px-4 py-2 text-xs font-bold text-ink2 transition-colors hover:border-accent/40 hover:text-ink"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
