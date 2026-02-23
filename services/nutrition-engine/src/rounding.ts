/**
 * FDA Nutrient Rounding Module
 * Implements 21 CFR 101.9 and 21 CFR 101.36 rounding rules for all nutrients
 * on Nutrition Facts labels.
 *
 * Reference: FDA Final Rule "Nutrition Labeling of Dietary Supplements"
 * 21 CFR 101.9(c)(8) and 21 CFR 101.36(c)(2)
 */

// ============================================================================
// MACRONUTRIENT ROUNDING (21 CFR 101.9(b)(1)-(5))
// ============================================================================

/**
 * Round calories per 21 CFR 101.9(b)(1)
 * - < 5 kcal: round to 0
 * - 5-50 kcal: round to nearest 5
 * - > 50 kcal: round to nearest 10
 */
export function roundCalories(value: number): number {
  if (value < 5) return 0;
  if (value <= 50) return Math.round(value / 5) * 5;
  return Math.round(value / 10) * 10;
}

/**
 * Round total fat, saturated fat, and trans fat per 21 CFR 101.9(b)(2)
 * - < 0.5 g: round to 0
 * - 0.5-5 g: round to nearest 0.5
 * - > 5 g: round to nearest 1
 */
export function roundFatLike(value: number): number {
  if (value < 0.5) return 0;
  if (value < 5) return Math.round(value * 2) / 2;
  return Math.round(value);
}

/**
 * Round carbohydrates, fiber, sugar, protein (in grams) per 21 CFR 101.9(b)(3-5)
 * - < 0.5 g: round to 0
 * - ≥ 0.5 g: round to nearest 1
 */
export function roundGeneralG(value: number): number {
  if (value < 0.5) return 0;
  return Math.round(value);
}

/**
 * Round sodium per 21 CFR 101.9(b)(6)
 * - < 5 mg: round to 0
 * - 5-140 mg: round to nearest 5
 * - > 140 mg: round to nearest 10
 */
export function roundSodiumMg(value: number): number {
  if (value < 5) return 0;
  if (value <= 140) return Math.round(value / 5) * 5;
  return Math.round(value / 10) * 10;
}

/**
 * Round cholesterol per 21 CFR 101.9(b)(7)
 * - < 2 mg: round to 0
 * - ≥ 2 mg: round to nearest 5
 */
export function roundCholesterolMg(value: number): number {
  if (value < 2) return 0;
  return Math.round(value / 5) * 5;
}

// ============================================================================
// MICRONUTRIENT ROUNDING (21 CFR 101.9(c)(8)(iv))
// ============================================================================

/**
 * Round vitamin D (mcg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 20 mcg, DV% < 25, therefore round to nearest 0.1 mcg
 */
