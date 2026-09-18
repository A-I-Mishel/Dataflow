import { describe, expect, it } from "vitest";

import { calculateOneHotForecast, formatCompact, type OneHotForecastInput } from "./oneHotForecast";

const BASE: Omit<OneHotForecastInput, "selected"> = {
  schemaCols: ["A", "B", "C"],
  rowCount: 100,
  uniqueCounts: { A: 2, B: 5, C: 3 },
  cardinalityAvailable: true,
  oneHotMaxCells: 10_000_000,
};

describe("calculateOneHotForecast", () => {
  it("computes a fully-known single selection", () => {
    const result = calculateOneHotForecast({ ...BASE, selected: ["B"] });
    expect(result.status).toBe("normal");
    expect(result.dummyColumns).toBe(5);
    expect(result.keptColumns).toBe(2);
    expect(result.estimatedColumns).toBe(7);
    expect(result.estimatedRows).toBe(100);
    expect(result.estimatedCells).toBe(700);
    expect(result.unknownColumns).toEqual([]);
    expect(result.expansionDrivers).toEqual([]);
    expect(result.perColumn).toEqual([{ column: "B", uniqueValues: 5 }]);
  });

  it("sums multiple selections and removes retained columns once each", () => {
    const result = calculateOneHotForecast({ ...BASE, selected: ["B", "C"] });
    expect(result.dummyColumns).toBe(8);
    expect(result.keptColumns).toBe(1);
    expect(result.estimatedColumns).toBe(9);
    expect(result.estimatedCells).toBe(900);
    expect(result.status).toBe("normal");
  });

  it("mirrors the backend dict semantics on duplicate selections", () => {
    // Backend sums uniques through a dict (duplicates collapse) but counts
    // raw len(target) for kept columns.
    const result = calculateOneHotForecast({ ...BASE, selected: ["B", "B"] });
    expect(result.dummyColumns).toBe(5);
    expect(result.keptColumns).toBe(1);
    expect(result.estimatedColumns).toBe(6);
    expect(result.estimatedCells).toBe(600);
    expect(result.status).toBe("normal");
  });

  it("handles zero selected columns as the identity fold", () => {
    const result = calculateOneHotForecast({ ...BASE, selected: [] });
    expect(result.dummyColumns).toBe(0);
    expect(result.keptColumns).toBe(3);
    expect(result.estimatedColumns).toBe(3);
    expect(result.estimatedCells).toBe(300);
    expect(result.status).toBe("normal");
    expect(result.unknownColumns).toEqual([]);
  });

  it("yields an unavailable aggregate on partially-known selection, never zero-filled", () => {
    const result = calculateOneHotForecast({
      schemaCols: ["Department", "CustomerID", "Gender"],
      selected: ["Department", "CustomerID"],
      rowCount: 1000,
      uniqueCounts: { Department: 8, Gender: 3 },
      cardinalityAvailable: true,
      oneHotMaxCells: 10_000_000,
    });
    expect(result.status).toBe("unavailable");
    // NOT 8 + 0 = 8: unknowns stay unknown.
    expect(result.dummyColumns).toBeNull();
    expect(result.estimatedColumns).toBeNull();
    expect(result.estimatedCells).toBeNull();
    expect(result.unknownColumns).toEqual(["CustomerID"]);
    expect(result.perColumn).toEqual([
      { column: "Department", uniqueValues: 8 },
      { column: "CustomerID", uniqueValues: null },
    ]);
  });

  it("lists unknown-cardinality selections without counting them", () => {
    const result = calculateOneHotForecast({ ...BASE, selected: ["B", "Ghost"] });
    expect(result.unknownColumns).toEqual(["Ghost"]);
    expect(result.status).toBe("unavailable");
  });

  it("excludes stale config names from the input math", () => {
    const result = calculateOneHotForecast({ ...BASE, selected: ["Deleted"] });
    expect(result.selectedInSchema).toEqual([]);
    expect(result.unknownColumns).toEqual(["Deleted"]);
    expect(result.dummyColumns).toBeNull();
    expect(result.status).toBe("unavailable");
  });

  it("treats renamed/unmapped columns as unknown, never zero", () => {
    const result = calculateOneHotForecast({
      schemaCols: ["CustomerID", "Age"],
      selected: ["CustomerID"],
      rowCount: 17500,
      uniqueCounts: { EmployeeID: 17842, Age: 60 },
      cardinalityAvailable: true,
      oneHotMaxCells: 10_000_000,
    });
    expect(result.perColumn).toEqual([{ column: "CustomerID", uniqueValues: null }]);
    expect(result.unknownColumns).toEqual(["CustomerID"]);
    expect(result.dummyColumns).toBeNull();
    expect(result.status).toBe("unavailable");
  });

  it("classifies the exact limit as normal and limit+1 as exceeds", () => {
    const atLimit = calculateOneHotForecast({
      schemaCols: ["A", "B"],
      selected: ["B"],
      rowCount: 100,
      uniqueCounts: { B: 5 },
      cardinalityAvailable: true,
      oneHotMaxCells: 600,
    });
    expect(atLimit.estimatedCells).toBe(600);
    expect(atLimit.status).toBe("normal");

    const overLimit = calculateOneHotForecast({
      schemaCols: ["A", "B"],
      selected: ["B"],
      rowCount: 100,
      uniqueCounts: { B: 5 },
      cardinalityAvailable: true,
      oneHotMaxCells: 599,
    });
    expect(overLimit.estimatedCells).toBe(600);
    expect(overLimit.status).toBe("exceeds");
  });

  it("marks counterfactual expansion drivers without any fixed threshold", () => {
    const result = calculateOneHotForecast({
      schemaCols: ["Big", "Small", "Kept"],
      selected: ["Big", "Small"],
      rowCount: 1000,
      uniqueCounts: { Big: 9000, Small: 5 },
      cardinalityAvailable: true,
      oneHotMaxCells: 10_000_000,
    });
    // 1000 x (1 + 9005) = 9,006,000 normal; force exceeds via small limit.
    expect(result.status).toBe("normal");
    const over = calculateOneHotForecast({
      schemaCols: ["Big", "Small", "Kept"],
      selected: ["Big", "Small"],
      rowCount: 1000,
      uniqueCounts: { Big: 9000, Small: 5 },
      cardinalityAvailable: true,
      oneHotMaxCells: 1_000_000,
    });
    expect(over.status).toBe("exceeds");
    // Removing Big (1000 x (1+5) = 6000) flips to normal; removing Small does not.
    expect(over.expansionDrivers).toEqual(["Big"]);
  });

  it("is unavailable without cardinality metadata, cap, or availability flag", () => {
    const noMeta = calculateOneHotForecast({
      ...BASE,
      selected: ["B"],
      uniqueCounts: null,
    });
    expect(noMeta.status).toBe("unavailable");
    expect(noMeta.dummyColumns).toBeNull();

    const largeFile = calculateOneHotForecast({
      ...BASE,
      selected: ["B"],
      cardinalityAvailable: false,
    });
    expect(largeFile.status).toBe("unavailable");

    const oldSession = calculateOneHotForecast({
      ...BASE,
      selected: ["B"],
      oneHotMaxCells: undefined,
    });
    expect(oldSession.status).toBe("unavailable");
  });

  it("scales the real-world high-cardinality case", () => {
    const result = calculateOneHotForecast({
      schemaCols: ["EmployeeID", "Department", "Age"],
      selected: ["EmployeeID"],
      rowCount: 17500,
      uniqueCounts: { EmployeeID: 17842, Department: 8, Age: 60 },
      cardinalityAvailable: true,
      oneHotMaxCells: 10_000_000,
    });
    expect(result.dummyColumns).toBe(17842);
    expect(result.keptColumns).toBe(2);
    expect(result.estimatedCells).toBe(17500 * 17844);
    expect(result.status).toBe("exceeds");
    expect(result.expansionDrivers).toEqual(["EmployeeID"]);
  });
});

describe("formatCompact", () => {
  it("formats full thousands below a million and compact millions above", () => {
    expect(formatCompact(17842)).toBe("17,842");
    expect(formatCompact(312500000)).toBe("312.5M");
    expect(formatCompact(10000000)).toBe("10M");
    expect(formatCompact(700)).toBe("700");
  });
});
