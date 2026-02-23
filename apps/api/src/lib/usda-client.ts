import type { NutrientKey } from "@nutrition/contracts";
import { convertUsdaNutrients } from "@nutrition/nutrition-engine";

const USDA_API_BASE = "https://api.nal.usda.gov/fdc/v1";

function getApiKey(): string {
  return process.env.USDA_API_KEY ?? "DEMO_KEY";
}

export type UsdaFoodMatch = {
  fdcId: number;
  description: string;
  dataType: string;
  brandOwner?: string;
  score?: number;
};

export type UsdaFoodNutrient = {
  nutrientId?: number;
  nutrientNumber?: string;
  nutrientName?: string;
  value?: number;
  amount?: number;
  unitName?: string;
};

// Data type priority: lower = better
const DATA_TYPE_PRIORITY: Record<string, number> = {
  "Foundation": 0,
  "SR Legacy": 1,
  "Survey (FNDDS)": 2,
  "Branded": 3,
  "Experimental": 4
};

function dataTypePriority(dataType: string): number {
  return DATA_TYPE_PRIORITY[dataType] ?? 99;
}

export async function searchFoods(
  query: string,
  options?: { dataType?: string[]; pageSize?: number }
): Promise<UsdaFoodMatch[]> {
  const apiKey = getApiKey();
  const body: Record<string, unknown> = {
    query,
    pageSize: options?.pageSize ?? 10
  };
  if (options?.dataType?.length) {
    body.dataType = options.dataType;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${USDA_API_BASE}/foods/search?api_key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) return [];
    const json = (await response.json()) as any;
    const foods = json?.foods;
    if (!Array.isArray(foods)) return [];

    return foods.map((f: any) => ({
      fdcId: f.fdcId,
      description: f.description ?? "",
      dataType: f.dataType ?? "",
      brandOwner: f.brandOwner,
      score: f.score
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function getFoodNutrients(fdcId: number): Promise<{
  nutrients: Partial<Record<NutrientKey, number>>;
  description: string;
  dataType: string;
} | null> {
  const apiKey = getApiKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(
      `${USDA_API_BASE}/food/${fdcId}?api_key=${encodeURIComponent(apiKey)}`,
      { signal: controller.signal }
    );
    if (!response.ok) return null;
    const json = (await response.json()) as any;

    // USDA returns nutrients in different fields depending on data type
    const rawNutrients: UsdaFoodNutrient[] = json?.foodNutrients ?? [];
    const nutrients = convertUsdaNutrients(rawNutrients);

    return {
      nutrients,
      description: json?.description ?? "",
      dataType: json?.dataType ?? ""
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Search for a food and return the best match's full nutrients.
 * Prefers Foundation > SR Legacy > Survey > Branded.
 */
export async function searchAndGetBestMatch(query: string): Promise<{
  fdcId: number;
  description: string;
  dataType: string;
  nutrients: Partial<Record<NutrientKey, number>>;
} | null> {
  // Search with preferred data types first
  const matches = await searchFoods(query, {
    dataType: ["Foundation", "SR Legacy", "Survey (FNDDS)", "Branded"],
    pageSize: 10
  });

  if (!matches.length) return null;

  // Sort by data type priority, then by search score
  const sorted = [...matches].sort((a, b) => {
    const pA = dataTypePriority(a.dataType);
    const pB = dataTypePriority(b.dataType);
    if (pA !== pB) return pA - pB;
    return (b.score ?? 0) - (a.score ?? 0);
  });

  // Try the top 3 matches until we get one with nutrients
  for (let i = 0; i < Math.min(3, sorted.length); i++) {
    const match = sorted[i];
    if (!match) continue;
    const result = await getFoodNutrients(match.fdcId);
    if (result && Object.keys(result.nutrients).length >= 4) {
      return {
        fdcId: match.fdcId,
        description: result.description,
        dataType: result.dataType,
        nutrients: result.nutrients
      };
    }
  }

  return null;
}
