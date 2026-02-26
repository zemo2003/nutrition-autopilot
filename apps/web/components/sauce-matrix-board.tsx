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

type PortionPreset = { portionG: number; kcal: number | null; proteinG: number | null; carbG: number | null; fatG: number | null };
type Variant = { id: string; type: string; kcalPer100g: number | null; proteinPer100g: number | null; carbPer100g: number | null; fatPer100g: number | null; portionPresets: PortionPreset[] };
type Pairing = { pairedComponentType: string; recommended: boolean; defaultPortionG: number | null };
type SauceEntry = {
  id: string;
  name: string;
  flavorProfiles: string[];
  allergenTags: string[];
  variants: Variant[];
  pairings: Pairing[];
};

export default function SauceMatrixBoard() {
  const [sauces, setSauces] = useState<SauceEntry[]>([]);
  const [selectedSauce, setSelectedSauce] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const API = resolveApiBase();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/v1/sauce-matrix`);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const json = await res.json();
      setSauces(json.sauces ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [API]);

  useEffect(() => { load(); }, [load]);

  const selected = sauces.find((s) => s.id === selectedSauce);

  return (
    <div>
      {error && <div className="card" style={{ borderColor: "var(--c-danger)", padding: "var(--sp-3)", marginBottom: "var(--sp-3)" }}>{error}</div>}
      {loading && <div style={{ color: "var(--c-ink-soft)" }}>Loading...</div>}

      {!loading && sauces.length === 0 && (
        <div className="card" style={{ padding: "var(--sp-4)", textAlign: "center", color: "var(--c-ink-soft)" }}>
          No sauces in the library yet. Add sauce components to populate the matrix.
        </div>
      )}

      {!loading && sauces.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "var(--sp-4)" }}>
          {/* Sauce list */}
          <div className="card" style={{ padding: "var(--sp-2)" }}>
            <div style={{ padding: "var(--sp-2)", fontWeight: 600, borderBottom: "1px solid var(--c-border)", marginBottom: "var(--sp-1)" }}>
              Sauces ({sauces.length})
            </div>
            {sauces.map((sauce) => (
              <div
                key={sauce.id}
                onClick={() => setSelectedSauce(sauce.id)}
                style={{
                  padding: "var(--sp-2)",
                  cursor: "pointer",
                  borderRadius: 4,
                  background: selectedSauce === sauce.id ? "var(--c-surface-alt)" : "transparent",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{sauce.name}</div>
                <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "2px" }}>
                  {sauce.flavorProfiles.map((f) => (
                    <span key={f} className="badge badge-info" style={{ fontSize: "0.65rem" }}>{f}</span>
                  ))}
                </div>
                {sauce.allergenTags.length > 0 && (
                  <div style={{ fontSize: "0.7rem", color: "var(--c-danger)", marginTop: "2px" }}>
                    Allergens: {sauce.allergenTags.join(", ")}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Detail panel */}
          <div>
            {!selected ? (
              <div className="card" style={{ padding: "var(--sp-4)", textAlign: "center", color: "var(--c-ink-soft)" }}>
                Select a sauce to view details
              </div>
            ) : (
              <>
                <div className="card" style={{ padding: "var(--sp-4)", marginBottom: "var(--sp-4)" }}>
                  <h3 style={{ fontWeight: 600, marginBottom: "var(--sp-2)" }}>{selected.name}</h3>
                  <div className="row" style={{ gap: "var(--sp-2)", flexWrap: "wrap", marginBottom: "var(--sp-2)" }}>
                    {selected.flavorProfiles.map((f) => (
                      <span key={f} className="badge badge-info">{f}</span>
                    ))}
                    {selected.allergenTags.map((a) => (
                      <span key={a} className="badge badge-warn">{a}</span>
                    ))}
                  </div>

                  {/* Pairings */}
                  {selected.pairings.length > 0 && (
                    <div style={{ marginTop: "var(--sp-3)" }}>
                      <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "var(--sp-1)" }}>Pairings</div>
                      <div className="row" style={{ gap: "var(--sp-2)", flexWrap: "wrap" }}>
                        {selected.pairings.map((p) => (
                          <div key={p.pairedComponentType} style={{ padding: "6px 10px", background: "var(--c-surface-alt)", borderRadius: 4, fontSize: "0.85rem" }}>
                            {p.pairedComponentType}
                            {p.recommended && <span className="badge badge-success" style={{ marginLeft: "var(--sp-1)", fontSize: "0.65rem" }}>Recommended</span>}
                            {p.defaultPortionG && <span style={{ color: "var(--c-ink-soft)", marginLeft: "var(--sp-1)" }}>{p.defaultPortionG}g</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Variants with portion presets */}
                {selected.variants.map((v) => (
                  <div key={v.id} className="card" style={{ padding: "var(--sp-4)", marginBottom: "var(--sp-3)" }}>
                    <div style={{ fontWeight: 600, marginBottom: "var(--sp-2)" }}>
                      {v.type} Variant
                      <span style={{ fontWeight: 400, color: "var(--c-ink-soft)", marginLeft: "var(--sp-2)", fontSize: "0.85rem" }}>
                        {v.kcalPer100g != null ? `${v.kcalPer100g} kcal` : "—"} / 100g
                      </span>
                    </div>

                    <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "var(--sp-1)" }}>Portion Presets</div>
                    <table className="table">
                      <thead>
                        <tr><th>Portion</th><th>kcal</th><th>Protein</th><th>Carbs</th><th>Fat</th></tr>
                      </thead>
                      <tbody>
                        {v.portionPresets.map((p) => (
                          <tr key={p.portionG}>
                            <td style={{ fontWeight: 600 }}>{p.portionG}g</td>
                            <td>{p.kcal?.toFixed(1) ?? "—"}</td>
                            <td>{p.proteinG?.toFixed(1) ?? "—"}g</td>
                            <td>{p.carbG?.toFixed(1) ?? "—"}g</td>
                            <td>{p.fatG?.toFixed(1) ?? "—"}g</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}

                {selected.variants.length === 0 && (
                  <div className="card" style={{ padding: "var(--sp-3)", color: "var(--c-ink-soft)", textAlign: "center" }}>
                    No variants configured for this sauce.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
