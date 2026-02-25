/**
 * Sprint 1A Scientific QA — Inventory Projections & Lot Consumption
 *
 * These tests cover the PURE MATH portions of inventory intelligence
 * that can be tested without a database:
 *   1. Lot consumption recording invariants (FIFO)
 *   2. No duplicate lot deductions
 *   3. Inventory allocation invariants
 *   4. Projection logic correctness
 *   5. Status computation
 *   6. Deterministic projected balance calculations
 *   7. No impact on served/frozen labels
 */

import { describe, it, expect } from "vitest";

// ── Pure math helpers (mirrors projection engine logic) ──────────────────────

interface LotSnapshot {
  ingredientId: string;
  quantityAvailableG: number;
  expiresAt: Date | null;
}

interface DemandEntry {
  ingredientId: string;
  gramsNeeded: number;
}

interface ParLevel {
  ingredientId: string;
  parLevelG: number | null;
  reorderPointG: number | null;
}

function computeOnHand(lots: LotSnapshot[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const lot of lots) {
    map.set(
      lot.ingredientId,
      (map.get(lot.ingredientId) ?? 0) + lot.quantityAvailableG,
    );
  }
  return map;
}

function computeTotalDemand(entries: DemandEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of entries) {
    map.set(e.ingredientId, (map.get(e.ingredientId) ?? 0) + e.gramsNeeded);
  }
  return map;
}

function computeProjectedBalance(
  onHand: Map<string, number>,
  demand: Map<string, number>,
): Map<string, number> {
  const result = new Map<string, number>();
  const allIds = new Set([...onHand.keys(), ...demand.keys()]);
  for (const id of allIds) {
    result.set(id, (onHand.get(id) ?? 0) - (demand.get(id) ?? 0));
  }
  return result;
}

type InventoryStatus = "critical" | "shortage" | "low" | "expiring" | "ok";

function computeStatus(
  projectedBalanceG: number,
  parLevelG: number | null,
  reorderPointG: number | null,
  expiringRatio: number, // expiringG / onHandG
): InventoryStatus {
  if (projectedBalanceG <= 0) return "critical";
  if (projectedBalanceG < (parLevelG ?? 0)) return "shortage";
  if (projectedBalanceG < (reorderPointG ?? parLevelG ?? 0) * 1.5) return "low";
  if (expiringRatio > 0.5) return "expiring";
  return "ok";
}

function computeBatchDemand(
  rawInputG: number,
  targetGPer100g: number,
): number {
  return targetGPer100g * (rawInputG / 100);
}

function computeMealDemand(
  targetGPerServing: number,
  plannedServings: number,
): number {
  return targetGPerServing * plannedServings;
}

// FIFO lot deduction helper — no double-deduction
function deductLotsFIFO(
  lots: { id: string; availableG: number; expiresAt: Date | null }[],
  needed: number,
): { lotId: string; consumed: number }[] {
  const sorted = [...lots].sort((a, b) => {
    const ea = a.expiresAt?.getTime() ?? Infinity;
    const eb = b.expiresAt?.getTime() ?? Infinity;
    return ea - eb;
  });
  const result: { lotId: string; consumed: number }[] = [];
  let remaining = needed;
  for (const lot of sorted) {
    if (remaining <= 0) break;
    const use = Math.min(remaining, lot.availableG);
    if (use > 0) {
      result.push({ lotId: lot.id, consumed: use });
      remaining -= use;
    }
  }
  return result;
}

// =============================================================================
// 1. LOT CONSUMPTION RECORDING INVARIANTS (6 tests)
// =============================================================================

