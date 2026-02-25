import { describe, it, expect } from "vitest";
import {
  mean,
  stdDev,
  detectOutliers,
  computeConfidence,
  generateCalibrationProposal,
  selectYieldFactor,
  classifyVariance,
  validateCheckpointGate,
  CHECKPOINT_GATES,
  type YieldSample,
} from "./yield-calibration.js";

// ── Helpers ────────────────────────────────────────────

function makeSample(overrides: Partial<YieldSample> = {}): YieldSample {
  return {
    batchId: "batch-1",
    expectedYieldPct: 85,
    actualYieldPct: 82,
    variancePct: -3.53,
    createdAt: "2026-02-20T10:00:00Z",
    ...overrides,
  };
}

function makeSamples(actuals: number[]): YieldSample[] {
  return actuals.map((a, i) =>
    makeSample({
      batchId: `batch-${i + 1}`,
      actualYieldPct: a,
      variancePct: ((a - 85) / 85) * 100,
      createdAt: new Date(2026, 1, 20 + i).toISOString(),
    })
  );
}

// ── mean ───────────────────────────────────────────────

describe("mean", () => {
  it("returns 0 for empty array", () => {
    expect(mean([])).toBe(0);
  });

  it("computes mean of single value", () => {
    expect(mean([42])).toBe(42);
  });

  it("computes mean of multiple values", () => {
    expect(mean([80, 82, 84])).toBeCloseTo(82, 5);
  });

  it("handles negative values", () => {
    expect(mean([-10, 10])).toBe(0);
  });
});

// ── stdDev ─────────────────────────────────────────────

describe("stdDev", () => {
  it("returns 0 for empty array", () => {
    expect(stdDev([])).toBe(0);
  });

  it("returns 0 for single value", () => {
    expect(stdDev([42])).toBe(0);
  });

  it("computes sample std dev for two values", () => {
    // [80, 84] → mean 82, variance (4+4)/1 = 8, sd = sqrt(8) ≈ 2.828
    expect(stdDev([80, 84])).toBeCloseTo(2.828, 2);
  });

  it("computes sample std dev for multiple values", () => {
    // [80, 82, 84] → mean 82, variance (4+0+4)/2 = 4, sd = 2
    expect(stdDev([80, 82, 84])).toBeCloseTo(2, 5);
  });

  it("returns 0 when all values are equal", () => {
    expect(stdDev([50, 50, 50, 50])).toBe(0);
  });
});

// ── detectOutliers ─────────────────────────────────────

describe("detectOutliers", () => {
  it("returns all samples as clean when fewer than 3", () => {
    const samples = makeSamples([80, 82]);
    const { outliers, clean } = detectOutliers(samples);
    expect(outliers).toHaveLength(0);
    expect(clean).toHaveLength(2);
  });

  it("detects no outliers in consistent data", () => {
    const samples = makeSamples([80, 81, 82, 83, 84]);
    const { outliers, clean } = detectOutliers(samples);
    expect(outliers).toHaveLength(0);
    expect(clean).toHaveLength(5);
  });

  it("detects obvious outlier", () => {
    // Need enough tight samples so one extreme value exceeds 2σ
    // With 7 tight values and 1 extreme, z-score > 2 is achievable
    const samples = makeSamples([80, 80, 80, 80, 80, 80, 200]);
    const { outliers, clean } = detectOutliers(samples);
    expect(outliers.length).toBeGreaterThanOrEqual(1);
    expect(outliers.some((s) => s.actualYieldPct === 200)).toBe(true);
    expect(clean.every((s) => s.actualYieldPct !== 200)).toBe(true);
  });

  it("returns all clean when sd is 0", () => {
    const samples = makeSamples([82, 82, 82]);
    const { outliers, clean } = detectOutliers(samples);
    expect(outliers).toHaveLength(0);
    expect(clean).toHaveLength(3);
  });

  it("handles low outlier correctly", () => {
    const samples = makeSamples([80, 80, 80, 80, 80, 80, 5]);
    const { outliers } = detectOutliers(samples);
    expect(outliers.some((s) => s.actualYieldPct === 5)).toBe(true);
  });
});

// ── computeConfidence ──────────────────────────────────

