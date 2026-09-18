import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from typing import Dict

import pytest

from models import NodeConfig, PipelineNode
from toposort import topological_sort, validate_linear_chain


def _node(node_id: str, node_type: str = "drop-na") -> PipelineNode:
    return PipelineNode(id=node_id, type=node_type, config=NodeConfig())


def _edge(source: str, target: str) -> Dict[str, str]:
    return {"source": source, "target": target}


def test_linear_chain_sorts() -> None:
    nodes = [_node("a"), _node("b"), _node("c")]
    edges = [_edge("a", "b"), _edge("b", "c")]
    assert [n.id for n in topological_sort(nodes, edges)] == ["a", "b", "c"]
    validate_linear_chain(nodes, edges)


def test_empty_and_single_node_pass() -> None:
    validate_linear_chain([], [])
    validate_linear_chain([_node("a")], [])


def test_long_chain_passes() -> None:
    nodes = [_node(f"n{i}") for i in range(10)]
    edges = [_edge(f"n{i}", f"n{i + 1}") for i in range(9)]
    validate_linear_chain(nodes, edges)
    assert [n.id for n in topological_sort(nodes, edges)] == [n.id for n in nodes]


def test_duplicate_id_rejected() -> None:
    with pytest.raises(ValueError, match="Duplicate node id"):
        topological_sort([_node("a"), _node("a")], [])


def test_dangling_edge_rejected() -> None:
    with pytest.raises(ValueError, match="unknown target"):
        topological_sort([_node("a")], [_edge("a", "ghost")])


def test_cycle_rejected() -> None:
    nodes = [_node("a"), _node("b")]
    with pytest.raises(ValueError, match="Cycle detected"):
        topological_sort(nodes, [_edge("a", "b"), _edge("b", "a")])


def test_fork_rejected() -> None:
    nodes = [_node("a"), _node("b"), _node("c")]
    with pytest.raises(ValueError, match="splits into multiple branches"):
        validate_linear_chain(nodes, [_edge("a", "b"), _edge("a", "c")])


def test_converging_diamond_rejected() -> None:
    # Any reconvergence implies an upstream fork, so the fork message fires.
    # The merge/count branches below it stay as defense-in-depth.
    nodes = [_node("r"), _node("x"), _node("y"), _node("m")]
    edges = [_edge("r", "x"), _edge("r", "y"), _edge("x", "m"), _edge("y", "m")]
    with pytest.raises(ValueError, match="splits into multiple branches"):
        validate_linear_chain(nodes, edges)


def test_multiple_roots_rejected() -> None:
    with pytest.raises(ValueError, match="2 starting nodes"):
        validate_linear_chain([_node("a"), _node("b")], [])


def test_disconnected_components_rejected() -> None:
    nodes = [_node("a"), _node("b"), _node("c"), _node("d")]
    with pytest.raises(ValueError, match="2 starting nodes"):
        validate_linear_chain(nodes, [_edge("a", "b"), _edge("c", "d")])
