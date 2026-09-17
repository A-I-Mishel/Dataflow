import type { NodeType, PipelineEdge, PipelineNode } from '../types';
import { computeNodeSchemas } from './schema';

export interface NodeConfigError {
  nodeId: string;
  message: string;
}

// Local whitelist for saved-pipeline validation. NOTE: third copy of the
// node-type list (see NodeType in types/ and NODE_TYPES in PipelineCanvas) —
// consolidate to one exported constant if a tenth type is ever added.
const KNOWN_NODE_TYPES: readonly NodeType[] = [
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a saved pipeline payload before it touches the canvas. Throws a
 * plain Error describing the first problem — callers toast and refuse the
 * load, leaving the current canvas untouched. Shape + type whitelist + edge
 * references only; deep config checks already happen at run time.
 */
export function validateLoadedPipeline(data: unknown): {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
} {
  if (!isRecord(data)) throw new Error('Saved pipeline is corrupt: not an object');
  const { nodes, edges } = data;
  if (!Array.isArray(nodes)) throw new Error('Saved pipeline is corrupt: nodes missing');
  if (!Array.isArray(edges)) throw new Error('Saved pipeline is corrupt: edges missing');
  const ids = new Set<string>();
  for (const [index, node] of nodes.entries()) {
    if (!isRecord(node)) throw new Error(`Saved pipeline is corrupt: node ${index} malformed`);
    if (typeof node.id !== 'string' || node.id === '') {
      throw new Error(`Saved pipeline is corrupt: node ${index} has no id`);
    }
    if (ids.has(node.id)) throw new Error(`Saved pipeline is corrupt: duplicate node id "${node.id}"`);
    ids.add(node.id);
    if (typeof node.type !== 'string' || !(KNOWN_NODE_TYPES as readonly string[]).includes(node.type)) {
      throw new Error(
        `Saved pipeline uses unknown node type "${String(node.type)}" — it may come from a newer app version`,
      );
    }
    if (!isRecord(node.data) || !isRecord(node.data.config)) {
      throw new Error(`Saved pipeline is corrupt: node "${node.id}" has no config`);
    }
  }
  for (const [index, edge] of edges.entries()) {
    if (!isRecord(edge)) throw new Error(`Saved pipeline is corrupt: edge ${index} malformed`);
    if (typeof edge.source !== 'string' || typeof edge.target !== 'string') {
      throw new Error(`Saved pipeline is corrupt: edge ${index} has no endpoints`);
    }
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      throw new Error(
        `Saved pipeline is corrupt: edge ${index} references a missing node`,
      );
    }
  }
  return {
    nodes: nodes as PipelineNode[],
    edges: edges.map((edge) => {
      const record = edge as Record<string, unknown>;
      return {
        id: typeof record.id === 'string' ? record.id : `${record.source}-${record.target}`,
        source: record.source as string,
        target: record.target as string,
      };
    }),
  };
}

export function hasCycle(nodes: PipelineNode[], edges: PipelineEdge[]): boolean {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of edges) {
    const targets = adjacency.get(edge.source);
    if (targets !== undefined) {
      targets.push(edge.target);
    }
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  const visit = (nodeId: string): boolean => {
    visited.add(nodeId);
    inStack.add(nodeId);
    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (!visited.has(neighbor)) {
        if (visit(neighbor)) return true;
      } else if (inStack.has(neighbor)) {
        return true;
      }
    }
    inStack.delete(nodeId);
    return false;
  };

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      if (visit(node.id)) return true;
    }
  }
  return false;
}

/**
 * The engine applies nodes sequentially in topological order — it does not
 * branch or merge dataframes. Reject fork/merge/multi-root shapes up front
 * with messages that name the offending nodes.
 * Returns an error message, or null when the pipeline is a single chain.
 */
