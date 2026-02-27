import { describe, it, expect } from "vitest";
import {
  mifflinStJeor,
  harrisBenedict,
  estimateBMR,
  estimateTDEE,
  computeTDEE,
  computeCaloricBalance,
  recommendMacroTargets,
  computeAge,
} from "./tdee-engine.js";

describe("mifflinStJeor", () => {
  it("calculates BMR for male", () => {
    // 10*80 + 6.25*175 - 5*30 + 5 = 800 + 1093.75 - 150 + 5 = 1748.75 → 1749
    const bmr = mifflinStJeor(80, 175, 30, "male");
    expect(bmr).toBe(1749);
  });

  it("calculates BMR for female", () => {
    // 10*60 + 6.25*165 - 5*25 - 161 = 600 + 1031.25 - 125 - 161 = 1345.25 → 1345
    const bmr = mifflinStJeor(60, 165, 25, "female");
    expect(bmr).toBe(1345);
  });
});

describe("harrisBenedict", () => {
  it("calculates BMR for male", () => {
    const bmr = harrisBenedict(80, 175, 30, "male");
    expect(bmr).toBeGreaterThan(1500);
    expect(bmr).toBeLessThan(2200);
  });

  it("calculates BMR for female", () => {
    const bmr = harrisBenedict(60, 165, 25, "female");
    expect(bmr).toBeGreaterThan(1200);
    expect(bmr).toBeLessThan(1800);
  });
});

describe("estimateBMR", () => {
  it("defaults to mifflin method", () => {
    const bmr = estimateBMR({ weightKg: 80, heightCm: 175, ageYears: 30, sex: "male" });
    expect(bmr).toBe(mifflinStJeor(80, 175, 30, "male"));
  });

  it("uses harris method when specified", () => {
    const bmr = estimateBMR({ weightKg: 80, heightCm: 175, ageYears: 30, sex: "male", method: "harris" });
    expect(bmr).toBe(harrisBenedict(80, 175, 30, "male"));
  });

  it("returns 0 for invalid inputs", () => {
    expect(estimateBMR({ weightKg: 0, heightCm: 175, ageYears: 30, sex: "male" })).toBe(0);
    expect(estimateBMR({ weightKg: 80, heightCm: -1, ageYears: 30, sex: "male" })).toBe(0);
  });
});

describe("estimateTDEE", () => {
  it("applies activity multiplier", () => {
    const bmr = 1800;
    expect(estimateTDEE(bmr, "sedentary")).toBe(Math.round(1800 * 1.2));
    expect(estimateTDEE(bmr, "moderate")).toBe(Math.round(1800 * 1.55));
    expect(estimateTDEE(bmr, "very_active")).toBe(Math.round(1800 * 1.9));
  });
});

describe("computeTDEE", () => {
  it("returns full result object", () => {
    const result = computeTDEE({ weightKg: 80, heightCm: 175, ageYears: 30, sex: "male" }, "moderate");
    expect(result.bmr).toBeGreaterThan(0);
    expect(result.tdee).toBeGreaterThan(result.bmr);
    expect(result.method).toBe("mifflin");
    expect(result.activityLevel).toBe("moderate");
    expect(result.activityMultiplier).toBe(1.55);
  });
});

describe("computeCaloricBalance", () => {
  it("detects surplus", () => {
    const result = computeCaloricBalance(2000, 2500);
    expect(result.status).toBe("surplus");
    expect(result.balance).toBe(500);
  });

  it("detects deficit", () => {
    const result = computeCaloricBalance(2000, 1500);
    expect(result.status).toBe("deficit");
    expect(result.balance).toBe(-500);
  });

  it("detects maintenance within threshold", () => {
    const result = computeCaloricBalance(2000, 2050);
    expect(result.status).toBe("maintenance");
  });
});

describe("recommendMacroTargets", () => {
  it("recommends cut targets", () => {
    const targets = recommendMacroTargets({ tdee: 2500, goal: "cut", weightKg: 80 });
    expect(targets.kcal).toBe(2000);
    expect(targets.proteinG).toBe(176); // 80 * 2.2
    expect(targets.fatG).toBe(56); // (2000 * 0.25) / 9
    expect(targets.carbG).toBeGreaterThan(0);
    expect(targets.goal).toBe("cut");
  });

  it("recommends maintenance targets", () => {
    const targets = recommendMacroTargets({ tdee: 2200, goal: "maintain", weightKg: 70 });
    expect(targets.kcal).toBe(2200);
    expect(targets.proteinG).toBe(126); // 70 * 1.8
  });

  it("recommends bulk targets", () => {
    const targets = recommendMacroTargets({ tdee: 2500, goal: "bulk", weightKg: 75 });
    expect(targets.kcal).toBe(2800);
    expect(targets.proteinG).toBe(150); // 75 * 2.0
  });

  it("enforces minimum 1200 kcal", () => {
    const targets = recommendMacroTargets({ tdee: 1400, goal: "cut", weightKg: 50 });
    expect(targets.kcal).toBe(1200);
  });

  it("macro calories approximately match target kcal", () => {
    const targets = recommendMacroTargets({ tdee: 2500, goal: "maintain", weightKg: 80 });
    const macroKcal = targets.proteinG * 4 + targets.carbG * 4 + targets.fatG * 9;
    expect(Math.abs(macroKcal - targets.kcal)).toBeLessThan(10);
  });
});

describe("computeAge", () => {
  it("calculates age correctly", () => {
    const dob = new Date("1996-06-15");
    const ref = new Date("2026-02-27");
    expect(computeAge(dob, ref)).toBe(29);
  });

  it("accounts for birthday not yet passed", () => {
    const dob = new Date("1996-03-15");
    const ref = new Date("2026-02-27");
    expect(computeAge(dob, ref)).toBe(29);
  });

  it("accounts for birthday already passed", () => {
    const dob = new Date("1996-01-15");
    const ref = new Date("2026-02-27");
    expect(computeAge(dob, ref)).toBe(30);
  });
});
