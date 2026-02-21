import type { NutrientKey } from "@nutrition/contracts";
import { roundCalories, roundCholesterolMg, roundFatLike, roundGeneralG, roundSodiumMg } from "./rounding.js";
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

const coreKeys: NutrientKey[] = [
  "kcal",
  "fat_g",
  "sat_fat_g",
  "trans_fat_g",
  "cholesterol_mg",
  "sodium_mg",
  "carb_g",
  "fiber_g",
  "sugars_g",
  "added_sugars_g",
  "protein_g"
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

  for (const key of coreKeys) {
    if (typeof perServing[key] !== "number") {
      perServing[key] = 0;
    }
  }

  const roundedFda = {
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
    proteinG: roundGeneralG(perServing.protein_g ?? 0)
  };

  const ingredientDeclaration = `Ingredients: ${input.lines
    .slice()
    .sort((a, b) => b.gramsPerServing - a.gramsPerServing)
    .map((l) => l.ingredientName)
    .join(", ")}`;

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

  const macroKcal = (perServing.protein_g ?? 0) * 4 + (perServing.carb_g ?? 0) * 4 + (perServing.fat_g ?? 0) * 9;
  const delta = macroKcal - roundedFda.calories;

  return {
    servingWeightG: totalWeight / servings,
    perServing,
    roundedFda,
    ingredientDeclaration,
    allergenStatement,
    qa: {
      macroKcal,
      labeledCalories: roundedFda.calories,
      delta,
      pass: Math.abs(delta) <= 20
    }
  };
}
