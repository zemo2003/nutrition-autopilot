/**
 * Data Completeness Engine
 *
 * Composite scoring engine for assessing client data readiness.
 * Used to determine if there is enough data for model training.
 * Pure math — no DB dependency.
 */

export interface DataCompletenessInput {
  biometricSnapshotCount: number;
  daysSinceLastBiometric: number | null;
  biometricFieldsCovered: number; // out of 5 (height, weight, bf%, lean mass, hr)
  metricCount: number;
  staleMetricCount: number;
  missingCommonMetricCount: number; // out of 8 common metrics
  nutritionDaysWithData: number;
  nutritionTotalDays: number; // window size, e.g., 90
  documentsByType: Record<string, number>;
}

export interface ScoringBreakdown {
  category: string;
  label: string;
  score: number;
  maxScore: number;
  detail: string;
}

export interface DataCompletenessReport {
  totalScore: number;
  maxScore: number;
  category: "insufficient" | "minimal" | "good" | "excellent";
  breakdown: ScoringBreakdown[];
  recommendations: string[];
}

/**
 * Compute a data completeness score (0-100).
 */
export function computeDataCompleteness(input: DataCompletenessInput): DataCompletenessReport {
  const breakdown: ScoringBreakdown[] = [];
  const recommendations: string[] = [];

  // 1. Biometric depth (25 pts)
  let bioDepth = 0;
  if (input.biometricSnapshotCount >= 6) bioDepth = 25;
  else if (input.biometricSnapshotCount >= 3) bioDepth = 18;
  else if (input.biometricSnapshotCount >= 1) bioDepth = 10;
  breakdown.push({
    category: "biometric_depth",
    label: "Biometric Depth",
    score: bioDepth,
    maxScore: 25,
    detail: `${input.biometricSnapshotCount} snapshot${input.biometricSnapshotCount !== 1 ? "s" : ""} recorded`,
  });
  if (input.biometricSnapshotCount < 6) {
    recommendations.push(`Record ${6 - input.biometricSnapshotCount} more biometric snapshot${6 - input.biometricSnapshotCount !== 1 ? "s" : ""} for full depth scoring`);
  }

  // 2. Biometric recency (10 pts)
  let bioRecency = 0;
  if (input.daysSinceLastBiometric !== null) {
    if (input.daysSinceLastBiometric <= 7) bioRecency = 10;
    else if (input.daysSinceLastBiometric <= 30) bioRecency = 7;
    else if (input.daysSinceLastBiometric <= 90) bioRecency = 3;
  }
  breakdown.push({
    category: "biometric_recency",
    label: "Biometric Recency",
    score: bioRecency,
    maxScore: 10,
    detail: input.daysSinceLastBiometric !== null
      ? `Last snapshot ${input.daysSinceLastBiometric} day${input.daysSinceLastBiometric !== 1 ? "s" : ""} ago`
      : "No snapshots recorded",
  });
  if (input.daysSinceLastBiometric === null || input.daysSinceLastBiometric > 7) {
    recommendations.push("Record a new biometric snapshot (target: weekly)");
  }

  // 3. Metric coverage (20 pts)
  const commonMetrics = 8;
  const coveredMetrics = commonMetrics - input.missingCommonMetricCount;
  const metricCoverage = Math.round((coveredMetrics / commonMetrics) * 20);
  breakdown.push({
    category: "metric_coverage",
    label: "Metric Coverage",
    score: metricCoverage,
    maxScore: 20,
    detail: `${coveredMetrics}/${commonMetrics} common metrics tracked`,
  });
  if (input.missingCommonMetricCount > 0) {
    recommendations.push(`Add ${input.missingCommonMetricCount} missing common metric${input.missingCommonMetricCount !== 1 ? "s" : ""} (bloodwork, body composition, cardiovascular)`);
  }

  // 4. Metric freshness (10 pts)
  const totalMetrics = input.metricCount || 1;
  const freshMetrics = input.metricCount - input.staleMetricCount;
  const metricFreshness = Math.round((freshMetrics / totalMetrics) * 10);
  breakdown.push({
    category: "metric_freshness",
    label: "Metric Freshness",
    score: metricFreshness,
    maxScore: 10,
    detail: input.staleMetricCount > 0
      ? `${input.staleMetricCount} stale metric${input.staleMetricCount !== 1 ? "s" : ""} (>90 days old)`
      : "All metrics up to date",
  });
  if (input.staleMetricCount > 0) {
    recommendations.push(`Update ${input.staleMetricCount} stale metric${input.staleMetricCount !== 1 ? "s" : ""}`);
  }

  // 5. Nutrition history (25 pts)
  const nutritionWindow = input.nutritionTotalDays || 90;
  const nutritionScore = Math.round((input.nutritionDaysWithData / nutritionWindow) * 25);
  breakdown.push({
    category: "nutrition_history",
    label: "Nutrition History",
    score: Math.min(nutritionScore, 25),
    maxScore: 25,
    detail: `${input.nutritionDaysWithData}/${nutritionWindow} days with meal data`,
  });
  if (input.nutritionDaysWithData < nutritionWindow * 0.7) {
    recommendations.push(`Log meals more consistently (${input.nutritionDaysWithData}/${nutritionWindow} days tracked)`);
  }

  // 6. Document evidence (10 pts)
  let docScore = 0;
  const hasDEXA = (input.documentsByType["DEXA"] ?? 0) >= 1;
  const hasBloodwork = (input.documentsByType["BLOODWORK"] ?? 0) >= 1;
  const hasCGM = (input.documentsByType["CGM"] ?? 0) >= 1;
  if (hasDEXA) docScore += 3;
  if (hasBloodwork) docScore += 4;
  if (hasCGM) docScore += 3;
  breakdown.push({
    category: "document_evidence",
    label: "Document Evidence",
    score: docScore,
    maxScore: 10,
    detail: [
      hasDEXA ? "DEXA ✓" : "DEXA ✗",
      hasBloodwork ? "Bloodwork ✓" : "Bloodwork ✗",
      hasCGM ? "CGM ✓" : "CGM ✗",
    ].join(", "),
  });
  if (!hasDEXA) recommendations.push("Upload a DEXA scan for body composition validation");
  if (!hasBloodwork) recommendations.push("Upload bloodwork results for metabolic markers");
  if (!hasCGM) recommendations.push("Upload CGM data for glucose tracking");

  // Total
  const totalScore = breakdown.reduce((s, b) => s + b.score, 0);
  const maxScore = breakdown.reduce((s, b) => s + b.maxScore, 0);

  let category: DataCompletenessReport["category"];
  if (totalScore >= 80) category = "excellent";
  else if (totalScore >= 55) category = "good";
  else if (totalScore >= 30) category = "minimal";
  else category = "insufficient";

  return { totalScore, maxScore, category, breakdown, recommendations };
}
