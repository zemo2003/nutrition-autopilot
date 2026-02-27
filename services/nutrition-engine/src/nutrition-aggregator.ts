/**
 * Nutrition Aggregator
 *
 * Aggregates daily nutrition data into period summaries (7d, 30d, 60d, 90d).
 * Rolling averages, weekly rollups, trend detection, and time-series alignment.
 * Pure math — no DB dependency.
 */

export interface DailyNutritionPoint {
  date: string; // YYYY-MM-DD
  kcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fiberG: number;
  mealCount: number;
}

export interface WeekRollup {
  weekStart: string;
  weekEnd: string;
  avgKcal: number;
  avgProteinG: number;
  avgCarbG: number;
  avgFatG: number;
  avgFiberG: number;
  totalMeals: number;
  daysWithData: number;
}

export interface PeriodSummary {
  periodDays: number;
  totalMeals: number;
  daysWithData: number;
  avgKcal: number;
  avgProteinG: number;
  avgCarbG: number;
  avgFatG: number;
  avgFiberG: number;
  compliancePct: number; // daysWithData / periodDays * 100
}

export type NutritionTrendDirection = "increasing" | "decreasing" | "stable" | "insufficient";

export interface NutritionTrend {
  metric: string;
  direction: NutritionTrendDirection;
  firstHalfAvg: number;
  secondHalfAvg: number;
  changePct: number;
}

export interface NutritionPeriodResult {
  weeks: WeekRollup[];
  summary: PeriodSummary;
  trends: NutritionTrend[];
}

/**
 * Group daily data into ISO-week rollups.
 */
