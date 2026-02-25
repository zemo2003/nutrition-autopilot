/**
 * Weekly Prep Optimizer
 *
 * Generates a 7-day component demand rollup, computes raw quantities
 * via yield factors, identifies shortages, and suggests batch bundling.
 */

export interface MealDemand {
  mealId: string;
  serviceDate: string;
  componentId: string;
  componentName: string;
  componentType: string;
  cookedG: number;
}

export interface YieldInfo {
  componentId: string;
  yieldFactor: number;  // e.g. 0.85 means 85% yield
  basis: "calibrated" | "default";
}

export interface InventoryOnHand {
  componentId: string;
  availableG: number;
}

export interface ComponentDemandRollup {
  componentId: string;
  componentName: string;
  componentType: string;
  totalCookedG: number;
  rawG: number;
  yieldFactor: number;
  yieldBasis: "calibrated" | "default";
  mealCount: number;
  inventoryOnHandG: number;
  shortageG: number;
  sufficient: boolean;
}

export interface BatchSuggestion {
  componentId: string;
  componentName: string;
  componentType: string;
  rawG: number;
  cookedG: number;
  yieldFactor: number;
  mealCount: number;
  priority: "high" | "medium" | "low";
  isShortage: boolean;
  sharingOpportunity: boolean;
  sharedMealCount: number;
}

export interface PrepDraftResult {
  weekStart: string;
  weekEnd: string;
  demand: ComponentDemandRollup[];
  batchSuggestions: BatchSuggestion[];
  shortages: ComponentDemandRollup[];
  totalMeals: number;
  totalComponents: number;
}

/**
 * Compute 7-day component demand rollup
 */
export function computeDemandRollup(
  meals: MealDemand[],
  yields: YieldInfo[],
  inventory: InventoryOnHand[]
): ComponentDemandRollup[] {
  const yieldMap = new Map(yields.map((y) => [y.componentId, y]));
  const inventoryMap = new Map(inventory.map((i) => [i.componentId, i.availableG]));

  // Group by component
  const componentGroups = new Map<string, MealDemand[]>();
  for (const meal of meals) {
    const existing = componentGroups.get(meal.componentId) ?? [];
    existing.push(meal);
    componentGroups.set(meal.componentId, existing);
  }

  const rollups: ComponentDemandRollup[] = [];

  for (const [componentId, componentMeals] of componentGroups.entries()) {
    const first = componentMeals[0]!;
    const totalCookedG = componentMeals.reduce((sum, m) => sum + m.cookedG, 0);

    const yieldInfo = yieldMap.get(componentId);
    const yieldFactor = yieldInfo?.yieldFactor ?? 1.0;
    const rawG = yieldFactor > 0 ? round2(totalCookedG / yieldFactor) : totalCookedG;

    const onHandG = inventoryMap.get(componentId) ?? 0;
    const shortageG = Math.max(0, round2(rawG - onHandG));

    rollups.push({
      componentId,
      componentName: first.componentName,
      componentType: first.componentType,
      totalCookedG: round2(totalCookedG),
      rawG,
      yieldFactor,
      yieldBasis: yieldInfo?.basis ?? "default",
      mealCount: componentMeals.length,
      inventoryOnHandG: onHandG,
      shortageG,
      sufficient: shortageG === 0,
    });
  }

  // Sort by shortage descending (critical shortages first), then by rawG descending
  rollups.sort((a, b) => {
    if (a.shortageG !== b.shortageG) return b.shortageG - a.shortageG;
    return b.rawG - a.rawG;
  });

  return rollups;
}

/**
 * Generate batch suggestions from demand rollup
 */
export function generateBatchSuggestions(
  rollups: ComponentDemandRollup[]
): BatchSuggestion[] {
  // Detect sharing opportunities: components used across 3+ meals
  const suggestions: BatchSuggestion[] = rollups.map((r) => ({
    componentId: r.componentId,
    componentName: r.componentName,
    componentType: r.componentType,
    rawG: r.rawG,
    cookedG: r.totalCookedG,
    yieldFactor: r.yieldFactor,
    mealCount: r.mealCount,
    priority: r.shortageG > 0 ? "high" : r.mealCount >= 5 ? "medium" : "low",
    isShortage: r.shortageG > 0,
    sharingOpportunity: r.mealCount >= 3,
    sharedMealCount: r.mealCount,
  }));

  // Sort: shortages first, then by priority, then by rawG
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => {
    const pa = priorityOrder[a.priority];
    const pb = priorityOrder[b.priority];
    if (pa !== pb) return pa - pb;
    return b.rawG - a.rawG;
  });

  return suggestions;
}

/**
 * Generate complete prep draft for a week
 */
export function generatePrepDraft(
  weekStart: string,
  weekEnd: string,
  meals: MealDemand[],
  yields: YieldInfo[],
  inventory: InventoryOnHand[]
): PrepDraftResult {
  const demand = computeDemandRollup(meals, yields, inventory);
  const batchSuggestions = generateBatchSuggestions(demand);
  const shortages = demand.filter((d) => !d.sufficient);

  return {
    weekStart,
    weekEnd,
    demand,
    batchSuggestions,
    shortages,
    totalMeals: meals.length,
    totalComponents: demand.length,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
