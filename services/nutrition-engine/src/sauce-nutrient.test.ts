/**
 * Sauce Nutrient Computation Tests
 *
 * Validates that sauce-related nutrient computations behave correctly,
 * covering:
 *   A. Sauce Portion Scaling
 *   B. Sauce Variant Substitution Effects
 *   C. Rounding Edge Cases with Sauces
 *   D. Calorie Sanity with Sauce as Primary Fat Source
 *   E. Allergen Detection with Sauces
 *   F. Integration: Full Meal with Sauce
 */

import { describe, it, expect } from "vitest";
import { computeSkuLabel } from "./engine.js";
import { roundFatLike } from "./rounding.js";
import type { LabelComputationInput } from "./types.js";

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
    ...(overrides.evidenceSummary
      ? { evidenceSummary: overrides.evidenceSummary }
      : {}),
  };
}

// =============================================================================
// A. SAUCE PORTION SCALING
// =============================================================================

describe("Sauce Nutrients - A: Sauce Portion Scaling", () => {
  it("15g sauce at 400 kcal/100g contributes exactly 60 kcal", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Rich Sauce",
            gramsPerServing: 15,
            ingredientAllergens: [],
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Rich Sauce",
            gramsConsumed: 15,
            nutrientsPer100g: {
              kcal: 400,
              protein_g: 2,
              fat_g: 40,
              carb_g: 10,
            },
          },
        ],
      })
    );

    // 15 * 400 / 100 = 60 kcal
    expect(result.perServing.kcal).toBeCloseTo(60, 1);
  });

  it("30g sauce portion doubles nutrient contribution vs 15g", () => {
    const nutrientsPer100g = {
      kcal: 400,
      protein_g: 2,
      fat_g: 40,
      carb_g: 10,
    };

    const result15g = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Sauce",
            gramsPerServing: 15,
            ingredientAllergens: [],
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Sauce",
            gramsConsumed: 15,
            nutrientsPer100g,
          },
        ],
      })
    );

    const result30g = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Sauce",
            gramsPerServing: 30,
            ingredientAllergens: [],
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Sauce",
            gramsConsumed: 30,
            nutrientsPer100g,
          },
        ],
      })
    );

    expect(result30g.perServing.kcal).toBeCloseTo(
      (result15g.perServing.kcal ?? 0) * 2,
      1
    );
    expect(result30g.perServing.fat_g).toBeCloseTo(
      (result15g.perServing.fat_g ?? 0) * 2,
      1
    );
    expect(result30g.perServing.protein_g).toBeCloseTo(
      (result15g.perServing.protein_g ?? 0) * 2,
      1
    );
    expect(result30g.perServing.carb_g).toBeCloseTo(
      (result15g.perServing.carb_g ?? 0) * 2,
      1
    );
  });

  it("zero-gram sauce portion contributes zero nutrients", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Sauce",
            gramsPerServing: 0,
            ingredientAllergens: [],
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Sauce",
            gramsConsumed: 0,
            nutrientsPer100g: {
              kcal: 500,
              fat_g: 55,
              protein_g: 1,
              carb_g: 5,
            },
          },
        ],
      })
    );

    expect(result.perServing.kcal).toBe(0);
    expect(result.perServing.fat_g).toBe(0);
    expect(result.perServing.protein_g).toBe(0);
    expect(result.perServing.carb_g).toBe(0);
  });

  it("fractional gram portions (7.5g) maintain precision", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Hot Sauce",
            gramsPerServing: 7.5,
            ingredientAllergens: [],
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Hot Sauce",
            gramsConsumed: 7.5,
            nutrientsPer100g: {
              kcal: 200,
              protein_g: 1.6,
              fat_g: 8.4,
              carb_g: 30,
            },
          },
        ],
      })
    );

    // 7.5 * 200 / 100 = 15
    expect(result.perServing.kcal).toBeCloseTo(15, 5);
    // 7.5 * 1.6 / 100 = 0.12
    expect(result.perServing.protein_g).toBeCloseTo(0.12, 5);
    // 7.5 * 8.4 / 100 = 0.63
    expect(result.perServing.fat_g).toBeCloseTo(0.63, 5);
    // 7.5 * 30 / 100 = 2.25
    expect(result.perServing.carb_g).toBeCloseTo(2.25, 5);
  });

  it("high-fat sauce (olive oil dressing, ~90g fat/100g) correctly dominates fat contribution", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Chicken Breast",
            gramsPerServing: 150,
            ingredientAllergens: [],
          },
          {
            lineId: "2",
            ingredientName: "Olive Oil Dressing",
            gramsPerServing: 30,
            ingredientAllergens: [],
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Chicken Breast",
            gramsConsumed: 150,
            nutrientsPer100g: {
              kcal: 165,
              protein_g: 31,
              fat_g: 3.6,
              carb_g: 0,
            },
          },
          {
            recipeLineId: "2",
            lotId: "lot2",
            productId: "prod2",
            productName: "Olive Oil Dressing",
            gramsConsumed: 30,
            nutrientsPer100g: {
              kcal: 810,
              protein_g: 0,
              fat_g: 90,
              carb_g: 0,
            },
          },
        ],
      })
    );

    // Chicken fat: 150 * 3.6 / 100 = 5.4g
    // Dressing fat: 30 * 90 / 100 = 27g
    // Total fat = 32.4g, dressing contributes 27/32.4 = ~83%
    const chickenFat = 150 * 3.6 / 100;
    const dressingFat = 30 * 90 / 100;
    const totalFat = result.perServing.fat_g ?? 0;

    expect(totalFat).toBeCloseTo(chickenFat + dressingFat, 1);
    // Dressing should contribute >75% of total fat
    expect(dressingFat / totalFat).toBeGreaterThan(0.75);
  });

  it("multiple sauces on same meal aggregate correctly", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Base Protein",
            gramsPerServing: 100,
            ingredientAllergens: [],
          },
          {
            lineId: "2",
            ingredientName: "Soy Sauce",
            gramsPerServing: 10,
            ingredientAllergens: ["soy"],
          },
          {
            lineId: "3",
            ingredientName: "Sesame Dressing",
            gramsPerServing: 20,
            ingredientAllergens: ["sesame"],
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Tofu",
            gramsConsumed: 100,
            nutrientsPer100g: {
              kcal: 76,
              protein_g: 8,
              fat_g: 4.8,
              carb_g: 1.9,
            },
          },
          {
            recipeLineId: "2",
            lotId: "lot2",
            productId: "prod2",
            productName: "Soy Sauce",
            gramsConsumed: 10,
            nutrientsPer100g: {
              kcal: 53,
              protein_g: 8.1,
              fat_g: 0,
              carb_g: 4.9,
              sodium_mg: 5493,
            },
          },
          {
            recipeLineId: "3",
            lotId: "lot3",
            productId: "prod3",
            productName: "Sesame Dressing",
            gramsConsumed: 20,
            nutrientsPer100g: {
              kcal: 450,
              protein_g: 2,
              fat_g: 45,
              carb_g: 10,
            },
          },
        ],
      })
    );

    // Tofu kcal: 100 * 76/100 = 76
    // Soy sauce kcal: 10 * 53/100 = 5.3
    // Sesame dressing kcal: 20 * 450/100 = 90
    // Total: 171.3
    expect(result.perServing.kcal).toBeCloseTo(171.3, 1);

    // Fat aggregation: tofu 4.8 + soy 0 + sesame 9 = 13.8
    expect(result.perServing.fat_g).toBeCloseTo(13.8, 1);

    // Sodium from soy sauce: 10 * 5493/100 = 549.3
    expect(result.perServing.sodium_mg).toBeCloseTo(549.3, 1);
  });
});

