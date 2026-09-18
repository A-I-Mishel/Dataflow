import ast
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pandas as pd
import pytest
from fastapi import HTTPException
from typing import List

from engine import execute_pipeline, execute_pipeline_with_intermediates
from models import NodeConfig, PipelineNode
from transforms.drop_column import apply_drop_column
from transforms.drop_duplicates import apply_drop_duplicates
from transforms.drop_empty_columns import apply_drop_empty_columns
from transforms.drop_na import apply_drop_na
from transforms.encode_categorical import apply_encode_categorical
from transforms.fill_na import apply_fill_na
from transforms.filter_rows import apply_filter_rows
from transforms.normalize import apply_normalize
from transforms.rename_column import apply_rename_column
from transforms.reorder_columns import apply_reorder_columns
from transforms.replace_values import apply_replace_values
from transforms.round_values import apply_round_values
from transforms.sort import apply_sort


@pytest.fixture
def sample_df() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "Name": ["Alice", "Bob", "Charlie", None],
            "Age": [25, 30, None, 35],
            "Salary": [50000.0, None, 70000.0, 90000.0],
            "Dept": ["IT", "HR", "IT", "HR"],
            "HireDate": pd.to_datetime(["2020-01-15", "2019-06-01", "2021-03-10", "2018-11-20"]),
        }
    )


def _assert_valid_code(code: str) -> None:
    assert isinstance(code, str)
    assert code.strip() != ""
    ast.parse(code)


def test_drop_na_default(sample_df: pd.DataFrame) -> None:
    result, code = apply_drop_na(sample_df, NodeConfig())
    _assert_valid_code(code)
    assert result.shape == (1, 5)
    assert sample_df.shape == (4, 5)


def test_drop_na_subset(sample_df: pd.DataFrame) -> None:
    result, code = apply_drop_na(sample_df, NodeConfig(columns=["Age"]))
    _assert_valid_code(code)
    assert result.shape == (3, 5)
    assert result["Age"].isna().sum() == 0


def test_drop_na_empty_columns(sample_df: pd.DataFrame) -> None:
    result, code = apply_drop_na(sample_df, NodeConfig(columns=[]))
    _assert_valid_code(code)
    assert result.shape == (1, 5)


def test_fill_na_mean(sample_df: pd.DataFrame) -> None:
    result, code = apply_fill_na(sample_df, NodeConfig(strategy="mean"))
    _assert_valid_code(code)
    assert result.shape == (4, 5)
    assert result["Age"].isna().sum() == 0
    assert result["Salary"].isna().sum() == 0


def test_fill_na_mean_subset(sample_df: pd.DataFrame) -> None:
    result, code = apply_fill_na(sample_df, NodeConfig(strategy="mean", columns=["Age"]))
    _assert_valid_code(code)
    assert result.shape == (4, 5)
    assert result["Age"].isna().sum() == 0
    assert result["Salary"].isna().sum() == 1


def test_fill_na_median(sample_df: pd.DataFrame) -> None:
    result, code = apply_fill_na(sample_df, NodeConfig(strategy="median"))
    _assert_valid_code(code)
    assert result.shape == (4, 5)
    assert result["Age"].isna().sum() == 0


def test_fill_na_mode(sample_df: pd.DataFrame) -> None:
    result, code = apply_fill_na(sample_df, NodeConfig(strategy="mode"))
    _assert_valid_code(code)
    assert result.shape == (4, 5)


def test_fill_na_constant(sample_df: pd.DataFrame) -> None:
    result, code = apply_fill_na(sample_df, NodeConfig(strategy="constant", value=0))
    _assert_valid_code(code)
    assert result.shape == (4, 5)
    assert int(result.isna().sum().sum()) == 0


def test_fill_na_constant_subset(sample_df: pd.DataFrame) -> None:
    result, code = apply_fill_na(
        sample_df, NodeConfig(strategy="constant", columns=["Salary"], value=0.0)
    )
    _assert_valid_code(code)
    assert result["Salary"].isna().sum() == 0
    assert result["Age"].isna().sum() == 1


