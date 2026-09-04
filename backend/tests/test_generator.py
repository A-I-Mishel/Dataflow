import ast
import io
import os
import subprocess
import sys
from pathlib import Path
from typing import Dict, List

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pandas as pd
from fastapi.testclient import TestClient

from engine import execute_pipeline
from generator import generate_script
from main import app
from models import NodeConfig, PipelineNode

client = TestClient(app)


def _eight_node_pipeline() -> List[PipelineNode]:
    return [
        PipelineNode(id="n1", type="fill-na", config=NodeConfig(strategy="mean")),
        PipelineNode(id="n2", type="drop-na", config=NodeConfig()),
        PipelineNode(
            id="n3", type="rename-column", config=NodeConfig(mapping={"Name": "FullName"})
        ),
        PipelineNode(
            id="n4",
            type="filter-rows",
            config=NodeConfig(
                conditions=[{"column": "Age", "operator": ">=", "value": 0, "logic": None}]
            ),
        ),
        PipelineNode(
            id="n5",
            type="normalize",
            config=NodeConfig(method="min-max", columns=["Age", "Salary"]),
        ),
        PipelineNode(
            id="n6",
            type="encode-categorical",
            config=NodeConfig(method="one-hot", columns=["Dept"]),
        ),
        PipelineNode(id="n7", type="sort", config=NodeConfig(by=["Age"], ascending=True)),
        PipelineNode(
            id="n8", type="drop-column", config=NodeConfig(columns=["HireDate"])
        ),
    ]


def _linear_edges(ids: List[str]) -> List[Dict[str, str]]:
    return [{"source": ids[i], "target": ids[i + 1]} for i in range(len(ids) - 1)]


def test_generate_script_syntax() -> None:
    nodes: List[PipelineNode] = _eight_node_pipeline()
    edges: List[Dict[str, str]] = _linear_edges([n.id for n in nodes])
    script: str = generate_script(nodes, edges, filename="data.csv")
    assert "import pandas as pd" in script
    assert "import numpy as np" in script
    assert "LabelEncoder" in script
    assert "# Load dataset" in script
    assert "# Save cleaned dataset" in script
    assert "# Step 1:" in script
    assert "# Step 8:" in script
    assert 'df.to_csv("cleaned_data.csv", index=False)' in script
    ast.parse(script)


def test_generate_script_runs(tmp_path: Path) -> None:
    sample: pd.DataFrame = pd.DataFrame(
        {
            "A": [1, 2, None, 4],
            "B": [10.0, 20.0, 30.0, None],
            "C": ["x", "y", "z", "w"],
        }
    )
    nodes: List[PipelineNode] = [
        PipelineNode(id="d1", type="drop-na", config=NodeConfig()),
        PipelineNode(
            id="d2", type="normalize", config=NodeConfig(method="min-max", columns=["A", "B"])
        ),
        PipelineNode(id="d3", type="sort", config=NodeConfig(by=["A"], ascending=True)),
    ]
    edges: List[Dict[str, str]] = _linear_edges([n.id for n in nodes])

    script: str = generate_script(nodes, edges, filename="input.csv")
    ast.parse(script)

    input_csv: Path = tmp_path / "input.csv"
    script_path: Path = tmp_path / "gen.py"
    output_csv: Path = tmp_path / "cleaned_data.csv"
    sample.to_csv(input_csv, index=False)
    script_path.write_text(script, encoding="utf-8")

    proc: subprocess.CompletedProcess[str] = subprocess.run(
        [sys.executable, str(script_path)],
        cwd=str(tmp_path),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, f"script failed: {proc.stderr}"
    assert output_csv.exists()

    actual: pd.DataFrame = pd.read_csv(output_csv)
    expected: pd.DataFrame = execute_pipeline(sample, nodes, edges)

    actual_reset: pd.DataFrame = actual.reset_index(drop=True)
    expected_reset: pd.DataFrame = expected.reset_index(drop=True)
    assert list(actual_reset.columns) == list(expected_reset.columns)
    assert actual_reset.shape == expected_reset.shape
    pd.testing.assert_frame_equal(
        actual_reset, expected_reset, check_dtype=False, check_exact=False, atol=1e-6
    )


def test_download_endpoint() -> None:
    upload = client.post(
        "/upload", files={"file": ("d.csv", "X,Y\n1,a\n2,b\n", "text/csv")}
    )
    assert upload.status_code == 200
    session_id: str = upload.json()["session_id"]
    executed = client.post(
        "/execute", json={"session_id": session_id, "nodes": [], "edges": []}
    )
    assert executed.status_code == 200
    response = client.get(f"/download/{session_id}")
    assert response.status_code == 200
    content_type: str = response.headers.get("content-type", "")
    assert "text/csv" in content_type
    assert "cleaned_data.csv" in response.headers.get("content-disposition", "")
    parsed: pd.DataFrame = pd.read_csv(io.StringIO(response.text))
    expected: pd.DataFrame = pd.DataFrame({"X": [1, 2], "Y": ["a", "b"]})
    pd.testing.assert_frame_equal(parsed, expected, check_dtype=False)


def test_session_isolation() -> None:
    upload = client.post(
        "/upload",
        files={"file": ("d.csv", "X\n1\n", "text/csv")},
        headers={"X-API-Key": "browser-a"},
    )
    assert upload.status_code == 200
    session_id: str = upload.json()["session_id"]
    executed = client.post(
        "/execute",
        json={"session_id": session_id, "nodes": [], "edges": []},
        headers={"X-API-Key": "browser-a"},
    )
    assert executed.status_code == 200
    same_key = client.get(
        f"/download/{session_id}", headers={"X-API-Key": "browser-a"}
    )
    other_key = client.get(
        f"/download/{session_id}", headers={"X-API-Key": "browser-b"}
    )
    assert same_key.status_code == 200
    assert other_key.status_code == 404
