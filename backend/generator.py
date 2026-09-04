import importlib
import logging
from types import ModuleType
from typing import Callable, Dict, List, Optional, Tuple

import pandas as pd
from fastapi import HTTPException

from models import NodeConfig, PipelineNode
from toposort import topological_sort

logger = logging.getLogger(__name__)

TransformFn = Callable[[pd.DataFrame, NodeConfig], Tuple[pd.DataFrame, str]]

_NODE_TO_IMPORT: Dict[str, Tuple[str, str]] = {
    "drop-na": ("transforms.drop_na", "apply_drop_na"),
    "fill-na": ("transforms.fill_na", "apply_fill_na"),
    "drop-column": ("transforms.drop_column", "apply_drop_column"),
    "rename-column": ("transforms.rename_column", "apply_rename_column"),
    "filter-rows": ("transforms.filter_rows", "apply_filter_rows"),
    "normalize": ("transforms.normalize", "apply_normalize"),
    "encode-categorical": ("transforms.encode_categorical", "apply_encode_categorical"),
    "sort": ("transforms.sort", "apply_sort"),
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
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    base_dummy: pd.DataFrame = _build_dummy_frame(sorted_nodes)
    cur: pd.DataFrame = base_dummy.copy(deep=True)
    code_blocks: List[str] = []
    for node in sorted_nodes:
        fn: TransformFn = _load_transform(node.type)
        try:
            cur, code = fn(cur, node.config)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                status_code=400, detail=f"Node '{node.id}' ({node.type}) failed: {exc}"
            ) from exc
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
