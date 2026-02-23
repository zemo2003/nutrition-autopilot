import {
  NutrientEvidenceGrade,
  NutrientSourceType,
  Prisma,
  VerificationStatus,
  prisma
} from "@nutrition/db";
import { CORE_NUTRIENT_KEYS, nutrientKeys, type CoreNutrientKey, type NutrientKey } from "@nutrition/contracts";
import { searchAndGetBestMatch } from "../lib/usda-client.js";
import { validateFoodProduct, computeConsensus, type NutrientSource } from "@nutrition/nutrition-engine";
import usdaFallbackData from "../../../../packages/data/usda-fallbacks.json" assert { type: "json" };

type FullNutrients = Partial<Record<NutrientKey, number>>;

type CoreNutrients = Partial<Record<CoreNutrientKey, number>>;

// ─── USDA Fallback (54 ingredients × 40 nutrients) ────────────────
type UsdaFallbackEntry = {
  fdcId: number;
  description: string;
  dataType: string;
  category: string;
  nutrients: Record<string, number>;
};
const usdaIngredients = (usdaFallbackData as { ingredients: Record<string, UsdaFallbackEntry> }).ingredients;

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
    // Prefer kcal; fall back to kJ conversion only when kcal is absent
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

    const populatedCore = ["kcal", "protein_g", "carb_g", "fat_g"].filter((k) => typeof values[k as CoreNutrientKey] === "number").length;
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
 * Ordered from most specific → least specific to avoid false positives.
 */
const NAME_MATCH_TABLE: Array<{ patterns: string[]; key: string }> = [
  // Compound phrases first (more specific)
  { patterns: ["egg white"],                                key: "ING-EGG-WHITES" },
  { patterns: ["greek yogurt"],                             key: "ING-GREEK-YOGURT-NONFAT" },
  { patterns: ["cottage cheese"],                           key: "ING-COTTAGE-CHEESE-LOWFAT" },
  { patterns: ["cream cheese"],                             key: "ING-CREAM-CHEESE" },
  { patterns: ["cheddar"],                                  key: "ING-CHEDDAR-CHEESE" },
  { patterns: ["peanut butter"],                            key: "ING-PEANUT-BUTTER" },
  { patterns: ["olive oil"],                                key: "ING-OLIVE-OIL" },
  { patterns: ["coconut oil"],                              key: "ING-COCONUT-OIL" },
  { patterns: ["sweet potato"],                             key: "ING-SWEET-POTATO-COOKED" },
  { patterns: ["brown rice"],                               key: "ING-BROWN-RICE-COOKED" },
  { patterns: ["whole wheat bread", "wheat bread"],         key: "ING-BREAD-WHOLE-WHEAT" },
  { patterns: ["bell pepper", "red pepper"],                key: "ING-BELL-PEPPER-RED" },
  { patterns: ["chia seed"],                                key: "ING-CHIA-SEEDS" },
  { patterns: ["flax seed", "flaxseed"],                    key: "ING-FLAX-SEEDS" },
  { patterns: ["black bean"],                               key: "ING-BLACK-BEANS-COOKED" },
  { patterns: ["kidney bean"],                              key: "ING-KIDNEY-BEANS-COOKED" },
  // Meats default to COOKED profiles (recipes specify finished weights)
  { patterns: ["ground turkey"],                            key: "ING-GROUND-TURKEY-93-COOKED" },
  { patterns: ["ground beef"],                              key: "ING-LEAN-GROUND-BEEF-95-COOKED" },
  { patterns: ["chicken thigh"],                            key: "ING-CHICKEN-THIGH-RAW" },       // TODO: add cooked thigh
  { patterns: ["chicken breast"],                           key: "ING-CHICKEN-BREAST-COOKED" },
  // Single-word matches
  { patterns: ["egg"],                                      key: "ING-EGGS-WHOLE" },
  { patterns: ["chicken"],                                  key: "ING-CHICKEN-BREAST-COOKED" },
  { patterns: ["turkey"],                                   key: "ING-GROUND-TURKEY-93-COOKED" },
  { patterns: ["beef"],                                     key: "ING-LEAN-GROUND-BEEF-95-COOKED" },
  { patterns: ["salmon"],                                   key: "ING-SALMON-ATLANTIC-RAW" },      // TODO: add cooked salmon
  { patterns: ["cod", "fish"],                              key: "ING-COD-COOKED" },
  { patterns: ["tuna"],                                     key: "ING-TUNA-DRAINED" },
  { patterns: ["shrimp"],                                   key: "ING-SHRIMP-COOKED" },
  { patterns: ["tofu"],                                     key: "ING-TOFU-FIRM" },
  { patterns: ["milk"],                                     key: "ING-MILK" },
  { patterns: ["yogurt"],                                   key: "ING-GREEK-YOGURT-NONFAT" },
  { patterns: ["butter"],                                   key: "ING-BUTTER" },
  { patterns: ["oat"],                                      key: "ING-ROLLED-OATS-DRY" },
  { patterns: ["quinoa"],                                   key: "ING-QUINOA-COOKED" },
  { patterns: ["rice"],                                     key: "ING-WHITE-RICE-COOKED" },
  { patterns: ["penne", "pasta", "spaghetti"],              key: "ING-PENNE-DRY" },
  { patterns: ["bagel"],                                    key: "ING-BAGEL-PLAIN" },
  { patterns: ["bread"],                                    key: "ING-BREAD-WHOLE-WHEAT" },
  { patterns: ["chickpea", "garbanzo"],                     key: "ING-CHICKPEAS-COOKED" },
  { patterns: ["lentil"],                                   key: "ING-LENTILS-COOKED" },
  { patterns: ["bean"],                                     key: "ING-KIDNEY-BEANS-COOKED" },
  { patterns: ["broccoli"],                                 key: "ING-BROCCOLI-RAW" },
  { patterns: ["spinach"],                                  key: "ING-SPINACH-RAW" },
  { patterns: ["kale"],                                     key: "ING-KALE-RAW" },
  { patterns: ["carrot"],                                   key: "ING-CARROT-RAW" },
  { patterns: ["tomato"],                                   key: "ING-ROMA-TOMATO" },
  { patterns: ["cucumber"],                                 key: "ING-ENGLISH-SEEDLESS-CUCUMBER" },
  { patterns: ["banana"],                                   key: "ING-BANANA" },
  { patterns: ["blueberr"],                                 key: "ING-BLUEBERRY" },
  { patterns: ["strawberr"],                                key: "ING-STRAWBERRY" },
  { patterns: ["apple"],                                    key: "ING-APPLE" },
  { patterns: ["avocado"],                                  key: "ING-AVOCADO" },
  { patterns: ["almond"],                                   key: "ING-ALMONDS" },
  { patterns: ["walnut"],                                   key: "ING-WALNUTS" },
  { patterns: ["honey"],                                    key: "ING-HONEY" },
  { patterns: ["granola"],                                  key: "ING-GRANOLA" },
  { patterns: ["gatorade"],                                 key: "ING-GATORADE-FROST" },
];