export function validateLinearChain(
  nodes: PipelineNode[],
  edges: PipelineEdge[],
): string | null {
  if (nodes.length <= 1) return null;
  const labelOf = (id: string): string => {
    const node = nodes.find((n) => n.id === id);
    if (node === undefined) return `"${id}"`;
    return node.data.label !== '' ? `"${node.data.label}"` : `"${node.id}"`;
  };
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  const targetsOf = new Map<string, string[]>();
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    outDegree.set(node.id, 0);
    targetsOf.set(node.id, []);
  }
  for (const edge of edges) {
    // Dangling refs are the backend/toposort's complaint, not ours.
    if (!inDegree.has(edge.source) || !inDegree.has(edge.target)) continue;
    outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    targetsOf.get(edge.source)?.push(edge.target);
  }
  const roots = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0);
  if (roots.length > 1) {
    const names = roots.map((n) => labelOf(n.id)).join(', ');
    return `Pipeline must be a single chain: ${roots.length} starting nodes (${names}). Connect them in one sequence.`;
  }
  const fork = nodes.find((n) => (outDegree.get(n.id) ?? 0) > 1);
  if (fork !== undefined) {
    const targets = (targetsOf.get(fork.id) ?? []).map(labelOf).join(', ');
    return `Node ${labelOf(fork.id)} splits into multiple branches (${targets}). Only linear chains are supported — remove the extra connections.`;
  }
  const merge = nodes.find((n) => (inDegree.get(n.id) ?? 0) > 1);
  if (merge !== undefined) {
    return `Node ${labelOf(merge.id)} has multiple incoming connections. Only linear chains are supported — keep one.`;
  }
  if (edges.length !== nodes.length - 1) {
    return (
      `Pipeline must be a single chain of ${nodes.length} nodes ` +
      `(${nodes.length - 1} connections), but found ${edges.length} connections.`
    );
  }
  return null;
}

export function getDisconnectedNodes(nodes: PipelineNode[], edges: PipelineEdge[]): string[] {
  if (nodes.length === 0) return [];
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
    inDegree.set(node.id, 0);
  }
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const reachable = new Set<string>();
  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }
  if (queue.length === 0 && nodes.length > 0) {
    return nodes.map((node) => node.id);
  }
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || reachable.has(current)) continue;
    reachable.add(current);
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!reachable.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }
  return nodes.filter((node) => !reachable.has(node.id)).map((node) => node.id);
}

/**
 * Extra hint for "unknown column" errors when the name is almost right:
 * surrounding whitespace or case-only differences (e.g. pasted "Name "
 * vs real "Name"). Returns "" when there is nothing to add.
 */
function unknownHint(unknown: string[], known: Set<string>): string {
  const hints: string[] = [];
  for (const name of unknown) {
    const trimmed = name.trim();
    if (trimmed !== name && known.has(trimmed)) {
      hints.push(`"${name}" has surrounding whitespace — did you mean "${trimmed}"?`);
      continue;
    }
    const caseMatch = Array.from(known).find(
      (candidate) => candidate.toLowerCase() === name.toLowerCase(),
    );
    if (caseMatch !== undefined && caseMatch !== name) {
      hints.push(`"${name}" differs only by case — did you mean "${caseMatch}"?`);
    }
  }
  return hints.length > 0 ? ` ${hints.join(' ')}` : '';
}

