import logging
from typing import Callable, Dict, List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig, PipelineNode
from toposort import topological_sort
from transforms.drop_column import apply_drop_column
from transforms.drop_na import apply_drop_na
from transforms.encode_categorical import apply_encode_categorical
from transforms.fill_na import apply_fill_na
from transforms.filter_rows import apply_filter_rows
from transforms.normalize import apply_normalize
from transforms.rename_column import apply_rename_column
from transforms.sort import apply_sort

logger = logging.getLogger(__name__)

TransformFn = Callable[[pd.DataFrame, NodeConfig], Tuple[pd.DataFrame, str]]

_TRANSFORMS: Dict[str, TransformFn] = {
    "drop-na": apply_drop_na,
    "fill-na": apply_fill_na,
    "drop-column": apply_drop_column,
    "rename-column": apply_rename_column,
    "filter-rows": apply_filter_rows,
    "normalize": apply_normalize,
    "encode-categorical": apply_encode_categorical,
    "sort": apply_sort,
}


def sort_nodes(
    nodes: List[PipelineNode], edges: List[Dict[str, str]]
) -> List[PipelineNode]:
    try:
        return topological_sort(nodes, edges)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def execute_pipeline(
    df: pd.DataFrame, nodes: List[PipelineNode], edges: List[Dict[str, str]]
) -> pd.DataFrame:
    if not nodes:
        return df.copy(deep=True)
    try:
        sorted_nodes: List[PipelineNode] = topological_sort(nodes, edges)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    current: pd.DataFrame = df.copy(deep=True)
    for node in sorted_nodes:
        fn: Optional[TransformFn] = _TRANSFORMS.get(node.type)
        if fn is None:
            raise HTTPException(status_code=400, detail=f"Unknown node type '{node.type}'")
        try:
            new_df, _code = fn(current, node.config)
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Transform '%s' (%s) failed", node.id, node.type)
            raise HTTPException(
                status_code=400, detail=f"Node '{node.id}' ({node.type}) failed: {exc}"
            ) from exc
        current = new_df
    return current
