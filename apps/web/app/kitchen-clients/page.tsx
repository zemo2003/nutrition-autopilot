import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? process.env.API_BASE ?? "http://localhost:4000";

async function getClients() {
  try {
    const response = await fetch(`${API_BASE}/v1/clients`, { cache: "no-store" });
    if (!response.ok) return [];
    const json = (await response.json()) as {
      clients?: Array<{ id?: string; fullName?: string; externalRef?: string }>;
    };
    return (json.clients ?? [])
      .filter((c) => typeof c.id === "string" && typeof c.fullName === "string")
      .map((c) => ({ id: c.id!, name: c.fullName!, externalRef: c.externalRef }));
  } catch {
    return [];
  }
}

export default async function KitchenClientsPage() {
  const clients = await getClients();

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Clients</h1>
          <p className="page-subtitle">Meal calendars and print views for each client.</p>
        </div>
      </div>

      {clients.length === 0 ? (
        <section className="card">
          <div className="state-box">
            <div className="state-icon">&#x1f464;</div>
            <div className="state-title">No Clients Yet</div>
            <div className="state-desc">Import data to get started with client meal tracking.</div>
            <Link href="/upload" className="btn btn-primary mt-4">Import Data</Link>
          </div>
        </section>
      ) : (
        <div className="client-grid">
          {clients.map((client) => (
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
      )}

      <div className="row mt-6" style={{ gap: "var(--sp-2)" }}>
        <Link href={"/kitchen/print/pull-list" as any} className="btn btn-outline btn-sm">Print Pull List</Link>
        <Link href={"/kitchen/print/daily-summary" as any} className="btn btn-outline btn-sm">Print Daily Summary</Link>
      </div>
    </div>
  );
}
