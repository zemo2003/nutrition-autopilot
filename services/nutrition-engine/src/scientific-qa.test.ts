/**
 * Scientific QA Tests for Nutrition Engine
 *
 * These tests validate scientific rigor of the nutrient computation pipeline,
 * covering common failure modes in food science calculations:
 *   A. Raw vs Cooked Mismatches
 *   B. Yield Factor Mistakes
 *   C. Unit Conversion Mistakes
 *   D. Duplicate Ingredient/Component Counting
 *   E. Rounding Applied Too Early
 *   F. Calorie Aggregation Sanity (Atwater factors)
 *   G. Nutrient Hierarchy Invariants
 */

import { describe, it, expect } from "vitest";
import { computeSkuLabel, enforceNutrientHierarchy } from "./engine.js";
import {
  applyYieldCorrection,
  inferYieldFactor,
  YIELD_FACTORS,
  type PreparedState,
} from "./yield-factors.js";
import { roundCalories, roundGeneralG, roundFatLike } from "./rounding.js";
import type { NutrientMap, LabelComputationInput } from "./types.js";

// =============================================================================
// Helper: build a minimal LabelComputationInput
// =============================================================================
function buildInput(
  overrides: Partial<LabelComputationInput> & {
    lines: LabelComputationInput["lines"];
    consumedLots: LabelComputationInput["consumedLots"];
  }
): LabelComputationInput {
  return {
    skuName: overrides.skuName ?? "Test SKU",
    recipeName: overrides.recipeName ?? "Test Recipe",
    servings: overrides.servings ?? 1,
    lines: overrides.lines,
    consumedLots: overrides.consumedLots,
    ...(overrides.evidenceSummary ? { evidenceSummary: overrides.evidenceSummary } : {}),
  };
}

// =============================================================================
// A. RAW vs COOKED MISMATCHES
// =============================================================================

describe("Scientific QA - A: Raw vs Cooked Mismatches", () => {
  it("yield correction adjusts grams when recipe=COOKED, profile=RAW", () => {
    // 200g cooked chicken breast with raw nutrient data (165 kcal/100g raw)
    // Yield factor for chicken breast = 0.75
    // Raw equivalent = 200 / 0.75 = 266.67g
    // Expected kcal = 266.67 * (165/100) = 440 kcal total
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Chicken Breast",
            gramsPerServing: 200,
            ingredientAllergens: [],
            preparedState: "COOKED",
            // yieldFactor deliberately omitted so it auto-infers
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Chicken Breast",
            gramsConsumed: 200,
            nutrientProfileState: "RAW",
            nutrientsPer100g: {
              kcal: 165,
              protein_g: 31,
              fat_g: 3.6,
              carb_g: 0,
            },
          },
        ],
      })
    );

    // Without yield correction: 200 * 1.65 = 330 kcal
    // With yield correction (0.75): 200/0.75 * 1.65 = 440 kcal
    // The yield-corrected value should be notably higher than the naive value
    expect(result.perServing.kcal).toBeGreaterThan(400);
    expect(result.perServing.kcal).toBeLessThan(450);
  });

  it("yield correction adjusts grams when recipe=RAW, profile=COOKED", () => {
    // 200g raw chicken breast with cooked nutrient data (239 kcal/100g cooked)
    // Yield factor = 0.75
    // Cooked equivalent = 200 * 0.75 = 150g
    // Expected kcal = 150 * (239/100) = 358.5 kcal
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Chicken Breast",
            gramsPerServing: 200,
            ingredientAllergens: [],
            preparedState: "RAW",
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Chicken Breast",
            gramsConsumed: 200,
            nutrientProfileState: "COOKED",
            nutrientsPer100g: {
              kcal: 239,
              protein_g: 43,
              fat_g: 5.2,
              carb_g: 0,
            },
          },
        ],
      })
    );

    // Without yield correction: 200 * 2.39 = 478 kcal
    // With yield correction: 200 * 0.75 * 2.39 = 358.5 kcal
    expect(result.perServing.kcal).toBeGreaterThan(340);
    expect(result.perServing.kcal).toBeLessThan(380);
  });

  it("no correction when recipe and profile states match", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Chicken Breast",
            gramsPerServing: 200,
            ingredientAllergens: [],
            preparedState: "RAW",
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Chicken Breast",
            gramsConsumed: 200,
            nutrientProfileState: "RAW",
            nutrientsPer100g: {
              kcal: 165,
              protein_g: 31,
              fat_g: 3.6,
              carb_g: 0,
            },
          },
        ],
      })
    );

    // No correction: 200 * 1.65 = 330 kcal
    expect(result.perServing.kcal).toBe(330);
  });

  it("default states are both RAW, so no correction is applied", () => {
    // When no preparedState/nutrientProfileState specified, both default to RAW
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Chicken Breast",
            gramsPerServing: 100,
            ingredientAllergens: [],
            // no preparedState — defaults to RAW
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Chicken Breast",
            gramsConsumed: 100,
            // no nutrientProfileState — defaults to RAW
            nutrientsPer100g: { kcal: 165, protein_g: 31, fat_g: 3.6, carb_g: 0 },
          },
        ],
      })
    );

    expect(result.perServing.kcal).toBe(165);
  });

  it("explicit yield factor overrides auto-inferred yield factor", () => {
    // Set an explicit yield factor of 0.50 (much lower than chicken breast's 0.75)
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Chicken Breast",
            gramsPerServing: 100,
            ingredientAllergens: [],
            preparedState: "COOKED",
            yieldFactor: 0.50,
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Chicken Breast",
            gramsConsumed: 100,
            nutrientProfileState: "RAW",
            nutrientsPer100g: { kcal: 165, protein_g: 31, fat_g: 3.6, carb_g: 0 },
          },
        ],
      })
    );

    // With explicit yieldFactor=0.50: rawEquiv = 100/0.50 = 200g
    // kcal = 200 * 1.65 = 330
    expect(result.perServing.kcal).toBe(330);
  });
});

