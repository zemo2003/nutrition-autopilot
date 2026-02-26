/**
 * Biometrics Engine
 *
 * Time-series analysis for client biometric snapshots.
 * Trend detection, data quality indicators, and latest-value summaries.
 * Pure math — no DB dependency.
 */

export interface BiometricDataPoint {
  measuredAt: Date;
  heightCm?: number | null;
  weightKg?: number | null;
  bodyFatPct?: number | null;
  leanMassKg?: number | null;
  restingHr?: number | null;
  source?: string | null;
}

export type TrendDirection = "up" | "down" | "stable" | "insufficient";

export interface BiometricTrend {
  field: string;
  direction: TrendDirection;
  latestValue: number | null;
  previousValue: number | null;
  deltaAbs: number | null;
  deltaPct: number | null;
}

export interface BiometricSummary {
  latestSnapshot: BiometricDataPoint | null;
  snapshotCount: number;
  trends: BiometricTrend[];
  dataQuality: DataQualityReport;
}

export interface DataQualityReport {
  hasRecentData: boolean;
  daysSinceLastSnapshot: number | null;
  missingFields: string[];
  irregularIntervals: boolean;
  warnings: string[];
}

const BIOMETRIC_FIELDS = ["heightCm", "weightKg", "bodyFatPct", "leanMassKg", "restingHr"] as const;
type BiometricField = (typeof BIOMETRIC_FIELDS)[number];

const TREND_THRESHOLD_PCT = 1; // 1% change threshold for trend detection
const STALE_DATA_DAYS = 30; // data older than 30 days triggers warning
const IRREGULAR_INTERVAL_FACTOR = 3; // intervals 3x median → irregular

/**
 * Sort snapshots chronologically (oldest first).
 */
export function sortChronological(snapshots: BiometricDataPoint[]): BiometricDataPoint[] {
  return [...snapshots].sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime());
}

/**
 * Get the latest non-null value for a given field across snapshots.
 */
export function getLatestValue(
  snapshots: BiometricDataPoint[],
  field: BiometricField,
): { value: number; measuredAt: Date } | null {
  const sorted = sortChronological(snapshots);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const snap = sorted[i]!;
    const val = snap[field];
    if (val != null && typeof val === "number") {
      return { value: val, measuredAt: snap.measuredAt };
    }
  }
  return null;
}

/**
 * Compute trend direction for a given field from the last two non-null values.
 */
export function computeTrend(
  snapshots: BiometricDataPoint[],
  field: BiometricField,
): BiometricTrend {
  const sorted = sortChronological(snapshots);
  const values: { value: number; measuredAt: Date }[] = [];

  for (const snap of sorted) {
    const val = snap[field];
    if (val != null && typeof val === "number") {
      values.push({ value: val, measuredAt: snap.measuredAt });
    }
  }

  if (values.length < 2) {
    return {
      field,
      direction: "insufficient",
      latestValue: values.length > 0 ? values[values.length - 1]!.value : null,
      previousValue: null,
      deltaAbs: null,
      deltaPct: null,
    };
  }

  const latest = values[values.length - 1]!;
  const previous = values[values.length - 2]!;
  const deltaAbs = latest.value - previous.value;
  const deltaPct = previous.value !== 0
    ? (deltaAbs / Math.abs(previous.value)) * 100
    : 0;

  let direction: TrendDirection;
  if (Math.abs(deltaPct) < TREND_THRESHOLD_PCT) {
    direction = "stable";
  } else if (deltaAbs > 0) {
    direction = "up";
  } else {
    direction = "down";
  }

  return {
    field,
    direction,
    latestValue: latest.value,
    previousValue: previous.value,
    deltaAbs: Math.round(deltaAbs * 100) / 100,
    deltaPct: Math.round(deltaPct * 100) / 100,
  };
}

/**
 * Detect missing biometric fields in the latest snapshot.
 */
export function detectMissingFields(latest: BiometricDataPoint | null): string[] {
  if (!latest) return [...BIOMETRIC_FIELDS];
  const missing: string[] = [];
  for (const field of BIOMETRIC_FIELDS) {
    if (latest[field] == null) {
      missing.push(field);
    }
  }
  return missing;
}

/**
 * Detect irregular measurement intervals.
 * Returns true if any interval is more than IRREGULAR_INTERVAL_FACTOR * median interval.
 */
export function detectIrregularIntervals(snapshots: BiometricDataPoint[]): boolean {
  if (snapshots.length < 3) return false;
  const sorted = sortChronological(snapshots);
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push(sorted[i]!.measuredAt.getTime() - sorted[i - 1]!.measuredAt.getTime());
  }
  const sortedIntervals = [...intervals].sort((a, b) => a - b);
  const medianIdx = Math.floor(sortedIntervals.length / 2);
  const median = sortedIntervals[medianIdx]!;
  if (median === 0) return false;
  return intervals.some((i) => i > median * IRREGULAR_INTERVAL_FACTOR);
}

/**
 * Generate a comprehensive biometric summary for a client.
 */
export function generateBiometricSummary(
  snapshots: BiometricDataPoint[],
  referenceDate?: Date,
): BiometricSummary {
  const now = referenceDate ?? new Date();
  const sorted = sortChronological(snapshots);
  const latestSnapshot = sorted.length > 0 ? sorted[sorted.length - 1]! : null;

  const daysSinceLastSnapshot = latestSnapshot
    ? Math.floor((now.getTime() - latestSnapshot.measuredAt.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const hasRecentData = daysSinceLastSnapshot !== null && daysSinceLastSnapshot <= STALE_DATA_DAYS;
  const missingFields = detectMissingFields(latestSnapshot);
  const irregularIntervals = detectIrregularIntervals(sorted);

  const warnings: string[] = [];
  if (!hasRecentData && snapshots.length > 0) {
    warnings.push(`Last biometric snapshot is ${daysSinceLastSnapshot} days old`);
  }
  if (snapshots.length === 0) {
    warnings.push("No biometric data recorded");
  }
  if (missingFields.length > 0 && latestSnapshot) {
    warnings.push(`Missing fields in latest snapshot: ${missingFields.join(", ")}`);
  }
  if (irregularIntervals) {
    warnings.push("Irregular measurement intervals detected");
  }

  const trends: BiometricTrend[] = BIOMETRIC_FIELDS.map((field) =>
    computeTrend(sorted, field),
  );

  return {
    latestSnapshot,
    snapshotCount: snapshots.length,
    trends,
    dataQuality: {
      hasRecentData,
      daysSinceLastSnapshot,
      missingFields,
      irregularIntervals,
      warnings,
    },
  };
}

/**
 * Compute BMI from height and weight.
 */
export function computeBMI(heightCm: number, weightKg: number): number | null {
  if (heightCm <= 0 || weightKg <= 0) return null;
  const heightM = heightCm / 100;
  return Math.round((weightKg / (heightM * heightM)) * 10) / 10;
}

/**
 * Classify BMI into a category.
 */
export function classifyBMI(bmi: number): string {
  if (bmi < 18.5) return "underweight";
  if (bmi < 25) return "normal";
  if (bmi < 30) return "overweight";
  return "obese";
}
