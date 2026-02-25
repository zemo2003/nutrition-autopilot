"use client";

import { useCallback, useEffect, useState } from "react";

/* ── API Base ─────────────────────────────────────────────── */

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

/* ── Types ────────────────────────────────────────────────── */

type InventoryProjection = {
  ingredientId: string;
  ingredientName: string;
  category: string;
  onHandG: number;
  demand7dG: number;
  projectedG: number;
  parLevelG: number | null;
  reorderPointG: number | null;
  status: "critical" | "shortage" | "low" | "expiring" | "ok";
  lots: InventoryLot[];
};

type InventoryLot = {
  id: string;
  productName: string;
  ingredientName: string;
  lotCode: string | null;
  receivedAt: string;
  expiresAt: string | null;
  quantityReceivedG: number;
  quantityAvailableG: number;
  storageLocation: string;
  sourceOrderRef: string | null;
};

type DayForecast = {
  date: string;
  totalDemandG: number;
  ingredients: { ingredientName: string; demandG: number }[];
};

type WasteEntry = {
  ingredientName: string;
  totalWasteG: number;
  reason: "WASTE" | "SPOILAGE";
  count: number;
};

type Alert = {
  lotId: string;
  productName: string;
  alertType: "LOW_STOCK" | "EXPIRING_SOON";
  details: string;
};

/* ── Constants ────────────────────────────────────────────── */

const STATUS_SEVERITY: Record<string, number> = {
  critical: 0,
  shortage: 1,
  low: 2,
  expiring: 3,
  ok: 4,
};

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  critical: { bg: "var(--c-danger-soft)", color: "var(--c-danger)" },
  shortage: { bg: "var(--c-danger-soft)", color: "var(--c-danger)" },
  low: { bg: "var(--c-warn-soft)", color: "var(--c-warn)" },
  expiring: { bg: "var(--c-warn-soft)", color: "var(--c-warn)" },
  ok: { bg: "var(--c-success-soft)", color: "var(--c-success)" },
};

/* ── Helpers ──────────────────────────────────────────────── */

function formatG(grams: number): string {
  const abs = Math.abs(grams);
  if (abs >= 1000) return `${(grams / 1000).toFixed(1)} kg`;
  return `${Math.round(grams)} g`;
}

function formatKg(grams: number): string {
  return `${(grams / 1000).toFixed(1)} kg`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

/* ── Loading Skeleton ─────────────────────────────────────── */

function LoadingSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      {/* KPI skeleton */}
      <div className="kpi-grid">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="kpi">
            <div className="loading-shimmer loading-bar" style={{ width: "60%", height: 28, marginBottom: "var(--sp-2)" }} />
            <div className="loading-shimmer loading-bar" style={{ width: "80%", height: 14 }} />
          </div>
        ))}
      </div>
      {/* Table skeleton */}
      <div className="card" style={{ padding: "var(--sp-5)" }}>
        <div className="loading-shimmer loading-bar" style={{ width: "30%", height: 18, marginBottom: "var(--sp-4)" }} />
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="loading-shimmer" style={{ height: 48, borderRadius: "var(--r-md)", marginBottom: "var(--sp-2)" }} />
        ))}
      </div>
      {/* Forecast skeleton */}
      <div className="card" style={{ padding: "var(--sp-5)" }}>
        <div className="loading-shimmer loading-bar" style={{ width: "40%", height: 18, marginBottom: "var(--sp-4)" }} />
        <div style={{ display: "flex", gap: "var(--sp-3)", overflowX: "auto" }}>
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="loading-shimmer" style={{ minWidth: 120, height: 80, borderRadius: "var(--r-md)" }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Error Banner ─────────────────────────────────────────── */

function ErrorBanner({ message, onRetry, onDismiss }: { message: string; onRetry: () => void; onDismiss: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--sp-3)",
        padding: "var(--sp-3) var(--sp-4)",
        marginBottom: "var(--sp-4)",
        background: "var(--c-danger-soft)",
        color: "var(--c-danger)",
        border: "1px solid rgba(239,68,68,0.3)",
        borderRadius: "var(--r-md)",
        fontSize: "var(--text-sm)",
      }}
    >
      <span>{message}</span>
      <div style={{ display: "flex", gap: "var(--sp-2)", flexShrink: 0 }}>
        <button
          className="btn btn-sm"
          style={{ background: "var(--c-danger)", color: "#fff" }}
          onClick={onRetry}
        >
          Retry
        </button>
        <button
          className="btn btn-ghost btn-sm"
          style={{ color: "var(--c-danger)" }}
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

