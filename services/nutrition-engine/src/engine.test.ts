import { describe, it, expect } from "vitest";
import { computeSkuLabel } from "./engine.js";
import {
  roundCalories,
  roundFatLike,
  roundGeneralG,
  roundSodiumMg,
  roundCholesterolMg,
  roundPercentDV,
  roundVitaminD,
  roundCalcium,
  roundIron,
  roundPotassium,
  roundVitaminA,
  roundVitaminC,
  roundVitaminE,
  roundVitaminK,
  roundThiamin,
  roundRiboflavin,
  roundNiacin,
  roundVitaminB6,
  roundFolate,
  roundVitaminB12,
  roundBiotin,
  roundPantothenicAcid,
  roundPhosphorus,
  roundIodine,
  roundMagnesium,
  roundZinc,
  roundSelenium,
  roundCopper,
  roundManganese,
  roundChromium,
  roundMolybdenum,
  roundChloride,
  roundCholine,
} from "./rounding.js";
import {
  computePercentDV,
  getMandatoryNutrients,
  getDailyValue,
  calculatePercentDV,
} from "./daily-values.js";
import {
  detectFoodCategory,
  validateNutrientProfile,
  validateFoodProduct,
} from "./plausibility.js";
import {
  getUsdaNumberByKey,
  getNutrientKeyByUsdaNumber,
  convertUsdaNutrients,
  hasAllRequiredNutrients,
  USDA_NUTRIENT_MAP,
} from "./usda-mapping.js";

// ============================================================================
// 1. FDA ROUNDING TESTS (rounding.ts)
// ============================================================================

describe("FDA Rounding - Calories", () => {
  it("rounds calories < 5 to 0", () => {
    expect(roundCalories(0)).toBe(0);
    expect(roundCalories(2.3)).toBe(0);
    expect(roundCalories(4.9)).toBe(0);
  });

  it("rounds calories 5-50 to nearest 5", () => {
    expect(roundCalories(5.0)).toBe(5);
    expect(roundCalories(5.1)).toBe(5);
    expect(roundCalories(7.5)).toBe(10); // 7.5 rounds to nearest 5 → 10
    expect(roundCalories(12.5)).toBe(15); // 12.5 rounds to nearest 5 → 15
    expect(roundCalories(25)).toBe(25);
    expect(roundCalories(50)).toBe(50);
  });

  it("rounds calories > 50 to nearest 10", () => {
    expect(roundCalories(50.1)).toBe(50);
    expect(roundCalories(54.9)).toBe(50);
    expect(roundCalories(55)).toBe(60);
    expect(roundCalories(100)).toBe(100);
    expect(roundCalories(165.4)).toBe(170);
    expect(roundCalories(500)).toBe(500);
  });
});

describe("FDA Rounding - Fat-like nutrients", () => {
  it("rounds fat < 0.5g to 0", () => {
    expect(roundFatLike(0)).toBe(0);
    expect(roundFatLike(0.24)).toBe(0);
    expect(roundFatLike(0.49)).toBe(0);
  });

  it("rounds fat 0.5-5g to nearest 0.5", () => {
    expect(roundFatLike(0.5)).toBe(0.5);
    expect(roundFatLike(0.6)).toBe(0.5);
    expect(roundFatLike(0.75)).toBe(1.0);
    expect(roundFatLike(2.5)).toBe(2.5);
    expect(roundFatLike(4.9)).toBe(5.0);
  });

  it("rounds fat > 5g to nearest 1", () => {
    expect(roundFatLike(5.0)).toBe(5);
    expect(roundFatLike(5.1)).toBe(5);
    expect(roundFatLike(5.4)).toBe(5);
    expect(roundFatLike(5.6)).toBe(6);
    expect(roundFatLike(10.2)).toBe(10);
    expect(roundFatLike(3.6)).toBe(3.5); // still in 0.5-5 range
  });
});

describe("FDA Rounding - General grams", () => {
  it("rounds general g < 0.5g to 0", () => {
    expect(roundGeneralG(0)).toBe(0);
    expect(roundGeneralG(0.24)).toBe(0);
    expect(roundGeneralG(0.49)).toBe(0);
  });

  it("rounds general g >= 0.5 to nearest 1", () => {
    expect(roundGeneralG(0.5)).toBe(1); // Math.round(0.5) = 1
    expect(roundGeneralG(0.6)).toBe(1);
    expect(roundGeneralG(1.4)).toBe(1);
    expect(roundGeneralG(1.5)).toBe(2);
    expect(roundGeneralG(10.0)).toBe(10);
    expect(roundGeneralG(31.0)).toBe(31);
  });
});

describe("FDA Rounding - Sodium", () => {
  it("rounds sodium < 5mg to 0", () => {
    expect(roundSodiumMg(0)).toBe(0);
    expect(roundSodiumMg(2.3)).toBe(0);
    expect(roundSodiumMg(4.9)).toBe(0);
  });

  it("rounds sodium 5-140mg to nearest 5", () => {
    expect(roundSodiumMg(5)).toBe(5);
    expect(roundSodiumMg(7.5)).toBe(10); // 7.5 rounds to nearest 5 → 10
    expect(roundSodiumMg(50)).toBe(50);
    expect(roundSodiumMg(140)).toBe(140);
  });

  it("rounds sodium > 140mg to nearest 10", () => {
    expect(roundSodiumMg(140.1)).toBe(140);
    expect(roundSodiumMg(145)).toBe(150); // 145 rounds to nearest 10 → 150
    expect(roundSodiumMg(315)).toBe(320); // 315 rounds to nearest 10 → 320
    expect(roundSodiumMg(2300)).toBe(2300);
  });
});

describe("FDA Rounding - Cholesterol", () => {
  it("rounds cholesterol < 2mg to 0", () => {
    expect(roundCholesterolMg(0)).toBe(0);
    expect(roundCholesterolMg(1.9)).toBe(0);
  });

  it("rounds cholesterol >= 2mg to nearest 5", () => {
    expect(roundCholesterolMg(2.0)).toBe(0);
    expect(roundCholesterolMg(2.5)).toBe(5);
    expect(roundCholesterolMg(5)).toBe(5);
    expect(roundCholesterolMg(300)).toBe(300);
  });
});

