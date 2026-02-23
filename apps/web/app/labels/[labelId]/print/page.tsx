import Link from "next/link";
import { PrintButton } from "../../../../components/print-button";

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

export default async function PrintLabelPage({ params }: { params: Promise<{ labelId: string }> }) {
  const { labelId } = await params;
  const label = await getLabel(labelId);

  if (!label) {
    return (
      <div className="page-shell">
        <div className="card">
          <div className="state-box">
            <div className="state-icon">!</div>
            <div className="state-title">Label Not Found</div>
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
  const hasFda = Boolean(payload.roundedFda);
  const nutrientDataset = resolveNutrientDataset(payload);
  const nutrients = nutrientDataset ? orderedNutrients(nutrientDataset.values) : [];

  return (
    <div className="page-shell">
      <div className="page-header no-print">
        <div>
          <div className="breadcrumbs" style={{ marginBottom: 8 }}>
            <Link href="/">Dashboard</Link>
            <span className="sep">/</span>
            <Link href={`/labels/${labelId}`}>Label</Link>
            <span className="sep">/</span>
            <span className="current">Print</span>
          </div>
          <h1 className="page-title">Print Label</h1>
          <p className="page-subtitle">{label.title}</p>
        </div>
        <div className="page-header-actions">
          <PrintButton />
          {supersededByLabelId ? (
            <Link href={`/labels/${supersededByLabelId}/print`} className="btn btn-primary">
              Open Latest Print
            </Link>
          ) : null}
          <Link href={`/labels/${labelId}`} className="btn btn-outline">
            Back to Label
          </Link>
        </div>
      </div>

      {supersededByLabelId ? (
        <section className="card section no-print">
          <div className="card-header">
            <h3>Superseded Snapshot</h3>
            <span className="badge badge-warn">Outdated</span>
          </div>
          <p className="label-text">
            This print page is for an older immutable snapshot. Use the latest corrected snapshot for current reporting.
          </p>
        </section>
      ) : null}

      <section className="print-label">
        <div className="print-label-inner">
          {provisional ? (
            <div className="print-provisional-ribbon">
              Provisional Historical Label
            </div>
          ) : null}
          <div className="print-nf-title">Nutrition Facts</div>
          <div className="print-serving">
            Serving size {payload.servingWeightG ? `${payload.servingWeightG.toFixed(0)}g` : "n/a"}
          </div>
          {hasFda ? (
            <>
              <div className="print-amount-line">Amount per serving</div>

              <div className="print-calories-row">
                <span className="print-calories-label">Calories</span>
                <span className="print-calories-value">{r.calories ?? 0}</span>
              </div>

              <div className="print-dv-header">% Daily Value*</div>

              <div className="print-row major">
                <span><strong>Total Fat</strong> {r.fatG ?? 0}g</span>
              </div>
              <div className="print-row sub">
                <span>Saturated Fat {r.satFatG ?? 0}g</span>
              </div>
              <div className="print-row sub">
                <span><em>Trans</em> Fat {r.transFatG ?? 0}g</span>
              </div>
              <div className="print-row major">
                <span><strong>Cholesterol</strong> {r.cholesterolMg ?? 0}mg</span>
              </div>
              <div className="print-row major">
                <span><strong>Sodium</strong> {r.sodiumMg ?? 0}mg</span>
              </div>
              <div className="print-row major">
                <span><strong>Total Carbohydrate</strong> {r.carbG ?? 0}g</span>
              </div>
              <div className="print-row sub">
                <span>Dietary Fiber {r.fiberG ?? 0}g</span>
              </div>
              <div className="print-row sub">
                <span>Total Sugars {r.sugarsG ?? 0}g</span>
              </div>
              <div className="print-row sub">
                <span>Includes {r.addedSugarsG ?? 0}g Added Sugars</span>
              </div>
              <div className="print-row major thick-top">
                <span><strong>Protein</strong> {r.proteinG ?? 0}g</span>
              </div>

              <div className="print-footer">
                * The % Daily Value tells you how much a nutrient in a serving
                of food contributes to a daily diet. 2,000 calories a day is
                used for general nutrition advice.
              </div>
            </>
          ) : (
            <div className="print-row major">
              <span><strong>{label.labelType}</strong> label uses scientific nutrient map ({nutrientDataset?.label ?? "n/a"}).</span>
            </div>
          )}

          {nutrientDataset ? (
            <div style={{ marginTop: 16 }}>
              <div className="print-row major">
                <span><strong>Full Nutrient Profile ({nutrientDataset.label})</strong></span>
              </div>
              <div style={{ border: "1px solid #111", borderRadius: 4 }}>
                {nutrients.map((row) => (
                  <div
                    key={row.key}
                    className="print-row"
                    style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
                  >
                    <span>{nutrientLabel(row.key)}</span>
                    <span>{formatNutrientValue(row.value)} {nutrientUnit(row.key)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="print-ingredients">
            <strong>INGREDIENTS:</strong>{" "}
            {payload.ingredientDeclaration ?? "n/a"}
          </div>

          {payload.allergenStatement && (
            <div className="print-allergens">
              <strong>CONTAINS:</strong> {payload.allergenStatement}
            </div>
          )}

          <div className="print-qa">
            QA: {payload.qa ? (payload.qa.pass ? "PASS" : "CHECK") : "n/a"} (delta{" "}
            {payload.qa?.delta?.toFixed(1) ?? "n/a"} kcal)
          </div>

          {evidence ? (
            <div className="print-evidence">
              Evidence: verified {evidence.verifiedCount ?? 0} | inferred {evidence.inferredCount ?? 0} | exceptions {evidence.exceptionCount ?? 0} | unverified {evidence.unverifiedCount ?? 0}
            </div>
          ) : null}

          {reasonCodes.length ? (
            <div className="print-reason-codes">
              {reasonCodes.join(" | ")}
            </div>
          ) : null}

          <div className="print-label-id">
            {label.title} | ID: {label.id} | v{label.version}
          </div>
        </div>
      </section>
    </div>
  );
}
