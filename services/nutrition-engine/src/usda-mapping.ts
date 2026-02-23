import type { NutrientKey } from "@nutrition/contracts";

/**
 * USDA FDC Nutrient Mapping
 * Maps project NutrientKey types to USDA FoodData Central nutrient IDs
 *
 * USDA uses 4-digit nutrient numbers in the FDC API (not the older 3-digit SR Legacy format)
 * Reference: https://fdc.nal.usda.gov/api-guide/
 */

export type UsdaNutrientMapping = {
  nutrientKey: NutrientKey;
  usdaNumber: number;         // USDA nutrient ID (4-digit FDC format, e.g., 1008 for energy)
  usdaName: string;           // Official USDA name
  usdaUnit: string;           // Unit in USDA FDC data
  conversionFactor: number;   // Multiply USDA value by this to get our unit (usually 1.0)
  notes?: string;             // Any conversion notes or special handling
};

/**
 * Complete mapping table for all 41 nutrient keys
 * USDA FDC nutrient IDs are standardized across all FDC databases
 */
export const USDA_NUTRIENT_MAP: UsdaNutrientMapping[] = [
  // Macronutrients
  {
    nutrientKey: "kcal",
    usdaNumber: 1008,
    usdaName: "Energy",
    usdaUnit: "kcal",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "protein_g",
    usdaNumber: 1003,
    usdaName: "Protein",
    usdaUnit: "g",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "carb_g",
    usdaNumber: 1005,
    usdaName: "Carbohydrate, by difference",
    usdaUnit: "g",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "fat_g",
    usdaNumber: 1004,
    usdaName: "Total lipid (fat)",
    usdaUnit: "g",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "fiber_g",
    usdaNumber: 1079,
    usdaName: "Fiber, total dietary",
    usdaUnit: "g",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "sugars_g",
    usdaNumber: 2000,
    usdaName: "Sugars, total including NLEA",
    usdaUnit: "g",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "added_sugars_g",
    usdaNumber: 1235,
    usdaName: "Sugars, added",
    usdaUnit: "g",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "sat_fat_g",
    usdaNumber: 1258,
    usdaName: "Fatty acids, total saturated",
    usdaUnit: "g",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "trans_fat_g",
    usdaNumber: 1257,
    usdaName: "Fatty acids, total trans",
    usdaUnit: "g",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "cholesterol_mg",
    usdaNumber: 1253,
    usdaName: "Cholesterol",
    usdaUnit: "mg",
    conversionFactor: 1.0,
  },

  // Electrolytes and minerals
  {
    nutrientKey: "sodium_mg",
    usdaNumber: 1093,
    usdaName: "Sodium, Na",
    usdaUnit: "mg",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "potassium_mg",
    usdaNumber: 1092,
    usdaName: "Potassium, K",
    usdaUnit: "mg",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "calcium_mg",
    usdaNumber: 1087,
    usdaName: "Calcium, Ca",
    usdaUnit: "mg",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "phosphorus_mg",
    usdaNumber: 1091,
    usdaName: "Phosphorus, P",
    usdaUnit: "mg",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "magnesium_mg",
    usdaNumber: 1090,
    usdaName: "Magnesium, Mg",
    usdaUnit: "mg",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "chloride_mg",
    usdaNumber: 1088,
    usdaName: "Chlorine, Cl",
    usdaUnit: "mg",
    conversionFactor: 1.0,
  },

  // Trace minerals
  {
    nutrientKey: "iron_mg",
    usdaNumber: 1089,
    usdaName: "Iron, Fe",
    usdaUnit: "mg",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "zinc_mg",
    usdaNumber: 1095,
    usdaName: "Zinc, Zn",
    usdaUnit: "mg",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "copper_mg",
    usdaNumber: 1098,
    usdaName: "Copper, Cu",
    usdaUnit: "mg",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "manganese_mg",
    usdaNumber: 1101,
    usdaName: "Manganese, Mn",
    usdaUnit: "mg",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "selenium_mcg",
    usdaNumber: 1103,
    usdaName: "Selenium, Se",
    usdaUnit: "µg",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "iodine_mcg",
    usdaNumber: 1100,
    usdaName: "Iodine, I",
    usdaUnit: "µg",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "chromium_mcg",
    usdaNumber: 1096,
    usdaName: "Chromium, Cr",
    usdaUnit: "µg",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "molybdenum_mcg",
    usdaNumber: 1102,
    usdaName: "Molybdenum, Mo",
    usdaUnit: "µg",
    conversionFactor: 1.0,
  },

  // Fat-soluble vitamins
  {
    nutrientKey: "vitamin_a_mcg",
    usdaNumber: 1106,
    usdaName: "Vitamin A, RAE",
    usdaUnit: "µg",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "vitamin_d_mcg",
    usdaNumber: 1114,
    usdaName: "Vitamin D (D2 + D3)",
    usdaUnit: "µg",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "vitamin_e_mg",
    usdaNumber: 1109,
    usdaName: "Vitamin E (alpha-tocopherol)",
    usdaUnit: "mg",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "vitamin_k_mcg",
    usdaNumber: 1185,
    usdaName: "Vitamin K (phylloquinone)",
    usdaUnit: "µg",
    conversionFactor: 1.0,
  },

  // Water-soluble vitamins
  {
    nutrientKey: "vitamin_c_mg",
    usdaNumber: 1162,
    usdaName: "Vitamin C, total ascorbic acid",
    usdaUnit: "mg",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "thiamin_mg",
    usdaNumber: 1165,
    usdaName: "Thiamin",
    usdaUnit: "mg",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "riboflavin_mg",
    usdaNumber: 1166,
    usdaName: "Riboflavin",
    usdaUnit: "mg",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "niacin_mg",
    usdaNumber: 1167,
    usdaName: "Niacin",
    usdaUnit: "mg",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "vitamin_b6_mg",
    usdaNumber: 1175,
    usdaName: "Vitamin B-6",
    usdaUnit: "mg",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "folate_mcg",
    usdaNumber: 1177,
    usdaName: "Folate, DFE",
    usdaUnit: "µg",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "vitamin_b12_mcg",
    usdaNumber: 1178,
    usdaName: "Vitamin B-12",
    usdaUnit: "µg",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "pantothenic_acid_mg",
    usdaNumber: 1170,
    usdaName: "Pantothenic acid",
    usdaUnit: "mg",
    conversionFactor: 1.0,
  },
  {
    nutrientKey: "biotin_mcg",
    usdaNumber: 1176,
    usdaName: "Biotin",
    usdaUnit: "µg",
    conversionFactor: 1.0,
  },

  // Other nutrients
  {
    nutrientKey: "choline_mg",
    usdaNumber: 1180,
    usdaName: "Choline, total",
    usdaUnit: "mg",
    conversionFactor: 1.0,
  },

  // Omega fatty acids
  // Note: USDA FDC provides these as individual fatty acids rather than aggregates
  // These represent the primary plant-based omega-3 and omega-6 sources
  {
    nutrientKey: "omega3_g",
    usdaNumber: 1404,
    usdaName: "18:3 n-3 c,c,c (ALA)",
    usdaUnit: "g",
    conversionFactor: 1.0,
    notes:
      "Alpha-linolenic acid (ALA) - plant-based omega-3. EPA (1278) and DHA (1272) tracked separately in USDA database.",
  },
  {
    nutrientKey: "omega6_g",
    usdaNumber: 1316,
    usdaName: "18:2 n-6 c,c (Linoleic)",
    usdaUnit: "g",
    conversionFactor: 1.0,
    notes:
      "Linoleic acid (LA) - primary omega-6. Arachidonic acid tracked separately in USDA database.",
  },
];

