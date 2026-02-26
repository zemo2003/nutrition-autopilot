import { describe, it, expect } from "vitest";
import {
  sortChronological,
  getLatestValue,
  computeTrend,
  detectMissingFields,
  detectIrregularIntervals,
  generateBiometricSummary,
  computeBMI,
  classifyBMI,
  type BiometricDataPoint,
} from "./biometrics-engine.js";

function dp(daysAgo: number, overrides: Partial<BiometricDataPoint> = {}): BiometricDataPoint {
  const d = new Date("2026-02-25T12:00:00Z");
  d.setDate(d.getDate() - daysAgo);
  return {
    measuredAt: d,
    heightCm: 175,
    weightKg: 80,
    bodyFatPct: null,
    leanMassKg: null,
    restingHr: null,
    source: "manual",
    ...overrides,
  };
}

const REF_DATE = new Date("2026-02-25T12:00:00Z");

describe("biometrics-engine", () => {
  describe("sortChronological", () => {
    it("sorts snapshots oldest first", () => {
      const result = sortChronological([dp(0), dp(10), dp(5)]);
      expect(result[0]!.measuredAt < result[1]!.measuredAt).toBe(true);
      expect(result[1]!.measuredAt < result[2]!.measuredAt).toBe(true);
    });

    it("handles empty array", () => {
      expect(sortChronological([])).toEqual([]);
    });

    it("does not mutate the original array", () => {
      const arr = [dp(0), dp(10)];
      sortChronological(arr);
      expect(arr[0]!.measuredAt.getTime()).toBeGreaterThan(arr[1]!.measuredAt.getTime());
    });
  });

  describe("getLatestValue", () => {
    it("returns the most recent non-null value", () => {
      const snaps = [
        dp(10, { weightKg: 78 }),
        dp(5, { weightKg: 80 }),
        dp(0, { weightKg: 82 }),
      ];
      const result = getLatestValue(snaps, "weightKg");
      expect(result?.value).toBe(82);
    });

    it("skips null values and returns previous non-null", () => {
      const snaps = [
        dp(10, { bodyFatPct: 18 }),
        dp(5, { bodyFatPct: null }),
        dp(0, { bodyFatPct: null }),
      ];
      const result = getLatestValue(snaps, "bodyFatPct");
      expect(result?.value).toBe(18);
    });

    it("returns null if field never recorded", () => {
      const snaps = [dp(10, { leanMassKg: null }), dp(5, { leanMassKg: null })];
      expect(getLatestValue(snaps, "leanMassKg")).toBeNull();
    });

    it("returns null for empty array", () => {
      expect(getLatestValue([], "weightKg")).toBeNull();
    });
  });

  describe("computeTrend", () => {
    it("detects upward trend", () => {
      const snaps = [dp(10, { weightKg: 78 }), dp(0, { weightKg: 82 })];
      const trend = computeTrend(snaps, "weightKg");
      expect(trend.direction).toBe("up");
      expect(trend.deltaAbs).toBe(4);
      expect(trend.deltaPct).toBeGreaterThan(0);
    });

    it("detects downward trend", () => {
      const snaps = [dp(10, { weightKg: 85 }), dp(0, { weightKg: 80 })];
      const trend = computeTrend(snaps, "weightKg");
      expect(trend.direction).toBe("down");
      expect(trend.deltaAbs).toBe(-5);
    });

    it("detects stable when change < 1%", () => {
      const snaps = [dp(10, { weightKg: 80 }), dp(0, { weightKg: 80.5 })];
      const trend = computeTrend(snaps, "weightKg");
      expect(trend.direction).toBe("stable");
    });

    it("returns insufficient with 0 data points", () => {
      const trend = computeTrend([], "weightKg");
      expect(trend.direction).toBe("insufficient");
      expect(trend.latestValue).toBeNull();
    });

    it("returns insufficient with 1 data point", () => {
      const trend = computeTrend([dp(0, { weightKg: 80 })], "weightKg");
      expect(trend.direction).toBe("insufficient");
      expect(trend.latestValue).toBe(80);
    });

    it("skips null values in trend computation", () => {
      const snaps = [
        dp(20, { bodyFatPct: 20 }),
        dp(10, { bodyFatPct: null }),
        dp(0, { bodyFatPct: 18 }),
      ];
      const trend = computeTrend(snaps, "bodyFatPct");
      expect(trend.direction).toBe("down");
      expect(trend.latestValue).toBe(18);
      expect(trend.previousValue).toBe(20);
    });
  });

  describe("detectMissingFields", () => {
    it("returns all fields when snapshot is null", () => {
      const missing = detectMissingFields(null);
      expect(missing).toEqual(["heightCm", "weightKg", "bodyFatPct", "leanMassKg", "restingHr"]);
    });

    it("returns empty array when all fields present", () => {
      const snap = dp(0, { bodyFatPct: 18, leanMassKg: 65, restingHr: 60 });
      expect(detectMissingFields(snap)).toEqual([]);
    });

    it("identifies specific missing fields", () => {
      const snap = dp(0, { heightCm: 175, weightKg: 80 });
      const missing = detectMissingFields(snap);
      expect(missing).toContain("bodyFatPct");
      expect(missing).toContain("leanMassKg");
      expect(missing).toContain("restingHr");
      expect(missing).not.toContain("heightCm");
    });
  });

  describe("detectIrregularIntervals", () => {
    it("returns false with < 3 snapshots", () => {
      expect(detectIrregularIntervals([dp(10), dp(0)])).toBe(false);
    });

    it("returns false for regular intervals", () => {
      const snaps = [dp(21), dp(14), dp(7), dp(0)];
      expect(detectIrregularIntervals(snaps)).toBe(false);
    });

    it("returns true for irregular intervals", () => {
      // 7-day intervals then a 90-day gap
      const snaps = [dp(104), dp(97), dp(90), dp(0)];
      expect(detectIrregularIntervals(snaps)).toBe(true);
    });
  });

  describe("generateBiometricSummary", () => {
    it("generates summary for empty data", () => {
      const summary = generateBiometricSummary([], REF_DATE);
      expect(summary.snapshotCount).toBe(0);
      expect(summary.latestSnapshot).toBeNull();
      expect(summary.dataQuality.hasRecentData).toBe(false);
      expect(summary.dataQuality.warnings).toContain("No biometric data recorded");
    });

    it("generates summary with recent data", () => {
      const snaps = [
        dp(14, { weightKg: 78 }),
        dp(7, { weightKg: 80 }),
        dp(0, { weightKg: 82 }),
      ];
      const summary = generateBiometricSummary(snaps, REF_DATE);
      expect(summary.snapshotCount).toBe(3);
      expect(summary.dataQuality.hasRecentData).toBe(true);
      expect(summary.dataQuality.daysSinceLastSnapshot).toBe(0);
      expect(summary.trends.find((t) => t.field === "weightKg")?.direction).toBe("up");
    });

    it("warns on stale data", () => {
      const snaps = [dp(60, { weightKg: 80 })];
      const summary = generateBiometricSummary(snaps, REF_DATE);
      expect(summary.dataQuality.hasRecentData).toBe(false);
      expect(summary.dataQuality.warnings.some((w) => w.includes("60 days old"))).toBe(true);
    });

    it("warns on missing fields", () => {
      const snaps = [dp(0)]; // missing bodyFatPct, leanMassKg, restingHr
      const summary = generateBiometricSummary(snaps, REF_DATE);
      expect(summary.dataQuality.missingFields.length).toBeGreaterThan(0);
      expect(summary.dataQuality.warnings.some((w) => w.includes("Missing fields"))).toBe(true);
    });

    it("includes all 5 field trends", () => {
      const snaps = [dp(7), dp(0)];
      const summary = generateBiometricSummary(snaps, REF_DATE);
      expect(summary.trends.length).toBe(5);
    });
  });

  describe("computeBMI", () => {
    it("computes BMI correctly", () => {
      // 80kg / (1.75m)^2 = 26.1
      expect(computeBMI(175, 80)).toBe(26.1);
    });

    it("returns null for invalid height", () => {
      expect(computeBMI(0, 80)).toBeNull();
      expect(computeBMI(-10, 80)).toBeNull();
    });

    it("returns null for invalid weight", () => {
      expect(computeBMI(175, 0)).toBeNull();
      expect(computeBMI(175, -5)).toBeNull();
    });
  });

  describe("classifyBMI", () => {
    it("classifies underweight", () => {
      expect(classifyBMI(17)).toBe("underweight");
    });

    it("classifies normal", () => {
      expect(classifyBMI(22)).toBe("normal");
    });

    it("classifies overweight", () => {
      expect(classifyBMI(27)).toBe("overweight");
    });

    it("classifies obese", () => {
      expect(classifyBMI(35)).toBe("obese");
    });

    it("boundary: 18.5 is normal", () => {
      expect(classifyBMI(18.5)).toBe("normal");
    });

    it("boundary: 25 is overweight", () => {
      expect(classifyBMI(25)).toBe("overweight");
    });

    it("boundary: 30 is obese", () => {
      expect(classifyBMI(30)).toBe("obese");
    });
  });
});
