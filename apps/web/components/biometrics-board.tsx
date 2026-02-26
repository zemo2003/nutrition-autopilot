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

type BiometricSnapshot = {
  id: string;
  measuredAt: string;
  heightCm: number | null;
  weightKg: number | null;
  bodyFatPct: number | null;
  leanMassKg: number | null;
  restingHr: number | null;
  notes: string | null;
  source: string | null;
};

type Trend = {
  field: string;
  direction: "up" | "down" | "stable" | "insufficient";
  latestValue: number | null;
  previousValue: number | null;
  deltaAbs: number | null;
  deltaPct: number | null;
};

type Summary = {
  snapshotCount: number;
  trends: Trend[];
  bmi: number | null;
  bmiCategory: string | null;
  dataQuality: {
    hasRecentData: boolean;
    daysSinceLastSnapshot: number | null;
    missingFields: string[];
    warnings: string[];
  };
};

const TREND_ICONS: Record<string, string> = { up: "↑", down: "↓", stable: "→", insufficient: "—" };
const TREND_COLORS: Record<string, string> = { up: "var(--c-danger)", down: "var(--c-success)", stable: "var(--c-ink-soft)", insufficient: "var(--c-ink-soft)" };

export default function BiometricsBoard({ clientId }: { clientId: string }) {
  const [snapshots, setSnapshots] = useState<BiometricSnapshot[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tab, setTab] = useState<"timeline" | "add">("timeline");
  const [loading, setLoading] = useState(true);

  // Form state
  const [form, setForm] = useState({
    measuredAt: new Date().toISOString().slice(0, 10),
    heightCm: "", weightKg: "", bodyFatPct: "", leanMassKg: "", restingHr: "",
    notes: "", source: "manual",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const base = resolveApiBase();
    const [snapRes, sumRes] = await Promise.all([
      fetch(`${base}/v1/clients/${clientId}/biometrics`),
      fetch(`${base}/v1/clients/${clientId}/biometrics/summary`),
    ]);
    if (snapRes.ok) {
      const data = await snapRes.json();
      setSnapshots(data.snapshots ?? []);
    }
    if (sumRes.ok) {
      setSummary(await sumRes.json());
    }
    setLoading(false);
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async () => {
    const base = resolveApiBase();
    const body: Record<string, unknown> = {
      measuredAt: form.measuredAt,
      source: form.source,
      notes: form.notes || null,
    };
    if (form.heightCm) body.heightCm = Number(form.heightCm);
    if (form.weightKg) body.weightKg = Number(form.weightKg);
    if (form.bodyFatPct) body.bodyFatPct = Number(form.bodyFatPct);
    if (form.leanMassKg) body.leanMassKg = Number(form.leanMassKg);
    if (form.restingHr) body.restingHr = Number(form.restingHr);

    const res = await fetch(`${base}/v1/clients/${clientId}/biometrics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setForm({ measuredAt: new Date().toISOString().slice(0, 10), heightCm: "", weightKg: "", bodyFatPct: "", leanMassKg: "", restingHr: "", notes: "", source: "manual" });
      setTab("timeline");
      load();
    }
  };

  const handleDelete = async (id: string) => {
    const base = resolveApiBase();
    await fetch(`${base}/v1/clients/${clientId}/biometrics/${id}`, { method: "DELETE" });
    load();
  };

  if (loading) return <div className="state-box"><div className="state-title">Loading biometrics...</div></div>;

  return (
    <div>
      {/* Tabs */}
      <div className="row" style={{ gap: "var(--sp-2)", marginBottom: "var(--sp-4)" }}>
        <button className={`btn ${tab === "timeline" ? "btn-primary" : "btn-outline"} btn-sm`} onClick={() => setTab("timeline")}>Timeline</button>
        <button className={`btn ${tab === "add" ? "btn-primary" : "btn-outline"} btn-sm`} onClick={() => setTab("add")}>Add Snapshot</button>
      </div>

      {tab === "timeline" && (
        <>
          {/* Summary KPIs */}
          {summary && (
            <div className="kpi-grid" style={{ marginBottom: "var(--sp-4)" }}>
              <div className="kpi">
                <div className="kpi-value">{summary.snapshotCount}</div>
                <div className="kpi-label">Snapshots</div>
              </div>
              {summary.bmi && (
                <div className="kpi">
                  <div className="kpi-value">{summary.bmi}</div>
                  <div className="kpi-label">BMI ({summary.bmiCategory})</div>
                </div>
              )}
              {summary.trends.filter((t) => t.latestValue !== null).map((t) => (
                <div className="kpi" key={t.field}>
                  <div className="kpi-value" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <span>{t.latestValue}</span>
                    <span style={{ color: TREND_COLORS[t.direction], fontSize: "0.8em" }}>{TREND_ICONS[t.direction]}</span>
                  </div>
                  <div className="kpi-label">{t.field.replace(/([A-Z])/g, " $1").trim()}</div>
                  {t.deltaPct !== null && <div className="kpi-note" style={{ color: "var(--c-ink-soft)" }}>{t.deltaPct > 0 ? "+" : ""}{t.deltaPct}%</div>}
                </div>
              ))}
            </div>
          )}

          {/* Warnings */}
          {summary?.dataQuality.warnings.map((w, i) => (
            <div key={i} className="badge badge-warn" style={{ display: "block", marginBottom: "var(--sp-1)", padding: "var(--sp-2)" }}>{w}</div>
          ))}

          {/* Snapshot Table */}
          {snapshots.length === 0 ? (
            <div className="state-box"><div className="state-title">No biometric data yet</div><div className="state-desc">Click &quot;Add Snapshot&quot; to record measurements.</div></div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th><th>Height (cm)</th><th>Weight (kg)</th><th>Body Fat %</th><th>Lean Mass (kg)</th><th>HR (bpm)</th><th>Source</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((s) => (
                    <tr key={s.id}>
                      <td>{new Date(s.measuredAt).toLocaleDateString()}</td>
                      <td>{s.heightCm ?? "—"}</td>
                      <td>{s.weightKg ?? "—"}</td>
                      <td>{s.bodyFatPct ?? "—"}</td>
                      <td>{s.leanMassKg ?? "—"}</td>
                      <td>{s.restingHr ?? "—"}</td>
                      <td><span className="badge badge-info">{s.source ?? "unknown"}</span></td>
                      <td><button className="btn btn-outline btn-sm" onClick={() => handleDelete(s.id)}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "add" && (
        <div className="card" style={{ maxWidth: 480 }}>
          <div style={{ display: "grid", gap: "var(--sp-3)" }}>
            <label>Date <input type="date" value={form.measuredAt} onChange={(e) => setForm({ ...form, measuredAt: e.target.value })} className="input" /></label>
            <label>Height (cm) <input type="number" value={form.heightCm} onChange={(e) => setForm({ ...form, heightCm: e.target.value })} className="input" placeholder="175" /></label>
            <label>Weight (kg) <input type="number" value={form.weightKg} onChange={(e) => setForm({ ...form, weightKg: e.target.value })} className="input" placeholder="80" /></label>
            <label>Body Fat % <input type="number" value={form.bodyFatPct} onChange={(e) => setForm({ ...form, bodyFatPct: e.target.value })} className="input" placeholder="18" /></label>
            <label>Lean Mass (kg) <input type="number" value={form.leanMassKg} onChange={(e) => setForm({ ...form, leanMassKg: e.target.value })} className="input" placeholder="65" /></label>
            <label>Resting HR (bpm) <input type="number" value={form.restingHr} onChange={(e) => setForm({ ...form, restingHr: e.target.value })} className="input" placeholder="62" /></label>
            <label>Source <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="input"><option value="manual">Manual</option><option value="scale">Scale</option><option value="dexa">DEXA</option><option value="clinician">Clinician</option></select></label>
            <label>Notes <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="input" placeholder="Optional notes" /></label>
            <button className="btn btn-primary" onClick={handleSubmit}>Save Snapshot</button>
          </div>
        </div>
      )}
    </div>
  );
}
