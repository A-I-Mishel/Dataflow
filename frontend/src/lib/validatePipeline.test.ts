import { describe, expect, it } from "vitest";

import type { NodeConfig, NodeType, PipelineEdge, PipelineNode } from "../types";
import {
  getDisconnectedNodes,
  getNodeErrors,
  hasCycle,
  validateLinearChain,
  validateLoadedPipeline,
  validateNodeConfigs,
} from "./validatePipeline";

function node(id: string, type: NodeType = "drop-na", config: NodeConfig = {}): PipelineNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, config } };
}

function edge(id: string, source: string, target: string): PipelineEdge {
  return { id, source, target };
}

describe("hasCycle", () => {
  it("returns false for empty and linear pipelines", () => {
    expect(hasCycle([], [])).toBe(false);
    expect(
      hasCycle([node("a"), node("b"), node("c")], [edge("e1", "a", "b"), edge("e2", "b", "c")]),
    ).toBe(false);
  });

  it("detects a back-edge cycle", () => {
    expect(
      hasCycle(
        [node("a"), node("b"), node("c")],
        [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "a")],
      ),
    ).toBe(true);
  });

  it("detects a self-loop", () => {
    expect(hasCycle([node("a")], [edge("e1", "a", "a")])).toBe(true);
  });
});

describe("validateLinearChain", () => {
  it("accepts empty, single-node and simple chains", () => {
    expect(validateLinearChain([], [])).toBeNull();
    expect(validateLinearChain([node("a")], [])).toBeNull();
    expect(validateLinearChain([node("a"), node("b")], [edge("e1", "a", "b")])).toBeNull();
  });

  it("rejects multiple starting nodes", () => {
    const message = validateLinearChain([node("a"), node("b")], []);
    expect(message).toContain("2 starting nodes");
  });

  it("rejects forks by naming the branches", () => {
    const message = validateLinearChain(
      [node("a"), node("b"), node("c")],
      [edge("e1", "a", "b"), edge("e2", "a", "c")],
    );
    expect(message).toContain("splits into multiple branches");
    expect(message).toContain('"b"');
  });
});

describe("getDisconnectedNodes", () => {
  it("returns nothing for a connected chain", () => {
    expect(getDisconnectedNodes([node("a"), node("b")], [edge("e1", "a", "b")])).toEqual([]);
  });

  it("returns cycle members unreachable from any root", () => {
    const found = getDisconnectedNodes(
      [node("a"), node("b"), node("c")],
      [edge("e1", "a", "b"), edge("e2", "b", "a")],
    );
    expect(found).toContain("a");
    expect(found).toContain("b");
    expect(found).not.toContain("c");
  });
});

describe("validateNodeConfigs", () => {
  it("flags a fill-na node with no strategy", () => {
    const errors = validateNodeConfigs([node("a", "fill-na", {})], [], ["Age"]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("fill strategy");
  });

  it("flags unknown columns", () => {
    const errors = validateNodeConfigs(
      [node("a", "drop-column", { columns: ["Nope"] })],
      [],
      ["Age"],
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("Nope");
  });

  it("hints at surrounding whitespace", () => {
    const errors = validateNodeConfigs(
      [node("a", "drop-column", { columns: ["Name "] })],
      [],
      ["Name"],
    );
    expect(errors[0].message).toContain("surrounding whitespace");
  });

  it("hints at case-only differences", () => {
    const errors = validateNodeConfigs(
      [node("a", "drop-column", { columns: ["name"] })],
      [],
      ["Name"],
    );
    expect(errors[0].message).toContain("differs only by case");
  });

  it("passes valid configs", () => {
    expect(
      validateNodeConfigs([node("a", "drop-column", { columns: ["Age"] })], [], ["Age"]),
    ).toEqual([]);
  });
});

describe("getNodeErrors", () => {
  it("requires sort columns", () => {
    const errors = getNodeErrors(node("a", "sort", {}), [], []);
    expect(errors).toContain("Select at least one sort column");
  });

  it("requires rename mappings", () => {
    const errors = getNodeErrors(node("a", "rename-column", {}), [], []);
    expect(errors).toContain("Add at least one mapping");
  });
});

describe("validateLoadedPipeline", () => {
  it("accepts a well-formed payload and synthesizes missing edge ids", () => {
    const result = validateLoadedPipeline({
      nodes: [
        { id: "a", type: "drop-na", position: { x: 0, y: 0 }, data: { label: "A", config: {} } },
      ],
      edges: [{ source: "a", target: "a" }],
    });
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toEqual([{ id: "a-a", source: "a", target: "a" }]);
  });

  it("rejects non-objects and missing arrays", () => {
    expect(() => validateLoadedPipeline(null)).toThrow("not an object");
    expect(() => validateLoadedPipeline({ nodes: [] })).toThrow("edges missing");
  });

  it("rejects unknown node types", () => {
    expect(() =>
      validateLoadedPipeline({
        nodes: [{ id: "a", type: "teleport", data: { config: {} } }],
        edges: [],
      }),
    ).toThrow('unknown node type "teleport"');
  });

  it("rejects duplicate node ids", () => {
    const payload = {
      nodes: [
        { id: "a", type: "drop-na", data: { config: {} } },
        { id: "a", type: "drop-na", data: { config: {} } },
      ],
      edges: [],
    };
    expect(() => validateLoadedPipeline(payload)).toThrow('duplicate node id "a"');
  });

  it("rejects edges referencing missing nodes", () => {
    expect(() =>
      validateLoadedPipeline({
        nodes: [{ id: "a", type: "drop-na", data: { config: {} } }],
        edges: [{ id: "e1", source: "a", target: "ghost" }],
      }),
    ).toThrow("references a missing node");
  });
});
