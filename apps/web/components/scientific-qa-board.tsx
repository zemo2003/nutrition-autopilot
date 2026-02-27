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

type QualitySummary = {
  month: string;
  coverage: {
    productFull40CoverageRatio: number;
    finalLabelFull40CoverageRatio: number;
  };
  evidence: {
    verifiedRows: number;
    inferredRows: number;
    exceptionRows: number;
    floorRows: number;
    provisionalLabels: number;
    totalLabelsServed: number;
  };
  syntheticUsage: {
    syntheticLots: number;
    totalLots: number;
    syntheticLotRatio: number;
  };
  totals: {
    openVerificationTasks: number;
    criticalOrHighVerificationTasks: number;
  };
};

type StaleLabel = {
  labelId: string;
  title: string;
  frozenAt: string;
  staleNutrients: number;
};

type VerificationTask = {
  id: string;
  taskType: string;
  severity: string;
  status: string;
  title: string;
  description: string;
  payload: {
    productId?: string;
    nutrientKeys?: string[];
    confidence?: number;
    sourceType?: string;
    historicalException?: boolean;
  };
};

function SeverityBadge({ severity }: { severity: string }) {
  const cls = severity === "CRITICAL" ? "badge-danger" : severity === "HIGH" ? "badge-warn" : severity === "MEDIUM" ? "badge-info" : "badge-neutral";
  return <span className={`badge ${cls}`}>{severity}</span>;
}

