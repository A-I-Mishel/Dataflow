import { describe, expect, it } from "vitest";

import type { PipelineNode } from "../types";
import { serializeNodes } from "./api";

function node(id: string, config: PipelineNode["data"]["config"]): PipelineNode {
  return { id, type: "filter-rows", position: { x: 0, y: 0 }, data: { label: id, config } };
}

describe("serializeNodes", () => {
  it("strips client-only condition ids from the wire payload", () => {
    const [serialized] = serializeNodes([
      node("a", {
        conditions: [
          { column: "Age", operator: ">", value: 18, id: "client-1" },
          { column: "Name", operator: "contains", value: "Al", logic: "AND", id: "client-2" },
        ],
      }),
    ]);
    expect(serialized.config.conditions).toEqual([
      { column: "Age", operator: ">", value: 18 },
      { column: "Name", operator: "contains", value: "Al", logic: "AND" },
    ]);
  });

  it("leaves configs without conditions untouched", () => {
    const [serialized] = serializeNodes([node("a", { columns: ["Age"] })]);
    expect(serialized).toEqual({
      id: "a",
      type: "filter-rows",
      config: { columns: ["Age"] },
    });
  });
});
