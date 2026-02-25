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

/* ── Types ───────────────────────────────────────────── */

type FlavorProfile =
  | "SAVORY"
  | "SWEET"
  | "SPICY"
  | "ACIDIC"
  | "UMAMI"
  | "HERBAL"
  | "CITRUS"
  | "SMOKY";

type ComponentType =
  | "PROTEIN"
  | "CARB_BASE"
  | "VEGETABLE"
  | "SAUCE"
  | "CONDIMENT"
  | "OTHER";

type VariantType = "STANDARD" | "LOW_FAT" | "HIGH_FAT";

type Variant = {
  id: string;
  variantType: VariantType;
  kcalPer100g: number | null;
  proteinPer100g: number | null;
  carbPer100g: number | null;
  fatPer100g: number | null;
  fiberPer100g: number | null;
  sodiumPer100g: number | null;
};

type Pairing = {
  id: string;
  componentType: ComponentType;
  recommended: boolean;
  defaultPortionG: number | null;
};

type IngredientLine = {
  ingredientName: string;
  gPer100g: number | null;
  preparation: string | null;
};

type Sauce = {
  id: string;
  name: string;
  componentType: "SAUCE" | "CONDIMENT";
  flavorProfiles: FlavorProfile[];
  allergens: string[];
  portionIncrementG: number | null;
  active: boolean;
  variants: Variant[];
  pairings: Pairing[];
  ingredientLines: IngredientLine[];
};

/* ── Flavor pill color map ──────────────────────────── */

const FLAVOR_COLORS: Record<string, string> = {
  SAVORY: "#34d399",
  SWEET: "#f59e0b",
  SPICY: "#ef4444",
  ACIDIC: "#60a5fa",
  UMAMI: "#a78bfa",
  HERBAL: "#34d399",
  CITRUS: "#fbbf24",
  SMOKY: "#78716c",
};

function flavorColor(f: string): string {
  return FLAVOR_COLORS[f] ?? "var(--c-ink-soft)";
}

/* ── Variant badge color map ────────────────────────── */

function variantColor(vt: VariantType): string {
  switch (vt) {
    case "LOW_FAT":
      return "#60a5fa";
    case "HIGH_FAT":
      return "#f59e0b";
    default:
      return "var(--c-ink-soft)";
  }
}

/* ── Component type labels ──────────────────────────── */

const COMPONENT_TYPE_LABELS: Record<string, string> = {
  PROTEIN: "Protein",
  CARB_BASE: "Carb / Base",
  VEGETABLE: "Vegetable",
  SAUCE: "Sauce",
  CONDIMENT: "Condiment",
  OTHER: "Other",
};

const ALL_COMPONENT_TYPES: ComponentType[] = [
  "PROTEIN",
  "CARB_BASE",
  "VEGETABLE",
  "SAUCE",
  "CONDIMENT",
  "OTHER",
];

const ALL_VARIANT_TYPES: VariantType[] = ["STANDARD", "LOW_FAT", "HIGH_FAT"];

/* ── Sauce Card ─────────────────────────────────────── */