function CoverageRing({ ratio, label }: { ratio: number; label: string }) {
  const pct = Math.round(ratio * 100);
  const color = pct >= 90 ? "var(--c-success)" : pct >= 70 ? "var(--c-warn)" : "var(--c-danger)";
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{
        width: 80, height: 80, borderRadius: "50%",
        border: `4px solid ${color}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "var(--text-lg)", fontWeight: "var(--weight-bold)",
        color, margin: "0 auto",
      }}>
        {pct}%
      </div>
      <div className="text-muted" style={{ fontSize: "var(--text-xs)", marginTop: "var(--sp-1)" }}>{label}</div>
    </div>
  );
}

export function ScientificQABoard() {
  const [quality, setQuality] = useState<QualitySummary | null>(null);
  const [staleLabels, setStaleLabels] = useState<StaleLabel[]>([]);
  const [tasks, setTasks] = useState<VerificationTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const apiBase = resolveApiBase();

  const fetchData = useCallback(async () => {
    setFetchError(null);
    const month = new Date().toISOString().slice(0, 7);
    try {
      const [qualityRes, staleRes, tasksRes] = await Promise.all([
        fetch(`${apiBase}/v1/quality/summary?month=${month}`),
        fetch(`${apiBase}/v1/labels/stale?month=${month}`),
        fetch(`${apiBase}/v1/verification/tasks?status=OPEN&severity=CRITICAL,HIGH`),
      ]);
      if (qualityRes.ok) setQuality(await qualityRes.json());
      if (staleRes.ok) {
        const staleData = await staleRes.json();
        setStaleLabels(staleData.staleLabels ?? []);
      }
      if (tasksRes.ok) {
        const taskData = await tasksRes.json();
        setTasks(taskData.tasks ?? []);
      }
      if (!qualityRes.ok && !staleRes.ok && !tasksRes.ok) {
        setFetchError("Failed to load QA data — check that the API is running.");
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Network error loading QA data");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return <div className="loading-shimmer" style={{ height: 300, borderRadius: 12 }} />;
  }

  if (fetchError) {
    return (
      <div className="card" style={{ padding: "var(--sp-4)" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--sp-3)",
            padding: "var(--sp-3) var(--sp-4)",
            background: "var(--c-danger-soft)",
            color: "var(--c-danger)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: "var(--r-md)",
            fontSize: "var(--text-sm)",
          }}
        >
          <span>{fetchError}</span>
          <button
            className="btn btn-sm"
            style={{ background: "var(--c-danger)", color: "#fff" }}
            onClick={() => { setLoading(true); fetchData(); }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: "var(--sp-6)" }}>
      {/* Coverage Overview */}
      {quality && (
        <div className="card" style={{ padding: "var(--sp-4)" }}>
          <h3 style={{ marginBottom: "var(--sp-4)" }}>Nutrient Coverage ({quality.month})</h3>
          <div style={{ display: "flex", justifyContent: "space-around", flexWrap: "wrap", gap: "var(--sp-4)" }}>
            <CoverageRing ratio={quality.coverage.productFull40CoverageRatio} label="Product Coverage" />
            <CoverageRing ratio={quality.coverage.finalLabelFull40CoverageRatio} label="Label Coverage" />
          </div>
        </div>
      )}

      {/* Evidence Breakdown */}
      {quality && (
        <div className="card" style={{ padding: "var(--sp-4)" }}>
          <h3 style={{ marginBottom: "var(--sp-3)" }}>Evidence Quality</h3>
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
            <div className="kpi">
              <div className="kpi-value" style={{ color: "var(--c-success)" }}>{quality.evidence.verifiedRows}</div>
              <div className="kpi-label">Verified</div>
            </div>
            <div className="kpi">
              <div className="kpi-value" style={{ color: "var(--c-warn)" }}>{quality.evidence.inferredRows}</div>
              <div className="kpi-label">Inferred</div>
            </div>
            <div className="kpi">
              <div className="kpi-value" style={{ color: "var(--c-danger)" }}>{quality.evidence.exceptionRows}</div>
              <div className="kpi-label">Exceptions</div>
            </div>
            <div className="kpi">
              <div className="kpi-value">{quality.evidence.provisionalLabels}</div>
              <div className="kpi-label">Provisional Labels</div>
            </div>
          </div>

          {/* Synthetic usage warning */}
          {quality.syntheticUsage.syntheticLotRatio > 0.1 && (
            <div style={{
              marginTop: "var(--sp-3)", padding: "var(--sp-3)",
              background: "var(--c-warn-soft)", borderRadius: "var(--r-md)",
              color: "var(--c-warn)", fontSize: "var(--text-sm)",
            }}>
              <strong>Synthetic Lot Warning:</strong> {Math.round(quality.syntheticUsage.syntheticLotRatio * 100)}%
              of lots are synthetic ({quality.syntheticUsage.syntheticLots}/{quality.syntheticUsage.totalLots}).
              These were created for historical backfill and may not reflect actual inventory.
            </div>
          )}
        </div>
      )}

      {/* Stale Labels */}
      {staleLabels.length > 0 && (
        <div className="card" style={{ padding: "var(--sp-4)" }}>
          <h3 style={{ marginBottom: "var(--sp-3)", display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
            Stale Labels
            <span className="badge badge-warn">{staleLabels.length}</span>
          </h3>
          <p className="text-muted" style={{ fontSize: "var(--text-sm)", marginBottom: "var(--sp-3)" }}>
            These labels were frozen before their nutrient data was updated. They may show outdated values.
          </p>
          <div className="stack-tight">
            {staleLabels.slice(0, 10).map((label) => (
              <div key={label.labelId} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "var(--sp-2)", fontSize: "var(--text-sm)",
              }}>
                <div>
                  <span style={{ fontWeight: "var(--weight-medium)" }}>{label.title}</span>
                  <span className="text-muted" style={{ marginLeft: "var(--sp-2)" }}>
                    {label.staleNutrients} stale nutrients
                  </span>
                </div>
                <span className="text-muted" style={{ fontSize: "var(--text-xs)" }}>
                  Frozen {new Date(label.frozenAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Critical Verification Tasks */}
      <div className="card" style={{ padding: "var(--sp-4)" }}>
        <h3 style={{ marginBottom: "var(--sp-3)", display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          Scientific Review Queue
          {tasks.length > 0 && <span className="badge badge-danger">{tasks.length}</span>}
        </h3>

        {tasks.length > 0 ? (
          <div className="stack-tight">
            {tasks.map((task) => (
              <div key={task.id} className="card" style={{ padding: "var(--sp-3)", background: "var(--c-surface-alt)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--sp-2)" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: 4 }}>
                      <SeverityBadge severity={task.severity} />
                      <span style={{ fontWeight: "var(--weight-medium)", fontSize: "var(--text-sm)" }}>{task.title}</span>
                    </div>
                    <div className="text-muted" style={{ fontSize: "var(--text-xs)" }}>{task.description}</div>
                    {task.payload.nutrientKeys && task.payload.nutrientKeys.length > 0 && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: "var(--sp-2)" }}>
                        {task.payload.nutrientKeys.slice(0, 8).map((key) => (
                          <span key={key} className="badge badge-neutral" style={{ fontSize: "var(--text-xs)" }}>{key}</span>
                        ))}
                        {task.payload.nutrientKeys.length > 8 && (
                          <span className="text-muted" style={{ fontSize: "var(--text-xs)" }}>+{task.payload.nutrientKeys.length - 8} more</span>
                        )}
                      </div>
                    )}
                    {task.payload.confidence !== undefined && (
                      <div className="text-muted" style={{ fontSize: "var(--text-xs)", marginTop: 4 }}>
                        Confidence: {(task.payload.confidence * 100).toFixed(0)}%
                        {task.payload.historicalException && " · Historical Exception"}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-muted" style={{ fontSize: "var(--text-sm)" }}>
            No critical or high-severity tasks pending review.
          </div>
        )}

        <div style={{ marginTop: "var(--sp-3)" }}>
          <a href="/verification" className="btn btn-outline btn-sm">View All Verification Tasks</a>
        </div>
      </div>

      {/* Scientific Assumptions */}
      <div className="card" style={{ padding: "var(--sp-4)" }}>
        <h3 style={{ marginBottom: "var(--sp-3)" }}>Known Limitations</h3>
        <div className="stack-tight" style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-soft)" }}>
          <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "flex-start" }}>
            <span style={{ color: "var(--c-warn)", flexShrink: 0 }}>!</span>
            <span>Enrichment confidence scores are not weighted in label computation — all non-rejected values treated equally.</span>
          </div>
          <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "flex-start" }}>
            <span style={{ color: "var(--c-warn)", flexShrink: 0 }}>!</span>
            <span>Inferred nutrients (from similar products) may not reflect actual product composition.</span>
          </div>
          <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "flex-start" }}>
            <span style={{ color: "var(--c-warn)", flexShrink: 0 }}>!</span>
            <span>Yield factors are generic estimates. Actual cooking yields vary with method, temperature, and duration.</span>
          </div>
          <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "flex-start" }}>
            <span style={{ color: "var(--c-info)", flexShrink: 0 }}>i</span>
            <span>FDA rounding rules are applied at the final label level to prevent accumulated rounding errors.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