def test_fill_na_all_null_column() -> None:
    df: pd.DataFrame = pd.DataFrame({"A": [None, None], "B": [1, 2]})
    result, code = apply_fill_na(df, NodeConfig(strategy="mean"))
    _assert_valid_code(code)
    assert result.shape == (2, 2)


def test_fill_na_invalid_strategy(sample_df: pd.DataFrame) -> None:
    with pytest.raises(HTTPException):
        apply_fill_na(sample_df, NodeConfig(strategy="bogus"))


def test_drop_column(sample_df: pd.DataFrame) -> None:
    result, code = apply_drop_column(sample_df, NodeConfig(columns=["Dept"]))
    _assert_valid_code(code)
    assert result.shape == (4, 4)
    assert "Dept" not in result.columns


def test_drop_column_empty(sample_df: pd.DataFrame) -> None:
    result, code = apply_drop_column(sample_df, NodeConfig(columns=[]))
    _assert_valid_code(code)
    assert result.shape == (4, 5)


def test_rename_column(sample_df: pd.DataFrame) -> None:
    result, code = apply_rename_column(sample_df, NodeConfig(mapping={"Name": "FullName"}))
    _assert_valid_code(code)
    assert "FullName" in result.columns
    assert "Name" not in result.columns
    assert result.shape == (4, 5)


def test_rename_empty(sample_df: pd.DataFrame) -> None:
    result, code = apply_rename_column(sample_df, NodeConfig())
    _assert_valid_code(code)
    assert result.shape == (4, 5)


def test_filter_rows_numeric(sample_df: pd.DataFrame) -> None:
    result, code = apply_filter_rows(
        sample_df, NodeConfig(conditions=[{"column": "Age", "operator": ">", "value": 28, "logic": None}])
    )
    _assert_valid_code(code)
    assert result.shape[0] == 2
    assert result.shape[1] == 5


def test_filter_rows_and(sample_df: pd.DataFrame) -> None:
    result, code = apply_filter_rows(
        sample_df,
        NodeConfig(
            conditions=[
                {"column": "Age", "operator": ">", "value": 20, "logic": None},
                {"column": "Dept", "operator": "==", "value": "IT", "logic": "AND"},
            ]
        ),
    )
    _assert_valid_code(code)
    assert result.shape[0] == 1
    assert result.iloc[0]["Name"] == "Alice"


def test_filter_rows_or(sample_df: pd.DataFrame) -> None:
    result, code = apply_filter_rows(
        sample_df,
        NodeConfig(
            conditions=[
                {"column": "Dept", "operator": "==", "value": "HR", "logic": None},
                {"column": "Salary", "operator": ">", "value": 65000, "logic": "OR"},
            ]
        ),
    )
    _assert_valid_code(code)
    assert result.shape[0] == 3


def test_filter_rows_contains(sample_df: pd.DataFrame) -> None:
    result, code = apply_filter_rows(
        sample_df,
        NodeConfig(conditions=[{"column": "Name", "operator": "contains", "value": "Al", "logic": None}]),
    )
    _assert_valid_code(code)
    assert result.shape[0] == 1


def test_filter_rows_startswith(sample_df: pd.DataFrame) -> None:
    result, code = apply_filter_rows(
        sample_df,
        NodeConfig(conditions=[{"column": "Name", "operator": "startswith", "value": "B", "logic": None}]),
    )
    _assert_valid_code(code)
    assert result.shape[0] == 1
    assert result.iloc[0]["Name"] == "Bob"


def test_filter_rows_endswith(sample_df: pd.DataFrame) -> None:
    result, code = apply_filter_rows(
        sample_df,
        NodeConfig(conditions=[{"column": "Name", "operator": "endswith", "value": "e", "logic": None}]),
    )
    _assert_valid_code(code)
    assert result.shape[0] >= 1


def test_filter_rows_invalid_column(sample_df: pd.DataFrame) -> None:
    with pytest.raises(HTTPException):
        apply_filter_rows(
            sample_df,
            NodeConfig(conditions=[{"column": "Nope", "operator": "==", "value": 1, "logic": None}]),
        )


