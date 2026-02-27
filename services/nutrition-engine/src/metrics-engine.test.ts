import { describe, it, expect } from "vitest";
import {
  getReferenceRange,
  classifyMetricValue,
  getLatestMetrics,
  computeMetricStatuses,
  generateMetricQualityReport,
  groupMetricsByCategory,
  getMetricTimeSeries,
  validatePhysiologicalPlausibility,
  validateCrossMetricConsistency,
  contextualizeMetric,
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

    it("has at least 37 reference ranges", () => {
      expect(REFERENCE_RANGES.length).toBeGreaterThanOrEqual(37);
    });
  });

  // ─── Reference ranges cover all seeded metrics ───────────────────────────

  describe("reference range coverage", () => {
    // All 46 metric keys from Alex's seeded data
    const ALEX_METRIC_KEYS = [
      // DEXA (16)
      "body_fat_pct", "lean_mass_kg", "fat_mass_kg", "fat_free_mass_kg",
      "bone_mineral_content_kg", "bmi", "bmd_total", "android_fat_pct",
      "gynoid_fat_pct", "ag_ratio", "vat_mass_lbs", "arm_fat_pct",
      "leg_fat_pct", "trunk_fat_pct", "weight_kg", "height_cm",
      // Bloodwork (20)
      "shbg", "ferritin", "total_testosterone", "free_testosterone",
      "vitamin_d", "albumin", "total_cholesterol", "hdl", "ldl",
      "triglycerides", "apob", "free_t3", "tsh", "creatinine", "crp",
      "estrogen", "remnant_cholesterol", "tc_hdl_ratio", "tg_hdl_ratio",
      "ldl_apob_ratio",
      // CGM (10)
      "cgm_avg_glucose", "cgm_min_glucose", "cgm_max_glucose",
      "cgm_median_glucose", "cgm_stddev_glucose", "cgm_time_in_range_pct",
      "cgm_time_below_range_pct", "cgm_time_above_range_pct",
      "cgm_fasting_glucose_avg", "cgm_readings_count",
    ];

    // Metrics that intentionally have no reference range (raw measurements, counts, etc.)
    const EXPECTED_NO_RANGE = [
      "fat_free_mass_kg", "bone_mineral_content_kg", "vat_mass_lbs",
      "arm_fat_pct", "leg_fat_pct", "trunk_fat_pct",
      "weight_kg", "height_cm",
      "cgm_min_glucose", "cgm_max_glucose", "cgm_median_glucose",
      "cgm_time_above_range_pct", "cgm_readings_count",
    ];

    const keysWithRanges = ALEX_METRIC_KEYS.filter((k) => !EXPECTED_NO_RANGE.includes(k));

    it("has reference ranges for all key clinical metrics", () => {
      const missing: string[] = [];
      for (const key of keysWithRanges) {
        if (!getReferenceRange(key)) {
          missing.push(key);
        }
      }
      expect(missing).toEqual([]);
    });

    it("all reference ranges have valid category", () => {
      const validCategories = ["bloodwork", "body_composition", "cardiovascular", "metabolic", "other"];
      for (const range of REFERENCE_RANGES) {
        expect(validCategories).toContain(range.category);
      }
    });

    it("all reference ranges have lowNormal <= highNormal", () => {
      for (const range of REFERENCE_RANGES) {
        expect(range.lowNormal).toBeLessThanOrEqual(range.highNormal);
      }
    });

    it("warning thresholds are more extreme than normal thresholds", () => {
      for (const range of REFERENCE_RANGES) {
        if (range.lowWarning != null) {
          expect(range.lowWarning).toBeLessThanOrEqual(range.lowNormal);
        }
        if (range.highWarning != null) {
          expect(range.highWarning).toBeGreaterThanOrEqual(range.highNormal);
        }
      }
    });
  });

  // ─── classifyMetricValue ──────────────────────────────────────────────────

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

  // ─── Bloodwork metric classification ─────────────────────────────────────

  describe("bloodwork metric classification", () => {
    it("total_testosterone: normal at 600", () => {
      expect(classifyMetricValue("total_testosterone", 600)).toBe("normal");
    });
    it("total_testosterone: warning at 250", () => {
      expect(classifyMetricValue("total_testosterone", 250)).toBe("warning");
    });
    it("total_testosterone: critical at 150", () => {
      expect(classifyMetricValue("total_testosterone", 150)).toBe("critical");
    });

    it("free_testosterone: normal at 100", () => {
      expect(classifyMetricValue("free_testosterone", 100)).toBe("normal");
    });
    it("free_testosterone: warning at 45", () => {
      expect(classifyMetricValue("free_testosterone", 45)).toBe("warning");
    });
    it("free_testosterone: critical at 30", () => {
      expect(classifyMetricValue("free_testosterone", 30)).toBe("critical");
    });

    it("vitamin_d: normal at 50", () => {
      expect(classifyMetricValue("vitamin_d", 50)).toBe("normal");
    });
    it("vitamin_d: warning at 25", () => {
      expect(classifyMetricValue("vitamin_d", 25)).toBe("warning");
    });
    it("vitamin_d: critical low at 15", () => {
      expect(classifyMetricValue("vitamin_d", 15)).toBe("critical");
    });
    it("vitamin_d: critical high at 160", () => {
      expect(classifyMetricValue("vitamin_d", 160)).toBe("critical");
    });

    it("ferritin: normal at 131", () => {
      expect(classifyMetricValue("ferritin", 131)).toBe("normal");
    });
    it("ferritin: warning at 20", () => {
      expect(classifyMetricValue("ferritin", 20)).toBe("warning");
    });
    it("ferritin: critical low at 10", () => {
      expect(classifyMetricValue("ferritin", 10)).toBe("critical");
    });
    it("ferritin: critical high at 600", () => {
      expect(classifyMetricValue("ferritin", 600)).toBe("critical");
    });

    it("apob: normal at 70", () => {
      expect(classifyMetricValue("apob", 70)).toBe("normal");
    });
    it("apob: warning at 100", () => {
      expect(classifyMetricValue("apob", 100)).toBe("warning");
    });
    it("apob: critical at 140", () => {
      expect(classifyMetricValue("apob", 140)).toBe("critical");
    });

    it("crp: normal at 0.3", () => {
      expect(classifyMetricValue("crp", 0.3)).toBe("normal");
    });
    it("crp: warning at 2.0", () => {
      expect(classifyMetricValue("crp", 2.0)).toBe("warning");
    });
    it("crp: critical at 5.0", () => {
      expect(classifyMetricValue("crp", 5.0)).toBe("critical");
    });

    it("tsh: normal at 1.0", () => {
      expect(classifyMetricValue("tsh", 1.0)).toBe("normal");
    });
    it("tsh: warning at 5.0", () => {
      expect(classifyMetricValue("tsh", 5.0)).toBe("warning");
    });
    it("tsh: critical at 12", () => {
      expect(classifyMetricValue("tsh", 12)).toBe("critical");
    });

    it("free_t3: normal at 3.0", () => {
      expect(classifyMetricValue("free_t3", 3.0)).toBe("normal");
    });
    it("free_t3: warning at 1.8", () => {
      expect(classifyMetricValue("free_t3", 1.8)).toBe("warning");
    });
    it("free_t3: critical at 1.2", () => {
      expect(classifyMetricValue("free_t3", 1.2)).toBe("critical");
    });

    it("albumin: normal at 4.5", () => {
      expect(classifyMetricValue("albumin", 4.5)).toBe("normal");
    });
    it("albumin: critical low at 2.5", () => {
      expect(classifyMetricValue("albumin", 2.5)).toBe("critical");
    });

    it("shbg: normal at 49.2", () => {
      expect(classifyMetricValue("shbg", 49.2)).toBe("normal");
    });
    it("shbg: critical high at 120", () => {
      expect(classifyMetricValue("shbg", 120)).toBe("critical");
    });

    it("estrogen: normal at 30", () => {
      expect(classifyMetricValue("estrogen", 30)).toBe("normal");
    });
    it("estrogen: warning at 12", () => {
      expect(classifyMetricValue("estrogen", 12)).toBe("warning");
    });
    it("estrogen: critical low at 8", () => {
      expect(classifyMetricValue("estrogen", 8)).toBe("critical");
    });

    it("creatinine: normal at 1.0", () => {
      expect(classifyMetricValue("creatinine", 1.0)).toBe("normal");
    });
    it("creatinine: critical high at 3.0", () => {
      expect(classifyMetricValue("creatinine", 3.0)).toBe("critical");
    });
  });

  // ─── CGM metric classification ───────────────────────────────────────────

  describe("CGM metric classification", () => {
    it("cgm_avg_glucose: normal at 85", () => {
      expect(classifyMetricValue("cgm_avg_glucose", 85)).toBe("normal");
    });
    it("cgm_avg_glucose: warning at 110", () => {
      expect(classifyMetricValue("cgm_avg_glucose", 110)).toBe("warning");
    });
    it("cgm_avg_glucose: critical at 150", () => {
      expect(classifyMetricValue("cgm_avg_glucose", 150)).toBe("critical");
    });

    it("cgm_fasting_glucose_avg: normal at 75", () => {
      expect(classifyMetricValue("cgm_fasting_glucose_avg", 75)).toBe("normal");
    });
    it("cgm_fasting_glucose_avg: critical low at 50", () => {
      expect(classifyMetricValue("cgm_fasting_glucose_avg", 50)).toBe("critical");
    });

    it("cgm_time_in_range_pct: normal at 85", () => {
      expect(classifyMetricValue("cgm_time_in_range_pct", 85)).toBe("normal");
    });
    it("cgm_time_in_range_pct: warning at 60", () => {
      expect(classifyMetricValue("cgm_time_in_range_pct", 60)).toBe("warning");
    });
    it("cgm_time_in_range_pct: critical at 45", () => {
      expect(classifyMetricValue("cgm_time_in_range_pct", 45)).toBe("critical");
    });

    it("cgm_time_below_range_pct: normal at 2", () => {
      expect(classifyMetricValue("cgm_time_below_range_pct", 2)).toBe("normal");
    });
    it("cgm_time_below_range_pct: warning at 10", () => {
      expect(classifyMetricValue("cgm_time_below_range_pct", 10)).toBe("warning");
    });
    it("cgm_time_below_range_pct: critical at 20", () => {
      expect(classifyMetricValue("cgm_time_below_range_pct", 20)).toBe("critical");
    });

    it("cgm_stddev_glucose: normal at 15", () => {
      expect(classifyMetricValue("cgm_stddev_glucose", 15)).toBe("normal");
    });
    it("cgm_stddev_glucose: warning at 30", () => {
      expect(classifyMetricValue("cgm_stddev_glucose", 30)).toBe("warning");
    });
    it("cgm_stddev_glucose: critical at 40", () => {
      expect(classifyMetricValue("cgm_stddev_glucose", 40)).toBe("critical");
    });
  });

  // ─── DEXA / body composition metric classification ───────────────────────

  describe("DEXA / body composition metric classification", () => {
    it("bmd_total: normal at 1.2", () => {
      expect(classifyMetricValue("bmd_total", 1.2)).toBe("normal");
    });
    it("bmd_total: warning high at 1.717 (excellent)", () => {
      // 1.717 > 1.5 highNormal but no highWarning → warning (above normal)
      expect(classifyMetricValue("bmd_total", 1.717)).toBe("warning");
    });
    it("bmd_total: critical low at 0.7", () => {
      expect(classifyMetricValue("bmd_total", 0.7)).toBe("critical");
    });

    it("android_fat_pct: normal at 15", () => {
      expect(classifyMetricValue("android_fat_pct", 15)).toBe("normal");
    });
    it("android_fat_pct: critical high at 40", () => {
      expect(classifyMetricValue("android_fat_pct", 40)).toBe("critical");
    });

    it("gynoid_fat_pct: normal at 20", () => {
      expect(classifyMetricValue("gynoid_fat_pct", 20)).toBe("normal");
    });

    it("ag_ratio: normal at 0.68", () => {
      expect(classifyMetricValue("ag_ratio", 0.68)).toBe("normal");
    });
    it("ag_ratio: critical at 1.3", () => {
      expect(classifyMetricValue("ag_ratio", 1.3)).toBe("critical");
    });

    it("fat_mass_kg: normal at 15", () => {
      expect(classifyMetricValue("fat_mass_kg", 15)).toBe("normal");
    });
    it("fat_mass_kg: critical high at 55", () => {
      expect(classifyMetricValue("fat_mass_kg", 55)).toBe("critical");
    });

    it("bmi: normal at 22", () => {
      expect(classifyMetricValue("bmi", 22)).toBe("normal");
    });
    it("bmi: warning at 27.2", () => {
      expect(classifyMetricValue("bmi", 27.2)).toBe("warning");
    });
    it("bmi: critical high at 36", () => {
      expect(classifyMetricValue("bmi", 36)).toBe("critical");
    });
    it("bmi: critical low at 15", () => {
      expect(classifyMetricValue("bmi", 15)).toBe("critical");
    });
  });

  // ─── Lipid ratio classification ──────────────────────────────────────────

  describe("lipid ratio classification", () => {
    it("tc_hdl_ratio: normal at 2.72", () => {
      expect(classifyMetricValue("tc_hdl_ratio", 2.72)).toBe("normal");
    });
    it("tc_hdl_ratio: warning at 5.0", () => {
      expect(classifyMetricValue("tc_hdl_ratio", 5.0)).toBe("warning");
    });
    it("tc_hdl_ratio: critical at 7.0", () => {
      expect(classifyMetricValue("tc_hdl_ratio", 7.0)).toBe("critical");
    });

    it("tg_hdl_ratio: normal at 0.97", () => {
      expect(classifyMetricValue("tg_hdl_ratio", 0.97)).toBe("normal");
    });
    it("tg_hdl_ratio: critical at 5.0", () => {
      expect(classifyMetricValue("tg_hdl_ratio", 5.0)).toBe("critical");
    });

    it("remnant_cholesterol: normal at 15.05", () => {
      expect(classifyMetricValue("remnant_cholesterol", 15.05)).toBe("normal");
    });
    it("remnant_cholesterol: warning at 25", () => {
      expect(classifyMetricValue("remnant_cholesterol", 25)).toBe("warning");
    });
    it("remnant_cholesterol: critical at 35", () => {
      expect(classifyMetricValue("remnant_cholesterol", 35)).toBe("critical");
    });
  });

  // ─── Alex's actual data produces correct statuses ────────────────────────

  describe("Alex's actual data produces correct statuses", () => {
    const alexMetrics: Array<{ key: string; value: number; expected: "normal" | "warning" | "critical" | "unknown" }> = [
      // DEXA
      { key: "body_fat_pct", value: 10.7, expected: "normal" },
      { key: "lean_mass_kg", value: 74.7, expected: "normal" },
      { key: "fat_mass_kg", value: 9.0, expected: "normal" },
      { key: "bmi", value: 27.2, expected: "warning" },
      { key: "bmd_total", value: 1.717, expected: "warning" }, // above normal (excellent BMD)
      { key: "android_fat_pct", value: 6.6, expected: "normal" },
      { key: "gynoid_fat_pct", value: 9.6, expected: "normal" },
      { key: "ag_ratio", value: 0.68, expected: "normal" },
      // Bloodwork
      { key: "shbg", value: 49.2, expected: "normal" },
      { key: "ferritin", value: 131, expected: "normal" },
      { key: "total_testosterone", value: 390, expected: "normal" },
      { key: "free_testosterone", value: 56.56, expected: "normal" },
      { key: "vitamin_d", value: 47.2, expected: "normal" },
      { key: "albumin", value: 5.14, expected: "normal" },
      { key: "total_cholesterol", value: 211, expected: "warning" },
      { key: "hdl", value: 77.4, expected: "normal" },
      { key: "ldl", value: 118.54, expected: "warning" },
      { key: "triglycerides", value: 75.3, expected: "normal" },
      { key: "apob", value: 74.6, expected: "normal" },
      { key: "free_t3", value: 2.33, expected: "normal" },
      { key: "tsh", value: 1.00, expected: "normal" },
      { key: "creatinine", value: 1.22, expected: "normal" },
      { key: "crp", value: 0.5, expected: "normal" },
      { key: "estrogen", value: 12, expected: "warning" },
      { key: "remnant_cholesterol", value: 15.05, expected: "normal" },
      { key: "tc_hdl_ratio", value: 2.72, expected: "normal" },
      { key: "tg_hdl_ratio", value: 0.97, expected: "normal" },
      { key: "ldl_apob_ratio", value: 1.58, expected: "normal" },
      // CGM
      { key: "cgm_avg_glucose", value: 81, expected: "normal" },
      { key: "cgm_stddev_glucose", value: 13, expected: "normal" },
      { key: "cgm_time_in_range_pct", value: 81, expected: "normal" },
      { key: "cgm_time_below_range_pct", value: 19, expected: "critical" },
      { key: "cgm_fasting_glucose_avg", value: 71, expected: "normal" },
    ];

    for (const { key, value, expected } of alexMetrics) {
      it(`${key}=${value} → ${expected}`, () => {
        expect(classifyMetricValue(key, value)).toBe(expected);
      });
    }
  });

  // ─── getLatestMetrics ─────────────────────────────────────────────────────

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

  // ─── computeMetricStatuses ────────────────────────────────────────────────

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

  // ─── generateMetricQualityReport ──────────────────────────────────────────

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

  // ─── groupMetricsByCategory ───────────────────────────────────────────────

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

    it("includes body_composition category with new ranges", () => {
      const statuses = computeMetricStatuses([], REF_DATE);
      const groups = groupMetricsByCategory(statuses);
      expect(groups.body_composition.length).toBeGreaterThanOrEqual(7);
    });
  });

  // ─── getMetricTimeSeries ──────────────────────────────────────────────────

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

  // ─── Physiological plausibility guards ────────────────────────────────────

  describe("validatePhysiologicalPlausibility", () => {
    it("accepts normal weight", () => {
      expect(validatePhysiologicalPlausibility("weight_kg", 88.5).valid).toBe(true);
    });

    it("rejects negative weight", () => {
      const result = validatePhysiologicalPlausibility("weight_kg", -5);
      expect(result.valid).toBe(false);
      expect(result.warning).toContain("below physiological minimum");
    });

    it("rejects impossibly high weight", () => {
      const result = validatePhysiologicalPlausibility("weight_kg", 500);
      expect(result.valid).toBe(false);
      expect(result.warning).toContain("exceeds physiological maximum");
    });

    it("rejects body fat below 2%", () => {
      const result = validatePhysiologicalPlausibility("body_fat_pct", 1.5);
      expect(result.valid).toBe(false);
    });

    it("rejects body fat above 70%", () => {
      const result = validatePhysiologicalPlausibility("body_fat_pct", 75);
      expect(result.valid).toBe(false);
    });

    it("accepts Alex's body fat 10.7%", () => {
      expect(validatePhysiologicalPlausibility("body_fat_pct", 10.7).valid).toBe(true);
    });

    it("rejects absurd glucose (30000)", () => {
      const result = validatePhysiologicalPlausibility("cgm_avg_glucose", 30000);
      expect(result.valid).toBe(false);
    });

    it("rejects NaN", () => {
      const result = validatePhysiologicalPlausibility("weight_kg", NaN);
      expect(result.valid).toBe(false);
      expect(result.warning).toContain("not a finite number");
    });

    it("rejects Infinity", () => {
      const result = validatePhysiologicalPlausibility("height_cm", Infinity);
      expect(result.valid).toBe(false);
    });

    it("accepts unknown metric key (no bounds)", () => {
      expect(validatePhysiologicalPlausibility("custom_metric", 999).valid).toBe(true);
    });

    it("accepts valid BMD", () => {
      expect(validatePhysiologicalPlausibility("bmd_total", 1.717).valid).toBe(true);
    });

    it("rejects BMD above 3.0", () => {
      const result = validatePhysiologicalPlausibility("bmd_total", 3.5);
      expect(result.valid).toBe(false);
    });

    it("accepts valid testosterone", () => {
      expect(validatePhysiologicalPlausibility("total_testosterone", 390).valid).toBe(true);
    });

    it("rejects impossibly high testosterone", () => {
      const result = validatePhysiologicalPlausibility("total_testosterone", 3000);
      expect(result.valid).toBe(false);
    });

    it("percentage metrics can't exceed 100", () => {
      expect(validatePhysiologicalPlausibility("cgm_time_in_range_pct", 105).valid).toBe(false);
      expect(validatePhysiologicalPlausibility("cgm_time_below_range_pct", 101).valid).toBe(false);
    });

    it("accepts Alex's full dataset", () => {
      const alexValues: [string, number][] = [
        ["body_fat_pct", 10.7], ["lean_mass_kg", 74.7], ["fat_mass_kg", 9.0],
        ["bmi", 27.2], ["bmd_total", 1.717], ["android_fat_pct", 6.6],
        ["gynoid_fat_pct", 9.6], ["ag_ratio", 0.68], ["weight_kg", 88.5],
        ["height_cm", 180.3], ["total_testosterone", 390], ["free_testosterone", 56.56],
        ["vitamin_d", 47.2], ["albumin", 5.14], ["crp", 0.5],
        ["creatinine", 1.22], ["tsh", 1.00], ["free_t3", 2.33],
        ["cgm_avg_glucose", 81], ["cgm_stddev_glucose", 13],
      ];
      for (const [key, value] of alexValues) {
        expect(validatePhysiologicalPlausibility(key, value).valid).toBe(true);
      }
    });
  });

  // ─── Cross-metric consistency ─────────────────────────────────────────────

  describe("validateCrossMetricConsistency", () => {
    it("no warnings for consistent data", () => {
      const metrics = new Map<string, number>([
        ["weight_kg", 88.5],
        ["body_fat_pct", 10.7],
        ["fat_mass_kg", 9.47], // 88.5 * 0.107 = 9.47
        ["lean_mass_kg", 74.7],
        ["height_cm", 180.3],
        ["bmi", 27.2],
      ]);
      const result = validateCrossMetricConsistency(metrics);
      expect(result.warnings.length).toBe(0);
    });

    it("detects inconsistent fat mass vs body fat × weight", () => {
      const metrics = new Map<string, number>([
        ["weight_kg", 88.5],
        ["body_fat_pct", 10.7],
        ["fat_mass_kg", 20], // should be ~9.47, 20 is way off
      ]);
      const result = validateCrossMetricConsistency(metrics);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("Fat mass");
    });

    it("detects inconsistent BMI", () => {
      const metrics = new Map<string, number>([
        ["weight_kg", 88.5],
        ["height_cm", 180.3],
        ["bmi", 35], // should be ~27.2
      ]);
      const result = validateCrossMetricConsistency(metrics);
      expect(result.warnings.some((w) => w.includes("BMI"))).toBe(true);
    });

    it("detects Friedewald inconsistency", () => {
      const metrics = new Map<string, number>([
        ["total_cholesterol", 300],
        ["hdl", 77.4],
        ["ldl", 118.54],
        ["triglycerides", 75.3],
        // Friedewald: 77.4 + 118.54 + 15.06 = 211 — 300 is way off
      ]);
      const result = validateCrossMetricConsistency(metrics);
      expect(result.warnings.some((w) => w.includes("Friedewald"))).toBe(true);
    });

    it("passes Friedewald with Alex's actual lipid values", () => {
      const metrics = new Map<string, number>([
        ["total_cholesterol", 211],
        ["hdl", 77.4],
        ["ldl", 118.54],
        ["triglycerides", 75.3],
        // 77.4 + 118.54 + 15.06 = 211 ✓
      ]);
      const result = validateCrossMetricConsistency(metrics);
      expect(result.warnings.some((w) => w.includes("Friedewald"))).toBe(false);
    });

    it("detects CGM percentages not summing to 100%", () => {
      const metrics = new Map<string, number>([
        ["cgm_time_in_range_pct", 81],
        ["cgm_time_below_range_pct", 19],
        ["cgm_time_above_range_pct", 5], // 81+19+5 = 105 — off
      ]);
      const result = validateCrossMetricConsistency(metrics);
      expect(result.warnings.some((w) => w.includes("CGM time percentages"))).toBe(true);
    });

    it("passes CGM percentages summing to 100%", () => {
      const metrics = new Map<string, number>([
        ["cgm_time_in_range_pct", 81],
        ["cgm_time_below_range_pct", 19],
        ["cgm_time_above_range_pct", 0],
      ]);
      const result = validateCrossMetricConsistency(metrics);
      expect(result.warnings.some((w) => w.includes("CGM time percentages"))).toBe(false);
    });

    it("detects lean + fat mass not equaling weight", () => {
      const metrics = new Map<string, number>([
        ["weight_kg", 88.5],
        ["lean_mass_kg", 74.7],
        ["fat_mass_kg", 9.0],
        ["body_fat_pct", 10.7],
        // 74.7 + 9.0 = 83.7 vs 88.5 — ~5.4% off — this is bone mineral content difference
      ]);
      const result = validateCrossMetricConsistency(metrics);
      // Within 10% tolerance so this should be fine
      expect(result.warnings.some((w) => w.includes("Lean mass"))).toBe(false);
    });

    it("no warnings when partial data (graceful degradation)", () => {
      const metrics = new Map<string, number>([
        ["weight_kg", 88.5],
      ]);
      const result = validateCrossMetricConsistency(metrics);
      expect(result.warnings.length).toBe(0);
    });
  });

  // ─── contextualizeMetric ──────────────────────────────────────────────────

  describe("contextualizeMetric", () => {
    it("BMI: overweight but lean body fat → muscle mass context", () => {
      const result = contextualizeMetric("bmi", 27.2, { bodyFatPct: 10.7 });
      expect(result.interpretation).toContain("muscle mass");
      expect(result.interpretation).toContain("lean");
    });

    it("BMI: obese range but very low body fat → athletic build", () => {
      const result = contextualizeMetric("bmi", 31, { bodyFatPct: 12 });
      expect(result.interpretation).toContain("athletic build");
    });

    it("BMI: normal without body fat data → default interpretation", () => {
      const result = contextualizeMetric("bmi", 22);
      expect(result.interpretation).toContain("within normal range");
    });

    it("testosterone: male below optimal performance range", () => {
      const result = contextualizeMetric("total_testosterone", 390, { clientSex: "male" });
      expect(result.interpretation).toContain("below optimal performance range");
    });

    it("testosterone: female normal range", () => {
      const result = contextualizeMetric("total_testosterone", 40, { clientSex: "female" });
      expect(result.interpretation).toContain("within female reference range");
    });

    it("testosterone: female elevated", () => {
      const result = contextualizeMetric("total_testosterone", 100, { clientSex: "female" });
      expect(result.interpretation).toContain("elevated for female");
    });

    it("body_fat: male healthy range", () => {
      const result = contextualizeMetric("body_fat_pct", 10.7, { clientSex: "male" });
      expect(result.interpretation).toContain("healthy range for men");
    });

    it("body_fat: female below normal", () => {
      const result = contextualizeMetric("body_fat_pct", 15, { clientSex: "female" });
      expect(result.interpretation).toContain("below typical healthy range for women");
    });

    it("cgm_time_below: significant hypoglycemia", () => {
      const result = contextualizeMetric("cgm_time_below_range_pct", 19);
      expect(result.interpretation).toContain("significant hypoglycemia");
    });

    it("cgm_time_below: mild hypoglycemia", () => {
      const result = contextualizeMetric("cgm_time_below_range_pct", 8);
      expect(result.interpretation).toContain("mild hypoglycemia");
    });

    it("generic metric: returns default interpretation", () => {
      const result = contextualizeMetric("hdl", 77.4);
      expect(result.interpretation).toContain("within normal range");
      expect(result.label).toBe("HDL Cholesterol");
    });

    it("unknown metric: returns 'no reference range available'", () => {
      const result = contextualizeMetric("unknown_metric", 42);
      expect(result.interpretation).toContain("no reference range available");
    });
  });
});