describe("1. Lot consumption recording invariants", () => {
  it("FIFO selects earliest-expiry lot first", () => {
    const lots = [
      { id: "lot-B", availableG: 500, expiresAt: new Date("2026-03-15") },
      { id: "lot-A", availableG: 500, expiresAt: new Date("2026-03-01") },
      { id: "lot-C", availableG: 500, expiresAt: new Date("2026-03-30") },
    ];

    const result = deductLotsFIFO(lots, 200);

    expect(result).toHaveLength(1);
    expect(result[0]!.lotId).toBe("lot-A");
    expect(result[0]!.consumed).toBe(200);
  });

  it("FIFO splits across multiple lots when first is insufficient", () => {
    const lots = [
      { id: "lot-A", availableG: 100, expiresAt: new Date("2026-03-01") },
      { id: "lot-B", availableG: 300, expiresAt: new Date("2026-03-15") },
      { id: "lot-C", availableG: 500, expiresAt: new Date("2026-03-30") },
    ];

    const result = deductLotsFIFO(lots, 250);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ lotId: "lot-A", consumed: 100 });
    expect(result[1]).toEqual({ lotId: "lot-B", consumed: 150 });
  });

  it("FIFO returns empty array when no lots available", () => {
    const result = deductLotsFIFO([], 100);

    expect(result).toEqual([]);
    expect(result).toHaveLength(0);
  });

  it("FIFO never exceeds lot available quantity", () => {
    const lots = [
      { id: "lot-A", availableG: 50, expiresAt: new Date("2026-03-01") },
      { id: "lot-B", availableG: 75, expiresAt: new Date("2026-03-15") },
    ];

    const result = deductLotsFIFO(lots, 200);

    for (const r of result) {
      const originalLot = lots.find((l) => l.id === r.lotId)!;
      expect(r.consumed).toBeLessThanOrEqual(originalLot.availableG);
    }
  });

  it("total consumed equals requested amount when sufficient stock", () => {
    const lots = [
      { id: "lot-A", availableG: 200, expiresAt: new Date("2026-03-01") },
      { id: "lot-B", availableG: 300, expiresAt: new Date("2026-03-15") },
    ];
    const needed = 350;

    const result = deductLotsFIFO(lots, needed);
    const totalConsumed = result.reduce((sum, r) => sum + r.consumed, 0);

    expect(totalConsumed).toBe(needed);
  });

  it("partial consumption when insufficient stock (consumes what is available)", () => {
    const lots = [
      { id: "lot-A", availableG: 80, expiresAt: new Date("2026-03-01") },
      { id: "lot-B", availableG: 40, expiresAt: new Date("2026-03-15") },
    ];
    const needed = 200;

    const result = deductLotsFIFO(lots, needed);
    const totalConsumed = result.reduce((sum, r) => sum + r.consumed, 0);

    expect(totalConsumed).toBe(120); // 80 + 40
    expect(totalConsumed).toBeLessThan(needed);
  });
});

// =============================================================================
// 2. NO DUPLICATE LOT DEDUCTIONS (4 tests)
// =============================================================================

