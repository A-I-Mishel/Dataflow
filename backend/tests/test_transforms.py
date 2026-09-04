import ast
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pandas as pd
import pytest
from fastapi import HTTPException

from models import NodeConfig
from transforms.drop_column import apply_drop_column
from transforms.drop_na import apply_drop_na
from transforms.encode_categorical import apply_encode_categorical
from transforms.fill_na import apply_fill_na
from transforms.filter_rows import apply_filter_rows
from transforms.normalize import apply_normalize
from transforms.rename_column import apply_rename_column
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


def test_pure_no_mutation(sample_df: pd.DataFrame) -> None:
    before: pd.DataFrame = sample_df.copy(deep=True)
    apply_fill_na(sample_df, NodeConfig(strategy="mean"))
    apply_normalize(sample_df, NodeConfig(method="min-max"))
    apply_encode_categorical(sample_df, NodeConfig(method="label", columns=["Dept"]))
    pd.testing.assert_frame_equal(sample_df, before)
