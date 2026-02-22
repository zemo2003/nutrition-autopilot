export type SkuMasterRow = {
  skuCode: string;
  skuName: string;
  recipeName: string;
  servings: number;
  servingSizeG?: number;
};

export type RecipeLineRow = {
  skuCode: string;
  recipeName: string;
  lineOrder: number;
  ingredientKey: string;
  ingredientName: string;
  gramsPerServing: number;
  preparation?: string;
  required: boolean;
};

export type IngredientCatalogRow = {
  ingredientKey: string;
  ingredientName: string;
  category: string;
  defaultUnit: string;
  allergenTags: string[];
};

export type InstacartOrderRow = {
  orderedAt: Date;
  productName: string;
  brand: string | null;
  upc: string | null;
  qty: number;
  unit: string;
  gramsPerUnit: number;
  lotCode: string | null;
  expiresAt: Date | null;
  ingredientKeyHint: string | null;
  ingredientNameHint: string | null;
  unitPriceUsd: number | null;
  lineTotalUsd: number | null;
  nutrientSourceTypeHint: "MANUFACTURER" | "USDA" | "MANUAL" | null;
  nutrientSourceRefHint: string | null;
  nutrientHints: {
    kcal: number | null;
    proteinG: number | null;
    carbG: number | null;
    fatG: number | null;
    sodiumMg: number | null;
  };
};

export type PilotMealRow = {
  mealRowId: number;
  clientExternalRef: string;
  clientName: string;
  serviceDate: Date;
  mealSlot: string;
  skuCode: string;
  skuName: string;
  recipeName: string;
  plannedServings: number;
  servingSizeG: number;
  lineOrder: number;
  ingredientKey: string;
  ingredientName: string;
  gramsPerServing: number;
  preparation: string | null;
  required: boolean;
  allergenTags: string[];
  ingredientCategory: string;
  defaultUnit: string;
  sourceDayLabel: string | null;
  needsReview: boolean;
  reviewNotes: string | null;
};

export type ValidationError = {
  sheet: string;
  rowNumber: number | null;
  code: string;
  message: string;
};

export type SOTParseResult = {
  skus: SkuMasterRow[];
  recipeLines: RecipeLineRow[];
  ingredients: IngredientCatalogRow[];
  errors: ValidationError[];
};
