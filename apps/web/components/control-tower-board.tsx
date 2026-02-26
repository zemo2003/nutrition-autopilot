"use client";

import Link from "next/link";
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

type AttentionItem = {
  id: string;
  severity: string;
  category: string;
  title: string;
  description: string;
  actionUrl: string | null;
  score: number;
};

type ExpiringLot = {
  lotId: string;
  productName: string;
  expiresAt: string;
  quantityG: number;
};

type ControlTowerData = {
  today: {
    mealsDue: number;
    mealsServed: number;
    mealCompletionPct: number;
    batchesDue: number;
    batchesActive: number;
    batchesBlocked: number;
    shortageCount: number;
    expiringLotCount: number;
    expiringLots: ExpiringLot[];
  };
  scientificQa: {
    openVerificationTasks: number;
    criticalVerificationTasks: number;
    dataQualityScore: number;
    pendingSubstitutions: number;
    pendingCalibrationReviews: number;
    openQcIssues: number;
  };
  clientData: {
    staleBiometrics: number;
    unverifiedDocs: number;
    failedParsing: number;
    staleMetrics: number;
    readinessScore: number;
  };
  reliability: {
    failedImports: number;
    stuckBatches: number;
    healthScore: number;
  };
  attentionQueue: AttentionItem[];
  overallHealthScore: number;
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "var(--c-danger)",
  high: "#e67e22",
  medium: "var(--c-warning)",
  low: "var(--c-ink-soft)",
};

function ScoreGauge({ score, label }: { score: number; label: string }) {
  const color = score >= 80 ? "var(--c-success)" : score >= 50 ? "var(--c-warning)" : "var(--c-danger)";
  return (
    <div className="kpi">
      <div className="kpi-value" style={{ color }}>{score}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

export default function ControlTowerBoard() {
  const [data, setData] = useState<ControlTowerData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const base = resolveApiBase();
    const res = await fetch(`${base}/v1/control-tower`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="state-box"><div className="state-title">Loading control tower...</div></div>;
  if (!data) return <div className="state-box"><div className="state-title">Failed to load</div></div>;

  return (
    <div>
      {/* Overall Health */}
      <div className="kpi-grid" style={{ marginBottom: "var(--sp-4)" }}>
        <ScoreGauge score={data.overallHealthScore} label="Overall Health" />
        <ScoreGauge score={data.scientificQa.dataQualityScore} label="Data Quality" />
        <ScoreGauge score={data.clientData.readinessScore} label="Client Readiness" />
        <ScoreGauge score={data.reliability.healthScore} label="System Health" />
      </div>

      {/* Attention Queue */}
      {data.attentionQueue.length > 0 && (
        <section className="section">
          <h3 className="section-title">Attention Queue ({data.attentionQueue.length})</h3>
          <div style={{ display: "grid", gap: "var(--sp-2)" }}>
            {data.attentionQueue.map((item) => (
              <div key={item.id} className="card" style={{ padding: "var(--sp-3)", borderLeft: `4px solid ${SEVERITY_COLORS[item.severity] ?? "var(--c-ink-soft)"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      <span className="badge" style={{ background: SEVERITY_COLORS[item.severity], color: "white", marginRight: 8 }}>{item.severity.toUpperCase()}</span>
                      {item.title}
                    </div>
                    <div style={{ color: "var(--c-ink-soft)", fontSize: "0.9em" }}>{item.description}</div>
                  </div>
                  {item.actionUrl && (
                    <Link href={item.actionUrl as any} className="btn btn-outline btn-sm" style={{ flexShrink: 0 }}>Go</Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Today */}
      <section className="section">
        <h3 className="section-title">Today</h3>
        <div className="kpi-grid">
          <div className="kpi">
            <div className="kpi-value">{data.today.mealsServed}/{data.today.mealsDue}</div>
            <div className="kpi-label">Meals ({data.today.mealCompletionPct}%)</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">{data.today.batchesDue}</div>
            <div className="kpi-label">Batches Due</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">{data.today.batchesActive}</div>
            <div className="kpi-label">Active</div>
          </div>
          <div className="kpi">
            <div className="kpi-value" style={{ color: data.today.batchesBlocked > 0 ? "var(--c-danger)" : "inherit" }}>{data.today.batchesBlocked}</div>
            <div className="kpi-label">Blocked</div>
          </div>
          <div className="kpi">
            <div className="kpi-value" style={{ color: data.today.shortageCount > 0 ? "var(--c-danger)" : "inherit" }}>{data.today.shortageCount}</div>
            <div className="kpi-label">Shortages</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">{data.today.expiringLotCount}</div>
            <div className="kpi-label">Expiring Lots</div>
          </div>
        </div>
      </section>

      {/* Scientific QA */}
      <section className="section">
        <h3 className="section-title">Scientific QA</h3>
        <div className="kpi-grid">
          <div className="kpi">
            <div className="kpi-value">{data.scientificQa.openVerificationTasks}</div>
            <div className="kpi-label">Open Tasks</div>
            {data.scientificQa.criticalVerificationTasks > 0 && <div className="kpi-note"><span className="badge badge-warn">{data.scientificQa.criticalVerificationTasks} Critical</span></div>}
          </div>
          <div className="kpi">
            <div className="kpi-value">{data.scientificQa.openQcIssues}</div>
            <div className="kpi-label">QC Issues</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">{data.scientificQa.pendingCalibrationReviews}</div>
            <div className="kpi-label">Calibration Reviews</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">{data.scientificQa.pendingSubstitutions}</div>
            <div className="kpi-label">Pending Subs</div>
          </div>
        </div>
      </section>

      {/* Client Data Readiness */}
      <section className="section">
        <h3 className="section-title">Client Data</h3>
        <div className="kpi-grid">
          <div className="kpi">
            <div className="kpi-value">{data.clientData.staleBiometrics}</div>
            <div className="kpi-label">Stale Biometrics</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">{data.clientData.unverifiedDocs}</div>
            <div className="kpi-label">Unverified Docs</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">{data.clientData.failedParsing}</div>
            <div className="kpi-label">Failed Parsing</div>
          </div>
        </div>
      </section>

      {/* System Reliability */}
      <section className="section">
        <h3 className="section-title">System Reliability</h3>
        <div className="kpi-grid">
          <div className="kpi">
            <div className="kpi-value" style={{ color: data.reliability.failedImports > 0 ? "var(--c-danger)" : "inherit" }}>{data.reliability.failedImports}</div>
            <div className="kpi-label">Failed Imports</div>
          </div>
          <div className="kpi">
            <div className="kpi-value" style={{ color: data.reliability.stuckBatches > 0 ? "var(--c-warning)" : "inherit" }}>{data.reliability.stuckBatches}</div>
            <div className="kpi-label">Stuck Batches</div>
          </div>
        </div>
      </section>

      {/* Print Links */}
      <div className="row" style={{ gap: "var(--sp-2)", marginTop: "var(--sp-4)" }}>
        <Link href={"/control-tower/print/daily-ops" as any} className="btn btn-outline btn-sm">Print Daily Ops</Link>
        <Link href={"/control-tower/print/qa-summary" as any} className="btn btn-outline btn-sm">Print QA Summary</Link>
      </div>
    </div>
  );
}
