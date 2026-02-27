/**
 * Metrics Engine
 *
 * Normalized metric series analysis: reference ranges, staleness detection,
 * data quality warnings, and metric groupings.
 * Pure math — no DB dependency.
 */

export interface MetricDataPoint {
  metricKey: string;
  value: number;
  unit: string;
  observedAt: Date;
  verification: "UNVERIFIED" | "MANUAL_ENTRY" | "PARSED_AUTO" | "CLINICIAN_VERIFIED";
  sourceDocumentId?: string | null;
  confidenceScore?: number | null;
}

export interface MetricReferenceRange {
  metricKey: string;
  label: string;
  unit: string;
  lowNormal: number;
  highNormal: number;
  lowWarning?: number;
  highWarning?: number;
  category: MetricCategory;
}

export type MetricCategory = "bloodwork" | "body_composition" | "cardiovascular" | "metabolic" | "other";

export interface MetricStatus {
  metricKey: string;
  label: string;
  latestValue: number | null;
  latestUnit: string | null;
  latestObservedAt: Date | null;
  rangeStatus: "normal" | "warning" | "critical" | "unknown";
  staleDays: number | null;
  isStale: boolean;
  verificationLevel: string | null;
  category: MetricCategory;
}

export interface MetricQualityReport {
  totalMetrics: number;
  staleMetrics: string[];
  unverifiedMetrics: string[];
  outOfRangeMetrics: string[];
  missingCommonMetrics: string[];
  warnings: string[];
}

