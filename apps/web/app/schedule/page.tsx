import Link from "next/link";
import { ScheduleBoard } from "../../components/schedule-actions";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

type ScheduleItem = {
  id: string;
  clientId: string;
  clientName: string;
  skuId: string;
  skuName: string;
  skuCode: string;
  serviceDate: string;
  mealSlot: string;
  status: string;
  plannedServings: number;
  serviceEventId: string | null;
  finalLabelSnapshotId: string | null;
};

async function getSchedules(): Promise<ScheduleItem[]> {
  try {
    const response = await fetch(`${API_BASE}/v1/schedules`, { cache: "no-store" });
    if (!response.ok) return [];
    const json = (await response.json()) as { schedules?: ScheduleItem[] };
    return json.schedules ?? [];
  } catch {
    return [];
  }
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

function isToday(dateStr: string): boolean {
  return dateStr === new Date().toISOString().slice(0, 10);
}

export default async function SchedulePage() {
  const schedules = await getSchedules();
  const planned = schedules.filter((s) => s.status === "PLANNED").length;
  const done = schedules.filter((s) => s.status === "DONE").length;
  const skipped = schedules.filter((s) => s.status === "SKIPPED").length;

  // Group by date
  const grouped: Record<string, ScheduleItem[]> = {};
  for (const s of schedules) {
    const day = s.serviceDate;
    if (!grouped[day]) grouped[day] = [];
    grouped[day]!.push(s);
  }

  // Sort dates: today first, then ascending
  const today = new Date().toISOString().slice(0, 10);
  const sortedDays = Object.keys(grouped).sort((a, b) => {
    if (a === today) return -1;
    if (b === today) return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="page-shell">
      <div className="breadcrumbs">
        <Link href="/">Dashboard</Link>
        <span className="sep">/</span>
        <span className="current">Schedule</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Meal Schedule</h1>
          <p className="page-subtitle">
            Mark meals as fed or skipped as the chef assembles them.
          </p>
        </div>
        <div className="page-header-actions">
          <Link href="/" className="btn btn-outline">Dashboard</Link>
        </div>
      </div>

      {schedules.length > 0 && (
        <div className="calendar-header-stats">
          <div className="calendar-stat">
            <strong>{planned}</strong> planned
          </div>
          <div className="calendar-stat">
            <strong>{done}</strong> served
          </div>
          <div className="calendar-stat">
            <strong>{skipped}</strong> skipped
          </div>
        </div>
      )}

      {schedules.length === 0 ? (
        <section className="card">
          <div className="state-box">
            <div className="state-icon">&#x1f4cb;</div>
            <div className="state-title">No Schedules</div>
            <div className="state-desc">
              Upload your weekly meal plan to create scheduled meals. Use the POST /v1/schedules endpoint or import via the backfill flow.
            </div>
            <Link href="/upload" className="btn btn-primary mt-4">
              Import Data
            </Link>
          </div>
        </section>
      ) : (
        <ScheduleBoard
          initialSchedules={schedules}
          sortedDays={sortedDays}
          today={today}
        />
      )}
    </div>
  );
}
