import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? process.env.API_BASE ?? "http://localhost:4000";

type LabelPayload = {
  provisional?: boolean;
  reasonCodes?: string[];
  evidenceSummary?: {
    verifiedCount?: number;
    inferredCount?: number;
    exceptionCount?: number;
    unverifiedCount?: number;
    totalNutrientRows?: number;
    provisional?: boolean;
  };
  servingWeightG?: number;
  roundedFda?: {
    calories?: number;
    fatG?: number;
    satFatG?: number;
    transFatG?: number;
    cholesterolMg?: number;
    sodiumMg?: number;
    carbG?: number;
    fiberG?: number;
    sugarsG?: number;
    addedSugarsG?: number;
    proteinG?: number;
    vitaminDMcg?: number;
    calciumMg?: number;
    ironMg?: number;
    potassiumMg?: number;
  };
  ingredientDeclaration?: string;
  allergenStatement?: string;
  qa?: {
    macroKcal?: number;
    labeledCalories?: number;
    delta?: number;
    pass?: boolean;
  };
  perServing?: Record<string, number>;
  nutrientsPerServing?: Record<string, number>;
  nutrientsPer100g?: Record<string, number>;
  nutrientsTotal?: Record<string, number>;
  ingredientBreakdown?: Array<{
    ingredientName: string;
    gramsPerServing: number;
    percentOfServing: number;
    nutrientHighlights: { protein_g: number; fat_g: number; carb_g: number; kcal: number };
  }>;
  plausibility?: {
    valid?: boolean;
    errorCount?: number;
    warningCount?: number;
    issues?: Array<{
      nutrientKey: string;
      value: number;
      rule: string;
      severity: "ERROR" | "WARNING";
      message: string;
      suggestedRange?: { min: number; max: number };
    }>;
  };
  percentDV?: Record<string, number>;
};

// Macros only — micronutrients hidden until data quality is tightened
const nutrientOrder = [
  "kcal",
  "protein_g",
  "carb_g",
  "fat_g",
  "fiber_g",
  "sugars_g",
  "added_sugars_g",
  "sat_fat_g",
  "trans_fat_g",
  "cholesterol_mg",
  "sodium_mg",
] as const;

function resolveNutrientDataset(payload: LabelPayload):
  | { label: string; values: Record<string, number> }
  | null {
  if (payload.perServing) return { label: "Per Serving", values: payload.perServing };
  if (payload.nutrientsPerServing) return { label: "Per Serving", values: payload.nutrientsPerServing };
  if (payload.nutrientsPer100g) return { label: "Per 100g", values: payload.nutrientsPer100g };
  if (payload.nutrientsTotal) return { label: "Total Consumed", values: payload.nutrientsTotal };
  return null;
}

function nutrientLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (x) => x.toUpperCase())
    .replace("Mcg", "mcg")
    .replace("Mg", "mg")
    .replace("G", "g")
    .replace("Kcal", "kcal");
}

function nutrientUnit(key: string): string {
  if (key === "kcal") return "kcal";
  if (key.endsWith("_mg")) return "mg";
  if (key.endsWith("_mcg")) return "mcg";
  if (key.endsWith("_g")) return "g";
  return "";
}

function formatNutrientValue(value: number): string {
  if (Math.abs(value) >= 100) return value.toFixed(1);
  if (Math.abs(value) >= 10) return value.toFixed(2);
  return value.toFixed(3);
}

function orderedNutrients(values: Record<string, number>): Array<{ key: string; value: number }> {
  // Only show nutrients explicitly listed in nutrientOrder (macros)
  return nutrientOrder
    .filter((key) => typeof values[key] === "number" && Number.isFinite(values[key]!))
    .map((key) => ({ key, value: values[key]! }));
}

// Category grouping for recipe breakdown (matches schedule page)
const CATEGORY_ORDER = ["protein", "vegetable", "grain", "fruit", "dairy", "fat", "condiment", "other", "unmapped"];
const CATEGORY_LABELS: Record<string, string> = {
  protein: "Protein",
  vegetable: "Vegetables & Carbs",
  grain: "Grains",
  fruit: "Fruit",
  dairy: "Dairy",
  fat: "Fats & Oils",
  condiment: "Condiments",
  other: "Other",
  unmapped: "Other",
};

