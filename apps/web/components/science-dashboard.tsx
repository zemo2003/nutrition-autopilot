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

/* ── Types ──────────────────────────────────────────── */

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
  quality: {
    month: string;
    coverage: {
      productFull40CoverageRatio: number;
      finalLabelFull40CoverageRatio: number;
    };
    evidence: {
      inferredRows: number;
      exceptionRows: number;
      floorRows: number;
      provisionalLabels: number;
    };
    totals: {
      openVerificationTasks: number;
      criticalOrHighVerificationTasks: number;
    };
  } | null;
  clients: { id: string; name: string; externalRef?: string }[];
};

type WeeklyDay = {
  date: string;
  dayOfWeek: string;
  mealCount: number;
  totalKcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fiberG: number;
  meals: { id: string; servedAt: string; mealSlot: string; skuName: string; kcal: number; proteinG: number; carbG: number; fatG: number; fiberG: number }[];
};

type WeeklyResponse = {
  clientId: string;
  weekStart: string;
  weekEnd: string;
  days: WeeklyDay[];
  summary: {
    totalMeals: number;
    daysWithData: number;
    avgKcal: number;
    avgProteinG: number;
    avgCarbG: number;
    avgFatG: number;
    totalKcal: number;
    totalProteinG: number;
    totalCarbG: number;
    totalFatG: number;
  };
};

type BiometricSummary = {
  snapshotCount: number;
  bmi: number | null;
  bmiCategory: string | null;
  trends: { field: string; direction: string; latestValue: number | null; deltaAbs: number | null }[];
  dataQuality: { daysSinceLastSnapshot: number | null };
};

type MetricStatus = {
  metricKey: string;
  label: string;
  latestValue: number | null;
  latestUnit: string | null;
  latestObservedAt: string | null;
  rangeStatus: "normal" | "warning" | "critical" | "unknown";
  staleDays: number | null;
  category: string;
};

type ClientDocument = {
  id: string;
  documentType: string;
  collectedAt: string;
};

