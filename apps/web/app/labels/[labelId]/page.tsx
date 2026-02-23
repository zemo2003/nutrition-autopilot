import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

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

type LineageNode = {
  labelId: string;
  labelType: string;
  title: string;
  children?: LineageNode[];
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

async function getLabel(labelId: string) {
  const response = await fetch(`${API_BASE}/v1/labels/${labelId}`, { cache: "no-store" });
  if (!response.ok) return null;
  return response.json();
}

async function getLineage(labelId: string) {
  const response = await fetch(`${API_BASE}/v1/labels/${labelId}/lineage`, { cache: "no-store" });
  if (!response.ok) return null;
  return response.json();
}

function LineageTree({ node }: { node: LineageNode }) {
  return (
    <li>
      <Link href={`/labels/${node.labelId}`} className="lineage-node">
        <span className="lineage-type">{node.labelType}</span>
        {node.title}
      </Link>
      {node.children?.length ? (
        <ul>
          {node.children.map((child) => (
            <LineageTree key={child.labelId} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default async function LabelPage({ params }: { params: Promise<{ labelId: string }> }) {
  const { labelId } = await params;
  const [label, lineage] = await Promise.all([getLabel(labelId), getLineage(labelId)]);

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
  const evidence = payload.evidenceSummary ?? (label.evidenceSummary as LabelPayload["evidenceSummary"]);
  const provisional = Boolean(label.provisional ?? payload.provisional ?? evidence?.provisional);
  const supersededByLabelId =
    typeof label.supersededByLabelId === "string" && label.supersededByLabelId.length > 0
      ? label.supersededByLabelId
      : null;
  const reasonCodes = payload.reasonCodes ?? [];
  const r = payload.roundedFda ?? {};
  const dv = payload.percentDV ?? {};
  const nutrientDataset = resolveNutrientDataset(payload);
  const nutrients = nutrientDataset ? orderedNutrients(nutrientDataset.values) : [];

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

      {provisional ? (
        <section className="card section">
          <div className="card-header">
            <h3>Evidence Warnings</h3>
            <span className="badge badge-warn">Provisional</span>
          </div>
          <div className="row">
            {reasonCodes.length ? (
              reasonCodes.map((code) => (
                <span key={code} className="tag">
                  {code}
                </span>
              ))
            ) : (
              <span className="label-text">No reason codes provided.</span>
            )}
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

          {payload.plausibility ? (
            <div className="card">
              <div className="card-header">
                <h3>Plausibility Check</h3>
                {payload.plausibility.valid
                  ? <span className="badge badge-success">Valid</span>
                  : <span className="badge badge-danger">{payload.plausibility.errorCount ?? 0} Error{(payload.plausibility.errorCount ?? 0) !== 1 ? "s" : ""}</span>
                }
              </div>
              <div className="qa-block">
                <div className="qa-metric">
                  <div className="qa-metric-value">{payload.plausibility.errorCount ?? 0}</div>
                  <div className="qa-metric-label">Errors</div>
                </div>
                <div className="qa-metric">
                  <div className="qa-metric-value">{payload.plausibility.warningCount ?? 0}</div>
                  <div className="qa-metric-label">Warnings</div>
                </div>
              </div>
              {payload.plausibility.issues?.length ? (
                <div style={{ padding: "0 var(--sp-4) var(--sp-4)", maxHeight: 200, overflow: "auto" }}>
                  {payload.plausibility.issues.map((issue, idx) => (
                    <div key={idx} style={{
                      padding: "var(--sp-2) var(--sp-3)",
                      marginBottom: 4,
                      borderRadius: 6,
                      fontSize: "var(--text-sm)",
                      backgroundColor: issue.severity === "ERROR" ? "rgba(239,68,68,0.08)" : "rgba(245,158,11,0.08)",
                      borderLeft: `3px solid ${issue.severity === "ERROR" ? "var(--danger)" : "var(--warning, #f59e0b)"}`
                    }}>
                      {issue.message}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="card">
            <div className="card-header">
              <h3>Evidence Summary</h3>
              {evidence?.provisional ? <span className="badge badge-warn">Needs Review</span> : <span className="badge badge-success">Stable</span>}
            </div>
            {evidence ? (
              <div className="qa-block">
                <div className="qa-metric">
                  <div className="qa-metric-value">{evidence.verifiedCount ?? 0}</div>
                  <div className="qa-metric-label">Verified</div>
                </div>
                <div className="qa-metric">
                  <div className="qa-metric-value">{evidence.inferredCount ?? 0}</div>
                  <div className="qa-metric-label">Inferred</div>
                </div>
                <div className="qa-metric">
                  <div className="qa-metric-value">{evidence.exceptionCount ?? 0}</div>
                  <div className="qa-metric-label">Exceptions</div>
                </div>
                <div className="qa-metric">
                  <div className="qa-metric-value">{evidence.unverifiedCount ?? 0}</div>
                  <div className="qa-metric-label">Unverified</div>
                </div>
              </div>
            ) : (
              <p className="label-text">No evidence summary available.</p>
            )}
          </div>
        </section>
      </div>

      {payload.ingredientBreakdown?.length ? (
        <section className="section mt-8">
          <div className="card">
            <div className="card-header">
              <h3>Ingredient Breakdown</h3>
              <span className="badge badge-neutral">Per Serving</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--c-border-light)", textAlign: "left" }}>
                    <th style={{ padding: "var(--sp-3) var(--sp-4)", fontWeight: 600 }}>Ingredient</th>
                    <th style={{ padding: "var(--sp-3) var(--sp-4)", fontWeight: 600, textAlign: "right" }}>Grams</th>
                    <th style={{ padding: "var(--sp-3) var(--sp-4)", fontWeight: 600, textAlign: "right" }}>% of Serving</th>
                    <th style={{ padding: "var(--sp-3) var(--sp-4)", fontWeight: 600, textAlign: "right" }}>Calories</th>
                    <th style={{ padding: "var(--sp-3) var(--sp-4)", fontWeight: 600, textAlign: "right" }}>Protein</th>
                    <th style={{ padding: "var(--sp-3) var(--sp-4)", fontWeight: 600, textAlign: "right" }}>Carbs</th>
                    <th style={{ padding: "var(--sp-3) var(--sp-4)", fontWeight: 600, textAlign: "right" }}>Fat</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.ingredientBreakdown.map((ing, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid var(--c-border-light)" }}>
                      <td style={{ padding: "var(--sp-3) var(--sp-4)", fontWeight: 500 }}>{ing.ingredientName}</td>
                      <td style={{ padding: "var(--sp-3) var(--sp-4)", textAlign: "right" }}>{ing.gramsPerServing.toFixed(1)}g</td>
                      <td style={{ padding: "var(--sp-3) var(--sp-4)", textAlign: "right" }}>{ing.percentOfServing.toFixed(1)}%</td>
                      <td style={{ padding: "var(--sp-3) var(--sp-4)", textAlign: "right" }}>{ing.nutrientHighlights.kcal.toFixed(0)} kcal</td>
                      <td style={{ padding: "var(--sp-3) var(--sp-4)", textAlign: "right" }}>{ing.nutrientHighlights.protein_g.toFixed(1)}g</td>
                      <td style={{ padding: "var(--sp-3) var(--sp-4)", textAlign: "right" }}>{ing.nutrientHighlights.carb_g.toFixed(1)}g</td>
                      <td style={{ padding: "var(--sp-3) var(--sp-4)", textAlign: "right" }}>{ing.nutrientHighlights.fat_g.toFixed(1)}g</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: "2px solid var(--c-border-light)", fontWeight: 600 }}>
                    <td style={{ padding: "var(--sp-3) var(--sp-4)" }}>Total</td>
                    <td style={{ padding: "var(--sp-3) var(--sp-4)", textAlign: "right" }}>
                      {payload.ingredientBreakdown.reduce((s, i) => s + i.gramsPerServing, 0).toFixed(1)}g
                    </td>
                    <td style={{ padding: "var(--sp-3) var(--sp-4)", textAlign: "right" }}>100.0%</td>
                    <td style={{ padding: "var(--sp-3) var(--sp-4)", textAlign: "right" }}>
                      {payload.ingredientBreakdown.reduce((s, i) => s + i.nutrientHighlights.kcal, 0).toFixed(0)} kcal
                    </td>
                    <td style={{ padding: "var(--sp-3) var(--sp-4)", textAlign: "right" }}>
                      {payload.ingredientBreakdown.reduce((s, i) => s + i.nutrientHighlights.protein_g, 0).toFixed(1)}g
                    </td>
                    <td style={{ padding: "var(--sp-3) var(--sp-4)", textAlign: "right" }}>
                      {payload.ingredientBreakdown.reduce((s, i) => s + i.nutrientHighlights.carb_g, 0).toFixed(1)}g
                    </td>
                    <td style={{ padding: "var(--sp-3) var(--sp-4)", textAlign: "right" }}>
                      {payload.ingredientBreakdown.reduce((s, i) => s + i.nutrientHighlights.fat_g, 0).toFixed(1)}g
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div style={{ padding: "var(--sp-4)", display: "flex", gap: 4, height: 32, borderRadius: 8, overflow: "hidden" }}>
              {payload.ingredientBreakdown.map((ing, idx) => {
                const colors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];
                return (
                  <div
                    key={idx}
                    style={{
                      flex: ing.percentOfServing,
                      backgroundColor: colors[idx % colors.length],
                      borderRadius: 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "white",
                      fontSize: 11,
                      fontWeight: 600,
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      padding: "0 4px"
                    }}
                    title={`${ing.ingredientName}: ${ing.gramsPerServing.toFixed(1)}g (${ing.percentOfServing.toFixed(1)}%)`}
                  >
                    {ing.percentOfServing > 10 ? ing.ingredientName : ""}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      <section className="section mt-8">
        <div className="card">
          <div className="card-header">
            <h3>Label Lineage</h3>
            <span className="badge badge-neutral">Immutable</span>
          </div>
          {lineage ? (
            <ul className="lineage-tree">
              <LineageTree node={lineage as LineageNode} />
            </ul>
          ) : (
            <p className="label-text">No lineage edges recorded for this label.</p>
          )}
        </div>
      </section>

      <section className="section">
        <details className="card">
          <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "var(--text-sm)" }}>
            Raw Payload (JSON)
          </summary>
          <pre className="mt-4">{JSON.stringify(label.renderPayload, null, 2)}</pre>
        </details>
      </section>
    </div>
  );
}