const USDA_NUTRIENT_MAP_BY_KEY: Map<NutrientKey, UsdaNutrientMapping> =
  new Map(USDA_NUTRIENT_MAP.map((mapping) => [mapping.nutrientKey, mapping]));

const USDA_NUMBER_TO_NUTRIENT_KEY: Map<number, NutrientKey> = new Map(
  USDA_NUTRIENT_MAP.map((mapping) => [mapping.usdaNumber, mapping.nutrientKey])
);

function getUsdaMappingByKey(
  key: NutrientKey
): UsdaNutrientMapping | undefined {
  return USDA_NUTRIENT_MAP_BY_KEY.get(key);
}

/** Get the USDA nutrient number for a NutrientKey. */
export function getUsdaNumberByKey(key: NutrientKey): number | undefined {
  return getUsdaMappingByKey(key)?.usdaNumber;
}

/** Get the NutrientKey for a USDA nutrient number. */
export function getNutrientKeyByUsdaNumber(
  usdaNumber: number
): NutrientKey | undefined {
  return USDA_NUMBER_TO_NUTRIENT_KEY.get(usdaNumber);
}

/** USDA API response nutrient structure. */
export type UsdaFoodNutrient = {
  nutrientId?: number;
  nutrientNumber?: string;
  nutrientName?: string;
  amount?: number;
  value?: number;
  unitName?: string;
};

/** Convert USDA API nutrient values to NutrientKey format. */
export function convertUsdaNutrients(
  usdaNutrients: UsdaFoodNutrient[]
): Partial<Record<NutrientKey, number>> {
  const result: Partial<Record<NutrientKey, number>> = {};

  for (const nutrient of usdaNutrients) {
    // Handle both nutrientId and nutrientNumber fields from different USDA APIs
    const nutrientId =
      nutrient.nutrientId ?? (nutrient.nutrientNumber ? parseInt(nutrient.nutrientNumber, 10) : undefined);

    if (nutrientId === undefined || nutrientId === null) {
      continue;
    }

    // Get the value (some APIs use 'amount', some use 'value')
    const rawValue = nutrient.amount ?? nutrient.value;

    if (rawValue === undefined || rawValue === null || typeof rawValue !== "number") {
      continue;
    }

    // Look up the mapping
    const mapping = USDA_NUTRIENT_MAP.find((m) => m.usdaNumber === nutrientId);

    if (mapping) {
      // Apply conversion factor and store
      result[mapping.nutrientKey] = rawValue * mapping.conversionFactor;
    }
  }

  return result;
}

/** Check if all required nutrients are present. */
export function hasAllRequiredNutrients(
  nutrients: Partial<Record<NutrientKey, number>>,
  requiredKeys: NutrientKey[]
): boolean {
  return requiredKeys.every(
    (key) => key in nutrients && nutrients[key] !== undefined && nutrients[key] !== null
  );
}