def test_filter_rows_invalid_operator(sample_df: pd.DataFrame) -> None:
    with pytest.raises(HTTPException):
        apply_filter_rows(
            sample_df,
            NodeConfig(conditions=[{"column": "Age", "operator": "regex", "value": 1, "logic": None}]),
        )


def test_normalize_minmax(sample_df: pd.DataFrame) -> None:
    result, code = apply_normalize(sample_df, NodeConfig(method="min-max", columns=["Salary"]))
    _assert_valid_code(code)
    assert result.shape == (4, 5)
    non_null = result["Salary"].dropna()
    assert (non_null >= 0).all()
    assert (non_null <= 1).all()


def test_normalize_auto(sample_df: pd.DataFrame) -> None:
    result, code = apply_normalize(sample_df, NodeConfig(method="min-max"))
    _assert_valid_code(code)
    assert "select_dtypes" in code
    assert result.shape == (4, 5)


def test_normalize_zscore(sample_df: pd.DataFrame) -> None:
    result, code = apply_normalize(sample_df, NodeConfig(method="z-score", columns=["Age"]))
    _assert_valid_code(code)
    assert result.shape == (4, 5)


def test_normalize_empty_columns(sample_df: pd.DataFrame) -> None:
    result, code = apply_normalize(sample_df, NodeConfig(method="z-score", columns=[]))
    _assert_valid_code(code)
    assert result.shape == (4, 5)


def test_encode_onehot(sample_df: pd.DataFrame) -> None:
    result, code = apply_encode_categorical(sample_df, NodeConfig(method="one-hot", columns=["Dept"]))
    _assert_valid_code(code)
    assert result.shape == (4, 6)
    assert "Dept" not in result.columns


def test_encode_label(sample_df: pd.DataFrame) -> None:
    result, code = apply_encode_categorical(sample_df, NodeConfig(method="label", columns=["Dept"]))
    _assert_valid_code(code)
    assert result.shape == (4, 5)
    assert set(result["Dept"].unique()).issubset({0, 1})


def test_encode_onehot_high_cardinality_refused() -> None:
    df: pd.DataFrame = pd.DataFrame(
        {"ID": [f"id-{i}" for i in range(20000)], "V": [1] * 20000}
    )
    with pytest.raises(HTTPException) as exc_info:
        apply_encode_categorical(df, NodeConfig(method="one-hot", columns=["ID"]))
    assert "one-hot" in str(exc_info.value.detail)
    assert "label" in str(exc_info.value.detail).lower()


def test_encode_onehot_modest_cardinality_allowed() -> None:
    df: pd.DataFrame = pd.DataFrame(
        {"Dept": ["IT", "HR"] * 500, "V": list(range(1000))}
    )
    result, code = apply_encode_categorical(
        df, NodeConfig(method="one-hot", columns=["Dept"])
    )
    _assert_valid_code(code)
    assert result.shape == (1000, 3)


def test_encode_empty(sample_df: pd.DataFrame) -> None:
    result, code = apply_encode_categorical(sample_df, NodeConfig(method="one-hot", columns=[]))
    _assert_valid_code(code)
    assert result.shape[0] == 4


def test_sort(sample_df: pd.DataFrame) -> None:
    result, code = apply_sort(sample_df, NodeConfig(by=["Age"], ascending=True))
    _assert_valid_code(code)
    assert result.shape == (4, 5)
    assert result.iloc[0]["Age"] == 25.0


def test_sort_desc(sample_df: pd.DataFrame) -> None:
    result, code = apply_sort(sample_df, NodeConfig(by=["Salary"], ascending=False))
    _assert_valid_code(code)
    assert result.shape == (4, 5)
    assert result.iloc[0]["Salary"] == 90000.0


def test_sort_empty(sample_df: pd.DataFrame) -> None:
    result, code = apply_sort(sample_df, NodeConfig(by=[]))
    _assert_valid_code(code)
    assert result.shape == (4, 5)


