"use client";

import { useCallback, useEffect, useState } from "react";
import { Sparkline } from "./sparkline";

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

type ReportData = {
  client: { fullName: string; heightCm: number | null; weightKg: number | null; goals: string | null; targetKcal: number | null; targetProteinG: number | null; targetCarbG: number | null; targetFatG: number | null };
  biometrics: { measuredAt: string; weightKg: number | null; bodyFatPct: number | null; leanMassKg: number | null; restingHr: number | null }[];
  nutrition: { summary: { avgKcal: number; avgProteinG: number; avgCarbG: number; avgFatG: number; daysWithData: number; compliancePct: number } } | null;
};

export function ProgressReport({ clientId }: { clientId: string }) {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(90);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    const api = resolveApiBase();
    try {
      const [clientRes, bioRes, nutRes] = await Promise.allSettled([
        fetch(`${api}/v1/clients/${clientId}`).then((r) => r.ok ? r.json() : null),
        fetch(`${api}/v1/clients/${clientId}/biometrics`).then((r) => r.ok ? r.json() : []),
        fetch(`${api}/v1/clients/${clientId}/nutrition/history?days=${period}`).then((r) => r.ok ? r.json() : null),
      ]);
      setData({
        client: clientRes.status === "fulfilled" ? clientRes.value : null,
        biometrics: bioRes.status === "fulfilled" ? (Array.isArray(bioRes.value) ? bioRes.value : []) : [],
        nutrition: nutRes.status === "fulfilled" ? nutRes.value : null,
      });
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [clientId, period]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  if (loading) {
    return <div style={{ padding: 32, textAlign: "center", color: "#888" }}>Loading report...</div>;
  }

  if (!data?.client) {
    return <div style={{ padding: 32, textAlign: "center", color: "#c0392b" }}>Failed to load client data.</div>;
  }

  const bios = data.biometrics.sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  const first = bios.length > 0 ? bios[0]! : null;
  const last = bios.length > 0 ? bios[bios.length - 1]! : null;

  function delta(a: number | null, b: number | null): string {
    if (a == null || b == null) return "—";
    const d = b - a;
    return `${d > 0 ? "+" : ""}${d.toFixed(1)}`;
  }

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <>
      <div className="no-print" style={{
        padding: "var(--sp-3) var(--sp-4)", background: "var(--c-surface-raised, #f8f9fa)",
        display: "flex", gap: "var(--sp-3)", alignItems: "center",
        borderBottom: "1px solid var(--c-border, #e5e7eb)",
      }}>
        <label style={{ fontSize: "var(--text-sm)" }}>
          Period:{" "}
          <select className="input" value={period} onChange={(e) => setPeriod(Number(e.target.value))} style={{ width: "auto", display: "inline-block" }}>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
        <button className="btn btn-primary btn-sm" onClick={() => window.print()}>Print</button>
        <button className="btn btn-outline btn-sm" onClick={() => window.history.back()}>Back</button>
      </div>

      <div style={{ maxWidth: 700, margin: "0 auto", padding: 32, fontFamily: "system-ui, -apple-system, sans-serif" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 4px" }}>Client Progress Report</h1>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{data.client.fullName}</div>
          <div style={{ fontSize: 14, color: "#666", marginTop: 4 }}>{today} &middot; {period}-day period</div>
        </div>

        {data.client.goals && (
          <div style={{ padding: "8px 12px", marginBottom: 16, border: "1px solid var(--c-border, #ddd)", borderRadius: 6, fontSize: 13 }}>
            <strong>Goals:</strong> {data.client.goals}
          </div>
        )}

        {/* Physiology Changes */}
        <h2 style={{ fontSize: 16, fontWeight: 700, borderBottom: "2px solid #333", paddingBottom: 4, margin: "24px 0 12px" }}>Physiology Changes</h2>
        {bios.length >= 2 ? (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginBottom: 16 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #333" }}>
                <th style={{ textAlign: "left", padding: "6px 4px" }}>Metric</th>
                <th style={{ textAlign: "right", padding: "6px 4px" }}>Start</th>
                <th style={{ textAlign: "right", padding: "6px 4px" }}>Current</th>
                <th style={{ textAlign: "right", padding: "6px 4px" }}>Change</th>
                <th style={{ textAlign: "center", padding: "6px 4px", width: 120 }}>Trend</th>
              </tr>
            </thead>
            <tbody>
              {([
                { label: "Weight (kg)", field: "weightKg" as const, color: "#6366f1" },
                { label: "Body Fat (%)", field: "bodyFatPct" as const, color: "#f59e0b" },
                { label: "Lean Mass (kg)", field: "leanMassKg" as const, color: "#34d399" },
                { label: "Resting HR (bpm)", field: "restingHr" as const, color: "#ef4444" },
              ]).map(({ label, field, color }) => {
                const points = bios.filter((b) => b[field] != null).map((b) => ({ x: new Date(b.measuredAt).getTime(), y: b[field] as number }));
                return (
                  <tr key={field} style={{ borderBottom: "1px solid #ddd" }}>
                    <td style={{ padding: "8px 4px", fontWeight: 500 }}>{label}</td>
                    <td style={{ padding: "8px 4px", textAlign: "right" }}>{first?.[field] != null ? (first[field] as number).toFixed(1) : "—"}</td>
                    <td style={{ padding: "8px 4px", textAlign: "right" }}>{last?.[field] != null ? (last[field] as number).toFixed(1) : "—"}</td>
                    <td style={{ padding: "8px 4px", textAlign: "right", fontWeight: 600 }}>{delta(first?.[field] ?? null, last?.[field] ?? null)}</td>
                    <td style={{ padding: "8px 4px", textAlign: "center" }}>
                      {points.length >= 2 && <Sparkline data={points} width={100} height={28} color={color} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div style={{ color: "#888", fontSize: 13, padding: "8px 0" }}>Insufficient biometric data for comparison.</div>
        )}

        {/* Nutrition Compliance */}
        <h2 style={{ fontSize: 16, fontWeight: 700, borderBottom: "2px solid #333", paddingBottom: 4, margin: "24px 0 12px" }}>Nutrition Compliance</h2>
        {data.nutrition ? (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #333" }}>
                <th style={{ textAlign: "left", padding: "6px 4px" }}>Metric</th>
                <th style={{ textAlign: "right", padding: "6px 4px" }}>Avg Actual</th>
                <th style={{ textAlign: "right", padding: "6px 4px" }}>Target</th>
                <th style={{ textAlign: "right", padding: "6px 4px" }}>Compliance</th>
              </tr>
            </thead>
            <tbody>
              {([
                { label: "Calories (kcal)", actual: data.nutrition.summary.avgKcal, target: data.client.targetKcal },
                { label: "Protein (g)", actual: data.nutrition.summary.avgProteinG, target: data.client.targetProteinG },
                { label: "Carbs (g)", actual: data.nutrition.summary.avgCarbG, target: data.client.targetCarbG },
                { label: "Fat (g)", actual: data.nutrition.summary.avgFatG, target: data.client.targetFatG },
              ]).map(({ label, actual, target }) => (
                <tr key={label} style={{ borderBottom: "1px solid #ddd" }}>
                  <td style={{ padding: "8px 4px" }}>{label}</td>
                  <td style={{ padding: "8px 4px", textAlign: "right", fontWeight: 600 }}>{Math.round(actual)}</td>
                  <td style={{ padding: "8px 4px", textAlign: "right" }}>{target ?? "—"}</td>
                  <td style={{ padding: "8px 4px", textAlign: "right", fontWeight: 600 }}>
                    {target ? `${Math.round((actual / target) * 100)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ color: "#888", fontSize: 13 }}>No nutrition data for this period.</div>
        )}

        {data.nutrition && (
          <div style={{ marginTop: 12, fontSize: 13, color: "#666" }}>
            Data collected on {data.nutrition.summary.daysWithData} days ({data.nutrition.summary.compliancePct}% compliance)
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: 32, paddingTop: 12, borderTop: "1px solid #ddd", fontSize: 11, color: "#999", textAlign: "center" }}>
          Generated {new Date().toLocaleString()} &middot; Nutrition Autopilot
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; }
        }
      `}</style>
    </>
  );
}
