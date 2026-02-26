import { ClientHealthTabs } from "./tabs";

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

export default async function ClientsHealthPage() {
  const clients = await getClients();

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Client Health Data</h1>
          <p className="page-subtitle">Biometrics, documents, lab metrics, and health profiles.</p>
        </div>
      </div>

      <ClientHealthTabs clients={clients} />
    </div>
  );
}
