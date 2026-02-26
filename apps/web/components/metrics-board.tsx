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

type MetricStatus = {
  metricKey: string;
  label: string;
  latestValue: number | null;
  latestUnit: string | null;
  latestObservedAt: string | null;
  rangeStatus: "normal" | "warning" | "critical" | "unknown";
  staleDays: number | null;
  isStale: boolean;
  verificationLevel: string | null;
  category: string;
};

type QualityReport = {
  totalMetrics: number;
  staleMetrics: string[];
  unverifiedMetrics: string[];
  outOfRangeMetrics: string[];
  missingCommonMetrics: string[];
  warnings: string[];
};

type MetricStatusResponse = {
  statuses: MetricStatus[];
  qualityReport: QualityReport;
  grouped: Record<string, MetricStatus[]>;
};

const RANGE_COLORS: Record<string, string> = {
  normal: "var(--c-success)",
  warning: "var(--c-warning)",
  critical: "var(--c-danger)",
  unknown: "var(--c-ink-soft)",
};

const METRIC_PRESETS = [
  { key: "fasting_glucose", label: "Fasting Glucose", unit: "mg/dL" },
  { key: "hba1c", label: "HbA1c", unit: "%" },
  { key: "ldl", label: "LDL Cholesterol", unit: "mg/dL" },
  { key: "hdl", label: "HDL Cholesterol", unit: "mg/dL" },
  { key: "triglycerides", label: "Triglycerides", unit: "mg/dL" },
  { key: "total_cholesterol", label: "Total Cholesterol", unit: "mg/dL" },
  { key: "body_fat_pct", label: "Body Fat %", unit: "%" },
  { key: "lean_mass_kg", label: "Lean Mass", unit: "kg" },
  { key: "resting_hr", label: "Resting Heart Rate", unit: "bpm" },
];

const CATEGORY_LABELS: Record<string, string> = {
  bloodwork: "Bloodwork",
  body_composition: "Body Composition",
  cardiovascular: "Cardiovascular",
  metabolic: "Metabolic",
  other: "Other",
};