// =============================================================================
// B. YIELD FACTOR MISTAKES
// =============================================================================

describe("Scientific QA - B: Yield Factor Mistakes", () => {
  describe("inferYieldFactor returns correct values for known foods", () => {
    it("chicken breast -> 0.75", () => {
      const { factor, inferred } = inferYieldFactor("Chicken Breast");
      expect(factor).toBe(0.75);
      expect(inferred).toBe(true);
    });

    it("white rice -> 2.50 (absorbs water)", () => {
      const { factor } = inferYieldFactor("White Rice");
      expect(factor).toBe(2.50);
    });

    it("pasta / spaghetti -> 2.25", () => {
      expect(inferYieldFactor("Spaghetti").factor).toBe(2.25);
      expect(inferYieldFactor("Penne Pasta").factor).toBe(2.25);
    });

    it("broccoli -> 0.88", () => {
      expect(inferYieldFactor("Broccoli").factor).toBe(0.88);
    });

    it("salmon -> 0.80", () => {
      expect(inferYieldFactor("Salmon Fillet").factor).toBe(0.80);
    });

    it("ground beef 85% lean -> 0.68", () => {
      expect(inferYieldFactor("Ground Beef 85% Lean").factor).toBe(0.68);
    });
  });

  describe("extreme yield factors are documented in YIELD_FACTORS table", () => {
    it("no yield factor < 0.3 exists (would be >70% mass loss)", () => {
      for (const [key, value] of Object.entries(YIELD_FACTORS)) {
        expect(value, `${key} has an extreme low yield factor`).toBeGreaterThanOrEqual(0.3);
      }
    });

    it("grain/legume yield factors > 1 are reasonable (< 4.0)", () => {
      for (const [key, value] of Object.entries(YIELD_FACTORS)) {
        if (value > 1.0) {
          expect(value, `${key} has an unreasonably high yield factor`).toBeLessThan(4.0);
        }
      }
    });
  });

  describe("missing yield factors default safely", () => {
    it("unknown ingredient returns factor=1.0, inferred=false", () => {
      const { factor, inferred } = inferYieldFactor("Xylitol Powder");
      expect(factor).toBe(1.0);
      expect(inferred).toBe(false);
    });

    it("empty string returns factor=1.0", () => {
      const { factor, inferred } = inferYieldFactor("");
      expect(factor).toBe(1.0);
      expect(inferred).toBe(false);
    });
  });

  describe("applyYieldCorrection edge cases", () => {
    it("yieldFactor=1.0 returns original grams (no adjustment)", () => {
      const result = applyYieldCorrection(200, "COOKED", "RAW", 1.0);
      expect(result).toBe(200);
    });

    it("yieldFactor=0 returns original grams (guard against division by zero)", () => {
      const result = applyYieldCorrection(200, "COOKED", "RAW", 0);
      expect(result).toBe(200);
    });

    it("negative yieldFactor returns original grams", () => {
      const result = applyYieldCorrection(200, "COOKED", "RAW", -0.5);
      expect(result).toBe(200);
    });

    it("same state returns original grams regardless of yield factor", () => {
      const result = applyYieldCorrection(200, "RAW", "RAW", 0.75);
      expect(result).toBe(200);
    });

    it("DRY->COOKED multiplies by yield factor (grain hydration)", () => {
      // 100g dry rice, yield 2.5 -> 250g cooked equivalent
      const result = applyYieldCorrection(100, "DRY", "COOKED", 2.5);
      expect(result).toBe(250);
    });

    it("COOKED->DRY divides by yield factor", () => {
      // 250g cooked rice, yield 2.5 -> 100g dry equivalent
      const result = applyYieldCorrection(250, "COOKED", "DRY", 2.5);
      expect(result).toBe(100);
    });

    it("unsupported combination (FROZEN->CANNED) returns original grams", () => {
      const result = applyYieldCorrection(200, "FROZEN", "CANNED", 0.9);
      expect(result).toBe(200);
    });
  });
});

