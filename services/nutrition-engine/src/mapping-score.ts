/**
 * Instacart Mapping Confidence Scoring Engine
 *
 * Deterministic weighted scoring for matching Instacart order line items
 * to existing ingredients/products. All scoring factors are explainable.
 */

export interface MappingCandidate {
  ingredientId: string;
  ingredientName: string;
  ingredientCategory: string;
  productId?: string;
  productName?: string;
  productBrand?: string;
  productUpc?: string;
}

export interface MappingInput {
  productName: string;
  brand?: string | null;
  upc?: string | null;
  sizeText?: string | null;
}

export interface ScoreFactor {
  factor: string;
  weight: number;
  score: number;
  weighted: number;
  detail: string;
}

export interface MappingSuggestion {
  candidate: MappingCandidate;
  totalScore: number;
  factors: ScoreFactor[];
  isExactUpc: boolean;
  isHistorical: boolean;
}

// Weights for each scoring factor (sum to 1.0)
const WEIGHTS = {
  upcExact: 0.40,
  nameSimilarity: 0.30,
  brandMatch: 0.15,
  sizeMatch: 0.10,
  historicalMatch: 0.05,
} as const;

/**
 * Normalize text for comparison: lowercase, strip special chars, collapse whitespace
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tokenize normalized text into unique words
 */
export function tokenize(text: string): string[] {
  return [...new Set(normalizeText(text).split(" ").filter(Boolean))];
}

/**
 * Token overlap similarity: |intersection| / |union|  (Jaccard index)
 */
export function tokenSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.length === 0 && tokensB.length === 0) return 1;
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Substring containment bonus: does one string contain the other?
 */
function containmentBonus(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na.includes(nb) || nb.includes(na)) return 0.2;
  return 0;
}

/**
 * Extract numeric size from text (e.g., "24 oz" → { value: 24, unit: "oz" })
 */
function extractSize(text: string): { value: number; unit: string } | null {
  const match = text.match(/(\d+\.?\d*)\s*(oz|lb|lbs|g|kg|ml|l|gal|fl\s*oz)/i);
  if (!match || !match[1] || !match[2]) return null;
  return { value: parseFloat(match[1]), unit: match[2].toLowerCase().replace(/\s/g, "") };
}

/**
 * Compare sizes for similarity (0-1)
 */
function sizeScore(inputText: string | null | undefined, candidateText: string): number {
  if (!inputText) return 0.5; // neutral if no size info
  const inputSize = extractSize(inputText);
  const candidateSize = extractSize(candidateText);
  if (!inputSize || !candidateSize) return 0.5;
  if (inputSize.unit !== candidateSize.unit) return 0.2;
  const ratio = Math.min(inputSize.value, candidateSize.value) / Math.max(inputSize.value, candidateSize.value);
  return ratio;
}

/**
 * Score a single candidate against an input
 */
export function scoreCandidate(
  input: MappingInput,
  candidate: MappingCandidate,
  historicalMappings: Map<string, string> // normalized source name → ingredientId
): MappingSuggestion {
  const factors: ScoreFactor[] = [];

  // 1. UPC exact match
  const upcMatch =
    input.upc && candidate.productUpc && input.upc === candidate.productUpc ? 1 : 0;
  factors.push({
    factor: "upc_exact",
    weight: WEIGHTS.upcExact,
    score: upcMatch,
    weighted: upcMatch * WEIGHTS.upcExact,
    detail: upcMatch ? `UPC match: ${input.upc}` : "No UPC match",
  });

  // 2. Name similarity (Jaccard + containment bonus)
  const candidateFullName = [candidate.productName || candidate.ingredientName, candidate.productBrand]
    .filter(Boolean)
    .join(" ");
  const inputFullName = [input.productName, input.brand].filter(Boolean).join(" ");
  const jaccard = tokenSimilarity(inputFullName, candidateFullName);
  const containment = containmentBonus(inputFullName, candidateFullName);
  const nameScore = Math.min(1, jaccard + containment);
  factors.push({
    factor: "name_similarity",
    weight: WEIGHTS.nameSimilarity,
    score: nameScore,
    weighted: nameScore * WEIGHTS.nameSimilarity,
    detail: `Jaccard=${jaccard.toFixed(3)}, containment=${containment.toFixed(1)}`,
  });

  // 3. Brand match
  let brandScore = 0.5; // neutral if no brand
  if (input.brand && candidate.productBrand) {
    brandScore = normalizeText(input.brand) === normalizeText(candidate.productBrand) ? 1 : 0.1;
  } else if (input.brand && !candidate.productBrand) {
    brandScore = 0.3;
  }
  factors.push({
    factor: "brand_match",
    weight: WEIGHTS.brandMatch,
    score: brandScore,
    weighted: brandScore * WEIGHTS.brandMatch,
    detail: brandScore === 1 ? "Brand match" : brandScore < 0.5 ? "Brand mismatch" : "No brand data",
  });

  // 4. Size/unit match
  const sizeVal = sizeScore(input.sizeText, candidateFullName);
  factors.push({
    factor: "size_match",
    weight: WEIGHTS.sizeMatch,
    score: sizeVal,
    weighted: sizeVal * WEIGHTS.sizeMatch,
    detail: `Size similarity=${sizeVal.toFixed(2)}`,
  });

  // 5. Historical mapping match
  const normalizedInput = normalizeText([input.productName, input.brand].filter(Boolean).join(" "));
  const historicalIngredientId = historicalMappings.get(normalizedInput);
  const histScore = historicalIngredientId === candidate.ingredientId ? 1 : 0;
  factors.push({
    factor: "historical_match",
    weight: WEIGHTS.historicalMatch,
    score: histScore,
    weighted: histScore * WEIGHTS.historicalMatch,
    detail: histScore ? "Previously mapped to this ingredient" : "No historical match",
  });

  const totalScore = factors.reduce((sum, f) => sum + f.weighted, 0);

  return {
    candidate,
    totalScore,
    factors,
    isExactUpc: upcMatch === 1,
    isHistorical: histScore === 1,
  };
}

/**
 * Rank all candidates for an input, return sorted by score desc
 */
export function rankCandidates(
  input: MappingInput,
  candidates: MappingCandidate[],
  historicalMappings: Map<string, string>
): MappingSuggestion[] {
  return candidates
    .map((c) => scoreCandidate(input, c, historicalMappings))
    .sort((a, b) => b.totalScore - a.totalScore || a.candidate.ingredientId.localeCompare(b.candidate.ingredientId));
}

/**
 * Classify the confidence of a mapping suggestion
 */
export function classifyConfidence(score: number): "high" | "medium" | "low" | "none" {
  if (score >= 0.85) return "high";
  if (score >= 0.6) return "medium";
  if (score >= 0.3) return "low";
  return "none";
}