// =============================================================================
// B. SAUCE VARIANT SUBSTITUTION EFFECTS
// =============================================================================

describe("Sauce Nutrients - B: Sauce Variant Substitution Effects", () => {
  const baseMealLines: LabelComputationInput["lines"] = [
    {
      lineId: "1",
      ingredientName: "Grilled Chicken",
      gramsPerServing: 150,
      ingredientAllergens: [],
    },
    {
      lineId: "2",
      ingredientName: "Sauce",
      gramsPerServing: 30,
      ingredientAllergens: [],
    },
  ];

  const chickenLot = {
    recipeLineId: "1",
    lotId: "lot1",
    productId: "prod1",
    productName: "Grilled Chicken",
    gramsConsumed: 150,
    nutrientsPer100g: {
      kcal: 165,
      protein_g: 31,
      fat_g: 3.6,
      carb_g: 0,
    },
  };

  it("standard vs low-fat sauce: low-fat variant has less total fat", () => {
    const standardSauce = {
      recipeLineId: "2",
      lotId: "lot2",
      productId: "prod2",
      productName: "Standard Ranch",
      gramsConsumed: 30,
      nutrientsPer100g: {
        kcal: 300,
        protein_g: 1,
        fat_g: 15,
        carb_g: 5,
      },
    };

    const lowFatSauce = {
      recipeLineId: "2",
      lotId: "lot2",
      productId: "prod2",
      productName: "Low Fat Ranch",
      gramsConsumed: 30,
      nutrientsPer100g: {
        kcal: 120,
        protein_g: 1,
        fat_g: 5,
        carb_g: 5,
      },
    };

    const resultStandard = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: baseMealLines,
        consumedLots: [chickenLot, standardSauce],
      })
    );

    const resultLowFat = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: baseMealLines,
        consumedLots: [chickenLot, lowFatSauce],
      })
    );

    // Standard sauce fat: 30 * 15/100 = 4.5g
    // Low-fat sauce fat: 30 * 5/100 = 1.5g
    // Difference should be exactly 3g
    const fatDiff =
      (resultStandard.perServing.fat_g ?? 0) -
      (resultLowFat.perServing.fat_g ?? 0);
    expect(fatDiff).toBeCloseTo(3, 1);
  });

  it("high-fat variant (25g fat/100g) increases total meal fat correctly", () => {
    const highFatSauce = {
      recipeLineId: "2",
      lotId: "lot2",
      productId: "prod2",
      productName: "High Fat Sauce",
      gramsConsumed: 30,
      nutrientsPer100g: {
        kcal: 350,
        protein_g: 1,
        fat_g: 25,
        carb_g: 5,
      },
    };

    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: baseMealLines,
        consumedLots: [chickenLot, highFatSauce],
      })
    );

    // Chicken fat: 150 * 3.6/100 = 5.4g
    // High-fat sauce: 30 * 25/100 = 7.5g
    // Total: 12.9g
    expect(result.perServing.fat_g).toBeCloseTo(12.9, 1);
  });

  it("protein content changes between variants reflected in total", () => {
    const lowProteinSauce = {
      recipeLineId: "2",
      lotId: "lot2",
      productId: "prod2",
      productName: "Low Protein Sauce",
      gramsConsumed: 30,
      nutrientsPer100g: {
        kcal: 200,
        protein_g: 1,
        fat_g: 10,
        carb_g: 20,
      },
    };

    const highProteinSauce = {
      recipeLineId: "2",
      lotId: "lot2",
      productId: "prod2",
      productName: "High Protein Sauce",
      gramsConsumed: 30,
      nutrientsPer100g: {
        kcal: 200,
        protein_g: 12,
        fat_g: 10,
        carb_g: 10,
      },
    };

    const resultLow = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: baseMealLines,
        consumedLots: [chickenLot, lowProteinSauce],
      })
    );

    const resultHigh = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: baseMealLines,
        consumedLots: [chickenLot, highProteinSauce],
      })
    );

    // Protein difference: 30 * (12 - 1) / 100 = 3.3g
    const proteinDiff =
      (resultHigh.perServing.protein_g ?? 0) -
      (resultLow.perServing.protein_g ?? 0);
    expect(proteinDiff).toBeCloseTo(3.3, 1);
  });

  it("calorie difference between variants equals (fat_diff * 9 + carb_diff * 4 + protein_diff * 4) per gram", () => {
    // Variant A: 10g fat, 20g carb, 5g protein per 100g
    // Variant B: 25g fat, 10g carb, 8g protein per 100g
    const variantA = {
      recipeLineId: "2",
      lotId: "lot2",
      productId: "prod2",
      productName: "Variant A",
      gramsConsumed: 30,
      nutrientsPer100g: {
        kcal: 190, // ~10*9 + 20*4 + 5*4 = 90+80+20 = 190
        protein_g: 5,
        fat_g: 10,
        carb_g: 20,
      },
    };

    const variantB = {
      recipeLineId: "2",
      lotId: "lot2",
      productId: "prod2",
      productName: "Variant B",
      gramsConsumed: 30,
      nutrientsPer100g: {
        kcal: 297, // ~25*9 + 10*4 + 8*4 = 225+40+32 = 297
        protein_g: 8,
        fat_g: 25,
        carb_g: 10,
      },
    };

    const resultA = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: baseMealLines,
        consumedLots: [chickenLot, variantA],
      })
    );

    const resultB = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: baseMealLines,
        consumedLots: [chickenLot, variantB],
      })
    );

    // Macro differences from sauce portion (30g):
    const fatDiff =
      (resultB.perServing.fat_g ?? 0) - (resultA.perServing.fat_g ?? 0);
    const carbDiff =
      (resultB.perServing.carb_g ?? 0) - (resultA.perServing.carb_g ?? 0);
    const proteinDiff =
      (resultB.perServing.protein_g ?? 0) -
      (resultA.perServing.protein_g ?? 0);

    // Expected Atwater calorie difference from macros
    const expectedKcalDiff = fatDiff * 9 + carbDiff * 4 + proteinDiff * 4;

    // Actual calorie difference
    const actualKcalDiff =
      (resultB.perServing.kcal ?? 0) - (resultA.perServing.kcal ?? 0);

    // The difference in reported kcal should match Atwater prediction from macro diffs
    // (within tolerance since the kcal values in per100g were set to match Atwater)
    expect(actualKcalDiff).toBeCloseTo(expectedKcalDiff, 0);
  });
});

