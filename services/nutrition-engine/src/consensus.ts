import type { NutrientKey } from "@nutrition/contracts";

export type NutrientSource = {
  sourceId: string;
  sourceType:
    | "MANUFACTURER_LABEL"
    | "USDA_BRANDED"
    | "USDA_FOUNDATION"
    | "USDA_SR_LEGACY"
    | "OPENFOODFACTS"
    | "INFERRED";
  nutrients: Partial<Record<NutrientKey, number>>;
  baseConfidence: number; // 0-1, how much we trust this source inherently
};

export type NutrientConsensusDetail = {
  selectedValue: number;
  selectedSourceId: string;
  sourceValues: Array<{ sourceId: string; value: number }>;
  coefficient_of_variation: number; // CV = stddev/mean, 0 = perfect agreement
  agreementScore: number; // 1 - CV, clamped to [0, 1]
};

export type ConsensusResult = {
  /** The best-estimate nutrient values */
  consensusValues: Partial<Record<NutrientKey, number>>;
  /** Overall confidence score 0-1 */
  overallConfidence: number;
  /** Per-nutrient details */
  nutrientDetails: Partial<Record<NutrientKey, NutrientConsensusDetail>>;
  /** Nutrients where sources disagree by >15% — flag for human review */
  divergentNutrients: NutrientKey[];
  /** Which source was selected as primary */
  primarySourceId: string;
};

/**
 * Returns the priority rank for a source type.
 * Lower values = higher priority (more trust).
 */
function sourceTypePriority(
  sourceType: NutrientSource["sourceType"]
): number {
  const priorityMap: Record<NutrientSource["sourceType"], number> = {
    MANUFACTURER_LABEL: 0,
    USDA_FOUNDATION: 1,
    USDA_SR_LEGACY: 2,
    USDA_BRANDED: 3,
    OPENFOODFACTS: 4,
    INFERRED: 5,
  };
  return priorityMap[sourceType];
}

/**
 * Computes the coefficient of variation (CV = stddev / mean).
 * CV = 0 means perfect agreement, CV > 0.15 indicates >15% disagreement.
 */
function computeCV(values: number[]): number {
  if (values.length <= 1) {
    return 0;
  }

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;

  // Avoid division by zero
  if (mean === 0) {
    return 0;
  }

  const squaredDiffs = values.map((v) => (v - mean) ** 2);
  const variance = squaredDiffs.reduce((sum, sq) => sum + sq, 0) / values.length;
  const stddev = Math.sqrt(variance);

  return stddev / mean;
}

/**
 * Computes a weighted average of values.
 */
function weightedAverage(
  values: Array<{ value: number; weight: number }>
): number {
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);

  if (totalWeight === 0) {
    return 0;
  }

  const weightedSum = values.reduce(
    (sum, item) => sum + item.value * item.weight,
    0
  );

  return weightedSum / totalWeight;
}

/**
 * Computes consensus nutrient values from multiple sources.
 *
 * Strategy:
 * 1. For each nutrient, collect all available source values
 * 2. If only one source: use it
 * 3. If multiple sources:
 *    - Compute CV (coefficient of variation)
 *    - If CV <= 0.15: use weighted average
 *    - If CV > 0.15: use highest-priority source, flag as divergent
 * 4. Return consensus values, confidence scores, and divergent nutrients
 */
