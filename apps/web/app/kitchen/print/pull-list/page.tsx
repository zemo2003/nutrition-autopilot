import Link from "next/link";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ??
  process.env.API_BASE ??
  "http://localhost:4000";

type PullItem = {
  ingredientName: string;
  quantityG: number;
  storageLocation: string | null;
  suggestedLot: string | null;
};

type PullGroup = {
  componentName: string;
  componentType: string;
  items: PullItem[];
};

type PullList = {
  dateFrom: string;
  dateTo: string;
  groups: PullGroup[];
  totalItems: number;
};

async function getPullList(): Promise<PullList | null> {
  try {
    const res = await fetch(`${API_BASE}/v1/print/pull-list?hoursAhead=24`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default async function PrintPullListPage() {
  const pullList = await getPullList();

  if (!pullList) {
    return (
      <div className="page-shell">
        <div className="card">
          <div className="state-box">
            <div className="state-icon">!</div>
            <div className="state-title">Pull List Unavailable</div>
            <div className="state-desc">
              Could not load the inventory pull list. The API may be offline.
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

  const tdStyles: React.CSSProperties = {
    padding: "6px 10px",
    borderBottom: "1px solid #d4d4d4",
    verticalAlign: "top",
  };

  const groupTitleStyles: React.CSSProperties = {
    fontSize: "15px",
    fontWeight: 700,
    marginTop: "24px",
    marginBottom: "8px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
  };

  const typeBadgeStyles: React.CSSProperties = {
    fontSize: "10px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    padding: "2px 8px",
    border: "1px solid black",
    borderRadius: "3px",
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
          Inventory Pull List
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
            <strong>From:</strong> {formatDateTime(pullList.dateFrom)}
          </span>
          <span>
            <strong>To:</strong> {formatDateTime(pullList.dateTo)}
          </span>
        </div>
      </div>

      {/* Groups */}
      {pullList.groups.map((group, gi) => (
        <div key={gi}>
          <div style={groupTitleStyles}>
            <span>{group.componentName}</span>
            <span style={typeBadgeStyles}>
              {group.componentType.replace(/_/g, " ")}
            </span>
          </div>
          <table style={tableStyles}>
            <thead>
              <tr>
                <th style={thStyles}>Ingredient</th>
                <th style={thStyles}>Qty Needed (g)</th>
                <th style={thStyles}>Storage Location</th>
                <th style={thStyles}>Suggested Lot</th>
              </tr>
            </thead>
            <tbody>
              {group.items.map((item, ii) => (
                <tr key={ii}>
                  <td style={tdStyles}>{item.ingredientName}</td>
                  <td style={tdStyles}>{item.quantityG.toFixed(0)}</td>
                  <td style={tdStyles}>{item.storageLocation ?? "\u2014"}</td>
                  <td style={tdStyles}>{item.suggestedLot ?? "\u2014"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {pullList.groups.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "40px 0",
            fontSize: "14px",
            color: "#666",
          }}
        >
          No items to pull for the next 24 hours.
        </div>
      )}

      {/* Summary */}
      <div
        style={{
          borderTop: "3px solid black",
          paddingTop: "12px",
          marginTop: "24px",
          fontSize: "14px",
          fontWeight: 700,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>
          Total Components: {pullList.groups.length}
        </span>
        <span>
          Total Items: {pullList.totalItems}
        </span>
      </div>

      {/* Footer */}
      <div
        style={{
          borderTop: "1px solid #ccc",
          paddingTop: "8px",
          marginTop: "16px",
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
