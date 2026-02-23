/**
 * Yield Factor Framework
 *
 * Cooking yield factors account for moisture loss/gain during food preparation.
 * When a recipe specifies 200g of "cooked chicken breast", but the nutrient profile
 * is for RAW chicken, we need to know how much raw chicken produces 200g cooked.
 *
 * Yield Factor = cooked weight / raw weight
 *   - Chicken breast: 0.75 (loses ~25% moisture when cooked)
 *   - This means 200g cooked came from ~267g raw
 *   - Nutrient density per gram INCREASES after cooking (same nutrients, less water)
 *
 * Usage:
 *   If recipe says "200g cooked chicken" and we have RAW nutrient data:
 *     rawEquivalentG = 200 / 0.75 = 267g
 *     nutrients = rawPer100g × 267 / 100
 *
 *   If recipe says "200g raw chicken" and we have COOKED nutrient data:
 *     cookedEquivalentG = 200 × 0.75 = 150g
 *     nutrients = cookedPer100g × 150 / 100
 *
 * Sources: USDA Table of Nutrient Retention Factors (Release 6),
 *          USDA Cooking Yield Factors (1992, revised 2007)
 */

export type PreparedState = "RAW" | "COOKED" | "DRY" | "CANNED" | "FROZEN";

/**
 * Common cooking yield factors: cooked_weight / raw_weight
 * Keyed by ingredient category or specific ingredient pattern.
 *
 * Values from USDA Cooking Yield Factors and cross-referenced with
 * FDA Nutrient Retention Factors.
 */
export const YIELD_FACTORS: Record<string, number> = {
  // === POULTRY ===
  "chicken_breast": 0.75,       // Skinless, roasted/grilled
  "chicken_thigh": 0.72,        // Skinless, roasted
  "chicken_whole": 0.70,        // Whole roasted
  "ground_turkey": 0.78,        // Pan-cooked
  "turkey_breast": 0.76,        // Roasted

  // === BEEF ===
  "ground_beef_95": 0.78,       // 95% lean, pan-browned
  "ground_beef_90": 0.73,       // 90% lean, pan-browned
  "ground_beef_85": 0.68,       // 85% lean, pan-browned
  "ground_beef_80": 0.64,       // 80% lean, pan-browned
  "beef_steak": 0.72,           // Grilled/broiled
  "beef_roast": 0.70,           // Oven-roasted

  // === PORK ===
  "pork_chop": 0.72,            // Pan-fried/grilled
  "pork_tenderloin": 0.75,      // Roasted
  "ground_pork": 0.72,          // Pan-cooked

  // === FISH & SEAFOOD ===
  "salmon": 0.80,               // Baked/broiled
  "cod": 0.82,                  // Baked
  "tuna_steak": 0.82,           // Grilled
  "shrimp": 0.85,               // Steamed/boiled
  "tilapia": 0.82,              // Pan-fried

  // === GRAINS & STARCHES ===
  "rice_white": 2.50,           // Absorbs water — yield > 1
  "rice_brown": 2.40,           // Absorbs water
  "pasta": 2.25,                // Absorbs water
  "quinoa": 2.60,               // Absorbs water
  "oats_rolled": 3.00,          // Absorbs water (porridge)

  // === LEGUMES ===
  "beans_dried": 2.30,          // Soaked and cooked
  "lentils": 2.20,              // Cooked from dry

  // === VEGETABLES ===
  "broccoli": 0.88,             // Steamed/boiled
  "spinach": 0.77,              // Sautéed (significant water loss)
  "carrots": 0.90,              // Boiled
  "sweet_potato": 0.90,         // Baked
  "potato": 0.88,               // Baked
  "bell_pepper": 0.85,          // Roasted
  "onion": 0.75,                // Sautéed
  "mushroom": 0.65,             // Sautéed (high water loss)
  "kale": 0.78,                 // Sautéed

  // === EGGS ===
  "egg_whole": 0.92,            // Scrambled/fried (minimal loss)
  "egg_white": 0.95,            // Cooked

  // Default fallbacks by category
  "default_meat": 0.75,
  "default_fish": 0.82,
  "default_vegetable": 0.88,
  "default_grain": 2.40,
  "default_legume": 2.25,
};

/**
 * Infer a yield factor from ingredient name and preparation text.
 * Returns the yield factor (cooked/raw ratio) and the detected key.
 */
