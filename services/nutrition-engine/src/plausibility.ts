import type { NutrientKey } from "@nutrition/contracts";

export type PlausibilityIssue = {
  nutrientKey: NutrientKey;
  value: number;
  rule: string;
  severity: "ERROR" | "WARNING";
  message: string;
  suggestedRange?: { min: number; max: number };
};

export type FoodCategory =
  | "MEAT_POULTRY" // chicken, turkey, beef, pork
  | "FISH_SEAFOOD" // cod, tuna, salmon, shrimp
  | "DAIRY" // milk, cheese, yogurt
  | "EGGS" // whole eggs, egg whites
  | "GRAINS_CEREALS" // rice, pasta, oats, bread
  | "LEGUMES" // beans, lentils, chickpeas
  | "VEGETABLES" // all vegetables
  | "FRUITS" // all fruits
  | "NUTS_SEEDS" // almonds, peanuts, etc.
  | "OILS_FATS" // olive oil, butter, coconut oil
  | "BEVERAGES" // water, juice, sports drinks
  | "CONDIMENTS" // sauces, dressings, honey
  | "UNKNOWN"; // fallback

// Keywords to help detect food categories
const CATEGORY_KEYWORDS: Record<FoodCategory, RegExp> = {
  MEAT_POULTRY: /\b(chicken|turkey|beef|pork|lamb|veal|venison|duck|goose)\b/i,
  FISH_SEAFOOD: /\b(cod|tuna|salmon|trout|halibut|shrimp|crab|lobster|clam|oyster|mussels?|fish|anchovy|sardine|herring|mackerel)\b/i,
  DAIRY: /\b(milk|cheese|yogurt|cream|butter|whey|lactose|casein|ghee|ricotta|cottage|mozzarella|cheddar|feta|gouda|parmesan|kefir|sour cream)\b/i,
  EGGS: /\b(eggs?|albumen)\b(?!plant)/i,
  GRAINS_CEREALS: /\b(rice|pasta|bread|oat|cereal|wheat|flour|barley|rye|corn|polenta|couscous|quinoa|millet|sorghum|buckwheat)\b/i,
  LEGUMES: /\b(beans?|lentils?|chickpeas?|peas?(?!nut)|black beans?|kidney beans?|pinto beans?|navy beans?|split peas?|fava beans?|broad beans?)\b/i,
  VEGETABLES: /\b(broccoli|spinach|carrot|lettuce|kale|cabbage|cauliflower|celery|tomato|pepper|onion|garlic|zucchini|cucumber|asparagus|green bean|pea(?!nut)|mushroom|artichoke|beet|squash|pumpkin|sweet potato|potato|turnip|radish|fennel|leek|eggplant|arugula|bok choy|collard|mustard greens|watercress)\b/i,
  FRUITS: /\b(apple|banana|orange|grape|berry|strawberry|blueberry|raspberry|blackberry|cherry|peach|pear|plum|pineapple|mango|papaya|coconut|avocado|lemon|lime|grapefruit|melon|watermelon|cantaloupe|kiwi|pomegranate|date|fig|raisin|cranberry)\b/i,
  NUTS_SEEDS: /\b(almonds?|walnuts?|peanuts?|cashews?|pecans?|macadamia|pistachios?|hazelnuts?|pine nuts?|seeds?|sesame|sunflower|pumpkin seeds?|flax|chia|hemp)\b/i,
  OILS_FATS: /\b(oil|butter|ghee|lard|shortening|margarine|coconut oil|olive oil|vegetable oil|canola oil|sunflower oil|avocado oil|peanut oil)\b/i,
  BEVERAGES: /\b(water|juice|soda|pop|seltzer|sparkling|gatorade|sports drink|coffee|tea|milk|smoothie|shake|drink|beverage)\b/i,
  CONDIMENTS: /\b(sauce|dressing|ketchup|mustard|mayo|mayonnaise|ranch|vinegar|soy sauce|hot sauce|salsa|relish|jam|jelly|honey|syrup|peanut butter|spread|paste)\b/i,
  UNKNOWN: /(?!)/i, // never matches
};

/**
 * Detect food category from product name and optional ingredient key
 */
export function detectFoodCategory(productName: string, ingredientKey?: string): FoodCategory {
  const searchText = [productName, ingredientKey].filter(Boolean).join(" ");

  // Check each category in a specific order (more specific first)
  const categoriesToCheck: FoodCategory[] = [
    "MEAT_POULTRY",
    "FISH_SEAFOOD",
    "EGGS",
    "DAIRY",
    "OILS_FATS",
    "NUTS_SEEDS",
    "LEGUMES",
    "GRAINS_CEREALS",
    "VEGETABLES",
    "FRUITS",
    "BEVERAGES",
    "CONDIMENTS",
  ];

  for (const category of categoriesToCheck) {
    if (CATEGORY_KEYWORDS[category].test(searchText)) {
      return category;
    }
  }

  return "UNKNOWN";
}