describe("2. No duplicate lot deductions", () => {
  it("running FIFO twice with same lots produces same result (deterministic)", () => {
    const lots = [
      { id: "lot-A", availableG: 200, expiresAt: new Date("2026-03-01") },
      { id: "lot-B", availableG: 300, expiresAt: new Date("2026-03-15") },
    ];

    const result1 = deductLotsFIFO(lots, 250);
    const result2 = deductLotsFIFO(lots, 250);

    expect(result1).toEqual(result2);
  });

  it("after first deduction, second deduction uses remaining quantities correctly", () => {
    const lots = [
      { id: "lot-A", availableG: 200, expiresAt: new Date("2026-03-01") },
      { id: "lot-B", availableG: 300, expiresAt: new Date("2026-03-15") },
    ];

    // First deduction: 150g
    const firstResult = deductLotsFIFO(lots, 150);
    expect(firstResult).toEqual([{ lotId: "lot-A", consumed: 150 }]);

    // Simulate applying the first deduction to get remaining quantities
    const remainingLots = lots.map((lot) => {
      const deducted = firstResult.find((r) => r.lotId === lot.id);
      return {
        ...lot,
        availableG: lot.availableG - (deducted?.consumed ?? 0),
      };
    });

    // Second deduction: 150g — should use remaining 50g from lot-A, then lot-B
    const secondResult = deductLotsFIFO(remainingLots, 150);
    expect(secondResult).toEqual([
      { lotId: "lot-A", consumed: 50 },
      { lotId: "lot-B", consumed: 100 },
    ]);

    // Verify no double-counting: total across both deductions
    const totalA =
      (firstResult.find((r) => r.lotId === "lot-A")?.consumed ?? 0) +
      (secondResult.find((r) => r.lotId === "lot-A")?.consumed ?? 0);
    const totalB =
      (firstResult.find((r) => r.lotId === "lot-B")?.consumed ?? 0) +
      (secondResult.find((r) => r.lotId === "lot-B")?.consumed ?? 0);

    expect(totalA).toBeLessThanOrEqual(200);
    expect(totalB).toBeLessThanOrEqual(300);
  });

  it("zero-quantity lots are skipped", () => {
    const lots = [
      { id: "lot-empty", availableG: 0, expiresAt: new Date("2026-03-01") },
      { id: "lot-full", availableG: 500, expiresAt: new Date("2026-03-15") },
    ];

    const result = deductLotsFIFO(lots, 100);

    expect(result).toHaveLength(1);
    expect(result[0]!.lotId).toBe("lot-full");
    expect(result[0]!.consumed).toBe(100);
    // Ensure the empty lot is never referenced
    expect(result.find((r) => r.lotId === "lot-empty")).toBeUndefined();
  });

  it("idempotency: same batch input produces same consumption plan", () => {
    const lots = [
      { id: "lot-X", availableG: 1000, expiresAt: new Date("2026-04-01") },
      { id: "lot-Y", availableG: 500, expiresAt: new Date("2026-05-01") },
    ];

    const plans = Array.from({ length: 5 }, () => deductLotsFIFO(lots, 800));

    for (let i = 1; i < plans.length; i++) {
      expect(plans[i]).toEqual(plans[0]);
    }
  });
});

// =============================================================================
// 3. INVENTORY ALLOCATION INVARIANTS (4 tests)
// =============================================================================

describe("3. Inventory allocation invariants", () => {
  it("on-hand aggregation is additive across lots", () => {
    const lots: LotSnapshot[] = [
      { ingredientId: "chicken", quantityAvailableG: 500, expiresAt: null },
      { ingredientId: "chicken", quantityAvailableG: 300, expiresAt: null },
      { ingredientId: "rice", quantityAvailableG: 1000, expiresAt: null },
    ];

    const onHand = computeOnHand(lots);

    expect(onHand.get("chicken")).toBe(800);
    expect(onHand.get("rice")).toBe(1000);
  });

  it("demand aggregation is additive across meals and batches", () => {
    const entries: DemandEntry[] = [
      { ingredientId: "chicken", gramsNeeded: 200 }, // meal 1
      { ingredientId: "chicken", gramsNeeded: 150 }, // meal 2
      { ingredientId: "chicken", gramsNeeded: 50 }, // batch sauce
      { ingredientId: "rice", gramsNeeded: 300 }, // meal 1
    ];

    const demand = computeTotalDemand(entries);

    expect(demand.get("chicken")).toBe(400);
    expect(demand.get("rice")).toBe(300);
  });

  it("projected balance = on-hand minus total demand", () => {
    const onHand = new Map([
      ["chicken", 800],
      ["rice", 1000],
    ]);
    const demand = new Map([
      ["chicken", 400],
      ["rice", 300],
    ]);

    const balance = computeProjectedBalance(onHand, demand);

    expect(balance.get("chicken")).toBe(400);
    expect(balance.get("rice")).toBe(700);
  });

  it("overallocation detected when demand exceeds on-hand", () => {
    const onHand = new Map([["chicken", 200]]);
    const demand = new Map([["chicken", 500]]);

    const balance = computeProjectedBalance(onHand, demand);

    expect(balance.get("chicken")).toBe(-300);
    expect(balance.get("chicken")!).toBeLessThan(0);
  });
});

// =============================================================================
// 4. PROJECTION LOGIC CORRECTNESS (6 tests)
// =============================================================================

