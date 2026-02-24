import Link from "next/link";
import { ScheduleBoard } from "../../components/schedule-actions";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? process.env.API_BASE ?? "http://localhost:4000";

type RecipeLine = {
  ingredientName: string;
  category: string;
  gramsPerServing: number;
  preparation: string | null;
};

type ScheduleItem = {
  id: string;
  clientId: string;
  clientName: string;
  skuId: string;
  skuName: string;
  skuCode: string;
  servingSizeG: number | null;
  serviceDate: string;
  mealSlot: string;
  status: string;
  plannedServings: number;
  serviceEventId: string | null;
  finalLabelSnapshotId: string | null;
  recipeLines: RecipeLine[];
};

async function getSchedules(): Promise<ScheduleItem[]> {
  try {
    const response = await fetch(`${API_BASE}/v1/schedules?status=PLANNED`, { cache: "no-store" });
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

  // Meal slot display order (chef's daily flow)
  const SLOT_ORDER: Record<string, number> = {
    BREAKFAST: 0, LUNCH: 1, PRE_TRAINING: 2, POST_TRAINING: 3,
    SNACK: 4, DINNER: 5, PRE_BED: 6,
  };

  // Group by date
  const grouped: Record<string, ScheduleItem[]> = {};
  for (const s of schedules) {
    const day = s.serviceDate;
    if (!grouped[day]) grouped[day] = [];
    grouped[day]!.push(s);
  }
  // Sort meals within each day by slot order
  for (const day of Object.keys(grouped)) {
    grouped[day]!.sort((a, b) =>
      (SLOT_ORDER[a.mealSlot.toUpperCase()] ?? 99) - (SLOT_ORDER[b.mealSlot.toUpperCase()] ?? 99)
    );
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
            <strong>{schedules.length}</strong> meal{schedules.length !== 1 ? "s" : ""} remaining
          </div>
        </div>
      )}

      {schedules.length === 0 ? (
        <section className="card">
          <div className="state-box">
            <div className="state-icon">&#x2705;</div>
            <div className="state-title">All Caught Up</div>
            <div className="state-desc">
              No meals waiting to be prepared. Fed and skipped meals appear on the Calendar.
            </div>
            <Link href="/calendar" className="btn btn-primary mt-4">
              View Calendar
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
