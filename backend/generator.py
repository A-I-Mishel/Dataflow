import importlib
import logging
import re
from types import ModuleType
from typing import Callable, Dict, List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig, PipelineNode
from toposort import topological_sort, validate_linear_chain

logger = logging.getLogger(__name__)

TransformFn = Callable[[pd.DataFrame, NodeConfig], Tuple[pd.DataFrame, str]]

_NODE_TO_IMPORT: Dict[str, Tuple[str, str]] = {
    "drop-na": ("transforms.drop_na", "apply_drop_na"),
    "fill-na": ("transforms.fill_na", "apply_fill_na"),
    "drop-column": ("transforms.drop_column", "apply_drop_column"),
    "drop-duplicates": ("transforms.drop_duplicates", "apply_drop_duplicates"),
    "rename-column": ("transforms.rename_column", "apply_rename_column"),
    "filter-rows": ("transforms.filter_rows", "apply_filter_rows"),
    "normalize": ("transforms.normalize", "apply_normalize"),
    "encode-categorical": ("transforms.encode_categorical", "apply_encode_categorical"),
    "sort": ("transforms.sort", "apply_sort"),
    "round-values": ("transforms.round_values", "apply_round_values"),
    "reorder-columns": ("transforms.reorder_columns", "apply_reorder_columns"),
    "drop-empty-columns": ("transforms.drop_empty_columns", "apply_drop_empty_columns"),
    "replace-values": ("transforms.replace_values", "apply_replace_values"),
    "split-column": ("transforms.split_column", "apply_split_column"),
    "merge-columns": ("transforms.merge_columns", "apply_merge_columns"),
    "extract-text": ("transforms.extract_text", "apply_extract_text"),
    "group-rare": ("transforms.group_rare", "apply_group_rare"),
    "parse-date": ("transforms.parse_date", "apply_parse_date"),
    "extract-date-part": ("transforms.extract_date_part", "apply_extract_date_part"),
    "date-difference": ("transforms.date_difference", "apply_date_difference"),
    "create-column": ("transforms.create_column", "apply_create_column"),
    "conditional-column": ("transforms.conditional_column", "apply_conditional_column"),
    "validate-column": ("transforms.validate_column", "apply_validate_column"),
    "find-invalid": ("transforms.find_invalid", "apply_find_invalid"),
    "clip-values": ("transforms.clip_values", "apply_clip_values"),
    "find-replace-pattern": ("transforms.find_replace_pattern", "apply_find_replace_pattern"),
    "remove-special-chars": ("transforms.remove_special_chars", "apply_remove_special_chars"),
    "standardize-categories": ("transforms.standardize_categories", "apply_standardize_categories"),
    "log-transform": ("transforms.log_transform", "apply_log_transform"),
}


def _load_transform(node_type: str) -> TransformFn:
    entry: Optional[Tuple[str, str]] = _NODE_TO_IMPORT.get(node_type)
    if entry is None:
        raise HTTPException(status_code=400, detail=f"Unknown node type '{node_type}'")
    module_name, func_name = entry
    try:
        module: ModuleType = importlib.import_module(module_name)
        fn: TransformFn = getattr(module, func_name)
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail=f"Failed loading transform '{node_type}': {exc}"
        ) from exc
    return fn


def _collect_referenced_columns(nodes: List[PipelineNode]) -> set[str]:
    cols: set[str] = set()
    for node in nodes:
        cfg = node.config
        if cfg.columns:
            cols.update(cfg.columns)
        if cfg.mapping:
            cols.update(cfg.mapping.keys())
        if cfg.by:
            cols.update(cfg.by)
        if cfg.conditions:
            for cond in cfg.conditions:
                try:
                    c = cond.get("column")
                except AttributeError:
                    continue
                if isinstance(c, str) and c:
                    cols.add(c)
        if cfg.formula:
            # [column] references feed the dummy frame numeric stand-ins.
            for ref in re.findall(r"\[([^\]]+)\]", str(cfg.formula)):
                ref = ref.strip()
                if ref:
                    cols.add(ref)
        if cfg.rules:
            for rule in cfg.rules:
                try:
                    c = rule.get("column")
                except AttributeError:
                    continue
                if isinstance(c, str) and c:
                    cols.add(c)
    return cols


def _build_dummy_frame(nodes: List[PipelineNode]) -> pd.DataFrame:
    referenced: set[str] = _collect_referenced_columns(nodes)
    mapping_values: set[str] = set()
    for node in nodes:
        if node.config.mapping:
            mapping_values.update(node.config.mapping.values())
    data: Dict[str, List[object]] = {
        "__dummy_num": [1, 2, 3],
        "__dummy_cat": ["a", "b", "c"],
    }
    for col in referenced:
        if col not in data and col not in mapping_values:
            data[col] = [1, 2, 3]
    return pd.DataFrame(data)


def generate_script(
    nodes: List[PipelineNode], edges: List[Dict[str, str]], filename: str = "data.csv"
) -> str:
    try:
        sorted_nodes: List[PipelineNode] = topological_sort(nodes, edges)
        # Same linearity contract as /execute: never export a script whose
        # step order silently linearizes a forked canvas.
        validate_linear_chain(nodes, edges)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    base_dummy: pd.DataFrame = _build_dummy_frame(sorted_nodes)
    cur: pd.DataFrame = base_dummy.copy(deep=True)
    code_blocks: List[str] = []
    for node in sorted_nodes:
        # Unknown node types are real errors (fail fast). Anything else is
        # likely a dummy-frame artifact (every referenced column is [1, 2, 3],
        # so dtype-sensitive configs can fail here while passing on real
        # data) — emit the step with a warning instead of 400ing the whole
        # request after a successful /execute.
        fn: TransformFn = _load_transform(node.type)
        try:
            cur, code = fn(cur, node.config)
        except HTTPException as exc:
            detail: str = str(exc.detail) if exc.detail else "validation failed"
            code = (
                f"# WARNING: could not auto-validate node '{node.id}' "
                f"({node.type}): {detail}\n"
                f"# Config was: {node.config.model_dump_json()}\n"
                "df = df.copy()  # no-op fallback; adjust manually if needed"
            )
            logger.warning("Dummy-frame validation failed for node %s: %s", node.id, detail)
        except Exception as exc:
            code = (
                f"# WARNING: could not auto-validate node '{node.id}' "
                f"({node.type}): {exc}\n"
                f"# Config was: {node.config.model_dump_json()}\n"
                "df = df.copy()  # no-op fallback; adjust manually if needed"
            )
            logger.warning("Dummy-frame validation failed for node %s: %s", node.id, exc)
        code_blocks.append(code)

    lines: List[str] = []
    lines.append("import pandas as pd")
    lines.append("import numpy as np")
    lines.append("from sklearn.preprocessing import LabelEncoder")
    lines.append("")
    lines.append("# Load dataset")
    lines.append(f'df = pd.read_csv("{filename}")')
    lines.append('print(f"Original shape: {df.shape}")')
    lines.append("")
    for idx, node in enumerate(sorted_nodes):
        label: str = f"{node.type} ({node.id})"
        lines.append(f"# Step {idx + 1}: {label}")
        lines.append(code_blocks[idx])
        lines.append("")
    lines.append("# Save cleaned dataset")
    lines.append('df.to_csv("cleaned_data.csv", index=False)')
    lines.append('print(f"Cleaned shape: {df.shape}")')
    lines.append('print("Done!")')
    script: str = "\n".join(lines) + "\n"
    logger.info("Generated script with %d steps", len(code_blocks))
    return script
