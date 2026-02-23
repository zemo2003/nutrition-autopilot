# Migration Guide: From Hardcoded to USDA Fallback Data Package

This guide explains how to update the nutrition autofill worker to use the new comprehensive USDA fallback data package.

## Current State

**File**: `apps/api/src/worker/nutrient-autofill.ts`

Current limitations:
- 25 ingredients hardcoded in `ingredientFallbackByKey` map
- Only 5 nutrients per ingredient: `kcal`, `protein_g`, `carb_g`, `fat_g`, `sodium_mg`
- Manual fallback logic with text pattern matching

```typescript
const ingredientFallbackByKey: Record<string, CoreNutrients> = {
  "ING-EGGS-WHOLE": { kcal: 143, protein_g: 12.6, carb_g: 1.1, fat_g: 9.5, sodium_mg: 142 },
  "ING-COTTAGE-CHEESE-LOWFAT": { kcal: 82, protein_g: 11.1, carb_g: 3.4, fat_g: 2.3, sodium_mg: 364 },
  // ... 23 more hardcoded entries
};
```

## New State

**Files**:
- `packages/data/usda-fallbacks.json` (54 ingredients, 40 nutrients each)
- `packages/data/index.ts` (utility functions)

New capabilities:
- 54 ingredients across 14 categories
- All 40 nutrients defined in `packages/contracts/src/nutrients.ts`
- USDA-sourced, verified data
- Scalable and maintainable

```typescript
import { getFallbackNutrients } from "@nutrition/data";

const nutrients = getFallbackNutrients("ING-EGGS-WHOLE");
// Returns all 40 nutrients with accurate values
```

## Step-by-Step Migration

### Step 1: Update Package Dependencies

In `apps/api/package.json`, add the data package dependency:

```json
{
  "dependencies": {
    "@nutrition/contracts": "workspace:*",
    "@nutrition/db": "workspace:*",
    "@nutrition/data": "workspace:*"
  }
}
```

Run:
```bash
npm install
```

### Step 2: Update the Nutrient Autofill Worker

**Original code** (lines 43-74 of `nutrient-autofill.ts`):

```typescript
// Remove this entire block:
const ingredientFallbackByKey: Record<string, CoreNutrients> = {
  "ING-EGGS-WHOLE": { kcal: 143, protein_g: 12.6, carb_g: 1.1, fat_g: 9.5, sodium_mg: 142 },
  // ... all 25 entries
};

export function resolveFallbackNutrientsForIngredientKey(ingredientKey: string): CoreNutrients | null {
  return ingredientFallbackByKey[ingredientKey] ?? null;
}
```

**New code**:

```typescript
import { getFallbackNutrients } from "@nutrition/data";

// Remove resolveFallbackNutrientsForIngredientKey function - use imported function directly

// Update fallbackByName to use the new data package:
function fallbackByName(productName: string): Partial<Record<NutrientKey, number>> | null {
  const normalized = normalizeText(productName);

  if (normalized.includes("egg")) return getFallbackNutrients("ING-EGGS-WHOLE");
  if (normalized.includes("greek yogurt")) return getFallbackNutrients("ING-GREEK-YOGURT-NONFAT");
  if (normalized.includes("cottage cheese")) return getFallbackNutrients("ING-COTTAGE-CHEESE-LOWFAT");
  if (normalized.includes("oat")) return getFallbackNutrients("ING-ROLLED-OATS-DRY");
  // ... etc

  return null;
}
```

### Step 3: Expand Nutrient Support

**Current code** (line 9):
```typescript
const coreKeys = ["kcal", "protein_g", "carb_g", "fat_g", "sodium_mg"] as const;
```

**New code** (use all 40 keys):
```typescript
import { nutrientKeys, type NutrientKey } from "@nutrition/contracts";

// Use nutrientKeys instead of coreKeys
type SupportedNutrient = (typeof nutrientKeys)[number];
```

### Step 4: Update AutofillResult Type

**Current code** (lines 14-22):
```typescript
type AutofillResult = {
  values: CoreNutrients;
  sourceType: NutrientSourceType;
  sourceRef: string;
  confidence: number;
  evidenceGrade: NutrientEvidenceGrade;
  historicalException: boolean;
  method: "openfoodfacts_upc" | "ingredient_fallback";
};
```

**New code**:
```typescript
type AutofillResult = {
  values: Partial<Record<NutrientKey, number>>;  // Support all 40 nutrients
  sourceType: NutrientSourceType;
  sourceRef: string;
  confidence: number;
  evidenceGrade: NutrientEvidenceGrade;
  historicalException: boolean;
  method: "openfoodfacts_upc" | "ingredient_fallback";
};
```

### Step 5: Update resolveNutrients Function

**Current code** (lines 145-163):
```typescript
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
    evidenceGrade: NutrientEvidenceGrade.INFERRED_FROM_INGREDIENT,
    historicalException: false,
    method: "ingredient_fallback"
  };
}
```

