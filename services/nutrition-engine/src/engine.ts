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
  const evidenceSummary = {
    verifiedCount: input.evidenceSummary?.verifiedCount ?? 0,
    inferredCount: input.evidenceSummary?.inferredCount ?? 0,
    exceptionCount: input.evidenceSummary?.exceptionCount ?? 0,
    unverifiedCount: input.evidenceSummary?.unverifiedCount ?? 0,
    totalNutrientRows: input.evidenceSummary?.totalNutrientRows ?? 0,
    provisional: input.evidenceSummary?.provisional ?? Boolean(input.provisional)
  };

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
    },
    provisional: Boolean(input.provisional ?? evidenceSummary.provisional),
    evidenceSummary
  };
}
