import { describe, it, expect } from "vitest";
import {
  aggregateComposition,
  checkAllergenWarnings,
  checkFlavorCompatibility,
  saucePortionDelta,
  type CompositionSlotInput,
} from "./composition-engine.js";

// ── Helpers ────────────────────────────────────────────

function makeSlot(overrides: Partial<CompositionSlotInput> = {}): CompositionSlotInput {
  return {
    slotType: "PROTEIN",
    componentId: "comp-chicken",
    componentName: "Grilled Chicken Breast",
    targetG: 150,
    nutrientsPer100g: {
      kcal: 165,
      proteinG: 31,
      carbG: 0,
      fatG: 3.6,
      fiberG: 0,
      sodiumMg: 74,
    },
    allergenTags: [],
    flavorProfiles: ["SAVORY"],
    ...overrides,
  };
}

function makeProteinSlot(): CompositionSlotInput {
  return makeSlot();
}

function makeBaseSlot(): CompositionSlotInput {
  return makeSlot({
    slotType: "CARB_BASE",
    componentId: "comp-rice",
    componentName: "Jasmine Rice",
    targetG: 200,
    nutrientsPer100g: {
      kcal: 130,
      proteinG: 2.7,
      carbG: 28.2,
      fatG: 0.3,
      fiberG: 0.4,
      sodiumMg: 1,
    },
    allergenTags: [],
    flavorProfiles: ["NEUTRAL"],
  });
}

function makeVegSlot(): CompositionSlotInput {
  return makeSlot({
    slotType: "VEGETABLE",
    componentId: "comp-broccoli",
    componentName: "Steamed Broccoli",
    targetG: 100,
    nutrientsPer100g: {
      kcal: 35,
      proteinG: 2.4,
      carbG: 7.2,
      fatG: 0.4,
      fiberG: 2.6,
      sodiumMg: 33,
    },
    allergenTags: [],
    flavorProfiles: ["NEUTRAL"],
  });
}

function makeSauceSlot(): CompositionSlotInput {
  return makeSlot({
    slotType: "SAUCE",
    componentId: "comp-teriyaki",
    componentName: "Teriyaki Sauce",
    targetG: 15,
    nutrientsPer100g: {
      kcal: 89,
      proteinG: 5.9,
      carbG: 15.6,
      fatG: 0,
      fiberG: 0.1,
      sodiumMg: 3830,
    },
    allergenTags: ["soy"],
    flavorProfiles: ["UMAMI", "SWEET"],
  });
}

// ── aggregateComposition ───────────────────────────────

describe("aggregateComposition", () => {
  it("returns zeros for empty slots", () => {
    const result = aggregateComposition([]);
    expect(result.totalG).toBe(0);
    expect(result.nutrients.kcal).toBe(0);
    expect(result.slotBreakdown).toHaveLength(0);
  });

  it("computes single slot nutrients correctly", () => {
    const result = aggregateComposition([makeProteinSlot()]);
    // 150g chicken: 165 * 1.5 = 247.5 kcal
    expect(result.totalG).toBe(150);
    expect(result.nutrients.kcal).toBe(247.5);
    expect(result.nutrients.proteinG).toBe(46.5);
    expect(result.nutrients.fatG).toBe(5.4);
    expect(result.slotBreakdown).toHaveLength(1);
    expect(result.slotBreakdown[0]!.slotType).toBe("PROTEIN");
  });

  it("aggregates multi-slot meal correctly", () => {
    const result = aggregateComposition([makeProteinSlot(), makeBaseSlot(), makeVegSlot()]);
    expect(result.totalG).toBe(450); // 150 + 200 + 100
    // Chicken: 247.5 + Rice: 260 + Broccoli: 35 = 542.5 kcal
    expect(result.nutrients.kcal).toBe(542.5);
    expect(result.slotBreakdown).toHaveLength(3);
  });

  it("computes macro split percentages", () => {
    const result = aggregateComposition([makeProteinSlot(), makeBaseSlot(), makeVegSlot()]);
    // Total macros → protein cals + carb cals + fat cals
    expect(result.macroSplit.proteinPct).toBeGreaterThan(20);
    expect(result.macroSplit.carbPct).toBeGreaterThan(30);
    expect(result.macroSplit.proteinPct + result.macroSplit.carbPct + result.macroSplit.fatPct).toBeCloseTo(100, 0);
  });

  it("collects allergen tags from all slots", () => {
    const result = aggregateComposition([makeProteinSlot(), makeSauceSlot()]);
    expect(result.allergenTags).toContain("soy");
  });

  it("collects flavor profiles from all slots", () => {
    const result = aggregateComposition([makeProteinSlot(), makeSauceSlot()]);
    expect(result.flavorProfiles).toContain("SAVORY");
    expect(result.flavorProfiles).toContain("UMAMI");
    expect(result.flavorProfiles).toContain("SWEET");
  });

  it("deduplicates allergen and flavor tags", () => {
    const slot1 = makeSlot({ allergenTags: ["soy", "wheat"], flavorProfiles: ["SAVORY"] });
    const slot2 = makeSlot({ allergenTags: ["soy"], flavorProfiles: ["SAVORY", "SPICY"] });
    const result = aggregateComposition([slot1, slot2]);
    expect(result.allergenTags).toEqual(["soy", "wheat"]); // sorted, deduped
    expect(result.flavorProfiles).toEqual(["SAVORY", "SPICY"]); // sorted, deduped
  });

  it("warns on high calorie meal", () => {
    // 600g of chicken at 165 kcal/100g = 990 kcal
    const slot = makeSlot({ targetG: 600 });
    const result = aggregateComposition([slot]);
    expect(result.warnings).toContain("High calorie meal (>900 kcal)");
  });

  it("warns on low calorie meal", () => {
    const slot = makeSlot({ targetG: 20 }); // 20g chicken = 33 kcal
    const result = aggregateComposition([slot]);
    expect(result.warnings).toContain("Low calorie meal (<200 kcal)");
  });

  it("warns on high sodium", () => {
    // 50g of teriyaki sauce = 1915mg sodium
    const slot = makeSauceSlot();
    (slot as any).targetG = 50;
    const result = aggregateComposition([slot]);
    expect(result.warnings).toContain("High sodium (>1500mg)");
  });

  it("uses portionG over targetG when provided", () => {
    const slot = makeSlot({ targetG: 150, portionG: 100 });
    const result = aggregateComposition([slot]);
    expect(result.totalG).toBe(100);
    expect(result.nutrients.kcal).toBe(165); // 100g * 165/100
  });

  it("nutrient values are deterministic (rounded to 2 dp)", () => {
    const result = aggregateComposition([makeProteinSlot(), makeBaseSlot(), makeVegSlot(), makeSauceSlot()]);
    for (const key of Object.keys(result.nutrients) as (keyof typeof result.nutrients)[]) {
      const val = result.nutrients[key];
      const dp = (val.toString().split(".")[1] ?? "").length;
      expect(dp).toBeLessThanOrEqual(2);
    }
  });
});

