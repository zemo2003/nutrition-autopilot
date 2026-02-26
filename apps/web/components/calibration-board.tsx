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

type CalibrationRecord = {
  id: string;
  componentId: string;
  method: string | null;
  cutForm: string | null;
  expectedYieldPct: number;
  actualYieldPct: number;
  variancePct: number;
  sampleCount: number;
  confidenceScore: number;
  proposedYieldPct: number | null;
  status: string;
  isOutlier: boolean;
  reviewNotes: string | null;
  createdAt: string;
  component: { id: string; name: string; componentType: string };
};

type CalibrationProposal = {
  componentId: string;
  componentName: string;
  method?: string;
  cutForm?: string;
  currentDefaultYieldPct: number;
  proposedYieldPct: number;
  confidence: number;
  sampleCount: number;
  meanActualYieldPct: number;
  stdDevPct: number;
  outlierCount: number;
  basis: "calibrated" | "default";
  reason: string;
};

type VarianceAnalytic = {
  componentId: string;
  componentName: string;
  sampleCount: number;
  meanActualYieldPct: number;
  stdDevPct: number;
  meanVariancePct: number;
  normalCount: number;
  warningCount: number;
  criticalCount: number;
};

/* ── Component ────────────────────────────────────────────── */

export default function CalibrationBoard() {
  const [tab, setTab] = useState<"records" | "proposals" | "analytics">("records");
  const [records, setRecords] = useState<CalibrationRecord[]>([]);
  const [proposals, setProposals] = useState<CalibrationProposal[]>([]);
  const [analytics, setAnalytics] = useState<VarianceAnalytic[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const API = resolveApiBase();

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/v1/yield-calibrations`);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const json = await res.json();
      setRecords(json.calibrations ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [API]);

  const loadProposals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/v1/yield-calibrations/proposals`);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const json = await res.json();
      setProposals(json.proposals ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [API]);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/v1/yield-calibrations/variance-analytics`);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const json = await res.json();
      setAnalytics(json.analytics ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [API]);

  useEffect(() => {
    if (tab === "records") loadRecords();
    if (tab === "proposals") loadProposals();
    if (tab === "analytics") loadAnalytics();
  }, [tab, loadRecords, loadProposals, loadAnalytics]);

  async function reviewCalibration(id: string, status: "ACCEPTED" | "REJECTED") {
    try {
      const res = await fetch(`${API}/v1/yield-calibrations/${id}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`Review failed: ${res.status}`);
      loadRecords();
    } catch (e: any) {
      setError(e.message);
    }
  }

  function varianceBadge(v: number) {
    const abs = Math.abs(v);
    if (abs > 30) return <span className="badge badge-danger">Critical {v.toFixed(1)}%</span>;
    if (abs > 15) return <span className="badge badge-warn">Warning {v.toFixed(1)}%</span>;
    return <span className="badge badge-info">{v.toFixed(1)}%</span>;
  }

  function statusBadge(s: string) {
    if (s === "ACCEPTED") return <span className="badge badge-success">Accepted</span>;
    if (s === "REJECTED") return <span className="badge badge-danger">Rejected</span>;
    if (s === "SUPERSEDED") return <span className="badge" style={{ background: "var(--c-surface-alt)" }}>Superseded</span>;
    return <span className="badge badge-warn">Pending Review</span>;
  }

  function confidenceBadge(c: number) {
    if (c >= 0.8) return <span className="badge badge-success">{(c * 100).toFixed(0)}%</span>;
    if (c >= 0.6) return <span className="badge badge-info">{(c * 100).toFixed(0)}%</span>;
    return <span className="badge badge-warn">{(c * 100).toFixed(0)}%</span>;
  }

  return (
    <div>
      {/* Tab bar */}
      <div className="row" style={{ gap: "var(--sp-2)", marginBottom: "var(--sp-4)" }}>
        {(["records", "proposals", "analytics"] as const).map((t) => (
          <button
            key={t}
            className={`btn ${tab === t ? "btn-primary" : "btn-outline"} btn-sm`}
            onClick={() => setTab(t)}
          >
            {t === "records" ? "Calibration Records" : t === "proposals" ? "Proposals" : "Variance Analytics"}
          </button>
        ))}
      </div>

      {error && <div className="card" style={{ borderColor: "var(--c-danger)", padding: "var(--sp-3)" }}>{error}</div>}
      {loading && <div style={{ color: "var(--c-ink-soft)" }}>Loading...</div>}

      {/* Records tab */}
      {tab === "records" && !loading && (
        <div className="card" style={{ overflowX: "auto" }}>
          {records.length === 0 ? (
            <div style={{ padding: "var(--sp-4)", color: "var(--c-ink-soft)", textAlign: "center" }}>
              No yield calibration records yet. Complete batches with yield data to generate records.
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Expected</th>
                  <th>Actual</th>
                  <th>Variance</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.component.name}</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--c-ink-soft)" }}>
                        {r.method && `${r.method}`}{r.cutForm && ` / ${r.cutForm}`}
                        {r.isOutlier && <span className="badge badge-warn" style={{ marginLeft: "var(--sp-1)" }}>Outlier</span>}
                      </div>
                    </td>
                    <td>{r.expectedYieldPct.toFixed(1)}%</td>
                    <td>{r.actualYieldPct.toFixed(1)}%</td>
                    <td>{varianceBadge(r.variancePct)}</td>
                    <td>{statusBadge(r.status)}</td>
                    <td>
                      {r.status === "PENDING_REVIEW" && (
                        <div className="row" style={{ gap: "var(--sp-1)" }}>
                          <button className="btn btn-outline btn-sm" onClick={() => reviewCalibration(r.id, "ACCEPTED")}>Accept</button>
                          <button className="btn btn-outline btn-sm" style={{ color: "var(--c-danger)" }} onClick={() => reviewCalibration(r.id, "REJECTED")}>Reject</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Proposals tab */}
      {tab === "proposals" && !loading && (
        <div className="card" style={{ overflowX: "auto" }}>
          {proposals.length === 0 ? (
            <div style={{ padding: "var(--sp-4)", color: "var(--c-ink-soft)", textAlign: "center" }}>
              No proposals available. Complete more batches with yield data.
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Current Default</th>
                  <th>Proposed</th>
                  <th>Mean Actual</th>
                  <th>Confidence</th>
                  <th>Samples</th>
                  <th>Basis</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((p) => (
                  <tr key={p.componentId}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{p.componentName}</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--c-ink-soft)" }}>
                        {p.method && `${p.method}`}{p.cutForm && ` / ${p.cutForm}`}
                      </div>
                    </td>
                    <td>{p.currentDefaultYieldPct.toFixed(1)}%</td>
                    <td style={{ fontWeight: 600, color: p.basis === "calibrated" ? "var(--c-success)" : "inherit" }}>
                      {p.proposedYieldPct.toFixed(1)}%
                    </td>
                    <td>{p.meanActualYieldPct.toFixed(1)}% (±{p.stdDevPct.toFixed(1)})</td>
                    <td>{confidenceBadge(p.confidence)}</td>
                    <td>
                      {p.sampleCount}
                      {p.outlierCount > 0 && <span style={{ color: "var(--c-ink-soft)", fontSize: "0.75rem" }}> ({p.outlierCount} outlier{p.outlierCount > 1 ? "s" : ""})</span>}
                    </td>
                    <td>
                      <span className={`badge ${p.basis === "calibrated" ? "badge-success" : "badge-warn"}`}>
                        {p.basis}
                      </span>
                      <div style={{ fontSize: "0.7rem", color: "var(--c-ink-soft)", marginTop: "2px" }}>{p.reason}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Analytics tab */}
      {tab === "analytics" && !loading && (
        <div className="card" style={{ overflowX: "auto" }}>
          {analytics.length === 0 ? (
            <div style={{ padding: "var(--sp-4)", color: "var(--c-ink-soft)", textAlign: "center" }}>
              No variance data yet.
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Samples</th>
                  <th>Mean Yield</th>
                  <th>Std Dev</th>
                  <th>Mean Variance</th>
                  <th>Normal</th>
                  <th>Warning</th>
                  <th>Critical</th>
                </tr>
              </thead>
              <tbody>
                {analytics.map((a) => (
                  <tr key={a.componentId}>
                    <td style={{ fontWeight: 600 }}>{a.componentName}</td>
                    <td>{a.sampleCount}</td>
                    <td>{a.meanActualYieldPct.toFixed(1)}%</td>
                    <td>{a.stdDevPct.toFixed(1)}%</td>
                    <td>{varianceBadge(a.meanVariancePct)}</td>
                    <td><span className="badge badge-info">{a.normalCount}</span></td>
                    <td><span className="badge badge-warn">{a.warningCount}</span></td>
                    <td><span className="badge badge-danger">{a.criticalCount}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
