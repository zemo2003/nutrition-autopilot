import { describe, it, expect } from "vitest";
import {
  getReferenceRange,
  classifyMetricValue,
  getLatestMetrics,
  computeMetricStatuses,
  generateMetricQualityReport,
  groupMetricsByCategory,
  getMetricTimeSeries,
  REFERENCE_RANGES,
  type MetricDataPoint,
} from "./metrics-engine.js";

function mdp(
  metricKey: string,
  value: number,
  daysAgo: number,
  overrides: Partial<MetricDataPoint> = {},
): MetricDataPoint {
  const d = new Date("2026-02-25T12:00:00Z");
  d.setDate(d.getDate() - daysAgo);
  return {
    metricKey,
    value,
    unit: "mg/dL",
    observedAt: d,
    verification: "MANUAL_ENTRY",
    ...overrides,
  };
}

const REF_DATE = new Date("2026-02-25T12:00:00Z");

describe("metrics-engine", () => {
  describe("getReferenceRange", () => {
    it("returns range for known metric", () => {
      const range = getReferenceRange("fasting_glucose");
      expect(range).not.toBeNull();
      expect(range?.lowNormal).toBe(70);
      expect(range?.highNormal).toBe(100);
    });

    it("returns null for unknown metric", () => {
      expect(getReferenceRange("unknown_metric")).toBeNull();
    });

    it("has all expected reference ranges", () => {
      expect(REFERENCE_RANGES.length).toBeGreaterThanOrEqual(11);
    });
  });

  describe("classifyMetricValue", () => {
    it("classifies normal glucose", () => {
      expect(classifyMetricValue("fasting_glucose", 85)).toBe("normal");
    });

    it("classifies warning-level glucose (between normal and warning)", () => {
      expect(classifyMetricValue("fasting_glucose", 110)).toBe("warning");
    });

    it("classifies critical glucose (above highWarning)", () => {
      expect(classifyMetricValue("fasting_glucose", 130)).toBe("critical");
    });

    it("classifies critical low glucose", () => {
      expect(classifyMetricValue("fasting_glucose", 50)).toBe("critical");
    });

    it("classifies normal HDL", () => {
      expect(classifyMetricValue("hdl", 55)).toBe("normal");
    });

    it("classifies low HDL as warning", () => {
      expect(classifyMetricValue("hdl", 38)).toBe("warning");
    });

    it("classifies critically low HDL", () => {
      expect(classifyMetricValue("hdl", 30)).toBe("critical");
    });

    it("returns unknown for unrecognized metric", () => {
      expect(classifyMetricValue("made_up_metric", 100)).toBe("unknown");
    });

    it("classifies boundary values (exact lowNormal)", () => {
      expect(classifyMetricValue("fasting_glucose", 70)).toBe("normal");
    });

    it("classifies boundary values (exact highNormal)", () => {
      expect(classifyMetricValue("fasting_glucose", 100)).toBe("normal");
    });
  });

  describe("getLatestMetrics", () => {
    it("returns latest data point per metric key", () => {
      const dps = [
        mdp("fasting_glucose", 85, 30),
        mdp("fasting_glucose", 92, 10),
        mdp("fasting_glucose", 88, 0),
        mdp("ldl", 110, 15),
      ];
      const latest = getLatestMetrics(dps);
      expect(latest.get("fasting_glucose")?.value).toBe(88);
      expect(latest.get("ldl")?.value).toBe(110);
    });

    it("returns empty map for no data", () => {
      expect(getLatestMetrics([]).size).toBe(0);
    });
  });

  describe("computeMetricStatuses", () => {
    it("includes all reference range metrics", () => {
      const statuses = computeMetricStatuses([], REF_DATE);
      expect(statuses.length).toBe(REFERENCE_RANGES.length);
      // All should be unknown since no data
      expect(statuses.every((s) => s.rangeStatus === "unknown")).toBe(true);
    });

    it("populates latest values and range status", () => {
      const dps = [mdp("fasting_glucose", 85, 5)];
      const statuses = computeMetricStatuses(dps, REF_DATE);
      const glucose = statuses.find((s) => s.metricKey === "fasting_glucose");
      expect(glucose?.latestValue).toBe(85);
      expect(glucose?.rangeStatus).toBe("normal");
      expect(glucose?.staleDays).toBe(5);
      expect(glucose?.isStale).toBe(false);
    });

    it("marks stale metrics (>90 days)", () => {
      const dps = [mdp("fasting_glucose", 85, 100)];
      const statuses = computeMetricStatuses(dps, REF_DATE);
      const glucose = statuses.find((s) => s.metricKey === "fasting_glucose");
      expect(glucose?.isStale).toBe(true);
      expect(glucose?.staleDays).toBe(100);
    });

    it("includes custom metrics not in reference ranges", () => {
      const dps = [mdp("custom_metric", 42, 5, { unit: "units" })];
      const statuses = computeMetricStatuses(dps, REF_DATE);
      const custom = statuses.find((s) => s.metricKey === "custom_metric");
      expect(custom).toBeDefined();
      expect(custom?.rangeStatus).toBe("unknown");
      expect(custom?.category).toBe("other");
    });
  });

  describe("generateMetricQualityReport", () => {
    it("reports missing common metrics", () => {
      const report = generateMetricQualityReport([], REF_DATE);
      expect(report.missingCommonMetrics.length).toBeGreaterThan(0);
      expect(report.missingCommonMetrics).toContain("fasting_glucose");
      expect(report.warnings.some((w) => w.includes("Missing common metrics"))).toBe(true);
    });

    it("reports stale metrics", () => {
      const dps = [mdp("fasting_glucose", 85, 100)];
      const report = generateMetricQualityReport(dps, REF_DATE);
      expect(report.staleMetrics).toContain("fasting_glucose");
      expect(report.warnings.some((w) => w.includes("stale"))).toBe(true);
    });

    it("reports unverified metrics", () => {
      const dps = [mdp("fasting_glucose", 85, 5, { verification: "UNVERIFIED" })];
      const report = generateMetricQualityReport(dps, REF_DATE);
      expect(report.unverifiedMetrics).toContain("fasting_glucose");
    });

    it("reports out-of-range metrics", () => {
      const dps = [mdp("fasting_glucose", 130, 5)]; // critical high
      const report = generateMetricQualityReport(dps, REF_DATE);
      expect(report.outOfRangeMetrics).toContain("fasting_glucose");
    });

    it("reports healthy data cleanly", () => {
      const dps = [
        mdp("fasting_glucose", 85, 5),
        mdp("hba1c", 5.2, 5, { unit: "%" }),
        mdp("ldl", 90, 5),
        mdp("hdl", 55, 5),
        mdp("triglycerides", 120, 5),
        mdp("body_fat_pct", 18, 5, { unit: "%" }),
        mdp("lean_mass_kg", 65, 5, { unit: "kg" }),
        mdp("resting_hr", 62, 5, { unit: "bpm" }),
      ];
      const report = generateMetricQualityReport(dps, REF_DATE);
      expect(report.totalMetrics).toBe(8);
      expect(report.staleMetrics.length).toBe(0);
      expect(report.outOfRangeMetrics.length).toBe(0);
      expect(report.missingCommonMetrics.length).toBe(0);
    });
  });

  describe("groupMetricsByCategory", () => {
    it("groups statuses by category", () => {
      const dps = [
        mdp("fasting_glucose", 85, 5),
        mdp("ldl", 90, 5),
        mdp("resting_hr", 62, 5, { unit: "bpm" }),
      ];
      const statuses = computeMetricStatuses(dps, REF_DATE);
      const groups = groupMetricsByCategory(statuses);
      expect(groups.metabolic.length).toBeGreaterThan(0);
      expect(groups.bloodwork.length).toBeGreaterThan(0);
      expect(groups.cardiovascular.length).toBeGreaterThan(0);
    });
  });

  describe("getMetricTimeSeries", () => {
    it("returns sorted time series for a specific metric", () => {
      const dps = [
        mdp("fasting_glucose", 92, 10),
        mdp("fasting_glucose", 85, 30),
        mdp("fasting_glucose", 88, 0),
        mdp("ldl", 110, 15),
      ];
      const series = getMetricTimeSeries(dps, "fasting_glucose");
      expect(series.length).toBe(3);
      expect(series[0]!.value).toBe(85); // oldest
      expect(series[2]!.value).toBe(88); // newest
    });

    it("returns empty for non-existent metric", () => {
      expect(getMetricTimeSeries([], "fasting_glucose")).toEqual([]);
    });
  });
});