// =============================================================================
// C. ROUNDING EDGE CASES WITH SAUCES
// =============================================================================

describe("Sauce Nutrients - C: Rounding Edge Cases with Sauces", () => {
  it("sauce contributing 0.4g fat rounds to 0g per FDA rules", () => {
    // Need a sauce that contributes exactly 0.4g fat:
    // gramsConsumed * fat_per_100g / 100 = 0.4
    // e.g., 10g sauce at 4g fat/100g = 0.4g fat
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Light Sauce",
            gramsPerServing: 10,
            ingredientAllergens: [],
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Light Sauce",
            gramsConsumed: 10,
            nutrientsPer100g: {
              kcal: 40,
              protein_g: 0,
              fat_g: 4,
              carb_g: 1,
            },
          },
        ],
      })
    );

    // Raw: 0.4g fat
    expect(result.perServing.fat_g).toBeCloseTo(0.4, 5);
    // FDA rounding: < 0.5g rounds to 0
    expect(result.roundedFda.fatG).toBe(0);
  });

  it("sauce contributing exactly 0.5g fat — test boundary rounding", () => {
    // 10g sauce at 5g fat/100g = 0.5g fat
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Boundary Sauce",
            gramsPerServing: 10,
            ingredientAllergens: [],
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Boundary Sauce",
            gramsConsumed: 10,
            nutrientsPer100g: {
              kcal: 50,
              protein_g: 0,
              fat_g: 5,
              carb_g: 1,
            },
          },
        ],
      })
    );

    expect(result.perServing.fat_g).toBeCloseTo(0.5, 5);
    // roundFatLike: 0.5-5g range rounds to nearest 0.5, so 0.5 stays 0.5
    expect(result.roundedFda.fatG).toBe(0.5);
  });

  it("sauce contributing 4.7g fat rounds to 5g per FDA rules (nearest 0.5g)", () => {
    // 20g sauce at 23.5g fat/100g = 4.7g fat
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Medium Sauce",
            gramsPerServing: 20,
            ingredientAllergens: [],
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Medium Sauce",
            gramsConsumed: 20,
            nutrientsPer100g: {
              kcal: 250,
              protein_g: 1,
              fat_g: 23.5,
              carb_g: 5,
            },
          },
        ],
      })
    );

    expect(result.perServing.fat_g).toBeCloseTo(4.7, 5);
    // roundFatLike(4.7): in 0.5-5g range, rounds to nearest 0.5
    // 4.7 -> Math.round(4.7 * 2) / 2 = Math.round(9.4) / 2 = 9 / 2 = 4.5
    expect(result.roundedFda.fatG).toBe(roundFatLike(4.7));
    expect(result.roundedFda.fatG).toBe(4.5);
  });

  it("multiple sauces each contributing <0.5g fat — sum before rounding (correct approach)", () => {
    // Two sauces, each contributing 0.3g fat
    // If rounded individually: 0 + 0 = 0
    // If summed first: 0.6g, then roundFatLike(0.6) = 0.5
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Sauce A",
            gramsPerServing: 10,
            ingredientAllergens: [],
          },
          {
            lineId: "2",
            ingredientName: "Sauce B",
            gramsPerServing: 10,
            ingredientAllergens: [],
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Sauce A",
            gramsConsumed: 10,
            nutrientsPer100g: {
              kcal: 30,
              protein_g: 0,
              fat_g: 3,
              carb_g: 1,
            },
          },
          {
            recipeLineId: "2",
            lotId: "lot2",
            productId: "prod2",
            productName: "Sauce B",
            gramsConsumed: 10,
            nutrientsPer100g: {
              kcal: 30,
              protein_g: 0,
              fat_g: 3,
              carb_g: 1,
            },
          },
        ],
      })
    );

    // Each contributes 10 * 3/100 = 0.3g fat
    // Total raw fat = 0.6g
    expect(result.perServing.fat_g).toBeCloseTo(0.6, 5);
    // Correctly rounded from sum: roundFatLike(0.6) = 0.5
    expect(result.roundedFda.fatG).toBe(0.5);
    // NOT: roundFatLike(0.3) + roundFatLike(0.3) = 0 + 0 = 0
    expect(result.roundedFda.fatG).not.toBe(0);
  });
});

