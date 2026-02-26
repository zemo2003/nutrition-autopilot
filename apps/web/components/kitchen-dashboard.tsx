"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";

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

type Props = {
  counts: {
    activeSkus: number;
    activeIngredients: number;
    lotsOnHand: number;
    schedules: number;
    servedMeals: number;
    labels: number;
    openVerificationTasks: number;
  };
  clients: { id: string; name: string; externalRef?: string }[];
  sauceCount: number;
};

const SLOT_ORDER: Record<string, number> = {
  BREAKFAST: 0, LUNCH: 1, PRE_TRAINING: 2, POST_TRAINING: 3,
  SNACK: 4, DINNER: 5, PRE_BED: 6,
};

function slotClass(slot: string) {
  const s = slot.toLowerCase();
  if (s === "breakfast") return "meal-slot-breakfast";
  if (s === "lunch") return "meal-slot-lunch";
  if (s === "dinner") return "meal-slot-dinner";
  return "meal-slot-snack";
}

function slotLabel(slot: string) {
  return slot.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function KitchenDashboard({ counts, clients, sauceCount }: Props) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const todayISO = new Date().toISOString().slice(0, 10);

  const [overdue, setOverdue] = useState<ScheduleItem[]>([]);
  const [pending, setPending] = useState<ScheduleItem[]>([]);
  const [served, setServed] = useState<ScheduleItem[]>([]);
  const [mealsLoading, setMealsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [servedOpen, setServedOpen] = useState(true);
  const [overdueOpen, setOverdueOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const base = resolveApiBase();
    (async () => {
      try {
        const [plannedRes, todayRes] = await Promise.all([
          fetch(`${base}/v1/schedules?status=PLANNED`, { cache: "no-store" }),
          fetch(`${base}/v1/schedules?from=${todayISO}&to=${todayISO}`, { cache: "no-store" }),
        ]);
        if (!plannedRes.ok || !todayRes.ok) throw new Error("Failed to fetch schedules");
        const [plannedJson, todayJson] = await Promise.all([
          plannedRes.json() as Promise<{ schedules?: ScheduleItem[] }>,
          todayRes.json() as Promise<{ schedules?: ScheduleItem[] }>,
        ]);
        if (cancelled) return;
        const allPlanned = (plannedJson.schedules ?? [])
          .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate) || (SLOT_ORDER[a.mealSlot] ?? 99) - (SLOT_ORDER[b.mealSlot] ?? 99));
        setOverdue(allPlanned.filter((s) => s.serviceDate < todayISO));
        setPending(allPlanned.filter((s) => s.serviceDate === todayISO));
        const todayDone = (todayJson.schedules ?? [])
          .filter((s) => s.status === "DONE")
          .sort((a, b) => (SLOT_ORDER[a.mealSlot] ?? 99) - (SLOT_ORDER[b.mealSlot] ?? 99));
        setServed(todayDone);
      } catch {
        // silently fail — KPIs still show from server data
      } finally {
        if (!cancelled) setMealsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [todayISO]);

  const handleFed = useCallback(async (scheduleId: string) => {
    setActionLoading((prev) => ({ ...prev, [scheduleId]: "DONE" }));
    setErrors((prev) => { const n = { ...prev }; delete n[scheduleId]; return n; });
    try {
      const res = await fetch(`${resolveApiBase()}/v1/schedule/${scheduleId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(body.error || "Request failed");
      }
      // Remove from whichever list it belongs to
      setPending((prev) => {
        const meal = prev.find((s) => s.id === scheduleId);
        if (meal) setServed((s) => [...s, { ...meal, status: "DONE" }]);
        return prev.filter((s) => s.id !== scheduleId);
      });
      setOverdue((prev) => prev.filter((s) => s.id !== scheduleId));
    } catch (err: any) {
      setErrors((prev) => ({ ...prev, [scheduleId]: err?.message || "Failed" }));
    } finally {
      setActionLoading((prev) => { const n = { ...prev }; delete n[scheduleId]; return n; });
    }
  }, []);

  return (
    <div className="page-shell">
      {/* Hero greeting */}
      <div className="kitchen-hero">
        <h1 className="kitchen-hero-title">Good morning, chef.</h1>
        <p className="kitchen-hero-date">{today}</p>
        <div className="kitchen-hero-summary">
          <span className="hero-stat">{counts.schedules} meals scheduled</span>
          <span className="hero-sep">&middot;</span>
          <span className="hero-stat">{counts.lotsOnHand} lots on hand</span>
          {counts.openVerificationTasks > 0 && (
            <>
              <span className="hero-sep">&middot;</span>
              <span className="hero-stat hero-stat-warn">{counts.openVerificationTasks} alerts</span>
            </>
          )}
        </div>
      </div>

      {/* Overdue — unfed meals from past days */}
      {!mealsLoading && overdue.length > 0 && (
        <section className="section">
          <h2
            className="section-title"
            style={{ cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: "var(--sp-2)", color: "var(--c-danger, #c0392b)" }}
            onClick={() => setOverdueOpen((o) => !o)}
          >
            <span style={{
              display: "inline-block",
              transition: "transform 0.2s",
              transform: overdueOpen ? "rotate(90deg)" : "rotate(0deg)",
              fontSize: "0.75em",
            }}>&#9654;</span>
            Overdue ({overdue.length})
          </h2>
          {overdueOpen && overdue.map((meal) => (
            <div key={meal.id} className="meal-card" style={{ borderLeftColor: "var(--c-danger, #c0392b)" }}>
              <div className="meal-info">
                <div className="meal-name">{meal.skuName ?? "Untitled"}</div>
                <div className="meal-time">
                  <span className={`meal-slot ${slotClass(meal.mealSlot)}`}>
                    {slotLabel(meal.mealSlot)}
                  </span>
                  {" "}
                  <span>{meal.clientName}</span>
                  <span style={{ color: "var(--c-ink-muted)", marginLeft: "var(--sp-2)", fontSize: "var(--text-xs)" }}>
                    {new Date(meal.serviceDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                  </span>
                </div>
              </div>
              <div className="meal-actions">
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!!actionLoading[meal.id]}
                  onClick={() => handleFed(meal.id)}
                >
                  {actionLoading[meal.id] === "DONE" ? "Saving\u2026" : "Fed"}
                </button>
              </div>
              {errors[meal.id] && (
                <div className="alert error" style={{ marginTop: "var(--sp-2)", fontSize: "var(--text-xs)" }}>
                  {errors[meal.id]}
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Today's Meals */}
      <section className="section">
        <h2 className="section-title">Today&apos;s Meals</h2>
        {mealsLoading ? (
          <div className="loading-shimmer loading-block" style={{ height: 80 }} />
        ) : pending.length === 0 && served.length === 0 ? (
          <p style={{ color: "var(--c-ink-muted)", fontSize: "var(--text-sm)" }}>
            All caught up &mdash; no meals left for today.
          </p>
        ) : pending.length === 0 ? (
          <p style={{ color: "var(--c-ink-muted)", fontSize: "var(--text-sm)" }}>
            No pending meals &mdash; all served!
          </p>
        ) : (
          pending.map((meal) => (
            <div key={meal.id} className="meal-card">
              <div className="meal-info">
                <div className="meal-name">{meal.skuName ?? "Untitled"}</div>
                <div className="meal-time">
                  <span className={`meal-slot ${slotClass(meal.mealSlot)}`}>
                    {slotLabel(meal.mealSlot)}
                  </span>
                  {" "}
                  <span>{meal.clientName}</span>
                </div>
              </div>
              <div className="meal-actions">
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!!actionLoading[meal.id]}
                  onClick={() => handleFed(meal.id)}
                >
                  {actionLoading[meal.id] === "DONE" ? "Saving\u2026" : "Fed"}
                </button>
              </div>
              {errors[meal.id] && (
                <div className="alert error" style={{ marginTop: "var(--sp-2)", fontSize: "var(--text-xs)" }}>
                  {errors[meal.id]}
                </div>
              )}
            </div>
          ))
        )}
      </section>

      {/* Served Today */}
      {!mealsLoading && served.length > 0 && (
        <section className="section">
          <h2
            className="section-title"
            style={{ cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: "var(--sp-2)" }}
            onClick={() => setServedOpen((o) => !o)}
          >
            <span style={{
              display: "inline-block",
              transition: "transform 0.2s",
              transform: servedOpen ? "rotate(90deg)" : "rotate(0deg)",
              fontSize: "0.75em",
            }}>&#9654;</span>
            Served Today ({served.length})
          </h2>
          {servedOpen && served.map((meal) => (
            <div key={meal.id} className="meal-card" data-status="done">
              <div className="meal-info">
                <div className="meal-name">{meal.skuName ?? "Untitled"}</div>
                <div className="meal-time">
                  <span className={`meal-slot ${slotClass(meal.mealSlot)}`}>
                    {slotLabel(meal.mealSlot)}
                  </span>
                  {" "}
                  <span>{meal.clientName}</span>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Quick actions */}
      <section className="section">
        <div className="quick-actions">
          <Link href={"/batch-prep" as any} className="quick-action-card">
            <div className="quick-action-icon">+</div>
            <span>New Batch</span>
          </Link>
          <Link href={"/kitchen/print/pull-list" as any} className="quick-action-card">
            <div className="quick-action-icon">&#x1f4cb;</div>
            <span>Pull List</span>
          </Link>
          <Link href={"/kitchen/print/daily-summary" as any} className="quick-action-card">
            <div className="quick-action-icon">&#x1f4c4;</div>
            <span>Daily Summary</span>
          </Link>
          <Link href={"/kitchen" as any} className="quick-action-card quick-action-live">
            <div className="quick-action-icon">&#x25b6;</div>
            <span>Go Live</span>
          </Link>
        </div>
      </section>

      {/* At a glance */}
      <section className="section">
        <h2 className="section-title">At a Glance</h2>
        <div className="kpi-grid">
          <Link href={"/prep-plan" as any} className="kpi" style={{ textDecoration: "none", cursor: "pointer" }}>
            <div className="kpi-value">{counts.schedules}</div>
            <div className="kpi-label">Upcoming Meals</div>
          </Link>
          <Link href={"/pantry" as any} className="kpi" style={{ textDecoration: "none", cursor: "pointer" }}>
            <div className="kpi-value">{counts.lotsOnHand}</div>
            <div className="kpi-label">Inventory Lots</div>
          </Link>
          <Link href={"/pantry" as any} className="kpi" style={{ textDecoration: "none", cursor: "pointer" }}>
            <div className="kpi-value">{sauceCount}</div>
            <div className="kpi-label">Sauces</div>
          </Link>
          <Link href={"/prep-plan" as any} className="kpi" style={{ textDecoration: "none", cursor: "pointer" }}>
            <div className="kpi-value">{counts.activeSkus}</div>
            <div className="kpi-label">Active SKUs</div>
          </Link>
        </div>
      </section>

      {/* Clients */}
      {clients.length > 0 && (
        <section className="section">
          <h2 className="section-title">Clients</h2>
          <div className="client-grid">
            {clients.map((client) => (
              <Link
                key={client.id}
                href={`/clients/${client.id}/calendar`}
                className="client-card"
              >
                <div className="client-avatar">
                  {client.name.charAt(0).toUpperCase()}
                </div>
                <div className="client-card-info">
                  <div className="client-card-name">{client.name}</div>
                  {client.externalRef && (
                    <div className="client-card-meta">{client.externalRef}</div>
                  )}
                </div>
                <span className="client-card-arrow">&rarr;</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
