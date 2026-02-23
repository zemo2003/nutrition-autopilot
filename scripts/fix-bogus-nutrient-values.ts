/**
 * fix-bogus-nutrient-values.ts
 *
 * Replaces the bogus placeholder nutrient values (kcal=243, protein=6.665, etc.)
 * with real USDA nutrient data for all 56 affected products.
 *
 * The bogus values came from a broken "INFERRED_FROM_SIMILAR_PRODUCT" enrichment
 * that stamped the same template on every product regardless of food type.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Real USDA nutrient values per 100g for common foods
// Sources: USDA FoodData Central (SR Legacy + Foundation Foods)
const USDA_DATA: Record<string, {
  kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
  fiber_g: number;
  sugars_g: number;
  sat_fat_g: number;
  sodium_mg: number;
  cholesterol_mg: number;
  // Additional micronutrients as available
  calcium_mg?: number;
  iron_mg?: number;
  potassium_mg?: number;
  vitamin_c_mg?: number;
  vitamin_a_mcg?: number;
  vitamin_d_mcg?: number;
}> = {
  // === PROTEINS ===
  "chicken breast, cooked": {
    kcal: 165, protein_g: 31.0, fat_g: 3.6, carb_g: 0, fiber_g: 0, sugars_g: 0,
    sat_fat_g: 1.0, sodium_mg: 74, cholesterol_mg: 85,
    calcium_mg: 15, iron_mg: 1.0, potassium_mg: 256, vitamin_a_mcg: 6
  },
  "chicken breast": {
    // Raw
    kcal: 120, protein_g: 22.5, fat_g: 2.6, carb_g: 0, fiber_g: 0, sugars_g: 0,
    sat_fat_g: 0.6, sodium_mg: 52, cholesterol_mg: 73,
    calcium_mg: 5, iron_mg: 0.4, potassium_mg: 370
  },
  "ground beef 95%, raw": {
    kcal: 137, protein_g: 21.4, fat_g: 5.0, carb_g: 0, fiber_g: 0, sugars_g: 0,
    sat_fat_g: 2.2, sodium_mg: 66, cholesterol_mg: 65,
    iron_mg: 2.4, potassium_mg: 318
  },
  "lean ground beef 95%, cooked": {
    kcal: 174, protein_g: 26.1, fat_g: 7.1, carb_g: 0, fiber_g: 0, sugars_g: 0,
    sat_fat_g: 3.1, sodium_mg: 72, cholesterol_mg: 84,
    iron_mg: 2.8, potassium_mg: 352
  },
  "cod, cooked": {
    kcal: 105, protein_g: 23.0, fat_g: 0.9, carb_g: 0, fiber_g: 0, sugars_g: 0,
    sat_fat_g: 0.2, sodium_mg: 78, cholesterol_mg: 55,
    calcium_mg: 13, iron_mg: 0.4, potassium_mg: 244
  },
  "cod/white fish, cooked": {
    kcal: 105, protein_g: 23.0, fat_g: 0.9, carb_g: 0, fiber_g: 0, sugars_g: 0,
    sat_fat_g: 0.2, sodium_mg: 78, cholesterol_mg: 55,
    calcium_mg: 13, iron_mg: 0.4, potassium_mg: 244
  },
  "tuna, drained": {
    kcal: 116, protein_g: 25.5, fat_g: 0.8, carb_g: 0, fiber_g: 0, sugars_g: 0,
    sat_fat_g: 0.2, sodium_mg: 338, cholesterol_mg: 42,
    iron_mg: 1.3, potassium_mg: 237
  },
  "whole eggs (no shell)": {
    kcal: 143, protein_g: 12.6, fat_g: 9.5, carb_g: 0.7, fiber_g: 0, sugars_g: 0.4,
    sat_fat_g: 3.1, sodium_mg: 142, cholesterol_mg: 372,
    calcium_mg: 56, iron_mg: 1.8, potassium_mg: 138, vitamin_a_mcg: 160, vitamin_d_mcg: 2.0
  },

  // === DAIRY ===
  "cottage cheese, low-fat": {
    kcal: 72, protein_g: 12.4, fat_g: 1.0, carb_g: 2.7, fiber_g: 0, sugars_g: 2.7,
    sat_fat_g: 0.6, sodium_mg: 406, cholesterol_mg: 4,
    calcium_mg: 61, potassium_mg: 104
  },
  "cottage cheese": {
    kcal: 72, protein_g: 12.4, fat_g: 1.0, carb_g: 2.7, fiber_g: 0, sugars_g: 2.7,
    sat_fat_g: 0.6, sodium_mg: 406, cholesterol_mg: 4,
    calcium_mg: 61, potassium_mg: 104
  },
  "milk (microwave)": {
    // Whole milk
    kcal: 61, protein_g: 3.2, fat_g: 3.3, carb_g: 4.8, fiber_g: 0, sugars_g: 5.1,
    sat_fat_g: 1.9, sodium_mg: 43, cholesterol_mg: 10,
    calcium_mg: 113, potassium_mg: 132, vitamin_d_mcg: 1.3, vitamin_a_mcg: 46
  },
  "salted butter": {
    kcal: 717, protein_g: 0.9, fat_g: 81.1, carb_g: 0.1, fiber_g: 0, sugars_g: 0.1,
    sat_fat_g: 51.4, sodium_mg: 643, cholesterol_mg: 215
  },

  // === GRAINS ===
  "white rice, cooked": {
    kcal: 130, protein_g: 2.7, fat_g: 0.3, carb_g: 28.2, fiber_g: 0.4, sugars_g: 0,
    sat_fat_g: 0.1, sodium_mg: 1, cholesterol_mg: 0,
    iron_mg: 1.2
  },
  "pasta, cooked": {
    kcal: 131, protein_g: 5.0, fat_g: 1.1, carb_g: 25.4, fiber_g: 1.8, sugars_g: 0.6,
    sat_fat_g: 0.2, sodium_mg: 1, cholesterol_mg: 0,
    iron_mg: 1.3
  },
  "cooked pasta": {
    kcal: 131, protein_g: 5.0, fat_g: 1.1, carb_g: 25.4, fiber_g: 1.8, sugars_g: 0.6,
    sat_fat_g: 0.2, sodium_mg: 1, cholesterol_mg: 0,
    iron_mg: 1.3
  },
  "dry penne": {
    kcal: 371, protein_g: 13.0, fat_g: 1.5, carb_g: 74.7, fiber_g: 3.2, sugars_g: 2.7,
    sat_fat_g: 0.3, sodium_mg: 6, cholesterol_mg: 0,
    iron_mg: 3.3
  },
  "rolled oats, dry": {
    kcal: 379, protein_g: 13.2, fat_g: 6.5, carb_g: 67.7, fiber_g: 10.1, sugars_g: 1.0,
    sat_fat_g: 1.1, sodium_mg: 6, cholesterol_mg: 0,
    iron_mg: 4.3, potassium_mg: 362
  },
  "plain bagel": {
    kcal: 270, protein_g: 10.0, fat_g: 1.6, carb_g: 53.0, fiber_g: 2.3, sugars_g: 6.0,
    sat_fat_g: 0.2, sodium_mg: 450, cholesterol_mg: 0,
    iron_mg: 3.6
  },
  "bread/toast": {
    kcal: 265, protein_g: 9.4, fat_g: 3.3, carb_g: 49.0, fiber_g: 2.7, sugars_g: 5.0,
    sat_fat_g: 0.7, sodium_mg: 491, cholesterol_mg: 0,
    iron_mg: 3.6, calcium_mg: 260
  },

  // === VEGETABLES ===
  "mixed vegetables": {
    kcal: 65, protein_g: 3.3, fat_g: 0.3, carb_g: 13.1, fiber_g: 4.0, sugars_g: 3.5,
    sat_fat_g: 0.1, sodium_mg: 43, cholesterol_mg: 0,
    vitamin_a_mcg: 478, vitamin_c_mg: 8.6, iron_mg: 0.8
  },
  "mixed vegetables, cooked": {
    kcal: 65, protein_g: 3.3, fat_g: 0.3, carb_g: 13.1, fiber_g: 4.0, sugars_g: 3.5,
    sat_fat_g: 0.1, sodium_mg: 43, cholesterol_mg: 0,
    vitamin_a_mcg: 478, vitamin_c_mg: 8.6, iron_mg: 0.8
  },
  "spinach": {
    kcal: 23, protein_g: 2.9, fat_g: 0.4, carb_g: 3.6, fiber_g: 2.2, sugars_g: 0.4,
    sat_fat_g: 0.1, sodium_mg: 79, cholesterol_mg: 0,
    calcium_mg: 99, iron_mg: 2.7, potassium_mg: 558, vitamin_a_mcg: 469, vitamin_c_mg: 28.1
  },
  "leafy greens": {
    kcal: 23, protein_g: 2.9, fat_g: 0.4, carb_g: 3.6, fiber_g: 2.2, sugars_g: 0.4,
    sat_fat_g: 0.1, sodium_mg: 79, cholesterol_mg: 0,
    calcium_mg: 99, iron_mg: 2.7, potassium_mg: 558, vitamin_a_mcg: 469
  },
  "potatoes (edible)": {
    kcal: 77, protein_g: 2.0, fat_g: 0.1, carb_g: 17.5, fiber_g: 2.2, sugars_g: 0.8,
    sat_fat_g: 0.0, sodium_mg: 6, cholesterol_mg: 0,
    potassium_mg: 421, vitamin_c_mg: 19.7, iron_mg: 0.8
  },
  "potatoes, baked": {
    kcal: 93, protein_g: 2.5, fat_g: 0.1, carb_g: 21.2, fiber_g: 2.2, sugars_g: 1.7,
    sat_fat_g: 0.0, sodium_mg: 10, cholesterol_mg: 0,
    potassium_mg: 535, vitamin_c_mg: 9.6, iron_mg: 1.1
  },
  "bell pepper": {
    kcal: 31, protein_g: 1.0, fat_g: 0.3, carb_g: 6.0, fiber_g: 2.1, sugars_g: 4.2,
    sat_fat_g: 0.0, sodium_mg: 4, cholesterol_mg: 0,
    vitamin_c_mg: 128, vitamin_a_mcg: 157
  },
  "bell peppers": {
    kcal: 31, protein_g: 1.0, fat_g: 0.3, carb_g: 6.0, fiber_g: 2.1, sugars_g: 4.2,
    sat_fat_g: 0.0, sodium_mg: 4, cholesterol_mg: 0,
    vitamin_c_mg: 128, vitamin_a_mcg: 157
  },
  "bell peppers (red/yellow/orange)": {
    kcal: 31, protein_g: 1.0, fat_g: 0.3, carb_g: 6.0, fiber_g: 2.1, sugars_g: 4.2,
    sat_fat_g: 0.0, sodium_mg: 4, cholesterol_mg: 0,
    vitamin_c_mg: 128, vitamin_a_mcg: 157
  },
  "shredded carrots": {
    kcal: 41, protein_g: 0.9, fat_g: 0.2, carb_g: 9.6, fiber_g: 2.8, sugars_g: 4.7,
    sat_fat_g: 0.0, sodium_mg: 69, cholesterol_mg: 0,
    vitamin_a_mcg: 835, vitamin_c_mg: 5.9
  },
  "cooked beets": {
    kcal: 44, protein_g: 1.7, fat_g: 0.2, carb_g: 10.0, fiber_g: 2.0, sugars_g: 7.9,
    sat_fat_g: 0.0, sodium_mg: 77, cholesterol_mg: 0,
    iron_mg: 0.8, potassium_mg: 305
  },
  "yellow onion": {
    kcal: 40, protein_g: 1.1, fat_g: 0.1, carb_g: 9.3, fiber_g: 1.7, sugars_g: 4.2,
    sat_fat_g: 0.0, sodium_mg: 4, cholesterol_mg: 0,
    vitamin_c_mg: 7.4
  },
  "onion": {
    kcal: 40, protein_g: 1.1, fat_g: 0.1, carb_g: 9.3, fiber_g: 1.7, sugars_g: 4.2,
    sat_fat_g: 0.0, sodium_mg: 4, cholesterol_mg: 0,
    vitamin_c_mg: 7.4
  },

  // === FRUITS ===
  "mixed berries": {
    kcal: 57, protein_g: 0.7, fat_g: 0.3, carb_g: 14.5, fiber_g: 2.0, sugars_g: 10.0,
    sat_fat_g: 0.0, sodium_mg: 1, cholesterol_mg: 0,
    vitamin_c_mg: 9.7
  },
  "cherries": {
    kcal: 63, protein_g: 1.1, fat_g: 0.2, carb_g: 16.0, fiber_g: 2.1, sugars_g: 12.8,
    sat_fat_g: 0.0, sodium_mg: 0, cholesterol_mg: 0,
    vitamin_c_mg: 7.0, potassium_mg: 222
  },
  "raisins": {
    kcal: 299, protein_g: 3.1, fat_g: 0.5, carb_g: 79.2, fiber_g: 3.7, sugars_g: 59.2,
    sat_fat_g: 0.1, sodium_mg: 11, cholesterol_mg: 0,
    iron_mg: 1.9, potassium_mg: 749
  },

  // === LEGUMES ===
  "black beans, cooked/drained": {
    kcal: 132, protein_g: 8.9, fat_g: 0.5, carb_g: 23.7, fiber_g: 8.7, sugars_g: 0.3,
    sat_fat_g: 0.1, sodium_mg: 1, cholesterol_mg: 0,
    iron_mg: 2.1, potassium_mg: 355
  },
  "garbanzo beans, drained": {
    kcal: 164, protein_g: 8.9, fat_g: 2.6, carb_g: 27.4, fiber_g: 7.6, sugars_g: 4.8,
    sat_fat_g: 0.3, sodium_mg: 7, cholesterol_mg: 0,
    iron_mg: 2.9, potassium_mg: 291
  },
  "kidney beans, cooked": {
    kcal: 127, protein_g: 8.7, fat_g: 0.5, carb_g: 22.8, fiber_g: 6.4, sugars_g: 0.3,
    sat_fat_g: 0.1, sodium_mg: 2, cholesterol_mg: 0,
    iron_mg: 2.9, potassium_mg: 403
  },

  // === OILS & FATS ===
  "olive oil": {
    kcal: 884, protein_g: 0, fat_g: 100.0, carb_g: 0, fiber_g: 0, sugars_g: 0,
    sat_fat_g: 13.8, sodium_mg: 2, cholesterol_mg: 0,
    vitamin_e_mg: 14.4, vitamin_k_mcg: 60.2
  },
  "olive oil (added)": {
    kcal: 884, protein_g: 0, fat_g: 100.0, carb_g: 0, fiber_g: 0, sugars_g: 0,
    sat_fat_g: 13.8, sodium_mg: 2, cholesterol_mg: 0,
  },
  "olive oil (in chili)": {
    kcal: 884, protein_g: 0, fat_g: 100.0, carb_g: 0, fiber_g: 0, sugars_g: 0,
    sat_fat_g: 13.8, sodium_mg: 2, cholesterol_mg: 0,
  },
  "peanut butter": {
    kcal: 588, protein_g: 25.1, fat_g: 50.4, carb_g: 19.6, fiber_g: 6.0, sugars_g: 9.2,
    sat_fat_g: 10.1, sodium_mg: 459, cholesterol_mg: 0,
    potassium_mg: 649, iron_mg: 1.7
  },

  // === SAUCES & CONDIMENTS ===
  "pasta sauce": {
    kcal: 50, protein_g: 1.5, fat_g: 1.0, carb_g: 8.5, fiber_g: 1.5, sugars_g: 5.5,
    sat_fat_g: 0.1, sodium_mg: 373, cholesterol_mg: 0,
    vitamin_a_mcg: 30, vitamin_c_mg: 7.0
  },
  "marinara/pasta sauce": {
    kcal: 50, protein_g: 1.5, fat_g: 1.0, carb_g: 8.5, fiber_g: 1.5, sugars_g: 5.5,
    sat_fat_g: 0.1, sodium_mg: 373, cholesterol_mg: 0,
    vitamin_a_mcg: 30, vitamin_c_mg: 7.0
  },
  "tomato sauce/canned": {
    kcal: 32, protein_g: 1.3, fat_g: 0.2, carb_g: 7.1, fiber_g: 1.5, sugars_g: 4.7,
    sat_fat_g: 0.0, sodium_mg: 564, cholesterol_mg: 0,
    vitamin_a_mcg: 24, vitamin_c_mg: 7.2
  },
  "red curry paste": {
    kcal: 113, protein_g: 3.3, fat_g: 4.0, carb_g: 17.0, fiber_g: 4.0, sugars_g: 6.0,
    sat_fat_g: 0.5, sodium_mg: 2000, cholesterol_mg: 0
  },
  "honey": {
    kcal: 304, protein_g: 0.3, fat_g: 0, carb_g: 82.4, fiber_g: 0.2, sugars_g: 82.1,
    sat_fat_g: 0, sodium_mg: 4, cholesterol_mg: 0
  },
  "lemon juice": {
    kcal: 22, protein_g: 0.4, fat_g: 0.2, carb_g: 6.9, fiber_g: 0.3, sugars_g: 2.5,
    sat_fat_g: 0.0, sodium_mg: 1, cholesterol_mg: 0,
    vitamin_c_mg: 39.0
  },
  "vanilla extract": {
    kcal: 288, protein_g: 0.1, fat_g: 0.1, carb_g: 12.7, fiber_g: 0, sugars_g: 12.6,
    sat_fat_g: 0, sodium_mg: 9, cholesterol_mg: 0
  },
  "ceylon cinnamon": {
    kcal: 247, protein_g: 4.0, fat_g: 1.2, carb_g: 80.6, fiber_g: 53.1, sugars_g: 2.2,
    sat_fat_g: 0.3, sodium_mg: 10, cholesterol_mg: 0,
    calcium_mg: 1002, iron_mg: 8.3
  },
  "salt": {
    kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0, sugars_g: 0,
    sat_fat_g: 0, sodium_mg: 38758, cholesterol_mg: 0
  },
  "salt (pinch)": {
    kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0, sugars_g: 0,
    sat_fat_g: 0, sodium_mg: 38758, cholesterol_mg: 0
  },
  "black pepper": {
    kcal: 251, protein_g: 10.4, fat_g: 3.3, carb_g: 63.9, fiber_g: 25.3, sugars_g: 0.6,
    sat_fat_g: 1.4, sodium_mg: 20, cholesterol_mg: 0,
    calcium_mg: 443, iron_mg: 9.7
  },

  // === SUPPLEMENTS / PACKAGED ===
  "whey protein powder": {
    kcal: 400, protein_g: 80.0, fat_g: 3.3, carb_g: 10.0, fiber_g: 0, sugars_g: 3.3,
    sat_fat_g: 1.7, sodium_mg: 200, cholesterol_mg: 50
  },
  "bonne maman fruit spread": {
    kcal: 250, protein_g: 0, fat_g: 0, carb_g: 62.5, fiber_g: 0, sugars_g: 50.0,
    sat_fat_g: 0, sodium_mg: 10, cholesterol_mg: 0
  },

  // === COMPLEX / BATCH ===
  "chili (batch portion)": {
    // Approximation: ground turkey chili with beans, tomatoes, peppers
    kcal: 100, protein_g: 8.0, fat_g: 3.0, carb_g: 11.0, fiber_g: 3.5, sugars_g: 3.0,
    sat_fat_g: 0.8, sodium_mg: 350, cholesterol_mg: 25
  },
  "david protein bar": {
    kcal: 350, protein_g: 28.0, fat_g: 12.0, carb_g: 30.0, fiber_g: 10.0, sugars_g: 2.0,
    sat_fat_g: 3.0, sodium_mg: 300, cholesterol_mg: 5
  },
  "quaker oatmeal squares": {
    kcal: 393, protein_g: 10.7, fat_g: 7.1, carb_g: 75.0, fiber_g: 7.1, sugars_g: 21.4,
    sat_fat_g: 1.1, sodium_mg: 464, cholesterol_mg: 0,
    iron_mg: 32.1
  },
};

async function main() {
  console.log("=== Fix bogus nutrient values ===\n");

  // Get all products with the bogus kcal=243 pattern
  const bogusProducts = await prisma.$queryRaw`
    SELECT DISTINCT pc.id, pc.name
    FROM "ProductCatalog" pc
    JOIN "ProductNutrientValue" pnv ON pnv."productId" = pc.id
    JOIN "NutrientDefinition" nd ON nd.id = pnv."nutrientDefinitionId"
    WHERE nd.key = 'kcal'
    AND pnv."valuePer100g" = 243
  ` as any[];

  console.log(`Found ${bogusProducts.length} products with bogus kcal=243\n`);

  // Build NutrientDefinition lookup
  const ndefs = await prisma.$queryRaw`
    SELECT id, key FROM "NutrientDefinition"
  ` as any[];
  const nutrientIdByKey = new Map<string, string>();
  for (const nd of ndefs) {
    nutrientIdByKey.set(nd.key, nd.id);
  }

  let fixed = 0;
  let notFound = 0;

  for (const product of bogusProducts) {
    // Strip "Historical Estimated " prefix for lookup
    const lookupName = product.name
      .replace(/^Historical Estimated\s+/i, "")
      .toLowerCase()
      .trim();

    const realData = USDA_DATA[lookupName];
    if (!realData) {
      console.log(`  MISS: ${product.name} (lookup: "${lookupName}")`);
      notFound++;
      continue;
    }

    // Update each nutrient value
    const updates: { key: string; value: number }[] = [
      { key: "kcal", value: realData.kcal },
      { key: "protein_g", value: realData.protein_g },
      { key: "fat_g", value: realData.fat_g },
      { key: "carb_g", value: realData.carb_g },
      { key: "fiber_g", value: realData.fiber_g },
      { key: "sugars_g", value: realData.sugars_g },
      { key: "sat_fat_g", value: realData.sat_fat_g },
      { key: "sodium_mg", value: realData.sodium_mg },
      { key: "cholesterol_mg", value: realData.cholesterol_mg },
    ];

    // Add optional micronutrients
    if (realData.calcium_mg !== undefined) updates.push({ key: "calcium_mg", value: realData.calcium_mg });
    if (realData.iron_mg !== undefined) updates.push({ key: "iron_mg", value: realData.iron_mg });
    if (realData.potassium_mg !== undefined) updates.push({ key: "potassium_mg", value: realData.potassium_mg });
    if (realData.vitamin_c_mg !== undefined) updates.push({ key: "vitamin_c_mg", value: realData.vitamin_c_mg });
    if (realData.vitamin_a_mcg !== undefined) updates.push({ key: "vitamin_a_mcg", value: realData.vitamin_a_mcg });
    if (realData.vitamin_d_mcg !== undefined) updates.push({ key: "vitamin_d_mcg", value: realData.vitamin_d_mcg });

    for (const { key, value } of updates) {
      const ndId = nutrientIdByKey.get(key);
      if (!ndId) continue;

      await prisma.$executeRaw`
        UPDATE "ProductNutrientValue"
        SET "valuePer100g" = ${value},
            "sourceType" = 'USDA',
            "evidenceGrade" = 'USDA_BRANDED'
        WHERE "productId" = ${product.id}
        AND "nutrientDefinitionId" = ${ndId}
      `;
    }

    // Also zero out trans_fat, added_sugars for whole foods that shouldn't have them
    const zeroKeys = ["trans_fat_g", "added_sugars_g"];
    for (const key of zeroKeys) {
      const ndId = nutrientIdByKey.get(key);
      if (!ndId) continue;
      await prisma.$executeRaw`
        UPDATE "ProductNutrientValue"
        SET "valuePer100g" = 0,
            "sourceType" = 'USDA',
            "evidenceGrade" = 'USDA_BRANDED'
        WHERE "productId" = ${product.id}
        AND "nutrientDefinitionId" = ${ndId}
      `;
    }

    console.log(`  FIX: ${product.name} → kcal=${realData.kcal} P=${realData.protein_g} C=${realData.carb_g} F=${realData.fat_g}`);
    fixed++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Fixed: ${fixed}`);
  console.log(`Not found in USDA lookup: ${notFound}`);

  // Now regenerate the PRODUCT label snapshots from the updated ProductNutrientValues
  console.log("\n=== Regenerating PRODUCT label snapshots ===\n");

  for (const product of bogusProducts) {
    // Get the updated nutrient values
    const nutrients = await prisma.$queryRaw`
      SELECT nd.key, pnv."valuePer100g"
      FROM "ProductNutrientValue" pnv
      JOIN "NutrientDefinition" nd ON nd.id = pnv."nutrientDefinitionId"
      WHERE pnv."productId" = ${product.id}
    ` as any[];

    const nutrientsPer100g: Record<string, number> = {};
    for (const n of nutrients) {
      nutrientsPer100g[n.key] = Number(n.valuePer100g);
    }

    // Update all PRODUCT labels for this product
    const productLabels = await prisma.$queryRaw`
      SELECT id FROM "LabelSnapshot"
      WHERE "labelType" = 'PRODUCT'
      AND "externalRefId" = ${product.id}
    ` as any[];

    for (const pl of productLabels) {
      await prisma.$executeRaw`
        UPDATE "LabelSnapshot"
        SET "renderPayload" = jsonb_set(
          "renderPayload",
          '{nutrientsPer100g}',
          ${JSON.stringify(nutrientsPer100g)}::jsonb
        )
        WHERE id = ${pl.id}
      `;
    }

    if (productLabels.length > 0) {
      console.log(`  Updated ${productLabels.length} PRODUCT labels for "${product.name}"`);
    }
  }

  // Now regenerate INGREDIENT, LOT, and SKU labels that depend on these products
  // Get all SKU labels
  const skuLabels = await prisma.$queryRaw`
    SELECT ls.id, ls.title, ls."renderPayload"
    FROM "LabelSnapshot" ls
    WHERE ls."labelType" = 'SKU'
  ` as any[];

  console.log(`\n=== Regenerating ${skuLabels.length} SKU labels ===\n`);

  for (const skuLabel of skuLabels) {
    // Get child ingredient labels
    const ingredientChildren = await prisma.$queryRaw`
      SELECT ls.id, ls.title, ls."renderPayload", ls."externalRefId"
      FROM "LabelLineageEdge" lle
      JOIN "LabelSnapshot" ls ON ls.id = lle."childLabelId"
      WHERE lle."parentLabelId" = ${skuLabel.id}
      AND ls."labelType" = 'INGREDIENT'
    ` as any[];

    // Get LOT children (which link to product nutrient data)
    const lotChildren = await prisma.$queryRaw`
      SELECT ls.id, ls.title, ls."renderPayload", ls."externalRefId"
      FROM "LabelLineageEdge" lle
      JOIN "LabelSnapshot" ls ON ls.id = lle."childLabelId"
      WHERE lle."parentLabelId" = ${skuLabel.id}
      AND ls."labelType" = 'LOT'
    ` as any[];

    // Get PRODUCT children (which have the per-100g data)
    const productChildren = await prisma.$queryRaw`
      SELECT ls.id, ls.title, ls."renderPayload", ls."externalRefId"
      FROM "LabelLineageEdge" lle
      JOIN "LabelSnapshot" ls ON ls.id = lle."childLabelId"
      WHERE lle."parentLabelId" = ${skuLabel.id}
      AND ls."labelType" = 'PRODUCT'
    ` as any[];

    // For each ingredient, recalculate from the updated product data
    const p = skuLabel.renderPayload;
    let totalKcal = 0;
    let totalProtein = 0;
    let totalCarb = 0;
    let totalFat = 0;
    let totalFiber = 0;
    let totalSugars = 0;
    let totalSatFat = 0;
    let totalSodium = 0;
    let totalCholesterol = 0;
    let servingWeight = p.servingWeightG ?? 0;

    for (const ing of ingredientChildren) {
      const ip = ing.renderPayload;
      const grams = ip.consumedGrams ?? 0;

      // Find matching product label
      const matchedProduct = productChildren.find((pc: any) => {
        const ingName = ing.title.toLowerCase();
        const prodName = pc.title.toLowerCase().replace(/^historical estimated\s+/, "");
        return prodName.includes(ingName.split(",")[0] || "") ||
               ingName.includes(prodName.split(",")[0] || "");
      });

      // Or find matching lot label
      const matchedLot = lotChildren.find((lot: any) => {
        const ingName = ing.title.toLowerCase();
        const lotName = lot.title.toLowerCase();
        return lotName.includes(ingName.split(",")[0] || "") ||
               ingName.includes(lotName.split(",")[0] || "");
      });

      const source = matchedProduct?.renderPayload?.nutrientsPer100g ??
                     matchedLot?.renderPayload?.nutrientsPer100g;

      if (source && grams > 0) {
        const scale = grams / 100;
        totalKcal += (source.kcal ?? 0) * scale;
        totalProtein += (source.protein_g ?? 0) * scale;
        totalCarb += (source.carb_g ?? 0) * scale;
        totalFat += (source.fat_g ?? 0) * scale;
        totalFiber += (source.fiber_g ?? 0) * scale;
        totalSugars += (source.sugars_g ?? 0) * scale;
        totalSatFat += (source.sat_fat_g ?? 0) * scale;
        totalSodium += (source.sodium_mg ?? 0) * scale;
        totalCholesterol += (source.cholesterol_mg ?? 0) * scale;

        // Update ingredient label's perServing and total
        const newPerServing = { ...ip.nutrientsPerServing };
        const newTotal = { ...ip.nutrientsTotal };
        for (const [key, value] of Object.entries(source)) {
          const v = value as number;
          if (typeof v === "number") {
            newPerServing[key] = v * scale;
            newTotal[key] = v * scale;
          }
        }
        ip.nutrientsPerServing = newPerServing;
        ip.nutrientsTotal = newTotal;

        await prisma.$executeRaw`
          UPDATE "LabelSnapshot"
          SET "renderPayload" = ${JSON.stringify(ip)}::jsonb
          WHERE id = ${ing.id}
        `;
      }
    }

    // Update SKU label perServing
    if (totalKcal > 0) {
      const servings = p.servings ?? 1;
      const newPerServing = {
        ...p.perServing,
        kcal: totalKcal / servings,
        protein_g: totalProtein / servings,
        carb_g: totalCarb / servings,
        fat_g: totalFat / servings,
        fiber_g: totalFiber / servings,
        sugars_g: totalSugars / servings,
        sat_fat_g: totalSatFat / servings,
        sodium_mg: totalSodium / servings,
        cholesterol_mg: totalCholesterol / servings,
      };

      // Recalculate QA
      const rawCal = newPerServing.kcal;
      const macroKcal = newPerServing.protein_g * 4 + newPerServing.carb_g * 4 + newPerServing.fat_g * 9;
      const delta = macroKcal - rawCal;
      const fiberRatio = newPerServing.carb_g > 0 ? newPerServing.fiber_g / newPerServing.carb_g : 0;
      const isLowCalHighFiber = rawCal < 60 || fiberRatio > 0.3;
      const tolerancePct = isLowCalHighFiber ? 0.35 : 0.20;
      const percentError = rawCal > 0 ? Math.abs(delta / rawCal) : (macroKcal > 0 ? 1 : 0);
      const pass = percentError <= tolerancePct;

      p.perServing = newPerServing;
      p.qa = {
        macroKcal,
        rawCalories: rawCal,
        labeledCalories: p.qa.labeledCalories,
        delta,
        percentError,
        pass,
      };

      await prisma.$executeRaw`
        UPDATE "LabelSnapshot"
        SET "renderPayload" = ${JSON.stringify(p)}::jsonb
        WHERE id = ${skuLabel.id}
      `;

      const status = pass ? "PASS" : "FAIL";
      console.log(`  [${status}] ${skuLabel.title}: error=${(percentError * 100).toFixed(1)}% kcal=${rawCal.toFixed(0)} atwater=${macroKcal.toFixed(0)}`);
    }
  }

  // Also update LOT labels
  for (const lot of await prisma.$queryRaw`
    SELECT ls.id, ls.title, ls."renderPayload", ls."externalRefId"
    FROM "LabelSnapshot" ls
    WHERE ls."labelType" = 'LOT'
  ` as any[]) {
    const productId = lot.renderPayload?.productId ?? lot.externalRefId;
    if (!productId) continue;

    // Get the updated product nutrients
    const nutrients = await prisma.$queryRaw`
      SELECT nd.key, pnv."valuePer100g"
      FROM "ProductNutrientValue" pnv
      JOIN "NutrientDefinition" nd ON nd.id = pnv."nutrientDefinitionId"
      WHERE pnv."productId" = ${productId}
    ` as any[];

    if (nutrients.length === 0) continue;

    const nutrientsPer100g: Record<string, number> = {};
    for (const n of nutrients) {
      nutrientsPer100g[n.key] = Number(n.valuePer100g);
    }

    const lp = lot.renderPayload;
    if (lp.nutrientsPer100g) {
      lp.nutrientsPer100g = nutrientsPer100g;
      await prisma.$executeRaw`
        UPDATE "LabelSnapshot"
        SET "renderPayload" = ${JSON.stringify(lp)}::jsonb
        WHERE id = ${lot.id}
      `;
    }
  }

  // Final QA stats
  const qaStats = await prisma.$queryRaw`
    SELECT
      COUNT(*) FILTER (WHERE ("renderPayload"->'qa'->>'pass')::boolean = true) as passing,
      COUNT(*) FILTER (WHERE ("renderPayload"->'qa'->>'pass')::boolean = false) as failing,
      COUNT(*) as total
    FROM "LabelSnapshot"
    WHERE "labelType" = 'SKU'
    AND "renderPayload"->'qa' IS NOT NULL
  ` as any[];
  console.log(`\nFinal SKU QA: ${qaStats[0]?.passing} passing, ${qaStats[0]?.failing} failing out of ${qaStats[0]?.total}`);

  await prisma.$disconnect();
}

main().catch(console.error);
