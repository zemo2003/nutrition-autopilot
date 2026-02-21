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