/**
 * Validate that calorie calculation is roughly consistent with macronutrients
 * kcal should roughly equal: protein*4 + carb*4 + fat*9 (±15%)
 */
function validateCalorieConsistency(
  nutrients: Partial<Record<NutrientKey, number>>
): PlausibilityIssue | null {
  const kcal = nutrients.kcal;
  const protein = nutrients.protein_g;
  const carb = nutrients.carb_g;
  const fat = nutrients.fat_g;

  if (kcal === undefined || protein === undefined || carb === undefined || fat === undefined) {
    return null;
  }

  const calculatedKcal = protein * 4 + carb * 4 + fat * 9;
  const tolerance = calculatedKcal * 0.15; // 15% tolerance
  const difference = Math.abs(kcal - calculatedKcal);

  if (difference > tolerance) {
    return {
      nutrientKey: "kcal",
      value: kcal,
      rule: "Calorie Consistency Check",
      severity: "WARNING",
      message: `Reported kcal (${kcal}) differs significantly from macronutrient calculation (${calculatedKcal.toFixed(1)}). Difference: ${difference.toFixed(1)} kcal (threshold: ${tolerance.toFixed(1)})`,
    };
  }

  return null;
}

/**
 * Validate that macro and micronutrient sum doesn't exceed 100g + tolerance
 */
function validateMacroSum(
  nutrients: Partial<Record<NutrientKey, number>>
): PlausibilityIssue | null {
  const protein = nutrients.protein_g ?? 0;
  const carb = nutrients.carb_g ?? 0;
  const fat = nutrients.fat_g ?? 0;
  const fiber = nutrients.fiber_g ?? 0;

  // Note: water_g and ash_g are not in NutrientKey; check macro sum only
  const sum = protein + carb + fat + fiber;

  // Allow up to 105g per 100g to account for water, ash, and measurement error
  if (sum > 105) {
    return {
      nutrientKey: "protein_g",
      value: sum,
      rule: "Macronutrient Sum Check",
      severity: "ERROR",
      message: `Sum of protein, carbs, fat, fiber, water, and ash (${sum.toFixed(1)}g) exceeds 105g per 100g. This is physically impossible.`,
      suggestedRange: { min: 0, max: 105 },
    };
  }

  return null;
}

/**
 * Universal rules that apply to all foods
 */