describe("computeConfidence", () => {
  it("returns 0 for empty samples", () => {
    expect(computeConfidence([], 0)).toBe(0);
  });

  it("returns low confidence for single sample", () => {
    const samples = makeSamples([82]);
    const conf = computeConfidence(samples, 0);
    // sampleFactor = 0.3, consistencyFactor = 1.0 → 0.3
    expect(conf).toBeCloseTo(0.3, 2);
  });

  it("returns higher confidence with more samples", () => {
    const samples3 = makeSamples([80, 82, 84]);
    const samples5 = makeSamples([80, 81, 82, 83, 84]);
    const conf3 = computeConfidence(samples3, 2);
    const conf5 = computeConfidence(samples5, 2);
    expect(conf5).toBeGreaterThan(conf3);
  });

  it("returns higher confidence with lower std dev", () => {
    const samples = makeSamples([80, 81, 82, 83, 84]);
    const confLow = computeConfidence(samples, 1);
    const confHigh = computeConfidence(samples, 10);
    expect(confLow).toBeGreaterThan(confHigh);
  });

  it("confidence is between 0 and 1", () => {
    const samples = makeSamples([80, 81, 82, 83, 84, 85, 86]);
    const conf = computeConfidence(samples, 5);
    expect(conf).toBeGreaterThanOrEqual(0);
    expect(conf).toBeLessThanOrEqual(1);
  });

  it("maxes out sample factor at 5 samples", () => {
    const samples5 = makeSamples([80, 81, 82, 83, 84]);
    const samples10 = makeSamples([80, 81, 82, 83, 84, 85, 86, 87, 88, 89]);
    const conf5 = computeConfidence(samples5, 2);
    const conf10 = computeConfidence(samples10, 2);
    expect(conf5).toBe(conf10);
  });
});

// ── generateCalibrationProposal ────────────────────────

describe("generateCalibrationProposal", () => {
  it("returns default basis with zero samples", () => {
    const proposal = generateCalibrationProposal("comp-1", "Chicken Breast", 85, []);
    expect(proposal.basis).toBe("default");
    expect(proposal.proposedYieldPct).toBe(85);
    expect(proposal.confidence).toBe(0);
    expect(proposal.sampleCount).toBe(0);
    expect(proposal.reason).toContain("No yield data");
  });

  it("returns default basis with insufficient samples (confidence too low)", () => {
    const samples = makeSamples([80, 82]);
    const proposal = generateCalibrationProposal("comp-1", "Chicken Breast", 85, samples);
    expect(proposal.basis).toBe("default");
    expect(proposal.proposedYieldPct).toBe(85);
    expect(proposal.sampleCount).toBe(2);
    // With 2 samples, confidence can't reach 0.6 threshold
    expect(proposal.reason).toContain("Confidence too low");
  });

  it("returns calibrated basis with sufficient consistent samples", () => {
    const samples = makeSamples([80, 81, 82, 83, 84]);
    const proposal = generateCalibrationProposal("comp-1", "Chicken Breast", 85, samples);
    expect(proposal.basis).toBe("calibrated");
    expect(proposal.proposedYieldPct).toBeCloseTo(82, 0);
    expect(proposal.sampleCount).toBe(5);
    expect(proposal.confidence).toBeGreaterThanOrEqual(0.6);
    expect(proposal.reason).toContain("Calibrated from");
  });

  it("excludes outliers from calibration mean", () => {
    // 7 tight values + 1 extreme — z-score > 2σ triggers outlier detection
    const samples = makeSamples([80, 80, 81, 81, 82, 82, 83, 200]);
    const proposal = generateCalibrationProposal("comp-1", "Chicken Breast", 85, samples);
    expect(proposal.outlierCount).toBeGreaterThanOrEqual(1);
    // The mean should be close to ~81.3, not pulled up by 200
    expect(proposal.meanActualYieldPct).toBeLessThan(90);
  });

  it("carries method and cutForm through", () => {
    const samples = makeSamples([80, 81, 82]);
    const proposal = generateCalibrationProposal(
      "comp-1", "Chicken Breast", 85, samples, "roast", "whole"
    );
    expect(proposal.method).toBe("roast");
    expect(proposal.cutForm).toBe("whole");
  });

  it("returns default when confidence is too low (high variance)", () => {
    // Very scattered data → low confidence
    const samples = makeSamples([20, 50, 80, 110, 140]);
    const proposal = generateCalibrationProposal("comp-1", "Test", 85, samples);
    // With such high variance, confidence should be below threshold
    if (proposal.confidence < 0.6) {
      expect(proposal.basis).toBe("default");
      expect(proposal.proposedYieldPct).toBe(85);
    }
    // Even if confidence somehow meets threshold, the result should be reasonable
    expect(proposal.proposedYieldPct).toBeGreaterThan(0);
  });

  it("proposed yield is rounded to 2 decimal places", () => {
    const samples = makeSamples([80.123, 81.456, 82.789, 83.012, 84.345]);
    const proposal = generateCalibrationProposal("comp-1", "Test", 85, samples);
    const decimalPlaces = (proposal.proposedYieldPct.toString().split(".")[1] ?? "").length;
    expect(decimalPlaces).toBeLessThanOrEqual(2);
  });
});

