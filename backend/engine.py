"""FILE: backend/engine.py
PURPOSE: Runs pipeline steps now (vs generator.py which writes code).
HOW IT FITS: main.py -> execute_pipeline_*() -> _TRANSFORMS dict -> transforms/*.py. Handles sort_nodes + chunked large-file path.
WHERE TO EDIT: To add op: 1) import apply_* 2) add 2 entries (_TRANSFORMS + generator map). Keep in sync with generator.py + frontend engine.js.
"""
import logging
from typing import Callable, Dict, List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig, NodePreview, PipelineNode
from sanitize import dtypes_dict, sanitize_records
from toposort import topological_sort, validate_linear_chain
from transforms.drop_column import apply_drop_column
from transforms.drop_duplicates import apply_drop_duplicates
from transforms.drop_empty_columns import apply_drop_empty_columns
from transforms.drop_na import apply_drop_na
from transforms.date_difference import apply_date_difference
from transforms.conditional_column import apply_conditional_column
from transforms.create_column import apply_create_column
from transforms.clip_values import apply_clip_values
from transforms.encode_categorical import apply_encode_categorical
from transforms.extract_date_part import apply_extract_date_part
from transforms.extract_text import apply_extract_text
from transforms.fill_na import apply_fill_na
from transforms.filter_rows import apply_filter_rows
from transforms.find_invalid import apply_find_invalid
from transforms.find_replace_pattern import apply_find_replace_pattern
from transforms.group_rare import apply_group_rare
from transforms.log_transform import apply_log_transform
from transforms.merge_columns import apply_merge_columns
from transforms.normalize import apply_normalize
from transforms.parse_date import apply_parse_date
from transforms.rename_column import apply_rename_column
from transforms.reorder_columns import apply_reorder_columns
from transforms.remove_special_chars import apply_remove_special_chars
from transforms.replace_values import apply_replace_values
from transforms.round_values import apply_round_values
from transforms.sort import apply_sort
from transforms.split_column import apply_split_column
from transforms.standardize_categories import apply_standardize_categories
from transforms.validate_column import apply_validate_column

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
    "round-values": apply_round_values,
    "reorder-columns": apply_reorder_columns,
    "drop-empty-columns": apply_drop_empty_columns,
    "replace-values": apply_replace_values,
    "split-column": apply_split_column,
    "merge-columns": apply_merge_columns,
    "extract-text": apply_extract_text,
    "group-rare": apply_group_rare,
    "parse-date": apply_parse_date,
    "extract-date-part": apply_extract_date_part,
    "date-difference": apply_date_difference,
    "create-column": apply_create_column,
    "conditional-column": apply_conditional_column,
    "validate-column": apply_validate_column,
    "find-invalid": apply_find_invalid,
    "clip-values": apply_clip_values,
    "find-replace-pattern": apply_find_replace_pattern,
    "remove-special-chars": apply_remove_special_chars,
    "standardize-categories": apply_standardize_categories,
    "log-transform": apply_log_transform,
}


def sort_nodes(
    nodes: List[PipelineNode], edges: List[Dict[str, str]]
) -> List[PipelineNode]:
    try:
        ordered: List[PipelineNode] = topological_sort(nodes, edges)
        # The engine applies nodes strictly sequentially: forks, merges and
        # multi-root shapes would silently linearize, so reject them with the
        # same messages the frontend run gate shows.
        validate_linear_chain(nodes, edges)
        return ordered
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
    sorted_nodes: List[PipelineNode] = sort_nodes(nodes, edges)
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
    sep: str = ",",
) -> pd.DataFrame:
    """Execute a pipeline over a CSV that is too large to load at once.

    The file is streamed in ``chunk_size``-row pieces and each piece runs
    through :func:`execute_pipeline`; results are concatenated at the end.

    Only strictly row-local transforms are exact here: drop-na, fill-na
    with constant/ffill/bfill, drop-column, rename-column, filter-rows, and
    the other per-row transforms (create/conditional/replace/round/clip/
    split/merge/extract/parse/date ops); validate/find-invalid pass data
    through untouched. Anything needing global state is rejected outright
    with a 400 pointing at the exported script, because per-chunk results
    would be silently wrong, not merely approximate: sort order, normalize
    statistics, category vocabularies (encode-categorical, group-rare),
    fill-na mean/median/mode, and cross-chunk deduplication
    (drop-duplicates).
    """
    # Validate the DAG once up front so a bad pipeline fails fast instead
    # of after partially streaming a 200MB file.
    sorted_for_check: List[PipelineNode] = sort_nodes(nodes, edges)
    blocked: Dict[str, str] = {
        "sort": "needs the full dataset to order rows",
        "normalize": "needs global column statistics",
        "encode-categorical": "needs the global category vocabulary",
        "group-rare": "needs the global category vocabulary",
        "drop-duplicates": "needs the full dataset for exact deduplication",
    }
    problems: List[Tuple[str, str]] = []
    for node_type in sorted(set(blocked) & {node.type for node in sorted_for_check}):
        ids: str = ", ".join(
            sorted(node.id for node in sorted_for_check if node.type == node_type)
        )
        problems.append((node_type, f"{node_type} ({blocked[node_type]}; nodes {ids})"))
    # fill-na is row-local only for constant/ffill/bfill: mean/median/mode
    # need global column statistics (the default strategy is mean).
    stat_fill: List[str] = sorted(
        node.id
        for node in sorted_for_check
        if node.type == "fill-na"
        and (node.config.strategy or "mean").lower() in ("mean", "median", "mode")
    )
    if stat_fill:
        problems.append(
            (
                "fill-na(mean/median/mode)",
                f"fill-na(mean/median/mode) (needs global column statistics; nodes {', '.join(stat_fill)})",
            )
        )
    if problems:
        labels: str = ", ".join(label for label, _ in problems)
        reasons: str = "; ".join(reason for _, reason in problems)
        raise HTTPException(
            status_code=400,
            detail=(
                f"Large-file mode does not support {labels}: {reasons}. "
                "Run these steps locally with the exported script instead."
            ),
        )

    try:
        chunk_iter = pd.read_csv(file_path, chunksize=chunk_size, encoding=encoding, sep=sep)
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
            header_df: pd.DataFrame = pd.read_csv(file_path, nrows=0, encoding=encoding, sep=sep)
            header_df.columns = [str(c) for c in header_df.columns]
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Failed reading CSV: {exc}") from exc
        return execute_pipeline(header_df, nodes, edges)
    if len(result_chunks) == 1:
        return result_chunks[0]
    return pd.concat(result_chunks, ignore_index=True)
