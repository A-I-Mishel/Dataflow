import logging
from collections import deque
from typing import Deque, Dict, List, Optional, Tuple

from models import PipelineNode

logger = logging.getLogger(__name__)


def _build_graph(
    nodes: List[PipelineNode], edges: List[Dict[str, str]]
) -> Tuple[Dict[str, List[str]], Dict[str, int], Dict[str, PipelineNode]]:
    node_map: Dict[str, PipelineNode] = {}
    for node in nodes:
        if node.id in node_map:
            raise ValueError(f"Duplicate node id '{node.id}'")
        node_map[node.id] = node

    adjacency: Dict[str, List[str]] = {node.id: [] for node in nodes}
    in_degree: Dict[str, int] = {node.id: 0 for node in nodes}

    for idx, edge in enumerate(edges):
        source: Optional[str] = edge.get("source")
        target: Optional[str] = edge.get("target")
        if not source or not target:
            raise ValueError(f"Edge {idx} must contain 'source' and 'target'")
        if source not in node_map:
            raise ValueError(f"Edge {idx} references unknown source '{source}'")
        if target not in node_map:
            raise ValueError(f"Edge {idx} references unknown target '{target}'")
        adjacency[source].append(target)
        in_degree[target] += 1

    return adjacency, in_degree, node_map


def _find_cycle(adjacency: Dict[str, List[str]]) -> Optional[List[str]]:
    white: int = 0
    gray: int = 1
    black: int = 2
    color: Dict[str, int] = {node_id: white for node_id in adjacency}
    stack: List[str] = []
    found: List[str] = []

    def dfs(node_id: str) -> bool:
        color[node_id] = gray
        stack.append(node_id)
        for neighbor in adjacency.get(node_id, []):
            if color.get(neighbor, black) == gray:
                start: int = stack.index(neighbor) if neighbor in stack else 0
                found.extend(stack[start:] + [neighbor])
                return True
            if color.get(neighbor, black) == white:
                if dfs(neighbor):
                    return True
        stack.pop()
        color[node_id] = black
        return False

    for node_id in adjacency:
        if color[node_id] == white:
            if dfs(node_id):
                return list(found)
    return None


def topological_sort(
    nodes: List[PipelineNode], edges: List[Dict[str, str]]
) -> List[PipelineNode]:
    adjacency, in_degree, node_map = _build_graph(nodes, edges)

    queue: Deque[str] = deque([nid for nid, deg in in_degree.items() if deg == 0])
    sorted_ids: List[str] = []

    while queue:
        current: str = queue.popleft()
        sorted_ids.append(current)
        for neighbor in adjacency.get(current, []):
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    if len(sorted_ids) != len(node_map):
        cycle: Optional[List[str]] = _find_cycle(adjacency)
        if cycle:
            raise ValueError(f"Cycle detected involving nodes: {cycle}")
        orphaned: List[str] = [nid for nid in node_map if nid not in set(sorted_ids)]
        raise ValueError(f"Orphaned/unreachable nodes detected: {orphaned}")

    ordered: List[PipelineNode] = [node_map[nid] for nid in sorted_ids]
    logger.info("Topologically sorted %d nodes", len(ordered))
    return ordered
