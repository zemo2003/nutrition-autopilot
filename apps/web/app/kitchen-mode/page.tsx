"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

function resolveApiBase() {
  if (process.env.NEXT_PUBLIC_API_BASE) return process.env.NEXT_PUBLIC_API_BASE;
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host.includes("onrender.com")) {
      return `${window.location.protocol}//${host.replace("-web", "-api")}`;
    }
    return `${window.location.protocol}//${host}:4000`;
  }
  return "http://localhost:4000";
}

type ScheduleItem = {
  id: string;
  clientName: string;
  skuName: string | null;
  serviceDate: string;
  mealSlot: string;
  status: string;
  plannedServings: number;
};

const SLOT_ORDER: Record<string, number> = {
  BREAKFAST: 0, LUNCH: 1, PRE_TRAINING: 2, POST_TRAINING: 3,
  SNACK: 4, DINNER: 5, PRE_BED: 6,
};

function slotLabel(slot: string) {
  return slot.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function slotColor(slot: string): string {
  const s = slot.toLowerCase();
  if (s === "breakfast") return "#f59e0b";
  if (s === "lunch") return "#3b82f6";
  if (s === "dinner") return "#8b5cf6";
  return "#6b7280";
}

export default function KitchenModePage() {
  const todayISO = new Date().toISOString().slice(0, 10);
  const [meals, setMeals] = useState<ScheduleItem[]>([]);
  const [served, setServed] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set());
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMeals = useCallback(async () => {
    const base = resolveApiBase();
    try {
      const [plannedRes, todayRes] = await Promise.all([
        fetch(`${base}/v1/schedules?status=PLANNED&from=${todayISO}&to=${todayISO}`, { cache: "no-store" }),
        fetch(`${base}/v1/schedules?from=${todayISO}&to=${todayISO}`, { cache: "no-store" }),
      ]);
      if (!plannedRes.ok || !todayRes.ok) throw new Error("Failed to fetch");
      const [plannedJson, todayJson] = await Promise.all([
        plannedRes.json() as Promise<{ schedules?: ScheduleItem[] }>,
        todayRes.json() as Promise<{ schedules?: ScheduleItem[] }>,
      ]);
      const pending = (plannedJson.schedules ?? [])
        .filter((s) => s.serviceDate === todayISO)
        .sort((a, b) => (SLOT_ORDER[a.mealSlot] ?? 99) - (SLOT_ORDER[b.mealSlot] ?? 99));
      const done = (todayJson.schedules ?? [])
        .filter((s) => s.status === "DONE")
        .sort((a, b) => (SLOT_ORDER[a.mealSlot] ?? 99) - (SLOT_ORDER[b.mealSlot] ?? 99));
      setMeals(pending);
      setServed(done);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load meals");
    } finally {
      setLoading(false);
    }
  }, [todayISO]);

  useEffect(() => {
    fetchMeals();
    refreshTimer.current = setInterval(fetchMeals, 30000);
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
  }, [fetchMeals]);

  const handleFed = useCallback(async (id: string) => {
    setActionLoading((prev) => new Set([...prev, id]));
    try {
      const res = await fetch(`${resolveApiBase()}/v1/schedule/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      });
      if (!res.ok) throw new Error("Failed");
      setMeals((prev) => {
        const meal = prev.find((m) => m.id === id);
        if (meal) setServed((s) => [...s, { ...meal, status: "DONE" }]);
        return prev.filter((m) => m.id !== id);
      });
    } catch {
      // Silently handled — meal stays in list
    } finally {
      setActionLoading((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const handleBulkFed = useCallback(async () => {
    const ids = meals.map((m) => m.id);
    if (ids.length === 0) return;
    setActionLoading(new Set(ids));
    try {
      const res = await fetch(`${resolveApiBase()}/v1/schedules/bulk-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: ids, status: "DONE" }),
      });
      if (res.ok) {
        fetchMeals();
      }
    } catch {
      // Will refresh on next cycle
    } finally {
      setActionLoading(new Set());
    }
  }, [meals, fetchMeals]);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--c-surface, #f8f9fa)",
      padding: "env(safe-area-inset-top, 0) var(--sp-4) var(--sp-4)",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "var(--sp-4) 0",
      }}>
        <div>
          <h1 style={{ fontSize: "var(--text-xl, 24px)", fontWeight: 700, margin: 0 }}>
            Kitchen Mode
          </h1>
          <p style={{ margin: 0, color: "var(--c-ink-muted)", fontSize: "var(--text-sm)" }}>
            {today}
          </p>
        </div>
        <div style={{ display: "flex", gap: "var(--sp-2)" }}>
          {meals.length > 1 && (
            <button
              className="btn btn-primary"
              style={{ minHeight: 48, fontSize: "var(--text-md, 16px)" }}
              onClick={handleBulkFed}
              disabled={actionLoading.size > 0}
            >
              Mark All Fed ({meals.length})
            </button>
          )}
          <Link href="/" className="btn btn-outline" style={{ minHeight: 48 }}>
            Exit
          </Link>
        </div>
      </div>

      {error && (
        <div style={{
          padding: "var(--sp-3) var(--sp-4)", marginBottom: "var(--sp-3)",
          background: "var(--c-danger-soft)", color: "var(--c-danger)",
          borderRadius: "var(--r-md)", fontSize: "var(--text-sm)",
        }}>
          {error}
        </div>
      )}

      {/* Stats bar */}
      <div style={{
        display: "flex", gap: "var(--sp-4)", marginBottom: "var(--sp-4)",
        justifyContent: "center",
      }}>
        <div style={{
          padding: "var(--sp-3) var(--sp-5)",
          background: meals.length > 0 ? "var(--c-primary, #4f46e5)" : "var(--c-success, #22c55e)",
          color: "#fff", borderRadius: "var(--r-lg, 12px)",
          textAlign: "center", fontSize: "var(--text-lg, 18px)", fontWeight: 700,
        }}>
          {meals.length} pending
        </div>
        <div style={{
          padding: "var(--sp-3) var(--sp-5)",
          background: "var(--c-surface, #fff)", borderRadius: "var(--r-lg, 12px)",
          textAlign: "center", fontSize: "var(--text-lg, 18px)", fontWeight: 700,
          border: "1px solid var(--c-border, #e5e7eb)",
        }}>
          {served.length} served
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="loading-shimmer" style={{ height: 100, borderRadius: "var(--r-lg, 12px)" }} />
          ))}
        </div>
      )}

      {/* Meal cards */}
      {!loading && meals.length === 0 && served.length === 0 && (
        <div style={{
          textAlign: "center", padding: "var(--sp-8)",
          fontSize: "var(--text-lg, 18px)", color: "var(--c-ink-muted)",
        }}>
          All caught up — no meals for today!
        </div>
      )}

      {!loading && meals.length === 0 && served.length > 0 && (
        <div style={{
          textAlign: "center", padding: "var(--sp-6)",
          fontSize: "var(--text-lg, 18px)", color: "var(--c-success, #22c55e)",
          fontWeight: 600,
        }}>
          All {served.length} meals served!
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
        {meals.map((meal) => (
          <div key={meal.id} style={{
            display: "flex", alignItems: "center",
            padding: "var(--sp-4)", gap: "var(--sp-4)",
            background: "var(--c-surface, #fff)",
            borderRadius: "var(--r-lg, 12px)",
            border: "1px solid var(--c-border, #e5e7eb)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          }}>
            {/* Slot indicator */}
            <div style={{
              width: 6, minHeight: 60, borderRadius: 3,
              background: slotColor(meal.mealSlot), flexShrink: 0,
            }} />

            {/* Meal info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "var(--text-lg, 18px)", fontWeight: 600, marginBottom: 4 }}>
                {meal.skuName ?? "Untitled Meal"}
              </div>
              <div style={{ fontSize: "var(--text-sm, 14px)", color: "var(--c-ink-muted)" }}>
                <span style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  borderRadius: "var(--r-sm, 4px)",
                  background: slotColor(meal.mealSlot) + "20",
                  color: slotColor(meal.mealSlot),
                  fontWeight: 600,
                  fontSize: "var(--text-xs, 12px)",
                  marginRight: 8,
                }}>
                  {slotLabel(meal.mealSlot)}
                </span>
                {meal.clientName}
                {meal.plannedServings > 1 && ` \u00d7${meal.plannedServings}`}
              </div>
            </div>

            {/* Fed button — large touch target */}
            <button
              onClick={() => handleFed(meal.id)}
              disabled={actionLoading.has(meal.id)}
              style={{
                minWidth: 80, minHeight: 56,
                padding: "var(--sp-3) var(--sp-4)",
                fontSize: "var(--text-md, 16px)", fontWeight: 700,
                background: actionLoading.has(meal.id) ? "var(--c-ink-muted)" : "var(--c-success, #22c55e)",
                color: "#fff", border: "none", borderRadius: "var(--r-md, 8px)",
                cursor: actionLoading.has(meal.id) ? "wait" : "pointer",
                flexShrink: 0,
                touchAction: "manipulation",
              }}
            >
              {actionLoading.has(meal.id) ? "\u2026" : "Fed"}
            </button>
          </div>
        ))}
      </div>

      {/* Served meals — collapsed by default */}
      {!loading && served.length > 0 && (
        <details style={{ marginTop: "var(--sp-4)" }}>
          <summary style={{
            cursor: "pointer", fontWeight: 600, fontSize: "var(--text-md, 16px)",
            padding: "var(--sp-3) 0", color: "var(--c-ink-muted)",
          }}>
            Served Today ({served.length})
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            {served.map((meal) => (
              <div key={meal.id} style={{
                display: "flex", alignItems: "center",
                padding: "var(--sp-3) var(--sp-4)", gap: "var(--sp-3)",
                background: "var(--c-surface, #fff)",
                borderRadius: "var(--r-md, 8px)",
                border: "1px solid var(--c-border, #e5e7eb)",
                opacity: 0.6,
              }}>
                <div style={{
                  width: 4, minHeight: 40, borderRadius: 2,
                  background: "var(--c-success, #22c55e)", flexShrink: 0,
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>{meal.skuName ?? "Untitled"}</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)" }}>
                    {slotLabel(meal.mealSlot)} \u00b7 {meal.clientName}
                  </div>
                </div>
                <span style={{
                  fontSize: "var(--text-xs)", color: "var(--c-success, #22c55e)",
                  fontWeight: 600,
                }}>
                  Done
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Auto-refresh indicator */}
      <div style={{
        textAlign: "center", marginTop: "var(--sp-4)",
        fontSize: "var(--text-xs)", color: "var(--c-ink-muted)",
      }}>
        Auto-refreshes every 30s
      </div>
    </div>
  );
}
