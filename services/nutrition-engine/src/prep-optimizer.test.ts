import { describe, it, expect } from "vitest";
import {
  computeDemandRollup,
  generateBatchSuggestions,
  generatePrepDraft,
  type MealDemand,
  type YieldInfo,
  type InventoryOnHand,
} from "./prep-optimizer.js";

// ── Helpers ────────────────────────────────────────────

function makeMeal(overrides: Partial<MealDemand> = {}): MealDemand {
  return {
    mealId: "meal-1",
    serviceDate: "2026-03-01",
    componentId: "comp-chicken",
    componentName: "Grilled Chicken Breast",
    componentType: "PROTEIN",
    cookedG: 150,
    ...overrides,
  };
}

function makeYield(id: string, factor: number, basis: "calibrated" | "default" = "default"): YieldInfo {
  return { componentId: id, yieldFactor: factor, basis };
}

function makeInventory(id: string, g: number): InventoryOnHand {
  return { componentId: id, availableG: g };
}

// ── computeDemandRollup ────────────────────────────────

describe("computeDemandRollup", () => {
  it("returns empty for no meals", () => {
    const result = computeDemandRollup([], [], []);
    expect(result).toHaveLength(0);
  });

  it("computes single component rollup", () => {
    const meals = [
      makeMeal({ mealId: "m1", cookedG: 150 }),
      makeMeal({ mealId: "m2", cookedG: 150 }),
      makeMeal({ mealId: "m3", cookedG: 150 }),
    ];
    const yields = [makeYield("comp-chicken", 0.85)];
    const inventory = [makeInventory("comp-chicken", 400)];

    const result = computeDemandRollup(meals, yields, inventory);
    expect(result).toHaveLength(1);

    const r = result[0]!;
    expect(r.totalCookedG).toBe(450);
    // 450 / 0.85 ≈ 529.41
    expect(r.rawG).toBeCloseTo(529.41, 1);
    expect(r.yieldFactor).toBe(0.85);
    expect(r.mealCount).toBe(3);
    expect(r.inventoryOnHandG).toBe(400);
    // shortage: 529.41 - 400 = 129.41
    expect(r.shortageG).toBeCloseTo(129.41, 1);
    expect(r.sufficient).toBe(false);
  });

  it("marks sufficient when inventory covers demand", () => {
    const meals = [makeMeal({ cookedG: 100 })];
    const yields = [makeYield("comp-chicken", 0.9)];
    const inventory = [makeInventory("comp-chicken", 500)];

    const result = computeDemandRollup(meals, yields, inventory);
    expect(result[0]!.sufficient).toBe(true);
    expect(result[0]!.shortageG).toBe(0);
  });

  it("uses default yield factor of 1.0 when not provided", () => {
    const meals = [makeMeal({ cookedG: 200 })];
    const result = computeDemandRollup(meals, [], []);
    expect(result[0]!.rawG).toBe(200); // 200 / 1.0
    expect(result[0]!.yieldBasis).toBe("default");
  });

  it("groups multiple components correctly", () => {
    const meals = [
      makeMeal({ componentId: "comp-chicken", componentName: "Chicken", cookedG: 150 }),
      makeMeal({ componentId: "comp-rice", componentName: "Rice", componentType: "CARB_BASE", cookedG: 200 }),
      makeMeal({ componentId: "comp-chicken", componentName: "Chicken", cookedG: 150, mealId: "m2" }),
    ];
    const result = computeDemandRollup(meals, [], []);
    expect(result).toHaveLength(2);

    const chicken = result.find((r) => r.componentId === "comp-chicken");
    const rice = result.find((r) => r.componentId === "comp-rice");
    expect(chicken!.totalCookedG).toBe(300);
    expect(chicken!.mealCount).toBe(2);
    expect(rice!.totalCookedG).toBe(200);
    expect(rice!.mealCount).toBe(1);
  });

  it("sorts by shortage descending", () => {
    const meals = [
      makeMeal({ componentId: "a", componentName: "A", cookedG: 100 }),
      makeMeal({ componentId: "b", componentName: "B", cookedG: 500 }),
    ];
    const result = computeDemandRollup(meals, [], []);
    // Both have 0 inventory, so shortage = rawG
    expect(result[0]!.componentId).toBe("b");
    expect(result[1]!.componentId).toBe("a");
  });

  it("uses calibrated yield factor when available", () => {
    const meals = [makeMeal({ cookedG: 200 })];
    const yields = [makeYield("comp-chicken", 0.82, "calibrated")];
    const result = computeDemandRollup(meals, yields, []);
    expect(result[0]!.yieldBasis).toBe("calibrated");
    expect(result[0]!.rawG).toBeCloseTo(243.9, 0);
  });
});