// ── checkAllergenWarnings ──────────────────────────────

describe("checkAllergenWarnings", () => {
  it("returns safe when no exclusions", () => {
    const result = checkAllergenWarnings([makeSauceSlot()], []);
    expect(result.safe).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  it("detects allergen conflict", () => {
    const result = checkAllergenWarnings([makeSauceSlot()], ["soy"]);
    expect(result.safe).toBe(false);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.allergen).toBe("soy");
    expect(result.conflicts[0]!.componentName).toBe("Teriyaki Sauce");
  });

  it("is case-insensitive", () => {
    const result = checkAllergenWarnings([makeSauceSlot()], ["SOY"]);
    expect(result.safe).toBe(false);
  });

  it("safe when exclusion not present", () => {
    const result = checkAllergenWarnings([makeProteinSlot()], ["shellfish"]);
    expect(result.safe).toBe(true);
  });

  it("detects multiple conflicts across slots", () => {
    const slot1 = makeSlot({ allergenTags: ["soy"] });
    const slot2 = makeSlot({ allergenTags: ["dairy", "wheat"] });
    const result = checkAllergenWarnings([slot1, slot2], ["soy", "dairy"]);
    expect(result.conflicts).toHaveLength(2);
  });
});

// ── checkFlavorCompatibility ───────────────────────────

describe("checkFlavorCompatibility", () => {
  it("compatible with no conflicts", () => {
    const result = checkFlavorCompatibility([makeProteinSlot(), makeBaseSlot()]);
    expect(result.compatible).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns on SWEET + SPICY clash", () => {
    const slot1 = makeSlot({ flavorProfiles: ["SWEET"] });
    const slot2 = makeSlot({ flavorProfiles: ["SPICY"] });
    const result = checkFlavorCompatibility([slot1, slot2]);
    expect(result.compatible).toBe(false);
    expect(result.warnings.some((w) => w.includes("SWEET") && w.includes("SPICY"))).toBe(true);
  });

  it("warns on SWEET + UMAMI clash", () => {
    const result = checkFlavorCompatibility([makeSauceSlot()]); // has UMAMI + SWEET
    expect(result.compatible).toBe(false);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it("no warnings for savory + neutral", () => {
    const result = checkFlavorCompatibility([makeProteinSlot(), makeBaseSlot()]);
    expect(result.compatible).toBe(true);
  });
});

// ── saucePortionDelta ──────────────────────────────────

describe("saucePortionDelta", () => {
  it("computes portion deltas for 10g", () => {
    const nutrients = { kcal: 89, proteinG: 5.9, carbG: 15.6, fatG: 0 };
    const delta = saucePortionDelta(nutrients, 10);
    expect(delta.kcal).toBe(8.9);
    expect(delta.proteinG).toBe(0.59);
    expect(delta.carbG).toBe(1.56);
    expect(delta.fatG).toBe(0);
  });

  it("scales linearly with portion", () => {
    const nutrients = { kcal: 100, proteinG: 10, carbG: 20, fatG: 5 };
    const d5 = saucePortionDelta(nutrients, 5);
    const d15 = saucePortionDelta(nutrients, 15);
    expect(d15.kcal).toBeCloseTo(d5.kcal * 3, 1);
    expect(d15.proteinG).toBeCloseTo(d5.proteinG * 3, 1);
  });

  it("returns zeros for 0g portion", () => {
    const nutrients = { kcal: 100, proteinG: 10, carbG: 20, fatG: 5 };
    const delta = saucePortionDelta(nutrients, 0);
    expect(delta.kcal).toBe(0);
    expect(delta.proteinG).toBe(0);
  });
});
