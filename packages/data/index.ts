import fallbackData from "./usda-fallbacks.json" assert { type: "json" };
import type { NutrientKey } from "@nutrition/contracts";

export type UsdaFallbackEntry = {
  fdcId: number;
  description: string;
  dataType: string;
  category: string;
  nutrients: Record<string, number>;
};

export type UsdaFallbackData = {
  meta: { source: string; generatedAt: string; nutrientsPer: string; version: number };
  ingredients: Record<string, UsdaFallbackEntry>;
};

const data = fallbackData as unknown as UsdaFallbackData;

export function getFallbackNutrients(ingredientKey: string): Partial<Record<NutrientKey, number>> | null {
  const entry = data.ingredients[ingredientKey];
  if (!entry) return null;
  return entry.nutrients as Partial<Record<NutrientKey, number>>;
}

export function getFallbackEntry(ingredientKey: string): UsdaFallbackEntry | null {
  return data.ingredients[ingredientKey] ?? null;
}

export function getAllFallbackKeys(): string[] {
  return Object.keys(data.ingredients);
}

export { data as usdaFallbackData };