// ── generateBatchSuggestions ───────────────────────────

describe("generateBatchSuggestions", () => {
  it("returns empty for no rollups", () => {
    expect(generateBatchSuggestions([])).toHaveLength(0);
  });

  it("marks shortage items as high priority", () => {
    const meals = [
      makeMeal({ componentId: "comp-a", componentName: "A", cookedG: 500 }),
    ];
    const rollups = computeDemandRollup(meals, [], []);
    const suggestions = generateBatchSuggestions(rollups);
    expect(suggestions[0]!.priority).toBe("high");
    expect(suggestions[0]!.isShortage).toBe(true);
  });

  it("marks sharing opportunities for 3+ meals", () => {
    const meals = Array.from({ length: 5 }, (_, i) =>
      makeMeal({ mealId: `m${i}`, cookedG: 100 })
    );
    const rollups = computeDemandRollup(meals, [], [makeInventory("comp-chicken", 1000)]);
    const suggestions = generateBatchSuggestions(rollups);
    expect(suggestions[0]!.sharingOpportunity).toBe(true);
    expect(suggestions[0]!.sharedMealCount).toBe(5);
  });

  it("sorts high priority before medium and low", () => {
    const meals = [
      makeMeal({ componentId: "a", componentName: "Shortage Item", cookedG: 500 }),
      ...Array.from({ length: 5 }, (_, i) =>
        makeMeal({ componentId: "b", componentName: "Popular Item", cookedG: 100, mealId: `m${i}` })
      ),
    ];
    const rollups = computeDemandRollup(meals, [], [
      makeInventory("b", 1000), // plenty for b
    ]);
    const suggestions = generateBatchSuggestions(rollups);
    // "a" has shortage → high priority, should come first
    expect(suggestions[0]!.componentId).toBe("a");
    expect(suggestions[0]!.priority).toBe("high");
  });
});

// ── generatePrepDraft ──────────────────────────────────

describe("generatePrepDraft", () => {
  it("generates complete prep draft", () => {
    const meals = [
      makeMeal({ componentId: "comp-chicken", cookedG: 150, mealId: "m1" }),
      makeMeal({ componentId: "comp-chicken", cookedG: 150, mealId: "m2" }),
      makeMeal({ componentId: "comp-chicken", cookedG: 150, mealId: "m3" }),
      makeMeal({ componentId: "comp-rice", componentName: "Rice", componentType: "CARB_BASE", cookedG: 200, mealId: "m4" }),
    ];
    const yields = [
      makeYield("comp-chicken", 0.85),
      makeYield("comp-rice", 0.95),
    ];
    const inventory = [
      makeInventory("comp-chicken", 200),
      makeInventory("comp-rice", 300),
    ];

    const draft = generatePrepDraft("2026-03-01", "2026-03-07", meals, yields, inventory);

    expect(draft.weekStart).toBe("2026-03-01");
    expect(draft.weekEnd).toBe("2026-03-07");
    expect(draft.totalMeals).toBe(4);
    expect(draft.totalComponents).toBe(2);
    expect(draft.demand).toHaveLength(2);
    expect(draft.batchSuggestions).toHaveLength(2);
    // Chicken: 450/0.85 = 529.4, on hand 200, shortage 329.4
    expect(draft.shortages.length).toBeGreaterThanOrEqual(1);
    expect(draft.shortages.some((s) => s.componentId === "comp-chicken")).toBe(true);
  });

  it("no shortages when inventory is sufficient", () => {
    const meals = [makeMeal({ cookedG: 100 })];
    const yields = [makeYield("comp-chicken", 0.9)];
    const inventory = [makeInventory("comp-chicken", 500)];

    const draft = generatePrepDraft("2026-03-01", "2026-03-07", meals, yields, inventory);
    expect(draft.shortages).toHaveLength(0);
  });

  it("handles empty meal list", () => {
    const draft = generatePrepDraft("2026-03-01", "2026-03-07", [], [], []);
    expect(draft.totalMeals).toBe(0);
    expect(draft.totalComponents).toBe(0);
    expect(draft.demand).toHaveLength(0);
    expect(draft.batchSuggestions).toHaveLength(0);
    expect(draft.shortages).toHaveLength(0);
  });
});
