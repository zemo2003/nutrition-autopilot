import { describe, it, expect } from "vitest";
import { computeDataCompleteness } from "./data-completeness.js";

describe("computeDataCompleteness", () => {
  it("scores excellent for complete data", () => {
    const result = computeDataCompleteness({
      biometricSnapshotCount: 10,
      daysSinceLastBiometric: 3,
      biometricFieldsCovered: 5,
      metricCount: 8,
      staleMetricCount: 0,
      missingCommonMetricCount: 0,
      nutritionDaysWithData: 85,
      nutritionTotalDays: 90,
      documentsByType: { DEXA: 2, BLOODWORK: 3, CGM: 1 },
    });
    expect(result.totalScore).toBeGreaterThanOrEqual(80);
    expect(result.category).toBe("excellent");
    expect(result.recommendations.length).toBeLessThanOrEqual(2);
  });

  it("scores insufficient for no data", () => {
    const result = computeDataCompleteness({
      biometricSnapshotCount: 0,
      daysSinceLastBiometric: null,
      biometricFieldsCovered: 0,
      metricCount: 0,
      staleMetricCount: 0,
      missingCommonMetricCount: 8,
      nutritionDaysWithData: 0,
      nutritionTotalDays: 90,
      documentsByType: {},
    });
    expect(result.totalScore).toBeLessThan(30);
    expect(result.category).toBe("insufficient");
    expect(result.recommendations.length).toBeGreaterThan(3);
  });

  it("scores minimal for some biometric data only", () => {
    const result = computeDataCompleteness({
      biometricSnapshotCount: 2,
      daysSinceLastBiometric: 15,
      biometricFieldsCovered: 3,
      metricCount: 3,
      staleMetricCount: 1,
      missingCommonMetricCount: 5,
      nutritionDaysWithData: 10,
      nutritionTotalDays: 90,
      documentsByType: { BLOODWORK: 1 },
    });
    expect(result.totalScore).toBeGreaterThanOrEqual(30);
    expect(result.totalScore).toBeLessThan(55);
    expect(result.category).toBe("minimal");
  });

  it("biometric depth scoring tiers", () => {
    const base = {
      daysSinceLastBiometric: 5,
      biometricFieldsCovered: 5,
      metricCount: 0,
      staleMetricCount: 0,
      missingCommonMetricCount: 8,
      nutritionDaysWithData: 0,
      nutritionTotalDays: 90,
      documentsByType: {},
    };

    const none = computeDataCompleteness({ ...base, biometricSnapshotCount: 0 });
    const few = computeDataCompleteness({ ...base, biometricSnapshotCount: 1 });
    const mid = computeDataCompleteness({ ...base, biometricSnapshotCount: 4 });
    const many = computeDataCompleteness({ ...base, biometricSnapshotCount: 8 });

    const getScore = (r: ReturnType<typeof computeDataCompleteness>, cat: string) =>
      r.breakdown.find((b) => b.category === cat)?.score ?? 0;

    expect(getScore(none, "biometric_depth")).toBe(0);
    expect(getScore(few, "biometric_depth")).toBe(10);
    expect(getScore(mid, "biometric_depth")).toBe(18);
    expect(getScore(many, "biometric_depth")).toBe(25);
  });

  it("biometric recency scoring tiers", () => {
    const base = {
      biometricSnapshotCount: 5,
      biometricFieldsCovered: 5,
      metricCount: 0,
      staleMetricCount: 0,
      missingCommonMetricCount: 8,
      nutritionDaysWithData: 0,
      nutritionTotalDays: 90,
      documentsByType: {},
    };

    const getScore = (r: ReturnType<typeof computeDataCompleteness>, cat: string) =>
      r.breakdown.find((b) => b.category === cat)?.score ?? 0;

    expect(getScore(computeDataCompleteness({ ...base, daysSinceLastBiometric: 3 }), "biometric_recency")).toBe(10);
    expect(getScore(computeDataCompleteness({ ...base, daysSinceLastBiometric: 20 }), "biometric_recency")).toBe(7);
    expect(getScore(computeDataCompleteness({ ...base, daysSinceLastBiometric: 60 }), "biometric_recency")).toBe(3);
    expect(getScore(computeDataCompleteness({ ...base, daysSinceLastBiometric: 120 }), "biometric_recency")).toBe(0);
  });

  it("document evidence scoring", () => {
    const base = {
      biometricSnapshotCount: 0,
      daysSinceLastBiometric: null,
      biometricFieldsCovered: 0,
      metricCount: 0,
      staleMetricCount: 0,
      missingCommonMetricCount: 8,
      nutritionDaysWithData: 0,
      nutritionTotalDays: 90,
    };

    const getDocScore = (docs: Record<string, number>) =>
      computeDataCompleteness({ ...base, documentsByType: docs }).breakdown.find((b) => b.category === "document_evidence")?.score ?? 0;

    expect(getDocScore({})).toBe(0);
    expect(getDocScore({ DEXA: 1 })).toBe(3);
    expect(getDocScore({ BLOODWORK: 1 })).toBe(4);
    expect(getDocScore({ CGM: 1 })).toBe(3);
    expect(getDocScore({ DEXA: 2, BLOODWORK: 1, CGM: 1 })).toBe(10);
  });

  it("maxScore sums to 100", () => {
    const result = computeDataCompleteness({
      biometricSnapshotCount: 0,
      daysSinceLastBiometric: null,
      biometricFieldsCovered: 0,
      metricCount: 0,
      staleMetricCount: 0,
      missingCommonMetricCount: 8,
      nutritionDaysWithData: 0,
      nutritionTotalDays: 90,
      documentsByType: {},
    });
    expect(result.maxScore).toBe(100);
  });
});
