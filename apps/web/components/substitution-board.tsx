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

type Ingredient = {
  id: string;
  name: string;
  category: string;
};

type NutrientDelta = {
  nutrient: string;
  original: number;
  substitute: number;
  delta: number;
  percentChange: number;
};

type SubSuggestion = {
  ingredientId: string;
  ingredientName: string;
  category: string;
  availableG: number;
  totalScore: number;
  quality: "excellent" | "good" | "fair" | "poor";
  allergenSafe: boolean;
  sufficientInventory: boolean;
  nutrientDeltas: NutrientDelta[];
  totalNutrientDeltaPercent: number;
  factors: { factor: string; score: number; detail: string }[];
  warnings: string[];
};

type SubRecord = {
  id: string;
  originalIngredient: { name: string; category: string };
  substituteIngredient: { name: string; category: string };
  reason: string;
  status: string;
  createdAt: string;
  nutrientDelta: NutrientDelta[] | null;
};

/* ── Component ────────────────────────────────────────────── */

export function SubstitutionBoard() {
  const [tab, setTab] = useState<"find" | "history">("find");
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [selectedIngId, setSelectedIngId] = useState("");
  const [requiredG, setRequiredG] = useState("200");
  const [suggestions, setSuggestions] = useState<SubSuggestion[]>([]);
  const [originalInfo, setOriginalInfo] = useState<{ ingredientName: string; category: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<SubRecord[]>([]);
  const [applying, setApplying] = useState<string | null>(null);

  const [initError, setInitError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  const api = resolveApiBase();

  // Load ingredient list for dropdown
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${api}/v1/components?type=`);
        // Fall back to inventory projections for ingredient list
        const r2 = await fetch(`${api}/v1/inventory/projections`);
        if (r2.ok) {
          const d2 = await r2.json();
          const ings = (d2.projections ?? []).map((p: any) => ({
            id: p.ingredientId,
            name: p.ingredientName,
            category: p.category,
          }));
          setIngredients(ings);
        } else if (r.ok) {
          const d = await r.json();
          setIngredients(d.components ?? []);
        } else {
          setInitError("Failed to load ingredient list");
        }
      } catch (e: any) {
        setInitError(e?.message || "Network error loading ingredients");
      }
    })();
  }, [api]);

  const fetchHistory = useCallback(async () => {
    try {
      const r = await fetch(`${api}/v1/substitutions`);
      if (r.ok) {
        const d = await r.json();
        setHistory(d.substitutions ?? []);
      }
    } catch (e: any) {
      console.warn("Failed to fetch substitution history:", e?.message);
    }
  }, [api]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const findSubstitutions = async () => {
    if (!selectedIngId) return;
    setLoading(true);
    setSuggestions([]);
    setOriginalInfo(null);
    setSearchError(null);
    try {
      const params = new URLSearchParams({
        ingredientId: selectedIngId,
        requiredG: requiredG || "200",
      });
      const r = await fetch(`${api}/v1/substitutions/suggest?${params}`);
      if (r.ok) {
        const d = await r.json();
        setSuggestions(d.suggestions ?? []);
        setOriginalInfo(d.original ?? null);
      } else {
        setSearchError(`Search failed (${r.status})`);
      }
    } catch (e: any) {
      setSearchError(e?.message || "Network error searching substitutions");
    }
    setLoading(false);
  };

  const applySubstitution = async (s: SubSuggestion) => {
    setApplying(s.ingredientId);
    setApplyError(null);
    try {
      const res = await fetch(`${api}/v1/substitutions/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalIngredientId: selectedIngId,
          substituteIngredientId: s.ingredientId,
          reason: `Substitution: ${originalInfo?.ingredientName ?? "unknown"} → ${s.ingredientName} (score: ${s.totalScore})`,
          nutrientDelta: s.nutrientDeltas,
          rankScore: s.totalScore,
          rankFactors: s.factors,
        }),
      });
      if (res.ok) {
        fetchHistory();
      } else {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        setApplyError(body.error || `Apply failed (${res.status})`);
      }
    } catch (e: any) {
      setApplyError(e?.message || "Network error applying substitution");
    }
    setApplying(null);
  };

  const qualityColor = (q: string) => {
    if (q === "excellent") return "#22c55e";
    if (q === "good") return "#3b82f6";
    if (q === "fair") return "#f59e0b";
    return "#ef4444";
  };

  const deltaColor = (pct: number) => {
    const abs = Math.abs(pct);
    if (abs < 5) return "#22c55e";
    if (abs < 15) return "#f59e0b";
    return "#ef4444";
  };

  return (
    <div style={{ padding: "1.5rem", maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Substitution Engine</h1>
      <p style={{ color: "#9ca3af", marginBottom: 16 }}>
        Find ingredient substitutions ranked by category match, allergen safety, inventory availability, and nutrient similarity.
      </p>

      {/* Error banners */}
      {initError && (
        <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          {initError}
        </div>
      )}
      {searchError && (
        <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          {searchError}
          <button onClick={() => setSearchError(null)} style={{ marginLeft: 8, color: "#fff", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>
            Dismiss
          </button>
        </div>
      )}
      {applyError && (
        <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          {applyError}
          <button onClick={() => setApplyError(null)} style={{ marginLeft: 8, color: "#fff", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>
            Dismiss
          </button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["find", "history"] as const).map((t) => (
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
            {t === "find" ? "Find Substitutions" : `History (${history.length})`}
          </button>
        ))}
      </div>

      {/* ── Find Tab ──────────────────────────────── */}
      {tab === "find" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            <select
              value={selectedIngId}
              onChange={(e) => setSelectedIngId(e.target.value)}
              style={{
                flex: 1,
                minWidth: 200,
                background: "#1e293b",
                border: "1px solid #334155",
                borderRadius: 6,
                padding: "8px 12px",
                color: "#fff",
              }}
            >
              <option value="">Select ingredient to replace...</option>
              {ingredients.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.category})
                </option>
              ))}
            </select>
            <input
              type="number"
              value={requiredG}
              onChange={(e) => setRequiredG(e.target.value)}
              placeholder="Grams needed"
              style={{
                width: 120,
                background: "#1e293b",
                border: "1px solid #334155",
                borderRadius: 6,
                padding: "8px 12px",
                color: "#fff",
              }}
            />
            <button
              onClick={findSubstitutions}
              disabled={!selectedIngId || loading}
              style={{
                background: "#3b82f6",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "8px 20px",
                fontWeight: 600,
                cursor: selectedIngId ? "pointer" : "not-allowed",
                opacity: selectedIngId ? 1 : 0.5,
              }}
            >
              {loading ? "Searching..." : "Find Substitutions"}
            </button>
          </div>

          {originalInfo && (
            <div style={{ color: "#9ca3af", fontSize: 14, marginBottom: 12 }}>
              Showing substitutions for <strong style={{ color: "#fff" }}>{originalInfo.ingredientName}</strong> ({originalInfo.category})
            </div>
          )}

          {suggestions.length === 0 && !loading && selectedIngId && (
            <div style={{ color: "#6b7280", padding: 30, textAlign: "center" }}>
              No substitutions found. Try a different ingredient.
            </div>
          )}

          {suggestions.map((s) => (
            <div
              key={s.ingredientId}
              style={{
                background: "#1e293b",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: 16,
                marginBottom: 10,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong style={{ fontSize: 16 }}>{s.ingredientName}</strong>
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: qualityColor(s.quality),
                        color: "#fff",
                        fontWeight: 600,
                      }}
                    >
                      {s.quality.toUpperCase()}
                    </span>
                    {!s.allergenSafe && (
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "#ef4444", color: "#fff" }}>
                        ALLERGEN RISK
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 2 }}>
                    {s.category} · {s.availableG.toFixed(0)}g available · Score: {(s.totalScore * 100).toFixed(0)}%
                  </div>
                </div>
                <button
                  onClick={() => applySubstitution(s)}
                  disabled={applying === s.ingredientId}
                  style={{
                    background: s.allergenSafe ? "#22c55e" : "#6b7280",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    padding: "8px 16px",
                    fontWeight: 600,
                    cursor: "pointer",
                    opacity: applying === s.ingredientId ? 0.5 : 1,
                  }}
                >
                  {applying === s.ingredientId ? "Applying..." : "Apply"}
                </button>
              </div>

              {/* Nutrient deltas */}
              <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
                {s.nutrientDeltas
                  .filter((d) => d.original > 0 || d.substitute > 0)
                  .map((d) => (
                    <div
                      key={d.nutrient}
                      style={{
                        background: "#0f172a",
                        borderRadius: 4,
                        padding: "4px 8px",
                        fontSize: 12,
                      }}
                    >
                      <span style={{ color: "#9ca3af" }}>{d.nutrient}: </span>
                      <span>{d.original.toFixed(1)} → {d.substitute.toFixed(1)}</span>
                      <span style={{ color: deltaColor(d.percentChange), marginLeft: 4 }}>
                        ({d.percentChange > 0 ? "+" : ""}{d.percentChange.toFixed(1)}%)
                      </span>
                    </div>
                  ))}
              </div>

              {/* Warnings */}
              {s.warnings.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {s.warnings.map((w, i) => (
                    <div key={i} style={{ fontSize: 12, color: "#f59e0b" }}>
                      ⚠ {w}
                    </div>
                  ))}
                </div>
              )}

              {/* Score factors */}
              <div style={{ marginTop: 8, fontSize: 11, color: "#6b7280" }}>
                {s.factors.map((f) => `${f.factor}: ${(f.score * 100).toFixed(0)}%`).join(" · ")}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── History Tab ───────────────────────────── */}
      {tab === "history" && (
        <div>
          {history.length === 0 && (
            <div style={{ color: "#9ca3af", padding: 40, textAlign: "center" }}>
              No substitutions applied yet.
            </div>
          )}
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #334155", fontSize: 13, color: "#9ca3af" }}>
                <th style={{ textAlign: "left", padding: 8 }}>Original</th>
                <th style={{ textAlign: "center", padding: 8 }}></th>
                <th style={{ textAlign: "left", padding: 8 }}>Substitute</th>
                <th style={{ textAlign: "left", padding: 8 }}>Status</th>
                <th style={{ textAlign: "right", padding: 8 }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid #1e293b" }}>
                  <td style={{ padding: 8 }}>
                    <div>{r.originalIngredient.name}</div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>{r.originalIngredient.category}</div>
                  </td>
                  <td style={{ padding: 8, textAlign: "center", color: "#3b82f6" }}>→</td>
                  <td style={{ padding: 8 }}>
                    <div>{r.substituteIngredient.name}</div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>{r.substituteIngredient.category}</div>
                  </td>
                  <td style={{ padding: 8 }}>
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: r.status === "APPLIED" ? "#1e3a5f" : "#1e293b",
                        color: r.status === "APPLIED" ? "#60a5fa" : "#9ca3af",
                      }}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td style={{ padding: 8, textAlign: "right", color: "#6b7280", fontSize: 13 }}>
                    {new Date(r.createdAt).toLocaleDateString()}
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
