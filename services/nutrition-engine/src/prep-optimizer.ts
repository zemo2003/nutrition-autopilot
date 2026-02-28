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
  // Optional fields for schedule-aware mode
  clientId?: string;
  clientName?: string;
  mealSlot?: string;
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
  // Schedule-aware enrichments
  perDayBreakdown?: DayComponentDemand[];
  portionPlans?: BatchPortionPlan[];
}

// --- Schedule-aware types ---

export interface PortionDemand {
  clientId: string;
  clientName: string;
  mealSlot: string;
  cookedG: number;
  mealScheduleId: string;
}

export interface DayComponentDemand {
  serviceDate: string;
  componentId: string;
  componentName: string;
  componentType: string;
  totalCookedG: number;
  rawG: number;
  yieldFactor: number;
  portions: PortionDemand[];
}

export interface PortionPlanEntry {
  label: string;
  clientId: string;
  clientName: string;
  serviceDate: string;
  mealSlot: string;
  cookedG: number;
  mealScheduleId: string;
}

export interface BatchPortionPlan {
  componentId: string;
  componentName: string;
  totalCookedG: number;
  totalRawG: number;
  portionCount: number;
  portions: PortionPlanEntry[];
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

// --- Schedule-aware functions ---

/**
 * Compute per-day, per-component breakdown with individual client portions.
 */
export function computePerDayBreakdown(
  meals: MealDemand[],
  yields: YieldInfo[]
): DayComponentDemand[] {
  const yieldMap = new Map(yields.map((y) => [y.componentId, y]));

  // Group by (componentId, serviceDate)
  const groups = new Map<string, MealDemand[]>();
  for (const meal of meals) {
    const key = `${meal.componentId}::${meal.serviceDate}`;
    const existing = groups.get(key) ?? [];
    existing.push(meal);
    groups.set(key, existing);
  }

  const result: DayComponentDemand[] = [];

  for (const [, groupMeals] of groups.entries()) {
    const first = groupMeals[0]!;
    const totalCookedG = round2(groupMeals.reduce((sum, m) => sum + m.cookedG, 0));

    const yieldInfo = yieldMap.get(first.componentId);
    const yieldFactor = yieldInfo?.yieldFactor ?? 1.0;
    const rawG = yieldFactor > 0 ? round2(totalCookedG / yieldFactor) : totalCookedG;

    const portions: PortionDemand[] = groupMeals
      .filter((m) => m.clientId && m.clientName && m.mealSlot)
      .map((m) => ({
        clientId: m.clientId!,
        clientName: m.clientName!,
        mealSlot: m.mealSlot!,
        cookedG: m.cookedG,
        mealScheduleId: m.mealId,
      }));

    result.push({
      serviceDate: first.serviceDate,
      componentId: first.componentId,
      componentName: first.componentName,
      componentType: first.componentType,
      totalCookedG,
      rawG,
      yieldFactor,
      portions,
    });
  }

  // Sort by date, then component name
  result.sort((a, b) => {
    const dateCmp = a.serviceDate.localeCompare(b.serviceDate);
    if (dateCmp !== 0) return dateCmp;
    return a.componentName.localeCompare(b.componentName);
  });

  return result;
}

/**
 * Generate a portion plan for a single component — labeled portions for
 * individual client/day/slot combinations (e.g., sous vide bags).
 */
export function computePortionPlan(
  rollup: ComponentDemandRollup,
  meals: MealDemand[]
): BatchPortionPlan {
  const componentMeals = meals.filter((m) => m.componentId === rollup.componentId);

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const portions: PortionPlanEntry[] = componentMeals
    .filter((m) => m.clientId && m.clientName && m.mealSlot)
    .map((m) => {
      const d = new Date(m.serviceDate);
      const dayName = dayNames[d.getUTCDay()] ?? m.serviceDate;
      const slotLabel = m.mealSlot!.charAt(0) + m.mealSlot!.slice(1).toLowerCase();
      const label = `${m.clientName} / ${dayName} ${slotLabel} / ${Math.round(m.cookedG)}g`;

      return {
        label,
        clientId: m.clientId!,
        clientName: m.clientName!,
        serviceDate: m.serviceDate,
        mealSlot: m.mealSlot!,
        cookedG: m.cookedG,
        mealScheduleId: m.mealId,
      };
    });

  // Sort by date, then client name
  portions.sort((a, b) => {
    const dateCmp = a.serviceDate.localeCompare(b.serviceDate);
    if (dateCmp !== 0) return dateCmp;
    return a.clientName.localeCompare(b.clientName);
  });

  return {
    componentId: rollup.componentId,
    componentName: rollup.componentName,
    totalCookedG: rollup.totalCookedG,
    totalRawG: rollup.rawG,
    portionCount: portions.length,
    portions,
  };
}

/**
 * Generate an enriched prep draft with per-day breakdowns and portion plans.
 * Falls back to regular generatePrepDraft for the base data.
 */
export function generateScheduleAwarePrepDraft(
  weekStart: string,
  weekEnd: string,
  meals: MealDemand[],
  yields: YieldInfo[],
  inventory: InventoryOnHand[]
): PrepDraftResult {
  const base = generatePrepDraft(weekStart, weekEnd, meals, yields, inventory);

  const perDayBreakdown = computePerDayBreakdown(meals, yields);

  const portionPlans = base.demand.map((rollup) =>
    computePortionPlan(rollup, meals)
  );

  return {
    ...base,
    perDayBreakdown,
    portionPlans,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
