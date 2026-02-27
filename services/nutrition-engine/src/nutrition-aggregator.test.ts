import { describe, it, expect } from "vitest";
import {
  aggregateNutritionPeriod,
  computeNutritionTrend,
  detectNutritionShifts,
  detectPhysiologyResponses,
  alignTimeSeriesData,
} from "./nutrition-aggregator.js";

function makeDay(date: string, kcal: number, p: number, c: number, f: number, meals: number) {
  return { date, kcal, proteinG: p, carbG: c, fatG: f, fiberG: 10, mealCount: meals };
}

describe("aggregateNutritionPeriod", () => {
  it("aggregates daily data into weekly rollups", () => {
    const days = [
      makeDay("2026-01-05", 2000, 150, 200, 70, 3), // Mon
      makeDay("2026-01-06", 2100, 160, 210, 75, 3),
      makeDay("2026-01-07", 1900, 140, 190, 65, 2),
      makeDay("2026-01-12", 2200, 170, 220, 80, 3), // Next Mon
      makeDay("2026-01-13", 2300, 175, 230, 85, 3),
    ];
    const result = aggregateNutritionPeriod(days, 14);

    expect(result.weeks.length).toBeGreaterThanOrEqual(2);
    expect(result.summary.periodDays).toBe(14);
    expect(result.summary.totalMeals).toBe(14);
    expect(result.summary.daysWithData).toBe(5);
    expect(result.summary.avgKcal).toBeGreaterThan(0);
  });

  it("handles empty data", () => {
    const result = aggregateNutritionPeriod([], 30);
    expect(result.weeks).toEqual([]);
    expect(result.summary.totalMeals).toBe(0);
    expect(result.summary.daysWithData).toBe(0);
    expect(result.summary.compliancePct).toBe(0);
  });

  it("computes compliance percentage", () => {
    const days = Array.from({ length: 15 }, (_, i) =>
      makeDay(`2026-01-${String(i + 1).padStart(2, "0")}`, 2000, 150, 200, 70, 3)
    );
    const result = aggregateNutritionPeriod(days, 30);
    expect(result.summary.compliancePct).toBe(50);
  });
});

describe("computeNutritionTrend", () => {
  it("detects increasing kcal trend", () => {
    const weeks = [
      { weekStart: "2026-01-05", weekEnd: "2026-01-11", avgKcal: 1800, avgProteinG: 130, avgCarbG: 180, avgFatG: 60, avgFiberG: 10, totalMeals: 21, daysWithData: 7 },
      { weekStart: "2026-01-12", weekEnd: "2026-01-18", avgKcal: 1850, avgProteinG: 135, avgCarbG: 185, avgFatG: 62, avgFiberG: 10, totalMeals: 21, daysWithData: 7 },
      { weekStart: "2026-01-19", weekEnd: "2026-01-25", avgKcal: 2100, avgProteinG: 160, avgCarbG: 210, avgFatG: 75, avgFiberG: 10, totalMeals: 21, daysWithData: 7 },
      { weekStart: "2026-01-26", weekEnd: "2026-02-01", avgKcal: 2200, avgProteinG: 165, avgCarbG: 220, avgFatG: 78, avgFiberG: 10, totalMeals: 21, daysWithData: 7 },
    ];
    const trends = computeNutritionTrend(weeks);
    const kcalTrend = trends.find((t) => t.metric === "kcal")!;
    expect(kcalTrend.direction).toBe("increasing");
    expect(kcalTrend.secondHalfAvg).toBeGreaterThan(kcalTrend.firstHalfAvg);
  });

  it("returns insufficient for single week", () => {
    const weeks = [
      { weekStart: "2026-01-05", weekEnd: "2026-01-11", avgKcal: 2000, avgProteinG: 150, avgCarbG: 200, avgFatG: 70, avgFiberG: 10, totalMeals: 21, daysWithData: 7 },
    ];
    const trends = computeNutritionTrend(weeks);
    expect(trends.every((t) => t.direction === "insufficient")).toBe(true);
  });
});

describe("detectNutritionShifts", () => {
  it("detects >10% caloric increase", () => {
    const weeks = Array.from({ length: 6 }, (_, i) => ({
      weekStart: `2026-01-${String(5 + i * 7).padStart(2, "0")}`,
      weekEnd: `2026-01-${String(11 + i * 7).padStart(2, "0")}`,
      avgKcal: i < 5 ? 2000 : 2400, // 20% increase at week 5
      avgProteinG: 150, avgCarbG: 200, avgFatG: 70, avgFiberG: 10,
      totalMeals: 21, daysWithData: 7,
    }));
    const shifts = detectNutritionShifts(weeks);
    expect(shifts.length).toBeGreaterThan(0);
    expect(shifts[0]!.shiftType).toBe("kcal_increase");
  });

  it("returns empty for insufficient data", () => {
    const weeks = [
      { weekStart: "2026-01-05", weekEnd: "2026-01-11", avgKcal: 2000, avgProteinG: 150, avgCarbG: 200, avgFatG: 70, avgFiberG: 10, totalMeals: 21, daysWithData: 7 },
    ];
    expect(detectNutritionShifts(weeks)).toEqual([]);
  });
});

describe("detectPhysiologyResponses", () => {
  it("detects weight decrease after shift", () => {
    const bio = [
      { date: "2026-01-01", weightKg: 90, bodyFatPct: 25 },
      { date: "2026-02-01", weightKg: 88, bodyFatPct: 24 },
    ];
    const shifts = ["2026-01-05"]; // shift date
    const responses = detectPhysiologyResponses(bio, shifts);
    expect(responses.length).toBeGreaterThan(0);
    expect(responses.some((r) => r.metric === "weight" && r.direction === "improved")).toBe(true);
  });

  it("returns empty when no biometric data", () => {
    expect(detectPhysiologyResponses([], ["2026-01-05"])).toEqual([]);
  });
});

describe("alignTimeSeriesData", () => {
  it("aligns weekly nutrition with biometric data", () => {
    const weeks = [
      { weekStart: "2026-01-05", weekEnd: "2026-01-11", avgKcal: 2000, avgProteinG: 150, avgCarbG: 200, avgFatG: 70, avgFiberG: 10, totalMeals: 21, daysWithData: 7 },
      { weekStart: "2026-01-12", weekEnd: "2026-01-18", avgKcal: 2100, avgProteinG: 155, avgCarbG: 210, avgFatG: 75, avgFiberG: 10, totalMeals: 21, daysWithData: 7 },
    ];
    const bio = [
      { date: "2026-01-07", weightKg: 85, bodyFatPct: 22, leanMassKg: 66 },
      { date: "2026-01-16", weightKg: 84.5, bodyFatPct: 21.5, leanMassKg: 66.3 },
    ];
    const aligned = alignTimeSeriesData(weeks, bio);
    expect(aligned.length).toBe(2);
    expect(aligned[0]!.avgKcal).toBe(2000);
    expect(aligned[0]!.weightKg).toBe(85);
    expect(aligned[1]!.weightKg).toBe(84.5);
  });
});
