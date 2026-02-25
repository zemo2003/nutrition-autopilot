/**
 * Sprint 1A — Inventory Intelligence Engine
 *
 * Pure DB-backed projection computations for inventory intelligence.
 * Computes projections, demand forecasts, allocation summaries, and waste analytics.
 */

import { prisma } from "@nutrition/db";
import { addDays, startOfDay, endOfDay } from "date-fns";

// ── Types ──────────────────────────────────────────────────────────

export type InventoryStatus = "critical" | "shortage" | "low" | "expiring" | "ok";

export interface IngredientProjection {
  ingredientId: string;
  ingredientName: string;
  category: string;
  onHandG: number;
  mealDemandG: number;
  batchDemandG: number;
  totalDemandG: number;
  projectedBalanceG: number;
  parLevelG: number | null;
  reorderPointG: number | null;
  expiringWithin3DaysG: number;
  status: InventoryStatus;
  lotCount: number;
}

export interface DayForecast {
  date: string;
  items: {
    ingredientId: string;
    ingredientName: string;
    mealDemandG: number;
    batchDemandG: number;
    totalDemandG: number;
  }[];
  totalDemandG: number;
}

export interface WasteItem {
  ingredientId: string;
  ingredientName: string;
  totalWasteG: number;
  eventCount: number;
  reasons: { reason: string; totalG: number; count: number }[];
}

export interface AllocationItem {
  ingredientId: string;
  ingredientName: string;
  onHandG: number;
  allocatedG: number;
  availableG: number;
  overallocated: boolean;
}

// ── Status computation ─────────────────────────────────────────────

const STATUS_ORDER: Record<InventoryStatus, number> = {
  critical: 0,
  shortage: 1,
  low: 2,
  expiring: 3,
  ok: 4,
};

function computeStatus(
  projectedBalanceG: number,
  parLevelG: number | null,
  reorderPointG: number | null,
  expiringRatio: number,
): InventoryStatus {
  if (projectedBalanceG <= 0) return "critical";
  if (projectedBalanceG < (parLevelG ?? 0)) return "shortage";
  if (projectedBalanceG < (reorderPointG ?? parLevelG ?? 0) * 1.5) return "low";
  if (expiringRatio > 0.5) return "expiring";
  return "ok";
}

// ── Helpers ────────────────────────────────────────────────────────

async function getOnHandByIngredient(organizationId: string): Promise<
  Map<string, { totalG: number; expiringG: number; lotCount: number }>
> {
  const threeDaysFromNow = addDays(new Date(), 3);

  const lots = await prisma.inventoryLot.findMany({
    where: { organizationId, quantityAvailableG: { gt: 0 } },
    select: {
      quantityAvailableG: true,
      expiresAt: true,
      product: { select: { ingredientId: true } },
    },
  });

  const map = new Map<string, { totalG: number; expiringG: number; lotCount: number }>();
  for (const lot of lots) {
    const ingId = lot.product.ingredientId;
    const entry = map.get(ingId) ?? { totalG: 0, expiringG: 0, lotCount: 0 };
    entry.totalG += lot.quantityAvailableG;
    entry.lotCount += 1;
    if (lot.expiresAt && lot.expiresAt <= threeDaysFromNow) {
      entry.expiringG += lot.quantityAvailableG;
    }
    map.set(ingId, entry);
  }
  return map;
}

async function getMealDemandByIngredient(
  organizationId: string,
  from: Date,
  to: Date,
): Promise<Map<string, number>> {
  const schedules = await prisma.mealSchedule.findMany({
    where: {
      organizationId,
      status: "PLANNED",
      serviceDate: { gte: from, lte: to },
    },
    select: {
      plannedServings: true,
      sku: {
        select: {
          recipes: {
            select: {
              lines: {
                select: { ingredientId: true, targetGPerServing: true },
              },
            },
          },
        },
      },
    },
  });

  const map = new Map<string, number>();
  for (const sched of schedules) {
    if (!sched.sku) continue;
    for (const recipe of sched.sku.recipes) {
      for (const line of recipe.lines) {
        const grams = line.targetGPerServing * sched.plannedServings;
        map.set(line.ingredientId, (map.get(line.ingredientId) ?? 0) + grams);
      }
    }
  }
  return map;
}