**New code**:
```typescript
async function resolveNutrients(product: { upc: string | null; name: string; ingredient: { canonicalKey: string } }): Promise<AutofillResult | null> {
  const upc = normalizedUpc(product.upc);
  if (upc) {
    const fromOff = await fetchOpenFoodFactsByUpc(upc);
    if (fromOff) return fromOff;
  }

  const fallback = getFallbackNutrients(product.ingredient.canonicalKey) ?? fallbackByName(product.name);
  if (!fallback) return null;

  // All 40 nutrients are now available for derived sources
  return {
    values: fallback,
    sourceType: NutrientSourceType.DERIVED,
    sourceRef: `ingredient-fallback:${product.ingredient.canonicalKey}`,
    confidence: 0.55,
    evidenceGrade: NutrientEvidenceGrade.INFERRED_FROM_INGREDIENT,
    historicalException: false,
    method: "ingredient_fallback"
  };
}
```

### Step 6: Update upsertNutrientsForProduct Function

**Current code** (lines 165-221):
```typescript
async function upsertNutrientsForProduct(input: {
  productId: string;
  values: CoreNutrients;  // Only 5 nutrients
  // ...
}) {
  const defs = await prisma.nutrientDefinition.findMany({
    where: { key: { in: coreKeys as unknown as string[] } }  // Only 5 keys
  });
  // ... iterate over coreKeys
}
```

**New code**:
```typescript
async function upsertNutrientsForProduct(input: {
  productId: string;
  values: Partial<Record<NutrientKey, number>>;  // All 40 nutrients supported
  // ... rest of fields unchanged
}) {
  const defs = await prisma.nutrientDefinition.findMany({
    where: { key: { in: nutrientKeys } }  // All 40 keys
  });

  const defByKey = new Map(defs.map((d) => [d.key, d]));

  for (const key of nutrientKeys) {  // Iterate over all 40 keys
    const value = input.values[key as NutrientKey];
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
```

### Step 7: Update runNutrientAutofillSweep Function

**Current code** (lines 259-325):
```typescript
export async function runNutrientAutofillSweep() {
  // ...
  const products = await prisma.productCatalog.findMany({
    include: {
      nutrient: {
        where: {
          nutrientDefinition: { key: { in: ["kcal", "protein_g", "carb_g", "fat_g"] } }  // Only 4 keys
        },
        // ...
      }
    }
  });
  // ...
  const missingCore = ["kcal", "protein_g", "carb_g", "fat_g"].filter((k) => !present.has(k));
}
```

**New code**:
```typescript
export async function runNutrientAutofillSweep() {
  const retrievalRunId = `worker-${new Date().toISOString()}`;

  // Query for ALL 40 nutrients, not just core 4
  const products = await prisma.productCatalog.findMany({
    include: {
      ingredient: true,
      nutrients: {
        where: {
          nutrientDefinition: { key: { in: nutrientKeys } }  // All 40 keys
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

    // Check for missing core nutrients (still prioritize these 4)
    const coreKeys = ["kcal", "protein_g", "carb_g", "fat_g"];
    const missingCore = coreKeys.filter((k) => !present.has(k));
    if (!missingCore.length) continue;

    // ... rest of logic remains the same
  }
}
```

## Testing

After migration, run:

```bash
# Type check
npm run typecheck

# Test the nutrition engine
npm run -w services/nutrition-engine test

# Test the API
npm run -w apps/api test

# Optional: Run the autofill sweep in dev mode
npm run dev:worker
```

## Benefits of Migration

1. **Data Coverage**: 54 ingredients instead of 25 (2x+ expansion)
2. **Nutrient Completeness**: All 40 nutrients instead of just 5
3. **Data Accuracy**: USDA FoodData Central sourced, verified values
4. **Maintainability**: Centralized data package, easier updates
5. **Type Safety**: Full TypeScript support with NutrientKey type
6. **Scalability**: Easy to add more ingredients/nutrients in future
7. **Documentation**: Built-in metadata and descriptions for each ingredient

## Rollback Plan

If issues arise:

1. Keep the old hardcoded values as a fallback
2. Create a feature flag to toggle between old and new data sources
3. Gradually expand usage as confidence increases

```typescript
const USE_USDA_DATA = process.env.USE_USDA_FALLBACK_DATA !== "false";

function getFallback(ingredientKey: string) {
  if (USE_USDA_DATA) {
    return getFallbackNutrients(ingredientKey);
  } else {
    return ingredientFallbackByKey[ingredientKey];
  }
}
```

## Questions?

Refer to:
- `packages/data/README.md` - Data package documentation
- `packages/data/DATA_SUMMARY.txt` - Detailed ingredient/nutrient inventory
- `packages/contracts/src/nutrients.ts` - Full list of 40 nutrient keys