// =============================================================================
// C. UNIT CONVERSION MISTAKES
// =============================================================================

describe("Scientific QA - C: Unit Conversion & Precision", () => {
  it("all 40 nutrient keys are initialized in perServing output", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          { lineId: "1", ingredientName: "Test", gramsPerServing: 100, ingredientAllergens: [] },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Test",
            gramsConsumed: 100,
            nutrientsPer100g: { kcal: 100 },
          },
        ],
      })
    );

    expect(Object.keys(result.perServing).length).toBe(40);
  });

  it("valuePer100g of 0 means measured as zero (not unknown)", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          { lineId: "1", ingredientName: "Water", gramsPerServing: 100, ingredientAllergens: [] },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Water",
            gramsConsumed: 100,
            nutrientsPer100g: {
              kcal: 0,
              protein_g: 0,
              fat_g: 0,
              carb_g: 0,
              sodium_mg: 0,
            },
          },
        ],
      })
    );

    // Explicit zeros should remain zero
    expect(result.perServing.kcal).toBe(0);
    expect(result.perServing.protein_g).toBe(0);
    expect(result.perServing.fat_g).toBe(0);
    expect(result.perServing.carb_g).toBe(0);
    expect(result.perServing.sodium_mg).toBe(0);
  });

  it("missing nutrient keys (undefined) default to 0 in output", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          { lineId: "1", ingredientName: "Minimal", gramsPerServing: 100, ingredientAllergens: [] },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Minimal",
            gramsConsumed: 100,
            // Only kcal provided, everything else is undefined
            nutrientsPer100g: { kcal: 100 },
          },
        ],
      })
    );

    // Nutrients not supplied should default to 0
    expect(result.perServing.protein_g).toBe(0);
    expect(result.perServing.fat_g).toBe(0);
    expect(result.perServing.carb_g).toBe(0);
    expect(result.perServing.sodium_mg).toBe(0);
    expect(result.perServing.calcium_mg).toBe(0);
    expect(result.perServing.vitamin_d_mcg).toBe(0);
  });

  it("per100g scaling preserves precision for fractional values", () => {
    // 150g of something with 7.3g protein per 100g = 10.95g protein
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          { lineId: "1", ingredientName: "Test", gramsPerServing: 150, ingredientAllergens: [] },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Test",
            gramsConsumed: 150,
            nutrientsPer100g: { kcal: 100, protein_g: 7.3 },
          },
        ],
      })
    );

    // 150 * 7.3 / 100 = 10.95 exactly
    expect(result.perServing.protein_g).toBeCloseTo(10.95, 10);
  });

  it("multi-serving division preserves full precision in perServing", () => {
    // 300g total, 3 servings, 7.3g protein/100g
    // Total: 300 * 7.3 / 100 = 21.9g
    // Per serving: 21.9 / 3 = 7.3g
    const result = computeSkuLabel(
      buildInput({
        servings: 3,
        lines: [
          { lineId: "1", ingredientName: "Test", gramsPerServing: 100, ingredientAllergens: [] },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Test",
            gramsConsumed: 300,
            nutrientsPer100g: { kcal: 100, protein_g: 7.3 },
          },
        ],
      })
    );

    expect(result.perServing.protein_g).toBeCloseTo(7.3, 10);
  });
});

// =============================================================================
// D. DUPLICATE INGREDIENT / COMPONENT COUNTING
// =============================================================================

