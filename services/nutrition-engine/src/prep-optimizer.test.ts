import { describe, it, expect } from "vitest";
import {
  computeDemandRollup,
  generateBatchSuggestions,
  generatePrepDraft,
  computePerDayBreakdown,
  computePortionPlan,
  generateScheduleAwarePrepDraft,
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

// ── computePerDayBreakdown ───────────────────────────

describe("computePerDayBreakdown", () => {
  it("returns empty for no meals", () => {
    expect(computePerDayBreakdown([], [])).toHaveLength(0);
  });

  it("groups by component and date", () => {
    const meals: MealDemand[] = [
      makeMeal({ mealId: "m1", serviceDate: "2026-03-03", cookedG: 180, clientId: "c1", clientName: "Alex", mealSlot: "LUNCH" }),
      makeMeal({ mealId: "m2", serviceDate: "2026-03-03", cookedG: 200, clientId: "c2", clientName: "Sam", mealSlot: "DINNER" }),
      makeMeal({ mealId: "m3", serviceDate: "2026-03-05", cookedG: 210, clientId: "c1", clientName: "Alex", mealSlot: "LUNCH" }),
    ];
    const yields = [makeYield("comp-chicken", 0.85)];

    const result = computePerDayBreakdown(meals, yields);

    // Two groups: (chicken, 03-03) and (chicken, 03-05)
    expect(result).toHaveLength(2);

    const mon = result[0]!;
    expect(mon.serviceDate).toBe("2026-03-03");
    expect(mon.totalCookedG).toBe(380);
    expect(mon.rawG).toBeCloseTo(447.06, 1);
    expect(mon.portions).toHaveLength(2);

    const thu = result[1]!;
    expect(thu.serviceDate).toBe("2026-03-05");
    expect(thu.totalCookedG).toBe(210);
    expect(thu.portions).toHaveLength(1);
    expect(thu.portions[0]!.clientName).toBe("Alex");
  });

  it("collects per-client portions", () => {
    const meals: MealDemand[] = [
      makeMeal({ mealId: "m1", serviceDate: "2026-03-03", cookedG: 180, clientId: "c1", clientName: "Alex", mealSlot: "LUNCH" }),
      makeMeal({ mealId: "m2", serviceDate: "2026-03-03", cookedG: 200, clientId: "c2", clientName: "Sam", mealSlot: "DINNER" }),
    ];

    const result = computePerDayBreakdown(meals, []);
    const portions = result[0]!.portions;

    expect(portions).toHaveLength(2);
    expect(portions.find((p) => p.clientName === "Alex")!.cookedG).toBe(180);
    expect(portions.find((p) => p.clientName === "Sam")!.cookedG).toBe(200);
  });

  it("skips portions for meals without client info", () => {
    const meals: MealDemand[] = [
      makeMeal({ mealId: "m1", cookedG: 150 }), // no clientId/clientName/mealSlot
    ];

    const result = computePerDayBreakdown(meals, []);
    expect(result).toHaveLength(1);
    expect(result[0]!.totalCookedG).toBe(150);
    expect(result[0]!.portions).toHaveLength(0);
  });

  it("sorts by date then component name", () => {
    const meals: MealDemand[] = [
      makeMeal({ mealId: "m1", serviceDate: "2026-03-05", componentId: "comp-rice", componentName: "Rice", cookedG: 100, clientId: "c1", clientName: "Alex", mealSlot: "LUNCH" }),
      makeMeal({ mealId: "m2", serviceDate: "2026-03-03", componentId: "comp-chicken", componentName: "Chicken", cookedG: 180, clientId: "c1", clientName: "Alex", mealSlot: "LUNCH" }),
      makeMeal({ mealId: "m3", serviceDate: "2026-03-03", componentId: "comp-rice", componentName: "Rice", cookedG: 200, clientId: "c2", clientName: "Sam", mealSlot: "DINNER" }),
    ];

    const result = computePerDayBreakdown(meals, []);
    expect(result[0]!.serviceDate).toBe("2026-03-03");
    expect(result[0]!.componentName).toBe("Chicken");
    expect(result[1]!.serviceDate).toBe("2026-03-03");
    expect(result[1]!.componentName).toBe("Rice");
    expect(result[2]!.serviceDate).toBe("2026-03-05");
  });
});

// ── computePortionPlan ───────────────────────────────

describe("computePortionPlan", () => {
  it("generates labeled portions from component demand", () => {
    const meals: MealDemand[] = [
      makeMeal({ mealId: "m1", serviceDate: "2026-03-03", cookedG: 180, clientId: "c1", clientName: "Alex", mealSlot: "LUNCH" }),
      makeMeal({ mealId: "m2", serviceDate: "2026-03-05", cookedG: 210, clientId: "c2", clientName: "Sam", mealSlot: "DINNER" }),
    ];
    const yields = [makeYield("comp-chicken", 0.85)];
    const rollups = computeDemandRollup(meals, yields, []);
    const rollup = rollups[0]!;

    const plan = computePortionPlan(rollup, meals);

    expect(plan.componentId).toBe("comp-chicken");
    expect(plan.portionCount).toBe(2);
    expect(plan.totalCookedG).toBe(390);

    // Sorted by date, then client (2026-03-03 = Tue, 2026-03-05 = Thu)
    expect(plan.portions[0]!.label).toBe("Alex / Tue Lunch / 180g");
    expect(plan.portions[0]!.serviceDate).toBe("2026-03-03");
    expect(plan.portions[1]!.label).toBe("Sam / Thu Dinner / 210g");
    expect(plan.portions[1]!.serviceDate).toBe("2026-03-05");
  });

  it("skips meals without client info", () => {
    const meals: MealDemand[] = [
      makeMeal({ mealId: "m1", cookedG: 150 }), // no client info
    ];
    const rollups = computeDemandRollup(meals, [], []);
    const plan = computePortionPlan(rollups[0]!, meals);

    expect(plan.portionCount).toBe(0);
    expect(plan.portions).toHaveLength(0);
  });

  it("sorts portions by date then client name", () => {
    const meals: MealDemand[] = [
      makeMeal({ mealId: "m1", serviceDate: "2026-03-05", cookedG: 100, clientId: "c2", clientName: "Sam", mealSlot: "LUNCH" }),
      makeMeal({ mealId: "m2", serviceDate: "2026-03-03", cookedG: 180, clientId: "c1", clientName: "Alex", mealSlot: "LUNCH" }),
      makeMeal({ mealId: "m3", serviceDate: "2026-03-03", cookedG: 200, clientId: "c2", clientName: "Sam", mealSlot: "DINNER" }),
    ];
    const rollups = computeDemandRollup(meals, [], []);
    const plan = computePortionPlan(rollups[0]!, meals);

    expect(plan.portions[0]!.clientName).toBe("Alex");
    expect(plan.portions[0]!.serviceDate).toBe("2026-03-03");
    expect(plan.portions[1]!.clientName).toBe("Sam");
    expect(plan.portions[1]!.serviceDate).toBe("2026-03-03");
    expect(plan.portions[2]!.clientName).toBe("Sam");
    expect(plan.portions[2]!.serviceDate).toBe("2026-03-05");
  });
});

// ── generateScheduleAwarePrepDraft ───────────────────

describe("generateScheduleAwarePrepDraft", () => {
  it("includes base draft data plus schedule enrichments", () => {
    const meals: MealDemand[] = [
      makeMeal({ mealId: "m1", serviceDate: "2026-03-03", cookedG: 180, clientId: "c1", clientName: "Alex", mealSlot: "LUNCH" }),
      makeMeal({ mealId: "m2", serviceDate: "2026-03-05", cookedG: 210, clientId: "c2", clientName: "Sam", mealSlot: "DINNER" }),
    ];
    const yields = [makeYield("comp-chicken", 0.85)];
    const inventory = [makeInventory("comp-chicken", 200)];

    const draft = generateScheduleAwarePrepDraft("2026-03-01", "2026-03-07", meals, yields, inventory);

    // Base data present
    expect(draft.weekStart).toBe("2026-03-01");
    expect(draft.weekEnd).toBe("2026-03-07");
    expect(draft.totalMeals).toBe(2);
    expect(draft.demand).toHaveLength(1);
    expect(draft.batchSuggestions).toHaveLength(1);

    // Schedule-aware enrichments
    expect(draft.perDayBreakdown).toBeDefined();
    expect(draft.perDayBreakdown!.length).toBe(2); // two dates

    expect(draft.portionPlans).toBeDefined();
    expect(draft.portionPlans!.length).toBe(1); // one component
    expect(draft.portionPlans![0]!.portionCount).toBe(2);
  });

  it("returns empty enrichments for empty meals", () => {
    const draft = generateScheduleAwarePrepDraft("2026-03-01", "2026-03-07", [], [], []);

    expect(draft.totalMeals).toBe(0);
    expect(draft.perDayBreakdown).toHaveLength(0);
    expect(draft.portionPlans).toHaveLength(0);
  });

  it("handles mix of schedule-aware and plain meals", () => {
    const meals: MealDemand[] = [
      makeMeal({ mealId: "m1", serviceDate: "2026-03-03", cookedG: 180, clientId: "c1", clientName: "Alex", mealSlot: "LUNCH" }),
      makeMeal({ mealId: "m2", serviceDate: "2026-03-03", cookedG: 150 }), // no client info
    ];

    const draft = generateScheduleAwarePrepDraft("2026-03-01", "2026-03-07", meals, [], []);

    // All meals counted in base
    expect(draft.totalMeals).toBe(2);

    // Day breakdown has one group (same component, same date)
    expect(draft.perDayBreakdown!.length).toBe(1);
    // But only 1 portion (the one with client info)
    expect(draft.perDayBreakdown![0]!.portions).toHaveLength(1);

    // Portion plan has 1 portion
    expect(draft.portionPlans![0]!.portionCount).toBe(1);
  });
});
