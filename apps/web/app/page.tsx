import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

async function getState() {
  try {
    const response = await fetch(`${API_BASE}/v1/system/state`, { cache: "no-store" });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

async function getClients() {
  try {
    const response = await fetch(`${API_BASE}/v1/clients`, { cache: "no-store" });
    if (!response.ok) return [];
    const json = await response.json();
    return json.clients ?? [];
  } catch {
    return [];
  }
}

type Client = {
  id: string;
  name: string;
  externalRef?: string;
};

export default async function HomePage() {
  const [state, clients] = await Promise.all([getState(), getClients()]);
  const isEmpty = !state || !state.hasCommittedSot;

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            Nutrition operations overview with immutable label traceability.
          </p>
        </div>
        <div className="page-header-actions">
          <Link href="/upload" className="btn btn-primary btn-lg">
            Upload + Backfill
          </Link>
        </div>
      </div>

      {isEmpty ? (
        <section className="card">
          <div className="state-box">
            <div className="state-icon">&#x1f4e6;</div>
            <div className="state-title">No Data Yet</div>
            <div className="state-desc">
              Import a Source of Truth workbook or run a Pilot Backfill to populate
              SKUs, recipes, and nutrition labels.
            </div>
            <Link href="/upload" className="btn btn-primary mt-4">
              Go to Upload Center
            </Link>
          </div>
        </section>
      ) : (
        <>
          <section className="section">
            <h2 className="section-title">System Overview</h2>
            <div className="kpi-grid">
              <div className="kpi">
                <div className="kpi-value">{state.skuCount ?? 0}</div>
                <div className="kpi-label">Active SKUs</div>
              </div>
              <div className="kpi">
                <div className="kpi-value">{state.ingredientCount ?? 0}</div>
                <div className="kpi-label">Ingredients</div>
              </div>
              <div className="kpi">
                <div className="kpi-value">{state.lotCount ?? 0}</div>
                <div className="kpi-label">Inventory Lots</div>
              </div>
              <div className="kpi">
                <div className="kpi-value">{state.scheduleCount ?? 0}</div>
                <div className="kpi-label">Schedules</div>
              </div>
              <div className="kpi">
                <div className="kpi-value">{state.servedMealCount ?? 0}</div>
                <div className="kpi-label">Served Meals</div>
              </div>
              <div className="kpi">
                <div className="kpi-value">{state.labelCount ?? 0}</div>
                <div className="kpi-label">Frozen Labels</div>
              </div>
              <div className="kpi">
                <div className="kpi-value">{state.openVerificationCount ?? 0}</div>
                <div className="kpi-label">Open Verifications</div>
                {(state.openVerificationCount ?? 0) > 0 && (
                  <div className="kpi-note">
                    <span className="badge badge-warn">Needs Attention</span>
                  </div>
                )}
              </div>
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
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
