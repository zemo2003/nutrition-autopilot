import path from "node:path";
import * as XLSX from "xlsx";
import { z } from "zod";
import type { IngredientCatalogRow, RecipeLineRow, SkuMasterRow, SOTParseResult, ValidationError } from "./types.js";

const skuSchema = z.object({
  sku_code: z.string().min(1),
  sku_name: z.string().min(1),
  recipe_name: z.string().min(1),
  servings: z.coerce.number().positive(),
  serving_size_g: z.coerce.number().positive().optional()
});

const recipeLineSchema = z.object({
  sku_code: z.string().min(1),
  recipe_name: z.string().min(1),
  line_order: z.coerce.number().int().positive(),
  ingredient_key: z.string().min(1),
  ingredient_name: z.string().min(1),
  grams_per_serving: z.coerce.number().positive(),
  preparation: z.string().optional(),
  required: z.union([z.boolean(), z.literal("TRUE"), z.literal("FALSE"), z.literal("true"), z.literal("false")]).optional()
});

const ingredientSchema = z.object({
  ingredient_key: z.string().min(1),
  ingredient_name: z.string().min(1),
  category: z.string().min(1),
  default_unit: z.enum(["g", "ml", "oz"]),
  allergen_tags_pipe_delimited: z.string().optional()
});

function parseRequiredSheet(wb: XLSX.WorkBook, name: string, errors: ValidationError[]) {
  const sheet = wb.Sheets[name];
  if (!sheet) {
    errors.push({ sheet: name, rowNumber: null, code: "MISSING_SHEET", message: `${name} is required` });
    return [];
  }
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
}

function toBool(value: unknown, fallback = true): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return fallback;
}

export function parseSotWorkbook(filePath: string): SOTParseResult {
  const errors: ValidationError[] = [];
  const workbook = XLSX.readFile(path.resolve(filePath));

  const rawSkus = parseRequiredSheet(workbook, "SKU_Master", errors);
  const rawRecipeLines = parseRequiredSheet(workbook, "Recipe_Lines", errors);
  const rawIngredients = parseRequiredSheet(workbook, "Ingredient_Catalog", errors);

  const skus: SkuMasterRow[] = [];
  rawSkus.forEach((row, idx) => {
    const parsed = skuSchema.safeParse(row);
    if (!parsed.success) {
      errors.push({
        sheet: "SKU_Master",
        rowNumber: idx + 2,
        code: "INVALID_ROW",
        message: parsed.error.issues.map((i) => i.message).join("; ")
      });
      return;
    }
    skus.push({
      skuCode: parsed.data.sku_code.trim(),
      skuName: parsed.data.sku_name.trim(),
      recipeName: parsed.data.recipe_name.trim(),
      servings: parsed.data.servings,
      servingSizeG: parsed.data.serving_size_g
    });
  });

  const recipeLines: RecipeLineRow[] = [];
  rawRecipeLines.forEach((row, idx) => {
    const parsed = recipeLineSchema.safeParse(row);
    if (!parsed.success) {
      errors.push({
        sheet: "Recipe_Lines",
        rowNumber: idx + 2,
        code: "INVALID_ROW",
        message: parsed.error.issues.map((i) => i.message).join("; ")
      });
      return;
    }
    recipeLines.push({
      skuCode: parsed.data.sku_code.trim(),
      recipeName: parsed.data.recipe_name.trim(),
      lineOrder: parsed.data.line_order,
      ingredientKey: parsed.data.ingredient_key.trim(),
      ingredientName: parsed.data.ingredient_name.trim(),
      gramsPerServing: parsed.data.grams_per_serving,
      preparation: parsed.data.preparation?.trim(),
      required: toBool(parsed.data.required)
    });
  });

  const ingredients: IngredientCatalogRow[] = [];
  rawIngredients.forEach((row, idx) => {
    const parsed = ingredientSchema.safeParse(row);
    if (!parsed.success) {
      errors.push({
        sheet: "Ingredient_Catalog",
        rowNumber: idx + 2,
        code: "INVALID_ROW",
        message: parsed.error.issues.map((i) => i.message).join("; ")
      });
      return;
    }
    ingredients.push({
      ingredientKey: parsed.data.ingredient_key.trim(),
      ingredientName: parsed.data.ingredient_name.trim(),
      category: parsed.data.category.trim(),
      defaultUnit: parsed.data.default_unit,
      allergenTags: parsed.data.allergen_tags_pipe_delimited
        ? parsed.data.allergen_tags_pipe_delimited
            .split("|")
            .map((x) => x.trim())
            .filter(Boolean)
        : []
    });
  });

  const ingredientKeySet = new Set(ingredients.map((x) => x.ingredientKey));
  const skuRecipeKeySet = new Set(skus.map((x) => `${x.skuCode}::${x.recipeName}`));

  const duplicateSkuKeys = findDuplicates(skus.map((x) => x.skuCode));
  duplicateSkuKeys.forEach((key) => {
    errors.push({
      sheet: "SKU_Master",
      rowNumber: null,
      code: "DUPLICATE_SKU_CODE",
      message: `Duplicate SKU code: ${key}`
    });
  });

  const duplicateIngredientKeys = findDuplicates(ingredients.map((x) => x.ingredientKey));
  duplicateIngredientKeys.forEach((key) => {
    errors.push({
      sheet: "Ingredient_Catalog",
      rowNumber: null,
      code: "DUPLICATE_INGREDIENT_KEY",
      message: `Duplicate ingredient key: ${key}`
    });
  });

  const duplicateLineKeys = findDuplicates(recipeLines.map((x) => `${x.skuCode}::${x.recipeName}::${x.lineOrder}`));
  duplicateLineKeys.forEach((key) => {
    errors.push({
      sheet: "Recipe_Lines",
      rowNumber: null,
      code: "DUPLICATE_RECIPE_LINE",
      message: `Duplicate recipe line key: ${key}`
    });
  });

  recipeLines.forEach((line, idx) => {
    if (!ingredientKeySet.has(line.ingredientKey)) {
      errors.push({
        sheet: "Recipe_Lines",
        rowNumber: idx + 2,
        code: "UNKNOWN_INGREDIENT_KEY",
        message: `ingredient_key ${line.ingredientKey} not found in Ingredient_Catalog`
      });
    }
    if (!skuRecipeKeySet.has(`${line.skuCode}::${line.recipeName}`)) {
      errors.push({
        sheet: "Recipe_Lines",
        rowNumber: idx + 2,
        code: "UNKNOWN_SKU_RECIPE",
        message: `SKU+recipe not found in SKU_Master: ${line.skuCode} / ${line.recipeName}`
      });
    }
  });

  return {
    skus,
    recipeLines,
    ingredients,
    errors
  };
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}