// Standard reference ranges for common health metrics
export const REFERENCE_RANGES: MetricReferenceRange[] = [
  // --- Metabolic ---
  { metricKey: "fasting_glucose", label: "Fasting Glucose", unit: "mg/dL", lowNormal: 70, highNormal: 100, lowWarning: 54, highWarning: 126, category: "metabolic" },
  { metricKey: "hba1c", label: "HbA1c", unit: "%", lowNormal: 4.0, highNormal: 5.7, highWarning: 6.5, category: "metabolic" },
  { metricKey: "tsh", label: "TSH", unit: "uIU/mL", lowNormal: 0.4, highNormal: 4.0, lowWarning: 0.1, highWarning: 10, category: "metabolic" },
  { metricKey: "free_t3", label: "Free T3", unit: "pg/mL", lowNormal: 2.0, highNormal: 4.4, lowWarning: 1.5, highWarning: 6.0, category: "metabolic" },
  { metricKey: "creatinine", label: "Creatinine", unit: "mg/dL", lowNormal: 0.7, highNormal: 1.3, lowWarning: 0.5, highWarning: 2.0, category: "metabolic" },

  // --- CGM Summary ---
  { metricKey: "cgm_avg_glucose", label: "CGM Avg Glucose", unit: "mg/dL", lowNormal: 70, highNormal: 100, lowWarning: 54, highWarning: 140, category: "metabolic" },
  { metricKey: "cgm_fasting_glucose_avg", label: "CGM Fasting Glucose", unit: "mg/dL", lowNormal: 65, highNormal: 100, lowWarning: 54, highWarning: 126, category: "metabolic" },
  { metricKey: "cgm_time_in_range_pct", label: "Time in Range", unit: "%", lowNormal: 70, highNormal: 100, lowWarning: 50, category: "metabolic" },
  { metricKey: "cgm_time_below_range_pct", label: "Time Below Range", unit: "%", lowNormal: 0, highNormal: 4, highWarning: 15, category: "metabolic" },
  { metricKey: "cgm_stddev_glucose", label: "Glucose Variability (SD)", unit: "mg/dL", lowNormal: 0, highNormal: 25, highWarning: 36, category: "metabolic" },

  // --- Bloodwork: Lipids ---
  { metricKey: "ldl", label: "LDL Cholesterol", unit: "mg/dL", lowNormal: 0, highNormal: 100, highWarning: 160, category: "bloodwork" },
  { metricKey: "hdl", label: "HDL Cholesterol", unit: "mg/dL", lowNormal: 40, highNormal: 100, lowWarning: 35, category: "bloodwork" },
  { metricKey: "triglycerides", label: "Triglycerides", unit: "mg/dL", lowNormal: 0, highNormal: 150, highWarning: 200, category: "bloodwork" },
  { metricKey: "total_cholesterol", label: "Total Cholesterol", unit: "mg/dL", lowNormal: 125, highNormal: 200, highWarning: 240, category: "bloodwork" },
  { metricKey: "apob", label: "ApoB", unit: "mg/dL", lowNormal: 40, highNormal: 90, highWarning: 130, category: "bloodwork" },
  { metricKey: "tc_hdl_ratio", label: "TC/HDL Ratio", unit: "ratio", lowNormal: 1.0, highNormal: 4.5, highWarning: 6.0, category: "bloodwork" },
  { metricKey: "tg_hdl_ratio", label: "TG/HDL Ratio", unit: "ratio", lowNormal: 0.5, highNormal: 2.0, highWarning: 4.0, category: "bloodwork" },
  { metricKey: "remnant_cholesterol", label: "Remnant Cholesterol", unit: "mg/dL", lowNormal: 0, highNormal: 20, highWarning: 30, category: "bloodwork" },
  { metricKey: "ldl_apob_ratio", label: "LDL/ApoB Ratio", unit: "ratio", lowNormal: 1.0, highNormal: 1.8, highWarning: 2.5, category: "bloodwork" },

  // --- Bloodwork: Hormones ---
  { metricKey: "total_testosterone", label: "Total Testosterone", unit: "ng/dL", lowNormal: 300, highNormal: 1000, lowWarning: 200, category: "bloodwork" },
  { metricKey: "free_testosterone", label: "Free Testosterone", unit: "pg/mL", lowNormal: 50, highNormal: 210, lowWarning: 35, category: "bloodwork" },
  { metricKey: "estrogen", label: "Estradiol", unit: "pg/mL", lowNormal: 15, highNormal: 60, lowWarning: 10, highWarning: 200, category: "bloodwork" },
  { metricKey: "shbg", label: "SHBG", unit: "nmol/L", lowNormal: 10, highNormal: 57, lowWarning: 5, highWarning: 100, category: "bloodwork" },

  // --- Bloodwork: General ---
  { metricKey: "vitamin_d", label: "Vitamin D (25-OH)", unit: "ng/mL", lowNormal: 30, highNormal: 100, lowWarning: 20, highWarning: 150, category: "bloodwork" },
  { metricKey: "ferritin", label: "Ferritin", unit: "ng/mL", lowNormal: 30, highNormal: 300, lowWarning: 15, highWarning: 500, category: "bloodwork" },
  { metricKey: "crp", label: "C-Reactive Protein", unit: "mg/L", lowNormal: 0, highNormal: 1.0, highWarning: 3.0, category: "bloodwork" },
  { metricKey: "albumin", label: "Albumin", unit: "g/dL", lowNormal: 3.5, highNormal: 5.5, lowWarning: 3.0, highWarning: 6.0, category: "bloodwork" },

  // --- Body Composition ---
  { metricKey: "body_fat_pct", label: "Body Fat %", unit: "%", lowNormal: 10, highNormal: 25, lowWarning: 5, highWarning: 35, category: "body_composition" },
  { metricKey: "lean_mass_kg", label: "Lean Mass", unit: "kg", lowNormal: 30, highNormal: 120, category: "body_composition" },
  { metricKey: "fat_mass_kg", label: "Fat Mass", unit: "kg", lowNormal: 5, highNormal: 30, lowWarning: 3, highWarning: 50, category: "body_composition" },
  { metricKey: "bmi", label: "BMI", unit: "kg/m2", lowNormal: 18.5, highNormal: 25, lowWarning: 16, highWarning: 35, category: "body_composition" },
  { metricKey: "bmd_total", label: "Bone Mineral Density", unit: "g/cm2", lowNormal: 1.0, highNormal: 1.5, lowWarning: 0.8, category: "body_composition" },
  { metricKey: "android_fat_pct", label: "Android Fat %", unit: "%", lowNormal: 5, highNormal: 25, lowWarning: 3, highWarning: 35, category: "body_composition" },
  { metricKey: "gynoid_fat_pct", label: "Gynoid Fat %", unit: "%", lowNormal: 8, highNormal: 30, lowWarning: 5, highWarning: 40, category: "body_composition" },
  { metricKey: "ag_ratio", label: "Android/Gynoid Ratio", unit: "ratio", lowNormal: 0.4, highNormal: 1.0, highWarning: 1.2, category: "body_composition" },

  // --- Cardiovascular ---
  { metricKey: "resting_hr", label: "Resting Heart Rate", unit: "bpm", lowNormal: 40, highNormal: 100, lowWarning: 35, highWarning: 120, category: "cardiovascular" },
  { metricKey: "systolic_bp", label: "Systolic BP", unit: "mmHg", lowNormal: 90, highNormal: 120, lowWarning: 80, highWarning: 140, category: "cardiovascular" },
  { metricKey: "diastolic_bp", label: "Diastolic BP", unit: "mmHg", lowNormal: 60, highNormal: 80, lowWarning: 50, highWarning: 90, category: "cardiovascular" },
];

