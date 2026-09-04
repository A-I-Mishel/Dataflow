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

interface PipelineState {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  sessionId: string | null;
  originalData: DataPreview | null;
  resultData: ExecuteResponse | null;
  generatedCode: string;
  selectedNodeId: string | null;
  isLoading: boolean;
  columnList: string[];
  activeTab: ActiveTab;
  addNode: (type: NodeType, position: { x: number; y: number }) => void;
  removeNode: (id: string) => void;
  updateNodeConfig: (id: string, config: Partial<NodeConfig>) => void;
  onConnect: (connection: { source: string; target: string }) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  setSession: (data: UploadResponse) => void;
  setResult: (data: ExecuteResponse) => void;
  setGeneratedCode: (code: string) => void;
  setLoading: (loading: boolean) => void;
  setSelectedNodeId: (id: string | null) => void;
  setActiveTab: (tab: ActiveTab) => void;
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
}

const NODE_LABELS: Record<NodeType, string> = {
  'drop-na': 'Drop NA',
  'fill-na': 'Fill NA',
  'drop-column': 'Drop Column',
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
  nodes: [],
  edges: [],
  sessionId: null,
  originalData: null,
  resultData: null,
  generatedCode: '',
  selectedNodeId: null,
  isLoading: false,
  columnList: [],
  activeTab: 'preview',
  past: [],
  future: [],
  savedPipelines: [],

  addNode: (type, position) =>
    set((state) => ({
      past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
      future: [],
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
    set((state) => ({
      past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
      future: [],
      nodes: state.nodes.filter((node) => node.id !== id),
      edges: state.edges.filter((edge) => edge.source !== id && edge.target !== id),
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
    })),

  updateNodeConfig: (id, config) =>
    set((state) => ({
      past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
      future: [],
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
        edges: [...state.edges, { id, source: connection.source, target: connection.target }],
      };
    }),

  onNodesChange: (changes) =>
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes) as PipelineNode[],
    })),

  onEdgesChange: (changes) =>
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges) as PipelineEdge[],
    })),

  setSession: (data) =>
    set({
      sessionId: data.session_id,
      originalData: data,
      columnList: data.columns,
    }),

  setResult: (data) =>
    set({
      resultData: data,
      columnList: data.columns,
    }),

  setGeneratedCode: (code) => set({ generatedCode: code }),

  setLoading: (loading) => set({ isLoading: loading }),

  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  resetPipeline: () =>
    set((state) => ({
      past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
      future: [],
      nodes: [],
      edges: [],
      resultData: null,
      generatedCode: '',
      selectedNodeId: null,
    })),

  checkSession: () => {
    const state = get();
    if (state.sessionId && !state.originalData) {
      // Session may have expired, but keep pipeline structure
      set({ sessionId: null, columnList: [] });
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
      };
    }),

  setSavedPipelines: (list) => set({ savedPipelines: list }),

  setCanvas: (nodes, edges) =>
    set((state) => ({
      past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
      future: [],
      nodes,
      edges,
      resultData: null,
      generatedCode: '',
      selectedNodeId: null,
    })),
    }),
    {
      name: 'dataflow-pipeline',
      partialize: (state) => ({
        nodes: state.nodes,
        edges: state.edges,
        sessionId: state.sessionId,
        columnList: state.columnList,
        originalData: state.originalData,
        // DO NOT persist: resultData, generatedCode (too large for localStorage)
      }),
    },
  ),
);
