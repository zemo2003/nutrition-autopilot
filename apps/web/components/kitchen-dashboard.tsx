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
  const [mealsError, setMealsError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [servedOpen, setServedOpen] = useState(true);
  const [overdueOpen, setOverdueOpen] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Dashboard summary cards
  const [dashSummary, setDashSummary] = useState<{
    activeBatches: number;
    lowInventory: number;
    pendingVerifications: number;
  } | null>(null);
  const [dashError, setDashError] = useState<string | null>(null);

  // Label warning modal
  const [labelWarningModal, setLabelWarningModal] = useState<{
    scheduleId: string;
    warnings: string[];
  } | null>(null);

  const fetchMeals = useCallback(async () => {
    setMealsError(null);
    const base = resolveApiBase();
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
      const allPlanned = (plannedJson.schedules ?? [])
        .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate) || (SLOT_ORDER[a.mealSlot] ?? 99) - (SLOT_ORDER[b.mealSlot] ?? 99));
      setOverdue(allPlanned.filter((s) => s.serviceDate < todayISO));
      setPending(allPlanned.filter((s) => s.serviceDate === todayISO));
      const todayDone = (todayJson.schedules ?? [])
        .filter((s) => s.status === "DONE")
        .sort((a, b) => (SLOT_ORDER[a.mealSlot] ?? 99) - (SLOT_ORDER[b.mealSlot] ?? 99));
      setServed(todayDone);
    } catch (err) {
      setMealsError(err instanceof Error ? err.message : "Failed to load meal schedules");
    } finally {
      setMealsLoading(false);
    }
  }, [todayISO]);

  const fetchDashSummary = useCallback(async () => {
    setDashError(null);
    const base = resolveApiBase();
    try {
      const [batchRes, projRes, verifyRes] = await Promise.all([
        fetch(`${base}/v1/batches?status=IN_PREP,COOKING,CHILLING,PORTIONED`, { cache: "no-store" }),
        fetch(`${base}/v1/inventory/projections`, { cache: "no-store" }),
        fetch(`${base}/v1/verification/tasks?status=OPEN`, { cache: "no-store" }),
      ]);

      let activeBatches = 0;
      if (batchRes.ok) {
        const data = await batchRes.json();
        activeBatches = (data.batches ?? []).length;
      }

      let lowInventory = 0;
      if (projRes.ok) {
        const data = await projRes.json();
        const projections = data.projections ?? data ?? [];
        if (Array.isArray(projections)) {
          lowInventory = projections.filter(
            (p: any) => typeof p.currentQtyG === "number" && typeof p.parLevelG === "number" && p.currentQtyG < p.parLevelG
          ).length;
        }
      }

      let pendingVerifications = 0;
      if (verifyRes.ok) {
        const data = await verifyRes.json();
        pendingVerifications = (data.tasks ?? []).length;
      }

      setDashSummary({ activeBatches, lowInventory, pendingVerifications });
    } catch {
      setDashError("Failed to load dashboard summary");
    }
  }, []);

  useEffect(() => {
    fetchMeals();
    fetchDashSummary();
  }, [fetchMeals, fetchDashSummary]);

  const executeFed = useCallback(async (scheduleId: string) => {
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

  const handleFed = useCallback(async (scheduleId: string) => {
    setActionLoading((prev) => ({ ...prev, [scheduleId]: "checking" }));
    try {
      const previewRes = await fetch(`${resolveApiBase()}/v1/schedules/${scheduleId}/label-preview`, { cache: "no-store" });
      if (previewRes.ok) {
        const preview = await previewRes.json();
        if (preview.warnings && preview.warnings.length > 0) {
          setActionLoading((prev) => { const n = { ...prev }; delete n[scheduleId]; return n; });
          setLabelWarningModal({ scheduleId, warnings: preview.warnings });
          return;
        }
      }
      // No warnings or preview unavailable — proceed directly
      setActionLoading((prev) => { const n = { ...prev }; delete n[scheduleId]; return n; });
      await executeFed(scheduleId);
    } catch {
      // If preview check fails, just proceed with feeding
      setActionLoading((prev) => { const n = { ...prev }; delete n[scheduleId]; return n; });
      await executeFed(scheduleId);
    }
  }, [executeFed]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    const allPendingIds = [...overdue, ...pending].map((m) => m.id);
    setSelected((prev) =>
      prev.size === allPendingIds.length ? new Set() : new Set(allPendingIds)
    );
  }, [overdue, pending]);

  const handleBulkMark = useCallback(async (status: "DONE" | "SKIPPED") => {
    if (selected.size === 0) return;
    setBulkLoading(true);
    setBulkError(null);
    try {
      const res = await fetch(`${resolveApiBase()}/v1/schedules/bulk-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: Array.from(selected), status }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(body.error || `Bulk update failed (${res.status})`);
      }
      const result = await res.json();
      if (result.freezeWarnings?.length > 0) {
        setBulkError(`Updated ${result.updated} meals. Warnings: ${result.freezeWarnings.join("; ")}`);
      }
      setSelected(new Set());
      fetchMeals();
    } catch (err: any) {
      setBulkError(err?.message || "Bulk update failed");
    } finally {
      setBulkLoading(false);
    }
  }, [selected, fetchMeals]);

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

      {/* Dashboard summary cards */}
      {dashSummary && (
        <section className="section">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "var(--sp-3)",
          }}>
            <Link href={"/batch-prep" as any} style={{ textDecoration: "none" }}>
              <div className="kpi" style={{ cursor: "pointer" }}>
                <div className="kpi-value">{dashSummary.activeBatches}</div>
                <div className="kpi-label">Active Batches</div>
              </div>
            </Link>
            <Link href={"/pantry" as any} style={{ textDecoration: "none" }}>
              <div className="kpi" style={{
                cursor: "pointer",
                ...(dashSummary.lowInventory > 0 ? { borderColor: "var(--c-warning)", background: "var(--c-warning-soft, rgba(255,193,7,0.08))" } : {}),
              }}>
                <div className="kpi-value" style={dashSummary.lowInventory > 0 ? { color: "var(--c-warning)" } : {}}>
                  {dashSummary.lowInventory}
                </div>
                <div className="kpi-label">Low Inventory</div>
              </div>
            </Link>
            <Link href={"/verification" as any} style={{ textDecoration: "none" }}>
              <div className="kpi" style={{
                cursor: "pointer",
                ...(dashSummary.pendingVerifications > 0 ? { borderColor: "var(--c-danger)", background: "var(--c-danger-soft, rgba(239,68,68,0.08))" } : {}),
              }}>
                <div className="kpi-value" style={dashSummary.pendingVerifications > 0 ? { color: "var(--c-danger)" } : {}}>
                  {dashSummary.pendingVerifications}
                </div>
                <div className="kpi-label">Pending Verifications</div>
              </div>
            </Link>
          </div>
          {dashError && (
            <div style={{
              marginTop: "var(--sp-2)", padding: "var(--sp-2) var(--sp-3)",
              background: "var(--c-danger-soft)", color: "var(--c-danger)",
              borderRadius: "var(--r-md)", fontSize: "var(--text-xs)",
            }}>
              {dashError}
            </div>
          )}
        </section>
      )}

      {/* Meals fetch error */}
      {mealsError && (
        <section className="section">
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: "var(--sp-3)", padding: "var(--sp-3) var(--sp-4)",
            background: "var(--c-danger-soft)", color: "var(--c-danger)",
            border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--r-md)", fontSize: "var(--text-sm)",
          }}>
            <span>{mealsError}</span>
            <button className="btn btn-sm" style={{ background: "var(--c-danger)", color: "#fff" }}
              onClick={() => { setMealsLoading(true); fetchMeals(); }}>
              Retry
            </button>
          </div>
        </section>
      )}

      {/* Bulk action bar */}
      {!mealsLoading && (overdue.length > 0 || pending.length > 0) && (
        <section className="section">
          <div style={{
            display: "flex", alignItems: "center", gap: "var(--sp-3)",
            padding: "var(--sp-2) var(--sp-3)",
            background: "var(--c-surface-raised, #f8f9fa)",
            borderRadius: "var(--r-md)",
            fontSize: "var(--text-sm)",
            flexWrap: "wrap",
          }}>
            <label style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={selected.size > 0 && selected.size === overdue.length + pending.length}
                onChange={toggleSelectAll}
                style={{ width: 16, height: 16 }}
              />
              Select All
            </label>
            {selected.size > 0 && (
              <>
                <span style={{ color: "var(--c-ink-muted)" }}>
                  {selected.size} selected
                </span>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={bulkLoading}
                  onClick={() => handleBulkMark("DONE")}
                >
                  {bulkLoading ? "Saving\u2026" : `Mark ${selected.size} as Fed`}
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  disabled={bulkLoading}
                  onClick={() => handleBulkMark("SKIPPED")}
                >
                  {bulkLoading ? "Saving\u2026" : "Skip Selected"}
                </button>
              </>
            )}
          </div>
          {bulkError && (
            <div style={{
              marginTop: "var(--sp-2)", padding: "var(--sp-2) var(--sp-3)",
              background: "var(--c-danger-soft)", color: "var(--c-danger)",
              borderRadius: "var(--r-md)", fontSize: "var(--text-xs)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <span>{bulkError}</span>
              <button className="btn btn-ghost btn-sm" style={{ color: "var(--c-danger)" }}
                onClick={() => setBulkError(null)}>Dismiss</button>
            </div>
          )}
        </section>
      )}

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
              <input
                type="checkbox"
                checked={selected.has(meal.id)}
                onChange={() => toggleSelect(meal.id)}
                style={{ width: 16, height: 16, flexShrink: 0, marginRight: "var(--sp-2)" }}
              />
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
              <input
                type="checkbox"
                checked={selected.has(meal.id)}
                onChange={() => toggleSelect(meal.id)}
                style={{ width: 16, height: 16, flexShrink: 0, marginRight: "var(--sp-2)" }}
              />
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

      {/* Label warning confirmation modal */}
      {labelWarningModal && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.5)", padding: "var(--sp-4)",
          }}
          onClick={() => setLabelWarningModal(null)}
        >
          <div
            style={{
              background: "var(--c-surface, #fff)", borderRadius: "var(--r-lg, 12px)",
              padding: "var(--sp-5, 24px)", maxWidth: 440, width: "100%",
              boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 var(--sp-3, 12px) 0", fontSize: "var(--text-lg, 18px)" }}>
              Label Warnings
            </h3>
            <p style={{ margin: "0 0 var(--sp-3, 12px) 0", fontSize: "var(--text-sm)", color: "var(--c-ink-muted)" }}>
              This meal has label issues that will be frozen when marked as Fed:
            </p>
            <ul style={{
              margin: "0 0 var(--sp-4, 16px) 0", paddingLeft: "var(--sp-4, 16px)",
              fontSize: "var(--text-sm)", color: "var(--c-danger)",
            }}>
              {labelWarningModal.warnings.map((w, i) => (
                <li key={i} style={{ marginBottom: "var(--sp-1, 4px)" }}>{w}</li>
              ))}
            </ul>
            <div style={{ display: "flex", gap: "var(--sp-2)", justifyContent: "flex-end" }}>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => setLabelWarningModal(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  const sid = labelWarningModal.scheduleId;
                  setLabelWarningModal(null);
                  executeFed(sid);
                }}
              >
                Mark Fed Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
