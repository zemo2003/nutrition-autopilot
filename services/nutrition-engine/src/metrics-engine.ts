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
  { metricKey: "fasting_glucose", label: "Fasting Glucose", unit: "mg/dL", lowNormal: 70, highNormal: 100, lowWarning: 54, highWarning: 126, category: "metabolic" },
  { metricKey: "hba1c", label: "HbA1c", unit: "%", lowNormal: 4.0, highNormal: 5.7, highWarning: 6.5, category: "metabolic" },
  { metricKey: "ldl", label: "LDL Cholesterol", unit: "mg/dL", lowNormal: 0, highNormal: 100, highWarning: 160, category: "bloodwork" },
  { metricKey: "hdl", label: "HDL Cholesterol", unit: "mg/dL", lowNormal: 40, highNormal: 100, lowWarning: 35, category: "bloodwork" },
  { metricKey: "triglycerides", label: "Triglycerides", unit: "mg/dL", lowNormal: 0, highNormal: 150, highWarning: 200, category: "bloodwork" },
  { metricKey: "total_cholesterol", label: "Total Cholesterol", unit: "mg/dL", lowNormal: 125, highNormal: 200, highWarning: 240, category: "bloodwork" },
  { metricKey: "body_fat_pct", label: "Body Fat %", unit: "%", lowNormal: 10, highNormal: 25, lowWarning: 5, highWarning: 35, category: "body_composition" },
  { metricKey: "lean_mass_kg", label: "Lean Mass", unit: "kg", lowNormal: 30, highNormal: 120, category: "body_composition" },
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
