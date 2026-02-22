import { NutrientSourceType, Prisma, VerificationStatus, prisma } from "@nutrition/db";

const coreKeys = ["kcal", "protein_g", "carb_g", "fat_g", "sodium_mg"] as const;

type CoreKey = (typeof coreKeys)[number];
type CoreNutrients = Partial<Record<CoreKey, number>>;

type AutofillResult = {
  values: CoreNutrients;
  sourceType: NutrientSourceType;
  sourceRef: string;
  confidence: number;
  method: "openfoodfacts_upc" | "ingredient_fallback";
};

function toNumber(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string" && input.trim().length > 0) {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizedUpc(input: string | null | undefined): string | null {
  if (!input) return null;
  const stripped = input.replace(/[^0-9]/g, "");
  return stripped.length >= 8 ? stripped : null;
}

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const ingredientFallbackByKey: Record<string, CoreNutrients> = {
  "ING-EGGS-WHOLE": { kcal: 143, protein_g: 12.6, carb_g: 1.1, fat_g: 9.5, sodium_mg: 142 },
  "ING-COTTAGE-CHEESE-LOWFAT": { kcal: 82, protein_g: 11.1, carb_g: 3.4, fat_g: 2.3, sodium_mg: 364 },
  "ING-GREEK-YOGURT-NONFAT": { kcal: 59, protein_g: 10.3, carb_g: 3.6, fat_g: 0.4, sodium_mg: 36 },
  "ING-ROLLED-OATS-DRY": { kcal: 389, protein_g: 16.9, carb_g: 66.3, fat_g: 6.9, sodium_mg: 2 },
  "ING-HONEY": { kcal: 304, protein_g: 0.3, carb_g: 82.4, fat_g: 0, sodium_mg: 4 },
  "ING-BANANA": { kcal: 89, protein_g: 1.1, carb_g: 22.8, fat_g: 0.3, sodium_mg: 1 },
  "ING-CHICKEN-BREAST-RAW": { kcal: 120, protein_g: 22.5, carb_g: 0, fat_g: 2.6, sodium_mg: 74 },
  "ING-CHICKEN-BREAST-COOKED": { kcal: 165, protein_g: 31.0, carb_g: 0, fat_g: 3.6, sodium_mg: 74 },
  "ING-GROUND-TURKEY-93-COOKED": { kcal: 182, protein_g: 23.4, carb_g: 0, fat_g: 9.2, sodium_mg: 72 },
  "ING-GROUND-BEEF-95-RAW": { kcal: 137, protein_g: 21.4, carb_g: 0, fat_g: 5, sodium_mg: 66 },
  "ING-LEAN-GROUND-BEEF-95-COOKED": { kcal: 173, protein_g: 26.1, carb_g: 0, fat_g: 7, sodium_mg: 76 },
  "ING-COD-COOKED": { kcal: 105, protein_g: 23, carb_g: 0, fat_g: 0.9, sodium_mg: 78 },
  "ING-OLIVE-OIL": { kcal: 884, protein_g: 0, carb_g: 0, fat_g: 100, sodium_mg: 2 },
  "ING-WHITE-RICE-COOKED": { kcal: 130, protein_g: 2.4, carb_g: 28.7, fat_g: 0.3, sodium_mg: 1 },
  "ING-PASTA-COOKED": { kcal: 158, protein_g: 5.8, carb_g: 30.9, fat_g: 0.9, sodium_mg: 1 },
  "ING-PENNE-DRY": { kcal: 371, protein_g: 13, carb_g: 75, fat_g: 1.5, sodium_mg: 6 },
  "ING-KIDNEY-BEANS-COOKED": { kcal: 127, protein_g: 8.7, carb_g: 22.8, fat_g: 0.5, sodium_mg: 250 },
  "ING-BLACK-BEANS-COOKED": { kcal: 132, protein_g: 8.9, carb_g: 23.7, fat_g: 0.5, sodium_mg: 240 },
  "ING-MILK": { kcal: 61, protein_g: 3.2, carb_g: 4.8, fat_g: 3.3, sodium_mg: 43 },
  "ING-BAGEL-PLAIN": { kcal: 274, protein_g: 10.5, carb_g: 53, fat_g: 1.7, sodium_mg: 443 },
  "ING-PEANUT-BUTTER": { kcal: 588, protein_g: 25, carb_g: 20, fat_g: 50, sodium_mg: 486 },
  "ING-GRANOLA": { kcal: 471, protein_g: 10, carb_g: 64, fat_g: 20, sodium_mg: 230 },
  "ING-TUNA-DRAINED": { kcal: 116, protein_g: 25.5, carb_g: 0, fat_g: 0.8, sodium_mg: 247 },
  "ING-ROMA-TOMATO": { kcal: 18, protein_g: 0.9, carb_g: 3.9, fat_g: 0.2, sodium_mg: 5 },
  "ING-ENGLISH-SEEDLESS-CUCUMBER": { kcal: 15, protein_g: 0.7, carb_g: 3.6, fat_g: 0.1, sodium_mg: 2 },
  "ING-GATORADE-FROST": { kcal: 24, protein_g: 0, carb_g: 6.1, fat_g: 0, sodium_mg: 46 }
};