// =============================================================================
// D. CALORIE SANITY WITH SAUCE AS PRIMARY FAT SOURCE
// =============================================================================

describe("Sauce Nutrients - D: Calorie Sanity with Sauce as Primary Fat Source", () => {
  it("lean protein + high-fat sauce: Atwater check passes", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Chicken Breast",
            gramsPerServing: 150,
            ingredientAllergens: [],
          },
          {
            lineId: "2",
            ingredientName: "Tahini Sauce",
            gramsPerServing: 30,
            ingredientAllergens: ["sesame"],
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Chicken Breast",
            gramsConsumed: 150,
            nutrientsPer100g: {
              kcal: 165,
              protein_g: 31,
              fat_g: 3.6,
              carb_g: 0,
            },
          },
          {
            recipeLineId: "2",
            lotId: "lot2",
            productId: "prod2",
            productName: "Tahini Sauce",
            gramsConsumed: 30,
            nutrientsPer100g: {
              kcal: 500,
              protein_g: 15,
              fat_g: 45,
              carb_g: 12,
            },
          },
        ],
      })
    );

    expect(result.qa.pass).toBe(true);
    expect(result.qa.percentError).toBeLessThan(0.2);
  });

  it("very low-calorie base (lettuce) + rich dressing: dressing dominates calories", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Lettuce",
            gramsPerServing: 200,
            ingredientAllergens: [],
          },
          {
            lineId: "2",
            ingredientName: "Caesar Dressing",
            gramsPerServing: 30,
            ingredientAllergens: ["egg"],
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Romaine Lettuce",
            gramsConsumed: 200,
            nutrientsPer100g: {
              kcal: 15,
              protein_g: 1.2,
              fat_g: 0.3,
              carb_g: 2.8,
              fiber_g: 2.1,
            },
          },
          {
            recipeLineId: "2",
            lotId: "lot2",
            productId: "prod2",
            productName: "Caesar Dressing",
            gramsConsumed: 30,
            nutrientsPer100g: {
              kcal: 480,
              protein_g: 2,
              fat_g: 50,
              carb_g: 4,
            },
          },
        ],
      })
    );

    // Lettuce kcal: 200 * 15/100 = 30
    // Dressing kcal: 30 * 480/100 = 144
    // Total: 174 kcal
    const lettuceKcal = 200 * 15 / 100;
    const dressingKcal = 30 * 480 / 100;
    const totalKcal = result.perServing.kcal ?? 0;

    expect(totalKcal).toBeCloseTo(lettuceKcal + dressingKcal, 1);
    // Dressing should dominate: >75% of total
    expect(dressingKcal / totalKcal).toBeGreaterThan(0.75);
  });

  it("sauce-only computation (just a sauce, no protein) passes Atwater", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Marinara Sauce",
            gramsPerServing: 125,
            ingredientAllergens: [],
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Marinara Sauce",
            gramsConsumed: 125,
            nutrientsPer100g: {
              kcal: 50,
              protein_g: 1.5,
              fat_g: 1.5,
              carb_g: 8,
            },
          },
        ],
      })
    );

    expect(result.qa.pass).toBe(true);
    // 125g * 50/100 = 62.5 kcal
    expect(result.perServing.kcal).toBeCloseTo(62.5, 1);
  });

  it("mixed meal where sauce contributes >50% of total calories: qa.pass is true", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Steamed Vegetables",
            gramsPerServing: 200,
            ingredientAllergens: [],
          },
          {
            lineId: "2",
            ingredientName: "Pesto Sauce",
            gramsPerServing: 40,
            ingredientAllergens: ["tree_nuts"],
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Steamed Broccoli",
            gramsConsumed: 200,
            nutrientsPer100g: {
              kcal: 35,
              protein_g: 2.4,
              fat_g: 0.4,
              carb_g: 7.2,
              fiber_g: 3.3,
            },
          },
          {
            recipeLineId: "2",
            lotId: "lot2",
            productId: "prod2",
            productName: "Pesto Sauce",
            gramsConsumed: 40,
            nutrientsPer100g: {
              kcal: 510,
              protein_g: 5,
              fat_g: 50,
              carb_g: 6,
            },
          },
        ],
      })
    );

    // Veg kcal: 200 * 35/100 = 70
    // Pesto kcal: 40 * 510/100 = 204
    // Total: 274 kcal. Pesto is 204/274 = ~74%
    const pestoKcal = 40 * 510 / 100;
    const totalKcal = result.perServing.kcal ?? 0;
    expect(pestoKcal / totalKcal).toBeGreaterThan(0.5);
    expect(result.qa.pass).toBe(true);
  });
});