def test_single_row() -> None:
    df: pd.DataFrame = pd.DataFrame({"A": [1], "B": ["x"]})
    for fn, cfg in [
        (apply_drop_na, NodeConfig()),
        (apply_fill_na, NodeConfig(strategy="mean")),
        (apply_drop_column, NodeConfig(columns=[])),
        (apply_rename_column, NodeConfig(mapping={"A": "A2"})),
        (
            apply_filter_rows,
            NodeConfig(conditions=[{"column": "A", "operator": ">", "value": 0, "logic": None}]),
        ),
        (apply_normalize, NodeConfig(method="min-max")),
        (apply_encode_categorical, NodeConfig(method="one-hot", columns=["B"])),
        (apply_sort, NodeConfig(by=["A"])),
    ]:
        result, code = fn(df, cfg)
        _assert_valid_code(code)
        assert result.shape[0] <= 1


def test_drop_duplicates_basic() -> None:
    df: pd.DataFrame = pd.DataFrame({"A": [1, 1, 2], "B": ["x", "x", "y"]})
    result, code = apply_drop_duplicates(df, NodeConfig())
    _assert_valid_code(code)
    assert "drop_duplicates" in code
    assert result.shape == (2, 2)


def test_drop_duplicates_subset() -> None:
    df: pd.DataFrame = pd.DataFrame({"A": [1, 1, 2], "B": ["x", "y", "y"]})
    result, code = apply_drop_duplicates(df, NodeConfig(columns=["A"]))
    _assert_valid_code(code)
    assert result.shape[0] == 2
    assert list(result["A"]) == [1, 2]


def test_drop_duplicates_unknown_column() -> None:
    df: pd.DataFrame = pd.DataFrame({"A": [1]})
    with pytest.raises(HTTPException):
        apply_drop_duplicates(df, NodeConfig(columns=["Nope"]))


def test_drop_duplicates_engine_integration(sample_df: pd.DataFrame) -> None:
    doubled: pd.DataFrame = pd.concat([sample_df, sample_df], ignore_index=True)
    result: pd.DataFrame = execute_pipeline(
        doubled,
        [PipelineNode(id="d1", type="drop-duplicates", config=NodeConfig())],
        [],
    )
    assert result.shape[0] == sample_df.shape[0]


def test_filter_contains_nan_matches_generated_code() -> None:
    # Runtime treats NaN as "" — the generated code must do the same, so a
    # `contains "nan"` filter matches nothing in both.
    df: pd.DataFrame = pd.DataFrame({"Name": ["Alice", None, "Bob"]})
    result, code = apply_filter_rows(
        df,
        NodeConfig(
            conditions=[{"column": "Name", "operator": "contains", "value": "nan"}]
        ),
    )
    _assert_valid_code(code)
    assert 'fillna("")' in code
    assert result.shape[0] == 0


def test_intermediates_in_topo_order() -> None:
    df: pd.DataFrame = pd.DataFrame({"A": [3, 1, 2, 2], "B": ["x", "y", "x", "x"]})
    nodes = [
        PipelineNode(id="s1", type="sort", config=NodeConfig(by=["A"], ascending=True)),
        PipelineNode(id="d1", type="drop-duplicates", config=NodeConfig()),
    ]
    edges = [{"source": "s1", "target": "d1"}]
    final, previews = execute_pipeline_with_intermediates(df, nodes, edges)
    assert [p.node_id for p in previews] == ["s1", "d1"]
    assert previews[0].shape[0] == 4
    assert [r["A"] for r in previews[0].preview] == [1, 2, 2, 3]
    assert previews[1].shape[0] == 3
    assert final.shape[0] == 3
    assert all(p.approximate is False for p in previews)


def test_intermediates_empty_pipeline() -> None:
    df: pd.DataFrame = pd.DataFrame({"A": [1]})
    final, previews = execute_pipeline_with_intermediates(df, [], [])
    assert final.shape == (1, 1)
    assert previews == []


def test_pure_no_mutation(sample_df: pd.DataFrame) -> None:
    before: pd.DataFrame = sample_df.copy(deep=True)
    apply_fill_na(sample_df, NodeConfig(strategy="mean"))
    apply_normalize(sample_df, NodeConfig(method="min-max"))
    apply_encode_categorical(sample_df, NodeConfig(method="label", columns=["Dept"]))
    pd.testing.assert_frame_equal(sample_df, before)