export function roundVitaminD(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Round calcium (mg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 1300 mg, DV% > 500, therefore round to nearest 10 mg
 */
export function roundCalcium(value: number): number {
  if (value < 5) return 0;
  return Math.round(value / 10) * 10;
}

/**
 * Round iron (mg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 18 mg, DV% 25-250, therefore round to nearest 1 mg
 * But with lower thresholds: < 0.5 rounds to 0, 0.5-5 round to nearest 0.1
 */
export function roundIron(value: number): number {
  if (value < 0.5) return 0;
  if (value <= 5) return Math.round(value * 10) / 10;
  return Math.round(value);
}

/**
 * Round potassium (mg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 4700 mg, DV% > 500, therefore round to nearest 10 mg
 */
export function roundPotassium(value: number): number {
  if (value < 5) return 0;
  return Math.round(value / 10) * 10;
}

/**
 * Round vitamin A (mcg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 900 mcg, DV% 250-500, therefore round to nearest 5 mcg
 */
export function roundVitaminA(value: number): number {
  if (value < 2.5) return 0;
  return Math.round(value / 5) * 5;
}

/**
 * Round vitamin C (mg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 90 mg, DV% 250-500, therefore round to nearest 5 mg
 */
export function roundVitaminC(value: number): number {
  if (value < 2.5) return 0;
  return Math.round(value / 5) * 5;
}

/**
 * Round vitamin E (mg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 15 mg, DV% 25-250, therefore round to nearest 1 mg
 */
export function roundVitaminE(value: number): number {
  if (value < 0.5) return 0;
  return Math.round(value);
}

/**
 * Round vitamin K (mcg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 120 mcg, DV% 25-250, therefore round to nearest 1 mcg
 */
export function roundVitaminK(value: number): number {
  if (value < 0.5) return 0;
  return Math.round(value);
}

/**
 * Round thiamin (mg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 1.2 mg, DV% 25-250, therefore round to nearest 1 mg
 */
export function roundThiamin(value: number): number {
  if (value < 0.5) return 0;
  return Math.round(value);
}

/**
 * Round riboflavin (mg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 1.3 mg, DV% 25-250, therefore round to nearest 1 mg
 */
export function roundRiboflavin(value: number): number {
  if (value < 0.5) return 0;
  return Math.round(value);
}

/**
 * Round niacin (mg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 16 mg, DV% 25-250, therefore round to nearest 1 mg
 */
export function roundNiacin(value: number): number {
  if (value < 0.5) return 0;
  return Math.round(value);
}

/**
 * Round vitamin B6 (mg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 1.7 mg, DV% 25-250, therefore round to nearest 1 mg
 */
export function roundVitaminB6(value: number): number {
  if (value < 0.5) return 0;
  return Math.round(value);
}

/**
 * Round folate (mcg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 400 mcg, DV% 250-500, therefore round to nearest 5 mcg
 */
export function roundFolate(value: number): number {
  if (value < 2.5) return 0;
  return Math.round(value / 5) * 5;
}

/**
 * Round vitamin B12 (mcg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 2.4 mcg, DV% < 25, therefore round to nearest 0.1 mcg
 */
export function roundVitaminB12(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Round biotin (mcg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 30 mcg, DV% 25-250, therefore round to nearest 1 mcg
 */
export function roundBiotin(value: number): number {
  if (value < 0.5) return 0;
  return Math.round(value);
}

/**
 * Round pantothenic acid (mg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 5 mg, DV% 25-250, therefore round to nearest 1 mg
 */
export function roundPantothenicAcid(value: number): number {
  if (value < 0.5) return 0;
  return Math.round(value);
}

/**
 * Round phosphorus (mg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 1250 mg, DV% > 500, therefore round to nearest 10 mg
 */
export function roundPhosphorus(value: number): number {
  if (value < 5) return 0;
  return Math.round(value / 10) * 10;
}

/**
 * Round iodine (mcg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 150 mcg, DV% 25-250, therefore round to nearest 1 mcg
 */
export function roundIodine(value: number): number {
  if (value < 0.5) return 0;
  return Math.round(value);
}

/**
 * Round magnesium (mg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 420 mg, DV% 250-500, therefore round to nearest 5 mg
 */
export function roundMagnesium(value: number): number {
  if (value < 2.5) return 0;
  return Math.round(value / 5) * 5;
}

/**
 * Round zinc (mg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 11 mg, DV% 25-250, therefore round to nearest 1 mg
 */
export function roundZinc(value: number): number {
  if (value < 0.5) return 0;
  return Math.round(value);
}

/**
 * Round selenium (mcg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 55 mcg, DV% 25-250, therefore round to nearest 1 mcg
 */
export function roundSelenium(value: number): number {
  if (value < 0.5) return 0;
  return Math.round(value);
}

/**
 * Round copper (mg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 0.9 mg, DV% < 25, therefore round to nearest 0.1 mg
 */
export function roundCopper(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Round manganese (mg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 2.3 mg, DV% 25-250, therefore round to nearest 1 mg
 */
export function roundManganese(value: number): number {
  if (value < 0.5) return 0;
  return Math.round(value);
}

/**
 * Round chromium (mcg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 35 mcg, DV% 25-250, therefore round to nearest 1 mcg
 */
export function roundChromium(value: number): number {
  if (value < 0.5) return 0;
  return Math.round(value);
}

/**
 * Round molybdenum (mcg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 45 mcg, DV% 25-250, therefore round to nearest 1 mcg
 */
export function roundMolybdenum(value: number): number {
  if (value < 0.5) return 0;
  return Math.round(value);
}

/**
 * Round chloride (mg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 2300 mg, DV% > 500, therefore round to nearest 10 mg
 */
export function roundChloride(value: number): number {
  if (value < 5) return 0;
  return Math.round(value / 10) * 10;
}

/**
 * Round choline (mg) per 21 CFR 101.9(c)(8)(iv)
 * DV = 550 mg, DV% > 500, therefore round to nearest 10 mg
 */
export function roundCholine(value: number): number {
  if (value < 5) return 0;
  return Math.round(value / 10) * 10;
}

// ============================================================================
// GENERIC MICRONUTRIENT ROUNDING (21 CFR 101.9(c)(8)(iv))
// ============================================================================

/**
 * Generic micronutrient rounding based on daily value magnitude
 *
 * Per 21 CFR 101.9(c)(8)(iv), rounding rules are:
 * - If DV < 25: round to nearest 0.1 (for mg) or 0.01 (for mcg)
 * - If DV 25-250: round to nearest 1 (for mg/mcg)
 * - If DV 250-500: round to nearest 5 (for mg/mcg)
 * - If DV >= 500: round to nearest 10 (for mg/mcg)
 *
 * @param value The nutrient amount
 * @param dailyValue The FDA daily value for this nutrient
 * @returns The rounded value
 */
export function roundMicronutrient(value: number, dailyValue: number): number {
  // Handle zero/negligible values
  if (value === 0) return 0;

  // Determine the rounding increment based on DV magnitude
  let roundingMultiplier: number;

  if (dailyValue < 25) {
    // Round to nearest 0.1 for mg, or 0.01 for mcg
    roundingMultiplier = 10;
  } else if (dailyValue <= 250) {
    // Round to nearest 1
    roundingMultiplier = 1;
  } else if (dailyValue <= 500) {
    // Round to nearest 5
    roundingMultiplier = 5;
  } else {
    // Round to nearest 10
    roundingMultiplier = 10;
  }

  return Math.round(value / roundingMultiplier) * roundingMultiplier;
}

// ============================================================================
// PERCENT DAILY VALUE ROUNDING (21 CFR 101.9(c)(8)(i))
// ============================================================================

/**
 * Round percent daily value per 21 CFR 101.9(c)(8)(i)
 *
 * Rounding rules:
 * - 0-10%: round to nearest 2%
 * - 10-50%: round to nearest 5%
 * - >50%: round to nearest 10%
 * - <2%: may declare as "Contains less than 2%"
 *
 * @param percentDV The %DV value (0-100 range)
 * @returns The rounded %DV value
 */
export function roundPercentDV(percentDV: number): number {
  if (percentDV === 0) return 0;

  if (percentDV < 2) {
    return 0; // Declare as "less than 2%"
  }

  if (percentDV <= 10) {
    return Math.round(percentDV / 2) * 2;
  }

  if (percentDV <= 50) {
    return Math.round(percentDV / 5) * 5;
  }

  return Math.round(percentDV / 10) * 10;
}