describe("Scientific QA - D: Duplicate Ingredient/Component Counting", () => {
  it("same ingredient appearing twice contributes additively", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          { lineId: "1", ingredientName: "Chicken Breast", gramsPerServing: 100, ingredientAllergens: [] },
          { lineId: "2", ingredientName: "Chicken Thigh", gramsPerServing: 50, ingredientAllergens: [] },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Chicken Breast",
            gramsConsumed: 100,
            nutrientsPer100g: { kcal: 165, protein_g: 31, fat_g: 3.6, carb_g: 0 },
          },
          {
            recipeLineId: "2",
            lotId: "lot2",
            productId: "prod2",
            productName: "Chicken Thigh",
            gramsConsumed: 50,
            nutrientsPer100g: { kcal: 209, protein_g: 26, fat_g: 10.9, carb_g: 0 },
          },
        ],
      })
    );

    // Breast: 100 * 1.65 = 165 kcal, 100 * 0.31 = 31g protein
    // Thigh:  50 * 2.09 = 104.5 kcal, 50 * 0.26 = 13g protein
    expect(result.perServing.kcal).toBeCloseTo(269.5, 5);
    expect(result.perServing.protein_g).toBeCloseTo(44, 5);
    expect(result.servingWeightG).toBe(150);
  });

  it("multiple lots for the same recipe line sum correctly", () => {
    // Two lots of chicken supplying the same line (e.g., different batches)
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          { lineId: "1", ingredientName: "Chicken", gramsPerServing: 200, ingredientAllergens: [] },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot-a",
            productId: "prod1",
            productName: "Chicken Batch A",
            gramsConsumed: 120,
            nutrientsPer100g: { kcal: 165, protein_g: 31 },
          },
          {
            recipeLineId: "1",
            lotId: "lot-b",
            productId: "prod1",
            productName: "Chicken Batch B",
            gramsConsumed: 80,
            nutrientsPer100g: { kcal: 170, protein_g: 30 },
          },
        ],
      })
    );

    // Lot A: 120 * 1.65 = 198 kcal, 120 * 0.31 = 37.2g protein
    // Lot B: 80 * 1.70 = 136 kcal, 80 * 0.30 = 24g protein
    expect(result.perServing.kcal).toBeCloseTo(334, 5);
    expect(result.perServing.protein_g).toBeCloseTo(61.2, 5);
    expect(result.servingWeightG).toBe(200);
  });

  it("lots from different recipe lines aggregate independently", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          { lineId: "1", ingredientName: "Chicken", gramsPerServing: 100, ingredientAllergens: [] },
          { lineId: "2", ingredientName: "Rice", gramsPerServing: 100, ingredientAllergens: [] },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Chicken",
            gramsConsumed: 100,
            nutrientsPer100g: { kcal: 165, protein_g: 31 },
          },
          {
            recipeLineId: "2",
            lotId: "lot2",
            productId: "prod2",
            productName: "Rice",
            gramsConsumed: 100,
            nutrientsPer100g: { kcal: 130, carb_g: 28 },
          },
        ],
      })
    );

    // Total: 165 + 130 = 295 kcal, 31 + 0 = 31g protein, 0 + 28 = 28g carb
    expect(result.perServing.kcal).toBe(295);
    expect(result.perServing.protein_g).toBe(31);
    expect(result.perServing.carb_g).toBe(28);
  });

  it("ingredient breakdown shows per-line nutrient highlights (no double counting)", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          { lineId: "1", ingredientName: "Chicken", gramsPerServing: 100, ingredientAllergens: [] },
          { lineId: "2", ingredientName: "Rice", gramsPerServing: 100, ingredientAllergens: [] },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Chicken",
            gramsConsumed: 100,
            nutrientsPer100g: { kcal: 165, protein_g: 31 },
          },
          {
            recipeLineId: "2",
            lotId: "lot2",
            productId: "prod2",
            productName: "Rice",
            gramsConsumed: 100,
            nutrientsPer100g: { kcal: 130, carb_g: 28 },
          },
        ],
      })
    );

    const chicken = result.ingredientBreakdown.find((i) => i.ingredientName === "Chicken");
    const rice = result.ingredientBreakdown.find((i) => i.ingredientName === "Rice");

    expect(chicken?.nutrientHighlights.protein_g).toBe(31);
    expect(chicken?.nutrientHighlights.carb_g).toBe(0);
    expect(rice?.nutrientHighlights.carb_g).toBe(28);
    expect(rice?.nutrientHighlights.protein_g).toBe(0);

    // Sum of breakdown kcal should equal total perServing kcal
    const breakdownKcalSum = result.ingredientBreakdown.reduce(
      (sum, item) => sum + item.nutrientHighlights.kcal,
      0
    );
    expect(breakdownKcalSum).toBeCloseTo(result.perServing.kcal!, 5);
  });
});

// =============================================================================
// E. ROUNDING APPLIED TOO EARLY
// =============================================================================

