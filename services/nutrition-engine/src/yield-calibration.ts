/**
 * Yield Calibration Engine
 *
 * Analyzes batch yield history to propose calibrated yield factors.
 * Handles outlier detection, confidence scoring, and default/calibrated selection.
 */

export interface YieldSample {
  batchId: string;
  expectedYieldPct: number;
  actualYieldPct: number;
  variancePct: number;
  method?: string;
  cutForm?: string;
  createdAt: string;
}

export interface CalibrationProposal {
  componentId: string;
  componentName: string;
  method?: string;
  cutForm?: string;
  currentDefaultYieldPct: number;
  proposedYieldPct: number;
  confidence: number;
  sampleCount: number;
  meanActualYieldPct: number;
  stdDevPct: number;
  outlierCount: number;
  samples: YieldSample[];
  nonOutlierSamples: YieldSample[];
  basis: "calibrated" | "default";
  reason: string;
}

export interface CheckpointGate {
  batchStatus: string;
  requiredCheckpoints: string[];
  optionalCheckpoints: string[];
}

// Outlier detection threshold: > 2 standard deviations from mean
const OUTLIER_SIGMA = 2;
// Minimum samples required for a confident calibration
const MIN_SAMPLES_FOR_CONFIDENCE = 3;
// Minimum confidence to prefer calibrated over default
const MIN_CONFIDENCE_THRESHOLD = 0.6;

/**
 * Compute mean of an array
 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Compute standard deviation
 */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Detect outliers using z-score method
 */
export function detectOutliers(
  samples: YieldSample[]
): { outliers: YieldSample[]; clean: YieldSample[] } {
  if (samples.length < 3) return { outliers: [], clean: samples };

  const values = samples.map((s) => s.actualYieldPct);
  const m = mean(values);
  const sd = stdDev(values);

  if (sd === 0) return { outliers: [], clean: samples };

  const outliers: YieldSample[] = [];
  const clean: YieldSample[] = [];

  for (const s of samples) {
    const z = Math.abs((s.actualYieldPct - m) / sd);
    if (z > OUTLIER_SIGMA) {
      outliers.push(s);
    } else {
      clean.push(s);
    }
  }

  return { outliers, clean };
}

/**
 * Compute confidence score for a calibration proposal (0-1)
 * Based on: sample count, standard deviation, recency
 */
export function computeConfidence(
  cleanSamples: YieldSample[],
  sd: number
): number {
  if (cleanSamples.length === 0) return 0;

  // Sample count factor: ramps from 0.3 (1 sample) to 1.0 (5+ samples)
  const sampleFactor = Math.min(1, 0.3 + (cleanSamples.length - 1) * 0.175);

  // Consistency factor: lower std dev = higher confidence
  // Maps 0% std dev → 1.0, 15%+ std dev → 0.3
  const consistencyFactor = Math.max(0.3, 1 - sd / 15);

  return Math.round(sampleFactor * consistencyFactor * 100) / 100;
}

/**
 * Generate a calibration proposal from yield history
 */
export function generateCalibrationProposal(
  componentId: string,
  componentName: string,
  currentDefaultYieldPct: number,
  samples: YieldSample[],
  method?: string,
  cutForm?: string
): CalibrationProposal {
  if (samples.length === 0) {
    return {
      componentId,
      componentName,
      method,
      cutForm,
      currentDefaultYieldPct,
      proposedYieldPct: currentDefaultYieldPct,
      confidence: 0,
      sampleCount: 0,
      meanActualYieldPct: 0,
      stdDevPct: 0,
      outlierCount: 0,
      samples,
      nonOutlierSamples: [],
      basis: "default",
      reason: "No yield data available",
    };
  }

  const { outliers, clean } = detectOutliers(samples);
  const cleanValues = clean.map((s) => s.actualYieldPct);
  const m = mean(cleanValues);
  const sd = stdDev(cleanValues);
  const confidence = computeConfidence(clean, sd);

  const useCalibrated = confidence >= MIN_CONFIDENCE_THRESHOLD && clean.length >= MIN_SAMPLES_FOR_CONFIDENCE;

  return {
    componentId,
    componentName,
    method,
    cutForm,
    currentDefaultYieldPct,
    proposedYieldPct: useCalibrated ? Math.round(m * 100) / 100 : currentDefaultYieldPct,
    confidence,
    sampleCount: samples.length,
    meanActualYieldPct: Math.round(m * 100) / 100,
    stdDevPct: Math.round(sd * 100) / 100,
    outlierCount: outliers.length,
    samples,
    nonOutlierSamples: clean,
    basis: useCalibrated ? "calibrated" : "default",
    reason: useCalibrated
      ? `Calibrated from ${clean.length} samples (mean ${m.toFixed(1)}%, stddev ${sd.toFixed(1)}%)`
      : confidence < MIN_CONFIDENCE_THRESHOLD
        ? `Confidence too low (${(confidence * 100).toFixed(0)}%) — using default`
        : `Insufficient samples (${clean.length}/${MIN_SAMPLES_FOR_CONFIDENCE} required) — using default`,
  };
}

