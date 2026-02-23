import type { NutrientKey } from "@nutrition/contracts";

export type NutrientMap = Partial<Record<NutrientKey, number>>;

export type RecipeLineInput = {
  lineId: string;
  ingredientName: string;
  ingredientAllergens: string[];
  gramsPerServing: number;
  /** Preparation text (e.g., "grilled", "steamed") */
  preparation?: string | null;
  /** State the recipe weight refers to (default: RAW) */
  preparedState?: "RAW" | "COOKED" | "DRY" | "CANNED" | "FROZEN";
  /** Cooking yield factor (cooked/raw ratio). Default: 1.0 */
  yieldFactor?: number;
};

export type ConsumedLotInput = {
  recipeLineId: string;
  lotId: string;
  productId: string;
  productName: string;
  gramsConsumed: number;
  nutrientsPer100g: NutrientMap;
  /** The state of the nutrient profile (RAW, COOKED, etc.) — used for yield correction */
  nutrientProfileState?: "RAW" | "COOKED" | "DRY" | "CANNED" | "FROZEN";
};

export type LabelComputationInput = {
  skuName: string;
  recipeName: string;
  servings: number;
  lines: RecipeLineInput[];
  consumedLots: ConsumedLotInput[];
  provisional?: boolean;
  evidenceSummary?: {
    verifiedCount: number;
    inferredCount: number;
    exceptionCount: number;
    unverifiedCount?: number;
    totalNutrientRows?: number;
    provisional: boolean;
  };
};

export type LabelComputationResult = {
  servingWeightG: number;
  perServing: NutrientMap;
  roundedFda: {
    // Existing macro fields (keep for backward compat)
    calories: number;
    fatG: number;
    satFatG: number;
    transFatG: number;
    cholesterolMg: number;
    sodiumMg: number;
    carbG: number;
    fiberG: number;
    sugarsG: number;
    addedSugarsG: number;
    proteinG: number;
    // NEW: All micronutrients rounded per FDA
    vitaminDMcg: number;
    calciumMg: number;
    ironMg: number;
    potassiumMg: number;
  };
  percentDV: Partial<Record<NutrientKey, number>>;  // NEW
  ingredientDeclaration: string;
  ingredientBreakdown: Array<{
    ingredientName: string;
    gramsPerServing: number;
    percentOfServing: number;
    nutrientHighlights: { protein_g: number; fat_g: number; carb_g: number; kcal: number };
  }>;
  allergenStatement: string;
  qa: {
    macroKcal: number;
    rawCalories: number;        // NEW: unrounded for comparison
    labeledCalories: number;
    delta: number;
    percentError: number;       // NEW
    pass: boolean;
  };
  provisional: boolean;
  evidenceSummary: {
    verifiedCount: number;
    inferredCount: number;
    exceptionCount: number;
    unverifiedCount: number;
    totalNutrientRows: number;
    provisional: boolean;
  };
};
