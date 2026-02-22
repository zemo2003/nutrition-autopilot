import Link from "next/link";
import { PrintButton } from "../../../../components/print-button";

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

async function getLabel(labelId: string) {
  const response = await fetch(`${API_BASE}/v1/labels/${labelId}`, { cache: "no-store" });
  if (!response.ok) return null;
  return response.json();
}

export default async function PrintLabelPage({ params }: { params: Promise<{ labelId: string }> }) {
  const { labelId } = await params;
  const label = await getLabel(labelId);

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
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Printable Label</h1>
        <div className="row">
          <PrintButton />
          <Link href={`/labels/${labelId}`}>Back to Label</Link>
        </div>
      </div>

      <section className="print-label">
        <h2 style={{ margin: 0 }}>Nutrition Facts</h2>
        <p style={{ marginTop: 4 }}>
          <strong>{label.title}</strong>
        </p>
        <div className="print-divider" />

        <div className="print-row print-calories">
          <span>Calories</span>
          <span>{rounded.calories ?? 0}</span>
        </div>
        <div className="print-divider thick" />

        <div className="print-row">
          <span>Total Fat</span>
          <span>{rounded.fatG ?? 0}g</span>
        </div>
        <div className="print-row">
          <span>Saturated Fat</span>
          <span>{rounded.satFatG ?? 0}g</span>
        </div>
        <div className="print-row">
          <span>Trans Fat</span>
          <span>{rounded.transFatG ?? 0}g</span>
        </div>
        <div className="print-row">
          <span>Cholesterol</span>
          <span>{rounded.cholesterolMg ?? 0}mg</span>
        </div>
        <div className="print-row">
          <span>Sodium</span>
          <span>{rounded.sodiumMg ?? 0}mg</span>
        </div>
        <div className="print-row">
          <span>Total Carbohydrate</span>
          <span>{rounded.carbG ?? 0}g</span>
        </div>
        <div className="print-row">
          <span>Dietary Fiber</span>
          <span>{rounded.fiberG ?? 0}g</span>
        </div>
        <div className="print-row">
          <span>Total Sugars</span>
          <span>{rounded.sugarsG ?? 0}g</span>
        </div>
        <div className="print-row">
          <span>Added Sugars</span>
          <span>{rounded.addedSugarsG ?? 0}g</span>
        </div>
        <div className="print-row">
          <span>Protein</span>
          <span>{rounded.proteinG ?? 0}g</span>
        </div>
        <div className="print-divider thick" />
        <p>Serving size: {payload.servingWeightG ? payload.servingWeightG.toFixed(1) : "n/a"} g</p>
        <p>{payload.ingredientDeclaration ?? "Ingredients: n/a"}</p>
        <p>{payload.allergenStatement ?? "Contains: n/a"}</p>
        <p>
          QA: {payload.qa?.pass ? "PASS" : "CHECK"} (delta {payload.qa?.delta?.toFixed(1) ?? "n/a"} kcal)
        </p>
        <p>
          Label ID: <code>{label.id}</code> | Version: <code>{label.version}</code>
        </p>
      </section>
    </main>
  );
}