describe("Scientific QA - E: Rounding Applied Too Early", () => {
  it("perServing values are full precision (not rounded)", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          { lineId: "1", ingredientName: "Test", gramsPerServing: 73, ingredientAllergens: [] },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Test",
            gramsConsumed: 73,
            nutrientsPer100g: { kcal: 137, protein_g: 11.3, fat_g: 4.7, sodium_mg: 347 },
          },
        ],
      })
    );

    // 73 * 137/100 = 100.01, 73 * 11.3/100 = 8.249, 73 * 4.7/100 = 3.431
    // These should NOT be rounded to FDA increments
    expect(result.perServing.kcal).toBeCloseTo(100.01, 5);
    expect(result.perServing.protein_g).toBeCloseTo(8.249, 5);
    expect(result.perServing.fat_g).toBeCloseTo(3.431, 5);

    // But roundedFda should apply FDA rounding
    expect(result.roundedFda.calories).toBe(roundCalories(100.01));
    expect(result.roundedFda.proteinG).toBe(roundGeneralG(8.249));
    expect(result.roundedFda.fatG).toBe(roundFatLike(3.431));
  });

  it("sum of rounded values may differ from rounded sum (engine uses correct approach)", () => {
    // Two lots: 2.3g fat + 2.3g fat = 4.6g total fat
    // Rounded individually: roundFatLike(2.3) = 2.5, roundFatLike(2.3) = 2.5 => sum = 5.0
    // Rounded from sum: roundFatLike(4.6) = 4.5
    // The engine should aggregate first, then round (correct approach)
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          { lineId: "1", ingredientName: "A", gramsPerServing: 100, ingredientAllergens: [] },
          { lineId: "2", ingredientName: "B", gramsPerServing: 100, ingredientAllergens: [] },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "A",
            gramsConsumed: 100,
            nutrientsPer100g: { kcal: 50, fat_g: 2.3 },
          },
          {
            recipeLineId: "2",
            lotId: "lot2",
            productId: "prod2",
            productName: "B",
            gramsConsumed: 100,
            nutrientsPer100g: { kcal: 50, fat_g: 2.3 },
          },
        ],
      })
    );

    // Engine should sum first (4.6g), then round
    expect(result.perServing.fat_g).toBeCloseTo(4.6, 5);
    expect(result.roundedFda.fatG).toBe(roundFatLike(4.6)); // 4.5
    // NOT roundFatLike(2.3) + roundFatLike(2.3) = 5.0
    expect(result.roundedFda.fatG).not.toBe(5.0);
  });

  it("rounding only affects roundedFda, not perServing or qa", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          { lineId: "1", ingredientName: "Test", gramsPerServing: 100, ingredientAllergens: [] },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Test",
            gramsConsumed: 100,
            nutrientsPer100g: { kcal: 53, protein_g: 7.3, fat_g: 1.7, carb_g: 2.1 },
          },
        ],
      })
    );

    // perServing should have exact values
    expect(result.perServing.kcal).toBe(53);
    expect(result.perServing.protein_g).toBe(7.3);

    // qa.rawCalories should use unrounded value
    expect(result.qa.rawCalories).toBe(53);

    // roundedFda should differ from perServing for most values
    expect(result.roundedFda.calories).toBe(50); // roundCalories(53) = 50 (>50: round to nearest 10)
  });

  it("multi-lot aggregation maintains precision before final rounding", () => {
    // Three lots that each contribute 0.3g sodium (total 0.9g = 900mg would be wrong)
    // Actually let's use protein: 3 lots of 0.4g protein each = 1.2g total
    // roundGeneralG(0.4) = 0 (each), but roundGeneralG(1.2) = 1
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          { lineId: "1", ingredientName: "A", gramsPerServing: 50, ingredientAllergens: [] },
          { lineId: "2", ingredientName: "B", gramsPerServing: 50, ingredientAllergens: [] },
          { lineId: "3", ingredientName: "C", gramsPerServing: 50, ingredientAllergens: [] },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "p1",
            productName: "A",
            gramsConsumed: 50,
            nutrientsPer100g: { kcal: 10, protein_g: 0.8 },
          },
          {
            recipeLineId: "2",
            lotId: "lot2",
            productId: "p2",
            productName: "B",
            gramsConsumed: 50,
            nutrientsPer100g: { kcal: 10, protein_g: 0.8 },
          },
          {
            recipeLineId: "3",
            lotId: "lot3",
            productId: "p3",
            productName: "C",
            gramsConsumed: 50,
            nutrientsPer100g: { kcal: 10, protein_g: 0.8 },
          },
        ],
      })
    );

    // Each contributes 50 * 0.8 / 100 = 0.4g protein
    // Total = 1.2g protein
    expect(result.perServing.protein_g).toBeCloseTo(1.2, 5);
    // Rounded from aggregated: roundGeneralG(1.2) = 1
    expect(result.roundedFda.proteinG).toBe(1);
    // NOT: 3 * roundGeneralG(0.4) = 3 * 0 = 0
  });
});

