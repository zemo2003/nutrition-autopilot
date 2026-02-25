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

type QcIssue = {
  id: string;
  batchProductionId: string;
  issueType: string;
  description: string;
  expectedValue: string | null;
  actualValue: string | null;
  overrideAllowed: boolean;
  overrideReason: string | null;
  overrideBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  batchProduction: { id: string; batchCode: string | null; status: string };
};

/* ── Component ────────────────────────────────────────────── */

export default function QcBoard() {
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const [issues, setIssues] = useState<QcIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrideId, setOverrideId] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  const API = resolveApiBase();

  const loadIssues = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filter === "open") params.set("resolved", "false");
      if (filter === "resolved") params.set("resolved", "true");
      const res = await fetch(`${API}/v1/qc-issues?${params}`);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const json = await res.json();
      setIssues(json.issues ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [API, filter]);

  useEffect(() => { loadIssues(); }, [loadIssues]);

  async function overrideIssue() {
    if (!overrideId || !overrideReason.trim()) return;
    try {
      const res = await fetch(`${API}/v1/qc-issues/${overrideId}/override`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrideReason: overrideReason.trim() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Override failed: ${res.status}`);
      }
      setOverrideId(null);
      setOverrideReason("");
      loadIssues();
    } catch (e: any) {
      setError(e.message);
    }
  }

  function issueTypeBadge(type: string) {
    const colors: Record<string, string> = {
      TEMP_MISS: "badge-danger",
      CHILL_TIME_EXCEEDED: "badge-danger",
      MISSING_CHECKPOINT: "badge-warn",
      LATE_CHECKPOINT: "badge-warn",
      MANUAL_OVERRIDE: "badge-info",
      YIELD_VARIANCE_HIGH: "badge-warn",
      YIELD_VARIANCE_CRITICAL: "badge-danger",
    };
    const label = type.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    return <span className={`badge ${colors[type] ?? "badge-info"}`}>{label}</span>;
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="row" style={{ gap: "var(--sp-2)", marginBottom: "var(--sp-4)" }}>
        {(["open", "resolved", "all"] as const).map((f) => (
          <button
            key={f}
            className={`btn ${filter === f ? "btn-primary" : "btn-outline"} btn-sm`}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f === "open" && issues.length > 0 && filter === "open" && (
              <span style={{ marginLeft: "var(--sp-1)", fontSize: "0.75rem" }}>({issues.length})</span>
            )}
          </button>
        ))}
      </div>

      {error && <div className="card" style={{ borderColor: "var(--c-danger)", padding: "var(--sp-3)" }}>{error}</div>}
      {loading && <div style={{ color: "var(--c-ink-soft)" }}>Loading...</div>}

      {!loading && (
        <div className="card" style={{ overflowX: "auto" }}>
          {issues.length === 0 ? (
            <div style={{ padding: "var(--sp-4)", color: "var(--c-ink-soft)", textAlign: "center" }}>
              {filter === "open" ? "No open QC issues." : filter === "resolved" ? "No resolved QC issues." : "No QC issues recorded."}
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Issue Type</th>
                  <th>Description</th>
                  <th>Expected</th>
                  <th>Actual</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue) => (
                  <tr key={issue.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{issue.batchProduction.batchCode ?? issue.batchProductionId.slice(0, 8)}</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--c-ink-soft)" }}>{issue.batchProduction.status}</div>
                    </td>
                    <td>{issueTypeBadge(issue.issueType)}</td>
                    <td style={{ maxWidth: 300 }}>{issue.description}</td>
                    <td>{issue.expectedValue ?? "—"}</td>
                    <td>{issue.actualValue ?? "—"}</td>
                    <td>
                      {issue.resolvedAt ? (
                        <div>
                          <span className="badge badge-success">Resolved</span>
                          {issue.overrideReason && (
                            <div style={{ fontSize: "0.7rem", color: "var(--c-ink-soft)", marginTop: "2px" }}>
                              Override: {issue.overrideReason}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="badge badge-warn">Open</span>
                      )}
                    </td>
                    <td>
                      {!issue.resolvedAt && issue.overrideAllowed && (
                        <>
                          {overrideId === issue.id ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
                              <input
                                type="text"
                                placeholder="Override reason..."
                                value={overrideReason}
                                onChange={(e) => setOverrideReason(e.target.value)}
                                style={{
                                  padding: "4px 8px",
                                  border: "1px solid var(--c-border)",
                                  borderRadius: 4,
                                  background: "var(--c-surface)",
                                  color: "var(--c-ink)",
                                  fontSize: "0.8rem",
                                }}
                              />
                              <div className="row" style={{ gap: "var(--sp-1)" }}>
                                <button
                                  className="btn btn-primary btn-sm"
                                  onClick={overrideIssue}
                                  disabled={!overrideReason.trim()}
                                >
                                  Confirm
                                </button>
                                <button className="btn btn-outline btn-sm" onClick={() => { setOverrideId(null); setOverrideReason(""); }}>
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button className="btn btn-outline btn-sm" onClick={() => setOverrideId(issue.id)}>
                              Override
                            </button>
                          )}
                        </>
                      )}
                    </td>
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
