/**
 * Reproducibility / Debug Engine
 *
 * Non-destructive diff and integrity checking for label snapshots.
 * Compares frozen snapshot data against current computed results.
 * Pure math — no DB dependency, no mutation.
 */

export interface NutrientSnapshot {
  [key: string]: number;
}

export interface SnapshotData {
  labelId: string;
  frozenAt: string;
  skuName: string;
  recipeName: string;
  servings: number;
  servingWeightG: number;
  perServing: NutrientSnapshot;
  provisional: boolean;
  reasonCodes: string[];
  evidenceSummary: {
    verifiedCount: number;
    inferredCount: number;
    exceptionCount: number;
    totalNutrientRows: number;
    sourceRefs: string[];
    gradeBreakdown: Record<string, number>;
  };
}

export interface RecomputedData {
  perServing: NutrientSnapshot;
  servingWeightG: number;
  provisional: boolean;
  reasonCodes: string[];
  evidenceSummary: {
    verifiedCount: number;
    inferredCount: number;
    exceptionCount: number;
    totalNutrientRows: number;
    sourceRefs: string[];
    gradeBreakdown: Record<string, number>;
  };
}

export interface NutrientDelta {
  nutrientKey: string;
  frozenValue: number;
  currentValue: number;
  absoluteDelta: number;
  percentDelta: number | null;
  significant: boolean;
}

export type DeltaCategory =
  | "nutrient_value_change"
  | "source_change"
  | "evidence_grade_change"
  | "reason_code_change"
  | "serving_weight_change"
  | "provisional_status_change";

export interface DeltaExplanation {
  category: DeltaCategory;
  description: string;
  severity: "info" | "warning" | "critical";
}

export interface RecomputeDiff {
  labelId: string;
  frozenAt: string;
  hasDifferences: boolean;
  nutrientDeltas: NutrientDelta[];
  significantDeltas: NutrientDelta[];
  explanations: DeltaExplanation[];
  integrityChecks: IntegrityCheck[];
  summary: string;
}

export interface IntegrityCheck {
  check: string;
  passed: boolean;
  detail: string;
}

const SIGNIFICANT_DELTA_PCT = 5; // 5% change is significant
const SIGNIFICANT_DELTA_ABS = 1; // <1 unit absolute change is noise

/**
 * Compute nutrient-level deltas between frozen and recomputed values.
 */
export function computeNutrientDeltas(
  frozen: NutrientSnapshot,
  current: NutrientSnapshot,
): NutrientDelta[] {
  const allKeys = new Set([...Object.keys(frozen), ...Object.keys(current)]);
  const deltas: NutrientDelta[] = [];

  for (const key of allKeys) {
    const frozenValue = frozen[key] ?? 0;
    const currentValue = current[key] ?? 0;
    const absoluteDelta = Math.round((currentValue - frozenValue) * 100) / 100;
    const percentDelta = frozenValue !== 0
      ? Math.round(((currentValue - frozenValue) / Math.abs(frozenValue)) * 10000) / 100
      : null;

    const significant =
      Math.abs(absoluteDelta) >= SIGNIFICANT_DELTA_ABS &&
      (percentDelta === null || Math.abs(percentDelta) >= SIGNIFICANT_DELTA_PCT);

    deltas.push({
      nutrientKey: key,
      frozenValue: Math.round(frozenValue * 100) / 100,
      currentValue: Math.round(currentValue * 100) / 100,
      absoluteDelta,
      percentDelta,
      significant,
    });
  }

  return deltas.sort((a, b) => {
    // Significant first, then by absolute delta magnitude
    if (a.significant !== b.significant) return a.significant ? -1 : 1;
    return Math.abs(b.absoluteDelta) - Math.abs(a.absoluteDelta);
  });
}

/**
 * Generate human-readable explanations for differences.
 */
