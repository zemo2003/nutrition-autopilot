"use client";

import { useState } from "react";

type PortionItem = {
  clientId: string;
  clientName: string;
  mealSlot: string;
  cookedG: number;
  mealScheduleId: string;
};

type DayDemand = {
  serviceDate: string;
  componentId: string;
  componentName: string;
  componentType: string;
  totalCookedG: number;
  rawG: number;
  yieldFactor: number;
  portions: PortionItem[];
};

type PortionPlan = {
  componentId: string;
  componentName: string;
  totalCookedG: number;
  totalRawG: number;
  portionCount: number;
  portions: { label: string; cookedG: number; serviceDate: string; mealSlot: string; clientName: string }[];
};

type Props = {
  perDayBreakdown: DayDemand[];
  portionPlans: PortionPlan[];
  apiBase: string;
  weekStart: string;
  weekEnd: string;
  onBatchCreated?: () => void;
};

function formatG(grams: number): string {
  if (grams >= 1000) return `${(grams / 1000).toFixed(1)} kg`;
  return `${Math.round(grams)} g`;
}

const TYPE_LABELS: Record<string, string> = {
  PROTEIN: "Protein",
  CARB_BASE: "Carb / Base",
  VEGETABLE: "Vegetable",
  SAUCE: "Sauce",
  CONDIMENT: "Condiment",
  OTHER: "Other",
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[d.getUTCDay()]} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export default function ScheduleDemandPanel({ perDayBreakdown, portionPlans, apiBase, weekStart, weekEnd, onBatchCreated }: Props) {
  const [expandedComponents, setExpandedComponents] = useState<Set<string>>(new Set());
  const [creatingBatch, setCreatingBatch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Group day breakdown by component
  const componentGroups = new Map<string, DayDemand[]>();
  for (const day of perDayBreakdown) {
    const existing = componentGroups.get(day.componentId) ?? [];
    existing.push(day);
    componentGroups.set(day.componentId, existing);
  }

  // Get unique components with total demand
  const components = portionPlans.map((plan) => ({
    id: plan.componentId,
    name: plan.componentName,
    totalCookedG: plan.totalCookedG,
    totalRawG: plan.totalRawG,
    portionCount: plan.portionCount,
    days: componentGroups.get(plan.componentId) ?? [],
    type: perDayBreakdown.find((d) => d.componentId === plan.componentId)?.componentType ?? "OTHER",
  }));

  const toggle = (id: string) => {
    setExpandedComponents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateBatch = async (componentId: string) => {
    setCreatingBatch(componentId);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/v1/batches/from-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ componentId, weekStart, weekEnd }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        setError(body.error || `Failed to create batch (${res.status})`);
      } else {
        onBatchCreated?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setCreatingBatch(null);
    }
  };

  if (components.length === 0) {
    return (
      <div className="card" style={{ padding: "var(--sp-4)", textAlign: "center", color: "var(--c-ink-soft)" }}>
        No per-day schedule data available.
      </div>
    );
  }

  return (
    <div style={{ marginTop: "var(--sp-4)" }}>
      <h3 style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)", marginBottom: "var(--sp-3)" }}>
        Schedule Breakdown
        <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-normal)", color: "var(--c-ink-muted)", marginLeft: "var(--sp-2)" }}>
          Per-day portions by client
        </span>
      </h3>

      {error && (
        <div style={{
          padding: "var(--sp-3)",
          marginBottom: "var(--sp-3)",
          background: "var(--c-danger-soft)",
          color: "var(--c-danger)",
          border: "1px solid rgba(239,68,68,0.3)",
          borderRadius: "var(--r-md)",
          fontSize: "var(--text-sm)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span>{error}</span>
          <button className="btn btn-ghost btn-sm" style={{ color: "var(--c-danger)" }} onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="stack-tight">
        {components.map((comp) => {
          const expanded = expandedComponents.has(comp.id);

          return (
            <div key={comp.id} className="card" style={{ padding: 0, overflow: "hidden" }}>
              {/* Header — clickable to expand */}
              <button
                onClick={() => toggle(comp.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "var(--sp-3) var(--sp-4)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  color: "inherit",
                  gap: "var(--sp-3)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: "var(--weight-semibold)" }}>{comp.name}</span>
                    <span className="badge" style={{
                      background: "var(--c-info-soft, rgba(59,130,246,0.1))",
                      color: "var(--c-info)",
                      border: "1px solid rgba(59,130,246,0.2)",
                    }}>
                      {TYPE_LABELS[comp.type] ?? comp.type}
                    </span>
                  </div>
                  <div style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-muted)", marginTop: 2 }}>
                    Total: {formatG(comp.totalRawG)} raw ({formatG(comp.totalCookedG)} cooked) &middot; {comp.portionCount} portions &middot; {comp.days.length} days
                  </div>
                </div>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-muted)", flexShrink: 0 }}>
                  {expanded ? "\u25B2" : "\u25BC"}
                </span>
              </button>

              {/* Expanded day breakdown */}
              {expanded && (
                <div style={{ padding: "0 var(--sp-4) var(--sp-4)", borderTop: "1px solid var(--c-border)" }}>
                  <table className="table" style={{ marginTop: "var(--sp-2)" }}>
                    <thead>
                      <tr>
                        <th>Day</th>
                        <th>Total Cooked</th>
                        <th>Raw</th>
                        <th>Client Portions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comp.days.map((day) => (
                        <tr key={day.serviceDate}>
                          <td style={{ fontWeight: "var(--weight-medium)", whiteSpace: "nowrap" }}>
                            {formatDate(day.serviceDate)}
                          </td>
                          <td>{formatG(day.totalCookedG)}</td>
                          <td style={{ color: "var(--c-ink-muted)" }}>{formatG(day.rawG)}</td>
                          <td>
                            {day.portions.length > 0 ? (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)" }}>
                                {day.portions.map((p, i) => (
                                  <span key={i} className="badge" style={{
                                    background: "var(--c-surface-alt, #f3f4f6)",
                                    color: "var(--c-ink)",
                                    fontSize: "var(--text-xs)",
                                  }}>
                                    {p.clientName} ({p.mealSlot.charAt(0) + p.mealSlot.slice(1).toLowerCase()}) &mdash; {Math.round(p.cookedG)}g
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span style={{ color: "var(--c-ink-muted)", fontSize: "var(--text-xs)" }}>—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Create batch button */}
                  <div style={{ marginTop: "var(--sp-3)", display: "flex", justifyContent: "flex-end" }}>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleCreateBatch(comp.id)}
                      disabled={creatingBatch === comp.id}
                    >
                      {creatingBatch === comp.id ? "Creating..." : "Create Batch with Portions"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
