/**
 * Composition Engine
 *
 * Aggregates macros from component slots into a meal composition.
 * Handles composition-first planning: protein + base + veg + sauce slots
 * with gram targets and nutrient previews.
 */

export interface NutrientsPer100g {
  kcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fiberG?: number;
  sodiumMg?: number;
}

export interface CompositionSlotInput {
  slotType: string;
  componentId: string;
  componentName: string;
  targetG: number;
  nutrientsPer100g: NutrientsPer100g;
  allergenTags?: string[];
  flavorProfiles?: string[];
  portionG?: number;
}

export interface CompositionResult {
  totalG: number;
  nutrients: {
    kcal: number;
    proteinG: number;
    carbG: number;
    fatG: number;
    fiberG: number;
    sodiumMg: number;
  };
  macroSplit: {
    proteinPct: number;
    carbPct: number;
    fatPct: number;
  };
  allergenTags: string[];
  flavorProfiles: string[];
  slotBreakdown: SlotNutrientBreakdown[];
  warnings: string[];
}

export interface SlotNutrientBreakdown {
  slotType: string;
  componentName: string;
  grams: number;
  kcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
}

/**
 * Aggregate nutrients from composition slots into a total meal profile
 */
export function aggregateComposition(slots: CompositionSlotInput[]): CompositionResult {
  const breakdown: SlotNutrientBreakdown[] = [];
  let totalG = 0;
  let totalKcal = 0;
  let totalProtein = 0;
  let totalCarb = 0;
  let totalFat = 0;
  let totalFiber = 0;
  let totalSodium = 0;
  const allergenSet = new Set<string>();
  const flavorSet = new Set<string>();
  const warnings: string[] = [];

  for (const slot of slots) {
    const g = slot.portionG ?? slot.targetG;
    const factor = g / 100;

    const kcal = round2(slot.nutrientsPer100g.kcal * factor);
    const proteinG = round2(slot.nutrientsPer100g.proteinG * factor);
    const carbG = round2(slot.nutrientsPer100g.carbG * factor);
    const fatG = round2(slot.nutrientsPer100g.fatG * factor);
    const fiberG = round2((slot.nutrientsPer100g.fiberG ?? 0) * factor);
    const sodiumMg = round2((slot.nutrientsPer100g.sodiumMg ?? 0) * factor);

    totalG += g;
    totalKcal += kcal;
    totalProtein += proteinG;
    totalCarb += carbG;
    totalFat += fatG;
    totalFiber += fiberG;
    totalSodium += sodiumMg;

    breakdown.push({
      slotType: slot.slotType,
      componentName: slot.componentName,
      grams: g,
      kcal,
      proteinG,
      carbG,
      fatG,
    });

    if (slot.allergenTags) {
      for (const tag of slot.allergenTags) allergenSet.add(tag);
    }
    if (slot.flavorProfiles) {
      for (const profile of slot.flavorProfiles) flavorSet.add(profile);
    }
  }

  // Compute macro split (protein/carb/fat calories as percentage)
  const proteinKcal = totalProtein * 4;
  const carbKcal = totalCarb * 4;
  const fatKcal = totalFat * 9;
  const macroKcal = proteinKcal + carbKcal + fatKcal;

  const macroSplit = {
    proteinPct: macroKcal > 0 ? round2((proteinKcal / macroKcal) * 100) : 0,
    carbPct: macroKcal > 0 ? round2((carbKcal / macroKcal) * 100) : 0,
    fatPct: macroKcal > 0 ? round2((fatKcal / macroKcal) * 100) : 0,
  };

  // Warnings
  if (totalKcal > 900) warnings.push("High calorie meal (>900 kcal)");
  if (totalKcal < 200 && slots.length > 0) warnings.push("Low calorie meal (<200 kcal)");
  if (macroSplit.fatPct > 45) warnings.push("High fat ratio (>45%)");
  if (totalSodium > 1500) warnings.push("High sodium (>1500mg)");

  return {
    totalG: round2(totalG),
    nutrients: {
      kcal: round2(totalKcal),
      proteinG: round2(totalProtein),
      carbG: round2(totalCarb),
      fatG: round2(totalFat),
      fiberG: round2(totalFiber),
      sodiumMg: round2(totalSodium),
    },
    macroSplit,
    allergenTags: [...allergenSet].sort(),
    flavorProfiles: [...flavorSet].sort(),
    slotBreakdown: breakdown,
    warnings,
  };
}

/**
 * Check allergen compatibility between slots and client exclusions
 */
export function checkAllergenWarnings(
  slots: CompositionSlotInput[],
  clientExclusions: string[]
): { safe: boolean; conflicts: { slotType: string; componentName: string; allergen: string }[] } {
  if (clientExclusions.length === 0) return { safe: true, conflicts: [] };

  const exclusionSet = new Set(clientExclusions.map((e) => e.toLowerCase()));
  const conflicts: { slotType: string; componentName: string; allergen: string }[] = [];

  for (const slot of slots) {
    for (const tag of slot.allergenTags ?? []) {
      if (exclusionSet.has(tag.toLowerCase())) {
        conflicts.push({
          slotType: slot.slotType,
          componentName: slot.componentName,
          allergen: tag,
        });
      }
    }
  }

  return { safe: conflicts.length === 0, conflicts };
}

/**
 * Check flavor compatibility — warn about conflicting flavor profiles
 */
export function checkFlavorCompatibility(
  slots: CompositionSlotInput[]
): { compatible: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // Known clashes: SWEET + SPICY on same plate is unusual, etc.
  const clashPairs: [string, string][] = [
    ["SWEET", "SPICY"],
    ["SWEET", "UMAMI"],
  ];

  const profiles = new Set<string>();
  for (const slot of slots) {
    for (const p of slot.flavorProfiles ?? []) profiles.add(p);
  }

  for (const [a, b] of clashPairs) {
    if (profiles.has(a) && profiles.has(b)) {
      warnings.push(`Flavor contrast: ${a} + ${b} — verify intended`);
    }
  }

  return { compatible: warnings.length === 0, warnings };
}

/**
 * Compute sauce portion macro deltas
 */
export function saucePortionDelta(
  nutrientsPer100g: NutrientsPer100g,
  portionG: number
): { kcal: number; proteinG: number; carbG: number; fatG: number } {
  const factor = portionG / 100;
  return {
    kcal: round2(nutrientsPer100g.kcal * factor),
    proteinG: round2(nutrientsPer100g.proteinG * factor),
    carbG: round2(nutrientsPer100g.carbG * factor),
    fatG: round2(nutrientsPer100g.fatG * factor),
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
