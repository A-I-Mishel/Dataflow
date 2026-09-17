import { useMemo } from 'react';

import { usePipelineStore } from '../stores/pipelineStore';
import type { PipelineEdge, PipelineNode } from '../types';

/**
 * Topological order mirroring backend/toposort.py (Kahn's algorithm with an
 * insertion-ordered queue), so the fold below visits nodes in exactly the
 * order the engine executes them. Never throws: on cycles, leftover nodes
 * are appended in listed order as a best effort (the run gate reports the
 * cycle separately).
 */
export function topoOrder(nodes: PipelineNode[], edges: PipelineEdge[]): PipelineNode[] {
  const byId = new Map<string, PipelineNode>();
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    byId.set(node.id, node);
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    adjacency.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const node of nodes) {
    if ((inDegree.get(node.id) ?? 0) === 0) queue.push(node.id);
  }
  const ordered: PipelineNode[] = [];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const node = byId.get(current);
    if (node !== undefined && !seen.has(current)) {
      seen.add(current);
      ordered.push(node);
    }
    for (const next of adjacency.get(current) ?? []) {
      const remaining = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  for (const node of nodes) {
    if (!seen.has(node.id)) ordered.push(node);
  }
  return ordered;
}

function applySchemaEffect(columns: string[], node: PipelineNode): string[] {
  const config = node.data.config;
  switch (node.type) {
    case 'drop-column': {
      const doomed = config.columns ?? [];
      if (doomed.length === 0) return columns;
      return columns.filter((column) => !doomed.includes(column));
    }
    case 'rename-column': {
      // Unknown keys pass through untouched — a typo must not crash the fold.
      const mapping = config.mapping ?? {};
      return columns.map((column) => mapping[column] ?? column);
    }
    case 'encode-categorical': {
      // One-hot with explicit columns destroys them into col_value dummies
      // whose names need real data to compute — drop, never fake.
      // Auto mode (empty columns) leaves the schema unchanged; the backend
      // remains source of truth at run time.
      const explicit = config.columns ?? [];
      if ((config.method ?? 'one-hot') === 'one-hot' && explicit.length > 0) {
        return columns.filter((column) => !explicit.includes(column));
      }
      return columns;
    }
    default:
      return columns;
  }
}

/**
 * Input schema (available columns) for every node: base columns folded
 * through all topological predecessors' effects. Because the engine applies
 * nodes sequentially in topo order, each node's dropdown options agree with
 * what the engine will actually consume — including on branched canvases.
 */
export function computeNodeSchemas(
  nodes: PipelineNode[],
  edges: PipelineEdge[],
  baseColumns: string[],
): Map<string, string[]> {
  const schemas = new Map<string, string[]>();
  let current = [...baseColumns];
  for (const node of topoOrder(nodes, edges)) {
    if (!schemas.has(node.id)) schemas.set(node.id, [...current]);
    current = applySchemaEffect(current, node);
  }
  for (const node of nodes) {
    if (!schemas.has(node.id)) schemas.set(node.id, [...baseColumns]);
  }
  return schemas;
}

/**
 * Options for a <select> that never silently deselect: schema columns first,
 * then any currently-selected values missing from the schema (rendered with
 * a "(missing)" suffix by the caller). Values stay raw — only labels change.
 */
export function withSelected(schema: string[], selected: string | string[]): string[] {
  const wanted = Array.isArray(selected) ? selected : [selected];
  const options = [...schema];
  for (const column of wanted) {
    if (column !== '' && !options.includes(column)) options.push(column);
  }
  return options;
}

export function isMissingOption(schema: string[], column: string): boolean {
  return column !== '' && !schema.includes(column);
}

/**
 * Columns available at the given node's input. Falls back to the global
 * list before any upload exists.
 */
export function useNodeColumns(nodeId: string): string[] {
  const nodes = usePipelineStore((state) => state.nodes);
  const edges = usePipelineStore((state) => state.edges);
  const originalData = usePipelineStore((state) => state.originalData);
  const columnList = usePipelineStore((state) => state.columnList);
  return useMemo(() => {
    const base = originalData !== null ? originalData.columns : columnList;
    return computeNodeSchemas(nodes, edges, base).get(nodeId) ?? base;
  }, [nodes, edges, originalData, columnList, nodeId]);
}
