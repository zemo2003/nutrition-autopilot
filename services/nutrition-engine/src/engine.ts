import type { NutrientKey } from "@nutrition/contracts";
import {
  roundCalories,
  roundCholesterolMg,
  roundFatLike,
  roundGeneralG,
  roundSodiumMg,
  roundVitaminD,
  roundCalcium,
  roundIron,
  roundPotassium
} from "./rounding.js";
import { calculatePercentDV, getDailyValue } from "./daily-values.js";
import type { ConsumedLotInput, LabelComputationInput, LabelComputationResult, NutrientMap } from "./types.js";

const majorAllergens = [
  "milk",
  "egg",
  "fish",
  "shellfish",
  "tree_nuts",
  "peanuts",
  "wheat",
  "soy",
  "sesame"
] as const;

const allNutrientKeys: NutrientKey[] = [
  "kcal",
  "protein_g",
  "carb_g",
  "fat_g",
  "fiber_g",
  "sugars_g",
  "added_sugars_g",
  "sat_fat_g",
  "trans_fat_g",
  "cholesterol_mg",
  "sodium_mg",
  "vitamin_d_mcg",
  "calcium_mg",
  "iron_mg",
  "potassium_mg",
  "vitamin_a_mcg",
  "vitamin_c_mg",
  "vitamin_e_mg",
  "vitamin_k_mcg",
  "thiamin_mg",
  "riboflavin_mg",
  "niacin_mg",
  "vitamin_b6_mg",
  "folate_mcg",
  "vitamin_b12_mcg",
  "biotin_mcg",
  "pantothenic_acid_mg",
  "phosphorus_mg",
  "iodine_mcg",
  "magnesium_mg",
  "zinc_mg",
  "selenium_mcg",
  "copper_mg",
  "manganese_mg",
  "chromium_mcg",
  "molybdenum_mcg",
  "chloride_mg",
  "choline_mg",
  "omega3_g",
  "omega6_g"
];

function addScaledNutrients(target: NutrientMap, lot: ConsumedLotInput) {
  for (const key of Object.keys(lot.nutrientsPer100g) as NutrientKey[]) {
    const value = lot.nutrientsPer100g[key];
    if (typeof value !== "number") continue;
    target[key] = (target[key] ?? 0) + (value * lot.gramsConsumed) / 100;
  }
}

