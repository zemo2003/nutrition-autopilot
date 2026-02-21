import { describe, expect, it } from "vitest";
import { mapOrderLineToIngredient } from "./instacart-importer.js";

describe("mapOrderLineToIngredient", () => {
  it("returns best ingredient with confidence", () => {
    const result = mapOrderLineToIngredient("Good Culture Cottage Cheese", [
      {
        ingredientKey: "cottage_cheese",
        ingredientName: "Cottage Cheese",
        category: "dairy",
        defaultUnit: "g",
        allergenTags: ["milk"]
      },
      {
        ingredientKey: "broccoli",
        ingredientName: "Broccoli",
        category: "vegetable",
        defaultUnit: "g",
        allergenTags: []
      }
    ]);

    expect(result.ingredientKey).toBe("cottage_cheese");
    expect(result.confidence).toBeGreaterThan(0.85);
  });
});
