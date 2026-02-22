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

export default async function CalendarPage({
  params,
  searchParams
}: {
  params: Promise<{ clientId: string }>;
  searchParams?: Promise<{ month?: string }>;
}) {
  const { clientId } = await params;
  const query = (await searchParams) ?? {};
  const month = query.month ?? new Date().toISOString().slice(0, 7);
  const data = await getCalendar(clientId, month);

  return (
    <main>
      <h1>Client Calendar</h1>
      <p>
        Client: <code>{clientId}</code> | Month: <code>{data.month}</code>
      </p>
      <p>
        <Link href={`/clients/${clientId}/calendar?month=${previousMonth(month)}`}>Previous Month</Link> |{" "}
        <Link href={`/clients/${clientId}/calendar?month=${nextMonth(month)}`}>Next Month</Link>
      </p>

      <section className="card">
        {!data.events?.length ? (
          <p>No served meals yet for this month.</p>
        ) : (
          <ul>
            {data.events.map((event: any) => (
              <li key={event.id}>
                {new Date(event.servedAt).toLocaleString()} - {event.sku.name} (
                <Link href={`/labels/${event.finalLabelSnapshotId}`}>open label</Link> |{" "}
                <Link href={`/labels/${event.finalLabelSnapshotId}/print`}>print</Link>)
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function previousMonth(month: string): string {
  const [yearRaw, monthRaw] = month.split("-");
  const year = Number(yearRaw);
  const monthNum = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(monthNum)) return month;
  const date = new Date(Date.UTC(year, monthNum - 1, 1, 12, 0, 0, 0));
  date.setUTCMonth(date.getUTCMonth() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function nextMonth(month: string): string {
  const [yearRaw, monthRaw] = month.split("-");
  const year = Number(yearRaw);
  const monthNum = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(monthNum)) return month;
  const date = new Date(Date.UTC(year, monthNum - 1, 1, 12, 0, 0, 0));
  date.setUTCMonth(date.getUTCMonth() + 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
