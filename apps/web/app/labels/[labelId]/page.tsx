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
};

type LineageNode = {
  labelId: string;
  labelType: string;
  title: string;
  children?: LineageNode[];
};

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
  "vitamin_d_mcg",
  "calcium_mg",
  "iron_mg",
  "potassium_mg",
  "vitamin_a_mcg",
  "vitamin_c_mg",
  "vitamin_e_mg",
  "vitamin_k_mcg",
  "thiamin_mg",
  "riboflavin_mg",
  "niacin_mg",
  "vitamin_b6_mg",
  "folate_mcg",
  "vitamin_b12_mcg",
  "biotin_mcg",
  "pantothenic_acid_mg",
  "phosphorus_mg",
  "iodine_mcg",
  "magnesium_mg",
  "zinc_mg",
  "selenium_mcg",
  "copper_mg",
  "manganese_mg",
  "chromium_mcg",
  "molybdenum_mcg",
  "chloride_mg",
  "choline_mg",
  "omega3_g",
  "omega6_g",
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
  const ordered = nutrientOrder
    .filter((key) => typeof values[key] === "number" && Number.isFinite(values[key]!))
    .map((key) => ({ key, value: values[key]! }));
  const extras = Object.entries(values)
    .filter(([key, value]) => !nutrientOrder.includes(key as any) && typeof value === "number" && Number.isFinite(value))
    .map(([key, value]) => ({ key, value: value as number }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return [...ordered, ...extras];
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
  const reasonCodes = payload.reasonCodes ?? [];
  const r = payload.roundedFda ?? {};
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
                  <div className="nutrition-row calories">
                    <span>Calories</span>
                    <span className="val">{r.calories ?? 0}</span>
                  </div>
                  <div className="nutrition-row major">
                    <span>Total Fat</span>
                    <span className="val">{r.fatG ?? 0}g</span>
                  </div>
                  <div className="nutrition-row sub">
                    <span>Saturated Fat</span>
                    <span className="val">{r.satFatG ?? 0}g</span>
                  </div>
                  <div className="nutrition-row sub">
                    <span>Trans Fat</span>
                    <span className="val">{r.transFatG ?? 0}g</span>
                  </div>
                  <div className="nutrition-row major">
                    <span>Cholesterol</span>
                    <span className="val">{r.cholesterolMg ?? 0}mg</span>
                  </div>
                  <div className="nutrition-row major">
                    <span>Sodium</span>
                    <span className="val">{r.sodiumMg ?? 0}mg</span>
                  </div>
                  <div className="nutrition-row major">
                    <span>Total Carbohydrate</span>
                    <span className="val">{r.carbG ?? 0}g</span>
                  </div>
                  <div className="nutrition-row sub">
                    <span>Dietary Fiber</span>
                    <span className="val">{r.fiberG ?? 0}g</span>
                  </div>
                  <div className="nutrition-row sub">
                    <span>Total Sugars</span>
                    <span className="val">{r.sugarsG ?? 0}g</span>
                  </div>
                  <div className="nutrition-row sub">
                    <span>Added Sugars</span>
                    <span className="val">{r.addedSugarsG ?? 0}g</span>
                  </div>
                  <div className="nutrition-row major">
                    <span>Protein</span>
                    <span className="val">{r.proteinG ?? 0}g</span>
                  </div>
                </>
              ) : nutrientDataset ? (
                <div style={{ padding: "var(--sp-4)" }}>
                  <p className="label-text" style={{ marginBottom: "var(--sp-3)" }}>
                    Full Nutrient Profile ({nutrientDataset.label})
                  </p>
                  <div style={{ maxHeight: 520, overflow: "auto", border: "1px solid var(--line-soft)", borderRadius: 10 }}>
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
