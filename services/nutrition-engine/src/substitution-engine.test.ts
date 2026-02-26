import { describe, it, expect } from "vitest";
import {
  computeNutrientDeltas,
  scoreSubstitution,
  rankSubstitutions,
  classifySubstitution,
  type SubstitutionCandidate,
  type SubstitutionInput,
  type NutrientProfile,
} from "./substitution-engine.js";

// ── Helpers ────────────────────────────────────────────

const chickenNutrients: NutrientProfile = {
  kcal: 165,
  protein_g: 31,
  fat_g: 3.6,
  carb_g: 0,
  fiber_g: 0,
  sodium_mg: 74,
};

const turkeyNutrients: NutrientProfile = {
  kcal: 157,
  protein_g: 29.3,
  fat_g: 3.2,
  carb_g: 0,
  fiber_g: 0,
  sodium_mg: 68,
};

const salmonNutrients: NutrientProfile = {
  kcal: 208,
  protein_g: 20,
  fat_g: 13,
  carb_g: 0,
  fiber_g: 0,
  sodium_mg: 59,
};

const tofuNutrients: NutrientProfile = {
  kcal: 76,
  protein_g: 8,
  fat_g: 4.8,
  carb_g: 1.9,
  fiber_g: 0.3,
  sodium_mg: 7,
};

