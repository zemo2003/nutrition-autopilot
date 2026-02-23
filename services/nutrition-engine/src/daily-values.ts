/**
 * FDA Daily Values Reference Module
 * Authoritative source for FDA 2020 Updated Daily Values (effective Jan 1, 2020)
 * Reference: 21 CFR 101.9, FDA Guidance Document
 *
 * This module provides the complete set of daily value definitions per FDA regulations
 * and helper functions for %DV calculations and nutrient filtering.
 */

import type { NutrientKey } from "@nutrition/contracts";

/**
 * Daily Value entry definition
 * Encodes all metadata required for FDA-compliant nutrition labeling
 */
export type DailyValueEntry = {
  /** Nutrient identifier key */
  key: NutrientKey;
  /** Human-readable label for display */
  label: string;
  /** Unit of measurement: kcal, g, mg, or mcg */
  unit: "kcal" | "g" | "mg" | "mcg";
  /** FDA reference daily value for %DV calculation */
  dailyValue: number;
  /** Whether this nutrient is mandatory on all FDA nutrition labels */
  fdaMandatory: boolean;
  /** Display order on nutrition facts panel (ascending) */
  displayOrder: number;
  /** Name of the rounding function to apply (from rounding.ts) */
  roundingFn: string;
  /** CFR section reference for compliance tracking */
  cfrReference: string;
};

/**
 * Complete FDA Daily Values (2020 Updated)
 * Effective January 1, 2020 per FDA regulations
 * Reference: 85 FR 82779 (December 19, 2016)
 */
