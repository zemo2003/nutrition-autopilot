import Link from "next/link";
import { redirect } from "next/navigation";
import { ClientProfileView } from "../../../components/client-profile";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? process.env.API_BASE ?? "http://localhost:4000";

async function getFirstClient(): Promise<{ id: string; fullName: string } | null> {
  try {
    const res = await fetch(`${API_BASE}/v1/clients`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return data.clients?.[0] ?? null;
  } catch {
    return null;
  }
}

export default async function ClientProfilePage() {
  const client = await getFirstClient();

  if (!client) {
    return (
      <div className="page-shell">
        <div className="state-box" style={{ textAlign: "center", padding: "var(--sp-8)" }}>
          <div className="state-title">No clients found</div>
          <div className="state-desc">Import a SOT workbook with schedule data to create clients.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="breadcrumbs">
        <Link href="/">Dashboard</Link>
        <span className="sep">/</span>
        <span className="current">{client.fullName}</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{client.fullName}</h1>
          <p className="page-subtitle">Client profile, body composition, and health records.</p>
        </div>
        <div className="page-header-actions">
          <Link href={`/clients/${client.id}/calendar`} className="btn btn-outline">
            Calendar
          </Link>
        </div>
      </div>

      <ClientProfileView clientId={client.id} />
    </div>
  );
}
