import logging
from typing import Callable, Dict, List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig, NodePreview, PipelineNode
from sanitize import dtypes_dict, sanitize_records
from toposort import topological_sort
from transforms.drop_column import apply_drop_column
from transforms.drop_duplicates import apply_drop_duplicates
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
    "drop-duplicates": apply_drop_duplicates,
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


# Rows kept per step preview. Full frames are never stored — 50 sanitized
# rows per node is enough to inspect a step and stays tiny.
INTERMEDIATE_PREVIEW_ROWS: int = 50


def _snapshot_preview(
    node_id: str, df: pd.DataFrame, approximate: bool = False
) -> NodePreview:
    return NodePreview(
        node_id=node_id,
        shape=[int(df.shape[0]), int(df.shape[1])],
        columns=[str(c) for c in df.columns.tolist()],
        dtypes=dtypes_dict(df),
        preview=sanitize_records(df, INTERMEDIATE_PREVIEW_ROWS),
        approximate=approximate,
    )


def execute_pipeline_with_intermediates(
    df: pd.DataFrame,
    nodes: List[PipelineNode],
    edges: List[Dict[str, str]],
    approximate: bool = False,
) -> Tuple[pd.DataFrame, List[NodePreview]]:
    """Run the pipeline, returning the final frame plus one preview per node.

    Previews are recorded in topological (execution) order. Only sanitized
    head rows are kept — never full intermediate frames.
    """
    if not nodes:
        return df.copy(deep=True), []
    try:
        sorted_nodes: List[PipelineNode] = topological_sort(nodes, edges)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    current: pd.DataFrame = df.copy(deep=True)
    previews: List[NodePreview] = []
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
        previews.append(_snapshot_preview(node.id, current, approximate))
    return current, previews


def execute_pipeline(
    df: pd.DataFrame, nodes: List[PipelineNode], edges: List[Dict[str, str]]
) -> pd.DataFrame:
    final: pd.DataFrame
    final, _previews = execute_pipeline_with_intermediates(df, nodes, edges)
    return final


def execute_pipeline_large_file(
    file_path: str,
    nodes: List[PipelineNode],
    edges: List[Dict[str, str]],
    chunk_size: int = 10000,
    encoding: str = "utf-8",
) -> pd.DataFrame:
    """Execute a pipeline over a CSV that is too large to load at once.

    The file is streamed in ``chunk_size``-row pieces and each piece runs
    through :func:`execute_pipeline`; results are concatenated at the end.

    Note: transforms with global state (normalize statistics, categorical
    vocabularies, cross-chunk sort order) are computed per chunk, so results
    on large files are approximate. Row-local transforms (drop-na, fill-na,
    drop-column, rename-column, filter-rows) are exact.
    """
    # Validate the DAG once up front so a bad pipeline fails fast instead
    # of after partially streaming a 200MB file.
    sort_nodes(nodes, edges)

    try:
        chunk_iter = pd.read_csv(file_path, chunksize=chunk_size, encoding=encoding)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Uploaded file no longer available") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed reading CSV: {exc}") from exc

    result_chunks: List[pd.DataFrame] = []
    try:
        for chunk_df in chunk_iter:
            chunk_df.columns = [str(c) for c in chunk_df.columns]
            result_chunks.append(execute_pipeline(chunk_df, nodes, edges))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed processing CSV chunk: {exc}") from exc

    if not result_chunks:
        try:
            header_df: pd.DataFrame = pd.read_csv(file_path, nrows=0, encoding=encoding)
            header_df.columns = [str(c) for c in header_df.columns]
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Failed reading CSV: {exc}") from exc
        return execute_pipeline(header_df, nodes, edges)
    if len(result_chunks) == 1:
        return result_chunks[0]
    return pd.concat(result_chunks, ignore_index=True)
