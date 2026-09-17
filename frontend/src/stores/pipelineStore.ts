import {
  applyEdgeChanges,
  applyNodeChanges,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type {
  DataPreview,
  ExecuteResponse,
  NodeType,
  PipelineEdge,
  PipelineNode,
  UploadResponse,
} from '../types';
import type { NodeConfig } from '../types';

export type ActiveTab = 'preview' | 'profile' | 'code';

export type Theme = 'dark' | 'light';

interface PipelineState {
  theme: Theme;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  sessionId: string | null;
  originalData: DataPreview | null;
  resultData: ExecuteResponse | null;
  generatedCode: string;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  isLoading: boolean;
  columnList: string[];
  activeTab: ActiveTab;
  resultVersion: number;
  editVersion: number;
  viewingNodeId: string | null;
  nodeStatus: Record<string, 'running' | 'done' | 'error'>;
  isLargeFile: boolean;
  addNode: (type: NodeType, position: { x: number; y: number }) => void;
  removeNode: (id: string) => void;
  removeEdge: (id: string) => void;
  updateNodeConfig: (id: string, config: Partial<NodeConfig>) => void;
  onConnect: (connection: { source: string; target: string }) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  setSession: (data: UploadResponse) => void;
  setResult: (data: ExecuteResponse) => void;
  setGeneratedCode: (code: string) => void;
  setLoading: (loading: boolean) => void;
  setSelectedNodeId: (id: string | null) => void;
  setSelectedEdgeId: (id: string | null) => void;
  setActiveTab: (tab: ActiveTab) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  resetPipeline: () => void;
  checkSession: () => void;
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  savedPipelines: ServerPipelineSummary[];
  undo: () => void;
  redo: () => void;
  loadTemplate: (templateName: string) => void;
  setSavedPipelines: (list: ServerPipelineSummary[]) => void;
  setCanvas: (nodes: PipelineNode[], edges: PipelineEdge[]) => void;
  setViewingNodeId: (id: string | null) => void;
  setAllNodeStatus: (status: 'running' | 'done' | 'error' | null) => void;
}

const NODE_LABELS: Record<NodeType, string> = {
  'drop-na': 'Drop NA',
  'fill-na': 'Fill NA',
  'drop-column': 'Drop Column',
  'drop-duplicates': 'Drop Duplicates',
  'rename-column': 'Rename Column',
  'filter-rows': 'Filter Rows',
  normalize: 'Normalize',
  'encode-categorical': 'Encode Categorical',
  sort: 'Sort',
};

const NODE_DEFAULT_CONFIGS: Record<NodeType, NodeConfig> = {
  'drop-na': {},
  'fill-na': { strategy: 'mean' },
  'drop-column': {},
  'drop-duplicates': {},
  'rename-column': {},
  'filter-rows': {},
  normalize: { method: 'min-max' },
  'encode-categorical': { method: 'one-hot' },
  sort: {},
};

export interface HistorySnapshot {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
}

export interface ServerPipelineSummary {
  id: string;
  name: string;
  created_at: string;
}

export function selectIsResultStale(state: {
  resultData: ExecuteResponse | null;
  resultVersion: number;
  editVersion: number;
}): boolean {
  return state.resultData !== null && state.editVersion !== state.resultVersion;
}

const TEMPLATES: Record<string, { nodes: PipelineNode[]; edges: PipelineEdge[] }> = {
  'quick-clean': {
    nodes: [
      {
        id: 'n1',
        type: 'drop-na',
        position: { x: 100, y: 100 },
        data: { label: 'Drop Missing', config: {} },
      },
      {
        id: 'n2',
        type: 'fill-na',
        position: { x: 100, y: 250 },
        data: { label: 'Fill Missing', config: { strategy: 'mean' } },
      },
      {
        id: 'n3',
        type: 'sort',
        position: { x: 100, y: 400 },
        data: { label: 'Sort', config: { by: [], ascending: true } },
      },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
    ],
  },
  'full-clean': {
    nodes: [
      {
        id: 'n1',
        type: 'drop-na',
        position: { x: 100, y: 100 },
        data: { label: 'Drop Missing', config: {} },
      },
      {
        id: 'n2',
        type: 'fill-na',
        position: { x: 100, y: 250 },
        data: { label: 'Fill Missing', config: { strategy: 'mean' } },
      },
      {
        id: 'n3',
        type: 'normalize',
        position: { x: 100, y: 400 },
        data: { label: 'Normalize', config: { method: 'min-max' } },
      },
      {
        id: 'n4',
        type: 'encode-categorical',
        position: { x: 100, y: 550 },
        data: { label: 'Encode Categories', config: { method: 'one-hot' } },
      },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n3', target: 'n4' },
    ],
  },
};

export const usePipelineStore = create<PipelineState>()(
  persist(
    (set, get) => ({
  theme: 'dark',
  nodes: [],
  edges: [],
  sessionId: null,
  originalData: null,
  resultData: null,
  generatedCode: '',
  selectedNodeId: null,
  selectedEdgeId: null,
  isLoading: false,
  columnList: [],
  activeTab: 'preview',
  resultVersion: 0,
  editVersion: 0,
  viewingNodeId: null,
  nodeStatus: {},
  isLargeFile: false,
  past: [],
  future: [],
  savedPipelines: [],

  addNode: (type, position) =>
    set((state) => ({
      past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
      future: [],
      editVersion: state.editVersion + 1,
      viewingNodeId: null,
      nodeStatus: {},
      nodes: [
        ...state.nodes,
        {
          id: crypto.randomUUID(),
          type,
          position,
          data: { label: NODE_LABELS[type], config: { ...NODE_DEFAULT_CONFIGS[type] } },
        },
      ],
    })),

  removeNode: (id) =>
    set((state) => {
      const edges = state.edges.filter(
        (edge) => edge.source !== id && edge.target !== id,
      );
      return {
        past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
        future: [],
        editVersion: state.editVersion + 1,
        viewingNodeId: state.viewingNodeId === id ? null : state.viewingNodeId,
        nodeStatus: {},
        nodes: state.nodes.filter((node) => node.id !== id),
        edges,
        selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
        selectedEdgeId:
          state.selectedEdgeId !== null &&
          edges.some((edge) => edge.id === state.selectedEdgeId)
            ? state.selectedEdgeId
            : null,
      };
    }),

  removeEdge: (id) =>
    set((state) => ({
      past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
      future: [],
      editVersion: state.editVersion + 1,
      viewingNodeId: null,
      nodeStatus: {},
      edges: state.edges.filter((edge) => edge.id !== id),
      selectedEdgeId: state.selectedEdgeId === id ? null : state.selectedEdgeId,
    })),

  updateNodeConfig: (id, config) =>
    set((state) => ({
      past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
      future: [],
      editVersion: state.editVersion + 1,
      viewingNodeId: null,
      nodeStatus: {},
      nodes: state.nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, config: { ...node.data.config, ...config } } }
          : node,
      ),
    })),

  onConnect: (connection) =>
    set((state) => {
      const id = `${connection.source}-${connection.target}`;
      const exists = state.edges.some(
        (edge) => edge.source === connection.source && edge.target === connection.target,
      );
      if (exists) return state;
      return {
        past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
        future: [],
        editVersion: state.editVersion + 1,
        viewingNodeId: null,
        nodeStatus: {},
        edges: [...state.edges, { id, source: connection.source, target: connection.target }],
      };
    }),

  onNodesChange: (changes) =>
    set((state) => {
      // Position drags and selection fire constantly — only structural
      // add/remove changes invalidate the last run result.
      const structural = changes.some(
        (change) => change.type === 'remove' || change.type === 'add',
      );
      return {
        nodes: applyNodeChanges(changes, state.nodes) as PipelineNode[],
        ...(structural
          ? { editVersion: state.editVersion + 1, viewingNodeId: null, nodeStatus: {} }
          : {}),
      };
    }),

  onEdgesChange: (changes) =>
    set((state) => {
      // Selection-only changes must not mark the result stale.
      const structural = changes.some((change) => change.type !== 'select');
      return {
        edges: applyEdgeChanges(changes, state.edges) as PipelineEdge[],
        ...(structural
          ? { editVersion: state.editVersion + 1, viewingNodeId: null, nodeStatus: {} }
          : {}),
      };
    }),

  setSession: (data) =>
    set({
      sessionId: data.session_id,
      originalData: data,
      columnList: data.columns,
      resultData: null,
      generatedCode: '',
      viewingNodeId: null,
      nodeStatus: {},
      isLargeFile: data.large === true,
    }),

  setResult: (data) =>
    set((state) => ({
      resultData: data,
      columnList: data.columns,
      viewingNodeId: null,
      // Sync versions: the result now reflects all edits so far.
      resultVersion: state.editVersion,
    })),

  setGeneratedCode: (code) => set({ generatedCode: code }),

  setLoading: (loading) => set({ isLoading: loading }),

  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  setSelectedEdgeId: (id) => set({ selectedEdgeId: id }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  setTheme: (theme) => {
    if (typeof document !== 'undefined') {
      // Token colors key off .light; a few `dark:` variants key off .dark.
      document.documentElement.classList.toggle('light', theme === 'light');
      document.documentElement.classList.toggle('dark', theme !== 'light');
    }
    set({ theme });
  },

  toggleTheme: () => {
    get().setTheme(get().theme === 'light' ? 'dark' : 'light');
  },

  resetPipeline: () =>
    set((state) => ({
      past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
      future: [],
      nodes: [],
      edges: [],
      resultData: null,
      generatedCode: '',
      selectedNodeId: null,
      selectedEdgeId: null,
      viewingNodeId: null,
      nodeStatus: {},
    })),

  checkSession: () => {
    const state = get();
    if (state.sessionId && !state.originalData) {
      // Session may have expired, but keep pipeline structure
      set({ sessionId: null, columnList: [], isLargeFile: false });
    }
  },

  undo: () =>
    set((state) => {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        past: state.past.slice(0, -1),
        future: [...state.future, { nodes: state.nodes, edges: state.edges }],
        nodes: previous.nodes,
        edges: previous.edges,
        selectedNodeId: null,
        selectedEdgeId: null,
        editVersion: state.editVersion + 1,
        viewingNodeId: null,
        nodeStatus: {},
      };
    }),

  redo: () =>
    set((state) => {
      if (state.future.length === 0) return state;
      const next = state.future[state.future.length - 1];
      return {
        past: [...state.past, { nodes: state.nodes, edges: state.edges }],
        future: state.future.slice(0, -1),
        nodes: next.nodes,
        edges: next.edges,
        selectedNodeId: null,
        selectedEdgeId: null,
        editVersion: state.editVersion + 1,
        viewingNodeId: null,
        nodeStatus: {},
      };
    }),

  loadTemplate: (templateName) =>
    set((state) => {
      const tpl = TEMPLATES[templateName];
      if (!tpl) return state;
      return {
        past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
        future: [],
        nodes: tpl.nodes,
        edges: tpl.edges,
        resultData: null,
        generatedCode: '',
        selectedNodeId: null,
        selectedEdgeId: null,
        viewingNodeId: null,
        nodeStatus: {},
      };
    }),

  setSavedPipelines: (list) => set({ savedPipelines: list }),

  setViewingNodeId: (id) => set({ viewingNodeId: id }),

  setAllNodeStatus: (status) =>
    set((state) => {
      if (status === null) return { nodeStatus: {} };
      const nodeStatus: Record<string, 'running' | 'done' | 'error'> = {};
      for (const node of state.nodes) {
        nodeStatus[node.id] = status;
      }
      return { nodeStatus };
    }),

  setCanvas: (nodes, edges) =>
    set((state) => ({
      past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
      future: [],
      nodes,
      edges,
      resultData: null,
      generatedCode: '',
      selectedNodeId: null,
      selectedEdgeId: null,
      viewingNodeId: null,
      nodeStatus: {},
    })),
    }),
    {
      name: 'dataflow-pipeline',
      partialize: (state) => ({
        theme: state.theme,
        nodes: state.nodes,
        edges: state.edges,
        sessionId: state.sessionId,
        columnList: state.columnList,
        originalData: state.originalData,
        isLargeFile: state.isLargeFile,
        // DO NOT persist: resultData, generatedCode (too large for localStorage)
      }),
    },
  ),
);
