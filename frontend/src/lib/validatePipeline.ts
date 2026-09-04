import type { PipelineEdge, PipelineNode } from '../types';

export interface NodeConfigError {
  nodeId: string;
  message: string;
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

export function validateNodeConfigs(
  nodes: PipelineNode[],
  columnList: string[],
): NodeConfigError[] {
  const errors: NodeConfigError[] = [];
  const known = new Set(columnList);

  for (const node of nodes) {
    const config = node.data.config;
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
          message: `Node "${node.data.label}" references unknown columns: ${unknownColumns.join(', ')}`,
        });
      }
    }
    if (config.by !== undefined) {
      const unknownColumns = config.by.filter((column) => !known.has(column));
      if (unknownColumns.length > 0) {
        errors.push({
          nodeId: node.id,
          message: `Node "${node.data.label}" sorts by unknown columns: ${unknownColumns.join(', ')}`,
        });
      }
    }
    if (config.mapping !== undefined) {
      const unknownKeys = Object.keys(config.mapping).filter((key) => !known.has(key));
      if (unknownKeys.length > 0) {
        errors.push({
          nodeId: node.id,
          message: `Node "${node.data.label}" renames unknown columns: ${unknownKeys.join(', ')}`,
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
          message: `Node "${node.data.label}" filters on unknown columns: ${unknownColumns.join(', ')}`,
        });
      }
    }
  }

  return errors;
}

export function getNodeErrors(node: PipelineNode, columnList: string[]): string[] {
  const errors: string[] = [];
  const cfg = node.data.config;

  switch (node.type) {
    case 'fill-na':
      if (!cfg.strategy) errors.push('Select a fill strategy');
      break;
    case 'drop-column':
      if (!cfg.columns || cfg.columns.length === 0) errors.push('Select at least one column');
      break;
    case 'rename-column':
      if (!cfg.mapping || Object.keys(cfg.mapping).length === 0)
        errors.push('Add at least one mapping');
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
      if (!cfg.method) errors.push('Select an encoding method');
      if (!cfg.columns || cfg.columns.length === 0) errors.push('Select at least one column');
      break;
    case 'sort':
      if (!cfg.by || cfg.by.length === 0) errors.push('Select at least one sort column');
      break;
  }

  const colsToCheck = cfg.columns ?? cfg.by ?? [];
  colsToCheck.forEach((col) => {
    if (!columnList.includes(col)) errors.push(`Column "${col}" no longer exists`);
  });

  return errors;
}