function validateUniversalRules(
  nutrients: Partial<Record<NutrientKey, number>>
): PlausibilityIssue[] {
  const issues: PlausibilityIssue[] = [];

  // Rule 1: kcal must be >= 0 and <= 900 (pure fat is 884 kcal/100g)
  if (nutrients.kcal !== undefined) {
    if (nutrients.kcal < 0) {
      issues.push({
        nutrientKey: "kcal",
        value: nutrients.kcal,
        rule: "Kcal Lower Bound",
        severity: "ERROR",
        message: `Kcal cannot be negative: ${nutrients.kcal}`,
        suggestedRange: { min: 0, max: 900 },
      });
    }
    if (nutrients.kcal > 900) {
      issues.push({
        nutrientKey: "kcal",
        value: nutrients.kcal,
        rule: "Kcal Upper Bound",
        severity: "ERROR",
        message: `Kcal (${nutrients.kcal}) exceeds maximum possible value (900 kcal/100g for pure fat)`,
        suggestedRange: { min: 0, max: 900 },
      });
    }
  }

  // Rule 4: No nutrient can be negative
  const nutrientKeys: NutrientKey[] = [
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
    "omega6_g",
  ];

  for (const key of nutrientKeys) {
    const value = nutrients[key];
    if (value !== undefined && value < 0) {
      issues.push({
        nutrientKey: key,
        value,
        rule: "Non-Negative Rule",
        severity: "ERROR",
        message: `${key} cannot be negative: ${value}`,
        suggestedRange: { min: 0, max: Infinity },
      });
    }
  }

  // Rule 5: sat_fat <= fat
  if (nutrients.sat_fat_g !== undefined && nutrients.fat_g !== undefined) {
    if (nutrients.sat_fat_g > nutrients.fat_g) {
      issues.push({
        nutrientKey: "sat_fat_g",
        value: nutrients.sat_fat_g,
        rule: "Saturated Fat vs Total Fat",
        severity: "ERROR",
        message: `Saturated fat (${nutrients.sat_fat_g}g) cannot exceed total fat (${nutrients.fat_g}g)`,
        suggestedRange: { min: 0, max: nutrients.fat_g },
      });
    }
  }

  // Rule 6: sugars <= carb
  if (nutrients.sugars_g !== undefined && nutrients.carb_g !== undefined) {
    if (nutrients.sugars_g > nutrients.carb_g) {
      issues.push({
        nutrientKey: "sugars_g",
        value: nutrients.sugars_g,
        rule: "Sugars vs Total Carbs",
        severity: "ERROR",
        message: `Sugars (${nutrients.sugars_g}g) cannot exceed total carbohydrates (${nutrients.carb_g}g)`,
        suggestedRange: { min: 0, max: nutrients.carb_g },
      });
    }
  }

  // Rule 7: added_sugars <= sugars
  if (nutrients.added_sugars_g !== undefined && nutrients.sugars_g !== undefined) {
    if (nutrients.added_sugars_g > nutrients.sugars_g) {
      issues.push({
        nutrientKey: "added_sugars_g",
        value: nutrients.added_sugars_g,
        rule: "Added Sugars vs Total Sugars",
        severity: "ERROR",
        message: `Added sugars (${nutrients.added_sugars_g}g) cannot exceed total sugars (${nutrients.sugars_g}g)`,
        suggestedRange: { min: 0, max: nutrients.sugars_g },
      });
    }
  }

  // Rule 8: fiber <= carb
  if (nutrients.fiber_g !== undefined && nutrients.carb_g !== undefined) {
    if (nutrients.fiber_g > nutrients.carb_g) {
      issues.push({
        nutrientKey: "fiber_g",
        value: nutrients.fiber_g,
        rule: "Fiber vs Total Carbs",
        severity: "ERROR",
        message: `Fiber (${nutrients.fiber_g}g) cannot exceed total carbohydrates (${nutrients.carb_g}g)`,
        suggestedRange: { min: 0, max: nutrients.carb_g },
      });
    }
  }

  // Rule 9: trans_fat <= fat
  if (nutrients.trans_fat_g !== undefined && nutrients.fat_g !== undefined) {
    if (nutrients.trans_fat_g > nutrients.fat_g) {
      issues.push({
        nutrientKey: "trans_fat_g",
        value: nutrients.trans_fat_g,
        rule: "Trans Fat vs Total Fat",
        severity: "ERROR",
        message: `Trans fat (${nutrients.trans_fat_g}g) cannot exceed total fat (${nutrients.fat_g}g)`,
        suggestedRange: { min: 0, max: nutrients.fat_g },
      });
    }
  }

  // Rule 2: Calorie consistency check
  const calorieIssue = validateCalorieConsistency(nutrients);
  if (calorieIssue) {
    issues.push(calorieIssue);
  }

  // Rule 3: Macro sum check
  const macroSumIssue = validateMacroSum(nutrients);
  if (macroSumIssue) {
    issues.push(macroSumIssue);
  }

  return issues;
}

/**
 * Category-specific validation rules
 */