// =============================================================================
// F. CALORIE AGGREGATION SANITY (ATWATER FACTORS)
// =============================================================================

describe("Scientific QA - F: Calorie Aggregation Sanity", () => {
  it("Atwater factors: protein*4 + carbs*4 + fat*9 approximates kcal within 10%", () => {
    // Realistic chicken and rice bowl
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          { lineId: "1", ingredientName: "Chicken", gramsPerServing: 150, ingredientAllergens: [] },
          { lineId: "2", ingredientName: "Rice", gramsPerServing: 200, ingredientAllergens: [] },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Chicken Breast",
            gramsConsumed: 150,
            nutrientsPer100g: { kcal: 165, protein_g: 31, fat_g: 3.6, carb_g: 0 },
          },
          {
            recipeLineId: "2",
            lotId: "lot2",
            productId: "prod2",
            productName: "White Rice",
            gramsConsumed: 200,
            nutrientsPer100g: { kcal: 130, protein_g: 2.7, fat_g: 0.3, carb_g: 28 },
          },
        ],
      })
    );

    const protein = result.perServing.protein_g ?? 0;
    const carbs = result.perServing.carb_g ?? 0;
    const fat = result.perServing.fat_g ?? 0;
    const rawKcal = result.perServing.kcal ?? 0;

    const atwaterKcal = protein * 4 + carbs * 4 + fat * 9;
    const percentDiff = Math.abs(atwaterKcal - rawKcal) / rawKcal;

    expect(percentDiff).toBeLessThan(0.10); // Within 10%
  });

  it("very low calorie foods (< 5 kcal) round to 0 per FDA rules", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          { lineId: "1", ingredientName: "Lettuce", gramsPerServing: 30, ingredientAllergens: [] },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Iceberg Lettuce",
            gramsConsumed: 30,
            nutrientsPer100g: { kcal: 14, protein_g: 0.9, fat_g: 0.1, carb_g: 2.9 },
          },
        ],
      })
    );

    // 30 * 14/100 = 4.2 kcal, which is < 5
    expect(result.perServing.kcal).toBeCloseTo(4.2, 5);
    expect(result.roundedFda.calories).toBe(0);
  });

  it("high-fat foods have most calories from fat", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          { lineId: "1", ingredientName: "Olive Oil", gramsPerServing: 14, ingredientAllergens: [] },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Olive Oil",
            gramsConsumed: 14,
            nutrientsPer100g: { kcal: 884, protein_g: 0, fat_g: 100, carb_g: 0 },
          },
        ],
      })
    );

    const fat = result.perServing.fat_g ?? 0;
    const rawKcal = result.perServing.kcal ?? 0;
    const fatCalories = fat * 9;

    // Fat should account for >90% of calories in pure oil
    expect(fatCalories / rawKcal).toBeGreaterThan(0.9);
  });

  it("QA check passes for well-formed data", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          { lineId: "1", ingredientName: "Test", gramsPerServing: 100, ingredientAllergens: [] },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Balanced Food",
            gramsConsumed: 100,
            nutrientsPer100g: { kcal: 200, protein_g: 15, fat_g: 10, carb_g: 15 },
          },
        ],
      })
    );

    // Atwater: 15*4 + 15*4 + 10*9 = 60 + 60 + 90 = 210
    // Reported: 200, error = 10/200 = 5%
    expect(result.qa.pass).toBe(true);
    expect(result.qa.percentError).toBeLessThan(0.10);
  });

  it("QA check fails for data with major calorie inconsistency", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          { lineId: "1", ingredientName: "Test", gramsPerServing: 100, ingredientAllergens: [] },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Suspicious Food",
            gramsConsumed: 100,
            nutrientsPer100g: {
              kcal: 50,        // Claimed
              protein_g: 20,    // 80 kcal
              fat_g: 10,        // 90 kcal
              carb_g: 10,       // 40 kcal
              // Atwater = 210, but claimed 50 -> 320% error
            },
          },
        ],
      })
    );

    expect(result.qa.pass).toBe(false);
    expect(result.qa.percentError).toBeGreaterThan(0.20);
  });
});

// =============================================================================
// G. NUTRIENT HIERARCHY INVARIANTS
// =============================================================================

