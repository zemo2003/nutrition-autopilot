export const nutrientKeys = [
  "kcal",
  "protein_g",
  "carb_g",
  "fat_g",
  "fiber_g",
  "sugars_g",
  "added_sugars_g",
  "sat_fat_g",
  "trans_fat_g",
  "cholesterol_mg",
  "sodium_mg",
  "vitamin_d_mcg",
  "calcium_mg",
  "iron_mg",
  "potassium_mg",
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
  "choline_mg",
  "omega3_g",
  "omega6_g"
] as const;

export type NutrientKey = (typeof nutrientKeys)[number];

/** The 5 macros + sodium required for a minimally valid nutrition label. */
export const CORE_NUTRIENT_KEYS = ["kcal", "protein_g", "carb_g", "fat_g", "sodium_mg"] as const;

export type CoreNutrientKey = (typeof CORE_NUTRIENT_KEYS)[number];

export type NUTRIENT_UNIT = "kcal" | "g" | "mg" | "mcg";

export type NUTRIENT_DEF = {
  key: NutrientKey;
  label: string;
  unit: NUTRIENT_UNIT;
  displayOrder: number;
  dailyValue?: number;
  fdaCore: boolean;
};
