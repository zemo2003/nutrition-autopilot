import { describe, it, expect } from "vitest";
import {
  computeNutrientDeltas,
  generateDeltaExplanations,
  runIntegrityChecks,
  buildRecomputeDiff,
  type SnapshotData,
  type RecomputedData,
} from "./reproducibility.js";

function makeSnapshot(overrides: Partial<SnapshotData> = {}): SnapshotData {
  return {
    labelId: "label-1",
    frozenAt: "2026-02-25T12:00:00Z",
    skuName: "Chicken Bowl",
    recipeName: "Grilled Chicken Rice Bowl",
    servings: 1,
    servingWeightG: 450,
    perServing: { kcal: 520, protein_g: 42, carb_g: 55, fat_g: 14, sodium_mg: 680 },
    provisional: false,
    reasonCodes: [],
    evidenceSummary: {
      verifiedCount: 12,
      inferredCount: 0,
      exceptionCount: 0,
      totalNutrientRows: 12,
      sourceRefs: ["USDA_BRANDED"],
      gradeBreakdown: { USDA_BRANDED: 12 },
    },
    ...overrides,
  };
}

function makeRecomputed(overrides: Partial<RecomputedData> = {}): RecomputedData {
  return {
    perServing: { kcal: 520, protein_g: 42, carb_g: 55, fat_g: 14, sodium_mg: 680 },
    servingWeightG: 450,
    provisional: false,
    reasonCodes: [],
    evidenceSummary: {
      verifiedCount: 12,
      inferredCount: 0,
      exceptionCount: 0,
      totalNutrientRows: 12,
      sourceRefs: ["USDA_BRANDED"],
      gradeBreakdown: { USDA_BRANDED: 12 },
    },
    ...overrides,
  };
}

