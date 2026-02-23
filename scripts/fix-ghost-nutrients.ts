/**
 * fix-ghost-nutrients.ts
 *
 * Repairs ProductNutrientValue rows where sub-component nutrients
 * (sat_fat_g, sugars_g, fiber_g, added_sugars_g) have values but their
 * parent macro (fat_g, carb_g) is missing or near-zero.
 *
 * Strategy:
 *  1. Find all products where sat_fat_g > 0 but fat_g is missing or near-zero
 *  2. Find all products where sugars_g > 0 or fiber_g > 0 but carb_g is missing or near-zero
 *  3. Promote parent macro to sum of children
 *  4. Recalculate kcal from Atwater factors where kcal is implausibly low
 *
 * Also fixes animal-protein products with impossible carb/fiber values.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ANIMAL_PROTEIN_KEYS = [
  "chicken", "beef", "turkey", "salmon", "cod", "tuna",
  "fish", "pork", "lamb", "shrimp", "tilapia", "halibut"
];

const ANIMAL_EXCLUSIONS = [
  "bar", "bread", "bagel", "tortilla", "pasta", "rice",
  "bean", "yogurt", "cheese", "milk", "whey", "sausage",
  "nugget", "breaded", "sauce", "jerky", "drink"
];

function isAnimalProtein(name: string): boolean {
  const lower = name.toLowerCase();
  const hasToken = ANIMAL_PROTEIN_KEYS.some((t) => lower.includes(t));
  if (!hasToken) return false;
  const hasExclusion = ANIMAL_EXCLUSIONS.some((e) => lower.includes(e));
  return !hasExclusion;
}

async function main() {
  console.log("=== Ghost Nutrient Repair Script ===\n");

  // Step 1: Get all products with their nutrient values
  const products = await prisma.productCatalog.findMany({
    include: {
      nutrients: {
        include: { nutrientDefinition: true }
      },
      ingredient: true
    }
  });

  console.log(`Total products: ${products.length}`);

  let fatPromotions = 0;
  let carbPromotions = 0;
  let kcalFixes = 0;
  let animalCarbZeroed = 0;
  let addedSugarCapped = 0;
  const upserts: Array<Promise<any>> = [];

  for (const product of products) {
    const nutrientMap = new Map<string, { id: string; value: number; defId: string }>();
    const nutrientDefIds = new Map<string, string>();

    for (const n of product.nutrients) {
      const key = n.nutrientDefinition.key;
      nutrientDefIds.set(key, n.nutrientDefinitionId);
      if (typeof n.valuePer100g === "number") {
        nutrientMap.set(key, { id: n.id, value: n.valuePer100g, defId: n.nutrientDefinitionId });
      }
    }

    const fatG = nutrientMap.get("fat_g")?.value ?? 0;
    const satFatG = nutrientMap.get("sat_fat_g")?.value ?? 0;
    const transFatG = nutrientMap.get("trans_fat_g")?.value ?? 0;
    const carbG = nutrientMap.get("carb_g")?.value ?? 0;
    const sugarsG = nutrientMap.get("sugars_g")?.value ?? 0;
    const fiberG = nutrientMap.get("fiber_g")?.value ?? 0;
    const addedSugarsG = nutrientMap.get("added_sugars_g")?.value ?? 0;
    const proteinG = nutrientMap.get("protein_g")?.value ?? 0;
    const kcal = nutrientMap.get("kcal")?.value ?? 0;
    const productName = product.name;
    const animalProtein = isAnimalProtein(productName);

    // Fix 1: Animal protein carb/fiber/sugar zeroing
    if (animalProtein) {
      for (const key of ["carb_g", "fiber_g", "sugars_g", "added_sugars_g"]) {
        const existing = nutrientMap.get(key);
        if (existing && existing.value > 0.5) {
          console.log(`  ANIMAL ZERO: ${productName} ${key}=${existing.value} → 0`);
          upserts.push(
            prisma.productNutrientValue.update({
              where: { id: existing.id },
              data: {
                valuePer100g: 0,
                sourceRef: "repair:animal-protein-zero-carb",
                verificationStatus: "NEEDS_REVIEW"
              }
            })
          );
          animalCarbZeroed++;
        }
      }
      // Skip further hierarchy fixes for animal proteins — we just zeroed everything
      continue;
    }

    // Fix 2: Fat hierarchy — promote fat_g if sat_fat + trans_fat > fat_g
    const fatFloor = satFatG + transFatG;
    if (fatFloor > fatG + 0.01) {
      const fatDefId = nutrientDefIds.get("fat_g");
      if (fatDefId) {
        console.log(`  FAT PROMOTE: ${productName} fat_g ${fatG} → ${fatFloor} (sat=${satFatG} trans=${transFatG})`);
        const existing = nutrientMap.get("fat_g");
        if (existing) {
          upserts.push(
            prisma.productNutrientValue.update({
              where: { id: existing.id },
              data: {
                valuePer100g: fatFloor,
                sourceRef: "repair:hierarchy-fat-promote",
                verificationStatus: "NEEDS_REVIEW"
              }
            })
          );
        } else {
          upserts.push(
            prisma.productNutrientValue.create({
              data: {
                productId: product.id,
                nutrientDefinitionId: fatDefId,
                valuePer100g: fatFloor,
                sourceType: "DERIVED",
                sourceRef: "repair:hierarchy-fat-promote",
                evidenceGrade: "INFERRED_FROM_INGREDIENT",
                confidenceScore: 0.5,
                verificationStatus: "NEEDS_REVIEW",
                historicalException: false
              }
            })
          );
        }
        fatPromotions++;
      }
    }

    // Fix 3: Carb hierarchy — promote carb_g if sugars or fiber exceed it
    const carbFloor = Math.max(sugarsG, fiberG, sugarsG + fiberG);
    if (carbFloor > carbG + 0.01) {
      const carbDefId = nutrientDefIds.get("carb_g");
      if (carbDefId) {
        console.log(`  CARB PROMOTE: ${productName} carb_g ${carbG} → ${carbFloor} (sugars=${sugarsG} fiber=${fiberG})`);
        const existing = nutrientMap.get("carb_g");
        if (existing) {
          upserts.push(
            prisma.productNutrientValue.update({
              where: { id: existing.id },
              data: {
                valuePer100g: carbFloor,
                sourceRef: "repair:hierarchy-carb-promote",
                verificationStatus: "NEEDS_REVIEW"
              }
            })
          );
        } else {
          upserts.push(
            prisma.productNutrientValue.create({
              data: {
                productId: product.id,
                nutrientDefinitionId: carbDefId,
                valuePer100g: carbFloor,
                sourceType: "DERIVED",
                sourceRef: "repair:hierarchy-carb-promote",
                evidenceGrade: "INFERRED_FROM_INGREDIENT",
                confidenceScore: 0.5,
                verificationStatus: "NEEDS_REVIEW",
                historicalException: false
              }
            })
          );
        }
        carbPromotions++;
      }
    }

    // Fix 4: Added sugars > sugars
    if (addedSugarsG > sugarsG + 0.01) {
      const existing = nutrientMap.get("added_sugars_g");
      if (existing) {
        console.log(`  ADDED_SUGAR CAP: ${productName} added_sugars_g ${addedSugarsG} → ${sugarsG}`);
        upserts.push(
          prisma.productNutrientValue.update({
            where: { id: existing.id },
            data: {
              valuePer100g: sugarsG,
              sourceRef: "repair:hierarchy-added-sugar-cap",
              verificationStatus: "NEEDS_REVIEW"
            }
          })
        );
        addedSugarCapped++;
      }
    }

    // Fix 5: kcal sanity — if macros give much more than reported kcal
    const effectiveFat = Math.max(fatG, fatFloor);
    const effectiveCarb = Math.max(carbG, carbFloor);
    const atwaterKcal = proteinG * 4 + effectiveCarb * 4 + effectiveFat * 9;
    if (kcal > 0 && atwaterKcal > 0 && kcal < atwaterKcal * 0.5) {
      const existing = nutrientMap.get("kcal");
      if (existing) {
        const newKcal = Math.round(atwaterKcal * 10) / 10;
        console.log(`  KCAL FIX: ${productName} kcal ${kcal} → ${newKcal} (atwater=${atwaterKcal.toFixed(1)})`);
        upserts.push(
          prisma.productNutrientValue.update({
            where: { id: existing.id },
            data: {
              valuePer100g: newKcal,
              sourceRef: "repair:kcal-atwater-floor",
              verificationStatus: "NEEDS_REVIEW"
            }
          })
        );
        kcalFixes++;
      }
    }
  }

  console.log(`\n=== Applying ${upserts.length} DB writes ===`);
  // Execute in batches of 50
  for (let i = 0; i < upserts.length; i += 50) {
    await Promise.all(upserts.slice(i, i + 50));
    console.log(`  Batch ${Math.floor(i / 50) + 1} complete (${Math.min(i + 50, upserts.length)}/${upserts.length})`);
  }

  console.log("\n=== Summary ===");
  console.log(`Fat promotions (sat_fat > fat): ${fatPromotions}`);
  console.log(`Carb promotions (sugars/fiber > carb): ${carbPromotions}`);
  console.log(`Added sugar caps: ${addedSugarCapped}`);
  console.log(`Kcal Atwater fixes: ${kcalFixes}`);
  console.log(`Animal protein carb zeroed: ${animalCarbZeroed}`);
  console.log(`Total DB writes: ${upserts.length}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