describe("Scientific QA - G: Nutrient Hierarchy Invariants (enforceNutrientHierarchy)", () => {
  it("total_fat >= saturated_fat + trans_fat: corrects when violated", () => {
    const map: NutrientMap = {
      fat_g: 5,
      sat_fat_g: 4,
      trans_fat_g: 3,
      // sat + trans = 7 > 5
    };

    enforceNutrientHierarchy(map);

    // fat_g should be raised to at least 7
    expect(map.fat_g).toBeGreaterThanOrEqual(7);
  });

  it("total_fat stays unchanged when hierarchy is valid", () => {
    const map: NutrientMap = {
      fat_g: 15,
      sat_fat_g: 5,
      trans_fat_g: 1,
    };

    enforceNutrientHierarchy(map);
    expect(map.fat_g).toBe(15);
  });

  it("total_carb >= dietary_fiber + total_sugars: corrects when violated", () => {
    const map: NutrientMap = {
      carb_g: 10,
      fiber_g: 7,
      sugars_g: 8,
      // fiber + sugars = 15 > 10
    };

    enforceNutrientHierarchy(map);
    expect(map.carb_g).toBeGreaterThanOrEqual(15);
  });

  it("total_carb >= sugars alone", () => {
    const map: NutrientMap = {
      carb_g: 5,
      sugars_g: 12,
    };

    enforceNutrientHierarchy(map);
    expect(map.carb_g).toBeGreaterThanOrEqual(12);
  });

  it("total_carb >= fiber alone", () => {
    const map: NutrientMap = {
      carb_g: 3,
      fiber_g: 8,
    };

    enforceNutrientHierarchy(map);
    expect(map.carb_g).toBeGreaterThanOrEqual(8);
  });

  it("total_sugars >= added_sugars: corrects when violated", () => {
    const map: NutrientMap = {
      sugars_g: 5,
      added_sugars_g: 10,
    };

    enforceNutrientHierarchy(map);
    // added_sugars should be capped at sugars
    expect(map.added_sugars_g).toBeLessThanOrEqual(map.sugars_g ?? 0);
  });

  it("kcal corrected when implausibly low vs Atwater estimate", () => {
    const map: NutrientMap = {
      kcal: 10,      // Implausibly low
      protein_g: 20, // 80 kcal
      carb_g: 20,    // 80 kcal
      fat_g: 10,     // 90 kcal
      // Atwater = 250, 50% = 125. kcal=10 < 125 => correct
    };

    enforceNutrientHierarchy(map);
    // kcal should be corrected to approximately Atwater value
    expect(map.kcal).toBeGreaterThanOrEqual(125);
  });

  it("kcal stays unchanged when above 50% of Atwater estimate", () => {
    const map: NutrientMap = {
      kcal: 200,
      protein_g: 20,
      carb_g: 20,
      fat_g: 10,
      // Atwater = 250, 50% = 125. kcal=200 >= 125
    };

    enforceNutrientHierarchy(map);
    expect(map.kcal).toBe(200);
  });

  it("hierarchy enforcement with all-zero values is a no-op", () => {
    const map: NutrientMap = {
      kcal: 0,
      protein_g: 0,
      carb_g: 0,
      fat_g: 0,
      fiber_g: 0,
      sugars_g: 0,
      added_sugars_g: 0,
      sat_fat_g: 0,
      trans_fat_g: 0,
    };

    enforceNutrientHierarchy(map);

    expect(map.kcal).toBe(0);
    expect(map.carb_g).toBe(0);
    expect(map.fat_g).toBe(0);
  });

  it("hierarchy enforcement with undefined values treats them as 0", () => {
    const map: NutrientMap = {
      // carb_g not set (undefined)
      sugars_g: 5,
      fiber_g: 3,
    };

    enforceNutrientHierarchy(map);
    // undefined carb should be raised to at least sugars + fiber = 8
    expect(map.carb_g).toBeGreaterThanOrEqual(8);
  });

  it("combined hierarchy: carb, fat, and sugars all corrected in one call", () => {
    const map: NutrientMap = {
      kcal: 300,
      protein_g: 10,
      carb_g: 5,
      fat_g: 3,
      fiber_g: 4,
      sugars_g: 8,
      added_sugars_g: 12,
      sat_fat_g: 4,
      trans_fat_g: 2,
    };

    enforceNutrientHierarchy(map);

    // carb_g >= max(sugars_g=8, fiber_g=4, sugars_g+fiber_g=12) = 12
    expect(map.carb_g).toBeGreaterThanOrEqual(12);
    // fat_g >= sat_fat_g + trans_fat_g = 4 + 2 = 6
    expect(map.fat_g).toBeGreaterThanOrEqual(6);
    // added_sugars_g <= sugars_g = 8
    expect(map.added_sugars_g).toBeLessThanOrEqual(8);
  });
});