function SauceCard({
  sauce,
  onRefresh,
}: {
  sauce: Sauce;
  onRefresh: () => void;
}) {
  const [expandedSection, setExpandedSection] = useState<
    "variants" | "pairings" | "ingredients" | null
  >(null);

  // Variant form
  const [showVariantForm, setShowVariantForm] = useState(false);
  const [newVariantType, setNewVariantType] = useState<VariantType>("STANDARD");
  const [newVKcal, setNewVKcal] = useState("");
  const [newVProtein, setNewVProtein] = useState("");
  const [newVCarb, setNewVCarb] = useState("");
  const [newVFat, setNewVFat] = useState("");
  const [newVFiber, setNewVFiber] = useState("");
  const [newVSodium, setNewVSodium] = useState("");
  const [variantSaving, setVariantSaving] = useState(false);

  // Pairing form
  const [showPairingForm, setShowPairingForm] = useState(false);
  const [newPairingType, setNewPairingType] = useState<ComponentType>("PROTEIN");
  const [newPairingRecommended, setNewPairingRecommended] = useState(true);
  const [newPairingPortion, setNewPairingPortion] = useState("");
  const [pairingSaving, setPairingSaving] = useState(false);

  const apiBase = resolveApiBase();

  const toggle = (section: "variants" | "pairings" | "ingredients") => {
    setExpandedSection((prev) => (prev === section ? null : section));
  };

  const handleAddVariant = async () => {
    setVariantSaving(true);
    try {
      const body: Record<string, unknown> = { variantType: newVariantType };
      if (newVKcal) body.kcalPer100g = parseFloat(newVKcal);
      if (newVProtein) body.proteinPer100g = parseFloat(newVProtein);
      if (newVCarb) body.carbPer100g = parseFloat(newVCarb);
      if (newVFat) body.fatPer100g = parseFloat(newVFat);
      if (newVFiber) body.fiberPer100g = parseFloat(newVFiber);
      if (newVSodium) body.sodiumPer100g = parseFloat(newVSodium);

      const res = await fetch(`${apiBase}/v1/sauces/${sauce.id}/variants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setShowVariantForm(false);
        resetVariantForm();
        onRefresh();
      }
    } catch {
      // silent
    } finally {
      setVariantSaving(false);
    }
  };

  const resetVariantForm = () => {
    setNewVariantType("STANDARD");
    setNewVKcal("");
    setNewVProtein("");
    setNewVCarb("");
    setNewVFat("");
    setNewVFiber("");
    setNewVSodium("");
  };

  const handleAddPairing = async () => {
    setPairingSaving(true);
    try {
      const body: Record<string, unknown> = {
        componentType: newPairingType,
        recommended: newPairingRecommended,
      };
      if (newPairingPortion) body.defaultPortionG = parseFloat(newPairingPortion);

      const res = await fetch(`${apiBase}/v1/sauces/${sauce.id}/pairings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setShowPairingForm(false);
        setNewPairingType("PROTEIN");
        setNewPairingRecommended(true);
        setNewPairingPortion("");
        onRefresh();
      }
    } catch {
      // silent
    } finally {
      setPairingSaving(false);
    }
  };

  const handleDeletePairing = async (pairingId: string) => {
    try {
      const res = await fetch(
        `${apiBase}/v1/sauces/${sauce.id}/pairings/${pairingId}`,
        { method: "DELETE" }
      );
      if (res.ok) onRefresh();
    } catch {
      // silent
    }
  };

  const typeBadgeColor =
    sauce.componentType === "SAUCE" ? "var(--c-primary)" : "var(--c-accent)";

  return (
    <div
      className="card"
      style={{
        padding: "var(--sp-4)",
        opacity: sauce.active ? 1 : 0.6,
      }}
    >
      {/* Card Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "var(--sp-3)",
          marginBottom: "var(--sp-3)",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-2)",
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontWeight: "var(--weight-semibold)", fontSize: "var(--text-md)" }}>
              {sauce.name}
            </span>
            <span
              className="badge"
              style={{
                background: `${typeBadgeColor}22`,
                color: typeBadgeColor,
                border: `1px solid ${typeBadgeColor}44`,
              }}
            >
              {sauce.componentType}
            </span>
          </div>

          {/* Flavor profile pills */}
          {sauce.flavorProfiles.length > 0 && (
            <div
              style={{
                display: "flex",
                gap: "var(--sp-1)",
                flexWrap: "wrap",
                marginTop: "var(--sp-2)",
              }}
            >
              {sauce.flavorProfiles.map((fp) => {
                const color = flavorColor(fp);
                return (
                  <span
                    key={fp}
                    style={{
                      display: "inline-flex",
                      padding: "2px 8px",
                      borderRadius: "var(--r-full)",
                      fontSize: "var(--text-xs)",
                      fontWeight: "var(--weight-medium)",
                      background: `${color}20`,
                      color: color,
                      letterSpacing: "0.01em",
                    }}
                  >
                    {fp.charAt(0) + fp.slice(1).toLowerCase()}
                  </span>
                );
              })}
            </div>
          )}

          {/* Allergen warnings */}
          {sauce.allergens.length > 0 && (
            <div
              style={{
                display: "flex",
                gap: "var(--sp-1)",
                flexWrap: "wrap",
                marginTop: "var(--sp-2)",
              }}
            >
              {sauce.allergens.map((a) => (
                <span
                  key={a}
                  className="badge"
                  style={{
                    background: "var(--c-danger-soft)",
                    color: "var(--c-danger)",
                    border: "1px solid rgba(239,68,68,0.3)",
                  }}
                >
                  {a}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Active indicator + portion */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "var(--sp-1)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-2)",
              fontSize: "var(--text-xs)",
              color: sauce.active ? "var(--c-success)" : "var(--c-ink-muted)",
            }}
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "var(--r-full)",
                background: sauce.active ? "var(--c-success)" : "var(--c-ink-muted)",
              }}
            />
            {sauce.active ? "Active" : "Inactive"}
          </div>
          {sauce.portionIncrementG !== null && (
            <span
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--c-ink-soft)",
              }}
            >
              +{sauce.portionIncrementG}g increments
            </span>
          )}
        </div>
      </div>

      {/* Expand buttons */}
      <div
        style={{
          display: "flex",
          gap: "var(--sp-2)",
          flexWrap: "wrap",
          marginBottom: expandedSection ? "var(--sp-3)" : 0,
        }}
      >
        <button
          className={`btn btn-sm ${expandedSection === "variants" ? "btn-primary" : "btn-outline"}`}
          onClick={() => toggle("variants")}
        >
          Variants ({sauce.variants.length})
        </button>
        <button
          className={`btn btn-sm ${expandedSection === "pairings" ? "btn-primary" : "btn-outline"}`}
          onClick={() => toggle("pairings")}
        >
          Pairings ({sauce.pairings.length})
        </button>
        <button
          className={`btn btn-sm ${expandedSection === "ingredients" ? "btn-primary" : "btn-outline"}`}
          onClick={() => toggle("ingredients")}
        >
          Ingredients ({sauce.ingredientLines.length})
        </button>
      </div>

      {/* ── Variants Panel ───────────────────────────── */}
      {expandedSection === "variants" && (
        <div
          style={{
            background: "var(--c-surface-alt)",
            borderRadius: "var(--r-md)",
            padding: "var(--sp-3)",
            border: "1px solid var(--c-border-light)",
          }}
        >
          {sauce.variants.length === 0 && !showVariantForm && (
            <div
              style={{
                textAlign: "center",
                padding: "var(--sp-4)",
                color: "var(--c-ink-muted)",
                fontSize: "var(--text-sm)",
              }}
            >
              No variants yet
            </div>
          )}

          {sauce.variants.map((v) => {
            const vColor = variantColor(v.variantType);
            return (
              <div
                key={v.id}
                style={{
                  padding: "var(--sp-2) 0",
                  borderBottom: "1px solid var(--c-border-light)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--sp-2)",
                    marginBottom: "var(--sp-2)",
                  }}
                >
                  <span
                    className="badge"
                    style={{
                      background: `${vColor}22`,
                      color: vColor,
                      border: `1px solid ${vColor}44`,
                    }}
                  >
                    {v.variantType.replace(/_/g, " ")}
                  </span>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(80px, 1fr))",
                    gap: "var(--sp-2)",
                    fontSize: "var(--text-xs)",
                  }}
                >
                  <MacroCell label="kcal" value={v.kcalPer100g} />
                  <MacroCell label="protein" value={v.proteinPer100g} unit="g" />
                  <MacroCell label="carb" value={v.carbPer100g} unit="g" />
                  <MacroCell label="fat" value={v.fatPer100g} unit="g" />
                  <MacroCell label="fiber" value={v.fiberPer100g} unit="g" />
                  <MacroCell label="sodium" value={v.sodiumPer100g} unit="mg" />
                </div>
              </div>
            );
          })}

          {/* Add variant form */}
          {showVariantForm ? (
            <div style={{ marginTop: "var(--sp-3)" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "var(--sp-2)",
                  marginBottom: "var(--sp-2)",
                }}
              >
                <label style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-soft)" }}>
                  Variant Type
                  <select
                    value={newVariantType}
                    onChange={(e) => setNewVariantType(e.target.value as VariantType)}
                    style={{ fontSize: "var(--text-sm)" }}
                  >
                    {ALL_VARIANT_TYPES.map((vt) => (
                      <option key={vt} value={vt}>
                        {vt.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-soft)" }}>
                  kcal/100g
                  <input
                    type="number"
                    value={newVKcal}
                    onChange={(e) => setNewVKcal(e.target.value)}
                    placeholder="e.g. 120"
                    style={{ fontSize: "var(--text-sm)" }}
                  />
                </label>
                <label style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-soft)" }}>
                  Protein g/100g
                  <input
                    type="number"
                    value={newVProtein}
                    onChange={(e) => setNewVProtein(e.target.value)}
                    placeholder="e.g. 2.5"
                    style={{ fontSize: "var(--text-sm)" }}
                  />
                </label>
                <label style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-soft)" }}>
                  Carb g/100g
                  <input
                    type="number"
                    value={newVCarb}
                    onChange={(e) => setNewVCarb(e.target.value)}
                    placeholder="e.g. 8.0"
                    style={{ fontSize: "var(--text-sm)" }}
                  />
                </label>
                <label style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-soft)" }}>
                  Fat g/100g
                  <input
                    type="number"
                    value={newVFat}
                    onChange={(e) => setNewVFat(e.target.value)}
                    placeholder="e.g. 6.0"
                    style={{ fontSize: "var(--text-sm)" }}
                  />
                </label>
                <label style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-soft)" }}>
                  Fiber g/100g
                  <input
                    type="number"
                    value={newVFiber}
                    onChange={(e) => setNewVFiber(e.target.value)}
                    placeholder="e.g. 1.0"
                    style={{ fontSize: "var(--text-sm)" }}
                  />
                </label>
                <label style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-soft)" }}>
                  Sodium mg/100g
                  <input
                    type="number"
                    value={newVSodium}
                    onChange={(e) => setNewVSodium(e.target.value)}
                    placeholder="e.g. 350"
                    style={{ fontSize: "var(--text-sm)" }}
                  />
                </label>
              </div>
              <div style={{ display: "flex", gap: "var(--sp-2)" }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleAddVariant}
                  disabled={variantSaving}
                >
                  {variantSaving ? "Saving..." : "Save Variant"}
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => {
                    setShowVariantForm(false);
                    resetVariantForm();
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn btn-outline btn-sm"
              style={{ marginTop: "var(--sp-2)" }}
              onClick={() => setShowVariantForm(true)}
            >
              + Add Variant
            </button>
          )}
        </div>
      )}

      {/* ── Pairings Panel ───────────────────────────── */}
      {expandedSection === "pairings" && (
        <div
          style={{
            background: "var(--c-surface-alt)",
            borderRadius: "var(--r-md)",
            padding: "var(--sp-3)",
            border: "1px solid var(--c-border-light)",
          }}
        >
          {sauce.pairings.length === 0 && !showPairingForm && (
            <div
              style={{
                textAlign: "center",
                padding: "var(--sp-4)",
                color: "var(--c-ink-muted)",
                fontSize: "var(--text-sm)",
              }}
            >
              No pairings yet
            </div>
          )}

          {sauce.pairings.map((p) => (
            <div
              key={p.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "var(--sp-2) 0",
                borderBottom: "1px solid var(--c-border-light)",
                gap: "var(--sp-2)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-2)",
                  flexWrap: "wrap",
                }}
              >
                <span
                  className="tag"
                  style={{ fontSize: "var(--text-xs)" }}
                >
                  {COMPONENT_TYPE_LABELS[p.componentType] ?? p.componentType}
                </span>
                {p.recommended && (
                  <span
                    style={{
                      color: "var(--c-success)",
                      fontSize: "var(--text-xs)",
                      fontWeight: "var(--weight-medium)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <span style={{ fontSize: "14px" }}>{"\u2713"}</span>
                    Recommended
                  </span>
                )}
                {p.defaultPortionG !== null && (
                  <span
                    style={{
                      fontSize: "var(--text-xs)",
                      color: "var(--c-ink-muted)",
                    }}
                  >
                    {p.defaultPortionG}g
                  </span>
                )}
              </div>
              <button
                className="btn btn-ghost btn-sm"
                style={{
                  color: "var(--c-danger)",
                  fontSize: "var(--text-xs)",
                  padding: "4px 8px",
                }}
                onClick={() => handleDeletePairing(p.id)}
              >
                Remove
              </button>
            </div>
          ))}

          {/* Add pairing form */}
          {showPairingForm ? (
            <div style={{ marginTop: "var(--sp-3)" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "var(--sp-2)",
                  marginBottom: "var(--sp-2)",
                }}
              >
                <label style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-soft)" }}>
                  Component Type
                  <select
                    value={newPairingType}
                    onChange={(e) =>
                      setNewPairingType(e.target.value as ComponentType)
                    }
                    style={{ fontSize: "var(--text-sm)" }}
                  >
                    {ALL_COMPONENT_TYPES.map((ct) => (
                      <option key={ct} value={ct}>
                        {COMPONENT_TYPE_LABELS[ct] ?? ct}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-soft)" }}>
                  Default Portion (g)
                  <input
                    type="number"
                    value={newPairingPortion}
                    onChange={(e) => setNewPairingPortion(e.target.value)}
                    placeholder="e.g. 30"
                    style={{ fontSize: "var(--text-sm)" }}
                  />
                </label>
              </div>
              <label
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--c-ink-soft)",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: "var(--sp-2)",
                  marginBottom: "var(--sp-2)",
                  display: "flex",
                }}
              >
                <input
                  type="checkbox"
                  checked={newPairingRecommended}
                  onChange={(e) => setNewPairingRecommended(e.target.checked)}
                  style={{ width: "auto" }}
                />
                Recommended pairing
              </label>
              <div style={{ display: "flex", gap: "var(--sp-2)" }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleAddPairing}
                  disabled={pairingSaving}
                >
                  {pairingSaving ? "Saving..." : "Save Pairing"}
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => {
                    setShowPairingForm(false);
                    setNewPairingPortion("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn btn-outline btn-sm"
              style={{ marginTop: "var(--sp-2)" }}
              onClick={() => setShowPairingForm(true)}
            >
              + Add Pairing
            </button>
          )}
        </div>
      )}

      {/* ── Ingredients Panel (read-only) ────────────── */}
      {expandedSection === "ingredients" && (
        <div
          style={{
            background: "var(--c-surface-alt)",
            borderRadius: "var(--r-md)",
            padding: "var(--sp-3)",
            border: "1px solid var(--c-border-light)",
          }}
        >
          {sauce.ingredientLines.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "var(--sp-4)",
                color: "var(--c-ink-muted)",
                fontSize: "var(--text-sm)",
              }}
            >
              No ingredient lines
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
              {sauce.ingredientLines.map((line, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    padding: "var(--sp-1) 0",
                    borderBottom: "1px solid var(--c-border-light)",
                    fontSize: "var(--text-sm)",
                  }}
                >
                  <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "baseline" }}>
                    <span style={{ fontWeight: "var(--weight-medium)" }}>
                      {line.ingredientName}
                    </span>
                    {line.preparation && (
                      <span style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)" }}>
                        ({line.preparation})
                      </span>
                    )}
                  </div>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--text-xs)",
                      color: "var(--c-ink-soft)",
                      flexShrink: 0,
                    }}
                  >
                    {line.gPer100g !== null ? `${line.gPer100g.toFixed(1)} g/100g` : "\u2014"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Macro value display cell ───────────────────────── */

function MacroCell({
  label,
  value,
  unit,
}: {
  label: string;
  value: number | null;
  unit?: string;
}) {
  return (
    <div
      style={{
        background: "var(--c-surface)",
        borderRadius: "var(--r-sm)",
        padding: "var(--sp-1) var(--sp-2)",
        textAlign: "center",
        border: "1px solid var(--c-border-light)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontWeight: "var(--weight-semibold)",
          fontSize: "var(--text-sm)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value !== null ? value.toFixed(1) : "\u2014"}
        {value !== null && unit && (
          <span style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)", marginLeft: "2px" }}>
            {unit}
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: "10px",
          color: "var(--c-ink-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginTop: "2px",
        }}
      >
        {label}
      </div>
    </div>
  );
}

/* ── Main SauceBoard component ──────────────────────── */

export function SauceBoard() {
  const [sauces, setSauces] = useState<Sauce[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apiBase = resolveApiBase();

  const fetchSauces = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`${apiBase}/v1/sauces`);
      if (!res.ok) {
        setError(`Failed to load sauces (${res.status})`);
        return;
      }
      const data = await res.json();
      setSauces(Array.isArray(data) ? data : []);
    } catch {
      setError("Could not connect to API");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchSauces();
  }, [fetchSauces]);

  if (loading) {
    return <div className="loading-shimmer" style={{ height: 200, borderRadius: 12 }} />;
  }

  if (error) {
    return (
      <div className="state-box" style={{ textAlign: "center", padding: "var(--sp-8)" }}>
        <div className="state-title">Error</div>
        <div className="state-desc">{error}</div>
        <button
          className="btn btn-primary mt-4"
          onClick={() => {
            setLoading(true);
            fetchSauces();
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (sauces.length === 0) {
    return (
      <div className="state-box" style={{ textAlign: "center", padding: "var(--sp-8)" }}>
        <div className="state-title">No sauces yet</div>
        <div className="state-desc">
          Sauces and condiments will appear here once created via the API.
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gap: "var(--sp-4)",
        gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
        marginTop: "var(--sp-6)",
      }}
    >
      {sauces.map((sauce) => (
        <SauceCard key={sauce.id} sauce={sauce} onRefresh={fetchSauces} />
      ))}
    </div>
  );
}