async function getBatchDemandByIngredient(
  organizationId: string,
  from: Date,
  to: Date,
): Promise<Map<string, number>> {
  const batches = await prisma.batchProduction.findMany({
    where: {
      organizationId,
      status: { in: ["PLANNED", "IN_PREP"] },
      plannedDate: { gte: from, lte: to },
    },
    select: {
      rawInputG: true,
      component: {
        select: {
          lines: {
            select: { ingredientId: true, targetGPer100g: true },
          },
        },
      },
    },
  });

  const map = new Map<string, number>();
  for (const batch of batches) {
    for (const line of batch.component.lines) {
      const grams = line.targetGPer100g * (batch.rawInputG / 100);
      map.set(line.ingredientId, (map.get(line.ingredientId) ?? 0) + grams);
    }
  }
  return map;
}

async function getIngredientMap(
  organizationId: string,
): Promise<Map<string, { name: string; category: string; parLevelG: number | null; reorderPointG: number | null }>> {
  const ingredients = await prisma.ingredientCatalog.findMany({
    where: { organizationId, active: true },
    select: { id: true, name: true, category: true, parLevelG: true, reorderPointG: true },
  });
  return new Map(ingredients.map((i) => [i.id, { name: i.name, category: i.category, parLevelG: i.parLevelG, reorderPointG: i.reorderPointG }]));
}

// ── Main Functions ─────────────────────────────────────────────────

export async function computeInventoryProjections(
  organizationId: string,
  forecastDays = 7,
): Promise<IngredientProjection[]> {
  const now = new Date();
  const from = startOfDay(now);
  const to = endOfDay(addDays(now, forecastDays));

  const [onHandMap, mealDemand, batchDemand, ingredientMap] = await Promise.all([
    getOnHandByIngredient(organizationId),
    getMealDemandByIngredient(organizationId, from, to),
    getBatchDemandByIngredient(organizationId, from, to),
    getIngredientMap(organizationId),
  ]);

  // Collect all ingredient IDs that have either inventory or demand
  const allIds = new Set([...onHandMap.keys(), ...mealDemand.keys(), ...batchDemand.keys()]);

  const projections: IngredientProjection[] = [];
  for (const ingredientId of allIds) {
    const ing = ingredientMap.get(ingredientId);
    if (!ing) continue; // skip unknown ingredients

    const onHand = onHandMap.get(ingredientId) ?? { totalG: 0, expiringG: 0, lotCount: 0 };
    const mealG = mealDemand.get(ingredientId) ?? 0;
    const batchG = batchDemand.get(ingredientId) ?? 0;
    const totalDemandG = mealG + batchG;
    const projectedBalanceG = onHand.totalG - totalDemandG;
    const expiringRatio = onHand.totalG > 0 ? onHand.expiringG / onHand.totalG : 0;

    projections.push({
      ingredientId,
      ingredientName: ing.name,
      category: ing.category,
      onHandG: onHand.totalG,
      mealDemandG: mealG,
      batchDemandG: batchG,
      totalDemandG,
      projectedBalanceG,
      parLevelG: ing.parLevelG,
      reorderPointG: ing.reorderPointG,
      expiringWithin3DaysG: onHand.expiringG,
      status: computeStatus(projectedBalanceG, ing.parLevelG, ing.reorderPointG, expiringRatio),
      lotCount: onHand.lotCount,
    });
  }

  // Sort by status severity (critical first)
  projections.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  return projections;
}

