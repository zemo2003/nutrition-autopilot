import Link from "next/link";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ??
  process.env.API_BASE ??
  "http://localhost:4000";

type BatchRow = {
  batchCode: string | null;
  status: string;
  rawInputG: number;
  expectedYieldG: number;
  actualYieldG: number | null;
};

type TypeGroup = {
  componentType: string;
  batches: BatchRow[];
};

type DailySummary = {
  date: string;
  groups: TypeGroup[];
  totalBatches: number;
  completedCount: number;
  totalYieldG: number;
};

const TYPE_LABELS: Record<string, string> = {
  PROTEIN: "Protein",
  CARB_BASE: "Carb / Base",
  VEGETABLE: "Vegetable",
  SAUCE: "Sauce",
  CONDIMENT: "Condiment",
  OTHER: "Other",
};

async function getDailySummary(): Promise<DailySummary | null> {
  try {
    const res = await fetch(`${API_BASE}/v1/print/daily-summary?date=today`, {
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

function formatG(g: number): string {
  if (g >= 1000) return `${(g / 1000).toFixed(1)} kg`;
  return `${Math.round(g)} g`;
}

export default async function PrintDailySummaryPage() {
  const summary = await getDailySummary();

  if (!summary) {
    return (
      <div className="page-shell">
        <div className="card">
          <div className="state-box">
            <div className="state-icon">!</div>
            <div className="state-title">Summary Unavailable</div>
            <div className="state-desc">
              Could not load the daily batch summary. The API may be offline.
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
    marginBottom: "16px",
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

  const thRightStyles: React.CSSProperties = {
    ...thStyles,
    textAlign: "right",
  };

  const tdStyles: React.CSSProperties = {
    padding: "6px 10px",
    borderBottom: "1px solid #d4d4d4",
    verticalAlign: "top",
  };

  const tdRightStyles: React.CSSProperties = {
    ...tdStyles,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  };

  const groupTitleStyles: React.CSSProperties = {
    fontSize: "15px",
    fontWeight: 700,
    marginTop: "24px",
    marginBottom: "8px",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    borderBottom: "1px solid black",
    paddingBottom: "4px",
  };

  const typeOrder = ["PROTEIN", "CARB_BASE", "VEGETABLE", "SAUCE", "CONDIMENT", "OTHER"];

  const orderedGroups = typeOrder
    .map((type) => summary.groups.find((g) => g.componentType === type))
    .filter((g): g is TypeGroup => g !== undefined);

  // Include any groups not in the predefined order
  const extraGroups = summary.groups.filter(
    (g) => !typeOrder.includes(g.componentType)
  );

  const allGroups = [...orderedGroups, ...extraGroups];

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
          Daily Batch Summary
        </h1>
        <div style={{ marginTop: "8px", fontSize: "13px" }}>
          <strong>Date:</strong> {formatDate(summary.date)}
        </div>
      </div>

      {/* Groups */}
      {allGroups.map((group, gi) => (
        <div key={gi}>
          <div style={groupTitleStyles}>
            {TYPE_LABELS[group.componentType] ?? group.componentType}
            <span
              style={{
                fontSize: "12px",
                fontWeight: 400,
                marginLeft: "8px",
                textTransform: "none",
                letterSpacing: "normal",
              }}
            >
              ({group.batches.length} batch
              {group.batches.length !== 1 ? "es" : ""})
            </span>
          </div>
          <table style={tableStyles}>
            <thead>
              <tr>
                <th style={thStyles}>Batch</th>
                <th style={thStyles}>Status</th>
                <th style={thRightStyles}>Raw Input (g)</th>
                <th style={thRightStyles}>Expected Yield (g)</th>
                <th style={thRightStyles}>Actual Yield (g)</th>
              </tr>
            </thead>
            <tbody>
              {group.batches.map((batch, bi) => (
                <tr key={bi}>
                  <td style={tdStyles}>{batch.batchCode ?? "\u2014"}</td>
                  <td style={tdStyles}>{batch.status}</td>
                  <td style={tdRightStyles}>{batch.rawInputG.toFixed(0)}</td>
                  <td style={tdRightStyles}>
                    {batch.expectedYieldG.toFixed(0)}
                  </td>
                  <td style={tdRightStyles}>
                    {batch.actualYieldG !== null
                      ? batch.actualYieldG.toFixed(0)
                      : "\u2014"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {allGroups.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "40px 0",
            fontSize: "14px",
            color: "#666",
          }}
        >
          No batches scheduled for today.
        </div>
      )}

      {/* Summary Stats */}
      <div
        style={{
          borderTop: "3px solid black",
          paddingTop: "16px",
          marginTop: "24px",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "16px",
            textAlign: "center",
          }}
        >
          <div>
            <div
              style={{ fontSize: "28px", fontWeight: 900, lineHeight: 1 }}
            >
              {summary.totalBatches}
            </div>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase",
                marginTop: "4px",
                letterSpacing: "0.04em",
              }}
            >
              Total Batches
            </div>
          </div>
          <div>
            <div
              style={{ fontSize: "28px", fontWeight: 900, lineHeight: 1 }}
            >
              {summary.completedCount}
            </div>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase",
                marginTop: "4px",
                letterSpacing: "0.04em",
              }}
            >
              Completed
            </div>
          </div>
          <div>
            <div
              style={{ fontSize: "28px", fontWeight: 900, lineHeight: 1 }}
            >
              {formatG(summary.totalYieldG)}
            </div>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase",
                marginTop: "4px",
                letterSpacing: "0.04em",
              }}
            >
              Total Yield
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          borderTop: "1px solid #ccc",
          paddingTop: "8px",
          marginTop: "20px",
          fontSize: "10px",
          color: "#666",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>Numen Kitchen Ops</span>
        <span>
          Generated:{" "}
          {new Date().toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </div>
  );
}
