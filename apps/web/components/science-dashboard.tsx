"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { Sparkline } from "./sparkline";
import { DualLineChart } from "./dual-line-chart";
import { AdaptationTimeline } from "./adaptation-timeline";
import {
  computeAge,
  computeTDEE,
  computeCaloricBalance,
  recommendMacroTargets,
  ACTIVITY_MULTIPLIERS,
  type ActivityLevel,
  type GoalType,
  ACTIVITY_LABELS,
} from "@nutrition/nutrition-engine";

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

type ClientProfile = {
  id: string;
  fullName: string;
  heightCm: number | null;
  weightKg: number | null;
  dateOfBirth: string | null;
  sex: string | null;
  activityLevel: string | null;
  targetKcal: number | null;
  targetProteinG: number | null;
  targetCarbG: number | null;
  targetFatG: number | null;
  targetWeightKg: number | null;
  targetBodyFatPct: number | null;
};

type BiometricSnapshot = {
  id: string;
  measuredAt: string;
  heightCm: number | null;
  weightKg: number | null;
  bodyFatPct: number | null;
  leanMassKg: number | null;
  restingHr: number | null;
  source: string | null;
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

function statusColor(status: string): string {
  if (status === "critical") return "var(--c-danger, #ef4444)";
  if (status === "warning") return "var(--c-warning, #f59e0b)";
  return "var(--c-success, #22c55e)";
}

function sourceIcon(metricKey: string): string {
  if (metricKey.startsWith("cgm_")) return "📊";
  if (["bmd_total", "android_fat_pct", "gynoid_fat_pct", "ag_ratio", "fat_mass_kg", "lean_mass_kg", "body_fat_pct", "bmi", "bone_mineral_content_kg", "fat_free_mass_kg", "vat_mass_lbs", "arm_fat_pct", "leg_fat_pct", "trunk_fat_pct"].includes(metricKey)) return "🦴";
  if (["total_testosterone", "free_testosterone", "estrogen", "shbg", "vitamin_d", "ferritin", "crp", "albumin", "apob", "total_cholesterol", "hdl", "ldl", "triglycerides", "tsh", "free_t3", "creatinine", "tc_hdl_ratio", "tg_hdl_ratio", "remnant_cholesterol", "ldl_apob_ratio"].includes(metricKey)) return "🩸";
  return "";
}

const METRIC_CATEGORIES: Record<string, { label: string; order: number }> = {
  bloodwork: { label: "Bloodwork", order: 1 },
  metabolic: { label: "Metabolic / CGM", order: 2 },
  body_composition: { label: "Body Composition / DEXA", order: 3 },
  cardiovascular: { label: "Cardiovascular", order: 4 },
  other: { label: "Other", order: 5 },
};

function bmiContextLabel(bmi: number, bodyFatPct: number | null | undefined): string | null {
  if (bodyFatPct == null) return null;
  if (bmi >= 30 && bodyFatPct < 15) return "athletic build";
  if (bmi >= 25 && bodyFatPct < 20) return "lean — muscle mass";
  return null;
}

const RESEARCH_TYPES = [
  { type: "CGM", label: "CGM Data" },
  { type: "DEXA", label: "DEXA Scans" },
  { type: "BLOODWORK", label: "Bloodwork" },
  { type: "OTHER", label: "Other / DLW" },
] as const;

/* ── Component ──────────────────────────────────────── */

export function ScienceDashboard({ counts, quality, clients }: Props) {
  // Client selector — persists in localStorage
  const [selectedClientId, setSelectedClientId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("science-dashboard-client");
      if (saved && clients.some((c) => c.id === saved)) return saved;
    }
    return clients[0]?.id ?? "";
  });
  const selectedClient = clients.find((c) => c.id === selectedClientId) ?? clients[0] ?? null;
  const clientId = selectedClient?.id;

  const handleClientChange = useCallback((id: string) => {
    setSelectedClientId(id);
    if (typeof window !== "undefined") localStorage.setItem("science-dashboard-client", id);
  }, []);

  const [weekly, setWeekly] = useState<WeeklyResponse | null>(null);
  const [bioSummary, setBioSummary] = useState<BiometricSummary | null>(null);
  const [bioSnapshots, setBioSnapshots] = useState<BiometricSnapshot[]>([]);
  const [metrics, setMetrics] = useState<MetricStatus[]>([]);
  const [documents, setDocuments] = useState<ClientDocument[]>([]);
  const [clientProfile, setClientProfile] = useState<ClientProfile | null>(null);
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nutritionHistory, setNutritionHistory] = useState<{ weeks: { weekStart: string; weekEnd: string; avgKcal: number; avgProteinG: number; avgCarbG: number; avgFatG: number; totalMeals: number; daysWithData: number }[]; summary: { periodDays: number; totalMeals: number; daysWithData: number; avgKcal: number; avgProteinG: number; avgCarbG: number; avgFatG: number; compliancePct: number } } | null>(null);
  const [historyPeriod, setHistoryPeriod] = useState(30);
  const [tdeeActivityLevel, setTdeeActivityLevel] = useState<string>("moderate");
  const [tdeeGoal, setTdeeGoal] = useState<string>("maintain");

  const fetchData = useCallback(async () => {
    if (!clientId) { setLoading(false); return; }
    const api = resolveApiBase();
    setLoading(true);
    try {
      const [weeklyRes, bioRes, metricsRes, docsRes, snapshotsRes, profileRes] = await Promise.allSettled([
        fetch(`${api}/v1/clients/${clientId}/nutrition/weekly?date=${todayStr()}`).then((r) => r.ok ? r.json() : null),
        fetch(`${api}/v1/clients/${clientId}/biometrics/summary`).then((r) => r.ok ? r.json() : null),
        fetch(`${api}/v1/clients/${clientId}/metrics/status`).then((r) => r.ok ? r.json() : null),
        fetch(`${api}/v1/clients/${clientId}/documents`).then((r) => r.ok ? r.json() : null),
        fetch(`${api}/v1/clients/${clientId}/biometrics`).then((r) => r.ok ? r.json() : []),
        fetch(`${api}/v1/clients/${clientId}`).then((r) => r.ok ? r.json() : null),
      ]);
      if (weeklyRes.status === "fulfilled" && weeklyRes.value) setWeekly(weeklyRes.value);
      if (bioRes.status === "fulfilled" && bioRes.value) setBioSummary(bioRes.value);
      if (metricsRes.status === "fulfilled" && metricsRes.value) setMetrics(metricsRes.value.statuses ?? []);
      if (docsRes.status === "fulfilled" && docsRes.value) {
        const docData = docsRes.value;
        setDocuments(Array.isArray(docData) ? docData : Array.isArray(docData?.documents) ? docData.documents : []);
      }
      if (snapshotsRes.status === "fulfilled") {
        const snapData = snapshotsRes.value;
        setBioSnapshots(Array.isArray(snapData) ? snapData : Array.isArray(snapData?.snapshots) ? snapData.snapshots : []);
      }
      if (profileRes.status === "fulfilled" && profileRes.value) setClientProfile(profileRes.value);
    } catch { /* network failures are non-fatal */ }
    setLoading(false);
  }, [clientId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Fetch nutrition history when period changes
  const fetchHistory = useCallback(async () => {
    if (!clientId) return;
    const api = resolveApiBase();
    try {
      const res = await fetch(`${api}/v1/clients/${clientId}/nutrition/history?days=${historyPeriod}`);
      if (res.ok) setNutritionHistory(await res.json());
    } catch { /* non-fatal */ }
  }, [clientId, historyPeriod]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

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
          {clients.length > 1 ? (
            <select
              className="input"
              value={selectedClientId}
              onChange={(e) => handleClientChange(e.target.value)}
              style={{ fontSize: "var(--text-lg, 18px)", fontWeight: 700, padding: "var(--sp-1) var(--sp-2)", maxWidth: 280 }}
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          ) : (
            <div className="science-profile-name">{selectedClient.name}</div>
          )}
          <div className="science-profile-kpis">
            {weightTrend?.latestValue != null && (
              <span className="science-profile-kpi"><strong>{weightTrend.latestValue.toFixed(1)}</strong> kg</span>
            )}
            {bioSummary?.bmi != null && (
              <span className="science-profile-kpi"><strong>{bioSummary.bmi.toFixed(1)}</strong> BMI{(() => {
                const ctx = bmiContextLabel(bioSummary.bmi, bfTrend?.latestValue);
                return ctx ? <span style={{ fontSize: "var(--text-xs)", color: "var(--c-primary, #4f46e5)", marginLeft: 4 }}>({ctx})</span> : null;
              })()}</span>
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

      {/* A2. Physiology Trends — Sparklines */}
      <section className="section">
        <h2 className="section-title">Physiology Trends</h2>
        {loading ? (
          <div className="loading-shimmer loading-block" style={{ height: 100 }} />
        ) : bioSnapshots.length >= 2 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "var(--sp-3)" }}>
            {([
              { field: "weightKg", label: "Weight", unit: "kg", color: "#6366f1" },
              { field: "bodyFatPct", label: "Body Fat", unit: "%", color: "#f59e0b" },
              { field: "leanMassKg", label: "Lean Mass", unit: "kg", color: "#34d399" },
              { field: "restingHr", label: "Resting HR", unit: "bpm", color: "#ef4444" },
            ] as const).map(({ field, label, unit, color }) => {
              const points = bioSnapshots
                .filter((s) => s[field] != null)
                .map((s) => ({ x: new Date(s.measuredAt).getTime(), y: s[field] as number }));
              const trend = bioSummary?.trends.find((t) => t.field === field);
              const latest = points.length > 0 ? points[points.length - 1]! : null;
              const arrow = trend?.direction === "up" ? "↑" : trend?.direction === "down" ? "↓" : trend?.direction === "stable" ? "→" : "";
              const arrowColor = field === "weightKg" || field === "bodyFatPct"
                ? (trend?.direction === "down" ? "var(--c-success, #22c55e)" : trend?.direction === "up" ? "var(--c-danger, #ef4444)" : "var(--c-ink-muted)")
                : (trend?.direction === "up" ? "var(--c-danger, #ef4444)" : trend?.direction === "down" ? "var(--c-success, #22c55e)" : "var(--c-ink-muted)");

              return (
                <div key={field} style={{
                  padding: "var(--sp-3)", background: "var(--c-surface, #fff)",
                  borderRadius: "var(--r-md, 8px)", border: "1px solid var(--c-border, #e5e7eb)",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "var(--sp-2)" }}>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
                    <span style={{ fontSize: "var(--text-sm)", fontWeight: 700 }}>
                      {latest ? latest.y.toFixed(field === "restingHr" ? 0 : 1) : "—"}
                      <span style={{ fontWeight: 400, color: "var(--c-ink-muted)", marginLeft: 2 }}>{unit}</span>
                      {arrow && <span style={{ color: arrowColor, marginLeft: 4 }}>{arrow}</span>}
                      {trend?.deltaAbs != null && (
                        <span style={{ fontSize: "var(--text-xs)", color: arrowColor, marginLeft: 2 }}>
                          {trend.deltaAbs > 0 ? "+" : ""}{trend.deltaAbs.toFixed(1)}
                        </span>
                      )}
                    </span>
                  </div>
                  <Sparkline data={points} width={240} height={44} color={color} showLatestDot />
                </div>
              );
            })}
          </div>
        ) : bioSnapshots.length === 1 ? (
          /* Single-snapshot fallback: show latest values as static cards */
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "var(--sp-3)" }}>
            {([
              { field: "weightKg" as const, label: "Weight", unit: "kg", color: "#6366f1" },
              { field: "bodyFatPct" as const, label: "Body Fat", unit: "%", color: "#f59e0b" },
              { field: "leanMassKg" as const, label: "Lean Mass", unit: "kg", color: "#34d399" },
              { field: "restingHr" as const, label: "Resting HR", unit: "bpm", color: "#ef4444" },
            ] as const).map(({ field, label, unit, color }) => {
              const val = bioSnapshots[0]?.[field];
              if (val == null) return null;
              return (
                <div key={field} style={{
                  padding: "var(--sp-3)", background: "var(--c-surface, #fff)",
                  borderRadius: "var(--r-md, 8px)", border: `2px solid ${color}20`,
                }}>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "var(--sp-1)" }}>{label}</div>
                  <div style={{ fontSize: "var(--text-lg)", fontWeight: 700 }}>
                    {typeof val === "number" ? val.toFixed(field === "restingHr" ? 0 : 1) : val}
                    <span style={{ fontWeight: 400, color: "var(--c-ink-muted)", fontSize: "var(--text-sm)", marginLeft: 2 }}>{unit}</span>
                  </div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)", marginTop: 2 }}>1 snapshot — add more for trends</div>
                </div>
              );
            }).filter(Boolean)}
          </div>
        ) : (
          <div style={{ color: "var(--c-ink-muted)", fontSize: "var(--text-sm)" }}>
            No biometric snapshots recorded yet.{" "}
            <Link href={clientId ? `/clients/${clientId}/biometrics` as any : "#"} style={{ color: "var(--c-primary, #4f46e5)", fontWeight: 600 }}>Add Snapshot →</Link>
          </div>
        )}
      </section>

      {/* A3. Body Composition Trajectory */}
      {bioSnapshots.length >= 2 && (() => {
        const compSeries = bioSnapshots
          .filter((s) => s.weightKg != null && s.bodyFatPct != null)
          .map((s) => {
            const w = s.weightKg!;
            const bf = s.bodyFatPct!;
            const fat = Math.round((w * bf / 100) * 10) / 10;
            const lean = Math.round((w - fat) * 10) / 10;
            return { date: s.measuredAt.slice(0, 10), fat, lean };
          });
        if (compSeries.length < 2) return null;
        return (
          <section className="section">
            <h2 className="section-title">Body Composition Trajectory</h2>
            <DualLineChart
              series1={compSeries.map((p) => ({ date: p.date, value: p.lean }))}
              series2={compSeries.map((p) => ({ date: p.date, value: p.fat }))}
              label1="Lean Mass (kg)"
              label2="Fat Mass (kg)"
              color1="#34d399"
              color2="#f59e0b"
              unit1="kg"
              unit2="kg"
              height={220}
            />
          </section>
        );
      })()}

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

      {/* B2. Targets vs Actual */}
      {clientProfile && weekly && (clientProfile.targetKcal || clientProfile.targetProteinG || clientProfile.targetCarbG || clientProfile.targetFatG) ? (
        <section className="section">
          <h2 className="section-title">Targets vs Actual (Weekly Avg)</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
            {([
              { label: "Calories", target: clientProfile.targetKcal, actual: weekly.summary.avgKcal, unit: "kcal", color: "#6366f1" },
              { label: "Protein", target: clientProfile.targetProteinG, actual: weekly.summary.avgProteinG, unit: "g", color: "#34d399" },
              { label: "Carbs", target: clientProfile.targetCarbG, actual: weekly.summary.avgCarbG, unit: "g", color: "#60a5fa" },
              { label: "Fat", target: clientProfile.targetFatG, actual: weekly.summary.avgFatG, unit: "g", color: "#f59e0b" },
            ] as const).filter((r) => r.target != null).map((row) => {
              const pct = row.target! > 0 ? Math.min((row.actual / row.target!) * 100, 150) : 0;
              const isOver = row.actual > (row.target! * 1.1);
              const isUnder = row.actual < (row.target! * 0.9);
              return (
                <div key={row.label}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-sm)", marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>{row.label}</span>
                    <span>
                      <strong style={{ color: isOver ? "var(--c-danger, #ef4444)" : isUnder ? "var(--c-warning, #f59e0b)" : "var(--c-success, #22c55e)" }}>
                        {Math.round(row.actual)}
                      </strong>
                      {" / "}{row.target}{row.unit}
                      <span style={{ marginLeft: 8, fontSize: "var(--text-xs)", color: "var(--c-ink-muted)" }}>
                        ({Math.round(pct)}%)
                      </span>
                    </span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: "var(--c-border, #e5e7eb)", overflow: "hidden", position: "relative" }}>
                    <div style={{
                      position: "absolute", left: 0, top: 0, height: "100%", borderRadius: 4,
                      width: `${Math.min(pct, 100)}%`,
                      background: isOver ? "var(--c-danger, #ef4444)" : isUnder ? "var(--c-warning, #f59e0b)" : row.color,
                      transition: "width 0.3s",
                    }} />
                    {/* Target marker at 100% */}
                    <div style={{
                      position: "absolute", left: `${Math.min((100 / 150) * 100, 100)}%`, top: -2, width: 2, height: 12,
                      background: "var(--c-ink, #333)",
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : !loading && clientProfile && !clientProfile.targetKcal && !clientProfile.targetProteinG ? (
        <section className="section">
          <div style={{ textAlign: "center", padding: "var(--sp-4)", color: "var(--c-ink-muted)", fontSize: "var(--text-sm)" }}>
            No nutrition targets set.{" "}
            <Link href={"/clients-health" as any} style={{ color: "var(--c-primary, #4f46e5)", fontWeight: 600 }}>
              Set Targets →
            </Link>
          </div>
        </section>
      ) : null}

      {/* C. Biomarker Snapshot — Categorized */}
      <section className="section">
        <h2 className="section-title">Biomarker Snapshot</h2>
        {loading ? (
          <div className="loading-shimmer loading-block" style={{ height: 120 }} />
        ) : metrics.length > 0 ? (() => {
          // Group metrics by category
          const grouped: Record<string, MetricStatus[]> = {};
          for (const m of metrics) {
            const cat = m.category || "other";
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat]!.push(m);
          }
          // Add biometrics-derived values if not in metrics
          if (weightTrend?.latestValue != null && !metrics.some((m) => m.metricKey === "weight_kg")) {
            if (!grouped["body_composition"]) grouped["body_composition"] = [];
            grouped["body_composition"]!.push({
              metricKey: "weight_kg", label: "Weight", latestValue: weightTrend.latestValue,
              latestUnit: "kg", latestObservedAt: null, rangeStatus: "normal", staleDays: bioSummary?.dataQuality.daysSinceLastSnapshot ?? null, category: "body_composition",
            });
          }

          const sortedCategories = Object.entries(grouped)
            .sort(([a], [b]) => (METRIC_CATEGORIES[a]?.order ?? 99) - (METRIC_CATEGORIES[b]?.order ?? 99));

          // Count warnings/critical per category
          const categoryWorst = (items: MetricStatus[]): "critical" | "warning" | "normal" => {
            if (items.some((m) => m.rangeStatus === "critical")) return "critical";
            if (items.some((m) => m.rangeStatus === "warning")) return "warning";
            return "normal";
          };

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
              {sortedCategories.map(([cat, items]) => {
                const worst = categoryWorst(items);
                const catInfo = METRIC_CATEGORIES[cat];
                const withValues = items.filter((m) => m.latestValue != null);
                if (withValues.length === 0) return null;

                return (
                  <div key={cat}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-2)" }}>
                      <span style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--c-ink)" }}>
                        {catInfo?.label ?? cat.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                      </span>
                      <span style={{
                        fontSize: "var(--text-xs)", fontWeight: 600, padding: "1px 6px", borderRadius: 10,
                        background: worst === "critical" ? "#fef2f2" : worst === "warning" ? "#fffbeb" : "#f0fdf4",
                        color: statusColor(worst),
                      }}>
                        {withValues.length} metric{withValues.length !== 1 ? "s" : ""}
                        {worst !== "normal" && ` · ${items.filter((m) => m.rangeStatus === worst).length} ${worst}`}
                      </span>
                    </div>
                    <div className="biomarker-grid">
                      {withValues.map((m) => {
                        const icon = sourceIcon(m.metricKey);
                        const bmiCtx = m.metricKey === "bmi" && m.latestValue != null
                          ? bmiContextLabel(m.latestValue, bfTrend?.latestValue ?? metrics.find((x) => x.metricKey === "body_fat_pct")?.latestValue)
                          : null;
                        return (
                          <div key={m.metricKey} className="biomarker-card" style={{
                            borderLeft: m.rangeStatus !== "normal" && m.rangeStatus !== "unknown"
                              ? `3px solid ${statusColor(m.rangeStatus)}` : undefined,
                          }}>
                            <div className="biomarker-card-label">
                              {icon && <span style={{ marginRight: 4 }}>{icon}</span>}
                              {m.label}
                            </div>
                            <div className="biomarker-card-value">
                              {m.latestValue != null ? (Number.isInteger(m.latestValue) ? m.latestValue : m.latestValue.toFixed(m.latestValue < 10 ? 2 : 1)) : "—"}
                              {m.latestUnit && <span className="biomarker-card-unit">{m.latestUnit}</span>}
                            </div>
                            {m.latestValue != null && m.rangeStatus !== "normal" && m.rangeStatus !== "unknown" && (
                              <span className={`biomarker-status biomarker-status--${m.rangeStatus}`}>{m.rangeStatus}</span>
                            )}
                            {bmiCtx && (
                              <div style={{ fontSize: "var(--text-xs)", color: "var(--c-primary, #4f46e5)", fontWeight: 500, marginTop: 2 }}>
                                ({bmiCtx})
                              </div>
                            )}
                            {m.staleDays != null && (
                              <div className="biomarker-card-stale">{staleDaysLabel(m.staleDays)}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })() : (
          <div style={{ color: "var(--c-ink-muted)", fontSize: "var(--text-sm)" }}>No biomarker data recorded yet.</div>
        )}
      </section>

      {/* C2. CGM Summary Card */}
      {metrics.some((m) => m.metricKey.startsWith("cgm_")) && (() => {
        const cgm = (key: string) => metrics.find((m) => m.metricKey === key);
        const inRange = cgm("cgm_time_in_range_pct")?.latestValue ?? 0;
        const belowRange = cgm("cgm_time_below_range_pct")?.latestValue ?? 0;
        const aboveRange = cgm("cgm_time_above_range_pct")?.latestValue ?? 0;
        const avgGlucose = cgm("cgm_avg_glucose")?.latestValue;
        const fastingGlucose = cgm("cgm_fasting_glucose_avg")?.latestValue;
        const sdGlucose = cgm("cgm_stddev_glucose")?.latestValue;

        return (
          <section className="section">
            <h2 className="section-title">📊 CGM Summary</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
              {/* Time in range bar */}
              <div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)", marginBottom: 4, fontWeight: 600 }}>Time in Range Distribution</div>
                <div style={{ display: "flex", height: 28, borderRadius: 6, overflow: "hidden", border: "1px solid var(--c-border, #e5e7eb)" }}>
                  {belowRange > 0 && (
                    <div style={{ width: `${belowRange}%`, background: "#ef4444", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700 }}>
                      {belowRange}%
                    </div>
                  )}
                  {inRange > 0 && (
                    <div style={{ width: `${inRange}%`, background: "#22c55e", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700 }}>
                      {inRange}%
                    </div>
                  )}
                  {aboveRange > 0 && (
                    <div style={{ width: `${Math.max(aboveRange, 3)}%`, background: "#f59e0b", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700 }}>
                      {aboveRange}%
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--c-ink-muted)", marginTop: 4 }}>
                  <span style={{ color: "#ef4444" }}>◼ Below {belowRange}%</span>
                  <span style={{ color: "#22c55e" }}>◼ In Range {inRange}%</span>
                  <span style={{ color: "#f59e0b" }}>◼ Above {aboveRange}%</span>
                </div>
              </div>
              {/* KPIs */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "var(--sp-2)" }}>
                {avgGlucose != null && <div className="kpi"><div className="kpi-value">{avgGlucose}</div><div className="kpi-label">Avg Glucose (mg/dL)</div></div>}
                {fastingGlucose != null && <div className="kpi"><div className="kpi-value">{fastingGlucose}</div><div className="kpi-label">Fasting Glucose (mg/dL)</div></div>}
                {sdGlucose != null && <div className="kpi"><div className="kpi-value">{sdGlucose}</div><div className="kpi-label">Variability (SD)</div></div>}
              </div>
              {/* Alert */}
              {belowRange > 4 && (
                <div style={{
                  padding: "var(--sp-2) var(--sp-3)", borderRadius: "var(--r-md, 8px)",
                  background: belowRange > 15 ? "#fef2f2" : "#fffbeb",
                  border: `1px solid ${belowRange > 15 ? "#fecaca" : "#fde68a"}`,
                  fontSize: "var(--text-sm)", color: belowRange > 15 ? "#dc2626" : "#d97706",
                }}>
                  ⚠️ {belowRange}% time below range — {belowRange > 15 ? "significant hypoglycemia; evaluate meal timing and carbohydrate intake" : "mild hypoglycemia; monitor patterns"}
                </div>
              )}
            </div>
          </section>
        );
      })()}

      {/* C3. Bloodwork Panel Card */}
      {metrics.some((m) => m.category === "bloodwork" && m.latestValue != null) && (() => {
        const bm = (key: string) => metrics.find((m) => m.metricKey === key);
        const lipidKeys = ["total_cholesterol", "hdl", "ldl", "triglycerides", "apob", "remnant_cholesterol", "tc_hdl_ratio", "tg_hdl_ratio", "ldl_apob_ratio"];
        const hormoneKeys = ["total_testosterone", "free_testosterone", "estrogen", "shbg", "tsh", "free_t3"];
        const generalKeys = ["crp", "creatinine", "albumin", "ferritin", "vitamin_d"];

        const renderGroup = (title: string, keys: string[]) => {
          const items = keys.map((k) => bm(k)).filter((m): m is MetricStatus => m != null && m.latestValue != null);
          if (items.length === 0) return null;
          return (
            <div key={title}>
              <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--c-ink-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "var(--sp-1)" }}>{title}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)" }}>
                {items.map((m) => (
                  <div key={m.metricKey} style={{
                    display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)",
                    padding: "4px 10px", borderRadius: 6,
                    background: m.rangeStatus === "critical" ? "#fef2f2" : m.rangeStatus === "warning" ? "#fffbeb" : "var(--c-surface-raised, #f8f9fa)",
                  }}>
                    <span style={{
                      width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                      background: statusColor(m.rangeStatus),
                    }} />
                    <span style={{ fontWeight: 500 }}>{m.label}</span>
                    <span style={{ fontWeight: 700 }}>{m.latestValue}{m.latestUnit ? ` ${m.latestUnit}` : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        };

        return (
          <section className="section">
            <h2 className="section-title">🩸 Bloodwork Panel</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
              {renderGroup("Lipid Panel", lipidKeys)}
              {renderGroup("Hormones", hormoneKeys)}
              {renderGroup("General / Inflammation", generalKeys)}
            </div>
          </section>
        );
      })()}

      {/* C4. DEXA Summary Card */}
      {metrics.some((m) => ["body_fat_pct", "lean_mass_kg", "bmd_total"].includes(m.metricKey) && m.latestValue != null) && (() => {
        const dm = (key: string) => metrics.find((m) => m.metricKey === key)?.latestValue ?? null;
        const bodyFat = dm("body_fat_pct");
        const leanMass = dm("lean_mass_kg");
        const fatMass = dm("fat_mass_kg");
        const bmd = dm("bmd_total");
        const agRatio = dm("ag_ratio");
        const androidFat = dm("android_fat_pct");
        const gynoidFat = dm("gynoid_fat_pct");
        const bmiVal = dm("bmi");
        const bmiCtx = bmiVal != null ? bmiContextLabel(bmiVal, bodyFat) : null;

        return (
          <section className="section">
            <h2 className="section-title">🦴 DEXA Body Composition</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
              {/* Body composition bar */}
              {bodyFat != null && leanMass != null && (
                <div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)", marginBottom: 4, fontWeight: 600 }}>Composition Breakdown</div>
                  <div style={{ display: "flex", height: 28, borderRadius: 6, overflow: "hidden", border: "1px solid var(--c-border, #e5e7eb)" }}>
                    {fatMass != null && leanMass != null && (() => {
                      const totalMass = (fatMass ?? 0) + leanMass;
                      const fatPct = totalMass > 0 ? ((fatMass ?? 0) / totalMass) * 100 : 0;
                      const leanPct = totalMass > 0 ? (leanMass / totalMass) * 100 : 0;
                      return (
                        <>
                          <div style={{ width: `${leanPct}%`, background: "#34d399", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700 }}>
                            Lean {leanMass}kg
                          </div>
                          <div style={{ width: `${fatPct}%`, background: "#f59e0b", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700 }}>
                            Fat {fatMass}kg
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}
              {/* KPIs */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "var(--sp-2)" }}>
                {bodyFat != null && <div className="kpi"><div className="kpi-value">{bodyFat}%</div><div className="kpi-label">Body Fat</div></div>}
                {leanMass != null && <div className="kpi"><div className="kpi-value">{leanMass}kg</div><div className="kpi-label">Lean Mass</div></div>}
                {bmiVal != null && (
                  <div className="kpi">
                    <div className="kpi-value">{bmiVal}</div>
                    <div className="kpi-label">BMI{bmiCtx ? ` (${bmiCtx})` : ""}</div>
                  </div>
                )}
                {bmd != null && <div className="kpi"><div className="kpi-value">{bmd}</div><div className="kpi-label">BMD (g/cm²)</div></div>}
              </div>
              {/* Regional breakdown */}
              {(androidFat != null || gynoidFat != null || agRatio != null) && (
                <div style={{ fontSize: "var(--text-sm)", display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
                  {androidFat != null && <span>Android (trunk): <strong>{androidFat}%</strong></span>}
                  {gynoidFat != null && <span>Gynoid (hip): <strong>{gynoidFat}%</strong></span>}
                  {agRatio != null && <span>A/G Ratio: <strong>{agRatio}</strong>{agRatio < 0.8 ? " ✓ favorable" : agRatio > 1.0 ? " ⚠️ elevated" : ""}</span>}
                </div>
              )}
            </div>
          </section>
        );
      })()}

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

      {/* E. TDEE & Energy Balance */}
      {clientProfile && (clientProfile.heightCm || weightTrend?.latestValue) && (
        <section className="section">
          <h2 className="section-title">Energy Balance</h2>
          {(() => {
            const w = weightTrend?.latestValue ?? clientProfile.weightKg ?? 0;
            const h = clientProfile.heightCm ?? 0;
            const dobStr = clientProfile.dateOfBirth;
            const sex = (clientProfile.sex as "male" | "female") ?? "male";
            const ageYears = dobStr ? computeAge(new Date(dobStr)) : 30;

            if (w <= 0 || h <= 0) {
              return <div style={{ color: "var(--c-ink-muted)", fontSize: "var(--text-sm)" }}>Enter weight and height to estimate TDEE.</div>;
            }

            const activityLevel = (tdeeActivityLevel as ActivityLevel) ?? "moderate";
            const { bmr, tdee } = computeTDEE({ weightKg: w, heightCm: h, ageYears, sex }, activityLevel);
            const avgKcal = weekly?.summary.avgKcal ?? nutritionHistory?.summary.avgKcal ?? 0;
            const { balance, status: balanceStatus } = computeCaloricBalance(tdee, avgKcal);
            const goal = (tdeeGoal as GoalType) ?? "maintain";
            const { kcal: recKcal, proteinG: recProtein, carbG: recCarb, fatG: recFat } = recommendMacroTargets({ tdee, goal, weightKg: w });

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "var(--sp-3)" }}>
                  <div className="kpi"><div className="kpi-value">{bmr}</div><div className="kpi-label">BMR (kcal)</div></div>
                  <div className="kpi">
                    <div className="kpi-value">{tdee}</div>
                    <div className="kpi-label">TDEE (kcal)</div>
                  </div>
                  <div className="kpi">
                    <div className="kpi-value" style={{ color: balanceStatus === "surplus" ? "var(--c-danger, #ef4444)" : balanceStatus === "deficit" ? "var(--c-warning, #f59e0b)" : "var(--c-success, #22c55e)" }}>
                      {balance > 0 ? "+" : ""}{balance}
                    </div>
                    <div className="kpi-label">{balanceStatus}</div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center", flexWrap: "wrap" }}>
                  <label style={{ fontSize: "var(--text-xs)", fontWeight: 600 }}>Activity:</label>
                  <select className="input" value={tdeeActivityLevel} onChange={(e) => setTdeeActivityLevel(e.target.value)} style={{ fontSize: "var(--text-xs)", width: "auto" }}>
                    {Object.entries(ACTIVITY_MULTIPLIERS).map(([k, v]) => (
                      <option key={k} value={k}>{k.replace(/_/g, " ")} (×{v})</option>
                    ))}
                  </select>
                  <label style={{ fontSize: "var(--text-xs)", fontWeight: 600, marginLeft: "var(--sp-2)" }}>Goal:</label>
                  <select className="input" value={tdeeGoal} onChange={(e) => setTdeeGoal(e.target.value)} style={{ fontSize: "var(--text-xs)", width: "auto" }}>
                    <option value="cut">Cut (−500)</option>
                    <option value="maintain">Maintain</option>
                    <option value="bulk">Bulk (+300)</option>
                  </select>
                </div>

                <div style={{ padding: "var(--sp-3)", background: "var(--c-surface-raised, #f8f9fa)", borderRadius: "var(--r-md, 8px)", fontSize: "var(--text-sm)" }}>
                  <div style={{ fontWeight: 700, marginBottom: "var(--sp-1)" }}>Recommended Targets ({tdeeGoal})</div>
                  <div style={{ display: "flex", gap: "var(--sp-4)", flexWrap: "wrap" }}>
                    <span><strong>{recKcal}</strong> kcal</span>
                    <span><strong>{recProtein}g</strong> protein</span>
                    <span><strong>{recCarb}g</strong> carbs</span>
                    <span><strong>{recFat}g</strong> fat</span>
                  </div>
                  {clientId && (
                    <button
                      className="btn btn-outline btn-sm"
                      style={{ marginTop: "var(--sp-2)" }}
                      onClick={async () => {
                        const api = resolveApiBase();
                        await fetch(`${api}/v1/clients/${clientId}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ targetKcal: recKcal, targetProteinG: recProtein, targetCarbG: recCarb, targetFatG: recFat }),
                        });
                        fetchData();
                      }}
                    >
                      Apply as Targets
                    </button>
                  )}
                </div>
              </div>
            );
          })()}
        </section>
      )}

      {/* F. Nutrition History (30/60/90 Day) */}
      <section className="section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--sp-3)" }}>
          <h2 className="section-title" style={{ margin: 0 }}>Nutrition History</h2>
          <div style={{ display: "flex", gap: "var(--sp-1)" }}>
            {[7, 30, 60, 90].map((d) => (
              <button
                key={d}
                className={`btn btn-sm ${historyPeriod === d ? "btn-primary" : "btn-outline"}`}
                onClick={() => setHistoryPeriod(d)}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        {nutritionHistory && nutritionHistory.weeks.length > 0 ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "var(--sp-2)", marginBottom: "var(--sp-3)" }}>
              <div className="kpi"><div className="kpi-value">{nutritionHistory.summary.avgKcal}</div><div className="kpi-label">Avg kcal/day</div></div>
              <div className="kpi"><div className="kpi-value">{nutritionHistory.summary.avgProteinG}g</div><div className="kpi-label">Avg protein</div></div>
              <div className="kpi"><div className="kpi-value">{nutritionHistory.summary.avgCarbG}g</div><div className="kpi-label">Avg carbs</div></div>
              <div className="kpi"><div className="kpi-value">{nutritionHistory.summary.avgFatG}g</div><div className="kpi-label">Avg fat</div></div>
              <div className="kpi"><div className="kpi-value">{nutritionHistory.summary.compliancePct}%</div><div className="kpi-label">Compliance</div></div>
            </div>
            {/* Weekly bars */}
            <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 100, padding: "var(--sp-2) 0" }}>
              {nutritionHistory.weeks.map((w) => {
                const maxKcal = Math.max(...nutritionHistory.weeks.map((wk) => wk.avgKcal), 1);
                const hPct = (w.avgKcal / maxKcal) * 100;
                return (
                  <div key={w.weekStart} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                    <div style={{ fontSize: 9, color: "var(--c-ink-muted)" }}>{w.avgKcal}</div>
                    <div style={{
                      width: "100%", maxWidth: 40, height: `${hPct}%`, minHeight: 4,
                      background: "var(--c-primary, #4f46e5)", borderRadius: "var(--r-sm, 4px) var(--r-sm, 4px) 0 0",
                    }} />
                    <div style={{ fontSize: 8, color: "var(--c-ink-muted)" }}>{w.weekStart.slice(5)}</div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div style={{ color: "var(--c-ink-muted)", fontSize: "var(--text-sm)" }}>No nutrition history for this period.</div>
        )}
      </section>

      {/* G. Intake vs Physiology Correlation */}
      {nutritionHistory && nutritionHistory.weeks.length >= 2 && bioSnapshots.length >= 2 && (() => {
        const bioForChart = bioSnapshots
          .filter((s) => s.weightKg != null || s.bodyFatPct != null)
          .map((s) => ({ date: s.measuredAt.slice(0, 10), weightKg: s.weightKg, bodyFatPct: s.bodyFatPct }));
        if (bioForChart.length < 2) return null;

        return (
          <section className="section">
            <h2 className="section-title">Intake vs Physiology</h2>
            <DualLineChart
              series1={nutritionHistory.weeks.map((w) => ({ date: w.weekStart, value: w.avgKcal }))}
              series2={bioForChart.map((p) => ({ date: p.date, value: p.weightKg }))}
              label1="Avg Weekly kcal"
              label2="Weight (kg)"
              color1="#6366f1"
              color2="#ef4444"
              unit1=""
              unit2="kg"
              height={200}
            />
          </section>
        );
      })()}

      {/* G2. Adaptation Timeline */}
      {nutritionHistory && nutritionHistory.weeks.length >= 5 && bioSnapshots.length >= 2 && (() => {
        // Detect nutrition shifts (>10% change from 4-week rolling average)
        const weeks = nutritionHistory.weeks;
        const shifts: { weekStart: string; shiftType: string; magnitude: number; description: string }[] = [];
        for (let i = 4; i < weeks.length; i++) {
          const prev4 = weeks.slice(i - 4, i);
          const current = weeks[i]!;
          const avgKcalPrev = prev4.reduce((s, w) => s + w.avgKcal, 0) / 4;
          const avgProteinPrev = prev4.reduce((s, w) => s + w.avgProteinG, 0) / 4;

          if (avgKcalPrev > 0) {
            const kcalPct = ((current.avgKcal - avgKcalPrev) / avgKcalPrev) * 100;
            if (Math.abs(kcalPct) > 10) {
              shifts.push({
                weekStart: current.weekStart,
                shiftType: kcalPct > 0 ? "kcal_increase" : "kcal_decrease",
                magnitude: Math.round(Math.abs(kcalPct)),
                description: `${kcalPct > 0 ? "+" : ""}${Math.round(kcalPct)}% caloric ${kcalPct > 0 ? "increase" : "decrease"} (${Math.round(avgKcalPrev)} → ${current.avgKcal} kcal)`,
              });
            }
          }

          if (avgProteinPrev > 0) {
            const protPct = ((current.avgProteinG - avgProteinPrev) / avgProteinPrev) * 100;
            if (Math.abs(protPct) > 15) {
              shifts.push({
                weekStart: current.weekStart,
                shiftType: protPct > 0 ? "protein_increase" : "protein_decrease",
                magnitude: Math.round(Math.abs(protPct)),
                description: `${protPct > 0 ? "+" : ""}${Math.round(protPct)}% protein ${protPct > 0 ? "increase" : "decrease"} (${Math.round(avgProteinPrev)} → ${current.avgProteinG}g)`,
              });
            }
          }
        }

        // Detect physiology responses 2-6 weeks after shifts
        const sortedBio = [...bioSnapshots]
          .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))
          .map((s) => ({ date: s.measuredAt.slice(0, 10), weightKg: s.weightKg, bodyFatPct: s.bodyFatPct }));

        const responses: { shiftDate: string; responseDate: string; lagWeeks: number; metric: string; direction: "improved" | "worsened" | "unchanged"; magnitude: number; description: string }[] = [];

        for (const shift of shifts) {
          const before = sortedBio.filter((p) => p.date <= shift.weekStart).pop();
          const shiftTime = new Date(shift.weekStart + "T12:00:00Z").getTime();
          const twoWeeks = shiftTime + 14 * 86400000;
          const sixWeeks = shiftTime + 42 * 86400000;
          const after = sortedBio.filter((p) => {
            const t = new Date(p.date + "T12:00:00Z").getTime();
            return t >= twoWeeks && t <= sixWeeks;
          });

          if (before && after.length > 0) {
            const resp = after[after.length - 1]!;
            const lagMs = new Date(resp.date + "T12:00:00Z").getTime() - shiftTime;
            const lagWeeks = Math.round(lagMs / (7 * 86400000));

            if (before.weightKg != null && resp.weightKg != null) {
              const delta = resp.weightKg - before.weightKg;
              if (Math.abs(delta) >= 0.5) {
                responses.push({
                  shiftDate: shift.weekStart, responseDate: resp.date, lagWeeks,
                  metric: "weight", direction: delta < 0 ? "improved" : "worsened",
                  magnitude: Math.round(Math.abs(delta) * 10) / 10,
                  description: `Weight ${delta < 0 ? "decreased" : "increased"} by ${Math.abs(delta).toFixed(1)}kg`,
                });
              }
            }

            if (before.bodyFatPct != null && resp.bodyFatPct != null) {
              const delta = resp.bodyFatPct - before.bodyFatPct;
              if (Math.abs(delta) >= 0.5) {
                responses.push({
                  shiftDate: shift.weekStart, responseDate: resp.date, lagWeeks,
                  metric: "body_fat", direction: delta < 0 ? "improved" : "worsened",
                  magnitude: Math.round(Math.abs(delta) * 10) / 10,
                  description: `Body fat ${delta < 0 ? "decreased" : "increased"} by ${Math.abs(delta).toFixed(1)}%`,
                });
              }
            }
          }
        }

        return (
          <section className="section">
            <h2 className="section-title">Adaptation Timeline</h2>
            <AdaptationTimeline shifts={shifts} responses={responses} />
          </section>
        );
      })()}

      {/* H. Data Readiness Score */}
      {!loading && (() => {
        // Compute data completeness client-side
        const bioFields = ["heightCm", "weightKg", "bodyFatPct", "leanMassKg", "restingHr"] as const;
        const lastSnap = bioSnapshots.length > 0 ? bioSnapshots[bioSnapshots.length - 1] : null;
        const fieldsCovered = lastSnap ? bioFields.filter((f) => lastSnap[f] != null).length : 0;
        const staleMetrics = metrics.filter((m) => m.staleDays != null && m.staleDays > 90).length;
        const commonKeys = ["fasting_glucose", "hba1c", "ldl", "hdl", "triglycerides", "body_fat_pct", "lean_mass_kg", "resting_hr"];
        const missingCommon = commonKeys.filter((k) => !metrics.some((m) => m.metricKey === k && m.latestValue != null)).length;
        const docsByType: Record<string, number> = {};
        for (const d of documents) { docsByType[d.documentType] = (docsByType[d.documentType] ?? 0) + 1; }

        // Scoring
        let bioDepth = 0;
        if (bioSnapshots.length >= 6) bioDepth = 25;
        else if (bioSnapshots.length >= 3) bioDepth = 18;
        else if (bioSnapshots.length >= 1) bioDepth = 10;

        const daysSinceLast = bioSummary?.dataQuality.daysSinceLastSnapshot ?? null;
        let bioRecency = 0;
        if (daysSinceLast !== null) {
          if (daysSinceLast <= 7) bioRecency = 10;
          else if (daysSinceLast <= 30) bioRecency = 7;
          else if (daysSinceLast <= 90) bioRecency = 3;
        }

        const metricCov = Math.round(((8 - missingCommon) / 8) * 20);
        const metricFresh = metrics.length > 0 ? Math.round(((metrics.length - staleMetrics) / metrics.length) * 10) : 0;
        const nutDays = nutritionHistory?.summary.daysWithData ?? (weekly?.summary.daysWithData ?? 0);
        const nutWindow = nutritionHistory?.summary.periodDays ?? 90;
        const nutScore = Math.min(Math.round((nutDays / nutWindow) * 25), 25);

        let docScore = 0;
        if ((docsByType["DEXA"] ?? 0) >= 1) docScore += 3;
        if ((docsByType["BLOODWORK"] ?? 0) >= 1) docScore += 4;
        if ((docsByType["CGM"] ?? 0) >= 1) docScore += 3;

        const totalScore = bioDepth + bioRecency + metricCov + metricFresh + nutScore + docScore;
        const category = totalScore >= 80 ? "Excellent" : totalScore >= 55 ? "Good" : totalScore >= 30 ? "Minimal" : "Insufficient";
        const catColor = totalScore >= 80 ? "#22c55e" : totalScore >= 55 ? "#3b82f6" : totalScore >= 30 ? "#f59e0b" : "#ef4444";

        return (
          <section className="section">
            <h2 className="section-title">Data Readiness</h2>
            <div style={{ display: "flex", gap: "var(--sp-4)", alignItems: "center", flexWrap: "wrap" }}>
              {/* Circular gauge */}
              <div style={{
                width: 100, height: 100, borderRadius: "50%", position: "relative",
                background: `conic-gradient(${catColor} ${totalScore * 3.6}deg, var(--c-border, #e5e7eb) ${totalScore * 3.6}deg)`,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <div style={{
                  width: 76, height: 76, borderRadius: "50%",
                  background: "var(--c-surface, #fff)", display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: catColor }}>{totalScore}</div>
                  <div style={{ fontSize: 9, color: "var(--c-ink-muted)", fontWeight: 600 }}>{category}</div>
                </div>
              </div>

              {/* Breakdown bars */}
              <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 6 }}>
                {([
                  { label: "Biometric Depth", score: bioDepth, max: 25 },
                  { label: "Biometric Recency", score: bioRecency, max: 10 },
                  { label: "Metric Coverage", score: metricCov, max: 20 },
                  { label: "Metric Freshness", score: metricFresh, max: 10 },
                  { label: "Nutrition History", score: nutScore, max: 25 },
                  { label: "Document Evidence", score: docScore, max: 10 },
                ] as const).map((row) => (
                  <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 120, fontSize: 10, color: "var(--c-ink-muted)", textAlign: "right" }}>{row.label}</div>
                    <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--c-border, #e5e7eb)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${(row.score / row.max) * 100}%`, background: catColor, borderRadius: 3, transition: "width 0.3s" }} />
                    </div>
                    <div style={{ width: 35, fontSize: 10, fontWeight: 600 }}>{row.score}/{row.max}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Export button */}
            {clientId && (
              <div style={{ marginTop: "var(--sp-3)", display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
                <a
                  href={`${resolveApiBase()}/v1/clients/${clientId}/training-export`}
                  className={`btn btn-outline btn-sm ${totalScore < 30 ? "btn-disabled" : ""}`}
                  style={totalScore < 30 ? { pointerEvents: "none", opacity: 0.5 } : {}}
                  download
                >
                  Export Training Data
                </a>
                {clientId && (
                  <Link href={`/clients/${clientId}/progress-report` as any} className="btn btn-outline btn-sm">
                    View Progress Report
                  </Link>
                )}
                {totalScore < 30 && (
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)" }}>Need score ≥ 30 to export</span>
                )}
              </div>
            )}
          </section>
        );
      })()}

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