def test_fill_na_ffill_limit() -> None:
    df: pd.DataFrame = pd.DataFrame({"a": [1.0, None, None, 4.0]})
    result, code = apply_fill_na(df, NodeConfig(columns=["a"], strategy="ffill", limit=1))
    _assert_valid_code(code)
    assert result["a"].tolist()[:2] == [1.0, 1.0]
    assert pd.isna(result["a"].tolist()[2])
    with pytest.raises(HTTPException):
        apply_fill_na(df, NodeConfig(columns=["a"], strategy="ffill", limit=-1))


def test_fill_na_bfill() -> None:
    df: pd.DataFrame = pd.DataFrame({"a": [1.0, None, None, 4.0]})
    result, code = apply_fill_na(df, NodeConfig(columns=["a"], strategy="bfill"))
    _assert_valid_code(code)
    assert result["a"].tolist() == [1.0, 4.0, 4.0, 4.0]


def test_drop_na_how_all(sample_df: pd.DataFrame) -> None:
    # No row is missing in BOTH Name and Age here, unlike the default any.
    result, code = apply_drop_na(
        sample_df, NodeConfig(columns=["Name", "Age"], how="all")
    )
    _assert_valid_code(code)
    assert result.shape == (4, 5)
    with pytest.raises(HTTPException):
        apply_drop_na(sample_df, NodeConfig(how="sometimes"))


def test_round_values(sample_df: pd.DataFrame) -> None:
    result, code = apply_round_values(
        sample_df, NodeConfig(columns=["Salary"], decimals=0)
    )
    _assert_valid_code(code)
    vals = result["Salary"].tolist()
    assert vals[0] == 50000.0 and vals[2] == 70000.0
    assert pd.isna(vals[1])
    auto, auto_code = apply_round_values(sample_df, NodeConfig())
    _assert_valid_code(auto_code)
    assert "select_dtypes" in auto_code
    with pytest.raises(HTTPException):
        apply_round_values(sample_df, NodeConfig(columns=["Nope"], decimals=1))


def test_reorder_columns(sample_df: pd.DataFrame) -> None:
    order: List[str] = ["HireDate", "Dept", "Salary", "Age", "Name"]
    result, code = apply_reorder_columns(sample_df, NodeConfig(columns=order))
    _assert_valid_code(code)
    assert result.columns.tolist() == order
    # Inexact orders must fail loudly instead of silently dropping data.
    with pytest.raises(HTTPException):
        apply_reorder_columns(sample_df, NodeConfig(columns=["Name"]))
    with pytest.raises(HTTPException):
        apply_reorder_columns(sample_df, NodeConfig(columns=[]))


def test_drop_empty_columns() -> None:
    df: pd.DataFrame = pd.DataFrame(
        {"a": [1, 2], "b": [None, None], "c": ["", ""], "d": ["x", ""]}
    )
    result, code = apply_drop_empty_columns(df, NodeConfig())
    _assert_valid_code(code)
    # b is all-NA and c is all-''; d has one real value so it stays.
    assert result.columns.tolist() == ["a", "d"]


def test_replace_values(sample_df: pd.DataFrame) -> None:
    result, code = apply_replace_values(
        sample_df, NodeConfig(columns=["Dept"], find="IT", replacement="Eng")
    )
    _assert_valid_code(code)
    assert result["Dept"].tolist() == ["Eng", "HR", "Eng", "HR"]
    insensitive, _ = apply_replace_values(
        sample_df,
        NodeConfig(columns=["Dept"], find="it", replacement="Eng", case_sensitive=False),
    )
    assert insensitive["Dept"].tolist() == ["Eng", "HR", "Eng", "HR"]
    nulled, null_code = apply_replace_values(
        sample_df, NodeConfig(columns=["Dept"], find="HR", replacement=None)
    )
    _assert_valid_code(null_code)
    assert nulled["Dept"].isna().sum() == 2
    with pytest.raises(HTTPException):
        apply_replace_values(sample_df, NodeConfig(columns=["Dept"]))
