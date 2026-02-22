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

export default async function HomePage() {
  const [state, clients] = await Promise.all([getState(), getClients()]);
  const isEmpty = !state || !state.hasCommittedSot;
  const primaryClientId = clients[0]?.id ?? "no-client";

  return (
    <main>
      <h1>Nutrition Autopilot</h1>
      <p>Blank-slate operations console with immutable nutrition label lineage.</p>

      <div className="row">
        <Link href="/upload">Upload + Pilot Backfill</Link>
        <Link href={`/clients/${primaryClientId}/calendar`}>Calendar Drill-down</Link>
      </div>

      {isEmpty ? (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Empty State</h2>
          <p>No active SKUs or labels are visible until a valid SOT import is committed.</p>
          <p>
            Generate template: <code>/Users/daniel/Desktop/Nutrition_Autopilot_SOT.xlsx</code>
          </p>
        </section>
      ) : (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>System Summary</h2>
          <pre>{JSON.stringify(state, null, 2)}</pre>
        </section>
      )}
    </main>
  );
}
