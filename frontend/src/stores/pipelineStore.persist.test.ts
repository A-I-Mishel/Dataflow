import { describe, expect, it } from "vitest";

import type { DataPreview } from "../types";

// zustand/persist touches window.localStorage on import in a node test env,
// so stub a memory-backed version before importing the store module.
const memory = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string): string | null => memory.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      memory.set(key, value);
    },
    removeItem: (key: string): void => {
      memory.delete(key);
    },
  },
});

const { migratePersistedState, partializePipelineState } = await import("./pipelineStore");
import type { PersistCandidate, PipelineState } from "./pipelineStore";

function asFullState(candidate: PersistCandidate): PipelineState {
  // partialize only reads the persisted slice; the cast avoids stubbing 30+ store actions.
  return candidate as unknown as PipelineState;
}

function candidate(overrides: Partial<PersistCandidate> = {}): PersistCandidate {
  return {
    theme: "dark",
    nodes: [],
    edges: [],
    sessionId: "session-1",
    columnList: ["Name", "Age"],
    originalData: null,
    isLargeFile: false,
    ...overrides,
  };
}

function fullPreview(): DataPreview {
  return {
    columns: ["Name", "Age"],
    dtypes: { Name: "object", Age: "int64" },
    row_count: 2,
    preview: [
      { Name: "Ada", Age: 36 },
      { Name: "Grace", Age: 85 },
    ],
    missing_values: { Name: 0, Age: 1 },
    filename: "people.csv",
    unique_counts: { Name: 2, Age: 2 },
    cardinality_available: true,
    one_hot_max_cells: 1000000,
  };
}

describe("partializePipelineState", () => {
  it("strips preview rows but keeps metadata", () => {
    const out = partializePipelineState(asFullState(candidate({ originalData: fullPreview() })));
    expect(out.originalData).not.toBeNull();
    expect(out.originalData?.preview).toEqual([]);
    expect(out.originalData?.columns).toEqual(["Name", "Age"]);
    expect(out.originalData?.dtypes).toEqual({ Name: "object", Age: "int64" });
    expect(out.originalData?.row_count).toBe(2);
    expect(out.originalData?.filename).toBe("people.csv");
    expect(out.originalData?.missing_values).toEqual({ Name: 0, Age: 1 });
    expect(out.originalData?.unique_counts).toEqual({ Name: 2, Age: 2 });
    expect(out.originalData?.cardinality_available).toBe(true);
    expect(out.originalData?.one_hot_max_cells).toBe(1000000);
  });

  it("keeps null datasets as null", () => {
    const out = partializePipelineState(asFullState(candidate()));
    expect(out.originalData).toBeNull();
  });

  it("never includes result or code payloads", () => {
    const out = partializePipelineState(asFullState(candidate({ originalData: fullPreview() })));
    expect(out).not.toHaveProperty("resultData");
    expect(out).not.toHaveProperty("generatedCode");
  });
});

describe("migratePersistedState", () => {
  it("strips preview rows from legacy v0/v1 payloads", () => {
    const legacy = { originalData: fullPreview(), columnList: ["Name", "Age"] };
    const migrated = migratePersistedState(legacy) as { originalData: DataPreview };
    expect(migrated.originalData.preview).toEqual([]);
    expect(migrated.originalData.columns).toEqual(["Name", "Age"]);
  });

  it("passes through null datasets, non-objects and payloads without datasets", () => {
    expect(migratePersistedState(null)).toBeNull();
    expect(migratePersistedState("junk")).toBe("junk");
    expect(migratePersistedState({ originalData: null })).toEqual({ originalData: null });
    expect(migratePersistedState({ nodes: [] })).toEqual({ nodes: [] });
  });
});