/* ── Helpers ────────────────────────────────────────── */

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function staleDaysLabel(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days}d ago`;
}

function biomarkerStatus(key: string, value: number): "normal" | "warning" | "critical" {
  const thresholds: Record<string, { warn: [number, number]; crit: [number, number] }> = {
    fasting_glucose: { warn: [100, 125], crit: [126, Infinity] },
    hba1c: { warn: [5.7, 6.4], crit: [6.5, Infinity] },
    ldl: { warn: [130, 159], crit: [160, Infinity] },
    hdl: { warn: [0, 39], crit: [0, 0] },
    triglycerides: { warn: [150, 199], crit: [200, Infinity] },
    body_fat_pct: { warn: [25, 30], crit: [31, Infinity] },
  };
  const t = thresholds[key];
  if (!t) return "normal";
  if (value >= t.crit[0] && value <= t.crit[1]) return "critical";
  if (value >= t.warn[0] && value <= t.warn[1]) return "warning";
  return "normal";
}

const RESEARCH_TYPES = [
  { type: "CGM", label: "CGM Data" },
  { type: "DEXA", label: "DEXA Scans" },
  { type: "BLOODWORK", label: "Bloodwork" },
  { type: "OTHER", label: "Other / DLW" },
] as const;

/* ── Component ──────────────────────────────────────── */

export function ScienceDashboard({ counts, quality, clients }: Props) {
  const selectedClient = clients[0] ?? null;
  const clientId = selectedClient?.id;

  const [weekly, setWeekly] = useState<WeeklyResponse | null>(null);
  const [bioSummary, setBioSummary] = useState<BiometricSummary | null>(null);
  const [metrics, setMetrics] = useState<MetricStatus[]>([]);
  const [documents, setDocuments] = useState<ClientDocument[]>([]);
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!clientId) { setLoading(false); return; }
    const api = resolveApiBase();
    setLoading(true);
    try {
      const [weeklyRes, bioRes, metricsRes, docsRes] = await Promise.allSettled([
        fetch(`${api}/v1/clients/${clientId}/nutrition/weekly?date=${todayStr()}`).then((r) => r.ok ? r.json() : null),
        fetch(`${api}/v1/clients/${clientId}/biometrics/summary`).then((r) => r.ok ? r.json() : null),
        fetch(`${api}/v1/clients/${clientId}/metrics/status`).then((r) => r.ok ? r.json() : null),
        fetch(`${api}/v1/clients/${clientId}/documents`).then((r) => r.ok ? r.json() : null),
      ]);
      if (weeklyRes.status === "fulfilled" && weeklyRes.value) setWeekly(weeklyRes.value);
      if (bioRes.status === "fulfilled" && bioRes.value) setBioSummary(bioRes.value);
      if (metricsRes.status === "fulfilled" && metricsRes.value) setMetrics(metricsRes.value.statuses ?? []);
      if (docsRes.status === "fulfilled" && docsRes.value) setDocuments(Array.isArray(docsRes.value) ? docsRes.value : []);
    } catch { /* network failures are non-fatal */ }
    setLoading(false);
  }, [clientId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Derived biometrics for hero
  const weightTrend = bioSummary?.trends.find((t) => t.field === "weightKg");
  const bfTrend = bioSummary?.trends.find((t) => t.field === "bodyFatPct");
  const hrTrend = bioSummary?.trends.find((t) => t.field === "restingHr");

  // Research doc counts
  const docCountByType = (type: string) => documents.filter((d) => d.documentType === type);
  const latestDocDate = (type: string) => {
    const docs = docCountByType(type).sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
    return docs[0]?.collectedAt?.slice(0, 10) ?? null;
  };

  // Coverage values
  const productCoverage = quality
    ? (quality.coverage.productFull40CoverageRatio * 100).toFixed(0)
    : "—";
  const labelCoverage = quality
    ? (quality.coverage.finalLabelFull40CoverageRatio * 100).toFixed(0)
    : "—";

  if (!selectedClient) {
    return (
      <div className="page-shell">
        <div className="state-box">
          <div className="state-title">No Client Data</div>
          <div className="state-desc">Create a client profile to begin tracking.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      {/* A. Profile Hero Card */}
      <div className="science-profile-hero">
        <div className="science-profile-avatar">
          {selectedClient.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
        </div>
        <div className="science-profile-info">
          <div className="science-profile-name">{selectedClient.name}</div>
          <div className="science-profile-kpis">
            {weightTrend?.latestValue != null && (
              <span className="science-profile-kpi"><strong>{weightTrend.latestValue.toFixed(1)}</strong> kg</span>
            )}
            {bioSummary?.bmi != null && (
              <span className="science-profile-kpi"><strong>{bioSummary.bmi.toFixed(1)}</strong> BMI</span>
            )}
            {bfTrend?.latestValue != null && (
              <span className="science-profile-kpi"><strong>{bfTrend.latestValue.toFixed(1)}</strong>% BF</span>
            )}
            {hrTrend?.latestValue != null && (
              <span className="science-profile-kpi"><strong>{hrTrend.latestValue}</strong> bpm</span>
            )}
          </div>
        </div>
        <Link href={"/clients-health" as any} className="science-profile-edit">Edit Profile</Link>
      </div>

      {/* B. 7-Day Macro Overview */}
      <section className="section">
        <h2 className="section-title">7-Day Macro Overview</h2>

        {loading ? (
          <div className="loading-shimmer loading-block" style={{ height: 180 }} />
        ) : weekly ? (
          <>
            <div className="macro-legend">
              <span><span className="macro-legend-dot" style={{ background: "#34d399" }} /> Protein</span>
              <span><span className="macro-legend-dot" style={{ background: "#60a5fa" }} /> Carbs</span>
              <span><span className="macro-legend-dot" style={{ background: "#f59e0b" }} /> Fat</span>
            </div>

            <div className="macro-week-grid">
              {weekly.days.map((day) => {
                const isToday = day.date === todayStr();
                const isEmpty = day.mealCount === 0;
                const totalMacro = day.proteinG + day.carbG + day.fatG;
                const pPct = totalMacro > 0 ? (day.proteinG / totalMacro) * 100 : 0;
                const cPct = totalMacro > 0 ? (day.carbG / totalMacro) * 100 : 0;
                const fPct = totalMacro > 0 ? (day.fatG / totalMacro) * 100 : 0;

                return (
                  <div
                    key={day.date}
                    className={`macro-day-card${isToday ? " macro-day-card--today" : ""}${isEmpty ? " macro-day-card--empty" : ""}`}
                  >
                    <div className="macro-day-label">{day.dayOfWeek}</div>
                    <div className="macro-day-date">{day.date.slice(5)}</div>
                    <div className="macro-day-kcal">
                      {isEmpty ? "—" : day.totalKcal}
                      {!isEmpty && <span className="macro-day-kcal-unit"> kcal</span>}
                    </div>
                    {!isEmpty && (
                      <>
                        <div className="macro-bar">
                          <div className="macro-bar-protein" style={{ width: `${pPct}%` }} />
                          <div className="macro-bar-carb" style={{ width: `${cPct}%` }} />
                          <div className="macro-bar-fat" style={{ width: `${fPct}%` }} />
                        </div>
                        <div className="macro-day-breakdown">
                          P {Math.round(day.proteinG)}g · C {Math.round(day.carbG)}g · F {Math.round(day.fatG)}g
                        </div>
                      </>
                    )}
                    <div className="macro-day-meals">
                      {isEmpty ? "No meals" : `${day.mealCount} meal${day.mealCount !== 1 ? "s" : ""}`}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="macro-week-summary">
              <span className="macro-week-summary-item"><strong>{weekly.summary.avgKcal}</strong> avg kcal</span>
              <span className="macro-week-summary-item"><strong>{weekly.summary.avgProteinG}g</strong> avg P</span>
              <span className="macro-week-summary-item"><strong>{weekly.summary.avgCarbG}g</strong> avg C</span>
              <span className="macro-week-summary-item"><strong>{weekly.summary.avgFatG}g</strong> avg F</span>
              <span className="macro-week-summary-item"><strong>{weekly.summary.totalMeals}</strong> meals</span>
              <span className="macro-week-summary-item"><strong>{weekly.summary.daysWithData}</strong>/7 days</span>
            </div>
          </>
        ) : (
          <div style={{ color: "var(--c-ink-muted)", fontSize: "var(--text-sm)" }}>No nutrition data available.</div>
        )}
      </section>

      {/* C. Biomarker Snapshot */}
      <section className="section">
        <h2 className="section-title">Biomarker Snapshot</h2>
        {loading ? (
          <div className="loading-shimmer loading-block" style={{ height: 120 }} />
        ) : metrics.length > 0 ? (
          <div className="biomarker-grid">
            {metrics.slice(0, 12).map((m) => {
              const status = m.latestValue != null ? biomarkerStatus(m.metricKey, m.latestValue) : "normal";
              return (
                <div key={m.metricKey} className="biomarker-card">
                  <div className="biomarker-card-label">{m.label}</div>
                  <div className="biomarker-card-value">
                    {m.latestValue != null ? m.latestValue : "—"}
                    {m.latestUnit && <span className="biomarker-card-unit">{m.latestUnit}</span>}
                  </div>
                  {m.latestValue != null && status !== "normal" && (
                    <span className={`biomarker-status biomarker-status--${status}`}>{status}</span>
                  )}
                  {m.staleDays != null && (
                    <div className="biomarker-card-stale">{staleDaysLabel(m.staleDays)}</div>
                  )}
                </div>
              );
            })}
            {/* Show biometrics-derived values if no metric entries cover them */}
            {weightTrend?.latestValue != null && !metrics.some((m) => m.metricKey === "weight_kg") && (
              <div className="biomarker-card">
                <div className="biomarker-card-label">Weight</div>
                <div className="biomarker-card-value">{weightTrend.latestValue.toFixed(1)}<span className="biomarker-card-unit">kg</span></div>
                {bioSummary?.dataQuality.daysSinceLastSnapshot != null && (
                  <div className="biomarker-card-stale">{staleDaysLabel(bioSummary.dataQuality.daysSinceLastSnapshot)}</div>
                )}
              </div>
            )}
            {bfTrend?.latestValue != null && !metrics.some((m) => m.metricKey === "body_fat_pct") && (
              <div className="biomarker-card">
                <div className="biomarker-card-label">Body Fat</div>
                <div className="biomarker-card-value">{bfTrend.latestValue.toFixed(1)}<span className="biomarker-card-unit">%</span></div>
              </div>
            )}
            {hrTrend?.latestValue != null && !metrics.some((m) => m.metricKey === "resting_hr") && (
              <div className="biomarker-card">
                <div className="biomarker-card-label">Resting HR</div>
                <div className="biomarker-card-value">{hrTrend.latestValue}<span className="biomarker-card-unit">bpm</span></div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: "var(--c-ink-muted)", fontSize: "var(--text-sm)" }}>No biomarker data recorded yet.</div>
        )}
      </section>

      {/* D. Research Data Links */}
      <section className="section">
        <h2 className="section-title">Research Data</h2>
        <div className="research-links">
          {RESEARCH_TYPES.map(({ type, label }) => {
            const count = docCountByType(type).length;
            const latest = latestDocDate(type);
            return (
              <Link
                key={type}
                href={`/clients-health` as any}
                className="research-link-card"
              >
                <div className="research-link-card-title">{label}</div>
                <div className="research-link-card-meta">
                  {count} record{count !== 1 ? "s" : ""}
                  {latest && ` · Last: ${latest}`}
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Collapsed Data Pipeline */}
      <button
        className="science-collapsible-toggle"
        onClick={() => setPipelineOpen((v) => !v)}
      >
        {pipelineOpen ? "▾" : "▸"} Data Pipeline
      </button>

      {pipelineOpen && (
        <>
          {/* Verification queue */}
          <section className="section">
            <h2 className="section-title">Verification Queue</h2>
            <div className="kpi-grid">
              <div className="kpi">
                <div className="kpi-value">{counts.openVerificationTasks}</div>
                <div className="kpi-label">Open Tasks</div>
              </div>
              <div className="kpi">
                <div className="kpi-value">{quality?.totals.criticalOrHighVerificationTasks ?? 0}</div>
                <div className="kpi-label">Critical / High</div>
                {(quality?.totals.criticalOrHighVerificationTasks ?? 0) > 0 && (
                  <div className="kpi-note"><span className="badge badge-danger">Needs Attention</span></div>
                )}
              </div>
              <div className="kpi">
                <div className="kpi-value">{quality?.evidence.provisionalLabels ?? 0}</div>
                <div className="kpi-label">Provisional Labels</div>
              </div>
              <Link href={"/data-quality" as any} className="kpi" style={{ textDecoration: "none", cursor: "pointer" }}>
                <div className="kpi-value" style={{ fontSize: "var(--text-lg)" }}>Review Queue</div>
                <div className="kpi-label">Open verification tasks</div>
                <div className="kpi-note"><span className="badge badge-info">Open</span></div>
              </Link>
            </div>
          </section>

          {/* Coverage */}
          <section className="section">
            <h2 className="section-title">Nutrient Coverage</h2>
            <div className="kpi-grid">
              <div className="kpi">
                <div className="kpi-value">{productCoverage}%</div>
                <div className="kpi-label">Product Coverage (40-nutrient)</div>
              </div>
              <div className="kpi">
                <div className="kpi-value">{labelCoverage}%</div>
                <div className="kpi-label">Label Coverage (40-nutrient)</div>
              </div>
              <div className="kpi">
                <div className="kpi-value">{quality?.evidence.inferredRows ?? 0}</div>
                <div className="kpi-label">Inferred Nutrients</div>
              </div>
              <div className="kpi">
                <div className="kpi-value">{quality?.evidence.exceptionRows ?? 0}</div>
                <div className="kpi-label">Exception Rows</div>
              </div>
            </div>
          </section>

          {/* System overview */}
          <section className="section">
            <h2 className="section-title">System Overview</h2>
            <div className="kpi-grid">
              <div className="kpi">
                <div className="kpi-value">{counts.activeSkus}</div>
                <div className="kpi-label">Active SKUs</div>
              </div>
              <div className="kpi">
                <div className="kpi-value">{counts.activeIngredients}</div>
                <div className="kpi-label">Ingredients</div>
              </div>
              <div className="kpi">
                <div className="kpi-value">{counts.servedMeals}</div>
                <div className="kpi-label">Served Meals</div>
              </div>
              <div className="kpi">
                <div className="kpi-value">{counts.labels}</div>
                <div className="kpi-label">Frozen Labels</div>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