export function resolveFallbackNutrientsForIngredientKey(ingredientKey: string): CoreNutrients | null {
  return ingredientFallbackByKey[ingredientKey] ?? null;
}

async function fetchOpenFoodFactsByUpc(upc: string): Promise<AutofillResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(upc)}.json`, {
      signal: controller.signal
    });
    if (!response.ok) return null;
    const json = (await response.json()) as any;
    if (!json || json.status !== 1 || !json.product) return null;

    const nutriments = json.product.nutriments ?? {};
    const kcal = toNumber(nutriments["energy-kcal_100g"]) ?? (toNumber(nutriments["energy-kj_100g"]) ?? 0) / 4.184;
    const protein = toNumber(nutriments["proteins_100g"]);
    const carb = toNumber(nutriments["carbohydrates_100g"]);
    const fat = toNumber(nutriments["fat_100g"]);
    const sodiumG = toNumber(nutriments["sodium_100g"]);
    const saltG = toNumber(nutriments["salt_100g"]);

    const sodiumMg = sodiumG !== null ? sodiumG * 1000 : saltG !== null ? saltG * 393.4 : null;

    const values: CoreNutrients = {};
    if (kcal !== null && Number.isFinite(kcal) && kcal > 0) values.kcal = kcal;
    if (protein !== null && Number.isFinite(protein) && protein >= 0) values.protein_g = protein;
    if (carb !== null && Number.isFinite(carb) && carb >= 0) values.carb_g = carb;
    if (fat !== null && Number.isFinite(fat) && fat >= 0) values.fat_g = fat;
    if (sodiumMg !== null && Number.isFinite(sodiumMg) && sodiumMg >= 0) values.sodium_mg = sodiumMg;

    const populatedCore = ["kcal", "protein_g", "carb_g", "fat_g"].filter((k) => typeof values[k as CoreKey] === "number").length;
    if (populatedCore < 2) return null;

    return {
      values,
      sourceType: NutrientSourceType.MANUFACTURER,
      sourceRef: `https://world.openfoodfacts.org/product/${upc}`,
      confidence: populatedCore >= 4 ? 0.92 : 0.72,
      method: "openfoodfacts_upc"
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackByName(productName: string): CoreNutrients | null {
  const normalized = normalizeText(productName);
  if (normalized.includes("egg")) return ingredientFallbackByKey["ING-EGGS-WHOLE"] ?? null;
  if (normalized.includes("greek yogurt")) return ingredientFallbackByKey["ING-GREEK-YOGURT-NONFAT"] ?? null;
  if (normalized.includes("cottage cheese")) return ingredientFallbackByKey["ING-COTTAGE-CHEESE-LOWFAT"] ?? null;
  if (normalized.includes("oat")) return ingredientFallbackByKey["ING-ROLLED-OATS-DRY"] ?? null;
  if (normalized.includes("honey")) return ingredientFallbackByKey["ING-HONEY"] ?? null;
  if (normalized.includes("banana")) return ingredientFallbackByKey["ING-BANANA"] ?? null;
  if (normalized.includes("chicken")) return ingredientFallbackByKey["ING-CHICKEN-BREAST-RAW"] ?? null;
  if (normalized.includes("turkey")) return ingredientFallbackByKey["ING-GROUND-TURKEY-93-COOKED"] ?? null;
  if (normalized.includes("beef")) return ingredientFallbackByKey["ING-GROUND-BEEF-95-RAW"] ?? null;
  if (normalized.includes("cod") || normalized.includes("fish")) return ingredientFallbackByKey["ING-COD-COOKED"] ?? null;
  if (normalized.includes("olive oil")) return ingredientFallbackByKey["ING-OLIVE-OIL"] ?? null;
  if (normalized.includes("rice")) return ingredientFallbackByKey["ING-WHITE-RICE-COOKED"] ?? null;
  if (normalized.includes("penne") || normalized.includes("pasta")) return ingredientFallbackByKey["ING-PENNE-DRY"] ?? null;
  if (normalized.includes("bean")) return ingredientFallbackByKey["ING-KIDNEY-BEANS-COOKED"] ?? null;
  if (normalized.includes("tomato")) return ingredientFallbackByKey["ING-ROMA-TOMATO"] ?? null;
  if (normalized.includes("cucumber")) return ingredientFallbackByKey["ING-ENGLISH-SEEDLESS-CUCUMBER"] ?? null;
  if (normalized.includes("gatorade")) return ingredientFallbackByKey["ING-GATORADE-FROST"] ?? null;
  return null;
}