export async function computeDemandForecast(
  organizationId: string,
  forecastDays = 7,
): Promise<DayForecast[]> {
  const now = new Date();
  const ingredientMap = await getIngredientMap(organizationId);
  const forecast: DayForecast[] = [];

  for (let d = 0; d < forecastDays; d++) {
    const day = addDays(now, d);
    const dayStart = startOfDay(day);
    const dayEnd = endOfDay(day);

    const [mealDemand, batchDemand] = await Promise.all([
      getMealDemandByIngredient(organizationId, dayStart, dayEnd),
      getBatchDemandByIngredient(organizationId, dayStart, dayEnd),
    ]);

    const allIds = new Set([...mealDemand.keys(), ...batchDemand.keys()]);
    const items: DayForecast["items"] = [];
    let dayTotal = 0;

    for (const ingredientId of allIds) {
      const ing = ingredientMap.get(ingredientId);
      if (!ing) continue;
      const mealG = mealDemand.get(ingredientId) ?? 0;
      const batchG = batchDemand.get(ingredientId) ?? 0;
      const total = mealG + batchG;
      dayTotal += total;
      items.push({
        ingredientId,
        ingredientName: ing.name,
        mealDemandG: mealG,
        batchDemandG: batchG,
        totalDemandG: total,
      });
    }

    items.sort((a, b) => b.totalDemandG - a.totalDemandG);

    forecast.push({
      date: dayStart.toISOString().slice(0, 10),
      items,
      totalDemandG: dayTotal,
    });
  }

  return forecast;
}

export async function computeWasteSummary(
  organizationId: string,
  lookbackDays = 30,
): Promise<WasteItem[]> {
  const since = addDays(new Date(), -lookbackDays);

  const ledgerEntries = await prisma.inventoryLotLedger.findMany({
    where: {
      reason: { in: ["WASTE", "SPOILAGE"] },
      occurredAt: { gte: since },
      inventoryLot: { organizationId },
    },
    select: {
      deltaG: true,
      reason: true,
      inventoryLot: {
        select: {
          product: {
            select: {
              ingredientId: true,
              ingredient: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  const map = new Map<string, WasteItem>();
  for (const entry of ledgerEntries) {
    const ingId = entry.inventoryLot.product.ingredientId;
    const ingName = entry.inventoryLot.product.ingredient.name;
    const existing = map.get(ingId) ?? {
      ingredientId: ingId,
      ingredientName: ingName,
      totalWasteG: 0,
      eventCount: 0,
      reasons: [],
    };

    const wasteG = Math.abs(entry.deltaG);
    existing.totalWasteG += wasteG;
    existing.eventCount += 1;

    const reasonEntry = existing.reasons.find((r) => r.reason === entry.reason);
    if (reasonEntry) {
      reasonEntry.totalG += wasteG;
      reasonEntry.count += 1;
    } else {
      existing.reasons.push({ reason: entry.reason, totalG: wasteG, count: 1 });
    }

    map.set(ingId, existing);
  }

  return [...map.values()].sort((a, b) => b.totalWasteG - a.totalWasteG);
}

export async function computeAllocationSummary(
  organizationId: string,
): Promise<AllocationItem[]> {
  const now = new Date();
  const to = endOfDay(addDays(now, 7));
  const from = startOfDay(now);

  const [onHandMap, mealDemand, batchDemand, ingredientMap] = await Promise.all([
    getOnHandByIngredient(organizationId),
    getMealDemandByIngredient(organizationId, from, to),
    getBatchDemandByIngredient(organizationId, from, to),
    getIngredientMap(organizationId),
  ]);

  const allIds = new Set([...onHandMap.keys(), ...mealDemand.keys(), ...batchDemand.keys()]);
  const items: AllocationItem[] = [];

  for (const ingredientId of allIds) {
    const ing = ingredientMap.get(ingredientId);
    if (!ing) continue;

    const onHandG = onHandMap.get(ingredientId)?.totalG ?? 0;
    const allocatedG = (mealDemand.get(ingredientId) ?? 0) + (batchDemand.get(ingredientId) ?? 0);
    const availableG = Math.max(0, onHandG - allocatedG);

    items.push({
      ingredientId,
      ingredientName: ing.name,
      onHandG,
      allocatedG,
      availableG,
      overallocated: allocatedG > onHandG,
    });
  }

  items.sort((a, b) => {
    if (a.overallocated !== b.overallocated) return a.overallocated ? -1 : 1;
    return b.allocatedG - a.allocatedG;
  });

  return items;
}
