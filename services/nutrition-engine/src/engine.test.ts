import { describe, expect, it } from "vitest";
import { computeSkuLabel } from "./engine.js";

describe("computeSkuLabel", () => {
  it("computes deterministic fda panel and qa", () => {
    const result = computeSkuLabel({
      skuName: "Bowl",
      recipeName: "Chicken Bowl",
      servings: 1,
      lines: [
        { lineId: "1", ingredientName: "Chicken", gramsPerServing: 120, ingredientAllergens: [] },
        { lineId: "2", ingredientName: "Cottage Cheese", gramsPerServing: 80, ingredientAllergens: ["milk"] }
      ],
      consumedLots: [
        {
          recipeLineId: "1",
          lotId: "lot1",
          productId: "prod1",
          productName: "Chicken Brand",
          gramsConsumed: 120,
          nutrientsPer100g: { kcal: 165, protein_g: 31, fat_g: 3.6, carb_g: 0, sodium_mg: 74 }
        },
        {
          recipeLineId: "2",
          lotId: "lot2",
          productId: "prod2",
          productName: "Dairy Brand",
          gramsConsumed: 80,
          nutrientsPer100g: { kcal: 98, protein_g: 11, fat_g: 4.3, carb_g: 3.4, sodium_mg: 315 }
        }
      ]
    });

    expect(result.roundedFda.calories).toBeGreaterThan(0);
    expect(result.ingredientDeclaration).toContain("Chicken");
    expect(result.allergenStatement).toContain("milk");
    expect(typeof result.qa.pass).toBe("boolean");
    expect(Object.keys(result.perServing).length).toBe(40);
    expect(result.provisional).toBe(false);
    expect(result.evidenceSummary.totalNutrientRows).toBe(0);
  });

  it("preserves explicit zero values and carries provisional evidence summary", () => {
    const result = computeSkuLabel({
      skuName: "Lean fish",
      recipeName: "Cod",
      servings: 1,
      lines: [{ lineId: "1", ingredientName: "Cod", gramsPerServing: 100, ingredientAllergens: ["fish"] }],
      consumedLots: [
        {
          recipeLineId: "1",
          lotId: "lot-cod",
          productId: "prod-cod",
          productName: "Cod",
          gramsConsumed: 100,
          nutrientsPer100g: { kcal: 100, protein_g: 22, carb_g: 0, fat_g: 1, sodium_mg: 80, sugars_g: 0 }
        }
      ],
      provisional: true,
      evidenceSummary: {
        verifiedCount: 2,
        inferredCount: 1,
        exceptionCount: 1,
        provisional: true
      }
    });

    expect(result.perServing.carb_g).toBe(0);
    expect(result.perServing.sugars_g).toBe(0);
    expect(result.provisional).toBe(true);
    expect(result.evidenceSummary.inferredCount).toBe(1);
    expect(result.evidenceSummary.exceptionCount).toBe(1);
  });
});
