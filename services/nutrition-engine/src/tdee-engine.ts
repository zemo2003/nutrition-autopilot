/**
 * TDEE Engine
 *
 * Basal Metabolic Rate (BMR) and Total Daily Energy Expenditure (TDEE) estimation.
 * Supports Mifflin-St Jeor and Harris-Benedict equations.
 * Macro target recommendations based on goals.
 * Pure math — no DB dependency.
 */

export type Sex = "male" | "female";
export type BMRMethod = "mifflin" | "harris";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type GoalType = "cut" | "maintain" | "bulk";

export interface BMRInput {
  weightKg: number;
  heightCm: number;
  ageYears: number;
  sex: Sex;
  method?: BMRMethod;
}

export interface TDEEResult {
  bmr: number;
  tdee: number;
  method: BMRMethod;
  activityLevel: ActivityLevel;
  activityMultiplier: number;
}

export interface CaloricBalance {
  tdee: number;
  avgDailyKcal: number;
  balance: number;
  status: "surplus" | "deficit" | "maintenance";
}

export interface MacroTargets {
  kcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  goal: GoalType;
}

export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: "Sedentary (little/no exercise)",
  light: "Light (1-3 days/week)",
  moderate: "Moderate (3-5 days/week)",
  active: "Active (6-7 days/week)",
  very_active: "Very Active (2x/day)",
};

/**
 * Estimate Basal Metabolic Rate using Mifflin-St Jeor equation.
 */
export function mifflinStJeor(weightKg: number, heightCm: number, ageYears: number, sex: Sex): number {
  // Male: 10 * weight + 6.25 * height - 5 * age + 5
  // Female: 10 * weight + 6.25 * height - 5 * age - 161
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return Math.round(sex === "male" ? base + 5 : base - 161);
}

/**
 * Estimate Basal Metabolic Rate using Harris-Benedict equation (revised).
 */
export function harrisBenedict(weightKg: number, heightCm: number, ageYears: number, sex: Sex): number {
  if (sex === "male") {
    return Math.round(88.362 + 13.397 * weightKg + 4.799 * heightCm - 5.677 * ageYears);
  }
  return Math.round(447.593 + 9.247 * weightKg + 3.098 * heightCm - 4.330 * ageYears);
}

/**
 * Estimate BMR using the specified method.
 */
export function estimateBMR(input: BMRInput): number {
  const { weightKg, heightCm, ageYears, sex, method = "mifflin" } = input;

  if (weightKg <= 0 || heightCm <= 0 || ageYears <= 0) return 0;

  if (method === "harris") {
    return harrisBenedict(weightKg, heightCm, ageYears, sex);
  }
  return mifflinStJeor(weightKg, heightCm, ageYears, sex);
}

/**
 * Estimate Total Daily Energy Expenditure.
 */
export function estimateTDEE(bmr: number, activityLevel: ActivityLevel): number {
  const multiplier = ACTIVITY_MULTIPLIERS[activityLevel] ?? 1.2;
  return Math.round(bmr * multiplier);
}

/**
 * Compute full TDEE result from client parameters.
 */
export function computeTDEE(input: BMRInput, activityLevel: ActivityLevel): TDEEResult {
  const method = input.method ?? "mifflin";
  const bmr = estimateBMR(input);
  const multiplier = ACTIVITY_MULTIPLIERS[activityLevel] ?? 1.2;
  const tdee = Math.round(bmr * multiplier);

  return { bmr, tdee, method, activityLevel, activityMultiplier: multiplier };
}

/**
 * Compute caloric balance: how actual intake compares to TDEE.
 */
export function computeCaloricBalance(tdee: number, avgDailyKcal: number): CaloricBalance {
  const balance = Math.round(avgDailyKcal - tdee);
  const threshold = 100; // kcal tolerance for "maintenance"
  let status: "surplus" | "deficit" | "maintenance";

  if (balance > threshold) status = "surplus";
  else if (balance < -threshold) status = "deficit";
  else status = "maintenance";

  return { tdee, avgDailyKcal, balance, status };
}

/**
 * Recommend macro targets based on TDEE and goal.
 *
 * Cut:      TDEE - 500, protein 2.2g/kg, fat 25% of kcal, carbs = remainder
 * Maintain: TDEE,       protein 1.8g/kg, fat 30% of kcal, carbs = remainder
 * Bulk:     TDEE + 300, protein 2.0g/kg, fat 25% of kcal, carbs = remainder
 */
export function recommendMacroTargets(params: {
  tdee: number;
  goal: GoalType;
  weightKg: number;
}): MacroTargets {
  const { tdee, goal, weightKg } = params;

  let kcal: number;
  let proteinPerKg: number;
  let fatPct: number;

  switch (goal) {
    case "cut":
      kcal = tdee - 500;
      proteinPerKg = 2.2;
      fatPct = 0.25;
      break;
    case "bulk":
      kcal = tdee + 300;
      proteinPerKg = 2.0;
      fatPct = 0.25;
      break;
    default: // maintain
      kcal = tdee;
      proteinPerKg = 1.8;
      fatPct = 0.30;
      break;
  }

  kcal = Math.max(kcal, 1200); // Safety floor
  const proteinG = Math.round(weightKg * proteinPerKg);
  const fatG = Math.round((kcal * fatPct) / 9);
  const proteinKcal = proteinG * 4;
  const fatKcal = fatG * 9;
  const carbG = Math.max(0, Math.round((kcal - proteinKcal - fatKcal) / 4));

  return { kcal: Math.round(kcal), proteinG, carbG, fatG, goal };
}

/**
 * Compute age in years from date of birth.
 */
export function computeAge(dateOfBirth: Date, referenceDate?: Date): number {
  const now = referenceDate ?? new Date();
  let age = now.getFullYear() - dateOfBirth.getFullYear();
  const monthDiff = now.getMonth() - dateOfBirth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dateOfBirth.getDate())) {
    age--;
  }
  return age;
}
