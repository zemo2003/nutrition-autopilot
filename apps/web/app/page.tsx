import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

type SystemState = {
  hasCommittedSot: boolean;
  counts: {
    activeSkus: number;
    activeIngredients: number;
    lotsOnHand: number;
    schedules: number;
    servedMeals: number;
    labels: number;
    openVerificationTasks: number;
  };
};

type Client = {
  id: string;
  name: string;
  externalRef?: string;
};

type QualitySummary = {
  month: string;
  coverage: {
    productFull40CoverageRatio: number;
    finalLabelFull40CoverageRatio: number;
  };
  evidence: {
    inferredRows: number;
    exceptionRows: number;
    floorRows: number;
    provisionalLabels: number;
  };
  totals: {
    openVerificationTasks: number;
    criticalOrHighVerificationTasks: number;
  };
};

async function getState() {
  try {
    const response = await fetch(`${API_BASE}/v1/system/state`, { cache: "no-store" });
    if (!response.ok) return null;
    const json = (await response.json()) as Partial<SystemState>;
    if (!json || typeof json !== "object") return null;
    return {
      hasCommittedSot: Boolean(json.hasCommittedSot),
      counts: {
        activeSkus: Number(json.counts?.activeSkus ?? 0),
        activeIngredients: Number(json.counts?.activeIngredients ?? 0),
        lotsOnHand: Number(json.counts?.lotsOnHand ?? 0),
        schedules: Number(json.counts?.schedules ?? 0),
        servedMeals: Number(json.counts?.servedMeals ?? 0),
        labels: Number(json.counts?.labels ?? 0),
        openVerificationTasks: Number(json.counts?.openVerificationTasks ?? 0),
      },
    } satisfies SystemState;
  } catch {
    return null;
  }
}

async function getClients() {
  try {
    const response = await fetch(`${API_BASE}/v1/clients`, { cache: "no-store" });
    if (!response.ok) return [];
    const json = (await response.json()) as {
      clients?: Array<{ id?: string; fullName?: string; externalRef?: string }>;
    };
    return (json.clients ?? [])
      .filter((client) => typeof client.id === "string" && typeof client.fullName === "string")
      .map((client) => ({
        id: client.id!,
        name: client.fullName!,
        externalRef: client.externalRef,
      }));
  } catch {
    return [];
  }
}

async function getQualitySummary() {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const response = await fetch(`${API_BASE}/v1/quality/summary?month=${month}`, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as QualitySummary;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const [state, clients, quality] = await Promise.all([getState(), getClients(), getQualitySummary()]);
  const isEmpty = !state || !state.hasCommittedSot;

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            Your weekly nutrition overview at a glance.
          </p>
        </div>
        <div className="page-header-actions">
          <Link href="/upload" className="btn btn-primary btn-lg">
            Import Data
          </Link>
        </div>
      </div>

      {isEmpty ? (
        <section className="card">
          <div className="state-box">
            <div className="state-icon">&#x1f4e6;</div>
            <div className="state-title">No Data Yet</div>
            <div className="state-desc">
              Upload your SKU catalog and Instacart orders to get started.
            </div>
            <Link href="/upload" className="btn btn-primary mt-4">
              Import Data
            </Link>
          </div>
        </section>
      ) : (
        <>
          <section className="section">
            <h2 className="section-title">Overview</h2>
            <div className="kpi-grid">
              <div className="kpi">
                <div className="kpi-value">{state.counts.activeSkus}</div>
                <div className="kpi-label">Active SKUs</div>
              </div>
              <div className="kpi">
                <div className="kpi-value">{state.counts.activeIngredients}</div>
                <div className="kpi-label">Ingredients</div>
              </div>
              <div className="kpi">
                <div className="kpi-value">{state.counts.lotsOnHand}</div>
                <div className="kpi-label">Inventory Lots</div>
              </div>
              <div className="kpi">
                <div className="kpi-value">{state.counts.schedules}</div>
                <div className="kpi-label">Schedules</div>
              </div>
              <div className="kpi">
                <div className="kpi-value">{state.counts.servedMeals}</div>
                <div className="kpi-label">Served Meals</div>
              </div>
              <div className="kpi">
                <div className="kpi-value">{state.counts.labels}</div>
                <div className="kpi-label">Frozen Labels</div>
              </div>
              <div className="kpi">
                <div className="kpi-value">{state.counts.openVerificationTasks}</div>
                <div className="kpi-label">Open Verifications</div>
                {state.counts.openVerificationTasks > 0 && (
                  <div className="kpi-note">
                    <span className="badge badge-warn">Needs Attention</span>
                  </div>
                )}
              </div>
            </div>
          </section>

          {quality && (
            <section className="section">
              <h2 className="section-title">Quality Summary ({quality.month})</h2>
              <div className="kpi-grid">
                <div className="kpi">
                  <div className="kpi-value">{(quality.coverage.productFull40CoverageRatio * 100).toFixed(0)}%</div>
                  <div className="kpi-label">Product 40-Key Coverage</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">{(quality.coverage.finalLabelFull40CoverageRatio * 100).toFixed(0)}%</div>
                  <div className="kpi-label">Final Label 40-Key Coverage</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">{quality.evidence.provisionalLabels}</div>
                  <div className="kpi-label">Provisional Labels</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">{quality.evidence.inferredRows}</div>
                  <div className="kpi-label">Estimated Nutrients</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">{quality.evidence.exceptionRows}</div>
                  <div className="kpi-label">Historical Exceptions</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">{quality.evidence.floorRows}</div>
                  <div className="kpi-label">Fallback Values</div>
                </div>
                <div className="kpi">
                  <div className="kpi-value">{quality.totals.criticalOrHighVerificationTasks}</div>
                  <div className="kpi-label">High/Critical Verifications</div>
                  <div className="kpi-note">
                    <Link href={"/verification" as any} className="btn btn-outline btn-sm">Open Queue</Link>
                  </div>
                </div>
              </div>
            </section>
          )}

          {clients.length > 0 && (
            <section className="section">
              <h2 className="section-title">Clients</h2>
              <div className="client-grid">
                {clients.map((client: Client) => (
                  <Link
                    key={client.id}
                    href={`/clients/${client.id}/calendar`}
                    className="client-card"
                  >
                    <div className="client-avatar">
                      {client.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="client-card-info">
                      <div className="client-card-name">{client.name}</div>
                      {client.externalRef && (
                        <div className="client-card-meta">{client.externalRef}</div>
                      )}
                    </div>
                    <span className="client-card-arrow">&rarr;</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
