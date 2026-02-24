import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? process.env.API_BASE ?? "http://localhost:4000";

type CalendarEvent = {
  id: string;
  servedAt: string;
  sku: { name: string };
  mealSlot?: string;
  finalLabelSnapshotId: string | null;
};

async function getCalendar(clientId: string, month: string) {
  try {
    const response = await fetch(
      `${API_BASE}/v1/clients/${clientId}/calendar?month=${month}`,
      { cache: "no-store" }
    );
    if (!response.ok) return { month, events: [] };
    return response.json();
  } catch {
    return { month, events: [] };
  }
}

function prevMonth(month: string): string {
  const parts = month.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return month;
  const d = new Date(Date.UTC(y, m - 1, 1, 12));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function nextMonth(month: string): string {
  const parts = month.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return month;
  const d = new Date(Date.UTC(y, m - 1, 1, 12));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(month: string): string {
  const parts = month.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function groupByDay(events: CalendarEvent[]): Record<string, CalendarEvent[]> {
  const groups: Record<string, CalendarEvent[]> = {};
  for (const ev of events) {
    const day = ev.servedAt.slice(0, 10);
    if (!groups[day]) groups[day] = [];
    groups[day].push(ev);
  }
  return groups;
}

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function slotClass(slot?: string): string {
  if (!slot) return "";
  const lower = slot.toLowerCase();
  if (lower.includes("break")) return "meal-slot meal-slot-breakfast";
  if (lower.includes("lunch")) return "meal-slot meal-slot-lunch";
  if (lower.includes("dinner") || lower.includes("supper")) return "meal-slot meal-slot-dinner";
  if (lower.includes("snack")) return "meal-slot meal-slot-snack";
  return "meal-slot meal-slot-snack";
}

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams?: Promise<{ month?: string }>;
}) {
  const { clientId } = await params;
  const query = (await searchParams) ?? {};
  const month = query.month ?? new Date().toISOString().slice(0, 7);
  const data = await getCalendar(clientId, month);
  const events: CalendarEvent[] = data.events ?? [];
  const grouped = groupByDay(events);
  const sortedDays = Object.keys(grouped).sort();
  const labeledCount = events.filter((e) => e.finalLabelSnapshotId).length;

  return (
    <div className="page-shell">
      <div className="breadcrumbs">
        <Link href="/">Dashboard</Link>
        <span className="sep">/</span>
        <span className="current">Calendar</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Served Meals</h1>
          <p className="page-subtitle">
            Client <code>{clientId.slice(0, 8)}...</code>
          </p>
        </div>
        <div className="page-header-actions">
          {events.length > 0 && (
            <a
              href={`${API_BASE}/v1/clients/${clientId}/calendar/export?month=${month}`}
              className="btn btn-outline"
              download
            >
              Export XLSX
            </a>
          )}
          <Link href="/" className="btn btn-outline">Dashboard</Link>
        </div>
      </div>

      <div className="calendar-nav">
        <Link
          href={`/clients/${clientId}/calendar?month=${prevMonth(month)}`}
          className="btn btn-outline btn-sm"
        >
          &larr; Prev
        </Link>
        <div className="calendar-nav-month">{formatMonthLabel(month)}</div>
        <Link
          href={`/clients/${clientId}/calendar?month=${nextMonth(month)}`}
          className="btn btn-outline btn-sm"
        >
          Next &rarr;
        </Link>
      </div>

      {events.length > 0 && (
        <div className="calendar-header-stats">
          <div className="calendar-stat">
            <strong>{events.length}</strong> meals served
          </div>
          <div className="calendar-stat">
            <strong>{labeledCount}</strong> labels frozen
          </div>
          <div className="calendar-stat">
            <strong>{sortedDays.length}</strong> active days
          </div>
        </div>
      )}

      {events.length === 0 ? (
        <div className="card">
          <div className="state-box">
            <div className="state-icon">&#x1f4c5;</div>
            <div className="state-title">No Served Meals</div>
            <div className="state-desc">
              No meals found for this client in {formatMonthLabel(month)}.
              Import Instacart orders to populate your meal history.
            </div>
            <Link href="/upload" className="btn btn-primary mt-4">
              Import Data
            </Link>
          </div>
        </div>
      ) : (
        <div>
          {sortedDays.map((day) => (
            <div key={day} className="calendar-day-group">
              <div className="calendar-day-label">
                {formatDayLabel(day)}
                <span className="badge badge-neutral">
                  {(grouped[day] ?? []).length} meal{(grouped[day] ?? []).length !== 1 ? "s" : ""}
                </span>
              </div>
              {(grouped[day] ?? []).map((event) => (
                <div key={event.id} className="meal-card">
                  <div className="meal-info">
                    <div className="meal-name">{event.sku.name}</div>
                    <div className="meal-time">
                      {formatTime(event.servedAt)}
                      {event.mealSlot && (
                        <>
                          {" \u00b7 "}
                          <span className={slotClass(event.mealSlot)}>{event.mealSlot}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="meal-actions">
                    {event.finalLabelSnapshotId ? (
                      <>
                        <Link
                          href={`/labels/${event.finalLabelSnapshotId}`}
                          className="btn btn-outline btn-sm"
                        >
                          View Label
                        </Link>
                        <Link
                          href={`/labels/${event.finalLabelSnapshotId}/print`}
                          className="btn btn-primary btn-sm"
                        >
                          Print
                        </Link>
                      </>
                    ) : (
                      <span className="badge badge-neutral">No Label</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