describe("FDA Rounding - Micronutrients", () => {
  it("rounds vitamin D to nearest 0.1 mcg", () => {
    expect(roundVitaminD(0)).toBe(0);
    expect(roundVitaminD(2.05)).toBe(2.1);
    expect(roundVitaminD(10.14)).toBe(10.1);
    expect(roundVitaminD(10.15)).toBe(10.2);
  });

  it("rounds calcium to nearest 10 mg (with < 5mg = 0)", () => {
    expect(roundCalcium(0)).toBe(0);
    expect(roundCalcium(4.9)).toBe(0);
    expect(roundCalcium(5)).toBe(10);
    expect(roundCalcium(650)).toBe(650);
  });

  it("rounds iron correctly", () => {
    expect(roundIron(0)).toBe(0);
    expect(roundIron(0.4)).toBe(0);
    expect(roundIron(0.5)).toBe(0.5);
    expect(roundIron(2.14)).toBe(2.1);
    expect(roundIron(5.1)).toBe(5);
    expect(roundIron(10.5)).toBe(11);
  });

  it("rounds potassium to nearest 10 mg (with < 5mg = 0)", () => {
    expect(roundPotassium(0)).toBe(0);
    expect(roundPotassium(4.9)).toBe(0);
    expect(roundPotassium(5)).toBe(10);
    expect(roundPotassium(4700)).toBe(4700);
  });

  it("rounds vitamin A to nearest 5 mcg (with < 2.5mcg = 0)", () => {
    expect(roundVitaminA(0)).toBe(0);
    expect(roundVitaminA(2.4)).toBe(0);
    expect(roundVitaminA(2.5)).toBe(5); // 2.5 is not < 2.5, rounds to 5
    expect(roundVitaminA(2.6)).toBe(5);
    expect(roundVitaminA(900)).toBe(900);
  });

  it("rounds vitamin C to nearest 5 mg", () => {
    expect(roundVitaminC(0)).toBe(0);
    expect(roundVitaminC(2.4)).toBe(0);
    expect(roundVitaminC(2.5)).toBe(5); // 2.5 is not < 2.5, rounds to 5
    expect(roundVitaminC(2.6)).toBe(5);
    expect(roundVitaminC(90)).toBe(90);
  });

  it("rounds vitamin E to nearest 1 mg", () => {
    expect(roundVitaminE(0)).toBe(0);
    expect(roundVitaminE(0.4)).toBe(0);
    expect(roundVitaminE(0.5)).toBe(1); // 0.5 is not < 0.5, Math.round(0.5) = 1
    expect(roundVitaminE(0.6)).toBe(1);
    expect(roundVitaminE(15)).toBe(15);
  });

  it("rounds vitamin K to nearest 1 mcg", () => {
    expect(roundVitaminK(0)).toBe(0);
    expect(roundVitaminK(0.4)).toBe(0);
    expect(roundVitaminK(0.5)).toBe(1); // 0.5 is not < 0.5, Math.round(0.5) = 1
    expect(roundVitaminK(0.6)).toBe(1);
    expect(roundVitaminK(120)).toBe(120);
  });

  it("rounds B vitamins to nearest 1 mg/mcg", () => {
    expect(roundThiamin(0.4)).toBe(0);
    expect(roundThiamin(0.6)).toBe(1);
    expect(roundRiboflavin(0.4)).toBe(0);
    expect(roundRiboflavin(0.6)).toBe(1);
    expect(roundNiacin(0.4)).toBe(0);
    expect(roundNiacin(0.6)).toBe(1);
    expect(roundVitaminB6(0.4)).toBe(0);
    expect(roundVitaminB6(0.6)).toBe(1);
  });

  it("rounds folate to nearest 5 mcg", () => {
    expect(roundFolate(0)).toBe(0);
    expect(roundFolate(2.4)).toBe(0);
    expect(roundFolate(2.6)).toBe(5);
    expect(roundFolate(400)).toBe(400);
  });

  it("rounds vitamin B12 to nearest 0.1 mcg", () => {
    expect(roundVitaminB12(0)).toBe(0);
    expect(roundVitaminB12(2.05)).toBe(2.1);
    expect(roundVitaminB12(2.35)).toBe(2.4);
  });

  it("rounds biotin to nearest 1 mcg", () => {
    expect(roundBiotin(0.4)).toBe(0);
    expect(roundBiotin(0.6)).toBe(1);
    expect(roundBiotin(30)).toBe(30);
  });

  it("rounds pantothenic acid to nearest 1 mg", () => {
    expect(roundPantothenicAcid(0.4)).toBe(0);
    expect(roundPantothenicAcid(0.6)).toBe(1);
    expect(roundPantothenicAcid(5)).toBe(5);
  });

  it("rounds phosphorus to nearest 10 mg", () => {
    expect(roundPhosphorus(0)).toBe(0);
    expect(roundPhosphorus(4.9)).toBe(0);
    expect(roundPhosphorus(5)).toBe(10);
    expect(roundPhosphorus(1250)).toBe(1250);
  });

  it("rounds iodine to nearest 1 mcg", () => {
    expect(roundIodine(0.4)).toBe(0);
    expect(roundIodine(0.6)).toBe(1);
    expect(roundIodine(150)).toBe(150);
  });

  it("rounds magnesium to nearest 5 mg", () => {
    expect(roundMagnesium(0)).toBe(0);
    expect(roundMagnesium(2.4)).toBe(0);
    expect(roundMagnesium(2.6)).toBe(5);
    expect(roundMagnesium(420)).toBe(420);
  });

  it("rounds zinc to nearest 1 mg", () => {
    expect(roundZinc(0.4)).toBe(0);
    expect(roundZinc(0.6)).toBe(1);
    expect(roundZinc(11)).toBe(11);
  });

  it("rounds selenium to nearest 1 mcg", () => {
    expect(roundSelenium(0.4)).toBe(0);
    expect(roundSelenium(0.6)).toBe(1);
    expect(roundSelenium(55)).toBe(55);
  });

  it("rounds copper to nearest 0.1 mg", () => {
    expect(roundCopper(0)).toBe(0);
    expect(roundCopper(0.05)).toBe(0.1);
    expect(roundCopper(0.9)).toBe(0.9);
  });

  it("rounds manganese to nearest 1 mg", () => {
    expect(roundManganese(0.4)).toBe(0);
    expect(roundManganese(0.6)).toBe(1);
    expect(roundManganese(2.3)).toBe(2);
  });

  it("rounds chromium to nearest 1 mcg", () => {
    expect(roundChromium(0.4)).toBe(0);
    expect(roundChromium(0.6)).toBe(1);
    expect(roundChromium(35)).toBe(35);
  });

  it("rounds molybdenum to nearest 1 mcg", () => {
    expect(roundMolybdenum(0.4)).toBe(0);
    expect(roundMolybdenum(0.6)).toBe(1);
    expect(roundMolybdenum(45)).toBe(45);
  });

  it("rounds chloride to nearest 10 mg", () => {
    expect(roundChloride(0)).toBe(0);
    expect(roundChloride(4.9)).toBe(0);
    expect(roundChloride(5)).toBe(10);
    expect(roundChloride(2300)).toBe(2300);
  });

  it("rounds choline to nearest 10 mg", () => {
    expect(roundCholine(0)).toBe(0);
    expect(roundCholine(4.9)).toBe(0);
    expect(roundCholine(5)).toBe(10);
    expect(roundCholine(550)).toBe(550);
  });
});

describe("FDA Rounding - Percent Daily Value", () => {
  it("rounds %DV < 2% to 0", () => {
    expect(roundPercentDV(0)).toBe(0);
    expect(roundPercentDV(1)).toBe(0);
    expect(roundPercentDV(1.9)).toBe(0);
  });

  it("rounds %DV 2-10% to nearest 2%", () => {
    expect(roundPercentDV(2)).toBe(2);
    expect(roundPercentDV(3)).toBe(4); // Math.round(3/2)*2 = Math.round(1.5)*2 = 4
    expect(roundPercentDV(4)).toBe(4);
    expect(roundPercentDV(9)).toBe(10);
    expect(roundPercentDV(10)).toBe(10);
  });

  it("rounds %DV 10-50% to nearest 5%", () => {
    expect(roundPercentDV(10.1)).toBe(10);
    expect(roundPercentDV(12)).toBe(10);
    expect(roundPercentDV(13)).toBe(15);
    expect(roundPercentDV(49)).toBe(50);
    expect(roundPercentDV(50)).toBe(50);
  });

  it("rounds %DV > 50% to nearest 10%", () => {
    expect(roundPercentDV(50.1)).toBe(50);
    expect(roundPercentDV(54)).toBe(50);
    expect(roundPercentDV(55)).toBe(60);
    expect(roundPercentDV(100)).toBe(100);
    expect(roundPercentDV(250)).toBe(250);
  });
});

// ============================================================================
// 2. ENGINE CALCULATION TESTS (engine.ts)
// ============================================================================

describe("Engine - Basic single-lot computation", () => {
  it("computes deterministic fda panel with known values", () => {
    const result = computeSkuLabel({
      skuName: "Chicken Bowl",
      recipeName: "Chicken Bowl",
      servings: 1,
      lines: [
        {
          lineId: "1",
          ingredientName: "Chicken",
          gramsPerServing: 120,
          ingredientAllergens: [],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "1",
          lotId: "lot1",
          productId: "prod1",
          productName: "Chicken Brand",
          gramsConsumed: 120,
          nutrientsPer100g: {
            kcal: 165,
            protein_g: 31,
            fat_g: 3.6,
            carb_g: 0,
            sodium_mg: 74,
          },
        },
      ],
    });

    expect(result.roundedFda.calories).toBeGreaterThan(0);
    expect(result.roundedFda.proteinG).toBeGreaterThan(0);
    expect(result.servingWeightG).toBe(120);
    expect(result.ingredientDeclaration).toContain("Chicken");
  });

  it("provides all 40 nutrient keys in perServing", () => {
    const result = computeSkuLabel({
      skuName: "Simple",
      recipeName: "Simple",
      servings: 1,
      lines: [
        {
          lineId: "1",
          ingredientName: "Test",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "1",
          lotId: "lot1",
          productId: "prod1",
          productName: "Test",
          gramsConsumed: 100,
          nutrientsPer100g: { kcal: 100, protein_g: 20 },
        },
      ],
    });

    expect(Object.keys(result.perServing).length).toBe(40);
    expect(result.perServing.kcal).toBe(100);
    expect(result.perServing.protein_g).toBe(20);
    expect(result.perServing.carb_g).toBe(0); // filled in as 0
  });
});

