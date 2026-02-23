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
