from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel

# Note: Any is unavoidable here — NodeConfig.value/conditions and API previews
# must accept arbitrary JSON values coming from user CSVs and pipeline configs.


class NodeConfig(BaseModel):
    subset: Optional[bool] = None
    columns: Optional[List[str]] = None
    strategy: Optional[str] = None
    value: Optional[Any] = None
    mapping: Optional[Dict[str, str]] = None
    conditions: Optional[List[Dict[str, Any]]] = None
    method: Optional[str] = None
    by: Optional[List[str]] = None
    ascending: Optional[bool] = True


class PipelineNode(BaseModel):
    id: str
    type: Literal[
        "drop-na",
        "fill-na",
        "drop-column",
        "rename-column",
        "filter-rows",
        "normalize",
        "encode-categorical",
        "sort",
    ]
    config: NodeConfig


class ExecuteRequest(BaseModel):
    session_id: str
    nodes: List[PipelineNode]
    edges: List[Dict[str, str]]


class UploadResponse(BaseModel):
    session_id: str
    columns: List[str]
    dtypes: Dict[str, str]
    row_count: int
    preview: List[Dict[str, Any]]
    missing_values: Dict[str, int]


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


class ExecuteResponse(BaseModel):
    preview: List[Dict[str, Any]]
    shape: List[int]
    columns: List[str]
    dtypes: Dict[str, str]
    profile: ProfileResponse


class GenerateResponse(BaseModel):
    code: str