/* ── Status Badge ─────────────────────────────────────────── */

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] ?? { bg: "var(--c-surface-alt)", color: "var(--c-ink-muted)" };
  return (
    <span
      className="badge"
      style={{
        background: colors.bg,
        color: colors.color,
        border: `1px solid ${colors.color}33`,
        fontWeight: "var(--weight-semibold)" as string,
        textTransform: "capitalize",
      }}
    >
      {status}
    </span>
  );
}

/* ── Alert Banners ────────────────────────────────────────── */

function AlertBanners({ projections }: { projections: InventoryProjection[] }) {
  const critical = projections.filter((p) => p.status === "critical");
  const shortage = projections.filter((p) => p.status === "shortage");

  if (critical.length === 0 && shortage.length === 0) return null;

  return (
    <div className="stack-tight" style={{ marginBottom: "var(--sp-4)" }}>
      {critical.length > 0 && (
        <div
          style={{
            padding: "var(--sp-3) var(--sp-4)",
            borderRadius: "var(--r-md)",
            background: "var(--c-danger-soft)",
            color: "var(--c-danger)",
            border: "1px solid rgba(239,68,68,0.3)",
            fontSize: "var(--text-sm)",
          }}
        >
          <strong style={{ display: "block", marginBottom: "var(--sp-1)" }}>
            Critical Stock Alert
          </strong>
          {critical.map((item) => (
            <div key={item.ingredientId} style={{ marginTop: "var(--sp-1)" }}>
              {item.ingredientName} — projected shortfall of {formatG(Math.abs(item.projectedG))}
            </div>
          ))}
        </div>
      )}
      {shortage.length > 0 && (
        <div
          style={{
            padding: "var(--sp-3) var(--sp-4)",
            borderRadius: "var(--r-md)",
            background: "var(--c-warn-soft)",
            color: "var(--c-warn)",
            border: "1px solid rgba(245,158,11,0.3)",
            fontSize: "var(--text-sm)",
          }}
        >
          <strong style={{ display: "block", marginBottom: "var(--sp-1)" }}>
            Shortage Warning
          </strong>
          {shortage.map((item) => (
            <div key={item.ingredientId} style={{ marginTop: "var(--sp-1)" }}>
              {item.ingredientName} — projected shortfall of {formatG(Math.abs(item.projectedG))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── KPI Row ──────────────────────────────────────────────── */

function KpiRow({ projections }: { projections: InventoryProjection[] }) {
  const totalOnHand = projections.reduce((sum, p) => sum + p.onHandG, 0);
  const totalDemand = projections.reduce((sum, p) => sum + p.demand7dG, 0);
  const projectedBalance = projections.reduce((sum, p) => sum + p.projectedG, 0);
  const criticalCount = projections.filter((p) => p.status === "critical").length;
  const expiringCount = projections.filter((p) => p.status === "expiring").length;

  return (
    <div className="kpi-grid" style={{ marginBottom: "var(--sp-6)" }}>
      <div className="kpi">
        <div className="kpi-value">{formatKg(totalOnHand)}</div>
        <div className="kpi-label">Total On-Hand</div>
      </div>
      <div className="kpi">
        <div className="kpi-value">{formatKg(totalDemand)}</div>
        <div className="kpi-label">7-Day Demand</div>
      </div>
      <div className="kpi">
        <div
          className="kpi-value"
          style={{ color: projectedBalance < 0 ? "var(--c-danger)" : undefined }}
        >
          {formatKg(projectedBalance)}
        </div>
        <div className="kpi-label">Projected Balance</div>
      </div>
      <div className="kpi">
        <div
          className="kpi-value"
          style={{ color: criticalCount > 0 ? "var(--c-danger)" : undefined }}
        >
          {criticalCount}
        </div>
        <div className="kpi-label">Critical Items</div>
      </div>
      <div className="kpi">
        <div
          className="kpi-value"
          style={{ color: expiringCount > 0 ? "var(--c-warn)" : undefined }}
        >
          {expiringCount}
        </div>
        <div className="kpi-label">Expiring Soon</div>
      </div>
    </div>
  );
}

/* ── Lot Details (expandable row) ─────────────────────────── */

function LotDetails({ lots }: { lots: InventoryLot[] }) {
  if (!lots || lots.length === 0) {
    return (
      <div style={{ padding: "var(--sp-3)", color: "var(--c-ink-muted)", fontSize: "var(--text-sm)" }}>
        No lot details available.
      </div>
    );
  }

  return (
    <div style={{ padding: "var(--sp-3) var(--sp-4)", background: "var(--c-surface-alt)", borderRadius: "var(--r-md)" }}>
      <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-semibold)" as string, color: "var(--c-ink-soft)", marginBottom: "var(--sp-2)" }}>
        Lot Details
      </div>
      <div className="stack-tight">
        {lots.map((lot) => {
          const days = daysUntil(lot.expiresAt);
          return (
            <div
              key={lot.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "var(--sp-3)",
                padding: "var(--sp-2)",
                background: "var(--c-surface)",
                borderRadius: "var(--r-sm)",
                fontSize: "var(--text-sm)",
                flexWrap: "wrap",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <span style={{ fontWeight: "var(--weight-medium)" as string }}>{lot.productName}</span>
                {lot.lotCode && (
                  <span style={{ color: "var(--c-ink-muted)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", marginLeft: "var(--sp-2)" }}>
                    {lot.lotCode}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexShrink: 0 }}>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatG(lot.quantityAvailableG)}</span>
                <span className="badge badge-neutral" style={{ fontSize: 10 }}>{lot.storageLocation}</span>
                {days !== null && (
                  <span
                    className={`badge ${days < 0 ? "badge-danger" : days <= 3 ? "badge-warn" : "badge-success"}`}
                    style={{ fontSize: 10 }}
                  >
                    {days < 0 ? "Expired" : `${days}d left`}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Par Level Editor (inline) ────────────────────────────── */

function ParLevelEditor({
  ingredientId,
  currentPar,
  currentReorder,
  apiBase,
  onSaved,
}: {
  ingredientId: string;
  currentPar: number | null;
  currentReorder: number | null;
  apiBase: string;
  onSaved: () => void;
}) {
  const [parLevel, setParLevel] = useState(currentPar !== null ? String(currentPar) : "");
  const [reorderPoint, setReorderPoint] = useState(currentReorder !== null ? String(currentReorder) : "");
  const [saving, setSaving] = useState(false);
  const [edited, setEdited] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${apiBase}/v1/inventory/par-levels`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredientId,
          parLevelG: parLevel ? parseFloat(parLevel) : null,
          reorderPointG: reorderPoint ? parseFloat(reorderPoint) : null,
        }),
      });
      if (res.ok) {
        setEdited(false);
        onSaved();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap" }}>
      <input
        type="number"
        value={parLevel}
        onChange={(e) => { setParLevel(e.target.value); setEdited(true); }}
        placeholder="Par (g)"
        style={{ width: 90, fontSize: "var(--text-xs)", padding: "4px 6px" }}
        onClick={(e) => e.stopPropagation()}
      />
      <input
        type="number"
        value={reorderPoint}
        onChange={(e) => { setReorderPoint(e.target.value); setEdited(true); }}
        placeholder="Reorder (g)"
        style={{ width: 90, fontSize: "var(--text-xs)", padding: "4px 6px" }}
        onClick={(e) => e.stopPropagation()}
      />
      {edited && (
        <button
          className="btn btn-primary btn-sm"
          onClick={(e) => { e.stopPropagation(); handleSave(); }}
          disabled={saving}
          style={{ fontSize: "var(--text-xs)", padding: "4px 8px", minHeight: "auto" }}
        >
          {saving ? "..." : "Save"}
        </button>
      )}
    </div>
  );
}

/* ── Projections Table ────────────────────────────────────── */

function ProjectionsTable({
  projections,
  apiBase,
  onRefresh,
}: {
  projections: InventoryProjection[];
  apiBase: string;
  onRefresh: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showParEditor, setShowParEditor] = useState<string | null>(null);

  const sorted = [...projections].sort(
    (a, b) => (STATUS_SEVERITY[a.status] ?? 99) - (STATUS_SEVERITY[b.status] ?? 99)
  );

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "var(--sp-4) var(--sp-5)", borderBottom: "1px solid var(--c-border)" }}>
        <h3 style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)" as string }}>
          Inventory Projections
        </h3>
      </div>

      {/* Table header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 100px",
          gap: "var(--sp-2)",
          padding: "var(--sp-2) var(--sp-5)",
          background: "var(--c-surface-alt)",
          borderBottom: "1px solid var(--c-border)",
          fontSize: "var(--text-xs)",
          fontWeight: "var(--weight-semibold)" as string,
          color: "var(--c-ink-muted)",
          textTransform: "uppercase" as const,
          letterSpacing: "0.04em",
        }}
      >
        <span>Ingredient</span>
        <span style={{ textAlign: "right" }}>On-Hand</span>
        <span style={{ textAlign: "right" }}>7d Demand</span>
        <span style={{ textAlign: "right" }}>Projected</span>
        <span style={{ textAlign: "right" }}>Par Level</span>
        <span style={{ textAlign: "center" }}>Status</span>
        <span style={{ textAlign: "center" }}>Actions</span>
      </div>

      {/* Rows */}
      {sorted.length === 0 && (
        <div style={{ padding: "var(--sp-8)", textAlign: "center", color: "var(--c-ink-muted)", fontSize: "var(--text-sm)" }}>
          No projection data available. Import inventory to get started.
        </div>
      )}

      {sorted.map((row) => (
        <div key={row.ingredientId}>
          {/* Main row */}
          <div
            onClick={() => setExpandedId(expandedId === row.ingredientId ? null : row.ingredientId)}
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 100px",
              gap: "var(--sp-2)",
              padding: "var(--sp-3) var(--sp-5)",
              borderBottom: "1px solid var(--c-border-light)",
              fontSize: "var(--text-sm)",
              cursor: "pointer",
              transition: "background var(--dur-fast)",
              alignItems: "center",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--c-surface-alt)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "")}
          >
            <div>
              <div style={{ fontWeight: "var(--weight-medium)" as string }}>{row.ingredientName}</div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)" }}>{row.category}</div>
            </div>
            <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatG(row.onHandG)}</div>
            <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatG(row.demand7dG)}</div>
            <div
              style={{
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
                fontWeight: "var(--weight-semibold)" as string,
                color: row.projectedG < 0 ? "var(--c-danger)" : undefined,
              }}
            >
              {formatG(row.projectedG)}
            </div>
            <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--c-ink-soft)" }}>
              {row.parLevelG !== null ? formatG(row.parLevelG) : "—"}
            </div>
            <div style={{ textAlign: "center" }}>
              <StatusBadge status={row.status} />
            </div>
            <div style={{ textAlign: "center" }}>
              <button
                className="btn btn-ghost btn-sm"
                style={{ fontSize: "var(--text-xs)", padding: "2px 6px", minHeight: "auto" }}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowParEditor(showParEditor === row.ingredientId ? null : row.ingredientId);
                }}
                title="Edit par levels"
              >
                Edit Par
              </button>
            </div>
          </div>

          {/* Par level editor */}
          {showParEditor === row.ingredientId && (
            <div
              style={{
                padding: "var(--sp-3) var(--sp-5)",
                background: "var(--c-surface-alt)",
                borderBottom: "1px solid var(--c-border-light)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)", marginBottom: "var(--sp-2)" }}>
                Set par level and reorder point for {row.ingredientName}
              </div>
              <ParLevelEditor
                ingredientId={row.ingredientId}
                currentPar={row.parLevelG}
                currentReorder={row.reorderPointG}
                apiBase={apiBase}
                onSaved={() => {
                  setShowParEditor(null);
                  onRefresh();
                }}
              />
            </div>
          )}

          {/* Expanded lot details */}
          {expandedId === row.ingredientId && (
            <div style={{ padding: "var(--sp-3) var(--sp-5)", borderBottom: "1px solid var(--c-border-light)" }}>
              <LotDetails lots={row.lots} />
            </div>
          )}
        </div>
      ))}

      {/* Mobile: card layout fallback */}
      <style>{`
        @media (max-width: 768px) {
          .inv-table-header { display: none !important; }
          .inv-table-row {
            grid-template-columns: 1fr 1fr !important;
            gap: var(--sp-2) !important;
          }
        }
      `}</style>
    </div>
  );
}

/* ── Demand Forecast Section ──────────────────────────────── */

function DemandForecast({ forecast }: { forecast: DayForecast[] }) {
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const today = todayISO();

  if (forecast.length === 0) {
    return (
      <div className="card" style={{ padding: "var(--sp-5)" }}>
        <h3 style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)" as string, marginBottom: "var(--sp-3)" }}>
          7-Day Demand Forecast
        </h3>
        <div style={{ color: "var(--c-ink-muted)", fontSize: "var(--text-sm)", textAlign: "center", padding: "var(--sp-4)" }}>
          No forecast data available.
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: "var(--sp-5)" }}>
      <h3 style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)" as string, marginBottom: "var(--sp-4)" }}>
        7-Day Demand Forecast
      </h3>

      <div
        style={{
          display: "flex",
          gap: "var(--sp-3)",
          overflowX: "auto",
          paddingBottom: "var(--sp-2)",
        }}
      >
        {forecast.map((day) => {
          const isToday = day.date === today;
          const isExpanded = expandedDay === day.date;

          return (
            <div
              key={day.date}
              onClick={() => setExpandedDay(isExpanded ? null : day.date)}
              style={{
                minWidth: 130,
                flex: "0 0 auto",
                background: isToday ? "var(--c-primary-soft)" : "var(--c-surface-alt)",
                border: isToday ? "1px solid var(--c-primary-muted)" : "1px solid var(--c-border-light)",
                borderRadius: "var(--r-md)",
                padding: "var(--sp-3)",
                cursor: "pointer",
                transition: "all var(--dur-fast)",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  fontWeight: "var(--weight-semibold)" as string,
                  color: isToday ? "var(--c-primary)" : "var(--c-ink-soft)",
                  marginBottom: "var(--sp-1)",
                }}
              >
                {isToday ? "Today" : formatDate(day.date)}
              </div>
              <div
                style={{
                  fontSize: "var(--text-lg)",
                  fontWeight: "var(--weight-bold)" as string,
                  fontVariantNumeric: "tabular-nums",
                  color: isToday ? "var(--c-primary)" : "var(--c-ink)",
                }}
              >
                {formatG(day.totalDemandG)}
              </div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)", marginTop: 2 }}>
                {day.ingredients.length} ingredient{day.ingredients.length !== 1 ? "s" : ""}
              </div>
            </div>
          );
        })}
      </div>

      {/* Expanded day detail */}
      {expandedDay && (() => {
        const day = forecast.find((d) => d.date === expandedDay);
        if (!day) return null;

        return (
          <div
            style={{
              marginTop: "var(--sp-4)",
              padding: "var(--sp-3)",
              background: "var(--c-surface-alt)",
              borderRadius: "var(--r-md)",
            }}
          >
            <div style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)" as string, marginBottom: "var(--sp-2)" }}>
              {formatDate(day.date)} — Ingredient Breakdown
            </div>
            <div className="stack-tight">
              {day.ingredients
                .sort((a, b) => b.demandG - a.demandG)
                .map((ing, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "var(--sp-1) var(--sp-2)",
                      fontSize: "var(--text-sm)",
                      borderBottom: "1px solid var(--c-border-light)",
                    }}
                  >
                    <span>{ing.ingredientName}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: "var(--weight-medium)" as string }}>
                      {formatG(ing.demandG)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/* ── Waste Summary Section ────────────────────────────────── */

function WasteSummary({ waste }: { waste: WasteEntry[] }) {
  if (waste.length === 0) {
    return (
      <div className="card" style={{ padding: "var(--sp-5)" }}>
        <h3 style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)" as string, marginBottom: "var(--sp-3)" }}>
          Waste Summary (30 Days)
        </h3>
        <div style={{ color: "var(--c-ink-muted)", fontSize: "var(--text-sm)", textAlign: "center", padding: "var(--sp-4)" }}>
          No waste recorded in the last 30 days.
        </div>
      </div>
    );
  }

  const totalWaste = waste.reduce((sum, w) => sum + w.totalWasteG, 0);
  const wasteByReason: Record<string, number> = {};
  const wasteByIngredient: Record<string, number> = {};

  for (const w of waste) {
    wasteByReason[w.reason] = (wasteByReason[w.reason] ?? 0) + w.totalWasteG;
    wasteByIngredient[w.ingredientName] = (wasteByIngredient[w.ingredientName] ?? 0) + w.totalWasteG;
  }

  const topWasted = Object.entries(wasteByIngredient)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  return (
    <div className="card" style={{ padding: "var(--sp-5)" }}>
      <h3 style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)" as string, marginBottom: "var(--sp-4)" }}>
        Waste Summary (30 Days)
      </h3>

      <div style={{ display: "flex", gap: "var(--sp-6)", flexWrap: "wrap", marginBottom: "var(--sp-4)" }}>
        {/* Total waste */}
        <div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)", marginBottom: 2 }}>Total Waste</div>
          <div style={{ fontSize: "var(--text-xl)", fontWeight: "var(--weight-bold)" as string, color: "var(--c-danger)" }}>
            {formatG(totalWaste)}
          </div>
        </div>

        {/* By reason */}
        {Object.entries(wasteByReason).map(([reason, grams]) => (
          <div key={reason}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)", marginBottom: 2 }}>
              {reason === "WASTE" ? "Waste" : "Spoilage"}
            </div>
            <div style={{ fontSize: "var(--text-lg)", fontWeight: "var(--weight-semibold)" as string, fontVariantNumeric: "tabular-nums" }}>
              {formatG(grams)}
            </div>
          </div>
        ))}
      </div>

      {/* Top wasted ingredients */}
      {topWasted.length > 0 && (
        <div>
          <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-semibold)" as string, color: "var(--c-ink-muted)", marginBottom: "var(--sp-2)", textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>
            Top Wasted Ingredients
          </div>
          <div className="stack-tight">
            {topWasted.map(([name, grams], i) => {
              const pct = totalWaste > 0 ? (grams / totalWaste) * 100 : 0;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
                  <span style={{ fontSize: "var(--text-sm)", flex: 1, minWidth: 0 }}>{name}</span>
                  <div style={{ width: 80, height: 6, borderRadius: 3, background: "var(--c-border)", overflow: "hidden", flexShrink: 0 }}>
                    <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: "var(--c-danger)", transition: "width 0.3s ease" }} />
                  </div>
                  <span style={{ fontSize: "var(--text-sm)", fontVariantNumeric: "tabular-nums", fontWeight: "var(--weight-medium)" as string, minWidth: 60, textAlign: "right" }}>
                    {formatG(grams)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main Board ───────────────────────────────────────────── */

export function InventoryBoard() {
  const [projections, setProjections] = useState<InventoryProjection[]>([]);
  const [forecast, setForecast] = useState<DayForecast[]>([]);
  const [waste, setWaste] = useState<WasteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"projections" | "forecast" | "waste">("projections");

  const apiBase = resolveApiBase();

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [projRes, forecastRes, wasteRes] = await Promise.all([
        fetch(`${apiBase}/v1/inventory/projections`).catch(() => null),
        fetch(`${apiBase}/v1/inventory/demand-forecast`).catch(() => null),
        fetch(`${apiBase}/v1/inventory/waste-summary`).catch(() => null),
      ]);

      let hasData = false;

      if (projRes && projRes.ok) {
        const data = await projRes.json();
        setProjections(data.projections ?? data ?? []);
        hasData = true;
      }

      if (forecastRes && forecastRes.ok) {
        const data = await forecastRes.json();
        setForecast(data.forecast ?? data ?? []);
        hasData = true;
      }

      if (wasteRes && wasteRes.ok) {
        const data = await wasteRes.json();
        setWaste(data.waste ?? data ?? []);
        hasData = true;
      }

      if (!hasData) {
        // Fall back to basic inventory endpoint
        const fallbackRes = await fetch(`${apiBase}/v1/inventory`).catch(() => null);
        if (fallbackRes && fallbackRes.ok) {
          const lots: InventoryLot[] = await fallbackRes.json();
          // Build projections from raw lots
          const grouped: Record<string, InventoryLot[]> = {};
          for (const lot of lots) {
            const key = lot.ingredientName;
            if (!grouped[key]) grouped[key] = [];
            grouped[key]!.push(lot);
          }

          const synthProjections: InventoryProjection[] = Object.entries(grouped).map(([name, lotList]) => {
            const onHand = lotList.reduce((s, l) => s + l.quantityAvailableG, 0);
            const hasExpiring = lotList.some((l) => {
              const d = daysUntil(l.expiresAt);
              return d !== null && d >= 0 && d <= 3;
            });
            return {
              ingredientId: name,
              ingredientName: name,
              category: lotList[0]?.storageLocation ?? "Unknown",
              onHandG: onHand,
              demand7dG: 0,
              projectedG: onHand,
              parLevelG: null,
              reorderPointG: null,
              status: onHand === 0 ? "critical" : hasExpiring ? "expiring" : "ok",
              lots: lotList,
            };
          });

          setProjections(synthProjections);
        } else {
          setError("Failed to load inventory data. Please check your connection and try again.");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* ── Render ─────────────────────────────────────────────── */

  if (loading) {
    return <LoadingSkeleton />;
  }

  const tabs: { key: typeof activeTab; label: string }[] = [
    { key: "projections", label: "Projections" },
    { key: "forecast", label: "Demand Forecast" },
    { key: "waste", label: "Waste Summary" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      {/* Error banner */}
      {error && (
        <ErrorBanner
          message={error}
          onRetry={() => {
            setLoading(true);
            fetchData();
          }}
          onDismiss={() => setError(null)}
        />
      )}

      {/* KPI Row */}
      <KpiRow projections={projections} />

      {/* Alert Banners */}
      <AlertBanners projections={projections} />

      {/* Tab Navigation */}
      <div className="row" style={{ gap: "var(--sp-2)", flexWrap: "wrap" }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`btn btn-sm ${activeTab === tab.key ? "btn-primary" : "btn-outline"}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "projections" && (
        <ProjectionsTable
          projections={projections}
          apiBase={apiBase}
          onRefresh={fetchData}
        />
      )}

      {activeTab === "forecast" && (
        <DemandForecast forecast={forecast} />
      )}

      {activeTab === "waste" && (
        <WasteSummary waste={waste} />
      )}

      {/* Empty state */}
      {projections.length === 0 && !error && (
        <div className="state-box" style={{ textAlign: "center", padding: "var(--sp-8)" }}>
          <div className="state-title">No inventory data</div>
          <div className="state-desc">Import Instacart orders to populate inventory and see projections.</div>
        </div>
      )}
    </div>
  );
}