export const FDA_DAILY_VALUES: Record<NutrientKey, DailyValueEntry> = {
  // ========================================================================
  // MACRONUTRIENTS & ENERGY (21 CFR 101.9(c)(1))
  // ========================================================================

  kcal: {
    key: "kcal",
    label: "Calories",
    unit: "kcal",
    dailyValue: 2000,
    fdaMandatory: true,
    displayOrder: 1,
    roundingFn: "roundCalories",
    cfrReference: "21 CFR 101.9(c)(1)",
  },

  fat_g: {
    key: "fat_g",
    label: "Total Fat",
    unit: "g",
    dailyValue: 78,
    fdaMandatory: true,
    displayOrder: 3,
    roundingFn: "roundFatLike",
    cfrReference: "21 CFR 101.9(c)(2)",
  },

  sat_fat_g: {
    key: "sat_fat_g",
    label: "Saturated Fat",
    unit: "g",
    dailyValue: 20,
    fdaMandatory: true,
    displayOrder: 4,
    roundingFn: "roundFatLike",
    cfrReference: "21 CFR 101.9(c)(2)",
  },

  trans_fat_g: {
    key: "trans_fat_g",
    label: "Trans Fat",
    unit: "g",
    dailyValue: 0, // No DV established
    fdaMandatory: true,
    displayOrder: 5,
    roundingFn: "roundFatLike",
    cfrReference: "21 CFR 101.9(c)(2)(ii)",
  },

  cholesterol_mg: {
    key: "cholesterol_mg",
    label: "Cholesterol",
    unit: "mg",
    dailyValue: 300,
    fdaMandatory: true,
    displayOrder: 6,
    roundingFn: "roundCholesterolMg",
    cfrReference: "21 CFR 101.9(c)(2)(iii)",
  },

  sodium_mg: {
    key: "sodium_mg",
    label: "Sodium",
    unit: "mg",
    dailyValue: 2300,
    fdaMandatory: true,
    displayOrder: 7,
    roundingFn: "roundSodiumMg",
    cfrReference: "21 CFR 101.9(c)(2)(iv)",
  },

  carb_g: {
    key: "carb_g",
    label: "Total Carbohydrate",
    unit: "g",
    dailyValue: 275,
    fdaMandatory: true,
    displayOrder: 8,
    roundingFn: "roundGeneralG",
    cfrReference: "21 CFR 101.9(c)(3)",
  },

  fiber_g: {
    key: "fiber_g",
    label: "Dietary Fiber",
    unit: "g",
    dailyValue: 28,
    fdaMandatory: true,
    displayOrder: 9,
    roundingFn: "roundGeneralG",
    cfrReference: "21 CFR 101.9(c)(3)(i)",
  },

  sugars_g: {
    key: "sugars_g",
    label: "Total Sugars",
    unit: "g",
    dailyValue: 0, // No DV established for total sugars (2020 rule)
    fdaMandatory: true,
    displayOrder: 10,
    roundingFn: "roundGeneralG",
    cfrReference: "21 CFR 101.9(c)(3)(ii)",
  },

  added_sugars_g: {
    key: "added_sugars_g",
    label: "Added Sugars",
    unit: "g",
    dailyValue: 50,
    fdaMandatory: true,
    displayOrder: 11,
    roundingFn: "roundGeneralG",
    cfrReference: "21 CFR 101.9(c)(3)(ii)",
  },

  protein_g: {
    key: "protein_g",
    label: "Protein",
    unit: "g",
    dailyValue: 50,
    fdaMandatory: true,
    displayOrder: 12,
    roundingFn: "roundGeneralG",
    cfrReference: "21 CFR 101.9(c)(4)",
  },

  // ========================================================================
  // FAT-SOLUBLE VITAMINS (21 CFR 101.9(c)(5))
  // ========================================================================

  vitamin_d_mcg: {
    key: "vitamin_d_mcg",
    label: "Vitamin D",
    unit: "mcg",
    dailyValue: 20,
    fdaMandatory: true,
    displayOrder: 13,
    roundingFn: "roundVitaminD",
    cfrReference: "21 CFR 101.9(c)(5)(i)",
  },

  vitamin_a_mcg: {
    key: "vitamin_a_mcg",
    label: "Vitamin A",
    unit: "mcg",
    dailyValue: 900,
    fdaMandatory: false,
    displayOrder: 15,
    roundingFn: "roundVitaminA",
    cfrReference: "21 CFR 101.9(c)(5)(ii)",
  },

  vitamin_e_mg: {
    key: "vitamin_e_mg",
    label: "Vitamin E",
    unit: "mg",
    dailyValue: 15,
    fdaMandatory: false,
    displayOrder: 17,
    roundingFn: "roundVitaminE",
    cfrReference: "21 CFR 101.9(c)(5)(iii)",
  },

  vitamin_k_mcg: {
    key: "vitamin_k_mcg",
    label: "Vitamin K",
    unit: "mcg",
    dailyValue: 120,
    fdaMandatory: false,
    displayOrder: 18,
    roundingFn: "roundVitaminK",
    cfrReference: "21 CFR 101.9(c)(5)(iv)",
  },

  // ========================================================================
  // MINERALS (21 CFR 101.9(c)(6))
  // ========================================================================

  calcium_mg: {
    key: "calcium_mg",
    label: "Calcium",
    unit: "mg",
    dailyValue: 1300,
    fdaMandatory: true,
    displayOrder: 14,
    roundingFn: "roundCalcium",
    cfrReference: "21 CFR 101.9(c)(6)(i)",
  },

  iron_mg: {
    key: "iron_mg",
    label: "Iron",
    unit: "mg",
    dailyValue: 18,
    fdaMandatory: true,
    displayOrder: 16,
    roundingFn: "roundIron",
    cfrReference: "21 CFR 101.9(c)(6)(ii)",
  },

  potassium_mg: {
    key: "potassium_mg",
    label: "Potassium",
    unit: "mg",
    dailyValue: 4700,
    fdaMandatory: true,
    displayOrder: 19,
    roundingFn: "roundPotassium",
    cfrReference: "21 CFR 101.9(c)(6)(iii)",
  },

  phosphorus_mg: {
    key: "phosphorus_mg",
    label: "Phosphorus",
    unit: "mg",
    dailyValue: 1250,
    fdaMandatory: false,
    displayOrder: 20,
    roundingFn: "roundPhosphorus",
    cfrReference: "21 CFR 101.9(c)(6)",
  },

  iodine_mcg: {
    key: "iodine_mcg",
    label: "Iodine",
    unit: "mcg",
    dailyValue: 150,
    fdaMandatory: false,
    displayOrder: 21,
    roundingFn: "roundIodine",
    cfrReference: "21 CFR 101.9(c)(6)",
  },

  magnesium_mg: {
    key: "magnesium_mg",
    label: "Magnesium",
    unit: "mg",
    dailyValue: 420,
    fdaMandatory: false,
    displayOrder: 22,
    roundingFn: "roundMagnesium",
    cfrReference: "21 CFR 101.9(c)(6)",
  },

  zinc_mg: {
    key: "zinc_mg",
    label: "Zinc",
    unit: "mg",
    dailyValue: 11,
    fdaMandatory: false,
    displayOrder: 23,
    roundingFn: "roundZinc",
    cfrReference: "21 CFR 101.9(c)(6)",
  },

  selenium_mcg: {
    key: "selenium_mcg",
    label: "Selenium",
    unit: "mcg",
    dailyValue: 55,
    fdaMandatory: false,
    displayOrder: 24,
    roundingFn: "roundSelenium",
    cfrReference: "21 CFR 101.9(c)(6)",
  },

  copper_mg: {
    key: "copper_mg",
    label: "Copper",
    unit: "mg",
    dailyValue: 0.9,
    fdaMandatory: false,
    displayOrder: 25,
    roundingFn: "roundCopper",
    cfrReference: "21 CFR 101.9(c)(6)",
  },

  manganese_mg: {
    key: "manganese_mg",
    label: "Manganese",
    unit: "mg",
    dailyValue: 2.3,
    fdaMandatory: false,
    displayOrder: 26,
    roundingFn: "roundManganese",
    cfrReference: "21 CFR 101.9(c)(6)",
  },

  chromium_mcg: {
    key: "chromium_mcg",
    label: "Chromium",
    unit: "mcg",
    dailyValue: 35,
    fdaMandatory: false,
    displayOrder: 27,
    roundingFn: "roundChromium",
    cfrReference: "21 CFR 101.9(c)(6)",
  },

  molybdenum_mcg: {
    key: "molybdenum_mcg",
    label: "Molybdenum",
    unit: "mcg",
    dailyValue: 45,
    fdaMandatory: false,
    displayOrder: 28,
    roundingFn: "roundMolybdenum",
    cfrReference: "21 CFR 101.9(c)(6)",
  },

  chloride_mg: {
    key: "chloride_mg",
    label: "Chloride",
    unit: "mg",
    dailyValue: 2300,
    fdaMandatory: false,
    displayOrder: 29,
    roundingFn: "roundChloride",
    cfrReference: "21 CFR 101.9(c)(6)",
  },

  // ========================================================================
  // WATER-SOLUBLE VITAMINS (21 CFR 101.9(c)(7))
  // ========================================================================

  vitamin_c_mg: {
    key: "vitamin_c_mg",
    label: "Vitamin C",
    unit: "mg",
    dailyValue: 90,
    fdaMandatory: false,
    displayOrder: 30,
    roundingFn: "roundVitaminC",
    cfrReference: "21 CFR 101.9(c)(7)(i)",
  },

  thiamin_mg: {
    key: "thiamin_mg",
    label: "Thiamin (Vitamin B1)",
    unit: "mg",
    dailyValue: 1.2,
    fdaMandatory: false,
    displayOrder: 31,
    roundingFn: "roundThiamin",
    cfrReference: "21 CFR 101.9(c)(7)(ii)",
  },

  riboflavin_mg: {
    key: "riboflavin_mg",
    label: "Riboflavin (Vitamin B2)",
    unit: "mg",
    dailyValue: 1.3,
    fdaMandatory: false,
    displayOrder: 32,
    roundingFn: "roundRiboflavin",
    cfrReference: "21 CFR 101.9(c)(7)(iii)",
  },

  niacin_mg: {
    key: "niacin_mg",
    label: "Niacin",
    unit: "mg",
    dailyValue: 16,
    fdaMandatory: false,
    displayOrder: 33,
    roundingFn: "roundNiacin",
    cfrReference: "21 CFR 101.9(c)(7)(iv)",
  },

  vitamin_b6_mg: {
    key: "vitamin_b6_mg",
    label: "Vitamin B6",
    unit: "mg",
    dailyValue: 1.7,
    fdaMandatory: false,
    displayOrder: 34,
    roundingFn: "roundVitaminB6",
    cfrReference: "21 CFR 101.9(c)(7)(v)",
  },

  folate_mcg: {
    key: "folate_mcg",
    label: "Folate",
    unit: "mcg",
    dailyValue: 400,
    fdaMandatory: false,
    displayOrder: 35,
    roundingFn: "roundFolate",
    cfrReference: "21 CFR 101.9(c)(7)(vi)",
  },

  vitamin_b12_mcg: {
    key: "vitamin_b12_mcg",
    label: "Vitamin B12",
    unit: "mcg",
    dailyValue: 2.4,
    fdaMandatory: false,
    displayOrder: 36,
    roundingFn: "roundVitaminB12",
    cfrReference: "21 CFR 101.9(c)(7)(vii)",
  },

  biotin_mcg: {
    key: "biotin_mcg",
    label: "Biotin",
    unit: "mcg",
    dailyValue: 30,
    fdaMandatory: false,
    displayOrder: 37,
    roundingFn: "roundBiotin",
    cfrReference: "21 CFR 101.9(c)(7)",
  },

  pantothenic_acid_mg: {
    key: "pantothenic_acid_mg",
    label: "Pantothenic Acid",
    unit: "mg",
    dailyValue: 5,
    fdaMandatory: false,
    displayOrder: 38,
    roundingFn: "roundPantothenicAcid",
    cfrReference: "21 CFR 101.9(c)(7)",
  },

  // ========================================================================
  // OTHER ESSENTIAL NUTRIENTS (21 CFR 101.9(c)(8))
  // ========================================================================

  choline_mg: {
    key: "choline_mg",
    label: "Choline",
    unit: "mg",
    dailyValue: 550,
    fdaMandatory: false,
    displayOrder: 39,
    roundingFn: "roundCholine",
    cfrReference: "21 CFR 101.9(c)(8)",
  },

  // ========================================================================
  // FATTY ACIDS (NO OFFICIAL DV)
  // Included for completeness; reference values only
  // ========================================================================

  omega3_g: {
    key: "omega3_g",
    label: "Omega-3 Fatty Acids",
    unit: "g",
    dailyValue: 1.6, // ALA recommended, not official FDA DV
    fdaMandatory: false,
    displayOrder: 40,
    roundingFn: "roundGeneralG",
    cfrReference: "Guidance for Industry (no official DV)",
  },

  omega6_g: {
    key: "omega6_g",
    label: "Omega-6 Fatty Acids",
    unit: "g",
    dailyValue: 17, // Linoleic acid reference, not official FDA DV
    fdaMandatory: false,
    displayOrder: 41,
    roundingFn: "roundGeneralG",
    cfrReference: "Guidance for Industry (no official DV)",
  },
};