async function resolveNutrients(product: { upc: string | null; name: string; ingredient: { canonicalKey: string } }): Promise<AutofillResult | null> {
  const upc = normalizedUpc(product.upc);
  if (upc) {
    const fromOff = await fetchOpenFoodFactsByUpc(upc);
    if (fromOff) return fromOff;
  }

  const fallback = resolveFallbackNutrientsForIngredientKey(product.ingredient.canonicalKey) ?? fallbackByName(product.name);
  if (!fallback) return null;
  return {
    values: fallback,
    sourceType: NutrientSourceType.DERIVED,
    sourceRef: `ingredient-fallback:${product.ingredient.canonicalKey}`,
    confidence: 0.55,
    method: "ingredient_fallback"
  };
}

async function upsertNutrientsForProduct(input: {
  productId: string;
  values: CoreNutrients;
  sourceType: NutrientSourceType;
  sourceRef: string;
}) {
  const defs = await prisma.nutrientDefinition.findMany({
    where: { key: { in: coreKeys as unknown as string[] } }
  });
  const defByKey = new Map(defs.map((d) => [d.key, d]));

  for (const key of coreKeys) {
    const value = input.values[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const def = defByKey.get(key);
    if (!def) continue;

    await prisma.productNutrientValue.upsert({
      where: {
        productId_nutrientDefinitionId: {
          productId: input.productId,
          nutrientDefinitionId: def.id
        }
      },
      update: {
        valuePer100g: value,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        verificationStatus: VerificationStatus.NEEDS_REVIEW,
        version: { increment: 1 }
      },
      create: {
        productId: input.productId,
        nutrientDefinitionId: def.id,
        valuePer100g: value,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        verificationStatus: VerificationStatus.NEEDS_REVIEW,
        createdBy: "agent"
      }
    });
  }
}

async function ensureVerificationTask(input: {
  organizationId: string;
  productId: string;
  productName: string;
  severity: "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  description: string;
  payload: Prisma.InputJsonValue;
}) {
  const existing = await prisma.verificationTask.findFirst({
    where: {
      organizationId: input.organizationId,
      taskType: "SOURCE_RETRIEVAL",
      status: "OPEN",
      payload: {
        path: ["productId"],
        equals: input.productId
      }
    }
  });
  if (existing) return;

  await prisma.verificationTask.create({
    data: {
      organizationId: input.organizationId,
      taskType: "SOURCE_RETRIEVAL",
      severity: input.severity,
      status: "OPEN",
      title: input.title,
      description: input.description,
      payload: input.payload,
      createdBy: "agent"
    }
  });
}

export async function runNutrientAutofillSweep() {
  const products = await prisma.productCatalog.findMany({
    include: {
      ingredient: true,
      nutrients: {
        where: {
          nutrientDefinition: { key: { in: ["kcal", "protein_g", "carb_g", "fat_g"] } }
        },
        include: { nutrientDefinition: true }
      }
    }
  });

  for (const product of products) {
    const present = new Set(
      product.nutrients
        .filter((n) => typeof n.valuePer100g === "number")
        .map((n) => n.nutrientDefinition.key)
    );
    const missingCore = ["kcal", "protein_g", "carb_g", "fat_g"].filter((k) => !present.has(k));
    if (!missingCore.length) continue;

    const resolved = await resolveNutrients(product);
    if (!resolved) {
      await ensureVerificationTask({
        organizationId: product.organizationId,
        productId: product.id,
        productName: product.name,
        severity: "CRITICAL",
        title: `Missing nutrient profile: ${product.name}`,
        description: "Autofill agent could not resolve nutrients from UPC or fallback map.",
        payload: { productId: product.id, productName: product.name, missingCore }
      });
      continue;
    }

    await upsertNutrientsForProduct({
      productId: product.id,
      values: resolved.values,
      sourceType: resolved.sourceType,
      sourceRef: resolved.sourceRef
    });

    await ensureVerificationTask({
      organizationId: product.organizationId,
      productId: product.id,
      productName: product.name,
      severity: resolved.confidence >= 0.8 ? "MEDIUM" : "HIGH",
      title: `Review autofilled nutrients: ${product.name}`,
      description: "Autofill agent inserted core nutrients. Human review required before final trust.",
      payload: {
        productId: product.id,
        productName: product.name,
        method: resolved.method,
        sourceRef: resolved.sourceRef,
        confidence: resolved.confidence,
        values: resolved.values,
        missingCoreBefore: missingCore
      }
    });
  }
}