function getISOWeekStart(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function getISOWeekEnd(weekStart: string): string {
  const d = new Date(weekStart + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

/**
 * Aggregate daily nutrition data into period summary with weekly rollups.
 */
export function aggregateNutritionPeriod(
  dailyData: DailyNutritionPoint[],
  periodDays: number,
): NutritionPeriodResult {
  const sorted = [...dailyData].sort((a, b) => a.date.localeCompare(b.date));
  const withData = sorted.filter((d) => d.mealCount > 0);

  // Group by week
  const weekGroups = new Map<string, DailyNutritionPoint[]>();
  for (const day of sorted) {
    const ws = getISOWeekStart(day.date);
    if (!weekGroups.has(ws)) weekGroups.set(ws, []);
    weekGroups.get(ws)!.push(day);
  }

  const weeks: WeekRollup[] = Array.from(weekGroups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ws, days]) => {
      const dwd = days.filter((d) => d.mealCount > 0);
      const count = dwd.length || 1;
      return {
        weekStart: ws,
        weekEnd: getISOWeekEnd(ws),
        avgKcal: Math.round(dwd.reduce((s, d) => s + d.kcal, 0) / count),
        avgProteinG: Math.round(dwd.reduce((s, d) => s + d.proteinG, 0) / count),
        avgCarbG: Math.round(dwd.reduce((s, d) => s + d.carbG, 0) / count),
        avgFatG: Math.round(dwd.reduce((s, d) => s + d.fatG, 0) / count),
        avgFiberG: Math.round(dwd.reduce((s, d) => s + d.fiberG, 0) / count),
        totalMeals: dwd.reduce((s, d) => s + d.mealCount, 0),
        daysWithData: dwd.length,
      };
    });

  const dayCount = withData.length || 1;
  const summary: PeriodSummary = {
    periodDays,
    totalMeals: withData.reduce((s, d) => s + d.mealCount, 0),
    daysWithData: withData.length,
    avgKcal: Math.round(withData.reduce((s, d) => s + d.kcal, 0) / dayCount),
    avgProteinG: Math.round(withData.reduce((s, d) => s + d.proteinG, 0) / dayCount),
    avgCarbG: Math.round(withData.reduce((s, d) => s + d.carbG, 0) / dayCount),
    avgFatG: Math.round(withData.reduce((s, d) => s + d.fatG, 0) / dayCount),
    avgFiberG: Math.round(withData.reduce((s, d) => s + d.fiberG, 0) / dayCount),
    compliancePct: Math.round((withData.length / periodDays) * 100),
  };

  const trends = computeNutritionTrend(weeks);

  return { weeks, summary, trends };
}

/**
 * Compare first half vs second half of weekly rollups.
 */
export function computeNutritionTrend(weeks: WeekRollup[]): NutritionTrend[] {
  if (weeks.length < 2) {
    return (["kcal", "protein", "carbs", "fat"] as const).map((m) => ({
      metric: m, direction: "insufficient" as const,
      firstHalfAvg: 0, secondHalfAvg: 0, changePct: 0,
    }));
  }

  const mid = Math.floor(weeks.length / 2);
  const first = weeks.slice(0, mid);
  const second = weeks.slice(mid);

  function avg(arr: WeekRollup[], key: keyof WeekRollup): number {
    const vals = arr.map((w) => w[key] as number);
    return vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
  }

  function trend(metric: string, key: keyof WeekRollup): NutritionTrend {
    const f = avg(first, key);
    const s = avg(second, key);
    const pct = f > 0 ? Math.round(((s - f) / f) * 100) : 0;
    let direction: NutritionTrendDirection = "stable";
    if (Math.abs(pct) >= 5) direction = pct > 0 ? "increasing" : "decreasing";
    return { metric, direction, firstHalfAvg: Math.round(f), secondHalfAvg: Math.round(s), changePct: pct };
  }

  return [
    trend("kcal", "avgKcal"),
    trend("protein", "avgProteinG"),
    trend("carbs", "avgCarbG"),
    trend("fat", "avgFatG"),
  ];
}

/**
 * Detect significant nutrition shifts (>10% change from 4-week rolling average).
 */
export interface NutritionShift {
  weekStart: string;
  shiftType: "kcal_increase" | "kcal_decrease" | "protein_increase" | "protein_decrease" | "macro_rebalance";
  magnitude: number;
  description: string;
}

export function detectNutritionShifts(weeks: WeekRollup[]): NutritionShift[] {
  if (weeks.length < 5) return [];
  const shifts: NutritionShift[] = [];

  for (let i = 4; i < weeks.length; i++) {
    const prev4 = weeks.slice(i - 4, i);
    const current = weeks[i]!;
    const avgKcal = prev4.reduce((s, w) => s + w.avgKcal, 0) / 4;
    const avgProtein = prev4.reduce((s, w) => s + w.avgProteinG, 0) / 4;

    if (avgKcal > 0) {
      const kcalPct = ((current.avgKcal - avgKcal) / avgKcal) * 100;
      if (Math.abs(kcalPct) > 10) {
        shifts.push({
          weekStart: current.weekStart,
          shiftType: kcalPct > 0 ? "kcal_increase" : "kcal_decrease",
          magnitude: Math.round(Math.abs(kcalPct)),
          description: `${kcalPct > 0 ? "+" : ""}${Math.round(kcalPct)}% caloric ${kcalPct > 0 ? "increase" : "decrease"} (${Math.round(avgKcal)} → ${current.avgKcal} kcal)`,
        });
      }
    }

    if (avgProtein > 0) {
      const protPct = ((current.avgProteinG - avgProtein) / avgProtein) * 100;
      if (Math.abs(protPct) > 15) {
        shifts.push({
          weekStart: current.weekStart,
          shiftType: protPct > 0 ? "protein_increase" : "protein_decrease",
          magnitude: Math.round(Math.abs(protPct)),
          description: `${protPct > 0 ? "+" : ""}${Math.round(protPct)}% protein ${protPct > 0 ? "increase" : "decrease"} (${Math.round(avgProtein)} → ${current.avgProteinG}g)`,
        });
      }
    }
  }

  return shifts;
}

/**
 * Detect physiology responses 2-6 weeks after nutrition shifts.
 */
export interface PhysiologyResponse {
  shiftDate: string;
  responseDate: string;
  lagWeeks: number;
  metric: string;
  direction: "improved" | "worsened" | "unchanged";
  magnitude: number;
  description: string;
}

export function detectPhysiologyResponses(
  biometricPoints: { date: string; weightKg: number | null; bodyFatPct: number | null }[],
  shiftDates: string[],
): PhysiologyResponse[] {
  if (biometricPoints.length < 2 || shiftDates.length === 0) return [];

  const sorted = [...biometricPoints].sort((a, b) => a.date.localeCompare(b.date));
  const responses: PhysiologyResponse[] = [];

  for (const shiftDate of shiftDates) {
    // Find closest biometric before the shift
    const before = sorted.filter((p) => p.date <= shiftDate).pop();
    // Find biometrics 2-6 weeks after
    const shiftTime = new Date(shiftDate + "T12:00:00Z").getTime();
    const twoWeeksLater = shiftTime + 14 * 86400000;
    const sixWeeksLater = shiftTime + 42 * 86400000;

    const after = sorted.filter((p) => {
      const t = new Date(p.date + "T12:00:00Z").getTime();
      return t >= twoWeeksLater && t <= sixWeeksLater;
    });

    if (before && after.length > 0) {
      const response = after[after.length - 1]!;
      const lagMs = new Date(response.date + "T12:00:00Z").getTime() - shiftTime;
      const lagWeeks = Math.round(lagMs / (7 * 86400000));

      if (before.weightKg != null && response.weightKg != null) {
        const delta = response.weightKg - before.weightKg;
        if (Math.abs(delta) >= 0.5) {
          responses.push({
            shiftDate, responseDate: response.date, lagWeeks,
            metric: "weight",
            direction: delta < 0 ? "improved" : "worsened",
            magnitude: Math.round(Math.abs(delta) * 10) / 10,
            description: `Weight ${delta < 0 ? "decreased" : "increased"} by ${Math.abs(delta).toFixed(1)}kg`,
          });
        }
      }

      if (before.bodyFatPct != null && response.bodyFatPct != null) {
        const delta = response.bodyFatPct - before.bodyFatPct;
        if (Math.abs(delta) >= 0.5) {
          responses.push({
            shiftDate, responseDate: response.date, lagWeeks,
            metric: "body_fat",
            direction: delta < 0 ? "improved" : "worsened",
            magnitude: Math.round(Math.abs(delta) * 10) / 10,
            description: `Body fat ${delta < 0 ? "decreased" : "increased"} by ${Math.abs(delta).toFixed(1)}%`,
          });
        }
      }
    }
  }

  return responses;
}

/**
 * Align weekly nutrition data with biometric data points on the same time axis.
 */
export interface AlignedDataPoint {
  weekStart: string;
  avgKcal?: number;
  avgProteinG?: number;
  avgCarbG?: number;
  avgFatG?: number;
  weightKg?: number;
  bodyFatPct?: number;
  leanMassKg?: number;
}

export function alignTimeSeriesData(
  nutritionWeeks: WeekRollup[],
  biometricPoints: { date: string; weightKg: number | null; bodyFatPct: number | null; leanMassKg: number | null }[],
): AlignedDataPoint[] {
  const aligned: AlignedDataPoint[] = [];

  for (const week of nutritionWeeks) {
    const entry: AlignedDataPoint = {
      weekStart: week.weekStart,
      avgKcal: week.avgKcal,
      avgProteinG: week.avgProteinG,
      avgCarbG: week.avgCarbG,
      avgFatG: week.avgFatG,
    };

    // Find closest biometric within the week window (+/- 3 days)
    const wsTime = new Date(week.weekStart + "T12:00:00Z").getTime();
    const weTime = new Date(week.weekEnd + "T12:00:00Z").getTime();
    const windowStart = wsTime - 3 * 86400000;
    const windowEnd = weTime + 3 * 86400000;

    const inWindow = biometricPoints.filter((p) => {
      const t = new Date(p.date + "T12:00:00Z").getTime();
      return t >= windowStart && t <= windowEnd;
    });

    if (inWindow.length > 0) {
      // Use the latest in the window
      const latest = inWindow[inWindow.length - 1]!;
      if (latest.weightKg != null) entry.weightKg = latest.weightKg;
      if (latest.bodyFatPct != null) entry.bodyFatPct = latest.bodyFatPct;
      if (latest.leanMassKg != null) entry.leanMassKg = latest.leanMassKg;
    }

    aligned.push(entry);
  }

  return aligned;
}
