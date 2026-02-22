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
      <Link href={`/labels/${node.labelId}`}>
        {node.labelType} - {node.title}
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
      <main>
        <h1>Label Not Found</h1>
        <Link href="/">Back</Link>
      </main>
    );
  }

  const payload = (label.renderPayload ?? {}) as LabelPayload;
  const rounded = payload.roundedFda ?? {};

  return (
    <main>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1>{label.title}</h1>
        <div className="row">
          <Link href={`/labels/${labelId}/print`}>Print View</Link>
          <Link href="/">Home</Link>
        </div>
      </div>

      <p>
        Type: <code>{label.labelType}</code> | Version: <code>{label.version}</code> | Frozen:{" "}
        <code>{label.frozenAt ? new Date(label.frozenAt).toLocaleString() : "n/a"}</code>
      </p>

      <section className="card">
        <h3>Nutrition Facts (Per Serving)</h3>
        {payload.roundedFda ? (
          <div className="nutrition-grid">
            <div>Calories</div>
            <div>{rounded.calories ?? 0}</div>
            <div>Total Fat</div>
            <div>{rounded.fatG ?? 0} g</div>
            <div>Sat Fat</div>
            <div>{rounded.satFatG ?? 0} g</div>
            <div>Trans Fat</div>
            <div>{rounded.transFatG ?? 0} g</div>
            <div>Cholesterol</div>
            <div>{rounded.cholesterolMg ?? 0} mg</div>
            <div>Sodium</div>
            <div>{rounded.sodiumMg ?? 0} mg</div>
            <div>Carbohydrate</div>
            <div>{rounded.carbG ?? 0} g</div>
            <div>Fiber</div>
            <div>{rounded.fiberG ?? 0} g</div>
            <div>Total Sugars</div>
            <div>{rounded.sugarsG ?? 0} g</div>
            <div>Added Sugars</div>
            <div>{rounded.addedSugarsG ?? 0} g</div>
            <div>Protein</div>
            <div>{rounded.proteinG ?? 0} g</div>
            <div>Serving Weight</div>
            <div>{payload.servingWeightG ? payload.servingWeightG.toFixed(1) : "n/a"} g</div>
          </div>
        ) : (
          <p>FDA payload is not present for this label type.</p>
        )}
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h3>Ingredient + Allergen Statements</h3>
        <p>{payload.ingredientDeclaration ?? "No ingredient declaration on this label."}</p>
        <p>{payload.allergenStatement ?? "No allergen statement on this label."}</p>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h3>Macro QA</h3>
        <p>
          Macro kcal: <code>{payload.qa?.macroKcal?.toFixed(1) ?? "n/a"}</code> | Labeled kcal:{" "}
          <code>{payload.qa?.labeledCalories ?? "n/a"}</code> | Delta:{" "}
          <code>{payload.qa?.delta?.toFixed(1) ?? "n/a"}</code> | Pass: <code>{String(payload.qa?.pass ?? "n/a")}</code>
        </p>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h3>Lineage Tree</h3>
        {lineage ? (
          <ul>
            <LineageTree node={lineage as LineageNode} />
          </ul>
        ) : (
          <p>No lineage edges.</p>
        )}
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h3>Raw Payload</h3>
        <pre>{JSON.stringify(label.renderPayload, null, 2)}</pre>
      </section>
    </main>
  );
}