export function computeConsensus(sources: NutrientSource[]): ConsensusResult {
  const nutrientDetails: Partial<Record<NutrientKey, NutrientConsensusDetail>> =
    {};
  const divergentNutrients: NutrientKey[] = [];
  const consensusValues: Partial<Record<NutrientKey, number>> = {};

  // Collect all unique nutrient keys across all sources
  const allNutrientKeys = new Set<NutrientKey>();
  for (const source of sources) {
    for (const key of Object.keys(source.nutrients) as NutrientKey[]) {
      allNutrientKeys.add(key);
    }
  }

  // Process each nutrient key
  for (const nutrientKey of allNutrientKeys) {
    // Collect values from sources that have this nutrient
    const sourceValuesWithId = sources
      .map((source) => ({
        sourceId: source.sourceId,
        sourceType: source.sourceType,
        value: source.nutrients[nutrientKey],
        baseConfidence: source.baseConfidence,
        priority: sourceTypePriority(source.sourceType),
      }))
      .filter((item) => item.value !== undefined) as Array<{
      sourceId: string;
      sourceType: NutrientSource["sourceType"];
      value: number;
      baseConfidence: number;
      priority: number;
    }>;

    if (sourceValuesWithId.length === 0) {
      continue; // No values for this nutrient
    }

    // Sort by priority (lower priority value = higher priority)
    const sortedByPriority = [...sourceValuesWithId].sort(
      (a, b) => a.priority - b.priority
    );

    let selectedValue: number;
    let selectedSourceId: string;
    let agreementScore: number;

    if (sourceValuesWithId.length === 1) {
      // Only one source: use it
      const only = sourceValuesWithId[0] as (typeof sourceValuesWithId)[0];
      selectedValue = only.value;
      selectedSourceId = only.sourceId;
      agreementScore = only.baseConfidence;
    } else {
      // Multiple sources: check agreement
      const values = sourceValuesWithId.map((item) => item.value);
      const cv = computeCV(values);

      if (cv <= 0.15) {
        // Sources agree within 15%: use weighted average
        const weighted = weightedAverage(
          sourceValuesWithId.map((item) => ({
            value: item.value,
            weight: item.baseConfidence,
          }))
        );
        selectedValue = weighted;
        selectedSourceId = sortedByPriority[0]!.sourceId;
        agreementScore = Math.max(0, 1 - cv);
      } else {
        // Sources disagree >15%: use highest-priority source
        const highest = sortedByPriority[0]!;
        selectedValue = highest.value;
        selectedSourceId = highest.sourceId;
        agreementScore = Math.max(0, 1 - cv);
        divergentNutrients.push(nutrientKey);
      }
    }

    consensusValues[nutrientKey] = selectedValue;

    nutrientDetails[nutrientKey] = {
      selectedValue,
      selectedSourceId,
      sourceValues: sourceValuesWithId.map((item) => ({
        sourceId: item.sourceId,
        value: item.value,
      })),
      coefficient_of_variation: computeCV(
        sourceValuesWithId.map((item) => item.value)
      ),
      agreementScore,
    };
  }

  // Compute overall confidence: average of all nutrient agreement scores
  const agreementScores = Object.values(nutrientDetails)
    .map((detail) => detail?.agreementScore ?? 0)
    .filter((score) => score !== undefined);

  const overallConfidence =
    agreementScores.length > 0
      ? agreementScores.reduce((sum, score) => sum + score, 0) /
        agreementScores.length
      : 0;

  // Determine primary source: highest-priority source with most nutrients
  let primarySourceId = sources[0]?.sourceId ?? "unknown";

  if (sources.length > 0) {
    const sourceBitmap = new Map<
      string,
      { priority: number; nutrientCount: number }
    >();

    for (const source of sources) {
      const nutrientCount = Object.values(source.nutrients).filter(
        (v) => v !== undefined
      ).length;
      sourceBitmap.set(source.sourceId, {
        priority: sourceTypePriority(source.sourceType),
        nutrientCount,
      });
    }

    let bestSourceId = sources[0]!.sourceId;
    let bestPriority = sourceTypePriority(sources[0]!.sourceType);
    let bestNutrientCount = Object.values(sources[0]!.nutrients).filter(
      (v) => v !== undefined
    ).length;

    for (const [sourceId, { priority, nutrientCount }] of sourceBitmap) {
      // Higher priority (lower value) wins; ties go to more nutrients
      if (
        priority < bestPriority ||
        (priority === bestPriority && nutrientCount > bestNutrientCount)
      ) {
        bestSourceId = sourceId;
        bestPriority = priority;
        bestNutrientCount = nutrientCount;
      }
    }

    primarySourceId = bestSourceId;
  }

  return {
    consensusValues,
    overallConfidence,
    nutrientDetails,
    divergentNutrients,
    primarySourceId,
  };
}