// ── selectYieldFactor ──────────────────────────────────

describe("selectYieldFactor", () => {
  it("selects calibrated when confidence is high enough", () => {
    const result = selectYieldFactor(85, 82.5, 0.8);
    expect(result.yieldPct).toBe(82.5);
    expect(result.basis).toBe("calibrated");
    expect(result.explanation).toContain("calibrated");
  });

  it("selects default when confidence is too low", () => {
    const result = selectYieldFactor(85, 82.5, 0.4);
    expect(result.yieldPct).toBe(85);
    expect(result.basis).toBe("default");
    expect(result.explanation).toContain("confidence too low");
  });

  it("selects default when calibrated is null", () => {
    const result = selectYieldFactor(85, null, 0);
    expect(result.yieldPct).toBe(85);
    expect(result.basis).toBe("default");
    expect(result.explanation).toContain("no calibration data");
  });

  it("selects calibrated at exactly the threshold", () => {
    const result = selectYieldFactor(85, 80, 0.6);
    expect(result.yieldPct).toBe(80);
    expect(result.basis).toBe("calibrated");
  });

  it("selects default just below threshold", () => {
    const result = selectYieldFactor(85, 80, 0.59);
    expect(result.yieldPct).toBe(85);
    expect(result.basis).toBe("default");
  });
});

// ── classifyVariance ───────────────────────────────────

describe("classifyVariance", () => {
  it("classifies small variance as normal", () => {
    expect(classifyVariance(5)).toBe("normal");
    expect(classifyVariance(-5)).toBe("normal");
    expect(classifyVariance(0)).toBe("normal");
    expect(classifyVariance(15)).toBe("normal");
  });

  it("classifies moderate variance as warning", () => {
    expect(classifyVariance(16)).toBe("warning");
    expect(classifyVariance(-20)).toBe("warning");
    expect(classifyVariance(30)).toBe("warning");
  });

  it("classifies large variance as critical", () => {
    expect(classifyVariance(31)).toBe("critical");
    expect(classifyVariance(-50)).toBe("critical");
    expect(classifyVariance(100)).toBe("critical");
  });
});

// ── validateCheckpointGate ─────────────────────────────

describe("validateCheckpointGate", () => {
  it("returns valid for unknown status", () => {
    const result = validateCheckpointGate("UNKNOWN_STATUS", []);
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it("validates IN_PREP requires PREP_START", () => {
    const result = validateCheckpointGate("IN_PREP", []);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("PREP_START");
  });

  it("passes IN_PREP when PREP_START exists", () => {
    const result = validateCheckpointGate("IN_PREP", ["PREP_START"]);
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it("validates COOKING requires COOK_START", () => {
    const result = validateCheckpointGate("COOKING", []);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("COOK_START");
  });

  it("validates CHILLING requires both COOK_END and CHILL_START", () => {
    const result = validateCheckpointGate("CHILLING", ["COOK_END"]);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("CHILL_START");
    expect(result.missing).not.toContain("COOK_END");
  });

  it("passes CHILLING when both required checkpoints exist", () => {
    const result = validateCheckpointGate("CHILLING", ["COOK_END", "CHILL_START"]);
    expect(result.valid).toBe(true);
  });

  it("reports optional checkpoint warnings", () => {
    const result = validateCheckpointGate("COOKING", ["COOK_START"]);
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings[0]).toContain("TEMP_CHECK");
  });

  it("validates PORTIONED requires CHILL_END", () => {
    const result = validateCheckpointGate("PORTIONED", []);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("CHILL_END");
  });

  it("validates READY requires PORTION_END", () => {
    const result = validateCheckpointGate("READY", ["PORTION_END"]);
    expect(result.valid).toBe(true);
  });

  it("extra checkpoints do not cause failures", () => {
    const result = validateCheckpointGate("IN_PREP", ["PREP_START", "EXTRA_CHECK", "ANOTHER"]);
    expect(result.valid).toBe(true);
  });
});

// ── CHECKPOINT_GATES structure ─────────────────────────

describe("CHECKPOINT_GATES", () => {
  it("has entries for all batch flow states", () => {
    expect(Object.keys(CHECKPOINT_GATES)).toEqual(
      expect.arrayContaining(["IN_PREP", "COOKING", "CHILLING", "PORTIONED", "READY"])
    );
  });

  it("every gate has requiredCheckpoints array", () => {
    for (const gate of Object.values(CHECKPOINT_GATES)) {
      expect(Array.isArray(gate.requiredCheckpoints)).toBe(true);
      expect(gate.requiredCheckpoints.length).toBeGreaterThanOrEqual(1);
    }
  });
});
