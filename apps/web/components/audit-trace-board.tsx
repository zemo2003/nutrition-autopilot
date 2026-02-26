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

type Trace = {
  scheduleId: string;
  clientName: string;
  skuName: string;
  recipeName: string;
  serviceDate: string;
  mealSlot: string;
  servings: number;
  servingWeightG: number;
  provisional: boolean;
  reasonCodes: string[];
  plausibilityValid: boolean;
  plausibilityIssues: Array<{ message: string; severity: string }>;
  ingredients: Array<{
    ingredientName: string;
    consumedGrams: number;
    allergenTags: string[];
    provisional: boolean;
  }>;
  lots: Array<{
    lotId: string;
    lotCode: string | null;
    productName: string;
    gramsConsumed: number;
    syntheticLot: boolean;
  }>;
  nutrientProvenance: Array<{
    nutrientKey: string;
    valuePerServing: number;
    verifiedPct: number;
  }>;
  evidenceSummary: {
    verifiedCount: number;
    inferredCount: number;
    exceptionCount: number;
    unverifiedCount: number;
    totalRows: number;
    verifiedPct: number;
  };
  qaWarnings: string[];
};

export default function AuditTraceBoard({ scheduleId }: { scheduleId: string }) {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const base = resolveApiBase();
    const res = await fetch(`${base}/v1/audit/meal/${scheduleId}`);
    if (res.ok) {
      const data = await res.json();
      setTrace(data.trace);
    } else {
      const err = await res.json().catch(() => ({ error: "Failed to load" }));
      setError(err.error ?? "Failed to load audit trace");
    }
    setLoading(false);
  }, [scheduleId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="state-box"><div className="state-title">Loading audit trace...</div></div>;
  if (error) return <div className="state-box"><div className="state-title">{error}</div></div>;
  if (!trace) return <div className="state-box"><div className="state-title">No trace data</div></div>;

  return (
    <div>
      {/* Header */}
      <div className="kpi-grid" style={{ marginBottom: "var(--sp-4)" }}>
        <div className="kpi">
          <div className="kpi-value">{trace.skuName}</div>
          <div className="kpi-label">SKU</div>
        </div>
        <div className="kpi">
          <div className="kpi-value">{trace.clientName}</div>
          <div className="kpi-label">Client</div>
        </div>
        <div className="kpi">
          <div className="kpi-value">{new Date(trace.serviceDate).toLocaleDateString()}</div>
          <div className="kpi-label">{trace.mealSlot}</div>
        </div>
        <div className="kpi">
          <div className="kpi-value">{trace.servingWeightG}g</div>
          <div className="kpi-label">{trace.servings} serving(s)</div>
        </div>
        <div className="kpi">
          <div className="kpi-value" style={{ color: trace.provisional ? "var(--c-warning)" : "var(--c-success)" }}>
            {trace.provisional ? "PROVISIONAL" : "VERIFIED"}
          </div>
          <div className="kpi-label">Status</div>
        </div>
        <div className="kpi">
          <div className="kpi-value">{trace.evidenceSummary.verifiedPct}%</div>
          <div className="kpi-label">Verified</div>
        </div>
      </div>

      {/* QA Warnings */}
      {trace.qaWarnings.length > 0 && (
        <section className="section">
          <h3 className="section-title">QA Warnings</h3>
          {trace.qaWarnings.map((w, i) => (
            <div key={i} className="badge badge-warn" style={{ display: "block", marginBottom: "var(--sp-1)", padding: "var(--sp-2)" }}>{w}</div>
          ))}
        </section>
      )}

      {/* Ingredients */}
      <section className="section">
        <h3 className="section-title">Ingredients ({trace.ingredients.length})</h3>
        <table className="data-table">
          <thead><tr><th>Ingredient</th><th>Grams</th><th>Allergens</th><th>Status</th></tr></thead>
          <tbody>
            {trace.ingredients.map((ing, i) => (
              <tr key={i}>
                <td>{ing.ingredientName}</td>
                <td>{ing.consumedGrams.toFixed(1)}g</td>
                <td>{ing.allergenTags.length > 0 ? ing.allergenTags.map((t, j) => <span key={j} className="badge" style={{ marginRight: 4 }}>{t}</span>) : "—"}</td>
                <td>{ing.provisional ? <span className="badge badge-warn">Provisional</span> : <span className="badge badge-info">OK</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Lot Consumption */}
      <section className="section">
        <h3 className="section-title">Inventory Lots Consumed ({trace.lots.length})</h3>
        <table className="data-table">
          <thead><tr><th>Product</th><th>Lot Code</th><th>Grams</th><th>Type</th></tr></thead>
          <tbody>
            {trace.lots.map((lot, i) => (
              <tr key={i}>
                <td>{lot.productName}</td>
                <td>{lot.lotCode ?? "—"}</td>
                <td>{lot.gramsConsumed.toFixed(1)}g</td>
                <td>{lot.syntheticLot ? <span className="badge badge-warn">Synthetic</span> : <span className="badge badge-info">Real</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Nutrient Provenance */}
      <section className="section">
        <h3 className="section-title">Nutrient Provenance</h3>
        <table className="data-table">
          <thead><tr><th>Nutrient</th><th>Per Serving</th><th>Verified %</th></tr></thead>
          <tbody>
            {trace.nutrientProvenance.map((np, i) => (
              <tr key={i}>
                <td>{np.nutrientKey.replace(/_/g, " ")}</td>
                <td>{np.valuePerServing}</td>
                <td>{np.verifiedPct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Evidence Summary */}
      <section className="section">
        <h3 className="section-title">Evidence Summary</h3>
        <div className="kpi-grid">
          <div className="kpi"><div className="kpi-value">{trace.evidenceSummary.totalRows}</div><div className="kpi-label">Total Rows</div></div>
          <div className="kpi"><div className="kpi-value">{trace.evidenceSummary.verifiedCount}</div><div className="kpi-label">Verified</div></div>
          <div className="kpi"><div className="kpi-value">{trace.evidenceSummary.inferredCount}</div><div className="kpi-label">Inferred</div></div>
          <div className="kpi"><div className="kpi-value">{trace.evidenceSummary.exceptionCount}</div><div className="kpi-label">Exceptions</div></div>
          <div className="kpi"><div className="kpi-value">{trace.evidenceSummary.unverifiedCount}</div><div className="kpi-label">Unverified</div></div>
        </div>
      </section>
    </div>
  );
}
