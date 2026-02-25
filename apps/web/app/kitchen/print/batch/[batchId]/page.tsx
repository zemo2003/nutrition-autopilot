import Link from "next/link";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ??
  process.env.API_BASE ??
  "http://localhost:4000";

type Ingredient = {
  name: string;
  targetGPer100g: number | null;
  preparation: string | null;
  state: string | null;
};

type Checkpoint = {
  label: string;
  checked?: boolean;
};

type BatchSheet = {
  batchId: string;
  batchCode: string | null;
  date: string;
  componentName: string;
  componentType: string;
  ingredients: Ingredient[];
  rawInputG: number;
  expectedYieldG: number;
  portionSizeG: number | null;
  portionCount: number | null;
  checkpoints: Checkpoint[];
  steps: string[];
  cookTempC: number | null;
  cookTimeMin: number | null;
  notes: string | null;
};

async function getBatchSheet(batchId: string): Promise<BatchSheet | null> {
  try {
    const res = await fetch(`${API_BASE}/v1/print/batch-sheet/${batchId}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export default async function PrintBatchSheetPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  const sheet = await getBatchSheet(batchId);

  if (!sheet) {
    return (
      <div className="page-shell">
        <div className="card">
          <div className="state-box">
            <div className="state-icon">!</div>
            <div className="state-title">Batch Not Found</div>
            <div className="state-desc">
              Could not load batch sheet for ID: {batchId}
            </div>
            <Link href="/batch-prep" className="btn btn-primary mt-4">
              Back to Batch Prep
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const printStyles: React.CSSProperties = {
    background: "white",
    color: "black",
    padding: "24px",
    fontFamily: "system-ui, -apple-system, sans-serif",
    maxWidth: "800px",
    margin: "0 auto",
    lineHeight: 1.5,
  };

  const headerStyles: React.CSSProperties = {
    borderBottom: "3px solid black",
    paddingBottom: "12px",
    marginBottom: "20px",
  };

  const tableStyles: React.CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    marginBottom: "20px",
    fontSize: "13px",
  };

  const thStyles: React.CSSProperties = {
    textAlign: "left",
    padding: "8px 10px",
    borderBottom: "2px solid black",
    fontWeight: 700,
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  };

  const tdStyles: React.CSSProperties = {
    padding: "6px 10px",
    borderBottom: "1px solid #d4d4d4",
    verticalAlign: "top",
  };

  const sectionTitleStyles: React.CSSProperties = {
    fontSize: "14px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    borderBottom: "2px solid black",
    paddingBottom: "4px",
    marginBottom: "10px",
    marginTop: "24px",
  };

  const checkboxRowStyles: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "4px 0",
    fontSize: "13px",
  };

  const checkboxStyles: React.CSSProperties = {
    width: "16px",
    height: "16px",
    border: "2px solid black",
    borderRadius: "2px",
    flexShrink: 0,
  };

  const blankLineStyles: React.CSSProperties = {
    borderBottom: "1px solid #aaa",
    height: "28px",
    marginBottom: "4px",
  };

  return (
    <div className="print-sheet" style={printStyles}>
      {/* No-print controls */}
      <div
        className="no-print"
        style={{
          marginBottom: "20px",
          display: "flex",
          gap: "8px",
          alignItems: "center",
        }}
      >
        <button
          onClick={() => {}}
          className="btn btn-primary btn-sm"
          style={{ background: "#34d399", color: "#0a0a0b", cursor: "pointer" }}
        >
          Print
        </button>
        <Link
          href="/batch-prep"
          style={{ fontSize: "13px", color: "#34d399" }}
        >
          Back to Batch Prep
        </Link>
      </div>

      {/* Header */}
      <div style={headerStyles}>
        <h1
          style={{
            fontSize: "24px",
            fontWeight: 900,
            margin: 0,
            textTransform: "uppercase",
            letterSpacing: "0.02em",
          }}
        >
          Batch Prep Sheet
        </h1>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: "8px",
            fontSize: "13px",
          }}
        >
          <span>
            <strong>Date:</strong> {formatDate(sheet.date)}
          </span>
          <span>
            <strong>Batch Code:</strong> {sheet.batchCode ?? "N/A"}
          </span>
        </div>
      </div>

      {/* Component Info */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", gap: "16px", alignItems: "baseline" }}>
          <h2
            style={{ fontSize: "18px", fontWeight: 700, margin: 0 }}
          >
            {sheet.componentName}
          </h2>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              padding: "2px 8px",
              border: "1px solid black",
              borderRadius: "3px",
            }}
          >
            {sheet.componentType.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      {/* Ingredients Table */}
      <div style={sectionTitleStyles}>Ingredients</div>
      <table style={tableStyles}>
        <thead>
          <tr>
            <th style={thStyles}>Name</th>
            <th style={thStyles}>Target g/100g</th>
            <th style={thStyles}>Preparation</th>
            <th style={thStyles}>State</th>
          </tr>
        </thead>
        <tbody>
          {sheet.ingredients.map((ing, i) => (
            <tr key={i}>
              <td style={tdStyles}>{ing.name}</td>
              <td style={tdStyles}>
                {ing.targetGPer100g !== null
                  ? `${ing.targetGPer100g.toFixed(1)}`
                  : "\u2014"}
              </td>
              <td style={tdStyles}>{ing.preparation ?? "\u2014"}</td>
              <td style={tdStyles}>{ing.state ?? "\u2014"}</td>
            </tr>
          ))}
          {sheet.ingredients.length === 0 && (
            <tr>
              <td style={tdStyles} colSpan={4}>
                No ingredients listed
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Yield & Portion Info */}
      <div style={sectionTitleStyles}>Yield &amp; Portions</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "12px",
          marginBottom: "20px",
          fontSize: "13px",
        }}
      >
        <div>
          <strong>Raw Input:</strong> {sheet.rawInputG.toFixed(0)} g
        </div>
        <div>
          <strong>Expected Yield:</strong> {sheet.expectedYieldG.toFixed(0)} g
        </div>
        <div>
          <strong>Portion Size:</strong>{" "}
          {sheet.portionSizeG !== null
            ? `${sheet.portionSizeG.toFixed(0)} g`
            : "\u2014"}
        </div>
        <div>
          <strong>Portion Count:</strong>{" "}
          {sheet.portionCount !== null ? sheet.portionCount : "\u2014"}
        </div>
      </div>

      {/* Temperature / Time */}
      <div style={sectionTitleStyles}>Temperature &amp; Time</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "12px",
          marginBottom: "20px",
          fontSize: "13px",
        }}
      >
        <div>
          <strong>Cook Temp:</strong>{" "}
          {sheet.cookTempC !== null ? (
            `${sheet.cookTempC}\u00B0C`
          ) : (
            <span style={{ display: "inline-block", width: "80px" }}>
              <span style={blankLineStyles} />
            </span>
          )}
          {" \u00B0C"}
        </div>
        <div>
          <strong>Cook Time:</strong>{" "}
          {sheet.cookTimeMin !== null ? (
            `${sheet.cookTimeMin} min`
          ) : (
            <span style={{ display: "inline-block", width: "80px" }}>
              <span style={blankLineStyles} />
            </span>
          )}
          {" min"}
        </div>
      </div>

      {/* Steps */}
      {sheet.steps.length > 0 && (
        <>
          <div style={sectionTitleStyles}>Steps</div>
          <ol
            style={{
              paddingLeft: "20px",
              marginBottom: "20px",
              fontSize: "13px",
            }}
          >
            {sheet.steps.map((step, i) => (
              <li key={i} style={{ padding: "3px 0" }}>
                {step}
              </li>
            ))}
          </ol>
        </>
      )}

      {/* Checkpoints */}
      {sheet.checkpoints.length > 0 && (
        <>
          <div style={sectionTitleStyles}>Checkpoints</div>
          <div style={{ marginBottom: "20px" }}>
            {sheet.checkpoints.map((cp, i) => (
              <div key={i} style={checkboxRowStyles}>
                <div style={checkboxStyles} />
                <span>{cp.label}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Notes Area */}
      <div style={sectionTitleStyles}>Notes</div>
      {sheet.notes && (
        <p style={{ fontSize: "13px", marginBottom: "8px", fontStyle: "italic" }}>
          {sheet.notes}
        </p>
      )}
      <div style={{ marginBottom: "20px" }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={blankLineStyles} />
        ))}
      </div>

      {/* Footer */}
      <div
        style={{
          borderTop: "2px solid black",
          paddingTop: "8px",
          fontSize: "10px",
          color: "#666",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>Numen Kitchen Ops</span>
        <span>Batch ID: {sheet.batchId}</span>
      </div>
    </div>
  );
}
