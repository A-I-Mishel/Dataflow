from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from constants import ONE_HOT_MAX_CELLS

# Note: Any is unavoidable here — NodeConfig.value/conditions and API previews
# must accept arbitrary JSON values coming from user CSVs and pipeline configs.

# Structural payload caps (DoS guard): real pipelines have a handful of nodes
# and conditions; unbounded lists let one request burn CPU/RAM (each step
# deep-copies the frame). Violations fail fast with 422, before any compute.
MAX_NODES = 100
MAX_EDGES = 200
MAX_LIST_ITEMS = 200
MAX_ID_LENGTH = 128


class NodeConfig(BaseModel):
    subset: Optional[bool] = None
    columns: Optional[List[str]] = Field(default=None, max_length=MAX_LIST_ITEMS)
    strategy: Optional[str] = None
    value: Optional[Any] = None
    mapping: Optional[Dict[str, str]] = Field(default=None, max_length=MAX_LIST_ITEMS)
    conditions: Optional[List[Dict[str, Any]]] = Field(default=None, max_length=MAX_LIST_ITEMS)
    method: Optional[str] = None
    by: Optional[List[str]] = Field(default=None, max_length=MAX_LIST_ITEMS)
    ascending: Optional[bool] = True
    # Wave-1 fields (all optional; each transform reads only its own):
    # drop-na/drop-missing match rule.
    how: Optional[str] = None
    # fill-na ffill/bfill consecutive-fill cap; None/omitted = unlimited.
    limit: Optional[int] = None
    # round-values decimal places.
    decimals: Optional[int] = None
    # replace-values find/replacement pair (replacement None = null).
    find: Optional[Any] = None
    replacement: Optional[Any] = None
    case_sensitive: Optional[bool] = True
    # Wave-2 fields:
    # split-column delimiter / cap on splits / keep the source column.
    delimiter: Optional[str] = None
    max_splits: Optional[int] = None
    keep_original: Optional[bool] = True
    # merge-columns separator between parts.
    separator: Optional[str] = None
    # extract-text mode (prefix/suffix/substring/before/after/between/regex)
    # plus its numeric/string parameters.
    length: Optional[int] = None
    start: Optional[int] = None
    end: Optional[int] = None
    delimiter2: Optional[str] = None
    pattern: Optional[str] = None
    # New-column name (merge/extract/extract-date-part/date-difference).
    output: Optional[str] = None
    # group-rare threshold ('10' or '5%').
    threshold: Optional[str] = None
    # parse-date format (auto/dmy/mdy/ymd).
    format: Optional[str] = None
    # extract-date-part component (year/month/day/weekday/quarter/week).
    part: Optional[str] = None
    # date-difference unit (days/hours/minutes/seconds).
    unit: Optional[str] = None


class PipelineNode(BaseModel):
    id: str = Field(max_length=MAX_ID_LENGTH)
    type: Literal[
        "drop-na",
        "fill-na",
        "drop-column",
        "drop-duplicates",
        "rename-column",
        "filter-rows",
        "normalize",
        "encode-categorical",
        "sort",
        "round-values",
        "reorder-columns",
        "drop-empty-columns",
        "replace-values",
        "split-column",
        "merge-columns",
        "extract-text",
        "group-rare",
        "parse-date",
        "extract-date-part",
        "date-difference",
    ]
    config: NodeConfig


class ExecuteRequest(BaseModel):
    session_id: str = Field(max_length=MAX_ID_LENGTH)
    nodes: List[PipelineNode] = Field(max_length=MAX_NODES)
    edges: List[Dict[str, str]] = Field(max_length=MAX_EDGES)


class UploadResponse(BaseModel):
    session_id: str
    filename: str = "upload.csv"
    columns: List[str]
    dtypes: Dict[str, str]
    row_count: int
    preview: List[Dict[str, Any]]
    missing_values: Dict[str, int]
    large: bool = False
    # Exact upload-time per-column cardinality (nunique(dropna=True)).
    # None for large files (no full scan) and absent on older responses.
    # A missing key is unknown — never zero.
    unique_counts: Optional[Dict[str, int]] = None
    cardinality_available: bool = False
    # Authoritative one-hot safety limit, always present on new responses.
    one_hot_max_cells: int = ONE_HOT_MAX_CELLS


class ColumnProfile(BaseModel):
    dtype: str
    null_count: int
    null_pct: float
    unique_count: int
    min: Optional[float] = None
    max: Optional[float] = None
    mean: Optional[float] = None
    median: Optional[float] = None
    std: Optional[float] = None
    histogram: Optional[List[Dict[str, Any]]] = None
    top_values: Optional[List[Dict[str, Any]]] = None
    date_min: Optional[str] = None
    date_max: Optional[str] = None
    date_histogram: Optional[List[Dict[str, Any]]] = None


class ProfileResponse(BaseModel):
    shape: List[int]
    memory_usage_mb: float
    total_missing: int
    columns: Dict[str, ColumnProfile]


class NodePreview(BaseModel):
    node_id: str
    shape: List[int]
    columns: List[str]
    dtypes: Dict[str, str]
    preview: List[Dict[str, Any]]
    approximate: bool = False


class ExecuteResponse(BaseModel):
    preview: List[Dict[str, Any]]
    shape: List[int]
    columns: List[str]
    dtypes: Dict[str, str]
    profile: ProfileResponse
    intermediates: List[NodePreview] = []


class GenerateResponse(BaseModel):
    code: str
