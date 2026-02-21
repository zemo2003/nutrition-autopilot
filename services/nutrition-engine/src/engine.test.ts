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
  });
});
