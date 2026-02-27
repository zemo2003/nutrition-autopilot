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

type UnmappedItem = {
  taskId: string;
  severity: string;
  productName: string;
  brand: string | null;
  upc: string | null;
  quantity: number | null;
  unit: string | null;
  confidence: number | null;
  ingredientKeyHint: string | null;
  createdAt: string;
};

type Suggestion = {
  ingredientId: string;
  ingredientName: string;
  ingredientCategory: string;
  productId?: string;
  productName?: string;
  productBrand?: string;
  productUpc?: string;
  totalScore: number;
  confidence: "high" | "medium" | "low" | "none";
  isExactUpc: boolean;
  isHistorical: boolean;
  factors: { factor: string; score: number; weight: number; weighted: number; detail: string }[];
};

type HistoryMapping = {
  id: string;
  sourceProductName: string;
  sourceBrand: string | null;
  sourceUpc: string | null;
  resolutionSource: string;
  confidenceScore: number;
  timesUsed: number;
  lastUsedAt: string;
  ingredient: { id: string; name: string; category: string };
  product: { id: string; name: string; brand: string } | null;
};

/* ── Component ────────────────────────────────────────────── */

export function MappingBoard() {
  const [tab, setTab] = useState<"queue" | "history">("queue");
  const [unmapped, setUnmapped] = useState<UnmappedItem[]>([]);
  const [history, setHistory] = useState<HistoryMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Suggestion state
  const [selectedItem, setSelectedItem] = useState<UnmappedItem | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [sugLoading, setSugLoading] = useState(false);

  // Resolve state
  const [resolving, setResolving] = useState(false);
  const [newIngName, setNewIngName] = useState("");
  const [newIngCategory, setNewIngCategory] = useState("UNMAPPED");
  const [pantryReason, setPantryReason] = useState("");

  const api = resolveApiBase();

  const fetchUnmapped = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${api}/v1/mappings/unmapped`);
      const d = await r.json();
      setUnmapped(d.unmapped ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  const fetchHistory = useCallback(async () => {
    try {
      const r = await fetch(`${api}/v1/mappings/history`);
      if (r.ok) {
        const d = await r.json();
        setHistory(d.mappings ?? []);
      }
    } catch (e: any) {
      // History fetch is secondary — don't block queue
      console.warn("Failed to fetch mapping history:", e?.message);
    }
  }, [api]);

  useEffect(() => {
    fetchUnmapped();
    fetchHistory();
  }, [fetchUnmapped, fetchHistory]);

  const [sugError, setSugError] = useState<string | null>(null);

  const loadSuggestions = async (item: UnmappedItem) => {
    setSelectedItem(item);
    setSuggestions([]);
    setSugLoading(true);
    setSugError(null);
    try {
      const params = new URLSearchParams({ productName: item.productName });
      if (item.brand) params.set("brand", item.brand);
      if (item.upc) params.set("upc", item.upc);
      const r = await fetch(`${api}/v1/mappings/suggestions?${params}`);
      if (r.ok) {
        const d = await r.json();
        setSuggestions(d.suggestions ?? []);
      } else {
        setSugError(`Failed to load suggestions (${r.status})`);
      }
    } catch (e: any) {
      setSugError(e?.message || "Network error loading suggestions");
    }
    setSugLoading(false);
  };

  const [resolveError, setResolveError] = useState<string | null>(null);

  const resolveMapping = async (
    action: "approve" | "search_select" | "create_new" | "mark_pantry",
    ingredientId?: string,
    productId?: string
  ) => {
    if (!selectedItem) return;
    setResolving(true);
    setResolveError(null);
    try {
      const res = await fetch(`${api}/v1/mappings/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: selectedItem.taskId,
          action,
          ingredientId,
          productId,
          newIngredientName: action === "create_new" ? newIngName : undefined,
          newIngredientCategory: action === "create_new" ? newIngCategory : undefined,
          pantryReason: action === "mark_pantry" ? pantryReason : undefined,
        }),
      });
      if (res.ok) {
        setSelectedItem(null);
        setSuggestions([]);
        setNewIngName("");
        setPantryReason("");
        fetchUnmapped();
        fetchHistory();
      } else {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        setResolveError(body.error || `Resolve failed (${res.status})`);
      }
    } catch (e: any) {
      setResolveError(e?.message || "Network error resolving mapping");
    }
    setResolving(false);
  };

  const confidenceColor = (c: string) => {
    if (c === "high") return "var(--success, #22c55e)";
    if (c === "medium") return "var(--warning, #f59e0b)";
    if (c === "low") return "var(--danger, #ef4444)";
    return "var(--muted, #6b7280)";
  };

  const severityBadge = (s: string) => {
    const colors: Record<string, string> = {
      CRITICAL: "#ef4444",
      HIGH: "#f59e0b",
      MEDIUM: "#3b82f6",
      LOW: "#6b7280",
    };
    return (
      <span
        style={{
          background: colors[s] ?? "#6b7280",
          color: "#fff",
          padding: "2px 8px",
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 600,
        }}
      >
        {s}
      </span>
    );
  };

  return (
    <div style={{ padding: "1.5rem", maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Instacart Mapping</h1>
      <p style={{ color: "#9ca3af", marginBottom: 16 }}>
        Review and resolve unmapped import line items. Learned mappings auto-apply on future imports.
      </p>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["queue", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              background: tab === t ? "#3b82f6" : "#1e293b",
              color: "#fff",
              fontWeight: tab === t ? 600 : 400,
              cursor: "pointer",
            }}
          >
            {t === "queue" ? `Unmapped Queue (${unmapped.length})` : `Learned Mappings (${history.length})`}
          </button>
        ))}
      </div>

      {error && (
        <div
          style={{ background: "#7f1d1d", color: "#fca5a5", padding: 12, borderRadius: 8, marginBottom: 16 }}
        >
          {error}
          <button onClick={fetchUnmapped} style={{ marginLeft: 12, color: "#fff", textDecoration: "underline", background: "none", border: "none", cursor: "pointer" }}>
            Retry
          </button>
        </div>
      )}

      {loading && <div style={{ color: "#9ca3af", padding: 20 }}>Loading...</div>}

      {/* ── Queue Tab ─────────────────────────────── */}
      {tab === "queue" && !loading && (
        <div style={{ display: "grid", gridTemplateColumns: selectedItem ? "1fr 1fr" : "1fr", gap: 16 }}>
          {/* Left: unmapped list */}
          <div>
            {unmapped.length === 0 && (
              <div style={{ color: "#9ca3af", padding: 40, textAlign: "center" }}>
                No unmapped items. All imports are resolved.
              </div>
            )}
            {unmapped.map((item) => (
              <div
                key={item.taskId}
                onClick={() => loadSuggestions(item)}
                style={{
                  background: selectedItem?.taskId === item.taskId ? "#1e3a5f" : "#1e293b",
                  border: selectedItem?.taskId === item.taskId ? "1px solid #3b82f6" : "1px solid #334155",
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 8,
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>{item.productName}</strong>
                  {severityBadge(item.severity)}
                </div>
                <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 4 }}>
                  {item.brand && <span>Brand: {item.brand} · </span>}
                  {item.upc && <span>UPC: {item.upc} · </span>}
                  {item.quantity && <span>{item.quantity} {item.unit}</span>}
                </div>
                {item.confidence !== null && (
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                    Auto-match confidence: {(item.confidence * 100).toFixed(0)}%
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Right: suggestions panel */}
          {selectedItem && (
            <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                Mapping: {selectedItem.productName}
              </h3>
              <p style={{ fontSize: 13, color: "#9ca3af", marginBottom: 12 }}>
                Select a match, create a new ingredient, or mark as pantry item.
              </p>

              {sugLoading && <div style={{ color: "#9ca3af" }}>Loading suggestions...</div>}

              {sugError && (
                <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
                  {sugError}
                  <button onClick={() => loadSuggestions(selectedItem)} style={{ marginLeft: 8, color: "#fff", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>
                    Retry
                  </button>
                </div>
              )}

              {resolveError && (
                <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
                  {resolveError}
                  <button onClick={() => setResolveError(null)} style={{ marginLeft: 8, color: "#fff", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>
                    Dismiss
                  </button>
                </div>
              )}

              {!sugLoading && suggestions.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ fontSize: 13, color: "#9ca3af", marginBottom: 8 }}>Candidate Matches</h4>
                  {suggestions.map((s, idx) => (
                    <div
                      key={`${s.ingredientId}-${s.productId ?? idx}`}
                      style={{
                        background: "#1e293b",
                        borderRadius: 6,
                        padding: 10,
                        marginBottom: 6,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 500 }}>{s.ingredientName}</div>
                        <div style={{ fontSize: 12, color: "#9ca3af" }}>
                          {s.productName && `${s.productBrand ? s.productBrand + " " : ""}${s.productName}`}
                          {!s.productName && s.ingredientCategory}
                          {s.isExactUpc && " · UPC Match"}
                          {s.isHistorical && " · Previously Mapped"}
                        </div>
                        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                          {s.factors.map((f) => `${f.factor}: ${(f.score * 100).toFixed(0)}%`).join(" · ")}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            color: confidenceColor(s.confidence),
                            fontWeight: 600,
                            fontSize: 14,
                          }}
                        >
                          {(s.totalScore * 100).toFixed(0)}%
                        </span>
                        <button
                          onClick={() => resolveMapping("approve", s.ingredientId, s.productId)}
                          disabled={resolving}
                          style={{
                            background: "#22c55e",
                            color: "#fff",
                            border: "none",
                            borderRadius: 4,
                            padding: "4px 10px",
                            fontSize: 12,
                            cursor: "pointer",
                          }}
                        >
                          Approve
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Create New */}
              <div style={{ borderTop: "1px solid #334155", paddingTop: 12, marginBottom: 12 }}>
                <h4 style={{ fontSize: 13, color: "#9ca3af", marginBottom: 6 }}>Create New Ingredient</h4>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    value={newIngName}
                    onChange={(e) => setNewIngName(e.target.value)}
                    placeholder="Ingredient name"
                    style={{
                      flex: 1,
                      background: "#1e293b",
                      border: "1px solid #334155",
                      borderRadius: 4,
                      padding: "6px 8px",
                      color: "#fff",
                      fontSize: 13,
                    }}
                  />
                  <select
                    value={newIngCategory}
                    onChange={(e) => setNewIngCategory(e.target.value)}
                    style={{
                      background: "#1e293b",
                      border: "1px solid #334155",
                      borderRadius: 4,
                      padding: "6px 8px",
                      color: "#fff",
                      fontSize: 13,
                    }}
                  >
                    {["UNMAPPED", "protein", "produce", "dairy", "grain", "oil", "spice", "condiment", "other"].map(
                      (c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      )
                    )}
                  </select>
                  <button
                    onClick={() => resolveMapping("create_new")}
                    disabled={!newIngName || resolving}
                    style={{
                      background: "#3b82f6",
                      color: "#fff",
                      border: "none",
                      borderRadius: 4,
                      padding: "6px 12px",
                      fontSize: 12,
                      cursor: newIngName ? "pointer" : "not-allowed",
                      opacity: newIngName ? 1 : 0.5,
                    }}
                  >
                    Create
                  </button>
                </div>
              </div>

              {/* Mark Pantry */}
              <div style={{ borderTop: "1px solid #334155", paddingTop: 12 }}>
                <h4 style={{ fontSize: 13, color: "#9ca3af", marginBottom: 6 }}>Mark as Pantry / Non-Tracked</h4>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    value={pantryReason}
                    onChange={(e) => setPantryReason(e.target.value)}
                    placeholder="Reason (optional)"
                    style={{
                      flex: 1,
                      background: "#1e293b",
                      border: "1px solid #334155",
                      borderRadius: 4,
                      padding: "6px 8px",
                      color: "#fff",
                      fontSize: 13,
                    }}
                  />
                  <button
                    onClick={() => resolveMapping("mark_pantry")}
                    disabled={resolving}
                    style={{
                      background: "#6b7280",
                      color: "#fff",
                      border: "none",
                      borderRadius: 4,
                      padding: "6px 12px",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    Mark Pantry
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── History Tab ───────────────────────────── */}
      {tab === "history" && !loading && (
        <div>
          {history.length === 0 && (
            <div style={{ color: "#9ca3af", padding: 40, textAlign: "center" }}>
              No learned mappings yet. Resolve items from the queue to build mapping memory.
            </div>
          )}
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #334155", fontSize: 13, color: "#9ca3af" }}>
                <th style={{ textAlign: "left", padding: 8 }}>Source Product</th>
                <th style={{ textAlign: "left", padding: 8 }}>Mapped To</th>
                <th style={{ textAlign: "left", padding: 8 }}>Source</th>
                <th style={{ textAlign: "right", padding: 8 }}>Uses</th>
                <th style={{ textAlign: "right", padding: 8 }}>Last Used</th>
              </tr>
            </thead>
            <tbody>
              {history.map((m) => (
                <tr key={m.id} style={{ borderBottom: "1px solid #1e293b" }}>
                  <td style={{ padding: 8 }}>
                    <div>{m.sourceProductName}</div>
                    {m.sourceBrand && <div style={{ fontSize: 12, color: "#6b7280" }}>{m.sourceBrand}</div>}
                  </td>
                  <td style={{ padding: 8 }}>
                    <div>{m.ingredient.name}</div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>{m.ingredient.category}</div>
                  </td>
                  <td style={{ padding: 8 }}>
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: m.resolutionSource.startsWith("AUTO") ? "#1e3a5f" : "#1e293b",
                        color: m.resolutionSource.startsWith("AUTO") ? "#60a5fa" : "#9ca3af",
                      }}
                    >
                      {m.resolutionSource.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td style={{ padding: 8, textAlign: "right" }}>{m.timesUsed}</td>
                  <td style={{ padding: 8, textAlign: "right", color: "#6b7280", fontSize: 13 }}>
                    {new Date(m.lastUsedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