// =============================================================================
// E. ALLERGEN DETECTION WITH SAUCES
// =============================================================================

describe("Sauce Nutrients - E: Allergen Detection with Sauces", () => {
  it("peanut sauce adds 'peanuts' allergen to otherwise allergen-free meal", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Rice Noodles",
            gramsPerServing: 200,
            ingredientAllergens: [],
          },
          {
            lineId: "2",
            ingredientName: "Peanut Sauce",
            gramsPerServing: 30,
            ingredientAllergens: ["peanuts"],
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Rice Noodles",
            gramsConsumed: 200,
            nutrientsPer100g: { kcal: 109, protein_g: 0.9, fat_g: 0.2, carb_g: 25 },
          },
          {
            recipeLineId: "2",
            lotId: "lot2",
            productId: "prod2",
            productName: "Peanut Sauce",
            gramsConsumed: 30,
            nutrientsPer100g: { kcal: 350, protein_g: 12, fat_g: 25, carb_g: 20 },
          },
        ],
      })
    );

    expect(result.allergenStatement).toContain("peanuts");
    expect(result.allergenStatement).not.toContain("None of the 9 major allergens");
  });

  it("multiple sauces with different allergens — all listed", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Noodles",
            gramsPerServing: 200,
            ingredientAllergens: ["wheat"],
          },
          {
            lineId: "2",
            ingredientName: "Soy Sauce",
            gramsPerServing: 10,
            ingredientAllergens: ["soy", "wheat"],
          },
          {
            lineId: "3",
            ingredientName: "Peanut Sauce",
            gramsPerServing: 20,
            ingredientAllergens: ["peanuts"],
          },
          {
            lineId: "4",
            ingredientName: "Sesame Oil",
            gramsPerServing: 5,
            ingredientAllergens: ["sesame"],
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Wheat Noodles",
            gramsConsumed: 200,
            nutrientsPer100g: { kcal: 138, protein_g: 5, fat_g: 1, carb_g: 27 },
          },
          {
            recipeLineId: "2",
            lotId: "lot2",
            productId: "prod2",
            productName: "Soy Sauce",
            gramsConsumed: 10,
            nutrientsPer100g: { kcal: 53, protein_g: 8, fat_g: 0, carb_g: 5 },
          },
          {
            recipeLineId: "3",
            lotId: "lot3",
            productId: "prod3",
            productName: "Peanut Sauce",
            gramsConsumed: 20,
            nutrientsPer100g: { kcal: 350, protein_g: 12, fat_g: 25, carb_g: 20 },
          },
          {
            recipeLineId: "4",
            lotId: "lot4",
            productId: "prod4",
            productName: "Sesame Oil",
            gramsConsumed: 5,
            nutrientsPer100g: { kcal: 884, protein_g: 0, fat_g: 100, carb_g: 0 },
          },
        ],
      })
    );

    expect(result.allergenStatement).toContain("wheat");
    expect(result.allergenStatement).toContain("soy");
    expect(result.allergenStatement).toContain("peanuts");
    expect(result.allergenStatement).toContain("sesame");
  });

  it("sauce with no allergens does not affect base meal allergens", () => {
    const result = computeSkuLabel(
      buildInput({
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Pasta",
            gramsPerServing: 200,
            ingredientAllergens: ["wheat"],
          },
          {
            lineId: "2",
            ingredientName: "Tomato Sauce",
            gramsPerServing: 100,
            ingredientAllergens: [],
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Spaghetti",
            gramsConsumed: 200,
            nutrientsPer100g: { kcal: 158, protein_g: 6, fat_g: 1, carb_g: 31 },
          },
          {
            recipeLineId: "2",
            lotId: "lot2",
            productId: "prod2",
            productName: "Tomato Sauce",
            gramsConsumed: 100,
            nutrientsPer100g: { kcal: 30, protein_g: 1.3, fat_g: 0.2, carb_g: 6 },
          },
        ],
      })
    );

    // Only wheat from pasta should be present
    expect(result.allergenStatement).toContain("wheat");
    // Allergen statement should not list any extra allergens
    expect(result.allergenStatement).not.toContain("soy");
    expect(result.allergenStatement).not.toContain("peanuts");
    expect(result.allergenStatement).not.toContain("milk");
  });
});