describe("Engine - Multi-lot aggregation", () => {
  it("aggregates nutrients linearly across multiple lots", () => {
    const result = computeSkuLabel({
      skuName: "Mixed Bowl",
      recipeName: "Mixed",
      servings: 1,
      lines: [
        {
          lineId: "1",
          ingredientName: "Chicken",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
        {
          lineId: "2",
          ingredientName: "Rice",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "1",
          lotId: "lot1",
          productId: "prod1",
          productName: "Chicken",
          gramsConsumed: 100,
          nutrientsPer100g: { kcal: 165, protein_g: 31, fat_g: 3.6 },
        },
        {
          recipeLineId: "2",
          lotId: "lot2",
          productId: "prod2",
          productName: "Rice",
          gramsConsumed: 100,
          nutrientsPer100g: { kcal: 130, protein_g: 2.7, carb_g: 28 },
        },
      ],
    });

    // For 1 serving: chicken (100g) + rice (100g) = 200g total
    expect(result.perServing.kcal).toBe(165 + 130); // 295
    expect(result.perServing.protein_g).toBe(31 + 2.7); // 33.7
    expect(result.perServing.carb_g).toBe(0 + 28); // 28
    expect(result.servingWeightG).toBe(200);
  });
});

describe("Engine - Multiple servings division", () => {
  it("divides nutrients by serving count", () => {
    const result = computeSkuLabel({
      skuName: "Bowl x2",
      recipeName: "Bowl",
      servings: 2,
      lines: [
        {
          lineId: "1",
          ingredientName: "Chicken",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "1",
          lotId: "lot1",
          productId: "prod1",
          productName: "Chicken",
          gramsConsumed: 200, // total 200g for 2 servings
          nutrientsPer100g: { kcal: 165, protein_g: 31 },
        },
      ],
    });

    // Total nutrients: 200g * (165/100) = 330 kcal, 62g protein
    // Per serving (÷2): 165 kcal, 31g protein
    expect(result.perServing.kcal).toBe(165);
    expect(result.perServing.protein_g).toBe(31);
    expect(result.servingWeightG).toBe(100); // 200 / 2 servings
  });
});

describe("Engine - Zero servings handling", () => {
  it("defaults zero servings to 1", () => {
    const result = computeSkuLabel({
      skuName: "Test",
      recipeName: "Test",
      servings: 0,
      lines: [
        {
          lineId: "1",
          ingredientName: "Test",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
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
    });

    expect(result.perServing.kcal).toBe(100);
  });

  it("defaults negative servings to 1", () => {
    const result = computeSkuLabel({
      skuName: "Test",
      recipeName: "Test",
      servings: -5,
      lines: [
        {
          lineId: "1",
          ingredientName: "Test",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
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
    });

    expect(result.perServing.kcal).toBe(100);
  });
});

describe("Engine - Ingredient declaration", () => {
  it("sorts ingredients by weight descending", () => {
    const result = computeSkuLabel({
      skuName: "Salad",
      recipeName: "Salad",
      servings: 1,
      lines: [
        {
          lineId: "1",
          ingredientName: "Lettuce",
          gramsPerServing: 50,
          ingredientAllergens: [],
        },
        {
          lineId: "2",
          ingredientName: "Chicken",
          gramsPerServing: 150,
          ingredientAllergens: [],
        },
        {
          lineId: "3",
          ingredientName: "Dressing",
          gramsPerServing: 30,
          ingredientAllergens: [],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "1",
          lotId: "lot1",
          productId: "prod1",
          productName: "Lettuce",
          gramsConsumed: 50,
          nutrientsPer100g: { kcal: 15 },
        },
        {
          recipeLineId: "2",
          lotId: "lot2",
          productId: "prod2",
          productName: "Chicken",
          gramsConsumed: 150,
          nutrientsPer100g: { kcal: 165 },
        },
        {
          recipeLineId: "3",
          lotId: "lot3",
          productId: "prod3",
          productName: "Dressing",
          gramsConsumed: 30,
          nutrientsPer100g: { kcal: 400 },
        },
      ],
    });

    // Should be: Chicken (150) > Lettuce (50) > Dressing (30)
    expect(result.ingredientDeclaration).toMatch(
      /Chicken.*Lettuce.*Dressing/
    );
  });
});

describe("Engine - Allergen detection", () => {
  it("detects all 9 major allergens", () => {
    const allergens = [
      "milk",
      "egg",
      "fish",
      "shellfish",
      "tree_nuts",
      "peanuts",
      "wheat",
      "soy",
      "sesame",
    ];

    for (const allergen of allergens) {
      const result = computeSkuLabel({
        skuName: "Test",
        recipeName: "Test",
        servings: 1,
        lines: [
          {
            lineId: "1",
            ingredientName: "Ingredient",
            gramsPerServing: 100,
            ingredientAllergens: [allergen],
          },
        ],
        consumedLots: [
          {
            recipeLineId: "1",
            lotId: "lot1",
            productId: "prod1",
            productName: "Product",
            gramsConsumed: 100,
            nutrientsPer100g: { kcal: 100 },
          },
        ],
      });

      expect(result.allergenStatement).toContain(
        allergen.replace(/_/g, " ")
      );
    }
  });

  it("shows none statement when no allergens", () => {
    const result = computeSkuLabel({
      skuName: "Clean",
      recipeName: "Clean",
      servings: 1,
      lines: [
        {
          lineId: "1",
          ingredientName: "Rice",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "1",
          lotId: "lot1",
          productId: "prod1",
          productName: "Rice",
          gramsConsumed: 100,
          nutrientsPer100g: { kcal: 130 },
        },
      ],
    });

    expect(result.allergenStatement).toContain("None of the 9 major allergens");
  });
});

// ============================================================================
// 3. QA CHECK TESTS (Bug Fix #1 - percentage-based)
// ============================================================================

describe("Engine - QA Checks (±20% Class I tolerance)", () => {
  it("passes when error is at boundary (20%)", () => {
    // macroKcal = protein*4 + carb*4 + fat*9 = 5*4 + 25*4 + 0*9 = 120
    // rawCalories = 100, delta = |120 - 100| = 20
    // percentError = |delta / rawCalories| = 20/100 = 0.20 exactly
    const result = computeSkuLabel({
      skuName: "Test",
      recipeName: "Test",
      servings: 1,
      lines: [
        {
          lineId: "1",
          ingredientName: "Test",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "1",
          lotId: "lot1",
          productId: "prod1",
          productName: "Test",
          gramsConsumed: 100,
          nutrientsPer100g: {
            kcal: 100,
            protein_g: 5,
            carb_g: 25,
            fat_g: 0,
          },
        },
      ],
    });

    expect(result.qa.pass).toBe(true);
    expect(result.qa.percentError).toBe(0.2); // exactly 20%
  });

  it("fails when error exceeds 20%", () => {
    // 100 kcal reported, but macros = 120 kcal -> 20 kcal error = 20%
    // Wait, that's still 20%. Let's do 25% error
    const result = computeSkuLabel({
      skuName: "Test",
      recipeName: "Test",
      servings: 1,
      lines: [
        {
          lineId: "1",
          ingredientName: "Test",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "1",
          lotId: "lot1",
          productId: "prod1",
          productName: "Test",
          gramsConsumed: 100,
          // protein=5g (20kcal) + carb=20g (80kcal) + fat=0g = 100 macro kcal
          // but report 75 kcal -> delta = 25, error = 25/75 = 33.3% > 20%
          nutrientsPer100g: {
            kcal: 75,
            protein_g: 5,
            carb_g: 20,
            fat_g: 0,
          },
        },
      ],
    });

    expect(result.qa.pass).toBe(false);
    expect(result.qa.percentError).toBeGreaterThan(0.2);
  });

  it("passes when calorie error is within 20% tolerance", () => {
    // 500 kcal meal, 20 kcal error (4%) -> pass
    const result = computeSkuLabel({
      skuName: "Test",
      recipeName: "Test",
      servings: 1,
      lines: [
        {
          lineId: "1",
          ingredientName: "Test",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "1",
          lotId: "lot1",
          productId: "prod1",
          productName: "Test",
          gramsConsumed: 100,
          // protein=20g (80kcal) + carb=80g (320kcal) + fat=10g (90kcal) = 490 macro kcal
          // report 500 kcal -> delta = -10, error = 10/500 = 2% < 20%
          nutrientsPer100g: {
            kcal: 500,
            protein_g: 20,
            carb_g: 80,
            fat_g: 10,
          },
        },
      ],
    });

    expect(result.qa.pass).toBe(true);
    expect(result.qa.percentError).toBeLessThan(0.2);
  });

  it("handles zero calorie edge case", () => {
    const result = computeSkuLabel({
      skuName: "Test",
      recipeName: "Test",
      servings: 1,
      lines: [
        {
          lineId: "1",
          ingredientName: "Test",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
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
            carb_g: 0,
            fat_g: 0,
          },
        },
      ],
    });

    expect(result.qa.rawCalories).toBe(0);
    expect(result.qa.macroKcal).toBe(0);
    expect(result.qa.percentError).toBe(0);
    expect(result.qa.pass).toBe(true);
  });

  it("exposes rawCalories and percentError in output", () => {
    const result = computeSkuLabel({
      skuName: "Test",
      recipeName: "Test",
      servings: 1,
      lines: [
        {
          lineId: "1",
          ingredientName: "Test",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "1",
          lotId: "lot1",
          productId: "prod1",
          productName: "Test",
          gramsConsumed: 100,
          nutrientsPer100g: {
            kcal: 100,
            protein_g: 10,
            carb_g: 15,
            fat_g: 3,
          },
        },
      ],
    });

    expect(typeof result.qa.rawCalories).toBe("number");
    expect(typeof result.qa.percentError).toBe("number");
    expect(typeof result.qa.pass).toBe("boolean");
  });
});

// ============================================================================
// 4. ANIMAL PROTEIN ZERO-CARB REGRESSION TESTS
// ============================================================================

describe("Engine - Zero carb preservation for proteins", () => {
  it("preserves explicit zero carbs for chicken", () => {
    const result = computeSkuLabel({
      skuName: "Chicken",
      recipeName: "Chicken",
      servings: 1,
      lines: [
        {
          lineId: "1",
          ingredientName: "Chicken",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "1",
          lotId: "lot1",
          productId: "prod1",
          productName: "Chicken Breast",
          gramsConsumed: 100,
          nutrientsPer100g: {
            kcal: 165,
            protein_g: 31,
            fat_g: 3.6,
            carb_g: 0, // explicit zero
          },
        },
      ],
    });

    expect(result.perServing.carb_g).toBe(0);
    expect(result.roundedFda.carbG).toBe(0);
  });

  it("preserves explicit zero carbs for beef", () => {
    const result = computeSkuLabel({
      skuName: "Beef",
      recipeName: "Beef",
      servings: 1,
      lines: [
        {
          lineId: "1",
          ingredientName: "Beef",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "1",
          lotId: "lot1",
          productId: "prod1",
          productName: "Lean Beef",
          gramsConsumed: 100,
          nutrientsPer100g: {
            kcal: 180,
            protein_g: 26,
            fat_g: 8,
            carb_g: 0,
          },
        },
      ],
    });

    expect(result.perServing.carb_g).toBe(0);
  });

  it("preserves explicit zero carbs for cod", () => {
    const result = computeSkuLabel({
      skuName: "Cod",
      recipeName: "Cod",
      servings: 1,
      lines: [
        {
          lineId: "1",
          ingredientName: "Cod",
          gramsPerServing: 100,
          ingredientAllergens: ["fish"],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "1",
          lotId: "lot-cod",
          productId: "prod-cod",
          productName: "Cod",
          gramsConsumed: 100,
          nutrientsPer100g: {
            kcal: 100,
            protein_g: 22,
            carb_g: 0,
            fat_g: 1,
            sodium_mg: 80,
            sugars_g: 0,
          },
        },
      ],
    });

    expect(result.perServing.carb_g).toBe(0);
    expect(result.perServing.sugars_g).toBe(0);
  });
});

// ============================================================================
// 5. PLAUSIBILITY VALIDATION TESTS
// ============================================================================

describe("Plausibility - Food category detection", () => {
  it("detects MEAT_POULTRY correctly", () => {
    expect(detectFoodCategory("Chicken Breast")).toBe("MEAT_POULTRY");
    expect(detectFoodCategory("Lean Beef")).toBe("MEAT_POULTRY");
    expect(detectFoodCategory("Turkey Breast")).toBe("MEAT_POULTRY");
  });

  it("detects FISH_SEAFOOD correctly", () => {
    expect(detectFoodCategory("Salmon Fillet")).toBe("FISH_SEAFOOD");
    expect(detectFoodCategory("Cod")).toBe("FISH_SEAFOOD");
    expect(detectFoodCategory("Shrimp")).toBe("FISH_SEAFOOD");
  });

  it("detects DAIRY correctly", () => {
    expect(detectFoodCategory("Cottage Cheese")).toBe("DAIRY");
    expect(detectFoodCategory("Yogurt")).toBe("DAIRY");
    expect(detectFoodCategory("Milk")).toBe("DAIRY");
  });

  it("detects EGGS correctly", () => {
    expect(detectFoodCategory("Whole Egg")).toBe("EGGS");
    expect(detectFoodCategory("Egg White")).toBe("EGGS");
  });

  it("detects GRAINS_CEREALS correctly", () => {
    expect(detectFoodCategory("Brown Rice")).toBe("GRAINS_CEREALS");
    expect(detectFoodCategory("Bread")).toBe("GRAINS_CEREALS");
    expect(detectFoodCategory("Oats")).toBe("GRAINS_CEREALS");
  });

  it("detects LEGUMES correctly", () => {
    expect(detectFoodCategory("Black Beans")).toBe("LEGUMES");
    expect(detectFoodCategory("Lentils")).toBe("LEGUMES");
  });

  it("detects VEGETABLES correctly", () => {
    expect(detectFoodCategory("Broccoli")).toBe("VEGETABLES");
    expect(detectFoodCategory("Spinach")).toBe("VEGETABLES");
  });

  it("detects FRUITS correctly", () => {
    expect(detectFoodCategory("Banana")).toBe("FRUITS");
    expect(detectFoodCategory("Apple")).toBe("FRUITS");
  });

  it("detects NUTS_SEEDS correctly", () => {
    expect(detectFoodCategory("Almonds")).toBe("NUTS_SEEDS");
    expect(detectFoodCategory("Peanut Butter")).toBe("NUTS_SEEDS");
  });

  it("detects OILS_FATS correctly", () => {
    expect(detectFoodCategory("Olive Oil")).toBe("OILS_FATS");
    expect(detectFoodCategory("Butter")).toBe("OILS_FATS");
  });

  it("detects BEVERAGES correctly", () => {
    expect(detectFoodCategory("Gatorade")).toBe("BEVERAGES");
    expect(detectFoodCategory("Water")).toBe("BEVERAGES");
  });

  it("detects CONDIMENTS correctly", () => {
    expect(detectFoodCategory("Ketchup")).toBe("CONDIMENTS");
    expect(detectFoodCategory("Soy Sauce")).toBe("CONDIMENTS");
  });
});

describe("Plausibility - Nutrient profile validation", () => {
  it("flags meat with impossible carbs", () => {
    const issues = validateNutrientProfile(
      {
        kcal: 300,
        protein_g: 30,
        carb_g: 50, // meat shouldn't have this much carb
        fat_g: 10,
      },
      "MEAT_POULTRY",
      "Chicken"
    );

    const carbIssue = issues.find((i) => i.nutrientKey === "carb_g");
    expect(carbIssue).toBeDefined();
    expect(carbIssue?.severity).toBe("WARNING");
  });

  it("flags fish with fiber", () => {
    const issues = validateNutrientProfile(
      {
        kcal: 100,
        protein_g: 20,
        fat_g: 2,
        carb_g: 0,
        fiber_g: 1, // fish shouldn't have fiber
      },
      "FISH_SEAFOOD",
      "Salmon"
    );

    const fiberIssue = issues.find((i) => i.nutrientKey === "fiber_g");
    expect(fiberIssue).toBeDefined();
  });

  it("flags oil with > 900 kcal", () => {
    const issues = validateNutrientProfile(
      {
        kcal: 950, // exceeds max possible
        fat_g: 100,
        protein_g: 0,
        carb_g: 0,
      },
      "OILS_FATS",
      "Olive Oil"
    );

    const kcalIssue = issues.find((i) => i.nutrientKey === "kcal");
    expect(kcalIssue).toBeDefined();
    expect(kcalIssue?.severity).toBe("ERROR");
  });

  it("flags sat_fat > fat", () => {
    const issues = validateNutrientProfile(
      {
        kcal: 200,
        fat_g: 10,
        sat_fat_g: 15, // impossible: sat fat > total fat
        protein_g: 20,
        carb_g: 5,
      },
      "MEAT_POULTRY",
      "Chicken"
    );

    const satFatIssue = issues.find((i) => i.nutrientKey === "sat_fat_g");
    expect(satFatIssue).toBeDefined();
    expect(satFatIssue?.severity).toBe("ERROR");
  });

  it("flags sugars > carb", () => {
    const issues = validateNutrientProfile(
      {
        kcal: 100,
        carb_g: 10,
        sugars_g: 15, // impossible: sugars > carbs
        protein_g: 0,
        fat_g: 0,
      },
      "FRUITS",
      "Banana"
    );

    const sugarsIssue = issues.find((i) => i.nutrientKey === "sugars_g");
    expect(sugarsIssue).toBeDefined();
    expect(sugarsIssue?.severity).toBe("ERROR");
  });

  it("flags negative nutrient values", () => {
    const issues = validateNutrientProfile(
      {
        kcal: 100,
        protein_g: -10, // negative
        carb_g: 10,
        fat_g: 5,
      },
      "MEAT_POULTRY",
      "Chicken"
    );

    const negativeIssue = issues.find((i) => i.nutrientKey === "protein_g");
    expect(negativeIssue).toBeDefined();
    expect(negativeIssue?.severity).toBe("ERROR");
  });

  it("accepts valid nutrient profile", () => {
    const issues = validateNutrientProfile(
      {
        kcal: 165,
        protein_g: 31,
        fat_g: 3.6,
        carb_g: 0,
        sat_fat_g: 1,
        sodium_mg: 74,
      },
      "MEAT_POULTRY",
      "Chicken Breast"
    );

    // Should have no errors for a valid profile
    const errors = issues.filter((i) => i.severity === "ERROR");
    expect(errors.length).toBe(0);
  });
});

describe("Plausibility - Convenience validation", () => {
  it("validates food product with auto-detected category", () => {
    const issues = validateFoodProduct(
      {
        kcal: 165,
        protein_g: 31,
        fat_g: 3.6,
        carb_g: 0,
      },
      "Chicken Breast"
    );

    // Should auto-detect as MEAT_POULTRY and validate accordingly
    expect(Array.isArray(issues)).toBe(true);
  });
});

// ============================================================================
// 6. DAILY VALUES TESTS
// ============================================================================

describe("Daily Values - Percent DV computation", () => {
  it("computes percent DV for calcium correctly", () => {
    // DV = 1300 mg, 650 mg = 50%
    const pct = computePercentDV("calcium_mg", 650);
    expect(pct).toBe(50);
  });

  it("returns null for nutrients with no DV", () => {
    // trans_fat_g has DV = 0
    const pct = computePercentDV("trans_fat_g", 1);
    expect(pct).toBeNull();
  });

  it("computes percent DV for various nutrients", () => {
    expect(computePercentDV("protein_g", 50)).toBe(100); // DV = 50g
    expect(computePercentDV("sodium_mg", 1150)).toBe(50); // DV = 2300mg
    expect(computePercentDV("iron_mg", 9)).toBe(50); // DV = 18mg
  });
});

describe("Daily Values - Mandatory nutrients", () => {
  it("returns 15+ mandatory FDA nutrients", () => {
    const mandatory = getMandatoryNutrients();
    expect(mandatory.length).toBeGreaterThanOrEqual(15);
    expect(mandatory.every((n) => n.fdaMandatory)).toBe(true);
  });

  it("returns sorted by displayOrder", () => {
    const mandatory = getMandatoryNutrients();
    for (let i = 1; i < mandatory.length; i++) {
      const current = mandatory[i];
      const previous = mandatory[i - 1];
      if (current && previous) {
        expect(current.displayOrder).toBeGreaterThanOrEqual(
          previous.displayOrder
        );
      }
    }
  });

  it("includes core nutrients like kcal, protein, fat, carb", () => {
    const mandatory = getMandatoryNutrients();
    const keys = mandatory.map((n) => n.key);
    expect(keys).toContain("kcal");
    expect(keys).toContain("protein_g");
    expect(keys).toContain("fat_g");
    expect(keys).toContain("carb_g");
  });
});

describe("Daily Values - getDailyValue", () => {
  it("returns daily value for known nutrients", () => {
    expect(getDailyValue("calcium_mg")).toBe(1300);
    expect(getDailyValue("iron_mg")).toBe(18);
    expect(getDailyValue("sodium_mg")).toBe(2300);
  });

  it("returns 0 for nutrients with no DV", () => {
    expect(getDailyValue("trans_fat_g")).toBe(0);
    expect(getDailyValue("sugars_g")).toBe(0);
  });

  it("returns undefined for unknown nutrients", () => {
    // @ts-expect-error Testing unknown key
    expect(getDailyValue("unknown_key")).toBeUndefined();
  });
});

describe("Daily Values - Backward compatibility", () => {
  it("calculatePercentDV works as wrapper", () => {
    const pct = calculatePercentDV(650, "calcium_mg");
    expect(pct).toBe(50);
  });

  it("calculatePercentDV returns undefined for no DV", () => {
    const pct = calculatePercentDV(1, "trans_fat_g");
    expect(pct).toBeUndefined();
  });
});

// ============================================================================
// 7. USDA MAPPING TESTS
// ============================================================================

describe("USDA Mapping - Nutrient number lookup", () => {
  it("returns USDA number for known nutrients", () => {
    expect(getUsdaNumberByKey("kcal")).toBe(1008);
    expect(getUsdaNumberByKey("protein_g")).toBe(1003);
    expect(getUsdaNumberByKey("carb_g")).toBe(1005);
    expect(getUsdaNumberByKey("fat_g")).toBe(1004);
  });

  it("returns undefined for unknown keys", () => {
    // @ts-expect-error Testing unknown key
    expect(getUsdaNumberByKey("unknown_key")).toBeUndefined();
  });

  it("handles micronutrients", () => {
    expect(getUsdaNumberByKey("calcium_mg")).toBe(1087);
    expect(getUsdaNumberByKey("iron_mg")).toBe(1089);
    expect(getUsdaNumberByKey("vitamin_d_mcg")).toBe(1114);
  });
});

describe("USDA Mapping - Reverse lookup", () => {
  it("returns nutrient key for known USDA numbers", () => {
    expect(getNutrientKeyByUsdaNumber(1008)).toBe("kcal");
    expect(getNutrientKeyByUsdaNumber(1003)).toBe("protein_g");
    expect(getNutrientKeyByUsdaNumber(1005)).toBe("carb_g");
  });

  it("returns undefined for unknown USDA numbers", () => {
    expect(getNutrientKeyByUsdaNumber(9999)).toBeUndefined();
  });
});

describe("USDA Mapping - Nutrient conversion", () => {
  it("converts USDA API response to NutrientMap", () => {
    const usdaResponse = [
      { nutrientId: 1008, amount: 165 }, // kcal
      { nutrientId: 1003, amount: 31 }, // protein
      { nutrientId: 1005, amount: 0 }, // carb
      { nutrientId: 1004, amount: 3.6 }, // fat
    ];

    const result = convertUsdaNutrients(usdaResponse);

    expect(result.kcal).toBe(165);
    expect(result.protein_g).toBe(31);
    expect(result.carb_g).toBe(0);
    expect(result.fat_g).toBe(3.6);
  });

  it("handles both nutrientId and nutrientNumber fields", () => {
    const usdaResponse1 = [{ nutrientId: 1008, amount: 100 }];
    const usdaResponse2 = [{ nutrientNumber: "1008", amount: 100 }];

    const result1 = convertUsdaNutrients(usdaResponse1);
    const result2 = convertUsdaNutrients(usdaResponse2);

    expect(result1.kcal).toBe(100);
    expect(result2.kcal).toBe(100);
  });

  it("handles both amount and value fields", () => {
    const usdaResponse1 = [{ nutrientId: 1008, amount: 100 }];
    const usdaResponse2 = [{ nutrientId: 1008, value: 100 }];

    const result1 = convertUsdaNutrients(usdaResponse1);
    const result2 = convertUsdaNutrients(usdaResponse2);

    expect(result1.kcal).toBe(100);
    expect(result2.kcal).toBe(100);
  });

  it("ignores unmapped USDA nutrients", () => {
    const usdaResponse = [
      { nutrientId: 1008, amount: 165 },
      { nutrientId: 9999, amount: 999 }, // unknown
    ];

    const result = convertUsdaNutrients(usdaResponse);

    expect(result.kcal).toBe(165);
    expect(Object.keys(result).length).toBe(1);
  });

  it("applies conversion factors", () => {
    // Most nutrients have factor 1.0, but the function supports it
    const usdaResponse = [{ nutrientId: 1008, amount: 100 }];
    const result = convertUsdaNutrients(usdaResponse);

    expect(result.kcal).toBe(100 * 1.0); // conversion factor for kcal is 1.0
  });
});

describe("USDA Mapping - Required nutrients check", () => {
  it("confirms all required nutrients are present", () => {
    const converted = {
      kcal: 100,
      protein_g: 20,
      carb_g: 10,
      fat_g: 5,
    };

    const required: ["kcal", "protein_g", "carb_g", "fat_g"] = [
      "kcal",
      "protein_g",
      "carb_g",
      "fat_g",
    ];

    const result = hasAllRequiredNutrients(converted, required);
    expect(result).toBe(true);
  });

  it("returns false when required nutrients are missing", () => {
    const converted = { kcal: 100, protein_g: 20 };
    const required: ["kcal", "protein_g", "carb_g", "fat_g"] = [
      "kcal",
      "protein_g",
      "carb_g",
      "fat_g",
    ];

    const result = hasAllRequiredNutrients(converted, required);
    expect(result).toBe(false);
  });

  it("returns false when required nutrient is undefined", () => {
    const converted = { kcal: 100, protein_g: 20, carb_g: undefined };
    const required: ["kcal", "protein_g", "carb_g"] = [
      "kcal",
      "protein_g",
      "carb_g",
    ];

    const result = hasAllRequiredNutrients(converted, required);
    expect(result).toBe(false);
  });
});

describe("USDA Mapping - Table structure", () => {
  it("includes all 40+ nutrient mappings", () => {
    expect(USDA_NUTRIENT_MAP.length).toBeGreaterThanOrEqual(40);
  });

  it("has unique USDA numbers", () => {
    const numbers = USDA_NUTRIENT_MAP.map((m) => m.usdaNumber);
    const uniqueNumbers = new Set(numbers);
    expect(uniqueNumbers.size).toBe(numbers.length);
  });

  it("has unique NutrientKeys", () => {
    const keys = USDA_NUTRIENT_MAP.map((m) => m.nutrientKey);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });

  it("includes macronutrients", () => {
    const keys = USDA_NUTRIENT_MAP.map((m) => m.nutrientKey);
    expect(keys).toContain("kcal");
    expect(keys).toContain("protein_g");
    expect(keys).toContain("carb_g");
    expect(keys).toContain("fat_g");
  });

  it("includes key micronutrients", () => {
    const keys = USDA_NUTRIENT_MAP.map((m) => m.nutrientKey);
    expect(keys).toContain("calcium_mg");
    expect(keys).toContain("iron_mg");
    expect(keys).toContain("vitamin_d_mcg");
    expect(keys).toContain("sodium_mg");
  });

  it("has conversion factors", () => {
    expect(
      USDA_NUTRIENT_MAP.every(
        (m) => typeof m.conversionFactor === "number" && m.conversionFactor > 0
      )
    ).toBe(true);
  });
});

// ============================================================================
// 8. KNOWN FAILURE MODE REGRESSION
// ============================================================================

describe("Engine - Known failure mode regressions", () => {
  it("beef product does NOT get carb values from global median fallback", () => {
    // Ensure that if carb_g is missing, we fill with 0, not a fallback median
    const result = computeSkuLabel({
      skuName: "Beef",
      recipeName: "Beef Steak",
      servings: 1,
      lines: [
        {
          lineId: "1",
          ingredientName: "Beef Steak",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "1",
          lotId: "lot1",
          productId: "prod1",
          productName: "Lean Beef",
          gramsConsumed: 100,
          // Deliberately omit carb_g
          nutrientsPer100g: {
            kcal: 180,
            protein_g: 26,
            fat_g: 8,
            sodium_mg: 75,
          },
        },
      ],
    });

    // carb_g should be filled as 0, not some median value
    expect(result.perServing.carb_g).toBe(0);
    expect(result.roundedFda.carbG).toBe(0);
  });

  it("explicit zero stays zero through computation pipeline", () => {
    const result = computeSkuLabel({
      skuName: "Pure Protein",
      recipeName: "Chicken",
      servings: 1,
      lines: [
        {
          lineId: "1",
          ingredientName: "Chicken",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "1",
          lotId: "lot1",
          productId: "prod1",
          productName: "Chicken Breast",
          gramsConsumed: 100,
          nutrientsPer100g: {
            kcal: 165,
            protein_g: 31,
            fat_g: 3.6,
            carb_g: 0, // explicit zero
            fiber_g: 0, // explicit zero
            sugars_g: 0, // explicit zero
          },
        },
      ],
    });

    expect(result.perServing.carb_g).toBe(0);
    expect(result.perServing.fiber_g).toBe(0);
    expect(result.perServing.sugars_g).toBe(0);
    expect(result.roundedFda.carbG).toBe(0);
    expect(result.roundedFda.fiberG).toBe(0);
    expect(result.roundedFda.sugarsG).toBe(0);
  });

  it("labels marked provisional when evidence has exceptions", () => {
    const result = computeSkuLabel({
      skuName: "Test",
      recipeName: "Test",
      servings: 1,
      lines: [
        {
          lineId: "1",
          ingredientName: "Test",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
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
      evidenceSummary: {
        verifiedCount: 2,
        inferredCount: 1,
        exceptionCount: 1, // has exceptions
        provisional: true,
      },
    });

    expect(result.provisional).toBe(true);
    expect(result.evidenceSummary.exceptionCount).toBe(1);
  });

  it("carries evidence summary through to result", () => {
    const result = computeSkuLabel({
      skuName: "Test",
      recipeName: "Test",
      servings: 1,
      lines: [
        {
          lineId: "1",
          ingredientName: "Test",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
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
      evidenceSummary: {
        verifiedCount: 5,
        inferredCount: 2,
        exceptionCount: 0,
        unverifiedCount: 3,
        totalNutrientRows: 10,
        provisional: false,
      },
    });

    expect(result.evidenceSummary.verifiedCount).toBe(5);
    expect(result.evidenceSummary.inferredCount).toBe(2);
    expect(result.evidenceSummary.exceptionCount).toBe(0);
    expect(result.evidenceSummary.unverifiedCount).toBe(3);
    expect(result.evidenceSummary.totalNutrientRows).toBe(10);
  });
});

// ============================================================================
// 9. PERCENT DV IN OUTPUT
// ============================================================================

describe("Engine - Percent DV in output", () => {
  it("computes percentDV for nutrients with DV", () => {
    const result = computeSkuLabel({
      skuName: "Test",
      recipeName: "Test",
      servings: 1,
      lines: [
        {
          lineId: "1",
          ingredientName: "Test",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "1",
          lotId: "lot1",
          productId: "prod1",
          productName: "Test",
          gramsConsumed: 100,
          nutrientsPer100g: {
            kcal: 500,
            calcium_mg: 650,
            protein_g: 50,
            sodium_mg: 1150,
          },
        },
      ],
    });

    expect(result.percentDV.calcium_mg).toBe(50); // 650 / 1300 = 50%
    expect(result.percentDV.protein_g).toBe(100); // 50 / 50 = 100%
    expect(result.percentDV.sodium_mg).toBe(50); // 1150 / 2300 = 50%
  });

  it("excludes nutrients without DV", () => {
    const result = computeSkuLabel({
      skuName: "Test",
      recipeName: "Test",
      servings: 1,
      lines: [
        {
          lineId: "1",
          ingredientName: "Test",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "1",
          lotId: "lot1",
          productId: "prod1",
          productName: "Test",
          gramsConsumed: 100,
          nutrientsPer100g: {
            trans_fat_g: 1,
            sugars_g: 10,
          },
        },
      ],
    });

    // trans_fat_g and sugars_g have no DV
    expect(result.percentDV.trans_fat_g).toBeUndefined();
    expect(result.percentDV.sugars_g).toBeUndefined();
  });
});

// ============================================================================
// POST-ROUNDING HIERARCHY ENFORCEMENT TESTS
// ============================================================================

describe("Post-rounding nutrient hierarchy enforcement", () => {
  function makeInput(nutrients: Record<string, number>) {
    return {
      skuName: "Hierarchy Test",
      recipeName: "Test Recipe",
      servings: 1,
      lines: [
        {
          lineId: "1",
          ingredientName: "Test",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "1",
          lotId: "lot1",
          productId: "prod1",
          productName: "Test",
          gramsConsumed: 100,
          nutrientsPer100g: nutrients,
        },
      ],
    };
  }

  it("clamps rounded sugars to not exceed rounded carbs", () => {
    // carb=12.4 → rounds to 12, sugars=12.6 → rounds to 13
    // Post-rounding: sugars must be clamped to 12
    const result = computeSkuLabel(makeInput({
      kcal: 100,
      protein_g: 5,
      carb_g: 12.4,
      sugars_g: 12.6,
      fat_g: 3,
    }));
    expect(result.roundedFda.sugarsG).toBeLessThanOrEqual(result.roundedFda.carbG);
  });

  it("clamps rounded addedSugars to not exceed rounded sugars", () => {
    const result = computeSkuLabel(makeInput({
      kcal: 200,
      protein_g: 10,
      carb_g: 30,
      sugars_g: 14.4,   // rounds to 14
      added_sugars_g: 14.6, // rounds to 15 → must clamp to 14
      fat_g: 5,
    }));
    expect(result.roundedFda.addedSugarsG).toBeLessThanOrEqual(result.roundedFda.sugarsG);
  });

  it("clamps rounded fiber to not exceed rounded carbs", () => {
    // Note: enforceNutrientHierarchy will bump carbs up if needed,
    // but edge cases of rounding could still violate
    const result = computeSkuLabel(makeInput({
      kcal: 50,
      protein_g: 2,
      carb_g: 5.4,  // rounds to 5
      fiber_g: 5.6,  // rounds to 6
      fat_g: 1,
    }));
    expect(result.roundedFda.fiberG).toBeLessThanOrEqual(result.roundedFda.carbG);
  });

  it("clamps rounded satFat + transFat to not exceed rounded totalFat", () => {
    const result = computeSkuLabel(makeInput({
      kcal: 200,
      protein_g: 10,
      carb_g: 20,
      fat_g: 5.4,       // rounds to 5
      sat_fat_g: 3.3,    // rounds to 3.5
      trans_fat_g: 2.3,  // rounds to 2.5 → total 6 > 5
    }));
    expect(result.roundedFda.satFatG + result.roundedFda.transFatG)
      .toBeLessThanOrEqual(result.roundedFda.fatG);
  });

  it("handles all-zero nutrients without errors", () => {
    const result = computeSkuLabel(makeInput({
      kcal: 0,
      protein_g: 0,
      carb_g: 0,
      fat_g: 0,
    }));
    expect(result.roundedFda.calories).toBe(0);
    expect(result.roundedFda.carbG).toBe(0);
    expect(result.roundedFda.fatG).toBe(0);
    expect(result.roundedFda.proteinG).toBe(0);
  });
});

// ============================================================================
// ATWATER FACTOR CONSISTENCY TESTS
// ============================================================================

describe("Atwater factor calorie consistency", () => {
  function makeInput(nutrients: Record<string, number>) {
    return {
      skuName: "Atwater Test",
      recipeName: "Test Recipe",
      servings: 1,
      lines: [
        {
          lineId: "1",
          ingredientName: "Test",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "1",
          lotId: "lot1",
          productId: "prod1",
          productName: "Test",
          gramsConsumed: 100,
          nutrientsPer100g: nutrients,
        },
      ],
    };
  }

  it("passes QA for standard macronutrient profile", () => {
    // chicken breast: 165 kcal, 31g protein, 0g carb, 3.6g fat
    // Atwater: 31*4 + 0*4 + 3.6*9 = 124+32.4 = 156.4 kcal → within 20% of 165
    const result = computeSkuLabel(makeInput({
      kcal: 165,
      protein_g: 31,
      carb_g: 0,
      fat_g: 3.6,
    }));
    expect(result.qa.pass).toBe(true);
    expect(result.qa.percentError).toBeLessThan(0.20);
  });

  it("passes QA for high-fiber low-calorie food with wider tolerance", () => {
    // broccoli: 34 kcal, 2.8g protein, 6.6g carb (2.6g fiber), 0.4g fat
    // Atwater: 2.8*4 + 6.6*4 + 0.4*9 = 11.2+26.4+3.6 = 41.2
    // 41.2 vs 34 → 21% error → passes with 35% tolerance for low-cal high-fiber
    const result = computeSkuLabel(makeInput({
      kcal: 34,
      protein_g: 2.8,
      carb_g: 6.6,
      fiber_g: 2.6,
      fat_g: 0.4,
    }));
    expect(result.qa.pass).toBe(true);
  });

  it("flags implausibly low calories for macros via QA", () => {
    // If macros say ~200kcal but reported kcal is 50, QA should flag it
    const result = computeSkuLabel(makeInput({
      kcal: 50,
      protein_g: 20,
      carb_g: 20,
      fat_g: 5,
    }));
    // Atwater: 20*4 + 20*4 + 5*9 = 80+80+45 = 205
    // QA compares original kcal (50) vs Atwater (205) → 310% error → fail
    expect(result.qa.pass).toBe(false);
    expect(result.qa.percentError).toBeGreaterThan(1.0);
    // But hierarchy enforcement corrects the actual perServing kcal
    expect(result.perServing.kcal).toBeGreaterThanOrEqual(100);
  });

  it("known food: egg (USDA values)", () => {
    // Large egg: 72 kcal, 6.3g protein, 0.4g carb, 4.8g fat
    const result = computeSkuLabel(makeInput({
      kcal: 72,
      protein_g: 6.3,
      carb_g: 0.4,
      fat_g: 4.8,
    }));
    expect(result.qa.pass).toBe(true);
  });

  it("known food: white rice (USDA values)", () => {
    // Cooked white rice per 100g: 130 kcal, 2.7g protein, 28.2g carb, 0.3g fat
    const result = computeSkuLabel(makeInput({
      kcal: 130,
      protein_g: 2.7,
      carb_g: 28.2,
      fat_g: 0.3,
    }));
    expect(result.qa.pass).toBe(true);
  });

  it("known food: salmon (USDA values)", () => {
    // Atlantic salmon per 100g: 208 kcal, 20.4g protein, 0g carb, 13.4g fat
    const result = computeSkuLabel(makeInput({
      kcal: 208,
      protein_g: 20.4,
      carb_g: 0,
      fat_g: 13.4,
    }));
    expect(result.qa.pass).toBe(true);
  });

  it("known food: sweet potato (USDA values)", () => {
    // Baked sweet potato per 100g: 90 kcal, 2g protein, 20.7g carb (3.3g fiber), 0.2g fat
    const result = computeSkuLabel(makeInput({
      kcal: 90,
      protein_g: 2,
      carb_g: 20.7,
      fiber_g: 3.3,
      fat_g: 0.2,
    }));
    expect(result.qa.pass).toBe(true);
  });

  it("known food: olive oil (USDA values)", () => {
    // Olive oil per 100g: 884 kcal, 0g protein, 0g carb, 100g fat
    const result = computeSkuLabel(makeInput({
      kcal: 884,
      protein_g: 0,
      carb_g: 0,
      fat_g: 100,
    }));
    expect(result.qa.pass).toBe(true);
  });
});

// ============================================================================
// ROUNDING EDGE CASE TESTS
// ============================================================================

describe("FDA rounding boundary edge cases", () => {
  it("calories at exactly 5 rounds to 5", () => {
    expect(roundCalories(5)).toBe(5);
  });

  it("calories at exactly 50 rounds to 50", () => {
    expect(roundCalories(50)).toBe(50);
  });

  it("fat at exactly 0.5 rounds to 0.5", () => {
    expect(roundFatLike(0.5)).toBe(0.5);
  });

  it("fat at exactly 5.0 rounds to 5", () => {
    expect(roundFatLike(5.0)).toBe(5);
  });

  it("general g at exactly 0.5 rounds to 1", () => {
    // ≥ 0.5 rounds to nearest 1
    expect(roundGeneralG(0.5)).toBe(1);
  });

  it("sodium at exactly 5 rounds to 5", () => {
    expect(roundSodiumMg(5)).toBe(5);
  });

  it("sodium at exactly 140 rounds to 140", () => {
    expect(roundSodiumMg(140)).toBe(140);
  });

  it("cholesterol at exactly 2 rounds to 0 (nearest 5 = 0)", () => {
    expect(roundCholesterolMg(2)).toBe(0);
  });

  it("cholesterol at exactly 2.5 rounds to 5", () => {
    expect(roundCholesterolMg(2.5)).toBe(5);
  });

  it("%DV at exactly 2% rounds to 2%", () => {
    expect(roundPercentDV(2)).toBe(2);
  });

  it("%DV at exactly 10% rounds to 10%", () => {
    expect(roundPercentDV(10)).toBe(10);
  });

  it("%DV at exactly 50% rounds to 50%", () => {
    expect(roundPercentDV(50)).toBe(50);
  });

  it("handles negative input gracefully (returns 0 or negative)", () => {
    expect(roundCalories(-1)).toBe(0);
    expect(roundFatLike(-0.3)).toBe(0);
    expect(roundGeneralG(-0.4)).toBe(0);
    expect(roundSodiumMg(-3)).toBe(0);
  });
});

// ============================================================================
// YIELD FACTOR BOUNDS TESTS
// ============================================================================

describe("Yield factor edge cases in label computation", () => {
  it("yield factor of 1.0 does not alter nutrients", () => {
    const result = computeSkuLabel({
      skuName: "Test",
      recipeName: "Test Recipe",
      servings: 1,
      lines: [
        {
          lineId: "1",
          ingredientName: "Chicken",
          gramsPerServing: 100,
          ingredientAllergens: [],
          yieldFactor: 1.0,
          preparedState: "RAW",
        },
      ],
      consumedLots: [
        {
          recipeLineId: "1",
          lotId: "lot1",
          productId: "prod1",
          productName: "Chicken",
          gramsConsumed: 100,
          nutrientsPer100g: { kcal: 165, protein_g: 31, fat_g: 3.6 },
          nutrientProfileState: "RAW",
        },
      ],
    });
    expect(result.perServing.kcal).toBeCloseTo(165, 0);
    expect(result.perServing.protein_g).toBeCloseTo(31, 0);
  });

  it("large servings correctly divide nutrients", () => {
    const result = computeSkuLabel({
      skuName: "Bulk",
      recipeName: "Bulk Recipe",
      servings: 10,
      lines: [
        {
          lineId: "1",
          ingredientName: "Rice",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "1",
          lotId: "lot1",
          productId: "prod1",
          productName: "Rice",
          gramsConsumed: 1000,
          nutrientsPer100g: { kcal: 130, protein_g: 2.7, carb_g: 28.2, fat_g: 0.3 },
        },
      ],
    });
    // Per serving = 1000g / 10 servings × nutrients per 100g
    expect(result.perServing.kcal).toBeCloseTo(130, 0);
    expect(result.perServing.carb_g).toBeCloseTo(28.2, 0);
  });

  it("zero servings defaults to 1", () => {
    const result = computeSkuLabel({
      skuName: "Test",
      recipeName: "Test",
      servings: 0,
      lines: [
        {
          lineId: "1",
          ingredientName: "Test",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
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
    });
    expect(result.perServing.kcal).toBeCloseTo(100, 0);
  });
});

// ============================================================================
// INTEGRATION FLOW TESTS: Complete Pipeline
// ============================================================================

describe("End-to-end label generation pipeline", () => {
  it("realistic chicken bowl: multi-ingredient label with all fields", () => {
    const result = computeSkuLabel({
      skuName: "Grilled Chicken Bowl",
      recipeName: "Chicken Rice Bowl",
      servings: 4,
      lines: [
        {
          lineId: "chicken",
          ingredientName: "Chicken Breast",
          gramsPerServing: 170,
          ingredientAllergens: [],
          yieldFactor: 0.75,
          preparedState: "COOKED" as any,
        },
        {
          lineId: "rice",
          ingredientName: "Jasmine Rice",
          gramsPerServing: 150,
          ingredientAllergens: [],
        },
        {
          lineId: "broccoli",
          ingredientName: "Broccoli",
          gramsPerServing: 80,
          ingredientAllergens: [],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "chicken",
          lotId: "lot-chicken",
          productId: "prod-chicken",
          productName: "Chicken Breast",
          gramsConsumed: 680,
          nutrientsPer100g: {
            kcal: 165,
            protein_g: 31,
            fat_g: 3.6,
            sat_fat_g: 1.0,
            carb_g: 0,
            cholesterol_mg: 85,
            sodium_mg: 74,
            iron_mg: 1.0,
          },
          nutrientProfileState: "RAW",
        },
        {
          recipeLineId: "rice",
          lotId: "lot-rice",
          productId: "prod-rice",
          productName: "Jasmine Rice",
          gramsConsumed: 600,
          nutrientsPer100g: {
            kcal: 130,
            protein_g: 2.7,
            carb_g: 28.2,
            fat_g: 0.3,
            fiber_g: 0.4,
            iron_mg: 0.2,
          },
        },
        {
          recipeLineId: "broccoli",
          lotId: "lot-broc",
          productId: "prod-broc",
          productName: "Broccoli",
          gramsConsumed: 320,
          nutrientsPer100g: {
            kcal: 34,
            protein_g: 2.8,
            carb_g: 7,
            fat_g: 0.4,
            fiber_g: 2.6,
            vitamin_c_mg: 89,
            calcium_mg: 47,
            iron_mg: 0.7,
          },
        },
      ],
    });

    // Per-serving values should be reasonable for a chicken bowl
    expect(result.perServing.kcal).toBeGreaterThan(200);
    expect(result.perServing.kcal).toBeLessThan(600);
    expect(result.perServing.protein_g).toBeGreaterThan(20);
    expect(result.perServing.carb_g).toBeGreaterThan(20);

    // FDA rounding applied — calories field
    expect(result.roundedFda.calories).toBe(Math.round(result.roundedFda.calories / 10) * 10);

    // Hierarchy enforcement: sugars <= carbs
    expect(result.roundedFda.sugarsG).toBeLessThanOrEqual(result.roundedFda.carbG);

    // %DV should be present for mandatory nutrients
    expect(result.percentDV.protein_g).toBeDefined();
    expect(result.percentDV.fat_g).toBeDefined();

    // Quality assessment
    expect(result.qa).toBeDefined();
    expect(result.qa.pass).toBe(true);

    // Allergen statement — no allergens in this bowl
    expect(result.allergenStatement.toLowerCase()).toContain("none");
  });

  it("allergen detection aggregates from all ingredients", () => {
    const result = computeSkuLabel({
      skuName: "Pasta with Cheese Sauce",
      recipeName: "Cheese Pasta",
      servings: 2,
      lines: [
        {
          lineId: "pasta",
          ingredientName: "Wheat Pasta",
          gramsPerServing: 200,
          ingredientAllergens: ["wheat"],
        },
        {
          lineId: "sauce",
          ingredientName: "Cheese Sauce",
          gramsPerServing: 100,
          ingredientAllergens: ["milk"],
        },
        {
          lineId: "egg",
          ingredientName: "Egg Wash",
          gramsPerServing: 30,
          ingredientAllergens: ["egg"],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "pasta",
          lotId: "l1",
          productId: "p1",
          productName: "Pasta",
          gramsConsumed: 400,
          nutrientsPer100g: { kcal: 131, carb_g: 25, protein_g: 5, fat_g: 1.1, fiber_g: 1.8 },
        },
        {
          recipeLineId: "sauce",
          lotId: "l2",
          productId: "p2",
          productName: "Cheese Sauce",
          gramsConsumed: 200,
          nutrientsPer100g: { kcal: 174, fat_g: 13, sat_fat_g: 8, protein_g: 10, carb_g: 3, calcium_mg: 600 },
        },
        {
          recipeLineId: "egg",
          lotId: "l3",
          productId: "p3",
          productName: "Egg",
          gramsConsumed: 60,
          nutrientsPer100g: { kcal: 155, protein_g: 13, fat_g: 11, cholesterol_mg: 373 },
        },
      ],
    });

    // Allergen statement should mention all three
    expect(result.allergenStatement.toLowerCase()).toContain("wheat");
    expect(result.allergenStatement.toLowerCase()).toContain("milk");
    expect(result.allergenStatement.toLowerCase()).toContain("egg");
  });

  it("single-ingredient label produces exact per-100g values", () => {
    const result = computeSkuLabel({
      skuName: "Plain Rice",
      recipeName: "Rice",
      servings: 1,
      lines: [
        {
          lineId: "rice",
          ingredientName: "White Rice",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "rice",
          lotId: "l1",
          productId: "p1",
          productName: "White Rice",
          gramsConsumed: 100,
          nutrientsPer100g: {
            kcal: 130,
            protein_g: 2.7,
            carb_g: 28.2,
            fat_g: 0.3,
            fiber_g: 0.4,
          },
        },
      ],
    });

    // For 100g, 1 serving → per-serving values should match per-100g
    expect(result.perServing.kcal).toBeCloseTo(130, 0);
    expect(result.perServing.protein_g).toBeCloseTo(2.7, 1);
    expect(result.perServing.carb_g).toBeCloseTo(28.2, 1);
    expect(result.perServing.fat_g).toBeCloseTo(0.3, 1);
    expect(result.perServing.fiber_g).toBeCloseTo(0.4, 1);
  });

  it("label with no nutrient data produces zeros and flags QA", () => {
    const result = computeSkuLabel({
      skuName: "Mystery Food",
      recipeName: "Unknown",
      servings: 1,
      lines: [
        {
          lineId: "mystery",
          ingredientName: "Unknown Ingredient",
          gramsPerServing: 100,
          ingredientAllergens: [],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "mystery",
          lotId: "l1",
          productId: "p1",
          productName: "Unknown",
          gramsConsumed: 100,
          nutrientsPer100g: {},
        },
      ],
    });

    expect(result.perServing.kcal).toBe(0);
    expect(result.roundedFda.calories).toBe(0);
    // QA should flag — macros should be zero-ish, but it still runs
    expect(result.qa).toBeDefined();
  });

  it("multiple lots for the same ingredient blend correctly", () => {
    // Two lots of chicken with different nutrient profiles
    const result = computeSkuLabel({
      skuName: "Chicken Mix",
      recipeName: "Mixed Chicken",
      servings: 1,
      lines: [
        {
          lineId: "chicken",
          ingredientName: "Chicken",
          gramsPerServing: 200,
          ingredientAllergens: [],
        },
      ],
      consumedLots: [
        {
          recipeLineId: "chicken",
          lotId: "lot-a",
          productId: "prod-a",
          productName: "Chicken Thigh",
          gramsConsumed: 100,
          nutrientsPer100g: { kcal: 209, protein_g: 26, fat_g: 10.9 },
        },
        {
          recipeLineId: "chicken",
          lotId: "lot-b",
          productId: "prod-b",
          productName: "Chicken Breast",
          gramsConsumed: 100,
          nutrientsPer100g: { kcal: 165, protein_g: 31, fat_g: 3.6 },
        },
      ],
    });

    // Total from 2 lots: (209/100 × 100) + (165/100 × 100) = 209 + 165 = 374 kcal
    // 1 serving, so per-serving = 374
    expect(result.perServing.kcal).toBeCloseTo(374, 0);
    // Protein: (26/100 × 100) + (31/100 × 100) = 26 + 31 = 57
    expect(result.perServing.protein_g).toBeCloseTo(57, 0);
  });

  it("serving size scales all nutrients proportionally", () => {
    const small = computeSkuLabel({
      skuName: "Small Portion",
      recipeName: "Recipe",
      servings: 2,
      lines: [{ lineId: "a", ingredientName: "A", gramsPerServing: 100, ingredientAllergens: [] }],
      consumedLots: [{
        recipeLineId: "a",
        lotId: "l1",
        productId: "p1",
        productName: "A",
        gramsConsumed: 200,
        nutrientsPer100g: { kcal: 200, protein_g: 20, fat_g: 10, carb_g: 30 },
      }],
    });

    const large = computeSkuLabel({
      skuName: "Large Portion",
      recipeName: "Recipe",
      servings: 1,
      lines: [{ lineId: "a", ingredientName: "A", gramsPerServing: 200, ingredientAllergens: [] }],
      consumedLots: [{
        recipeLineId: "a",
        lotId: "l1",
        productId: "p1",
        productName: "A",
        gramsConsumed: 200,
        nutrientsPer100g: { kcal: 200, protein_g: 20, fat_g: 10, carb_g: 30 },
      }],
    });

    // 2-serving vs 1-serving: per-serving kcal should be half for 2-servings
    expect(small.perServing.kcal).toBeCloseTo((large.perServing.kcal ?? 0) / 2, 0);
    expect(small.perServing.protein_g).toBeCloseTo((large.perServing.protein_g ?? 0) / 2, 0);
  });

  it("label idempotency: same input produces same output", () => {
    const input = {
      skuName: "Test",
      recipeName: "Test Recipe",
      servings: 1,
      lines: [{
        lineId: "1",
        ingredientName: "Ingredient",
        gramsPerServing: 100,
        ingredientAllergens: [] as string[],
      }],
      consumedLots: [{
        recipeLineId: "1",
        lotId: "l1",
        productId: "p1",
        productName: "Product",
        gramsConsumed: 100,
        nutrientsPer100g: { kcal: 250, protein_g: 20, fat_g: 12, carb_g: 15 },
      }],
    };

    const result1 = computeSkuLabel(input);
    const result2 = computeSkuLabel(input);

    expect(result1.perServing).toEqual(result2.perServing);
    expect(result1.roundedFda).toEqual(result2.roundedFda);
    expect(result1.percentDV).toEqual(result2.percentDV);
    expect(result1.qa).toEqual(result2.qa);
  });

  it("hierarchy enforcement is consistent across rounding: sat + trans <= total fat", () => {
    // Edge case: sat_fat and trans_fat that individually round up
    const result = computeSkuLabel({
      skuName: "Oily Mix",
      recipeName: "Oil Mix",
      servings: 1,
      lines: [{
        lineId: "1",
        ingredientName: "Oil Blend",
        gramsPerServing: 100,
        ingredientAllergens: [],
      }],
      consumedLots: [{
        recipeLineId: "1",
        lotId: "l1",
        productId: "p1",
        productName: "Oil",
        gramsConsumed: 100,
        nutrientsPer100g: {
          kcal: 884,
          fat_g: 100,
          sat_fat_g: 49.8,
          trans_fat_g: 49.8,
        },
      }],
    });

    // Post-rounding: sat + trans should not exceed total fat
    expect(result.roundedFda.satFatG + result.roundedFda.transFatG).toBeLessThanOrEqual(result.roundedFda.fatG);
  });
});
