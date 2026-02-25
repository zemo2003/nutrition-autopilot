"use client";

import { useCallback, useEffect, useState } from "react";

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

type Alert = {
  lotId: string;
  productName: string;
  alertType: "LOW_STOCK" | "EXPIRING_SOON";
  details: string;
};

type AdjustFormState = {
  lotId: string;
  productName: string;
} | null;

const STORAGE_ICONS: Record<string, string> = {
  FRIDGE: "F",
  FREEZER: "X",
  PANTRY: "P",
  COUNTER: "C",
};

function formatG(grams: number): string {
  if (grams >= 1000) return `${(grams / 1000).toFixed(1)} kg`;
  return `${Math.round(grams)} g`;
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function ExpiryBadge({ expiresAt }: { expiresAt: string | null }) {
  const days = daysUntil(expiresAt);
  if (days === null) return <span className="badge badge-neutral">No expiry</span>;
  if (days < 0) return <span className="badge badge-danger">Expired</span>;
  if (days <= 2) return <span className="badge badge-danger">{days}d left</span>;
  if (days <= 5) return <span className="badge badge-warn">{days}d left</span>;
  return <span className="badge badge-success">{days}d left</span>;
}

function StockBar({ available, total }: { available: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (available / total) * 100) : 0;
  const color = pct > 50 ? "var(--c-success)" : pct > 20 ? "var(--c-warn)" : "var(--c-danger)";
  return (
    <div style={{
      width: "100%", height: 6, borderRadius: 3,
      background: "var(--c-border)", overflow: "hidden",
    }}>
      <div style={{
        width: `${pct}%`, height: "100%", borderRadius: 3,
        background: color, transition: "width 0.3s ease",
      }} />
    </div>
  );
}

export function InventoryBoard() {
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [adjusting, setAdjusting] = useState<AdjustFormState>(null);
  const [adjustDelta, setAdjustDelta] = useState("");
  const [adjustReason, setAdjustReason] = useState("WASTE");
  const [adjustNotes, setAdjustNotes] = useState("");
  const [adjustSubmitting, setAdjustSubmitting] = useState(false);

  const apiBase = resolveApiBase();

  const fetchData = useCallback(async () => {
    try {
      const [lotsRes, alertsRes] = await Promise.all([
        fetch(`${apiBase}/v1/inventory${filter !== "all" ? `?storageLocation=${filter}` : ""}`),
        fetch(`${apiBase}/v1/inventory/alerts`),
      ]);
      if (lotsRes.ok) setLots(await lotsRes.json());
      if (alertsRes.ok) setAlerts(await alertsRes.json());
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [apiBase, filter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAdjust = async () => {
    if (!adjusting || !adjustDelta) return;
    setAdjustSubmitting(true);
    try {
      const res = await fetch(`${apiBase}/v1/inventory/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lotId: adjusting.lotId,
          deltaG: parseFloat(adjustDelta),
          reason: adjustReason,
          notes: adjustNotes || undefined,
        }),
      });
      if (res.ok) {
        setAdjusting(null);
        setAdjustDelta("");
        setAdjustNotes("");
        fetchData();
      }
    } finally {
      setAdjustSubmitting(false);
    }
  };

  if (loading) {
    return <div className="loading-shimmer" style={{ height: 200, borderRadius: 12 }} />;
  }

  // Group by storage location
  const grouped: Record<string, InventoryLot[]> = {};
  for (const lot of lots) {
    const loc = lot.storageLocation || "FRIDGE";
    if (!grouped[loc]) grouped[loc] = [];
    grouped[loc]!.push(lot);
  }

  const locationOrder = ["FRIDGE", "FREEZER", "PANTRY", "COUNTER"];

  return (
    <>
      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="stack-tight" style={{ marginBottom: "var(--sp-4)" }}>
          {alerts.map((alert, i) => (
            <div key={i} className={`state-box ${alert.alertType === "EXPIRING_SOON" ? "result-error" : "result-loading"}`}
              style={{ padding: "var(--sp-3)", borderRadius: "var(--r-md)" }}>
              <strong>{alert.alertType === "EXPIRING_SOON" ? "Expiring" : "Low Stock"}</strong>
              {" "}{alert.productName} — {alert.details}
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="row" style={{ gap: "var(--sp-2)", marginBottom: "var(--sp-4)", flexWrap: "wrap" }}>
        {["all", ...locationOrder].map((loc) => (
          <button
            key={loc}
            className={`btn btn-sm ${filter === loc ? "btn-primary" : "btn-outline"}`}
            onClick={() => setFilter(loc)}
          >
            {loc === "all" ? "All" : loc.charAt(0) + loc.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {/* Inventory by location */}
      {locationOrder.filter((loc) => filter === "all" || filter === loc).map((loc) => {
        const locationLots = grouped[loc];
        if (!locationLots?.length) return null;

        return (
          <div key={loc} style={{ marginBottom: "var(--sp-6)" }}>
            <h3 style={{ fontSize: "var(--text-md)", marginBottom: "var(--sp-3)", display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
              <span className="badge badge-neutral">{STORAGE_ICONS[loc]}</span>
              {loc.charAt(0) + loc.slice(1).toLowerCase()}
              <span className="text-muted" style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-normal)" }}>
                ({locationLots.length} lot{locationLots.length !== 1 ? "s" : ""})
              </span>
            </h3>

            <div className="stack-tight">
              {locationLots.map((lot) => (
                <div key={lot.id} className="card" style={{ padding: "var(--sp-3)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--sp-3)", flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: "var(--weight-semibold)", fontSize: "var(--text-base)" }}>
                        {lot.productName}
                      </div>
                      <div className="text-muted" style={{ fontSize: "var(--text-sm)", marginTop: 2 }}>
                        {lot.ingredientName}
                        {lot.lotCode && <> · Lot: {lot.lotCode}</>}
                      </div>
                      <div style={{ marginTop: "var(--sp-2)", maxWidth: 200 }}>
                        <StockBar available={lot.quantityAvailableG} total={lot.quantityReceivedG} />
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-xs)", color: "var(--c-ink-soft)", marginTop: 2 }}>
                          <span>{formatG(lot.quantityAvailableG)} avail</span>
                          <span>{formatG(lot.quantityReceivedG)} total</span>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "var(--sp-2)" }}>
                      <ExpiryBadge expiresAt={lot.expiresAt} />
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => setAdjusting({ lotId: lot.id, productName: lot.productName })}
                        style={{ fontSize: "var(--text-xs)" }}
                      >
                        Adjust
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {lots.length === 0 && (
        <div className="state-box" style={{ textAlign: "center", padding: "var(--sp-8)" }}>
          <div className="state-title">No inventory lots</div>
          <div className="state-desc">Import Instacart orders to populate inventory.</div>
        </div>
      )}

      {/* Adjustment Modal */}
      {adjusting && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 200,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,0.6)", padding: "var(--sp-4)",
        }} onClick={() => setAdjusting(null)}>
          <div className="card" style={{ maxWidth: 400, width: "100%", padding: "var(--sp-6)" }}
            onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: "var(--sp-4)" }}>Adjust: {adjusting.productName}</h3>

            <div className="field-group" style={{ marginBottom: "var(--sp-3)" }}>
              <label style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-soft)" }}>Change (grams)</label>
              <input
                type="number"
                value={adjustDelta}
                onChange={(e) => setAdjustDelta(e.target.value)}
                placeholder="-100 (negative = remove)"
                style={{ width: "100%" }}
              />
            </div>

            <div className="field-group" style={{ marginBottom: "var(--sp-3)" }}>
              <label style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-soft)" }}>Reason</label>
              <select value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} style={{ width: "100%" }}>
                <option value="WASTE">Waste</option>
                <option value="SPOILAGE">Spoilage</option>
                <option value="CORRECTION">Correction</option>
                <option value="MANUAL">Manual Adjustment</option>
              </select>
            </div>

            <div className="field-group" style={{ marginBottom: "var(--sp-4)" }}>
              <label style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-soft)" }}>Notes (optional)</label>
              <input
                type="text"
                value={adjustNotes}
                onChange={(e) => setAdjustNotes(e.target.value)}
                placeholder="Optional notes"
                style={{ width: "100%" }}
              />
            </div>

            <div className="row" style={{ gap: "var(--sp-2)" }}>
              <button className="btn btn-outline" onClick={() => setAdjusting(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleAdjust}
                disabled={!adjustDelta || adjustSubmitting}
              >
                {adjustSubmitting ? "Saving..." : "Apply Adjustment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
