import { describe, it, expect } from "vitest";
import {
  computeDataQualityScore,
  computeClientReadinessScore,
  computeReliabilityScore,
  buildAttentionQueue,
  buildControlTowerSummary,
  type ControlTowerInput,
} from "./ops-control-tower.js";

function makeInput(overrides: Partial<ControlTowerInput> = {}): ControlTowerInput {
  return {
    today: {
      mealsDueToday: 12,
      mealsServedToday: 8,
      batchesDue: 3,
      batchesActive: 1,
      batchesBlocked: 0,
      shortageCount: 0,
      expiringLots: [],
      ...(overrides.today ?? {}),
    },
    scientificQa: {
      openVerificationTasks: 0,
      criticalVerificationTasks: 0,
      estimatedNutrientRows: 0,
      inferredNutrientRows: 0,
      missingProvenanceCount: 0,
      pendingSubstitutions: 0,
      pendingCalibrationReviews: 0,
      openQcIssues: 0,
      ...(overrides.scientificQa ?? {}),
    },
    clientData: {
      clientsWithStaleBiometrics: 0,
      clientsWithUnverifiedDocs: 0,
      failedParsingDocs: 0,
      staleMetricClients: 0,
      ...(overrides.clientData ?? {}),
    },
    reliability: {
      failedImports: 0,
      stuckBatches: 0,
      stuckMappings: 0,
      ...(overrides.reliability ?? {}),
    },
  };
}

