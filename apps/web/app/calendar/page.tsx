import Link from "next/link";
import { redirect } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

async function getClients() {
  try {
    const response = await fetch(`${API_BASE}/v1/clients`, { cache: "no-store" });
    if (!response.ok) return [];
    const json = (await response.json()) as {
      clients?: Array<{ id?: string; fullName?: string }>;
    };
    return (json.clients ?? []).filter((client) => typeof client.id === "string");
  } catch {
    return [];
  }
}

export default async function CalendarLandingPage() {
  const clients = await getClients();
  const month = new Date().toISOString().slice(0, 7);

  if (clients.length > 0) {
    redirect(`/clients/${clients[0]!.id}/calendar?month=${month}`);
  }

  return (
    <div className="page-shell">
      <div className="card">
        <div className="state-box">
          <div className="state-icon">&#x1f4c5;</div>
          <div className="state-title">No Client Calendar Available</div>
          <div className="state-desc">
            Your meal calendar will appear once you've imported data and served meals.
          </div>
          <Link href="/upload" className="btn btn-primary mt-4">
            Import Data
          </Link>
        </div>
      </div>
    </div>
  );
}