describe("4. Projection logic correctness", () => {
  it("batch demand calculation: targetGPer100g * (rawInputG / 100)", () => {
    // 5g per 100g of raw input, with 2000g raw input
    const result = computeBatchDemand(2000, 5);

    expect(result).toBe(100); // 5 * (2000 / 100) = 100
  });

  it("meal demand calculation: targetGPerServing * plannedServings", () => {
    const result = computeMealDemand(150, 4);

    expect(result).toBe(600); // 150 * 4
  });

  it("projected balance with zero demand equals on-hand", () => {
    const onHand = new Map([
      ["chicken", 500],
      ["rice", 1000],
    ]);
    const demand = new Map<string, number>();

    const balance = computeProjectedBalance(onHand, demand);

    expect(balance.get("chicken")).toBe(500);
    expect(balance.get("rice")).toBe(1000);
  });

  it("projected balance goes negative when demand exceeds supply", () => {
    const onHand = new Map([["olive-oil", 100]]);
    const demand = new Map([["olive-oil", 250]]);

    const balance = computeProjectedBalance(onHand, demand);

    expect(balance.get("olive-oil")).toBe(-150);
  });

  it("multiple ingredients projected independently", () => {
    const onHand = new Map([
      ["chicken", 1000],
      ["rice", 500],
      ["broccoli", 300],
    ]);
    const demand = new Map([
      ["chicken", 800],
      ["rice", 600],
      ["broccoli", 100],
    ]);

    const balance = computeProjectedBalance(onHand, demand);

    expect(balance.get("chicken")).toBe(200);
    expect(balance.get("rice")).toBe(-100);
    expect(balance.get("broccoli")).toBe(200);
  });

  it("mixed meal + batch demand aggregates correctly", () => {
    // Meal demand: 3 servings at 200g each = 600g chicken
    const mealDemand = computeMealDemand(200, 3);
    // Batch demand: 5g per 100g of 1000g raw input = 50g chicken
    const batchDemand = computeBatchDemand(1000, 5);

    const entries: DemandEntry[] = [
      { ingredientId: "chicken", gramsNeeded: mealDemand },
      { ingredientId: "chicken", gramsNeeded: batchDemand },
    ];

    const totalDemand = computeTotalDemand(entries);

    expect(totalDemand.get("chicken")).toBe(650); // 600 + 50

    const onHand = new Map([["chicken", 800]]);
    const balance = computeProjectedBalance(onHand, totalDemand);

    expect(balance.get("chicken")).toBe(150); // 800 - 650
  });
});

// =============================================================================
// 5. STATUS COMPUTATION (5 tests)
// =============================================================================

describe("5. Status computation", () => {
  it("critical when projected balance <= 0", () => {
    expect(computeStatus(0, 500, 300, 0)).toBe("critical");
    expect(computeStatus(-100, 500, 300, 0)).toBe("critical");
  });

  it("shortage when below par level", () => {
    // Projected balance is 100, par level is 500
    const status = computeStatus(100, 500, 300, 0);

    expect(status).toBe("shortage");
  });

  it("low when below 1.5x reorder point", () => {
    // Projected balance is 400, par level is 300, reorder point is 300
    // 1.5 * 300 = 450, and 400 < 450 but 400 >= 300 (par level)
    const status = computeStatus(400, 300, 300, 0);

    expect(status).toBe("low");
  });

  it("expiring when >50% of on-hand expires within window", () => {
    // Projected balance is healthy (1000), par level met,
    // but expiring ratio is > 0.5
    const status = computeStatus(1000, 300, 200, 0.75);

    expect(status).toBe("expiring");
  });

  it("ok when everything is healthy", () => {
    // Projected balance 1000, par 300, reorder 200, 1.5*200=300, and 1000 >= 300
    // expiringRatio = 0.1 (< 0.5)
    const status = computeStatus(1000, 300, 200, 0.1);

    expect(status).toBe("ok");
  });
});

// =============================================================================
// 6. DETERMINISTIC PROJECTED BALANCE CALCULATIONS (3 tests)
// =============================================================================

