/**
 * Substitution Engine
 *
 * Ranks ingredient substitution candidates based on:
 * - Same component family
 * - Allergen/exclusion compatibility
 * - Inventory availability
 * - Nutrient delta minimization
 */

export interface SubstitutionCandidate {
  ingredientId: string;
  ingredientName: string;
  category: string;
  allergenTags: string[];
  availableG: number;
  nutrientsPer100g: NutrientProfile;
}

export interface NutrientProfile {
  kcal?: number;
  protein_g?: number;
  fat_g?: number;
  carb_g?: number;
  fiber_g?: number;
  sodium_mg?: number;
}

export interface SubstitutionInput {
  originalIngredient: {
    ingredientId: string;
    ingredientName: string;
    category: string;
    allergenTags: string[];
    nutrientsPer100g: NutrientProfile;
  };
  requiredG: number;
  clientExclusions: string[];
}

export interface NutrientDelta {
  nutrient: string;
  original: number;
  substitute: number;
  delta: number;
  percentChange: number;
}

export interface SubstitutionRankFactor {
  factor: string;
  score: number;
  weight: number;
  weighted: number;
  detail: string;
}

export interface SubstitutionSuggestion {
  candidate: SubstitutionCandidate;
  totalScore: number;
  factors: SubstitutionRankFactor[];
  nutrientDeltas: NutrientDelta[];
  totalNutrientDeltaPercent: number;
  allergenSafe: boolean;
  sufficientInventory: boolean;
  warnings: string[];
}

const WEIGHTS = {
  categoryMatch: 0.30,
  allergenSafety: 0.25,
  inventoryAvailability: 0.20,
  nutrientSimilarity: 0.25,
} as const;

/**
 * Compute nutrient deltas between original and substitute per 100g
 */
export function computeNutrientDeltas(
  original: NutrientProfile,
  substitute: NutrientProfile
): NutrientDelta[] {
  const keys: (keyof NutrientProfile)[] = ["kcal", "protein_g", "fat_g", "carb_g", "fiber_g", "sodium_mg"];
  const deltas: NutrientDelta[] = [];

  for (const key of keys) {
    const origVal = original[key] ?? 0;
    const subVal = substitute[key] ?? 0;
    const delta = subVal - origVal;
    const percentChange = origVal === 0 ? (subVal === 0 ? 0 : 100) : (delta / origVal) * 100;
    deltas.push({
      nutrient: key,
      original: origVal,
      substitute: subVal,
      delta,
      percentChange,
    });
  }
  return deltas;
}

/**
 * Score a single substitution candidate
 */
export function scoreSubstitution(
  input: SubstitutionInput,
  candidate: SubstitutionCandidate
): SubstitutionSuggestion {
  const factors: SubstitutionRankFactor[] = [];
  const warnings: string[] = [];

  // 1. Category match
  const catMatch = candidate.category === input.originalIngredient.category ? 1 : 0.2;
  factors.push({
    factor: "category_match",
    score: catMatch,
    weight: WEIGHTS.categoryMatch,
    weighted: catMatch * WEIGHTS.categoryMatch,
    detail: catMatch === 1 ? "Same category" : `Different: ${candidate.category} vs ${input.originalIngredient.category}`,
  });

  // 2. Allergen safety
  const candidateAllergens = new Set(candidate.allergenTags.map((t) => t.toLowerCase()));
  const clientExclusions = new Set(input.clientExclusions.map((e) => e.toLowerCase()));
  const originalAllergens = new Set(input.originalIngredient.allergenTags.map((t) => t.toLowerCase()));

  // Check if substitute introduces new allergens not in original
  let newAllergens: string[] = [];
  for (const a of candidateAllergens) {
    if (!originalAllergens.has(a)) newAllergens.push(a);
  }
  // Check against client exclusions
  let excludedAllergens: string[] = [];
  for (const a of candidateAllergens) {
    if (clientExclusions.has(a)) excludedAllergens.push(a);
  }

  const allergenSafe = excludedAllergens.length === 0;
  let allergenScore = 1;
  if (excludedAllergens.length > 0) {
    allergenScore = 0;
    warnings.push(`Contains excluded allergen(s): ${excludedAllergens.join(", ")}`);
  } else if (newAllergens.length > 0) {
    allergenScore = 0.5;
    warnings.push(`Introduces new allergen(s): ${newAllergens.join(", ")}`);
  }
  factors.push({
    factor: "allergen_safety",
    score: allergenScore,
    weight: WEIGHTS.allergenSafety,
    weighted: allergenScore * WEIGHTS.allergenSafety,
    detail: allergenSafe ? "No allergen conflicts" : (warnings[warnings.length - 1] ?? "Allergen issue"),
  });

  // 3. Inventory availability
  const inventoryRatio = input.requiredG > 0 ? Math.min(1, candidate.availableG / input.requiredG) : 1;
  const sufficientInventory = candidate.availableG >= input.requiredG;
  if (!sufficientInventory) {
    warnings.push(`Insufficient inventory: ${candidate.availableG.toFixed(0)}g available, ${input.requiredG.toFixed(0)}g needed`);
  }
  factors.push({
    factor: "inventory_availability",
    score: inventoryRatio,
    weight: WEIGHTS.inventoryAvailability,
    weighted: inventoryRatio * WEIGHTS.inventoryAvailability,
    detail: `${candidate.availableG.toFixed(0)}g available / ${input.requiredG.toFixed(0)}g needed`,
  });

  // 4. Nutrient similarity (lower delta = higher score)
  const deltas = computeNutrientDeltas(input.originalIngredient.nutrientsPer100g, candidate.nutrientsPer100g);
  const avgAbsPercentChange = deltas.reduce((sum, d) => sum + Math.abs(d.percentChange), 0) / Math.max(deltas.length, 1);
  // Map to 0-1 score: 0% change = 1.0, 50%+ change = 0.0
  const nutrientScore = Math.max(0, 1 - avgAbsPercentChange / 50);
  const totalDeltaPercent = avgAbsPercentChange;

  if (avgAbsPercentChange > 30) {
    warnings.push(`High nutrient variance: avg ${avgAbsPercentChange.toFixed(1)}% change`);
  }
  factors.push({
    factor: "nutrient_similarity",
    score: nutrientScore,
    weight: WEIGHTS.nutrientSimilarity,
    weighted: nutrientScore * WEIGHTS.nutrientSimilarity,
    detail: `Avg nutrient delta: ${avgAbsPercentChange.toFixed(1)}%`,
  });

  const totalScore = factors.reduce((sum, f) => sum + f.weighted, 0);

  return {
    candidate,
    totalScore,
    factors,
    nutrientDeltas: deltas,
    totalNutrientDeltaPercent: totalDeltaPercent,
    allergenSafe,
    sufficientInventory,
    warnings,
  };
}

/**
 * Rank all substitution candidates, sorted by score desc
 */
export function rankSubstitutions(
  input: SubstitutionInput,
  candidates: SubstitutionCandidate[]
): SubstitutionSuggestion[] {
  return candidates
    .filter((c) => c.ingredientId !== input.originalIngredient.ingredientId)
    .map((c) => scoreSubstitution(input, c))
    .sort((a, b) => b.totalScore - a.totalScore);
}

/**
 * Classify substitution quality
 */
export function classifySubstitution(suggestion: SubstitutionSuggestion): "excellent" | "good" | "fair" | "poor" {
  if (!suggestion.allergenSafe) return "poor";
  if (suggestion.totalScore >= 0.8) return "excellent";
  if (suggestion.totalScore >= 0.6) return "good";
  if (suggestion.totalScore >= 0.4) return "fair";
  return "poor";
}
