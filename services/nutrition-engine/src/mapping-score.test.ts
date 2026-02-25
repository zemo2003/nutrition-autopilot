import { describe, it, expect } from "vitest";
import {
  normalizeText,
  tokenize,
  tokenSimilarity,
  scoreCandidate,
  rankCandidates,
  classifyConfidence,
  type MappingCandidate,
  type MappingInput,
} from "./mapping-score.js";

// ── Helpers ────────────────────────────────────────────

function makeCandidate(overrides: Partial<MappingCandidate> = {}): MappingCandidate {
  return {
    ingredientId: "ing-1",
    ingredientName: "Chicken Breast",
    ingredientCategory: "protein",
    ...overrides,
  };
}

function makeInput(overrides: Partial<MappingInput> = {}): MappingInput {
  return {
    productName: "Chicken Breast Boneless Skinless",
    brand: "Kirkland",
    upc: null,
    sizeText: null,
    ...overrides,
  };
}

// ── Text Normalization ─────────────────────────────────

describe("normalizeText", () => {
  it("lowercases and strips special characters", () => {
    expect(normalizeText("Kirkland's Chicken-Breast (2pk)")).toBe("kirkland s chicken breast 2pk");
  });

  it("collapses whitespace", () => {
    expect(normalizeText("  extra   spaces  ")).toBe("extra spaces");
  });

  it("handles empty string", () => {
    expect(normalizeText("")).toBe("");
  });
});

describe("tokenize", () => {
  it("returns unique tokens", () => {
    expect(tokenize("chicken breast chicken")).toEqual(["chicken", "breast"]);
  });

  it("returns empty for empty string", () => {
    expect(tokenize("")).toEqual([]);
  });
});

// ── Token Similarity ───────────────────────────────────

describe("tokenSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(tokenSimilarity("chicken breast", "chicken breast")).toBe(1);
  });

  it("returns 0 for completely different strings", () => {
    expect(tokenSimilarity("chicken breast", "organic quinoa")).toBe(0);
  });

  it("returns partial score for overlapping tokens", () => {
    const score = tokenSimilarity("chicken breast boneless", "chicken breast skinless");
    // intersection=2 (chicken,breast), union=4 → 0.5
    expect(score).toBe(0.5);
  });

  it("handles case and special characters", () => {
    const score = tokenSimilarity("Kirkland's Chicken", "kirkland chicken");
    expect(score).toBeGreaterThan(0.5);
  });
});

// ── Candidate Scoring ──────────────────────────────────

describe("scoreCandidate", () => {
  const emptyHistory = new Map<string, string>();

  it("scores UPC exact match very high", () => {
    const input = makeInput({ upc: "012345678901" });
    const candidate = makeCandidate({ productUpc: "012345678901", productName: "Totally Different Name" });
    const result = scoreCandidate(input, candidate, emptyHistory);
    expect(result.isExactUpc).toBe(true);
    expect(result.totalScore).toBeGreaterThan(0.4); // UPC weight alone
  });

  it("scores name similarity correctly", () => {
    const input = makeInput({ productName: "Boneless Skinless Chicken Breast", brand: null, upc: null });
    const candidate = makeCandidate({
      ingredientName: "Chicken Breast",
      productName: "Chicken Breast Boneless Skinless",
    });
    const result = scoreCandidate(input, candidate, emptyHistory);
    const nameFactor = result.factors.find((f) => f.factor === "name_similarity");
    expect(nameFactor!.score).toBeGreaterThan(0.5);
  });

  it("scores brand match as 1 when brands match", () => {
    const input = makeInput({ brand: "Kirkland" });
    const candidate = makeCandidate({ productBrand: "Kirkland" });
    const result = scoreCandidate(input, candidate, emptyHistory);
    const brandFactor = result.factors.find((f) => f.factor === "brand_match");
    expect(brandFactor!.score).toBe(1);
  });

  it("scores brand mismatch low", () => {
    const input = makeInput({ brand: "Kirkland" });
    const candidate = makeCandidate({ productBrand: "Tyson" });
    const result = scoreCandidate(input, candidate, emptyHistory);
    const brandFactor = result.factors.find((f) => f.factor === "brand_match");
    expect(brandFactor!.score).toBeLessThan(0.5);
  });

  it("scores historical match bonus", () => {
    const input = makeInput({ productName: "Chicken Breast", brand: "Kirkland" });
    const candidate = makeCandidate({ ingredientId: "ing-1" });
    // normalizeText joins brand+name: "chicken breast kirkland"
    const normalizedKey = "chicken breast kirkland";
    const history = new Map([[normalizedKey, "ing-1"]]);
    const result = scoreCandidate(input, candidate, history);
    const histFactor = result.factors.find((f) => f.factor === "historical_match");
    expect(histFactor!.score).toBe(1);
    expect(result.isHistorical).toBe(true);
  });

  it("all factors sum to total score", () => {
    const input = makeInput();
    const candidate = makeCandidate();
    const result = scoreCandidate(input, candidate, emptyHistory);
    const factorSum = result.factors.reduce((s, f) => s + f.weighted, 0);
    expect(Math.abs(result.totalScore - factorSum)).toBeLessThan(0.001);
  });

  it("produces explainable score factors", () => {
    const result = scoreCandidate(makeInput(), makeCandidate(), emptyHistory);
    expect(result.factors).toHaveLength(5);
    for (const f of result.factors) {
      expect(f.factor).toBeTruthy();
      expect(f.detail).toBeTruthy();
      expect(f.weight).toBeGreaterThan(0);
      expect(f.score).toBeGreaterThanOrEqual(0);
      expect(f.score).toBeLessThanOrEqual(1);
    }
  });
});

