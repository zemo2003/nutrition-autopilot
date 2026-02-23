import {
  NutrientEvidenceGrade,
  NutrientSourceType,
  Prisma,
  VerificationStatus,
  prisma
} from "@nutrition/db";
import { nutrientKeys, type NutrientKey } from "@nutrition/contracts";
import { searchAndGetBestMatch } from "../lib/usda-client.js";
import { validateFoodProduct, computeConsensus, type NutrientSource } from "@nutrition/nutrition-engine";
import usdaFallbackData from "../../../../packages/data/usda-fallbacks.json" assert { type: "json" };

type FullNutrients = Partial<Record<NutrientKey, number>>;

// Legacy types kept for OpenFoodFacts which still returns only 5 core nutrients
const coreKeys = ["kcal", "protein_g", "carb_g", "fat_g", "sodium_mg"] as const;

type CoreKey = (typeof coreKeys)[number];
type CoreNutrients = Partial<Record<CoreKey, number>>;

// ─── USDA Fallback (54 ingredients × 40 nutrients) ────────────────
const usdaIngredients = (usdaFallbackData as any).ingredients as Record<string, {
  fdcId: number;
  description: string;
  dataType: string;
  category: string;
  nutrients: Record<string, number>;
}>;

type AutofillResult = {
  values: Partial<Record<NutrientKey, number>>;
  sourceType: NutrientSourceType;
  sourceRef: string;
  confidence: number;
  evidenceGrade: NutrientEvidenceGrade;
  historicalException: boolean;
  method: "openfoodfacts_upc" | "ingredient_fallback" | "usda_fdc";
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

/**
 * Look up full 40-nutrient profile from pre-built USDA fallback JSON (54 ingredients).
 * Returns all nutrients per 100g, not just the 5 core.
 */
export function resolveFallbackNutrients(ingredientKey: string): FullNutrients | null {
  const entry = usdaIngredients[ingredientKey];
  if (!entry) return null;
  return entry.nutrients as FullNutrients;
}

/** @deprecated Use resolveFallbackNutrients — kept for backward compat */
export function resolveFallbackNutrientsForIngredientKey(ingredientKey: string): CoreNutrients | null {
  const full = resolveFallbackNutrients(ingredientKey);
  if (!full) return null;
  return { kcal: full.kcal, protein_g: full.protein_g, carb_g: full.carb_g, fat_g: full.fat_g, sodium_mg: full.sodium_mg };
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
    // BUG FIX: old code was `toNumber(kcal_100g) ?? (toNumber(kj_100g) ?? 0) / 4.184`
    // which evaluated to `0 / 4.184 = 0` when kcal was null and kj was also null,
    // but more critically: when kcal_100g was 0 (falsy), it would fall through to kJ branch
    const kcalDirect = toNumber(nutriments["energy-kcal_100g"]);
    const kjDirect = toNumber(nutriments["energy-kj_100g"]);
    const kcal = kcalDirect !== null ? kcalDirect : (kjDirect !== null ? kjDirect / 4.184 : null);
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
      evidenceGrade: NutrientEvidenceGrade.OPENFOODFACTS,
      historicalException: false,
      method: "openfoodfacts_upc"
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchUsdaFdc(productName: string): Promise<AutofillResult | null> {
  try {
    const result = await searchAndGetBestMatch(productName);
    if (!result) return null;

    // Check we got at least the 4 core macros
    const corePresent = ["kcal", "protein_g", "carb_g", "fat_g"].filter(
      (k) => typeof result.nutrients[k as NutrientKey] === "number"
    ).length;
    if (corePresent < 3) return null;

    const isFoundation = result.dataType === "Foundation" || result.dataType === "SR Legacy";

    return {
      values: result.nutrients,
      sourceType: NutrientSourceType.MANUFACTURER,
      sourceRef: `usda-fdc:${result.fdcId}:${result.description}`,
      confidence: isFoundation ? 0.95 : 0.82,
      evidenceGrade: isFoundation ? NutrientEvidenceGrade.USDA_GENERIC : NutrientEvidenceGrade.USDA_BRANDED,
      historicalException: false,
      method: "usda_fdc"
    };
  } catch {
    return null;
  }
}

/**
 * Name-based fuzzy match to USDA fallback. Returns full 40-nutrient profile.
 * More specific matches checked first to avoid false positives (e.g., "coconut oil" before "oil").
 */
function fallbackByName(productName: string): { key: string; nutrients: FullNutrients } | null {
  const n = normalizeText(productName);

  // Compound phrases first (more specific)
  if (n.includes("egg white"))        return lookup("ING-EGG-WHITES");
  if (n.includes("greek yogurt"))     return lookup("ING-GREEK-YOGURT-NONFAT");
  if (n.includes("cottage cheese"))   return lookup("ING-COTTAGE-CHEESE-LOWFAT");
  if (n.includes("cream cheese"))     return lookup("ING-CREAM-CHEESE");
  if (n.includes("cheddar"))          return lookup("ING-CHEDDAR-CHEESE");
  if (n.includes("peanut butter"))    return lookup("ING-PEANUT-BUTTER");
  if (n.includes("olive oil"))        return lookup("ING-OLIVE-OIL");
  if (n.includes("coconut oil"))      return lookup("ING-COCONUT-OIL");
  if (n.includes("sweet potato"))     return lookup("ING-SWEET-POTATO-COOKED");
  if (n.includes("brown rice"))       return lookup("ING-BROWN-RICE-COOKED");
  if (n.includes("whole wheat bread") || n.includes("wheat bread")) return lookup("ING-BREAD-WHOLE-WHEAT");
  if (n.includes("bell pepper") || n.includes("red pepper")) return lookup("ING-BELL-PEPPER-RED");
  if (n.includes("chia seed"))        return lookup("ING-CHIA-SEEDS");
  if (n.includes("flax seed") || n.includes("flaxseed")) return lookup("ING-FLAX-SEEDS");
  if (n.includes("black bean"))       return lookup("ING-BLACK-BEANS-COOKED");
  if (n.includes("kidney bean"))      return lookup("ING-KIDNEY-BEANS-COOKED");
  if (n.includes("ground turkey"))    return lookup("ING-GROUND-TURKEY-93-COOKED");
  if (n.includes("ground beef"))      return lookup("ING-GROUND-BEEF-95-RAW");
  if (n.includes("chicken thigh"))    return lookup("ING-CHICKEN-THIGH-RAW");
  if (n.includes("chicken breast") && n.includes("cooked")) return lookup("ING-CHICKEN-BREAST-COOKED");
  if (n.includes("chicken breast"))   return lookup("ING-CHICKEN-BREAST-RAW");

  // Single-word matches
  if (n.includes("egg"))              return lookup("ING-EGGS-WHOLE");
  if (n.includes("chicken"))          return lookup("ING-CHICKEN-BREAST-RAW");
  if (n.includes("turkey"))           return lookup("ING-GROUND-TURKEY-93-COOKED");
  if (n.includes("beef"))             return lookup("ING-GROUND-BEEF-95-RAW");
  if (n.includes("salmon"))           return lookup("ING-SALMON-ATLANTIC-RAW");
  if (n.includes("cod") || n.includes("fish")) return lookup("ING-COD-COOKED");
  if (n.includes("tuna"))             return lookup("ING-TUNA-DRAINED");
  if (n.includes("shrimp"))           return lookup("ING-SHRIMP-COOKED");
  if (n.includes("tofu"))             return lookup("ING-TOFU-FIRM");
  if (n.includes("milk"))             return lookup("ING-MILK");
  if (n.includes("yogurt"))           return lookup("ING-GREEK-YOGURT-NONFAT");
  if (n.includes("butter"))           return lookup("ING-BUTTER");
  if (n.includes("oat"))              return lookup("ING-ROLLED-OATS-DRY");
  if (n.includes("quinoa"))           return lookup("ING-QUINOA-COOKED");
  if (n.includes("rice"))             return lookup("ING-WHITE-RICE-COOKED");
  if (n.includes("penne") || n.includes("pasta") || n.includes("spaghetti")) return lookup("ING-PENNE-DRY");
  if (n.includes("bagel"))            return lookup("ING-BAGEL-PLAIN");
  if (n.includes("bread"))            return lookup("ING-BREAD-WHOLE-WHEAT");
  if (n.includes("chickpea") || n.includes("garbanzo")) return lookup("ING-CHICKPEAS-COOKED");
  if (n.includes("lentil"))           return lookup("ING-LENTILS-COOKED");
  if (n.includes("bean"))             return lookup("ING-KIDNEY-BEANS-COOKED");
  if (n.includes("broccoli"))         return lookup("ING-BROCCOLI-RAW");
  if (n.includes("spinach"))          return lookup("ING-SPINACH-RAW");
  if (n.includes("kale"))             return lookup("ING-KALE-RAW");
  if (n.includes("carrot"))           return lookup("ING-CARROT-RAW");
  if (n.includes("tomato"))           return lookup("ING-ROMA-TOMATO");
  if (n.includes("cucumber"))         return lookup("ING-ENGLISH-SEEDLESS-CUCUMBER");
  if (n.includes("banana"))           return lookup("ING-BANANA");
  if (n.includes("blueberr"))         return lookup("ING-BLUEBERRY");
  if (n.includes("strawberr"))        return lookup("ING-STRAWBERRY");
  if (n.includes("apple"))            return lookup("ING-APPLE");
  if (n.includes("avocado"))          return lookup("ING-AVOCADO");
  if (n.includes("almond"))           return lookup("ING-ALMONDS");
  if (n.includes("walnut"))           return lookup("ING-WALNUTS");
  if (n.includes("honey"))            return lookup("ING-HONEY");
  if (n.includes("granola"))          return lookup("ING-GRANOLA");
  if (n.includes("gatorade"))         return lookup("ING-GATORADE-FROST");

  return null;
}

function lookup(key: string): { key: string; nutrients: FullNutrients } | null {
  const entry = usdaIngredients[key];
  if (!entry) return null;
  return { key, nutrients: entry.nutrients as FullNutrients };
}

async function resolveNutrients(product: { upc: string | null; name: string; ingredient: { canonicalKey: string } }): Promise<AutofillResult | null> {
  // 1. OpenFoodFacts UPC lookup
  const upc = normalizedUpc(product.upc);
  if (upc) {
    const fromOff = await fetchOpenFoodFactsByUpc(upc);
    if (fromOff) return fromOff;
  }

  // 2. USDA FDC live search (returns all 40 nutrients)
  const fromUsda = await fetchUsdaFdc(product.name);
  if (fromUsda) return fromUsda;

  // 3. USDA pre-built fallback (54 ingredients × 40 nutrients)
  const fullFallback = resolveFallbackNutrients(product.ingredient.canonicalKey);
  if (fullFallback) {
    const entry = usdaIngredients[product.ingredient.canonicalKey];
    return {
      values: fullFallback,
      sourceType: NutrientSourceType.DERIVED,
      sourceRef: `usda-fallback-json:${product.ingredient.canonicalKey}:fdc-${entry?.fdcId ?? "unknown"}`,
      confidence: 0.85, // Higher than old fallback — sourced from verified USDA data
      evidenceGrade: NutrientEvidenceGrade.USDA_GENERIC,
      historicalException: false,
      method: "ingredient_fallback"
    };
  }

  // 4. Name-based fuzzy match against USDA fallback
  const nameMatch = fallbackByName(product.name);
  if (nameMatch) {
    return {
      values: nameMatch.nutrients,
      sourceType: NutrientSourceType.DERIVED,
      sourceRef: `usda-fallback-name:${nameMatch.key}`,
      confidence: 0.70,
      evidenceGrade: NutrientEvidenceGrade.INFERRED_FROM_INGREDIENT,
      historicalException: false,
      method: "ingredient_fallback"
    };
  }

  return null;
}

async function upsertNutrientsForProduct(input: {
  productId: string;
  values: Partial<Record<NutrientKey, number>>;
  sourceType: NutrientSourceType;
  sourceRef: string;
  confidence: number;
  evidenceGrade: NutrientEvidenceGrade;
  historicalException: boolean;
  retrievalRunId: string;
}) {
  const keysToUpsert = Object.keys(input.values) as NutrientKey[];
  const defs = await prisma.nutrientDefinition.findMany({
    where: { key: { in: keysToUpsert } }
  });
  const defByKey = new Map(defs.map((d) => [d.key, d]));

  for (const key of keysToUpsert) {
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
        confidenceScore: input.confidence,
        evidenceGrade: input.evidenceGrade,
        historicalException: input.historicalException,
        retrievedAt: new Date(),
        retrievalRunId: input.retrievalRunId,
        verificationStatus: VerificationStatus.NEEDS_REVIEW,
        version: { increment: 1 }
      },
      create: {
        productId: input.productId,
        nutrientDefinitionId: def.id,
        valuePer100g: value,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        confidenceScore: input.confidence,
        evidenceGrade: input.evidenceGrade,
        historicalException: input.historicalException,
        retrievedAt: new Date(),
        retrievalRunId: input.retrievalRunId,
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

/**
 * Attempt to gather multiple data sources for consensus scoring.
 * Returns the best result after running plausibility + optional consensus.
 */
async function resolveWithConsensus(
  product: { upc: string | null; name: string; ingredient: { canonicalKey: string } }
): Promise<AutofillResult | null> {
  const sources: Array<{ result: AutofillResult; sourceType: NutrientSource["sourceType"] }> = [];

  // Gather all available sources (don't short-circuit)
  const upc = normalizedUpc(product.upc);
  if (upc) {
    const fromOff = await fetchOpenFoodFactsByUpc(upc);
    if (fromOff) sources.push({ result: fromOff, sourceType: "OPENFOODFACTS" });
  }

  const fromUsda = await fetchUsdaFdc(product.name);
  if (fromUsda) sources.push({ result: fromUsda, sourceType: fromUsda.confidence >= 0.9 ? "USDA_FOUNDATION" : "USDA_BRANDED" });

  const fullFallback = resolveFallbackNutrients(product.ingredient.canonicalKey);
  if (fullFallback) {
    const entry = usdaIngredients[product.ingredient.canonicalKey];
    sources.push({
      result: {
        values: fullFallback,
        sourceType: NutrientSourceType.DERIVED,
        sourceRef: `usda-fallback-json:${product.ingredient.canonicalKey}:fdc-${entry?.fdcId ?? "unknown"}`,
        confidence: 0.85,
        evidenceGrade: NutrientEvidenceGrade.USDA_GENERIC,
        historicalException: false,
        method: "ingredient_fallback"
      },
      sourceType: "USDA_SR_LEGACY"
    });
  }

  if (sources.length === 0) {
    // Last resort: name-based match
    const nameMatch = fallbackByName(product.name);
    if (!nameMatch) return null;
    return {
      values: nameMatch.nutrients,
      sourceType: NutrientSourceType.DERIVED,
      sourceRef: `usda-fallback-name:${nameMatch.key}`,
      confidence: 0.70,
      evidenceGrade: NutrientEvidenceGrade.INFERRED_FROM_INGREDIENT,
      historicalException: false,
      method: "ingredient_fallback"
    };
  }

  if (sources.length === 1) {
    return sources[0]!.result;
  }

  // Multiple sources: run consensus
  const nutrientSources: NutrientSource[] = sources.map((s, i) => ({
    sourceId: `source-${i}-${s.result.method}`,
    sourceType: s.sourceType,
    nutrients: s.result.values,
    baseConfidence: s.result.confidence
  }));

  const consensus = computeConsensus(nutrientSources);

  // Use the primary source's metadata but with consensus values
  const primaryIdx = sources.findIndex((s, i) => `source-${i}-${s.result.method}` === consensus.primarySourceId);
  const primary = sources[primaryIdx >= 0 ? primaryIdx : 0]!;

  // Run plausibility on consensus values
  const issues = validateFoodProduct(consensus.consensusValues, product.name);
  const hasErrors = issues.some((i) => i.severity === "ERROR");

  return {
    values: hasErrors ? primary.result.values : consensus.consensusValues,
    sourceType: primary.result.sourceType,
    sourceRef: `consensus:${sources.map((s) => s.result.method).join("+")}|${primary.result.sourceRef}`,
    confidence: hasErrors ? primary.result.confidence * 0.7 : consensus.overallConfidence,
    evidenceGrade: primary.result.evidenceGrade,
    historicalException: false,
    method: primary.result.method
  };
}

export async function runNutrientAutofillSweep() {
  const retrievalRunId = `worker-${new Date().toISOString()}`;
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

    // Use consensus-based resolution when multiple sources available
    const resolved = await resolveWithConsensus(product);
    if (!resolved) {
      await ensureVerificationTask({
        organizationId: product.organizationId,
        productId: product.id,
        productName: product.name,
        severity: "CRITICAL",
        title: `Missing nutrient profile: ${product.name}`,
        description: "Autofill agent could not resolve nutrients from UPC, USDA, or fallback map.",
        payload: { productId: product.id, productName: product.name, missingCore }
      });
      continue;
    }

    // Run plausibility check and note issues
    const plausibilityIssues = validateFoodProduct(resolved.values, product.name);
    const plausibilityErrors = plausibilityIssues.filter((i) => i.severity === "ERROR");

    await upsertNutrientsForProduct({
      productId: product.id,
      values: resolved.values,
      sourceType: resolved.sourceType,
      sourceRef: resolved.sourceRef,
      confidence: plausibilityErrors.length > 0 ? Math.min(resolved.confidence, 0.4) : resolved.confidence,
      evidenceGrade: resolved.evidenceGrade,
      historicalException: resolved.historicalException,
      retrievalRunId
    });

    // Create verification task — severity based on confidence + plausibility
    const severity = plausibilityErrors.length > 0
      ? "CRITICAL" as const
      : resolved.confidence >= 0.8 ? "MEDIUM" as const : "HIGH" as const;

    await ensureVerificationTask({
      organizationId: product.organizationId,
      productId: product.id,
      productName: product.name,
      severity,
      title: plausibilityErrors.length > 0
        ? `Plausibility issues in autofilled nutrients: ${product.name}`
        : `Review autofilled nutrients: ${product.name}`,
      description: plausibilityErrors.length > 0
        ? `Autofill found plausibility errors: ${plausibilityErrors.map((e) => e.message).join("; ")}`
        : "Autofill agent inserted nutrients. Human review required before final trust.",
      payload: {
        productId: product.id,
        productName: product.name,
        method: resolved.method,
        sourceRef: resolved.sourceRef,
        confidence: resolved.confidence,
        values: resolved.values,
        missingCoreBefore: missingCore,
        plausibilityIssues: plausibilityIssues.length > 0 ? plausibilityIssues.slice(0, 10) : undefined
      }
    });
  }
}