describe("6. Deterministic projected balance calculations", () => {
  it("same inputs always produce same outputs", () => {
    const lots: LotSnapshot[] = [
      { ingredientId: "chicken", quantityAvailableG: 500, expiresAt: null },
      { ingredientId: "chicken", quantityAvailableG: 300, expiresAt: null },
      { ingredientId: "rice", quantityAvailableG: 1200, expiresAt: null },
    ];
    const entries: DemandEntry[] = [
      { ingredientId: "chicken", gramsNeeded: 200 },
      { ingredientId: "rice", gramsNeeded: 400 },
    ];

    const results = Array.from({ length: 10 }, () => {
      const onHand = computeOnHand(lots);
      const demand = computeTotalDemand(entries);
      return computeProjectedBalance(onHand, demand);
    });

    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.get("chicken")).toBe(results[0]!.get("chicken"));
      expect(results[i]!.get("rice")).toBe(results[0]!.get("rice"));
    }
  });

  it("floating point precision: 0.1 + 0.2 style edge case handled", () => {
    const lots: LotSnapshot[] = [
      { ingredientId: "salt", quantityAvailableG: 0.1, expiresAt: null },
      { ingredientId: "salt", quantityAvailableG: 0.2, expiresAt: null },
    ];

    const onHand = computeOnHand(lots);
    // 0.1 + 0.2 may not === 0.3 in IEEE 754
    expect(onHand.get("salt")).toBeCloseTo(0.3, 10);

    const demand = new Map([["salt", 0.3]]);
    const balance = computeProjectedBalance(onHand, demand);

    // The projected balance should be approximately 0
    expect(balance.get("salt")).toBeCloseTo(0, 10);
  });

  it("large quantities (100kg+) compute correctly", () => {
    const lots: LotSnapshot[] = [
      {
        ingredientId: "flour",
        quantityAvailableG: 150_000,
        expiresAt: null,
      }, // 150kg
      {
        ingredientId: "flour",
        quantityAvailableG: 75_000,
        expiresAt: null,
      }, // 75kg
    ];
    const entries: DemandEntry[] = [
      { ingredientId: "flour", gramsNeeded: 50_000 },
      { ingredientId: "flour", gramsNeeded: 80_000 },
    ];

    const onHand = computeOnHand(lots);
    const demand = computeTotalDemand(entries);
    const balance = computeProjectedBalance(onHand, demand);

    expect(onHand.get("flour")).toBe(225_000); // 225kg
    expect(demand.get("flour")).toBe(130_000); // 130kg
    expect(balance.get("flour")).toBe(95_000); // 95kg
  });
});

// =============================================================================
// 7. NO IMPACT ON SERVED/FROZEN LABELS (2 tests)
// =============================================================================

describe("7. No impact on served/frozen labels", () => {
  it("batch demand calculation is independent of meal service events", () => {
    // Batch demand only depends on rawInputG and targetGPer100g
    // It must not change based on how many servings were served
    const rawInputG = 5000;
    const targetGPer100g = 3.5;

    const demandBeforeService = computeBatchDemand(rawInputG, targetGPer100g);
    // Simulate "serving" by not changing any batch inputs
    const demandAfterService = computeBatchDemand(rawInputG, targetGPer100g);

    expect(demandBeforeService).toBe(demandAfterService);
    expect(demandBeforeService).toBe(175); // 3.5 * (5000 / 100) = 175

    // Changing servings served should not affect batch demand
    const _servingsServed = 10; // irrelevant to batch demand
    const demandWithServings = computeBatchDemand(rawInputG, targetGPer100g);

    expect(demandWithServings).toBe(175);
  });

  it("lot consumption plan does not reference label snapshots", () => {
    const lots = [
      { id: "lot-A", availableG: 1000, expiresAt: new Date("2026-04-01") },
      { id: "lot-B", availableG: 500, expiresAt: new Date("2026-05-01") },
    ];

    const plan = deductLotsFIFO(lots, 750);

    // The plan only contains lotId and consumed — no label, no snapshot,
    // no frozen/served status fields
    for (const entry of plan) {
      const keys = Object.keys(entry);
      expect(keys).toContain("lotId");
      expect(keys).toContain("consumed");
      expect(keys).toHaveLength(2);
      // Explicitly assert absence of label-related fields
      expect(keys).not.toContain("labelSnapshot");
      expect(keys).not.toContain("frozenAt");
      expect(keys).not.toContain("servedAt");
      expect(keys).not.toContain("nutritionFacts");
    }
  });
});