function makeInput(overrides: Partial<SubstitutionInput> = {}): SubstitutionInput {
  return {
    originalIngredient: {
      ingredientId: "chicken-id",
      ingredientName: "Chicken Breast",
      category: "protein",
      allergenTags: [],
      nutrientsPer100g: chickenNutrients,
    },
    requiredG: 200,
    clientExclusions: [],
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<SubstitutionCandidate> = {}): SubstitutionCandidate {
  return {
    ingredientId: "turkey-id",
    ingredientName: "Ground Turkey",
    category: "protein",
    allergenTags: [],
    availableG: 500,
    nutrientsPer100g: turkeyNutrients,
    ...overrides,
  };
}

// ── Nutrient Deltas ────────────────────────────────────

describe("computeNutrientDeltas", () => {
  it("computes correct deltas for similar proteins", () => {
    const deltas = computeNutrientDeltas(chickenNutrients, turkeyNutrients);
    const kcalDelta = deltas.find((d) => d.nutrient === "kcal")!;
    expect(kcalDelta.original).toBe(165);
    expect(kcalDelta.substitute).toBe(157);
    expect(kcalDelta.delta).toBe(-8);
    expect(kcalDelta.percentChange).toBeCloseTo(-4.85, 1);
  });

  it("handles zero original values", () => {
    const deltas = computeNutrientDeltas(chickenNutrients, tofuNutrients);
    const carbDelta = deltas.find((d) => d.nutrient === "carb_g")!;
    expect(carbDelta.original).toBe(0);
    expect(carbDelta.substitute).toBe(1.9);
    expect(carbDelta.percentChange).toBe(100);
  });

  it("handles both zero values as 0% change", () => {
    const deltas = computeNutrientDeltas(chickenNutrients, turkeyNutrients);
    const carbDelta = deltas.find((d) => d.nutrient === "carb_g")!;
    expect(carbDelta.percentChange).toBe(0);
  });

  it("returns all 6 macro nutrients", () => {
    const deltas = computeNutrientDeltas(chickenNutrients, turkeyNutrients);
    expect(deltas).toHaveLength(6);
    const nutrients = deltas.map((d) => d.nutrient);
    expect(nutrients).toContain("kcal");
    expect(nutrients).toContain("protein_g");
    expect(nutrients).toContain("fat_g");
    expect(nutrients).toContain("carb_g");
    expect(nutrients).toContain("fiber_g");
    expect(nutrients).toContain("sodium_mg");
  });
});

// ── Substitution Scoring ───────────────────────────────

describe("scoreSubstitution", () => {
  it("scores same-category with similar nutrients very high", () => {
    const result = scoreSubstitution(makeInput(), makeCandidate());
    expect(result.totalScore).toBeGreaterThan(0.7);
    expect(result.allergenSafe).toBe(true);
    expect(result.sufficientInventory).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("scores different category lower", () => {
    const candidate = makeCandidate({
      ingredientId: "rice-id",
      ingredientName: "Brown Rice",
      category: "carb_base",
      nutrientsPer100g: { kcal: 123, protein_g: 2.7, fat_g: 1, carb_g: 26, fiber_g: 1.6, sodium_mg: 4 },
    });
    const result = scoreSubstitution(makeInput(), candidate);
    const catFactor = result.factors.find((f) => f.factor === "category_match")!;
    expect(catFactor.score).toBe(0.2);
    expect(result.totalScore).toBeLessThan(0.6);
  });

  it("flags allergen conflicts with client exclusions", () => {
    const input = makeInput({ clientExclusions: ["soy"] });
    const candidate = makeCandidate({
      ingredientId: "tofu-id",
      ingredientName: "Tofu",
      allergenTags: ["soy"],
      nutrientsPer100g: tofuNutrients,
    });
    const result = scoreSubstitution(input, candidate);
    expect(result.allergenSafe).toBe(false);
    const allergenFactor = result.factors.find((f) => f.factor === "allergen_safety")!;
    expect(allergenFactor.score).toBe(0);
    expect(result.warnings.some((w) => w.includes("excluded allergen"))).toBe(true);
  });

  it("warns on new allergens not in original", () => {
    const candidate = makeCandidate({
      ingredientId: "shrimp-id",
      ingredientName: "Shrimp",
      allergenTags: ["shellfish"],
    });
    const result = scoreSubstitution(makeInput(), candidate);
    const allergenFactor = result.factors.find((f) => f.factor === "allergen_safety")!;
    expect(allergenFactor.score).toBe(0.5);
    expect(result.warnings.some((w) => w.includes("new allergen"))).toBe(true);
  });

  it("scores insufficient inventory with warning", () => {
    const candidate = makeCandidate({ availableG: 50 });
    const result = scoreSubstitution(makeInput({ requiredG: 200 }), candidate);
    expect(result.sufficientInventory).toBe(false);
    expect(result.warnings.some((w) => w.includes("Insufficient inventory"))).toBe(true);
    const invFactor = result.factors.find((f) => f.factor === "inventory_availability")!;
    expect(invFactor.score).toBe(0.25); // 50/200
  });

  it("penalizes large nutrient deltas", () => {
    const input = makeInput();
    const highFatCandidate = makeCandidate({
      nutrientsPer100g: salmonNutrients,
    });
    const result = scoreSubstitution(input, highFatCandidate);
    const nutrientFactor = result.factors.find((f) => f.factor === "nutrient_similarity")!;
    // Salmon has much higher fat (13 vs 3.6) → expect lower nutrient score
    expect(nutrientFactor.score).toBeLessThan(0.8);
  });

  it("all factors sum to total score", () => {
    const result = scoreSubstitution(makeInput(), makeCandidate());
    const factorSum = result.factors.reduce((s, f) => s + f.weighted, 0);
    expect(Math.abs(result.totalScore - factorSum)).toBeLessThan(0.001);
  });

  it("provides explainable rank factors", () => {
    const result = scoreSubstitution(makeInput(), makeCandidate());
    expect(result.factors).toHaveLength(4);
    for (const f of result.factors) {
      expect(f.factor).toBeTruthy();
      expect(f.detail).toBeTruthy();
      expect(f.weight).toBeGreaterThan(0);
    }
  });
});

// ── Ranking ────────────────────────────────────────────

describe("rankSubstitutions", () => {
  it("ranks same-category closest-nutrient first", () => {
    const candidates: SubstitutionCandidate[] = [
      makeCandidate({
        ingredientId: "tofu-id",
        ingredientName: "Tofu",
        category: "protein",
        nutrientsPer100g: tofuNutrients,
        availableG: 1000,
      }),
      makeCandidate({
        ingredientId: "turkey-id",
        ingredientName: "Ground Turkey",
        category: "protein",
        nutrientsPer100g: turkeyNutrients,
        availableG: 1000,
      }),
      makeCandidate({
        ingredientId: "salmon-id",
        ingredientName: "Salmon",
        category: "protein",
        nutrientsPer100g: salmonNutrients,
        availableG: 1000,
      }),
    ];
    const ranked = rankSubstitutions(makeInput(), candidates);
    // Turkey should rank highest (closest nutrients to chicken)
    expect(ranked[0]!.candidate.ingredientId).toBe("turkey-id");
  });

  it("excludes original ingredient from results", () => {
    const candidates: SubstitutionCandidate[] = [
      makeCandidate({ ingredientId: "chicken-id", ingredientName: "Chicken Breast" }),
      makeCandidate({ ingredientId: "turkey-id", ingredientName: "Turkey" }),
    ];
    const ranked = rankSubstitutions(makeInput(), candidates);
    expect(ranked.every((r) => r.candidate.ingredientId !== "chicken-id")).toBe(true);
    expect(ranked).toHaveLength(1);
  });

  it("returns empty for no candidates", () => {
    expect(rankSubstitutions(makeInput(), [])).toHaveLength(0);
  });

  it("returns deterministic order", () => {
    const candidates = [
      makeCandidate({ ingredientId: "a", ingredientName: "A", nutrientsPer100g: turkeyNutrients }),
      makeCandidate({ ingredientId: "b", ingredientName: "B", nutrientsPer100g: salmonNutrients }),
    ];
    const r1 = rankSubstitutions(makeInput(), candidates);
    const r2 = rankSubstitutions(makeInput(), [...candidates].reverse());
    expect(r1.map((r) => r.candidate.ingredientId)).toEqual(
      r2.map((r) => r.candidate.ingredientId)
    );
  });
});

// ── Classification ─────────────────────────────────────

describe("classifySubstitution", () => {
  it("classifies excellent substitution", () => {
    const result = scoreSubstitution(makeInput(), makeCandidate());
    expect(classifySubstitution(result)).toBe("excellent");
  });

  it("classifies poor when allergen unsafe", () => {
    const input = makeInput({ clientExclusions: ["soy"] });
    const candidate = makeCandidate({ allergenTags: ["soy"], nutrientsPer100g: tofuNutrients });
    const result = scoreSubstitution(input, candidate);
    expect(classifySubstitution(result)).toBe("poor");
  });
});

// ── Regression: Label Freeze Safety ────────────────────

describe("substitution does not affect frozen labels", () => {
  it("nutrient delta is informational only - no label mutation", () => {
    const result = scoreSubstitution(makeInput(), makeCandidate());
    // Verify deltas are pure computation, no side effects
    expect(result.nutrientDeltas).toBeDefined();
    expect(result.nutrientDeltas.length).toBeGreaterThan(0);
    // Original nutrients unchanged
    expect(chickenNutrients.kcal).toBe(165);
    expect(chickenNutrients.protein_g).toBe(31);
  });

  it("ranking is read-only with no mutations", () => {
    const input = makeInput();
    const origNutrients = { ...input.originalIngredient.nutrientsPer100g };
    const candidates = [makeCandidate()];
    rankSubstitutions(input, candidates);
    // Input not mutated
    expect(input.originalIngredient.nutrientsPer100g).toEqual(origNutrients);
  });
});