function fallbackByName(productName: string): { key: string; nutrients: FullNutrients } | null {
  const n = normalizeText(productName);
  for (const { patterns, key } of NAME_MATCH_TABLE) {
    if (patterns.some((p) => n.includes(p))) {
      return lookup(key);
    }
  }
  return null;
}

function lookup(key: string): { key: string; nutrients: FullNutrients } | null {
  const entry = usdaIngredients[key];
  if (!entry) return null;
  return { key, nutrients: entry.nutrients as FullNutrients };
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

  // Sanity bounds per 100 g — reject values outside physical range
  const SANITY_LIMITS: Partial<Record<NutrientKey, { min: number; max: number }>> = {
    kcal: { min: 0, max: 900 },           // No food exceeds ~900 kcal/100g (pure fat = 884)
    protein_g: { min: 0, max: 100 },       // Pure protein isolate ≈ 90g/100g
    fat_g: { min: 0, max: 100 },           // Pure fat/oil = 100g/100g
    carb_g: { min: 0, max: 100 },          // Pure sugar = 100g/100g
    fiber_g: { min: 0, max: 80 },          // Psyllium husk ≈ 71g/100g
    sugars_g: { min: 0, max: 100 },
    added_sugars_g: { min: 0, max: 100 },
    sat_fat_g: { min: 0, max: 100 },
    trans_fat_g: { min: 0, max: 100 },
    cholesterol_mg: { min: 0, max: 3100 }, // Dried egg yolk ≈ 2307mg/100g
    sodium_mg: { min: 0, max: 40000 },     // Table salt = 38758mg/100g
  };

  for (const key of keysToUpsert) {
    const value = input.values[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;

    // Reject negative values for any nutrient
    if (value < 0) {
      console.warn(`[nutrient-autofill] Rejecting negative value for ${key}: ${value} (product: ${input.productId})`);
      continue;
    }

    // Check sanity limits for nutrients with known bounds
    const limit = SANITY_LIMITS[key];
    if (limit && (value < limit.min || value > limit.max)) {
      console.warn(`[nutrient-autofill] Rejecting out-of-range value for ${key}: ${value} (limit: ${limit.min}-${limit.max}, product: ${input.productId})`);
      continue;
    }

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