describe("reproducibility", () => {
  describe("computeNutrientDeltas", () => {
    it("returns zero deltas for identical values", () => {
      const deltas = computeNutrientDeltas(
        { kcal: 520, protein_g: 42 },
        { kcal: 520, protein_g: 42 },
      );
      expect(deltas.every((d) => d.absoluteDelta === 0)).toBe(true);
      expect(deltas.every((d) => !d.significant)).toBe(true);
    });

    it("detects significant changes", () => {
      const deltas = computeNutrientDeltas(
        { kcal: 520, protein_g: 42 },
        { kcal: 580, protein_g: 42 },
      );
      const kcalDelta = deltas.find((d) => d.nutrientKey === "kcal");
      expect(kcalDelta?.absoluteDelta).toBe(60);
      expect(kcalDelta?.significant).toBe(true);
    });

    it("ignores insignificant changes (<5% and <1 abs)", () => {
      const deltas = computeNutrientDeltas(
        { kcal: 520 },
        { kcal: 520.5 },
      );
      expect(deltas[0]!.significant).toBe(false);
    });

    it("handles new nutrients in recomputed", () => {
      const deltas = computeNutrientDeltas(
        { kcal: 520 },
        { kcal: 520, fiber_g: 8 },
      );
      const fiber = deltas.find((d) => d.nutrientKey === "fiber_g");
      expect(fiber?.frozenValue).toBe(0);
      expect(fiber?.currentValue).toBe(8);
      expect(fiber?.significant).toBe(true);
    });

    it("handles removed nutrients", () => {
      const deltas = computeNutrientDeltas(
        { kcal: 520, fiber_g: 8 },
        { kcal: 520 },
      );
      const fiber = deltas.find((d) => d.nutrientKey === "fiber_g");
      expect(fiber?.absoluteDelta).toBe(-8);
    });

    it("sorts significant deltas first", () => {
      const deltas = computeNutrientDeltas(
        { kcal: 520, protein_g: 42 },
        { kcal: 600, protein_g: 42.3 },
      );
      expect(deltas[0]!.nutrientKey).toBe("kcal");
      expect(deltas[0]!.significant).toBe(true);
    });
  });

  describe("generateDeltaExplanations", () => {
    it("returns no explanations for identical data", () => {
      const snapshot = makeSnapshot();
      const recomputed = makeRecomputed();
      const deltas = computeNutrientDeltas(snapshot.perServing, recomputed.perServing);
      const explanations = generateDeltaExplanations(snapshot, recomputed, deltas);
      expect(explanations.length).toBe(0);
    });

    it("explains serving weight change", () => {
      const snapshot = makeSnapshot();
      const recomputed = makeRecomputed({ servingWeightG: 480 });
      const deltas = computeNutrientDeltas(snapshot.perServing, recomputed.perServing);
      const explanations = generateDeltaExplanations(snapshot, recomputed, deltas);
      expect(explanations.some((e) => e.category === "serving_weight_change")).toBe(true);
    });

    it("explains provisional status change", () => {
      const snapshot = makeSnapshot({ provisional: false });
      const recomputed = makeRecomputed({ provisional: true });
      const deltas = computeNutrientDeltas(snapshot.perServing, recomputed.perServing);
      const explanations = generateDeltaExplanations(snapshot, recomputed, deltas);
      expect(explanations.some((e) => e.category === "provisional_status_change")).toBe(true);
    });

    it("explains new reason codes", () => {
      const snapshot = makeSnapshot({ reasonCodes: [] });
      const recomputed = makeRecomputed({ reasonCodes: ["UNVERIFIED_SOURCE"] });
      const deltas = computeNutrientDeltas(snapshot.perServing, recomputed.perServing);
      const explanations = generateDeltaExplanations(snapshot, recomputed, deltas);
      expect(explanations.some((e) => e.category === "reason_code_change" && e.description.includes("New"))).toBe(true);
    });

    it("explains nutrient value changes", () => {
      const snapshot = makeSnapshot();
      const recomputed = makeRecomputed({ perServing: { kcal: 600, protein_g: 50, carb_g: 55, fat_g: 14, sodium_mg: 680 } });
      const deltas = computeNutrientDeltas(snapshot.perServing, recomputed.perServing);
      const explanations = generateDeltaExplanations(snapshot, recomputed, deltas);
      expect(explanations.some((e) => e.category === "nutrient_value_change")).toBe(true);
    });
  });

  describe("runIntegrityChecks", () => {
    it("passes all checks for valid snapshot", () => {
      const checks = runIntegrityChecks(makeSnapshot());
      expect(checks.every((c) => c.passed)).toBe(true);
    });

    it("fails frozen timestamp check", () => {
      const checks = runIntegrityChecks(makeSnapshot({ frozenAt: "" }));
      const check = checks.find((c) => c.check === "frozen_timestamp_present");
      expect(check?.passed).toBe(false);
    });

    it("fails serving weight check", () => {
      const checks = runIntegrityChecks(makeSnapshot({ servingWeightG: 0 }));
      const check = checks.find((c) => c.check === "serving_weight_positive");
      expect(check?.passed).toBe(false);
    });

    it("fails core nutrients check", () => {
      const checks = runIntegrityChecks(makeSnapshot({ perServing: { kcal: 520 } }));
      const check = checks.find((c) => c.check === "core_nutrients_present");
      expect(check?.passed).toBe(false);
    });

    it("fails servings check", () => {
      const checks = runIntegrityChecks(makeSnapshot({ servings: 0 }));
      const check = checks.find((c) => c.check === "servings_positive");
      expect(check?.passed).toBe(false);
    });
  });

  describe("buildRecomputeDiff", () => {
    it("reports no differences for identical data", () => {
      const diff = buildRecomputeDiff(makeSnapshot(), makeRecomputed());
      expect(diff.hasDifferences).toBe(false);
      expect(diff.significantDeltas.length).toBe(0);
      expect(diff.summary).toContain("No significant differences");
    });

    it("reports differences for changed nutrients", () => {
      const diff = buildRecomputeDiff(
        makeSnapshot(),
        makeRecomputed({ perServing: { kcal: 600, protein_g: 50, carb_g: 55, fat_g: 14, sodium_mg: 680 } }),
      );
      expect(diff.hasDifferences).toBe(true);
      expect(diff.significantDeltas.length).toBeGreaterThan(0);
    });

    it("reports metadata-only differences", () => {
      const diff = buildRecomputeDiff(
        makeSnapshot(),
        makeRecomputed({ provisional: true }),
      );
      expect(diff.hasDifferences).toBe(true);
      expect(diff.significantDeltas.length).toBe(0);
      expect(diff.summary).toContain("Metadata changed");
    });

    it("includes integrity checks", () => {
      const diff = buildRecomputeDiff(makeSnapshot(), makeRecomputed());
      expect(diff.integrityChecks.length).toBeGreaterThan(0);
    });
  });
});
