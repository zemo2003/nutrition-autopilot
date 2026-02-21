import type { NutrientKey } from "@nutrition/contracts";

export type NutrientMap = Partial<Record<NutrientKey, number>>;

export type RecipeLineInput = {
  lineId: string;
  ingredientName: string;
  ingredientAllergens: string[];
  gramsPerServing: number;
};

export type ConsumedLotInput = {
  recipeLineId: string;
  lotId: string;
  productId: string;
  productName: string;
  gramsConsumed: number;
  nutrientsPer100g: NutrientMap;
};

export type LabelComputationInput = {
  skuName: string;
  recipeName: string;
  servings: number;
  lines: RecipeLineInput[];
  consumedLots: ConsumedLotInput[];
};

export type LabelComputationResult = {
  servingWeightG: number;
  perServing: NutrientMap;
  roundedFda: {
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
  };
  ingredientDeclaration: string;
  allergenStatement: string;
  qa: {
    macroKcal: number;
    labeledCalories: number;
    delta: number;
    pass: boolean;
  };
};