export function inferYieldFactor(
  ingredientName: string,
  preparation?: string | null
): { factor: number; key: string; inferred: boolean } {
  const text = [ingredientName, preparation].filter(Boolean).join(" ").toLowerCase();

  // Specific ingredient matches (most specific first)
  const specificMatches: Array<[RegExp, string]> = [
    [/chicken\s*breast/i, "chicken_breast"],
    [/chicken\s*thigh/i, "chicken_thigh"],
    [/ground\s*turkey/i, "ground_turkey"],
    [/turkey\s*breast/i, "turkey_breast"],
    [/ground\s*beef.*95|95.*lean.*beef/i, "ground_beef_95"],
    [/ground\s*beef.*90|90.*lean.*beef/i, "ground_beef_90"],
    [/ground\s*beef.*85|85.*lean.*beef/i, "ground_beef_85"],
    [/ground\s*beef.*80|80.*lean.*beef/i, "ground_beef_80"],
    [/ground\s*beef/i, "ground_beef_95"], // default to 95% lean
    [/beef\s*steak|steak/i, "beef_steak"],
    [/beef\s*roast|roast\s*beef/i, "beef_roast"],
    [/pork\s*chop/i, "pork_chop"],
    [/pork\s*tenderloin/i, "pork_tenderloin"],
    [/ground\s*pork/i, "ground_pork"],
    [/salmon/i, "salmon"],
    [/cod\b/i, "cod"],
    [/tuna/i, "tuna_steak"],
    [/shrimp|prawn/i, "shrimp"],
    [/tilapia/i, "tilapia"],
    [/brown\s*rice/i, "rice_brown"],
    [/white?\s*rice|rice/i, "rice_white"],
    [/pasta|spaghetti|penne|linguine|fettuccine|macaroni/i, "pasta"],
    [/quinoa/i, "quinoa"],
    [/oat|oatmeal/i, "oats_rolled"],
    [/black\s*bean|kidney\s*bean|pinto\s*bean|navy\s*bean|bean/i, "beans_dried"],
    [/lentil/i, "lentils"],
    [/broccoli/i, "broccoli"],
    [/spinach/i, "spinach"],
    [/carrot/i, "carrots"],
    [/sweet\s*potato/i, "sweet_potato"],
    [/potato/i, "potato"],
    [/bell\s*pepper|red\s*pepper/i, "bell_pepper"],
    [/onion/i, "onion"],
    [/mushroom/i, "mushroom"],
    [/kale/i, "kale"],
    [/egg\s*white/i, "egg_white"],
    [/egg/i, "egg_whole"],
  ];

  for (const [pattern, key] of specificMatches) {
    if (pattern.test(text)) {
      return { factor: YIELD_FACTORS[key]!, key, inferred: true };
    }
  }

  // Category-level fallback
  const categoryFallbacks: Array<[RegExp, string]> = [
    [/chicken|turkey|duck|goose|poultry/i, "default_meat"],
    [/beef|pork|lamb|veal|venison/i, "default_meat"],
    [/fish|cod|halibut|trout|sardine|herring|mackerel/i, "default_fish"],
    [/shrimp|crab|lobster|clam|oyster|mussel|scallop/i, "default_fish"],
    [/rice|pasta|bread|wheat|barley|couscous|polenta/i, "default_grain"],
    [/bean|lentil|chickpea|pea(?!nut)/i, "default_legume"],
    [/broccoli|spinach|carrot|lettuce|kale|cabbage|cauliflower|celery|tomato|pepper|onion|garlic|zucchini|cucumber|asparagus|mushroom|squash|potato|eggplant/i, "default_vegetable"],
  ];

  for (const [pattern, key] of categoryFallbacks) {
    if (pattern.test(text)) {
      return { factor: YIELD_FACTORS[key]!, key, inferred: true };
    }
  }

  // No match — return 1.0 (no adjustment)
  return { factor: 1.0, key: "none", inferred: false };
}

/**
 * Apply yield factor correction to grams consumed.
 *
 * When the recipe specifies a weight in one state (e.g., "200g cooked chicken")
 * but the nutrient profile is in a different state (e.g., RAW per-100g data),
 * we need to convert.
 *
 * @param gramsConsumed - grams as specified in the recipe
 * @param recipeState - the state the recipe weight refers to (e.g., COOKED)
 * @param nutrientProfileState - the state of the nutrient data (e.g., RAW)
 * @param yieldFactor - cooking yield factor (cooked/raw ratio)
 * @returns adjusted grams for nutrient calculation
 */
export function applyYieldCorrection(
  gramsConsumed: number,
  recipeState: PreparedState,
  nutrientProfileState: PreparedState,
  yieldFactor: number
): number {
  if (yieldFactor <= 0 || yieldFactor === 1.0) return gramsConsumed;
  if (recipeState === nutrientProfileState) return gramsConsumed;

  // Recipe says COOKED weight, but nutrient data is RAW
  // Need to find raw equivalent: rawG = cookedG / yieldFactor
  if (recipeState === "COOKED" && nutrientProfileState === "RAW") {
    return gramsConsumed / yieldFactor;
  }

  // Recipe says RAW weight, but nutrient data is COOKED
  // Need to find cooked equivalent: cookedG = rawG × yieldFactor
  if (recipeState === "RAW" && nutrientProfileState === "COOKED") {
    return gramsConsumed * yieldFactor;
  }

  // For DRY→COOKED conversions (grains, legumes), yield > 1
  // Recipe says DRY weight, nutrient data is COOKED
  if (recipeState === "DRY" && nutrientProfileState === "COOKED") {
    return gramsConsumed * yieldFactor;
  }

  // Recipe says COOKED weight, nutrient data is DRY
  if (recipeState === "COOKED" && nutrientProfileState === "DRY") {
    return gramsConsumed / yieldFactor;
  }

  // Unsupported combination — no adjustment
  return gramsConsumed;
}

/**
 * Detect the likely state of a nutrient profile based on the fallback key name.
 * Returns RAW if the key contains "RAW", COOKED if it contains "COOKED", etc.
 */
export function detectNutrientProfileState(fallbackKey: string): PreparedState {
  const upper = fallbackKey.toUpperCase();
  if (upper.includes("COOKED") || upper.includes("DRAINED")) return "COOKED";
  if (upper.includes("DRY") || upper.includes("DRIED")) return "DRY";
  if (upper.includes("CANNED")) return "CANNED";
  if (upper.includes("FROZEN")) return "FROZEN";
  return "RAW";
}
