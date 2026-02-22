import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

type LabelPayload = {
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
};

type LineageNode = {
  labelId: string;
  labelType: string;
  title: string;
  children?: LineageNode[];
};

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
  const r = payload.roundedFda ?? {};

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