/**
 * Compute percent daily value (%DV) for any nutrient
 *
 * @param key - Nutrient identifier
 * @param amount - Amount of nutrient in the appropriate unit
 * @returns Percent daily value (0-100+), or null if no DV defined
 *
 * @example
 * const calciumPercent = computePercentDV('calcium_mg', 650); // Returns 50 (50% of 1300)
 */
export function computePercentDV(key: NutrientKey, amount: number): number | null {
  const entry = FDA_DAILY_VALUES[key];
  if (!entry || entry.dailyValue === 0) {
    return null;
  }
  return (amount / entry.dailyValue) * 100;
}

/**
 * Get all mandatory FDA nutrients in display order
 * These are the nutrients required on all nutrition facts labels
 *
 * @returns Array of DailyValueEntry objects sorted by displayOrder
 *
 * @example
 * const mandatoryNutrients = getMandatoryNutrients();
 * mandatoryNutrients.forEach(nutrient => console.log(nutrient.label));
 */
export function getMandatoryNutrients(): DailyValueEntry[] {
  return Object.values(FDA_DAILY_VALUES)
    .filter((entry) => entry.fdaMandatory)
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * Get daily value entry for a specific nutrient
 *
 * @param key - Nutrient identifier
 * @returns DailyValueEntry or undefined if not found
 */
export function getDailyValueEntry(key: NutrientKey): DailyValueEntry | undefined {
  return FDA_DAILY_VALUES[key];
}

/**
 * Get numeric daily value for a specific nutrient
 * Backward compatibility wrapper - returns just the number
 *
 * @param key - Nutrient identifier
 * @returns Daily value amount or undefined if not found
 */
export function getDailyValue(key: NutrientKey): number | undefined {
  return FDA_DAILY_VALUES[key]?.dailyValue;
}

/**
 * Get all nutrients with established daily values (DV > 0)
 * Excludes nutrients like trans fat and total sugars with no DV
 *
 * @returns Array of DailyValueEntry objects with DV > 0
 */
export function getNutrientswithDV(): DailyValueEntry[] {
  return Object.values(FDA_DAILY_VALUES)
    .filter((entry) => entry.dailyValue > 0)
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * Get all nutrients organized by category for label display
 *
 * @returns Organized nutrient groups with labels and entries
 */
export function getNutrientsByCategory(): {
  macronutrients: DailyValueEntry[];
  minerals: DailyValueEntry[];
  vitamins: DailyValueEntry[];
  other: DailyValueEntry[];
} {
  const all = Object.values(FDA_DAILY_VALUES).sort(
    (a, b) => a.displayOrder - b.displayOrder
  );

  return {
    macronutrients: all.filter(
      (n) =>
        [
          "kcal",
          "fat_g",
          "sat_fat_g",
          "trans_fat_g",
          "cholesterol_mg",
          "sodium_mg",
          "carb_g",
          "fiber_g",
          "sugars_g",
          "added_sugars_g",
          "protein_g",
        ].includes(n.key)
    ),
    minerals: all.filter(
      (n) =>
        [
          "calcium_mg",
          "iron_mg",
          "potassium_mg",
          "phosphorus_mg",
          "iodine_mcg",
          "magnesium_mg",
          "zinc_mg",
          "selenium_mcg",
          "copper_mg",
          "manganese_mg",
          "chromium_mcg",
          "molybdenum_mcg",
          "chloride_mg",
        ].includes(n.key)
    ),
    vitamins: all.filter(
      (n) =>
        [
          "vitamin_d_mcg",
          "vitamin_a_mcg",
          "vitamin_c_mg",
          "vitamin_e_mg",
          "vitamin_k_mcg",
          "thiamin_mg",
          "riboflavin_mg",
          "niacin_mg",
          "vitamin_b6_mg",
          "folate_mcg",
          "vitamin_b12_mcg",
          "biotin_mcg",
          "pantothenic_acid_mg",
        ].includes(n.key)
    ),
    other: all.filter(
      (n) =>
        ["choline_mg", "omega3_g", "omega6_g"].includes(n.key)
    ),
  };
}

/**
 * Backward compatibility: export the simple daily values map
 * Deprecated: use FDA_DAILY_VALUES and related functions instead
 */
export const dailyValues: Partial<Record<NutrientKey, number>> = Object.fromEntries(
  Object.values(FDA_DAILY_VALUES).map((entry) => [entry.key, entry.dailyValue])
) as Partial<Record<NutrientKey, number>>;

/**
 * Backward compatibility function
 * Deprecated: use computePercentDV instead
 */
export function calculatePercentDV(
  value: number,
  nutrientKey: NutrientKey
): number | undefined {
  const result = computePercentDV(nutrientKey, value);
  return result ?? undefined;
}

/**
 * Backward compatibility function
 * Deprecated: use getDailyValue instead
 */
export function hassDailyValue(nutrientKey: NutrientKey): boolean {
  const entry = FDA_DAILY_VALUES[nutrientKey];
  return entry !== undefined && entry.dailyValue > 0;
}

/**
 * Backward compatibility function
 * Deprecated: use Object.keys(FDA_DAILY_VALUES) instead
 */
export function getNutrientKeysWithDV(): NutrientKey[] {
  return Object.keys(FDA_DAILY_VALUES).filter(
    (key) => FDA_DAILY_VALUES[key as NutrientKey].dailyValue > 0
  ) as NutrientKey[];
}