const COMMON_METRICS = [
  "fasting_glucose", "hba1c", "ldl", "hdl", "triglycerides",
  "body_fat_pct", "lean_mass_kg", "resting_hr",
];

const STALE_THRESHOLD_DAYS = 90; // metrics older than 90 days are stale

/**
 * Get the reference range for a given metric key.
 */
export function getReferenceRange(metricKey: string): MetricReferenceRange | null {
  return REFERENCE_RANGES.find((r) => r.metricKey === metricKey) ?? null;
}

/**
 * Classify a metric value against its reference range.
 */
export function classifyMetricValue(
  metricKey: string,
  value: number,
): "normal" | "warning" | "critical" | "unknown" {
  const range = getReferenceRange(metricKey);
  if (!range) return "unknown";

  // Check critical thresholds first
  if (range.lowWarning != null && value < range.lowWarning) return "critical";
  if (range.highWarning != null && value > range.highWarning) return "critical";

  // Check normal range
  if (value >= range.lowNormal && value <= range.highNormal) return "normal";

  // Between normal and warning = warning
  return "warning";
}

/**
 * Get the latest data point for each metric key.
 */
export function getLatestMetrics(dataPoints: MetricDataPoint[]): Map<string, MetricDataPoint> {
  const latest = new Map<string, MetricDataPoint>();
  const sorted = [...dataPoints].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());

  for (const dp of sorted) {
    latest.set(dp.metricKey, dp);
  }

  return latest;
}

/**
 * Compute full metric status for a client.
 */
