import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? process.env.API_BASE ?? "http://localhost:4000";

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

async function getSauceCount() {
  try {
    const response = await fetch(`${API_BASE}/v1/sauces`, { cache: "no-store" });
    if (!response.ok) return 0;
    const json = await response.json();
    if (Array.isArray(json)) return json.length;
    if (json && Array.isArray(json.sauces)) return json.sauces.length;
    return 0;
  } catch {
    return 0;
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
  const [state, clients, quality, sauceCount] = await Promise.all([getState(), getClients(), getQualitySummary(), getSauceCount()]);
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
                  <div className="kpi-label">Nutrient Coverage</div>
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
                  <div className="kpi-value">{quality.totals.criticalOrHighVerificationTasks}</div>
                  <div className="kpi-label">Open Verifications</div>
                  <div className="kpi-note">
                    <Link href={"/verification" as any} className="btn btn-outline btn-sm">Review</Link>
                  </div>
                </div>
              </div>
            </section>
          )}

          <section className="section">
            <h2 className="section-title">Kitchen Ops</h2>
            <div className="kpi-grid">
              <Link href={"/inventory" as any} className="kpi" style={{ textDecoration: "none", cursor: "pointer" }}>
                <div className="kpi-value">{state.counts.lotsOnHand}</div>
                <div className="kpi-label">Inventory Lots</div>
                <div className="kpi-note"><span className="badge badge-info">View</span></div>
              </Link>
              <Link href={"/batch-prep" as any} className="kpi" style={{ textDecoration: "none", cursor: "pointer" }}>
                <div className="kpi-value">Prep</div>
                <div className="kpi-label">Batch Prep</div>
                <div className="kpi-note"><span className="badge badge-info">Open</span></div>
              </Link>
              <Link href={"/kitchen" as any} className="kpi" style={{ textDecoration: "none", cursor: "pointer" }}>
                <div className="kpi-value">Live</div>
                <div className="kpi-label">Kitchen Mode</div>
                <div className="kpi-note" style={{ color: "var(--c-ink-soft)" }}>Active batch execution</div>
              </Link>
              <Link href={"/sauces" as any} className="kpi" style={{ textDecoration: "none", cursor: "pointer" }}>
                <div className="kpi-value">{sauceCount}</div>
                <div className="kpi-label">Sauce Library</div>
                <div className="kpi-note"><span className="badge badge-info">Browse</span></div>
              </Link>
              <Link href={"/mappings" as any} className="kpi" style={{ textDecoration: "none", cursor: "pointer" }}>
                <div className="kpi-value">Map</div>
                <div className="kpi-label">Import Mappings</div>
                <div className="kpi-note" style={{ color: "var(--c-ink-soft)" }}>Resolve unmapped items</div>
              </Link>
              <Link href={"/substitutions" as any} className="kpi" style={{ textDecoration: "none", cursor: "pointer" }}>
                <div className="kpi-value">Sub</div>
                <div className="kpi-label">Substitutions</div>
                <div className="kpi-note" style={{ color: "var(--c-ink-soft)" }}>Find replacements</div>
              </Link>
            </div>
            <div className="row" style={{ gap: "var(--sp-2)", marginTop: "var(--sp-4)" }}>
              <Link href={"/kitchen/print/pull-list" as any} className="btn btn-outline btn-sm">
                Print Pull List
              </Link>
              <Link href={"/kitchen/print/daily-summary" as any} className="btn btn-outline btn-sm">
                Print Daily Summary
              </Link>
            </div>
          </section>

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
                <Link href={"/clients/profile" as any} className="client-card" style={{ borderStyle: "dashed" }}>
                  <div className="client-avatar" style={{ background: "var(--c-surface-alt)" }}>P</div>
                  <div className="client-card-info">
                    <div className="client-card-name">Client Profile</div>
                    <div className="client-card-meta">Health data & preferences</div>
                  </div>
                  <span className="client-card-arrow">&rarr;</span>
                </Link>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