export default function MetricsBoard({ clientId }: { clientId: string }) {
  const [data, setData] = useState<MetricStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "add">("overview");

  // Form state
  const [form, setForm] = useState({
    metricKey: "fasting_glucose",
    value: "",
    unit: "mg/dL",
    observedAt: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const base = resolveApiBase();
    const res = await fetch(`${base}/v1/clients/${clientId}/metrics/status`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const handlePresetChange = (key: string) => {
    const preset = METRIC_PRESETS.find((p) => p.key === key);
    setForm({ ...form, metricKey: key, unit: preset?.unit ?? form.unit });
  };

  const handleSubmit = async () => {
    if (!form.value) return;
    const base = resolveApiBase();
    const res = await fetch(`${base}/v1/clients/${clientId}/metrics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metricKey: form.metricKey,
        value: Number(form.value),
        unit: form.unit,
        observedAt: form.observedAt,
        verification: "MANUAL_ENTRY",
        notes: form.notes || null,
      }),
    });
    if (res.ok) {
      setForm({ ...form, value: "", notes: "" });
      setTab("overview");
      load();
    }
  };

  if (loading) return <div className="state-box"><div className="state-title">Loading metrics...</div></div>;

  return (
    <div>
      {/* Tabs */}
      <div className="row" style={{ gap: "var(--sp-2)", marginBottom: "var(--sp-4)" }}>
        <button className={`btn ${tab === "overview" ? "btn-primary" : "btn-outline"} btn-sm`} onClick={() => setTab("overview")}>Overview</button>
        <button className={`btn ${tab === "add" ? "btn-primary" : "btn-outline"} btn-sm`} onClick={() => setTab("add")}>Add Metric</button>
      </div>

      {tab === "overview" && data && (
        <>
          {/* Quality Warnings */}
          {data.qualityReport.warnings.map((w, i) => (
            <div key={i} className="badge badge-warn" style={{ display: "block", marginBottom: "var(--sp-1)", padding: "var(--sp-2)" }}>{w}</div>
          ))}

          {/* Summary KPIs */}
          <div className="kpi-grid" style={{ marginBottom: "var(--sp-4)", marginTop: "var(--sp-3)" }}>
            <div className="kpi">
              <div className="kpi-value">{data.qualityReport.totalMetrics}</div>
              <div className="kpi-label">Tracked Metrics</div>
            </div>
            <div className="kpi">
              <div className="kpi-value">{data.qualityReport.staleMetrics.length}</div>
              <div className="kpi-label">Stale (&gt;90d)</div>
              {data.qualityReport.staleMetrics.length > 0 && <div className="kpi-note"><span className="badge badge-warn">Needs Update</span></div>}
            </div>
            <div className="kpi">
              <div className="kpi-value">{data.qualityReport.outOfRangeMetrics.length}</div>
              <div className="kpi-label">Out of Range</div>
              {data.qualityReport.outOfRangeMetrics.length > 0 && <div className="kpi-note"><span className="badge badge-warn">Review</span></div>}
            </div>
          </div>

          {/* Grouped by Category */}
          {Object.entries(data.grouped).map(([category, statuses]) => {
            const withValues = (statuses as MetricStatus[]).filter((s) => s.latestValue !== null);
            if (withValues.length === 0 && category !== "metabolic" && category !== "bloodwork") return null;
            return (
              <section key={category} className="section" style={{ marginBottom: "var(--sp-4)" }}>
                <h3 className="section-title">{CATEGORY_LABELS[category] ?? category}</h3>
                <div style={{ overflowX: "auto" }}>
                  <table className="data-table">
                    <thead>
                      <tr><th>Metric</th><th>Value</th><th>Unit</th><th>Status</th><th>Last Updated</th><th>Verified</th></tr>
                    </thead>
                    <tbody>
                      {(statuses as MetricStatus[]).map((s) => (
                        <tr key={s.metricKey} style={{ opacity: s.latestValue === null ? 0.5 : 1 }}>
                          <td>{s.label}</td>
                          <td style={{ fontWeight: 600 }}>{s.latestValue ?? "—"}</td>
                          <td>{s.latestUnit ?? "—"}</td>
                          <td>
                            <span style={{ color: RANGE_COLORS[s.rangeStatus], fontWeight: 600 }}>
                              {s.rangeStatus.toUpperCase()}
                            </span>
                            {s.isStale && s.latestValue !== null && <span className="badge badge-warn" style={{ marginLeft: 4, fontSize: "0.75em" }}>STALE</span>}
                          </td>
                          <td>{s.latestObservedAt ? new Date(s.latestObservedAt).toLocaleDateString() : "—"}</td>
                          <td>{s.verificationLevel ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </>
      )}

      {tab === "add" && (
        <div className="card" style={{ maxWidth: 480 }}>
          <div style={{ display: "grid", gap: "var(--sp-3)" }}>
            <label>Metric
              <select value={form.metricKey} onChange={(e) => handlePresetChange(e.target.value)} className="input">
                {METRIC_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                <option value="custom">Custom...</option>
              </select>
            </label>
            {form.metricKey === "custom" && (
              <label>Custom Key <input type="text" className="input" placeholder="metric_key" onChange={(e) => setForm({ ...form, metricKey: e.target.value })} /></label>
            )}
            <label>Value <input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className="input" placeholder="85" /></label>
            <label>Unit <input type="text" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="input" /></label>
            <label>Observed Date <input type="date" value={form.observedAt} onChange={(e) => setForm({ ...form, observedAt: e.target.value })} className="input" /></label>
            <label>Notes <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="input" placeholder="Optional notes" /></label>
            <button className="btn btn-primary" onClick={handleSubmit}>Save Metric</button>
          </div>
        </div>
      )}
    </div>
  );
}