export function computeMetricStatuses(
  dataPoints: MetricDataPoint[],
  referenceDate?: Date,
): MetricStatus[] {
  const now = referenceDate ?? new Date();
  const latestByKey = getLatestMetrics(dataPoints);
  const statuses: MetricStatus[] = [];

  // Build status for all known reference ranges
  for (const range of REFERENCE_RANGES) {
    const latest = latestByKey.get(range.metricKey);
    const staleDays = latest
      ? Math.floor((now.getTime() - latest.observedAt.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    statuses.push({
      metricKey: range.metricKey,
      label: range.label,
      latestValue: latest?.value ?? null,
      latestUnit: latest?.unit ?? range.unit,
      latestObservedAt: latest?.observedAt ?? null,
      rangeStatus: latest ? classifyMetricValue(range.metricKey, latest.value) : "unknown",
      staleDays,
      isStale: staleDays !== null ? staleDays > STALE_THRESHOLD_DAYS : true,
      verificationLevel: latest?.verification ?? null,
      category: range.category,
    });
  }

  // Include any custom metrics not in reference ranges
  for (const [key, dp] of latestByKey) {
    if (!REFERENCE_RANGES.some((r) => r.metricKey === key)) {
      const staleDays = Math.floor((now.getTime() - dp.observedAt.getTime()) / (1000 * 60 * 60 * 24));
      statuses.push({
        metricKey: key,
        label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        latestValue: dp.value,
        latestUnit: dp.unit,
        latestObservedAt: dp.observedAt,
        rangeStatus: "unknown",
        staleDays,
        isStale: staleDays > STALE_THRESHOLD_DAYS,
        verificationLevel: dp.verification,
        category: "other",
      });
    }
  }

  return statuses;
}

/**
 * Generate a quality report for a client's metric data.
 */
export function generateMetricQualityReport(
  dataPoints: MetricDataPoint[],
  referenceDate?: Date,
): MetricQualityReport {
  const statuses = computeMetricStatuses(dataPoints, referenceDate);
  const latestByKey = getLatestMetrics(dataPoints);

  const staleMetrics = statuses
    .filter((s) => s.isStale && s.latestValue !== null)
    .map((s) => s.metricKey);

  const unverifiedMetrics = [...latestByKey.entries()]
    .filter(([, dp]) => dp.verification === "UNVERIFIED")
    .map(([key]) => key);

  const outOfRangeMetrics = statuses
    .filter((s) => s.rangeStatus === "warning" || s.rangeStatus === "critical")
    .map((s) => s.metricKey);

  const presentKeys = new Set(latestByKey.keys());
  const missingCommonMetrics = COMMON_METRICS.filter((k) => !presentKeys.has(k));

  const warnings: string[] = [];
  if (staleMetrics.length > 0) {
    warnings.push(`${staleMetrics.length} metric(s) are stale (>90 days old)`);
  }
  if (unverifiedMetrics.length > 0) {
    warnings.push(`${unverifiedMetrics.length} metric(s) are unverified`);
  }
  if (outOfRangeMetrics.length > 0) {
    warnings.push(`${outOfRangeMetrics.length} metric(s) outside normal range`);
  }
  if (missingCommonMetrics.length > 0) {
    warnings.push(`Missing common metrics: ${missingCommonMetrics.join(", ")}`);
  }

  return {
    totalMetrics: latestByKey.size,
    staleMetrics,
    unverifiedMetrics,
    outOfRangeMetrics,
    missingCommonMetrics,
    warnings,
  };
}

/**
 * Group metric statuses by category.
 */
export function groupMetricsByCategory(
  statuses: MetricStatus[],
): Record<MetricCategory, MetricStatus[]> {
  const groups: Record<MetricCategory, MetricStatus[]> = {
    bloodwork: [],
    body_composition: [],
    cardiovascular: [],
    metabolic: [],
    other: [],
  };
  for (const s of statuses) {
    groups[s.category].push(s);
  }
  return groups;
}

/**
 * Build a time-series for a specific metric key, sorted chronologically.
 */
export function getMetricTimeSeries(
  dataPoints: MetricDataPoint[],
  metricKey: string,
): MetricDataPoint[] {
  return dataPoints
    .filter((dp) => dp.metricKey === metricKey)
    .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
}

// ─── Phase 3: Physiological Plausibility Guards ─────────────────────────────

export interface PlausibilityResult {
  valid: boolean;
  warning?: string;
}

/**
 * Physiological plausibility bounds per metric key.
 * Values outside these absolute bounds are physiologically implausible.
 */
const PLAUSIBILITY_BOUNDS: Record<string, { min: number; max: number; label: string }> = {
  weight_kg: { min: 20, max: 350, label: "Weight" },
  height_cm: { min: 50, max: 250, label: "Height" },
  body_fat_pct: { min: 2, max: 70, label: "Body Fat %" },
  lean_mass_kg: { min: 10, max: 200, label: "Lean Mass" },
  fat_mass_kg: { min: 0.5, max: 200, label: "Fat Mass" },
  fat_free_mass_kg: { min: 15, max: 200, label: "Fat-Free Mass" },
  bmi: { min: 10, max: 70, label: "BMI" },
  bmd_total: { min: 0.1, max: 3.0, label: "Bone Mineral Density" },
  bone_mineral_content_kg: { min: 0.5, max: 10, label: "Bone Mineral Content" },
  resting_hr: { min: 25, max: 250, label: "Resting Heart Rate" },
  systolic_bp: { min: 60, max: 250, label: "Systolic BP" },
  diastolic_bp: { min: 30, max: 150, label: "Diastolic BP" },
  fasting_glucose: { min: 20, max: 600, label: "Fasting Glucose" },
  cgm_avg_glucose: { min: 20, max: 600, label: "CGM Avg Glucose" },
  cgm_fasting_glucose_avg: { min: 20, max: 600, label: "CGM Fasting Glucose" },
  cgm_min_glucose: { min: 10, max: 400, label: "CGM Min Glucose" },
  cgm_max_glucose: { min: 30, max: 600, label: "CGM Max Glucose" },
  cgm_stddev_glucose: { min: 0, max: 100, label: "CGM Glucose SD" },
  cgm_time_in_range_pct: { min: 0, max: 100, label: "Time in Range %" },
  cgm_time_below_range_pct: { min: 0, max: 100, label: "Time Below Range %" },
  cgm_time_above_range_pct: { min: 0, max: 100, label: "Time Above Range %" },
  hba1c: { min: 2, max: 20, label: "HbA1c" },
  total_testosterone: { min: 1, max: 2000, label: "Total Testosterone" },
  free_testosterone: { min: 0.1, max: 500, label: "Free Testosterone" },
  estrogen: { min: 0, max: 5000, label: "Estradiol" },
  shbg: { min: 1, max: 300, label: "SHBG" },
  vitamin_d: { min: 1, max: 200, label: "Vitamin D" },
  ferritin: { min: 1, max: 5000, label: "Ferritin" },
  tsh: { min: 0.01, max: 50, label: "TSH" },
  free_t3: { min: 0.5, max: 15, label: "Free T3" },
  crp: { min: 0, max: 300, label: "CRP" },
  creatinine: { min: 0.1, max: 15, label: "Creatinine" },
  apob: { min: 10, max: 300, label: "ApoB" },
  albumin: { min: 1, max: 8, label: "Albumin" },
  total_cholesterol: { min: 50, max: 500, label: "Total Cholesterol" },
  hdl: { min: 5, max: 150, label: "HDL" },
  ldl: { min: 5, max: 400, label: "LDL" },
  triglycerides: { min: 10, max: 1000, label: "Triglycerides" },
  android_fat_pct: { min: 0, max: 65, label: "Android Fat %" },
  gynoid_fat_pct: { min: 0, max: 65, label: "Gynoid Fat %" },
  ag_ratio: { min: 0.1, max: 3, label: "A/G Ratio" },
  vat_mass_lbs: { min: 0, max: 20, label: "VAT Mass" },
};

/**
 * Validate that a metric value is physiologically plausible.
 * Returns { valid: true } for values within bounds, or
 * { valid: false, warning: "..." } for implausible values.
 */
export function validatePhysiologicalPlausibility(
  metricKey: string,
  value: number,
): PlausibilityResult {
  // All metrics must be finite
  if (!Number.isFinite(value)) {
    return { valid: false, warning: `${metricKey}: value is not a finite number` };
  }

  const bounds = PLAUSIBILITY_BOUNDS[metricKey];
  if (!bounds) {
    // No bounds defined — accept but don't validate
    return { valid: true };
  }

  if (value < bounds.min) {
    return {
      valid: false,
      warning: `${bounds.label} (${value}) is below physiological minimum (${bounds.min})`,
    };
  }
  if (value > bounds.max) {
    return {
      valid: false,
      warning: `${bounds.label} (${value}) exceeds physiological maximum (${bounds.max})`,
    };
  }

  return { valid: true };
}

export interface CrossMetricConsistencyResult {
  warnings: string[];
}

/**
 * Validate consistency across related metrics.
 * Catches impossible or contradictory metric combinations.
 */
export function validateCrossMetricConsistency(
  metrics: Map<string, number>,
): CrossMetricConsistencyResult {
  const warnings: string[] = [];

  // Body composition check: fat_mass_kg ≈ weight × body_fat_pct / 100
  const weight = metrics.get("weight_kg");
  const bodyFat = metrics.get("body_fat_pct");
  const fatMass = metrics.get("fat_mass_kg");
  if (weight != null && bodyFat != null && fatMass != null) {
    const expectedFatMass = weight * bodyFat / 100;
    const diff = Math.abs(fatMass - expectedFatMass);
    if (diff > expectedFatMass * 0.1) {
      warnings.push(
        `Fat mass (${fatMass} kg) inconsistent with weight (${weight} kg) × body fat (${bodyFat}%) — expected ~${Math.round(expectedFatMass * 10) / 10} kg`,
      );
    }
  }

  // BMI check: BMI ≈ weight / (height/100)²
  const bmi = metrics.get("bmi");
  const height = metrics.get("height_cm");
  if (bmi != null && weight != null && height != null && height > 0) {
    const expectedBMI = weight / Math.pow(height / 100, 2);
    const diff = Math.abs(bmi - expectedBMI);
    if (diff > expectedBMI * 0.05) {
      warnings.push(
        `BMI (${bmi}) inconsistent with weight (${weight} kg) / height (${height} cm) — expected ~${Math.round(expectedBMI * 10) / 10}`,
      );
    }
  }

  // Friedewald: TC ≈ HDL + LDL + TG/5
  const tc = metrics.get("total_cholesterol");
  const hdl = metrics.get("hdl");
  const ldl = metrics.get("ldl");
  const tg = metrics.get("triglycerides");
  if (tc != null && hdl != null && ldl != null && tg != null) {
    const expectedTC = hdl + ldl + tg / 5;
    const diff = Math.abs(tc - expectedTC);
    if (diff > tc * 0.15) {
      warnings.push(
        `Total cholesterol (${tc}) inconsistent with Friedewald equation: HDL (${hdl}) + LDL (${ldl}) + TG/5 (${Math.round(tg / 5)}) = ${Math.round(expectedTC)}`,
      );
    }
  }

  // CGM time distribution should sum to ~100%
  const inRange = metrics.get("cgm_time_in_range_pct");
  const belowRange = metrics.get("cgm_time_below_range_pct");
  const aboveRange = metrics.get("cgm_time_above_range_pct");
  if (inRange != null && belowRange != null && aboveRange != null) {
    const total = inRange + belowRange + aboveRange;
    if (Math.abs(total - 100) > 2) {
      warnings.push(
        `CGM time percentages sum to ${total}% (expected ~100%): in-range ${inRange}% + below ${belowRange}% + above ${aboveRange}%`,
      );
    }
  }

  // Lean mass + fat mass should ≈ weight (within 10%)
  const leanMass = metrics.get("lean_mass_kg");
  if (weight != null && leanMass != null && fatMass != null) {
    const totalComp = leanMass + fatMass;
    const diff = Math.abs(totalComp - weight);
    if (diff > weight * 0.10) {
      warnings.push(
        `Lean mass (${leanMass} kg) + fat mass (${fatMass} kg) = ${Math.round(totalComp * 10) / 10} kg, but weight is ${weight} kg (>10% difference)`,
      );
    }
  }

  return { warnings };
}

export interface MetricContextResult {
  label: string;
  interpretation: string;
}

/**
 * Provide contextual interpretation for a metric value,
 * including sex-specific and body-composition-aware context.
 */
export function contextualizeMetric(
  metricKey: string,
  value: number,
  opts?: { clientSex?: string; bodyFatPct?: number },
): MetricContextResult {
  const range = getReferenceRange(metricKey);
  const status = classifyMetricValue(metricKey, value);
  const label = range?.label ?? metricKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  // BMI with body-fat context (check higher BMI first for specificity)
  if (metricKey === "bmi") {
    const bf = opts?.bodyFatPct;
    if (value > 30 && bf != null && bf < 15) {
      return {
        label,
        interpretation: `BMI ${value} (obese range) but body fat is only ${bf}% — athletic build with significant muscle mass`,
      };
    }
    if (value > 25 && bf != null && bf < 20) {
      return {
        label,
        interpretation: `BMI ${value} (overweight range) but body fat is ${bf}% (lean) — likely elevated due to muscle mass`,
      };
    }
  }

  // Testosterone sex-specific context
  if (metricKey === "total_testosterone") {
    if (opts?.clientSex === "female") {
      // Female ranges are very different
      if (value > 70) {
        return { label, interpretation: `Total testosterone ${value} ng/dL — elevated for female reference range (15–70 ng/dL)` };
      }
      if (value >= 15 && value <= 70) {
        return { label, interpretation: `Total testosterone ${value} ng/dL — within female reference range (15–70 ng/dL)` };
      }
      return { label, interpretation: `Total testosterone ${value} ng/dL — low for female reference range (15–70 ng/dL)` };
    }
    // Male performance context
    if (opts?.clientSex === "male" && value >= 300 && value < 500) {
      return { label, interpretation: `Total testosterone ${value} ng/dL — within lab reference range but below optimal performance range (700–1100 ng/dL)` };
    }
  }

  // Body fat sex-specific context
  if (metricKey === "body_fat_pct") {
    if (opts?.clientSex === "female") {
      if (value >= 18 && value <= 28) {
        return { label, interpretation: `Body fat ${value}% — healthy range for women (18–28%)` };
      }
      if (value < 18) {
        return { label, interpretation: `Body fat ${value}% — below typical healthy range for women (18–28%); may be athletic` };
      }
    }
    if (opts?.clientSex === "male") {
      if (value >= 8 && value <= 20) {
        return { label, interpretation: `Body fat ${value}% — healthy range for men (8–20%)` };
      }
      if (value < 8) {
        return { label, interpretation: `Body fat ${value}% — very lean for men; competition-level leanness` };
      }
    }
  }

  // CGM time below range alert
  if (metricKey === "cgm_time_below_range_pct" && value > 4) {
    return {
      label,
      interpretation: value > 15
        ? `${value}% time below range — significant hypoglycemia; consider evaluating meal timing and carbohydrate intake`
        : `${value}% time below range — mild hypoglycemia; monitor patterns`,
    };
  }

  // Default
  const statusLabel = status === "normal" ? "within normal range"
    : status === "warning" ? "outside normal range (warning)"
    : status === "critical" ? "outside normal range (critical)"
    : "no reference range available";

  return {
    label,
    interpretation: `${label}: ${value} ${range?.unit ?? ""} — ${statusLabel}`,
  };
}