describe("ops-control-tower", () => {
  describe("computeDataQualityScore", () => {
    it("returns 100 for clean QA data", () => {
      const input = makeInput();
      expect(computeDataQualityScore(input.scientificQa)).toBe(100);
    });

    it("penalizes critical verification tasks heavily", () => {
      const input = makeInput({ scientificQa: { criticalVerificationTasks: 2 } as any });
      const score = computeDataQualityScore(input.scientificQa);
      expect(score).toBeLessThan(75);
    });

    it("penalizes open QC issues", () => {
      const input = makeInput({ scientificQa: { openQcIssues: 3 } as any });
      const score = computeDataQualityScore(input.scientificQa);
      expect(score).toBeLessThanOrEqual(90);
    });

    it("never goes below 0", () => {
      const input = makeInput({
        scientificQa: {
          openVerificationTasks: 100,
          criticalVerificationTasks: 10,
          estimatedNutrientRows: 100,
          inferredNutrientRows: 100,
          missingProvenanceCount: 50,
          pendingSubstitutions: 20,
          pendingCalibrationReviews: 20,
          openQcIssues: 20,
        },
      });
      expect(computeDataQualityScore(input.scientificQa)).toBe(0);
    });
  });

  describe("computeClientReadinessScore", () => {
    it("returns 100 for perfect client data", () => {
      const input = makeInput();
      expect(computeClientReadinessScore(input.clientData)).toBe(100);
    });

    it("penalizes stale biometrics", () => {
      const input = makeInput({ clientData: { clientsWithStaleBiometrics: 3 } as any });
      expect(computeClientReadinessScore(input.clientData)).toBe(70);
    });

    it("penalizes failed parsing", () => {
      const input = makeInput({ clientData: { failedParsingDocs: 2 } as any });
      expect(computeClientReadinessScore(input.clientData)).toBeLessThan(80);
    });
  });

  describe("computeReliabilityScore", () => {
    it("returns 100 for healthy system", () => {
      const input = makeInput();
      expect(computeReliabilityScore(input.reliability)).toBe(100);
    });

    it("penalizes failed imports", () => {
      const input = makeInput({ reliability: { failedImports: 2, stuckBatches: 0, stuckMappings: 0 } });
      expect(computeReliabilityScore(input.reliability)).toBe(60);
    });
  });

  describe("buildAttentionQueue", () => {
    it("returns empty for healthy system", () => {
      const queue = buildAttentionQueue(makeInput());
      expect(queue.length).toBe(0);
    });

    it("includes critical shortage first", () => {
      const input = makeInput({
        today: { shortageCount: 2, mealsDueToday: 12, mealsServedToday: 8, batchesDue: 3, batchesActive: 1, batchesBlocked: 0, expiringLots: [] },
        scientificQa: { openQcIssues: 1 } as any,
      });
      const queue = buildAttentionQueue(input);
      expect(queue[0]!.category).toBe("operations");
      expect(queue[0]!.severity).toBe("critical");
    });

    it("sorts by score descending", () => {
      const input = makeInput({
        today: {
          shortageCount: 1,
          batchesBlocked: 1,
          mealsDueToday: 12,
          mealsServedToday: 8,
          batchesDue: 3,
          batchesActive: 1,
          expiringLots: [{ lotId: "l1", productName: "Chicken", expiresAt: "2026-02-26", quantityG: 500 }],
        },
        scientificQa: {
          criticalVerificationTasks: 1,
          openQcIssues: 2,
          pendingCalibrationReviews: 1,
          pendingSubstitutions: 1,
        } as any,
      });
      const queue = buildAttentionQueue(input);
      expect(queue.length).toBeGreaterThan(3);
      // Scores should be in descending order
      for (let i = 1; i < queue.length; i++) {
        expect(queue[i]!.score).toBeLessThanOrEqual(queue[i - 1]!.score);
      }
    });

    it("includes client data issues", () => {
      const input = makeInput({
        clientData: { clientsWithStaleBiometrics: 2, clientsWithUnverifiedDocs: 1, failedParsingDocs: 0, staleMetricClients: 0 },
      });
      const queue = buildAttentionQueue(input);
      expect(queue.some((i) => i.category === "client_data")).toBe(true);
    });

    it("includes system reliability issues", () => {
      const input = makeInput({
        reliability: { failedImports: 1, stuckBatches: 0, stuckMappings: 0 },
      });
      const queue = buildAttentionQueue(input);
      expect(queue.some((i) => i.category === "system")).toBe(true);
    });

    it("provides actionUrls where applicable", () => {
      const input = makeInput({
        today: { shortageCount: 1 } as any,
      });
      const queue = buildAttentionQueue(input);
      expect(queue[0]!.actionUrl).toBe("/inventory");
    });
  });

  describe("buildControlTowerSummary", () => {
    it("builds complete summary", () => {
      const summary = buildControlTowerSummary(makeInput());
      expect(summary.today.mealsDue).toBe(12);
      expect(summary.today.mealsServed).toBe(8);
      expect(summary.today.mealCompletionPct).toBe(67);
      expect(summary.scientificQa.dataQualityScore).toBe(100);
      expect(summary.clientData.readinessScore).toBe(100);
      expect(summary.reliability.healthScore).toBe(100);
      expect(summary.overallHealthScore).toBe(100);
      expect(summary.attentionQueue.length).toBe(0);
    });

    it("computes meal completion percentage", () => {
      const input = makeInput({ today: { mealsDueToday: 10, mealsServedToday: 5 } as any });
      const summary = buildControlTowerSummary(input);
      expect(summary.today.mealCompletionPct).toBe(50);
    });

    it("handles zero meals due", () => {
      const input = makeInput({ today: { mealsDueToday: 0, mealsServedToday: 0 } as any });
      const summary = buildControlTowerSummary(input);
      expect(summary.today.mealCompletionPct).toBe(100);
    });

    it("computes weighted overall health score", () => {
      const input = makeInput({
        scientificQa: { criticalVerificationTasks: 2 } as any,
        clientData: { clientsWithStaleBiometrics: 3 } as any,
        reliability: { failedImports: 1 } as any,
      });
      const summary = buildControlTowerSummary(input);
      expect(summary.overallHealthScore).toBeLessThan(100);
      expect(summary.overallHealthScore).toBeGreaterThan(0);
    });
  });
});