/**
 * Select yield factor: prefer calibrated if available and confident
 */
export function selectYieldFactor(
  defaultYieldPct: number,
  calibratedYieldPct: number | null,
  calibrationConfidence: number
): { yieldPct: number; basis: "calibrated" | "default"; explanation: string } {
  if (
    calibratedYieldPct !== null &&
    calibrationConfidence >= MIN_CONFIDENCE_THRESHOLD
  ) {
    return {
      yieldPct: calibratedYieldPct,
      basis: "calibrated",
      explanation: `Using calibrated yield (${calibratedYieldPct.toFixed(1)}%, confidence ${(calibrationConfidence * 100).toFixed(0)}%)`,
    };
  }
  return {
    yieldPct: defaultYieldPct,
    basis: "default",
    explanation: calibratedYieldPct !== null
      ? `Using default yield (calibration confidence too low: ${(calibrationConfidence * 100).toFixed(0)}%)`
      : "Using default yield (no calibration data)",
  };
}

/**
 * Classify yield variance severity
 */
export function classifyVariance(variancePct: number): "normal" | "warning" | "critical" {
  const abs = Math.abs(variancePct);
  if (abs > 30) return "critical";
  if (abs > 15) return "warning";
  return "normal";
}

/**
 * Checkpoint gating rules: required checkpoints before status transitions
 */
export const CHECKPOINT_GATES: Record<string, CheckpointGate> = {
  IN_PREP: {
    batchStatus: "IN_PREP",
    requiredCheckpoints: ["PREP_START"],
    optionalCheckpoints: [],
  },
  COOKING: {
    batchStatus: "COOKING",
    requiredCheckpoints: ["COOK_START"],
    optionalCheckpoints: ["TEMP_CHECK"],
  },
  CHILLING: {
    batchStatus: "CHILLING",
    requiredCheckpoints: ["COOK_END", "CHILL_START"],
    optionalCheckpoints: ["TEMP_CHECK"],
  },
  PORTIONED: {
    batchStatus: "PORTIONED",
    requiredCheckpoints: ["CHILL_END"],
    optionalCheckpoints: ["CHILL_TEMP_CHECK"],
  },
  READY: {
    batchStatus: "READY",
    requiredCheckpoints: ["PORTION_END"],
    optionalCheckpoints: ["READY_CHECK"],
  },
};

/**
 * Validate checkpoint requirements for a batch status transition
 */
export function validateCheckpointGate(
  targetStatus: string,
  existingCheckpointTypes: string[]
): { valid: boolean; missing: string[]; warnings: string[] } {
  const gate = CHECKPOINT_GATES[targetStatus];
  if (!gate) return { valid: true, missing: [], warnings: [] };

  const existingSet = new Set(existingCheckpointTypes);
  const missing = gate.requiredCheckpoints.filter((c) => !existingSet.has(c));
  const missingOptional = gate.optionalCheckpoints.filter((c) => !existingSet.has(c));

  return {
    valid: missing.length === 0,
    missing,
    warnings: missingOptional.map((c) => `Optional checkpoint ${c} not recorded`),
  };
}