export function computeSkuLabel(input: LabelComputationInput): LabelComputationResult {
  const totalNutrients: NutrientMap = {};
  let totalWeight = 0;

  for (const lot of input.consumedLots) {
    totalWeight += lot.gramsConsumed;
    addScaledNutrients(totalNutrients, lot);
  }

  const servings = input.servings <= 0 ? 1 : input.servings;
  const perServing: NutrientMap = {};
  for (const key of Object.keys(totalNutrients) as NutrientKey[]) {
    const value = totalNutrients[key];
    if (typeof value !== "number") continue;
    perServing[key] = value / servings;
  }

  for (const key of allNutrientKeys) {
    if (typeof perServing[key] !== "number") {
      perServing[key] = 0;
    }
  }

  const roundedFda = {
    // Macronutrients
    calories: roundCalories(perServing.kcal ?? 0),
    fatG: roundFatLike(perServing.fat_g ?? 0),
    satFatG: roundFatLike(perServing.sat_fat_g ?? 0),
    transFatG: roundFatLike(perServing.trans_fat_g ?? 0),
    cholesterolMg: roundCholesterolMg(perServing.cholesterol_mg ?? 0),
    sodiumMg: roundSodiumMg(perServing.sodium_mg ?? 0),
    carbG: roundGeneralG(perServing.carb_g ?? 0),
    fiberG: roundGeneralG(perServing.fiber_g ?? 0),
    sugarsG: roundGeneralG(perServing.sugars_g ?? 0),
    addedSugarsG: roundGeneralG(perServing.added_sugars_g ?? 0),
    proteinG: roundGeneralG(perServing.protein_g ?? 0),
    // Micronutrients (FDA-rounded per 21 CFR 101.9(c)(8)(iv))
    vitaminDMcg: roundVitaminD(perServing.vitamin_d_mcg ?? 0),
    calciumMg: roundCalcium(perServing.calcium_mg ?? 0),
    ironMg: roundIron(perServing.iron_mg ?? 0),
    potassiumMg: roundPotassium(perServing.potassium_mg ?? 0)
  };

  const servingWeightG = totalWeight / servings;

  const ingredientDeclaration = `Ingredients: ${input.lines
    .slice()
    .sort((a, b) => b.gramsPerServing - a.gramsPerServing)
    .map((l) => l.ingredientName)
    .join(", ")}`;

  // Build ingredient breakdown with nutrient highlights
  const ingredientBreakdown = input.lines.map((line) => {
    // Find all consumed lots matching this recipe line
    const matchingLots = input.consumedLots.filter((lot) => lot.recipeLineId === line.lineId);

    // Aggregate nutrients for this ingredient
    const ingredientNutrients: NutrientMap = {};
    for (const lot of matchingLots) {
      addScaledNutrients(ingredientNutrients, lot);
    }

    // Scale by servings to get per-serving values
    const perServingNutrients: NutrientMap = {};
    for (const key of Object.keys(ingredientNutrients) as NutrientKey[]) {
      const value = ingredientNutrients[key];
      if (typeof value !== "number") continue;
      perServingNutrients[key] = value / servings;
    }

    const percentOfServing = servingWeightG > 0 ? (line.gramsPerServing / servingWeightG) * 100 : 0;

    return {
      ingredientName: line.ingredientName,
      gramsPerServing: line.gramsPerServing,
      percentOfServing,
      nutrientHighlights: {
        protein_g: perServingNutrients.protein_g ?? 0,
        fat_g: perServingNutrients.fat_g ?? 0,
        carb_g: perServingNutrients.carb_g ?? 0,
        kcal: perServingNutrients.kcal ?? 0
      }
    };
  }).sort((a, b) => b.gramsPerServing - a.gramsPerServing);

  const allergenSet = new Set<string>();
  for (const line of input.lines) {
    for (const tag of line.ingredientAllergens) {
      if (majorAllergens.includes(tag as (typeof majorAllergens)[number])) {
        allergenSet.add(tag);
      }
    }
  }
  const allergenStatement = allergenSet.size
    ? `Contains: ${Array.from(allergenSet)
        .map((x) => x.replace(/_/g, " "))
        .join(", ")}`
    : "Contains: None of the 9 major allergens";

  // BUG FIX 2: Calculate macroKcal from unrounded values vs compare to unrounded calories
  // This detects data entry errors, not rounding artifacts
  const macroKcal = (perServing.protein_g ?? 0) * 4 + (perServing.carb_g ?? 0) * 4 + (perServing.fat_g ?? 0) * 9;
  const rawCalories = perServing.kcal ?? 0;
  const delta = macroKcal - rawCalories;

  // BUG FIX 1: Use FDA Class I tolerance of ±20% (percentage-based)
  const percentError = rawCalories > 0 ? Math.abs(delta / rawCalories) : (macroKcal > 0 ? 1 : 0);
  const pass = percentError <= 0.20; // FDA Class I: ±20%

  // BUG FIX 3: Calculate %DV for all nutrients that have FDA daily values
  const percentDV: Partial<Record<NutrientKey, number>> = {};
  for (const key of Object.keys(perServing) as NutrientKey[]) {
    const value = perServing[key];
    if (typeof value !== "number") continue;
    const dv = getDailyValue(key);
    if (dv !== undefined && dv > 0) {
      percentDV[key] = calculatePercentDV(value, key);
    }
  }

  const evidenceSummary = {
    verifiedCount: input.evidenceSummary?.verifiedCount ?? 0,
    inferredCount: input.evidenceSummary?.inferredCount ?? 0,
    exceptionCount: input.evidenceSummary?.exceptionCount ?? 0,
    unverifiedCount: input.evidenceSummary?.unverifiedCount ?? 0,
    totalNutrientRows: input.evidenceSummary?.totalNutrientRows ?? 0,
    provisional: input.evidenceSummary?.provisional ?? Boolean(input.provisional)
  };

  return {
    servingWeightG,
    perServing,
    roundedFda,
    percentDV,
    ingredientDeclaration,
    ingredientBreakdown,
    allergenStatement,
    qa: {
      macroKcal,
      rawCalories,
      labeledCalories: roundedFda.calories,
      delta,
      percentError,
      pass
    },
    provisional: Boolean(input.provisional ?? evidenceSummary.provisional),
    evidenceSummary
  };
}