// ── Ranking ────────────────────────────────────────────

describe("rankCandidates", () => {
  const emptyHistory = new Map<string, string>();

  it("ranks exact UPC match first", () => {
    const input = makeInput({ upc: "111111111111", productName: "Random Product" });
    const candidates: MappingCandidate[] = [
      makeCandidate({ ingredientId: "a", ingredientName: "Wrong Thing" }),
      makeCandidate({ ingredientId: "b", ingredientName: "Also Wrong", productUpc: "111111111111" }),
      makeCandidate({ ingredientId: "c", ingredientName: "Chicken Breast" }),
    ];
    const ranked = rankCandidates(input, candidates, emptyHistory);
    expect(ranked[0]!.candidate.ingredientId).toBe("b");
    expect(ranked[0]!.isExactUpc).toBe(true);
  });

  it("ranks by score descending", () => {
    const input = makeInput({ productName: "Chicken Breast", brand: null, upc: null });
    const candidates: MappingCandidate[] = [
      makeCandidate({ ingredientId: "a", ingredientName: "Quinoa" }),
      makeCandidate({ ingredientId: "b", ingredientName: "Chicken Breast" }),
      makeCandidate({ ingredientId: "c", ingredientName: "Salmon" }),
    ];
    const ranked = rankCandidates(input, candidates, emptyHistory);
    expect(ranked[0]!.candidate.ingredientId).toBe("b");
    expect(ranked[0]!.totalScore).toBeGreaterThanOrEqual(ranked[1]!.totalScore);
    expect(ranked[1]!.totalScore).toBeGreaterThanOrEqual(ranked[2]!.totalScore);
  });

  it("returns deterministic order for same-score candidates", () => {
    const input = makeInput({ productName: "Test", brand: null, upc: null });
    const candidates: MappingCandidate[] = [
      makeCandidate({ ingredientId: "a", ingredientName: "X" }),
      makeCandidate({ ingredientId: "b", ingredientName: "Y" }),
    ];
    const r1 = rankCandidates(input, candidates, emptyHistory);
    const r2 = rankCandidates(input, candidates, emptyHistory);
    expect(r1.map((r) => r.candidate.ingredientId)).toEqual(
      r2.map((r) => r.candidate.ingredientId)
    );
  });

  it("handles empty candidate list", () => {
    const ranked = rankCandidates(makeInput(), [], emptyHistory);
    expect(ranked).toHaveLength(0);
  });
});

// ── Confidence Classification ──────────────────────────

describe("classifyConfidence", () => {
  it("classifies high confidence", () => {
    expect(classifyConfidence(0.90)).toBe("high");
    expect(classifyConfidence(0.85)).toBe("high");
  });

  it("classifies medium confidence", () => {
    expect(classifyConfidence(0.70)).toBe("medium");
    expect(classifyConfidence(0.60)).toBe("medium");
  });

  it("classifies low confidence", () => {
    expect(classifyConfidence(0.40)).toBe("low");
    expect(classifyConfidence(0.30)).toBe("low");
  });

  it("classifies none", () => {
    expect(classifyConfidence(0.1)).toBe("none");
    expect(classifyConfidence(0)).toBe("none");
  });
});

// ── Idempotency / Determinism ──────────────────────────

describe("determinism", () => {
  const emptyHistory = new Map<string, string>();

  it("same inputs produce same scores every time", () => {
    const input = makeInput();
    const candidate = makeCandidate();
    const s1 = scoreCandidate(input, candidate, emptyHistory);
    const s2 = scoreCandidate(input, candidate, emptyHistory);
    expect(s1.totalScore).toBe(s2.totalScore);
    expect(s1.factors.map((f) => f.weighted)).toEqual(s2.factors.map((f) => f.weighted));
  });

  it("scoring is order-independent", () => {
    const input = makeInput({ productName: "Organic Chicken Breast", brand: null, upc: null });
    const candidates = [
      makeCandidate({ ingredientId: "a", ingredientName: "Chicken Breast" }),
      makeCandidate({ ingredientId: "b", ingredientName: "Salmon Fillet" }),
      makeCandidate({ ingredientId: "c", ingredientName: "Ground Turkey" }),
    ];
    const r1 = rankCandidates(input, candidates, emptyHistory);
    const r2 = rankCandidates(input, [...candidates].reverse(), emptyHistory);
    expect(r1.map((r) => r.candidate.ingredientId)).toEqual(
      r2.map((r) => r.candidate.ingredientId)
    );
  });
});