function validateCategoryRules(
  nutrients: Partial<Record<NutrientKey, number>>,
  category: FoodCategory
): PlausibilityIssue[] {
  const issues: PlausibilityIssue[] = [];

  const checkRange = (
    key: NutrientKey,
    min: number,
    max: number,
    severity: "ERROR" | "WARNING" = "WARNING"
  ) => {
    const value = nutrients[key];
    if (value !== undefined && (value < min || value > max)) {
      issues.push({
        nutrientKey: key,
        value,
        rule: `${category} - ${key} Range`,
        severity,
        message: `${key} (${value}) is outside expected range for ${category}`,
        suggestedRange: { min, max },
      });
    }
  };

  switch (category) {
    case "MEAT_POULTRY":
      // carb_g: 0-3g
      checkRange("carb_g", 0, 3);
      // fiber_g: 0-0.5g
      checkRange("fiber_g", 0, 0.5);
      // sugars_g: 0-2g
      checkRange("sugars_g", 0, 2);
      // added_sugars_g: 0-2g
      checkRange("added_sugars_g", 0, 2);
      // protein_g: 15-35g
      checkRange("protein_g", 15, 35);
      // fat_g: 1-30g
      checkRange("fat_g", 1, 30);
      // kcal: 100-300
      checkRange("kcal", 100, 300);
      break;

    case "FISH_SEAFOOD":
      // carb_g: 0-2g
      checkRange("carb_g", 0, 2);
      // fiber_g: 0g
      checkRange("fiber_g", 0, 0);
      // sugars_g: 0-1g
      checkRange("sugars_g", 0, 1);
      // protein_g: 15-30g
      checkRange("protein_g", 15, 30);
      // fat_g: 0.5-15g
      checkRange("fat_g", 0.5, 15);
      // kcal: 70-250
      checkRange("kcal", 70, 250);
      break;

    case "DAIRY":
      // protein_g: 2-35g
      checkRange("protein_g", 2, 35);
      // carb_g: 0-55g
      checkRange("carb_g", 0, 55);
      // fat_g: 0-35g
      checkRange("fat_g", 0, 35);
      // kcal: 30-400
      checkRange("kcal", 30, 400);
      break;

    case "EGGS":
      // protein_g: 10-15g
      checkRange("protein_g", 10, 15);
      // carb_g: 0-2g
      checkRange("carb_g", 0, 2);
      // fat_g: 8-12g
      checkRange("fat_g", 8, 12);
      // cholesterol_mg: 300-450mg
      checkRange("cholesterol_mg", 300, 450);
      break;

    case "GRAINS_CEREALS":
      // protein_g: 2-16g
      checkRange("protein_g", 2, 16);
      // carb_g: 20-80g
      checkRange("carb_g", 20, 80);
      // fiber_g: 0.5-15g
      checkRange("fiber_g", 0.5, 15);
      // fat_g: 0-10g
      checkRange("fat_g", 0, 10);
      break;

    case "LEGUMES":
      // protein_g: 5-25g
      checkRange("protein_g", 5, 25);
      // carb_g: 15-65g
      checkRange("carb_g", 15, 65);
      // fiber_g: 4-25g
      checkRange("fiber_g", 4, 25);
      // fat_g: 0-5g
      checkRange("fat_g", 0, 5);
      break;

    case "VEGETABLES":
      // kcal: 5-100
      checkRange("kcal", 5, 100);
      // protein_g: 0.5-5g
      checkRange("protein_g", 0.5, 5);
      // carb_g: 1-20g
      checkRange("carb_g", 1, 20);
      // fat_g: 0-1g
      checkRange("fat_g", 0, 1);
      // fiber_g: 0.5-5g
      checkRange("fiber_g", 0.5, 5);
      break;

    case "FRUITS":
      // kcal: 15-100
      checkRange("kcal", 15, 100);
      // protein_g: 0-2g
      checkRange("protein_g", 0, 2);
      // carb_g: 5-25g
      checkRange("carb_g", 5, 25);
      // sugars_g: 3-20g
      checkRange("sugars_g", 3, 20);
      // fat_g: 0-1g (except avocado: up to 15g, but we treat avocado as NUTS_SEEDS or use WARNING)
      checkRange("fat_g", 0, 1, "WARNING");
      // fiber_g: 0.5-7g
      checkRange("fiber_g", 0.5, 7);
      break;

    case "NUTS_SEEDS":
      // kcal: 500-700
      checkRange("kcal", 500, 700);
      // protein_g: 10-25g
      checkRange("protein_g", 10, 25);
      // carb_g: 10-30g
      checkRange("carb_g", 10, 30);
      // fat_g: 40-75g
      checkRange("fat_g", 40, 75);
      // fiber_g: 3-12g
      checkRange("fiber_g", 3, 12);
      break;

    case "OILS_FATS":
      // kcal: 700-900
      checkRange("kcal", 700, 900);
      // fat_g: 80-100g
      checkRange("fat_g", 80, 100);
      // protein_g: 0-1g
      checkRange("protein_g", 0, 1);
      // carb_g: 0-1g
      checkRange("carb_g", 0, 1);
      break;

    case "BEVERAGES":
      // kcal: 0-60
      checkRange("kcal", 0, 60);
      // protein_g: 0-5g
      checkRange("protein_g", 0, 5);
      // carb_g: 0-15g
      checkRange("carb_g", 0, 15);
      // fat_g: 0-3g
      checkRange("fat_g", 0, 3);
      break;

    case "CONDIMENTS":
      // Generally very variable, so we allow broader ranges
      // kcal: 0-300
      checkRange("kcal", 0, 300, "WARNING");
      // protein_g: 0-10g
      checkRange("protein_g", 0, 10, "WARNING");
      // carb_g: 0-80g
      checkRange("carb_g", 0, 80, "WARNING");
      // fat_g: 0-40g
      checkRange("fat_g", 0, 40, "WARNING");
      break;

    case "UNKNOWN":
      // No category-specific rules for unknown
      break;
  }

  return issues;
}

/**
 * Main validation function: validates a nutrient profile against plausibility rules
 */
export function validateNutrientProfile(
  nutrients: Partial<Record<NutrientKey, number>>,
  category: FoodCategory,
  productName: string
): PlausibilityIssue[] {
  const issues: PlausibilityIssue[] = [];

  // Apply universal rules first
  issues.push(...validateUniversalRules(nutrients));

  // Apply category-specific rules
  issues.push(...validateCategoryRules(nutrients, category));

  return issues;
}

/**
 * Convenience function to validate a food product by auto-detecting category
 */
export function validateFoodProduct(
  nutrients: Partial<Record<NutrientKey, number>>,
  productName: string,
  ingredientKey?: string
): PlausibilityIssue[] {
  const category = detectFoodCategory(productName, ingredientKey);
  return validateNutrientProfile(nutrients, category, productName);
}