// =============================================================================
// INTEGRATION: End-to-end label correctness
// =============================================================================

describe("Scientific QA - Integration: End-to-end label correctness", () => {
  it("realistic chicken+rice+broccoli bowl produces plausible label", () => {
    const result = computeSkuLabel(
      buildInput({
        skuName: "Chicken Rice Bowl",
        recipeName: "Chicken Rice Bowl",
        servings: 1,
        lines: [
          { lineId: "1", ingredientName: "Chicken Breast", gramsPerServing: 150, ingredientAllergens: [] },
          { lineId: "2", ingredientName: "White Rice", gramsPerServing: 200, ingredientAllergens: [] },
          { lineId: "3", ingredientName: "Broccoli", gramsPerServing: 80, ingredientAllergens: [] },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Chicken Breast",
            gramsConsumed: 150,
            nutrientsPer100g: {
              kcal: 165, protein_g: 31, fat_g: 3.6, carb_g: 0,
              sat_fat_g: 1.0, sodium_mg: 74, cholesterol_mg: 85,
              iron_mg: 1.0, potassium_mg: 256, vitamin_b6_mg: 0.5,
            },
          },
          {
            recipeLineId: "2",
            lotId: "lot2",
            productId: "prod2",
            productName: "White Rice",
            gramsConsumed: 200,
            nutrientsPer100g: {
              kcal: 130, protein_g: 2.7, fat_g: 0.3, carb_g: 28,
              fiber_g: 0.4, sodium_mg: 1, iron_mg: 1.2,
            },
          },
          {
            recipeLineId: "3",
            lotId: "lot3",
            productId: "prod3",
            productName: "Broccoli",
            gramsConsumed: 80,
            nutrientsPer100g: {
              kcal: 34, protein_g: 2.8, fat_g: 0.4, carb_g: 7,
              fiber_g: 2.6, vitamin_c_mg: 89, calcium_mg: 47, potassium_mg: 316,
            },
          },
        ],
      })
    );

    // Calorie sanity: ~500 kcal for a chicken rice bowl is reasonable
    expect(result.perServing.kcal).toBeGreaterThan(400);
    expect(result.perServing.kcal).toBeLessThan(600);

    // Protein should be dominated by chicken
    expect(result.perServing.protein_g).toBeGreaterThan(45);

    // Carbs should be dominated by rice
    expect(result.perServing.carb_g).toBeGreaterThan(50);

    // Vitamin C should come primarily from broccoli
    expect(result.perServing.vitamin_c_mg).toBeGreaterThan(50);

    // Serving weight = 430g
    expect(result.servingWeightG).toBe(430);

    // QA check should pass
    expect(result.qa.pass).toBe(true);

    // Ingredient declaration should list by weight descending
    expect(result.ingredientDeclaration).toMatch(/White Rice.*Chicken.*Broccoli/);

    // Allergen statement for plain chicken/rice/broccoli
    expect(result.allergenStatement).toContain("None of the 9 major allergens");

    // Rounded values should be present and reasonable
    expect(result.roundedFda.calories).toBeGreaterThan(0);
    expect(result.roundedFda.proteinG).toBeGreaterThan(0);
    expect(result.roundedFda.carbG).toBeGreaterThan(0);
  });

  it("yield-corrected label has different kcal than naive calculation", () => {
    // Same food, same grams, but one with yield correction, one without
    const withCorrection = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Chicken Breast",
            gramsPerServing: 200,
            ingredientAllergens: [],
            preparedState: "COOKED",
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Chicken Breast",
            gramsConsumed: 200,
            nutrientProfileState: "RAW",
            nutrientsPer100g: { kcal: 165, protein_g: 31, fat_g: 3.6, carb_g: 0 },
          },
        ],
      })
    );

    const withoutCorrection = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Chicken Breast",
            gramsPerServing: 200,
            ingredientAllergens: [],
            preparedState: "RAW",
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Chicken Breast",
            gramsConsumed: 200,
            nutrientProfileState: "RAW",
            nutrientsPer100g: { kcal: 165, protein_g: 31, fat_g: 3.6, carb_g: 0 },
          },
        ],
      })
    );

    // The yield-corrected version should have ~33% more calories
    // (200/0.75 vs 200 raw grams)
    const correctedKcal = withCorrection.perServing.kcal ?? 0;
    const naiveKcal = withoutCorrection.perServing.kcal ?? 0;

    expect(correctedKcal).toBeGreaterThan(naiveKcal * 1.2);
    expect(correctedKcal).toBeLessThan(naiveKcal * 1.5);
  });
});