export function validateNodeConfigs(
  nodes: PipelineNode[],
  edges: PipelineEdge[],
  columnList: string[],
): NodeConfigError[] {
  const errors: NodeConfigError[] = [];
  // Each node is checked against its own input schema (base columns folded
  // through topological predecessors) — the same schemas the dropdowns
  // offer — so a correctly renamed column validates instead of erroring.
  // Pass pure base columns here: phantom names would otherwise propagate
  // into every downstream schema and weaken every check.
  const schemas = computeNodeSchemas(nodes, edges, columnList);

  for (const node of nodes) {
    const config = node.data.config;
    const known = new Set(schemas.get(node.id) ?? columnList);
    if (node.type === 'fill-na' && config.strategy === undefined) {
      errors.push({
        nodeId: node.id,
        message: `Node "${node.data.label}" needs a fill strategy (mean, median, mode, or constant)`,
      });
    }
    if (
      (node.type === 'normalize' || node.type === 'encode-categorical') &&
      config.method === undefined
    ) {
      errors.push({
        nodeId: node.id,
        message: `Node "${node.data.label}" needs a method selected`,
      });
    }
    if (config.columns !== undefined) {
      const unknownColumns = config.columns.filter((column) => !known.has(column));
      if (unknownColumns.length > 0) {
        errors.push({
          nodeId: node.id,
          message: `Node "${node.data.label}" references unknown columns: ${unknownColumns.join(', ')}.${unknownHint(unknownColumns, known)}`,
        });
      }
    }
    if (config.by !== undefined) {
      const unknownColumns = config.by.filter((column) => !known.has(column));
      if (unknownColumns.length > 0) {
        errors.push({
          nodeId: node.id,
          message: `Node "${node.data.label}" sorts by unknown columns: ${unknownColumns.join(', ')}.${unknownHint(unknownColumns, known)}`,
        });
      }
    }
    if (config.mapping !== undefined) {
      const unknownKeys = Object.keys(config.mapping).filter((key) => !known.has(key));
      if (unknownKeys.length > 0) {
        errors.push({
          nodeId: node.id,
          message: `Node "${node.data.label}" renames unknown columns: ${unknownKeys.join(', ')}.${unknownHint(unknownKeys, known)}`,
        });
      }
    }
    if (config.conditions !== undefined) {
      const unknownColumns = config.conditions
        .map((condition) => condition.column)
        .filter((column) => !known.has(column));
      if (unknownColumns.length > 0) {
        errors.push({
          nodeId: node.id,
          message: `Node "${node.data.label}" filters on unknown columns: ${unknownColumns.join(', ')}.${unknownHint(unknownColumns, known)}`,
        });
      }
    }
  }

  return errors;
}

export function getNodeErrors(
  node: PipelineNode,
  columnList: string[],
  inputSchema?: string[],
): string[] {
  const errors: string[] = [];
  const cfg = node.data.config;
  // Prefer the node's positional input schema when provided; the global
  // list describes the upload (or last result), not this point in the chain.
  const knownColumns = inputSchema ?? columnList;

  switch (node.type) {
    case 'fill-na':
      if (!cfg.strategy) errors.push('Select a fill strategy');
      break;
    case 'drop-column':
      if (!cfg.columns || cfg.columns.length === 0) errors.push('Select at least one column');
      break;
    case 'drop-duplicates':
      // Empty columns = whole-row dedup; always valid.
      break;
    case 'rename-column':
      if (!cfg.mapping || Object.keys(cfg.mapping).length === 0) {
        errors.push('Add at least one mapping');
      } else {
        for (const key of Object.keys(cfg.mapping)) {
          if (key.trim() !== key) {
            errors.push(`Mapping key "${key}" has surrounding whitespace`);
          }
        }
      }
      break;
    case 'filter-rows':
      if (!cfg.conditions || cfg.conditions.length === 0) {
        errors.push('Add at least one condition');
      } else {
        cfg.conditions.forEach((c, i) => {
          if (!c.column) errors.push(`Condition ${i + 1}: Select a column`);
          if (!c.operator) errors.push(`Condition ${i + 1}: Select an operator`);
        });
      }
      break;
    case 'normalize':
      if (!cfg.method) errors.push('Select a normalization method');
      break;
    case 'encode-categorical':
      // Empty columns = auto mode (backend encodes all object/category
      // columns), so it must not raise an error ring.
      if (!cfg.method) errors.push('Select an encoding method');
      break;
    case 'sort':
      if (!cfg.by || cfg.by.length === 0) errors.push('Select at least one sort column');
      break;
  }

  const colsToCheck = cfg.columns ?? cfg.by ?? [];
  colsToCheck.forEach((col) => {
    if (!knownColumns.includes(col)) errors.push(`Column "${col}" no longer exists`);
  });

  return errors;
}