// =============================================================================
// F. INTEGRATION: FULL MEAL WITH SAUCE
// =============================================================================

describe("Sauce Nutrients - F: Integration — Full Meal with Sauce", () => {
  it("chicken breast + white rice + teriyaki sauce: realistic nutrition values", () => {
    const result = computeSkuLabel(
      buildInput({
        skuName: "Teriyaki Chicken Bowl",
        recipeName: "Teriyaki Chicken Bowl",
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Chicken Breast",
            gramsPerServing: 150,
            ingredientAllergens: [],
          },
          {
            lineId: "2",
            ingredientName: "White Rice",
            gramsPerServing: 200,
            ingredientAllergens: [],
          },
          {
            lineId: "3",
            ingredientName: "Teriyaki Sauce",
            gramsPerServing: 30,
            ingredientAllergens: ["soy", "wheat"],
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Chicken Breast",
            gramsConsumed: 150,
            nutrientsPer100g: {
              kcal: 165,
              protein_g: 31,
              fat_g: 3.6,
              carb_g: 0,
              sodium_mg: 74,
            },
          },
          {
            recipeLineId: "2",
            lotId: "lot2",
            productId: "prod2",
            productName: "White Rice",
            gramsConsumed: 200,
            nutrientsPer100g: {
              kcal: 130,
              protein_g: 2.7,
              fat_g: 0.3,
              carb_g: 28,
              sodium_mg: 1,
            },
          },
          {
            recipeLineId: "3",
            lotId: "lot3",
            productId: "prod3",
            productName: "Teriyaki Sauce",
            gramsConsumed: 30,
            nutrientsPer100g: {
              kcal: 89,
              protein_g: 0.5,
              fat_g: 0,
              carb_g: 17,
              sodium_mg: 3600,
            },
          },
        ],
      })
    );

    // Chicken kcal: 150 * 165/100 = 247.5
    // Rice kcal: 200 * 130/100 = 260
    // Teriyaki kcal: 30 * 89/100 = 26.7
    // Total: ~534.2 kcal
    expect(result.perServing.kcal).toBeGreaterThan(450);
    expect(result.perServing.kcal).toBeLessThan(550);

    // Sodium: chicken 111 + rice 2 + teriyaki 30*3600/100=1080 = ~1193mg
    expect(result.perServing.sodium_mg).toBeGreaterThan(1000);

    // Protein comes mainly from chicken: 150*31/100 = 46.5g
    // Rice protein: 200*2.7/100 = 5.4g
    // Teriyaki protein: 30*0.5/100 = 0.15g
    // Total: ~52.05g. Chicken is 46.5/52.05 = ~89%
    const chickenProtein = 150 * 31 / 100;
    const totalProtein = result.perServing.protein_g ?? 0;
    expect(chickenProtein / totalProtein).toBeGreaterThan(0.8);

    // QA should pass
    expect(result.qa.pass).toBe(true);

    // Allergens from teriyaki sauce
    expect(result.allergenStatement).toContain("soy");
    expect(result.allergenStatement).toContain("wheat");
  });

  it("salmon + quinoa + chimichurri: high-fat sauce contribution verified", () => {
    const result = computeSkuLabel(
      buildInput({
        skuName: "Salmon Quinoa Chimichurri",
        recipeName: "Salmon Quinoa Chimichurri",
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Salmon",
            gramsPerServing: 140,
            ingredientAllergens: ["fish"],
          },
          {
            lineId: "2",
            ingredientName: "Quinoa",
            gramsPerServing: 150,
            ingredientAllergens: [],
          },
          {
            lineId: "3",
            ingredientName: "Chimichurri",
            gramsPerServing: 20,
            ingredientAllergens: [],
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Salmon Fillet",
            gramsConsumed: 140,
            nutrientsPer100g: {
              kcal: 208,
              protein_g: 20,
              fat_g: 13,
              carb_g: 0,
            },
          },
          {
            recipeLineId: "2",
            lotId: "lot2",
            productId: "prod2",
            productName: "Quinoa",
            gramsConsumed: 150,
            nutrientsPer100g: {
              kcal: 120,
              protein_g: 4.4,
              fat_g: 1.9,
              carb_g: 21.3,
            },
          },
          {
            recipeLineId: "3",
            lotId: "lot3",
            productId: "prod3",
            productName: "Chimichurri",
            gramsConsumed: 20,
            nutrientsPer100g: {
              kcal: 500,
              protein_g: 0,
              fat_g: 55,
              carb_g: 0,
            },
          },
        ],
      })
    );

    // Chimichurri fat contribution: 20 * 55/100 = 11g
    const chimiFat = 20 * 55 / 100;
    expect(chimiFat).toBeCloseTo(11, 1);

    // Total fat: salmon 140*13/100=18.2 + quinoa 150*1.9/100=2.85 + chimichurri 11 = 32.05
    const salmonFat = 140 * 13 / 100;
    const quinoaFat = 150 * 1.9 / 100;
    expect(result.perServing.fat_g).toBeCloseTo(
      salmonFat + quinoaFat + chimiFat,
      1
    );

    // Total kcal: salmon 291.2 + quinoa 180 + chimichurri 100 = 571.2
    const salmonKcal = 140 * 208 / 100;
    const quinoaKcal = 150 * 120 / 100;
    const chimiKcal = 20 * 500 / 100;
    expect(result.perServing.kcal).toBeCloseTo(
      salmonKcal + quinoaKcal + chimiKcal,
      1
    );

    // Chimichurri's caloric density is reflected: 100 kcal from just 20g
    expect(chimiKcal / (result.perServing.kcal ?? 1)).toBeGreaterThan(0.15);

    // QA should pass
    expect(result.qa.pass).toBe(true);

    // Fish allergen from salmon
    expect(result.allergenStatement).toContain("fish");
  });
});