type RecipeLineItem = { ingredientName: string; category: string; gramsPerServing: number; preparation: string | null };

function groupRecipeByCategory(lines: RecipeLineItem[]): Array<{ category: string; label: string; items: RecipeLineItem[] }> {
  const map = new Map<string, RecipeLineItem[]>();
  for (const line of lines) {
    const cat = line.category || "other";
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(line);
  }
  return CATEGORY_ORDER
    .filter((cat) => map.has(cat))
    .map((cat) => ({
      category: cat,
      label: CATEGORY_LABELS[cat] ?? cat,
      items: map.get(cat)!,
    }));
}

async function getLabel(labelId: string) {
  const response = await fetch(`${API_BASE}/v1/labels/${labelId}`, { cache: "no-store" });
  if (!response.ok) return null;
  return response.json();
}

export default async function LabelPage({ params }: { params: Promise<{ labelId: string }> }) {
  const { labelId } = await params;
  const label = await getLabel(labelId);

  if (!label) {
    return (
      <div className="page-shell">
        <div className="card">
          <div className="state-box">
            <div className="state-icon">!</div>
            <div className="state-title">Label Not Found</div>
            <div className="state-desc">
              This label ID does not exist or has been removed.
            </div>
            <Link href="/" className="btn btn-primary mt-4">Back to Dashboard</Link>
          </div>
        </div>
      </div>
    );
  }

  const payload = (label.renderPayload ?? {}) as LabelPayload;
  const provisional = Boolean(label.provisional ?? payload.provisional);
  const supersededByLabelId =
    typeof label.supersededByLabelId === "string" && label.supersededByLabelId.length > 0
      ? label.supersededByLabelId
      : null;
  const r = payload.roundedFda ?? {};
  const dv = payload.percentDV ?? {};
  const nutrientDataset = resolveNutrientDataset(payload);
  const nutrients = nutrientDataset ? orderedNutrients(nutrientDataset.values) : [];

  // Recipe lines from SKU (returned by API alongside label)
  const recipeLines: Array<{ ingredientName: string; category: string; gramsPerServing: number; preparation: string | null }> =
    Array.isArray(label.recipeLines) ? label.recipeLines : [];
  const recipeGroups = groupRecipeByCategory(recipeLines);

  return (
    <div className="page-shell">
      <div className="breadcrumbs">
        <Link href="/">Dashboard</Link>
        <span className="sep">/</span>
        <span className="current">Label Detail</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{label.title}</h1>
          <div className="row mt-2">
            <span className="tag">{label.labelType}</span>
            <span className="tag">v{label.version}</span>
            {provisional ? <span className="badge badge-warn">Provisional Historical Label</span> : null}
            {label.frozenAt && (
              <span className="tag">
                Frozen {new Date(label.frozenAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        <div className="page-header-actions">
          <Link href={`/labels/${labelId}/print`} className="btn btn-primary">
            Print View
          </Link>
          <Link href="/" className="btn btn-outline">Dashboard</Link>
        </div>
      </div>

      {supersededByLabelId ? (
        <section className="card section">
          <div className="card-header">
            <h3>Superseded Snapshot</h3>
            <span className="badge badge-warn">Outdated</span>
          </div>
          <p className="label-text">
            This label snapshot is immutable history and has been superseded by a newer corrected snapshot.
          </p>
          <div className="row mt-3">
            <Link href={`/labels/${supersededByLabelId}`} className="btn btn-primary">
              Open Latest Snapshot
            </Link>
          </div>
        </section>
      ) : null}

      <div className="grid-two">
        <section>
          <div className="nutrition-panel">
            <div className="nutrition-panel-header">
              <h3>Nutrition Facts</h3>
              <p>Per serving</p>
            </div>
            <div className="nutrition-panel-body">
              {payload.roundedFda ? (
                <>
                  <div className="nutrition-row">
                    <span>Serving Size</span>
                    <span className="val">{payload.servingWeightG?.toFixed(1) ?? "n/a"} g</span>
                  </div>
                  <div className="nutrition-row calories" style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Calories</span>
                    <span className="val">{r.calories ?? 0}</span>
                  </div>
                  <div style={{ textAlign: "right", fontSize: "var(--text-xs)", fontWeight: 600, padding: "2px var(--sp-3)", borderBottom: "1px solid var(--c-border-light)", opacity: 0.6 }}>% Daily Value*</div>
                  <div className="nutrition-row major" style={{ display: "flex", justifyContent: "space-between" }}>
                    <span><b>Total Fat</b> {r.fatG ?? 0}g</span>
                    <span className="val">{dv.fat_g != null ? `${Math.round(dv.fat_g)}%` : ""}</span>
                  </div>
                  <div className="nutrition-row sub" style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Saturated Fat {r.satFatG ?? 0}g</span>
                    <span className="val">{dv.sat_fat_g != null ? `${Math.round(dv.sat_fat_g)}%` : ""}</span>
                  </div>
                  <div className="nutrition-row sub" style={{ display: "flex", justifyContent: "space-between" }}>
                    <span><i>Trans</i> Fat {r.transFatG ?? 0}g</span>
                    <span className="val"></span>
                  </div>
                  <div className="nutrition-row major" style={{ display: "flex", justifyContent: "space-between" }}>
                    <span><b>Cholesterol</b> {r.cholesterolMg ?? 0}mg</span>
                    <span className="val">{dv.cholesterol_mg != null ? `${Math.round(dv.cholesterol_mg)}%` : ""}</span>
                  </div>
                  <div className="nutrition-row major" style={{ display: "flex", justifyContent: "space-between" }}>
                    <span><b>Sodium</b> {r.sodiumMg ?? 0}mg</span>
                    <span className="val">{dv.sodium_mg != null ? `${Math.round(dv.sodium_mg)}%` : ""}</span>
                  </div>
                  <div className="nutrition-row major" style={{ display: "flex", justifyContent: "space-between" }}>
                    <span><b>Total Carbohydrate</b> {r.carbG ?? 0}g</span>
                    <span className="val">{dv.carb_g != null ? `${Math.round(dv.carb_g)}%` : ""}</span>
                  </div>
                  <div className="nutrition-row sub" style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Dietary Fiber {r.fiberG ?? 0}g</span>
                    <span className="val">{dv.fiber_g != null ? `${Math.round(dv.fiber_g)}%` : ""}</span>
                  </div>
                  <div className="nutrition-row sub" style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Total Sugars {r.sugarsG ?? 0}g</span>
                    <span className="val"></span>
                  </div>
                  <div className="nutrition-row sub" style={{ display: "flex", justifyContent: "space-between", paddingLeft: "var(--sp-6)" }}>
                    <span>Includes {r.addedSugarsG ?? 0}g Added Sugars</span>
                    <span className="val">{dv.added_sugars_g != null ? `${Math.round(dv.added_sugars_g)}%` : ""}</span>
                  </div>
                  <div className="nutrition-row major" style={{ display: "flex", justifyContent: "space-between" }}>
                    <span><b>Protein</b> {r.proteinG ?? 0}g</span>
                    <span className="val">{dv.protein_g != null ? `${Math.round(dv.protein_g)}%` : ""}</span>
                  </div>
                  <div style={{ borderTop: "8px solid currentColor", margin: "0 var(--sp-3)" }}></div>
                  <div style={{ padding: "var(--sp-2) var(--sp-3)", fontSize: 10, lineHeight: 1.4, opacity: 0.55, borderTop: "1px solid var(--c-border-light)" }}>
                    * The % Daily Value (DV) tells you how much a nutrient in a serving of food contributes to a daily diet. 2,000 calories a day is used for general nutrition advice.
                  </div>
                </>
              ) : nutrientDataset ? (
                <div style={{ padding: "var(--sp-4)" }}>
                  <p className="label-text" style={{ marginBottom: "var(--sp-3)" }}>
                    Full Nutrient Profile ({nutrientDataset.label})
                  </p>
                  <div style={{ maxHeight: 520, overflow: "auto", border: "1px solid var(--c-border-light)", borderRadius: 10 }}>
                    {nutrients.map((row) => (
                      <div
                        key={row.key}
                        className="nutrition-row"
                        style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
                      >
                        <span>{nutrientLabel(row.key)}</span>
                        <span className="val">
                          {formatNutrientValue(row.value)} {nutrientUnit(row.key)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ padding: "var(--sp-6)", textAlign: "center" }}>
                  <span className="label-text">No FDA nutrition data for this label type.</span>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="stack">
          <div className="card">
            <div className="card-header">
              <h3>Ingredients</h3>
            </div>
            <p style={{ fontSize: "var(--text-sm)", lineHeight: "var(--leading-relaxed)" }}>
              {payload.ingredientDeclaration ?? "No ingredient declaration on this label."}
            </p>
          </div>

          {recipeLines.length > 0 ? (
            <div className="card">
              <div className="card-header">
                <h3>Recipe</h3>
                <span className="badge badge-neutral">Per Serving</span>
              </div>
              {recipeGroups.map((group) => (
                <div key={group.category} style={{ marginBottom: 8 }}>
                  <div style={{
                    fontSize: "var(--text-xs)",
                    fontWeight: 600,
                    color: "var(--c-ink-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: 2,
                    padding: "0 var(--sp-3)",
                  }}>
                    {group.label}
                  </div>
                  {group.items.map((line, idx) => (
                    <div
                      key={idx}
                      className="nutrition-row"
                      style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-sm)" }}
                    >
                      <span>
                        {line.ingredientName}
                        {line.preparation ? (
                          <span style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)", marginLeft: 4 }}>
                            ({line.preparation})
                          </span>
                        ) : null}
                      </span>
                      <span className="val">{line.gramsPerServing.toFixed(1)}g</span>
                    </div>
                  ))}
                </div>
              ))}
              <div
                className="nutrition-row"
                style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-sm)", fontWeight: 600, borderTop: "2px solid var(--c-border-light)", marginTop: 4, paddingTop: 6 }}
              >
                <span>Total</span>
                <span className="val">{recipeLines.reduce((s, l) => s + l.gramsPerServing, 0).toFixed(1)}g</span>
              </div>
            </div>
          ) : null}

          <div className="card">
            <div className="card-header">
              <h3>Allergens</h3>
              {payload.allergenStatement && (
                <span className="badge badge-warn">Contains Allergens</span>
              )}
            </div>
            <p style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>
              {payload.allergenStatement ?? "No allergen statement."}
            </p>
          </div>

          <div className="card">
            <div className="card-header">
              <h3>Macro QA Check</h3>
              {payload.qa && (
                <span className={`badge ${payload.qa.pass ? "badge-success" : "badge-danger"}`}>
                  {payload.qa.pass ? "PASS" : "CHECK"}
                </span>
              )}
            </div>
            {payload.qa ? (
              <div className="qa-block">
                <div className="qa-metric">
                  <div className="qa-metric-value">{payload.qa.macroKcal?.toFixed(0) ?? "?"}</div>
                  <div className="qa-metric-label">Macro kcal</div>
                </div>
                <div className="qa-metric">
                  <div className="qa-metric-value">{payload.qa.labeledCalories ?? "?"}</div>
                  <div className="qa-metric-label">Labeled kcal</div>
                </div>
                <div className="qa-metric">
                  <div className="qa-metric-value">{payload.qa.delta?.toFixed(1) ?? "?"}</div>
                  <div className="qa-metric-label">Delta</div>
                </div>
              </div>
            ) : (
              <p className="label-text">No QA data available.</p>
            )}
          </div>

        </section>
      </div>


    </div>
  );
}
