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

type DemandItem = {
  componentId: string;
  componentName: string;
  componentType: string;
  totalCookedG: number;
  rawG: number;
  yieldFactor: number;
  yieldBasis: string;
  mealCount: number;
  inventoryOnHandG: number;
  shortageG: number;
  sufficient: boolean;
};

type BatchSuggestion = {
  componentId: string;
  componentName: string;
  componentType: string;
  rawG: number;
  cookedG: number;
  yieldFactor: number;
  mealCount: number;
  priority: string;
  isShortage: boolean;
  sharingOpportunity: boolean;
};

type PrepDraft = {
  id?: string;
  weekStart: string;
  weekEnd: string;
  demand: DemandItem[];
  batchSuggestions: BatchSuggestion[];
  shortages: DemandItem[];
  totalMeals: number;
  totalComponents: number;
};

type SavedDraft = {
  id: string;
  weekStart: string;
  weekEnd: string;
  status: string;
  createdAt: string;
};

export default function PrepBoard() {
  const [tab, setTab] = useState<"generate" | "history">("generate");
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    d.setDate(d.getDate() - day + 1); // Monday
    return d.toISOString().slice(0, 10);
  });
  const [weekEnd, setWeekEnd] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    d.setDate(d.getDate() - day + 7); // Sunday
    return d.toISOString().slice(0, 10);
  });
  const [draft, setDraft] = useState<PrepDraft | null>(null);
  const [savedDrafts, setSavedDrafts] = useState<SavedDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const API = resolveApiBase();

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/v1/prep-drafts`);
      if (res.ok) {
        const json = await res.json();
        setSavedDrafts(json.drafts ?? []);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [API]);

  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab, loadHistory]);

  async function generateDraft() {
    setLoading(true);
    setError(null);
    setDraft(null);
    try {
      const res = await fetch(`${API}/v1/prep-drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart, weekEnd }),
      });
      if (!res.ok) throw new Error(`Generation failed: ${res.status}`);
      const json = await res.json();
      setDraft(json.draft);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function approveDraft(id: string) {
    try {
      const res = await fetch(`${API}/v1/prep-drafts/${id}/approve`, { method: "PATCH" });
      if (!res.ok) throw new Error(`Approve failed: ${res.status}`);
      loadHistory();
    } catch (e: any) {
      setError(e.message);
    }
  }

  function priorityBadge(p: string) {
    if (p === "high") return <span className="badge badge-danger">High</span>;
    if (p === "medium") return <span className="badge badge-warn">Medium</span>;
    return <span className="badge badge-info">Low</span>;
  }

  return (
    <div>
      <div className="row" style={{ gap: "var(--sp-2)", marginBottom: "var(--sp-4)" }}>
        <button className={`btn ${tab === "generate" ? "btn-primary" : "btn-outline"} btn-sm`} onClick={() => setTab("generate")}>Generate Draft</button>
        <button className={`btn ${tab === "history" ? "btn-primary" : "btn-outline"} btn-sm`} onClick={() => setTab("history")}>History</button>
      </div>

      {error && <div className="card" style={{ borderColor: "var(--c-danger)", padding: "var(--sp-3)", marginBottom: "var(--sp-3)" }}>{error}</div>}

      {tab === "generate" && (
        <>
          <div className="card" style={{ padding: "var(--sp-4)", marginBottom: "var(--sp-4)" }}>
            <div className="row" style={{ gap: "var(--sp-3)", alignItems: "end", flexWrap: "wrap" }}>
              <div>
                <label style={{ fontWeight: 600, display: "block", marginBottom: "var(--sp-1)", fontSize: "0.85rem" }}>Week Start</label>
                <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} style={{ padding: "6px 10px", border: "1px solid var(--c-border)", borderRadius: 4, background: "var(--c-surface)", color: "var(--c-ink)" }} />
              </div>
              <div>
                <label style={{ fontWeight: 600, display: "block", marginBottom: "var(--sp-1)", fontSize: "0.85rem" }}>Week End</label>
                <input type="date" value={weekEnd} onChange={(e) => setWeekEnd(e.target.value)} style={{ padding: "6px 10px", border: "1px solid var(--c-border)", borderRadius: 4, background: "var(--c-surface)", color: "var(--c-ink)" }} />
              </div>
              <button className="btn btn-primary" onClick={generateDraft} disabled={loading}>
                {loading ? "Generating..." : "Generate Prep Draft"}
              </button>
            </div>
          </div>

          {draft && (
            <>
              <div className="kpi-grid" style={{ marginBottom: "var(--sp-4)" }}>
                <div className="kpi">
                  <div className="kpi-value">{draft.totalMeals}</div>
                  <div className="kpi-label">Planned Meals</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">{draft.totalComponents}</div>
                  <div className="kpi-label">Components Needed</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">{draft.shortages.length}</div>
                  <div className="kpi-label">Shortages</div>
                  {draft.shortages.length > 0 && <div className="kpi-note"><span className="badge badge-danger">Needs Attention</span></div>}
                </div>
              </div>

              {draft.shortages.length > 0 && (
                <div className="card" style={{ marginBottom: "var(--sp-4)", borderColor: "var(--c-danger)" }}>
                  <h3 style={{ padding: "var(--sp-3) var(--sp-3) 0", fontWeight: 600 }}>Shortages</h3>
                  <table className="table">
                    <thead><tr><th>Component</th><th>Raw Needed</th><th>On Hand</th><th>Shortage</th></tr></thead>
                    <tbody>
                      {draft.shortages.map((s) => (
                        <tr key={s.componentId}>
                          <td style={{ fontWeight: 600 }}>{s.componentName}</td>
                          <td>{s.rawG.toFixed(0)}g</td>
                          <td>{s.inventoryOnHandG.toFixed(0)}g</td>
                          <td><span className="badge badge-danger">{s.shortageG.toFixed(0)}g</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="card" style={{ overflowX: "auto" }}>
                <h3 style={{ padding: "var(--sp-3) var(--sp-3) 0", fontWeight: 600 }}>Batch Suggestions</h3>
                <table className="table">
                  <thead>
                    <tr><th>Component</th><th>Type</th><th>Raw (g)</th><th>Cooked (g)</th><th>Yield</th><th>Meals</th><th>Priority</th></tr>
                  </thead>
                  <tbody>
                    {draft.batchSuggestions.map((b) => (
                      <tr key={b.componentId}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{b.componentName}</div>
                          {b.sharingOpportunity && <div style={{ fontSize: "0.7rem", color: "var(--c-ink-soft)" }}>Shared across {b.mealCount} meals</div>}
                        </td>
                        <td><span className="badge badge-info">{b.componentType}</span></td>
                        <td>{b.rawG.toFixed(0)}</td>
                        <td>{b.cookedG.toFixed(0)}</td>
                        <td>{(b.yieldFactor * 100).toFixed(0)}%</td>
                        <td>{b.mealCount}</td>
                        <td>{priorityBadge(b.priority)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {tab === "history" && !loading && (
        <div className="card" style={{ overflowX: "auto" }}>
          {savedDrafts.length === 0 ? (
            <div style={{ padding: "var(--sp-4)", textAlign: "center", color: "var(--c-ink-soft)" }}>No prep drafts yet.</div>
          ) : (
            <table className="table">
              <thead><tr><th>Week</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
              <tbody>
                {savedDrafts.map((d) => (
                  <tr key={d.id}>
                    <td>{new Date(d.weekStart).toLocaleDateString()} – {new Date(d.weekEnd).toLocaleDateString()}</td>
                    <td>
                      <span className={`badge ${d.status === "APPROVED" ? "badge-success" : d.status === "COMMITTED" ? "badge-info" : "badge-warn"}`}>
                        {d.status}
                      </span>
                    </td>
                    <td>{new Date(d.createdAt).toLocaleString()}</td>
                    <td>
                      {d.status === "DRAFT" && (
                        <button className="btn btn-outline btn-sm" onClick={() => approveDraft(d.id)}>Approve</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {loading && <div style={{ color: "var(--c-ink-soft)" }}>Loading...</div>}
    </div>
  );
}