export function generateDeltaExplanations(
  snapshot: SnapshotData,
  recomputed: RecomputedData,
  nutrientDeltas: NutrientDelta[],
): DeltaExplanation[] {
  const explanations: DeltaExplanation[] = [];
  const significantDeltas = nutrientDeltas.filter((d) => d.significant);

  // Serving weight change
  if (Math.abs(snapshot.servingWeightG - recomputed.servingWeightG) > 0.1) {
    explanations.push({
      category: "serving_weight_change",
      description: `Serving weight changed from ${snapshot.servingWeightG}g to ${recomputed.servingWeightG}g`,
      severity: "warning",
    });
  }

  // Provisional status change
  if (snapshot.provisional !== recomputed.provisional) {
    explanations.push({
      category: "provisional_status_change",
      description: snapshot.provisional
        ? "Label was provisional at freeze time, now fully verified"
        : "Label was verified at freeze time, now provisional",
      severity: "warning",
    });
  }

  // Reason code changes
  const frozenCodes = new Set(snapshot.reasonCodes);
  const currentCodes = new Set(recomputed.reasonCodes);
  const addedCodes = [...currentCodes].filter((c) => !frozenCodes.has(c));
  const removedCodes = [...frozenCodes].filter((c) => !currentCodes.has(c));

  if (addedCodes.length > 0) {
    explanations.push({
      category: "reason_code_change",
      description: `New reason codes: ${addedCodes.join(", ")}`,
      severity: "warning",
    });
  }
  if (removedCodes.length > 0) {
    explanations.push({
      category: "reason_code_change",
      description: `Resolved reason codes: ${removedCodes.join(", ")}`,
      severity: "info",
    });
  }

  // Source reference changes
  const frozenSources = new Set(snapshot.evidenceSummary.sourceRefs);
  const currentSources = new Set(recomputed.evidenceSummary.sourceRefs);
  const newSources = [...currentSources].filter((s) => !frozenSources.has(s));
  if (newSources.length > 0) {
    explanations.push({
      category: "source_change",
      description: `New nutrient sources added since freeze: ${newSources.join(", ")}`,
      severity: "info",
    });
  }

  // Evidence grade changes
  const frozenGrades = snapshot.evidenceSummary.gradeBreakdown;
  const currentGrades = recomputed.evidenceSummary.gradeBreakdown;
  for (const grade of Object.keys({ ...frozenGrades, ...currentGrades })) {
    const frozenCount = frozenGrades[grade] ?? 0;
    const currentCount = currentGrades[grade] ?? 0;
    if (frozenCount !== currentCount) {
      explanations.push({
        category: "evidence_grade_change",
        description: `${grade}: ${frozenCount} → ${currentCount} nutrient rows`,
        severity: "info",
      });
    }
  }

  // Significant nutrient changes
  if (significantDeltas.length > 0) {
    const top3 = significantDeltas.slice(0, 3);
    explanations.push({
      category: "nutrient_value_change",
      description: `${significantDeltas.length} nutrient(s) changed significantly. Top changes: ${top3.map((d) => `${d.nutrientKey} (${d.absoluteDelta > 0 ? "+" : ""}${d.absoluteDelta})`).join(", ")}`,
      severity: significantDeltas.length > 5 ? "critical" : "warning",
    });
  }

  return explanations;
}

/**
 * Run integrity checks on a frozen snapshot.
 */
export function runIntegrityChecks(snapshot: SnapshotData): IntegrityCheck[] {
  const checks: IntegrityCheck[] = [];

  // Check: label has a frozen timestamp
  checks.push({
    check: "frozen_timestamp_present",
    passed: Boolean(snapshot.frozenAt),
    detail: snapshot.frozenAt
      ? `Frozen at ${snapshot.frozenAt}`
      : "Missing frozen timestamp",
  });

  // Check: serving weight is positive
  checks.push({
    check: "serving_weight_positive",
    passed: snapshot.servingWeightG > 0,
    detail: snapshot.servingWeightG > 0
      ? `${snapshot.servingWeightG}g per serving`
      : "Serving weight is zero or negative",
  });

  // Check: has nutrient data
  const nutrientCount = Object.values(snapshot.perServing).filter((v) => v > 0).length;
  checks.push({
    check: "has_nutrient_data",
    passed: nutrientCount > 0,
    detail: `${nutrientCount} nutrients with values > 0`,
  });

  // Check: core nutrients present (kcal, protein, carb, fat)
  const coreKeys = ["kcal", "protein_g", "carb_g", "fat_g"];
  const missingCore = coreKeys.filter((k) => !(k in snapshot.perServing) || snapshot.perServing[k] === 0);
  checks.push({
    check: "core_nutrients_present",
    passed: missingCore.length === 0,
    detail: missingCore.length === 0
      ? "All core nutrients present"
      : `Missing: ${missingCore.join(", ")}`,
  });

  // Check: evidence summary internally consistent
  const es = snapshot.evidenceSummary;
  const summedRows = (es.verifiedCount ?? 0) + (es.inferredCount ?? 0) + (es.exceptionCount ?? 0);
  // Note: summedRows can be less than totalNutrientRows (a row can be unverified and not inferred/exception)
  checks.push({
    check: "evidence_summary_consistent",
    passed: summedRows <= (es.totalNutrientRows ?? 0) + 1, // +1 for rounding
    detail: `Verified: ${es.verifiedCount}, Inferred: ${es.inferredCount}, Exception: ${es.exceptionCount}, Total: ${es.totalNutrientRows}`,
  });

  // Check: servings > 0
  checks.push({
    check: "servings_positive",
    passed: snapshot.servings > 0,
    detail: `${snapshot.servings} serving(s)`,
  });

  return checks;
}

/**
 * Build a complete recompute diff report.
 */
export function buildRecomputeDiff(
  snapshot: SnapshotData,
  recomputed: RecomputedData,
): RecomputeDiff {
  const nutrientDeltas = computeNutrientDeltas(snapshot.perServing, recomputed.perServing);
  const significantDeltas = nutrientDeltas.filter((d) => d.significant);
  const explanations = generateDeltaExplanations(snapshot, recomputed, nutrientDeltas);
  const integrityChecks = runIntegrityChecks(snapshot);

  const hasDifferences = significantDeltas.length > 0 ||
    snapshot.provisional !== recomputed.provisional ||
    snapshot.servingWeightG !== recomputed.servingWeightG;

  let summary: string;
  if (!hasDifferences) {
    summary = "No significant differences between frozen snapshot and current computation.";
  } else if (significantDeltas.length === 0) {
    summary = "Metadata changed (provisional status or serving weight) but nutrient values are consistent.";
  } else {
    summary = `${significantDeltas.length} nutrient(s) differ significantly. Review explanations for root cause.`;
  }

  return {
    labelId: snapshot.labelId,
    frozenAt: snapshot.frozenAt,
    hasDifferences,
    nutrientDeltas,
    significantDeltas,
    explanations,
    integrityChecks,
    summary,
  };
}
