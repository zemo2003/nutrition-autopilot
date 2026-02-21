import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

async function getCalendar(clientId: string, month: string) {
  try {
    const response = await fetch(`${API_BASE}/v1/clients/${clientId}/calendar?month=${month}`, { cache: "no-store" });
    if (!response.ok) return { month, events: [] };
    return response.json();
  } catch {
    return { month, events: [] };
  }
}

export default async function CalendarPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const month = new Date().toISOString().slice(0, 7);
  const data = await getCalendar(clientId, month);

  return (
    <main>
      <h1>Client Calendar</h1>
      <p>
        Client: <code>{clientId}</code> | Month: <code>{data.month}</code>
      </p>

      <section className="card">
        {!data.events?.length ? (
          <p>No served meals yet for this month.</p>
        ) : (
          <ul>
            {data.events.map((event: any) => (
              <li key={event.id}>
                {new Date(event.servedAt).toLocaleString()} - {event.sku.name} (
                <Link href={`/labels/${event.finalLabelSnapshotId}`}>open label</Link>)
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
