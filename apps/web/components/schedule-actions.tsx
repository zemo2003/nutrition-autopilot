"use client";

import Link from "next/link";
import { useState, useCallback } from "react";

function resolveApiBase() {
  if (process.env.NEXT_PUBLIC_API_BASE) return process.env.NEXT_PUBLIC_API_BASE;
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  }
  return "http://localhost:4000";
}

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

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
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

export function ScheduleBoard({
  initialSchedules,
  sortedDays,
  today,
}: {
  initialSchedules: ScheduleItem[];
  sortedDays: string[];
  today: string;
}) {
  const [schedules, setSchedules] = useState<ScheduleItem[]>(initialSchedules);
  const [loading, setLoading] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const grouped: Record<string, ScheduleItem[]> = {};
  for (const s of schedules) {
    const day = s.serviceDate;
    if (!grouped[day]) grouped[day] = [];
    grouped[day]!.push(s);
  }

  const handleAction = useCallback(
    async (scheduleId: string, action: "DONE" | "SKIPPED") => {
      setLoading((prev) => ({ ...prev, [scheduleId]: action }));
      setErrors((prev) => {
        const next = { ...prev };
        delete next[scheduleId];
        return next;
      });

      try {
        const res = await fetch(`${resolveApiBase()}/v1/schedule/${scheduleId}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: action }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Request failed" }));
          throw new Error(body.error || "Request failed");
        }

        const data = await res.json();

        setSchedules((prev) =>
          prev.map((s) =>
            s.id === scheduleId
              ? {
                  ...s,
                  status: data.status,
                  serviceEventId: data.freeze?.serviceEventId ?? s.serviceEventId,
                  finalLabelSnapshotId: data.freeze?.labelSnapshotId ?? s.finalLabelSnapshotId,
                }
              : s
          )
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setErrors((prev) => ({ ...prev, [scheduleId]: message }));
      } finally {
        setLoading((prev) => {
          const next = { ...prev };
          delete next[scheduleId];
          return next;
        });
      }
    },
    []
  );

  return (
    <div>
      {sortedDays.map((day) => {
        const daySchedules = grouped[day] ?? [];
        if (daySchedules.length === 0) return null;
        const isToday = day === today;

        return (
          <div key={day} className="calendar-day-group">
            <div className="calendar-day-label">
              {formatDayLabel(day)}
              {isToday && <span className="badge badge-success">Today</span>}
              <span className="badge badge-neutral">
                {daySchedules.length} meal{daySchedules.length !== 1 ? "s" : ""}
              </span>
            </div>

            {daySchedules.map((schedule) => (
              <div
                key={schedule.id}
                className="meal-card"
                data-status={schedule.status.toLowerCase()}
              >
                <div className="meal-info">
                  <div className="meal-name">{schedule.skuName}</div>
                  <div className="meal-time">
                    {schedule.clientName}
                    {schedule.mealSlot && (
                      <>
                        {" \u00b7 "}
                        <span className={slotClass(schedule.mealSlot)}>
                          {schedule.mealSlot}
                        </span>
                      </>
                    )}
                    {schedule.plannedServings !== 1 && (
                      <>
                        {" \u00b7 "}
                        <span>{schedule.plannedServings} servings</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="meal-actions">
                  {schedule.status === "PLANNED" && (
                    <>
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={!!loading[schedule.id]}
                        onClick={() => handleAction(schedule.id, "DONE")}
                      >
                        {loading[schedule.id] === "DONE" ? "Freezing..." : "Fed"}
                      </button>
                      <button
                        className="btn btn-outline btn-sm"
                        disabled={!!loading[schedule.id]}
                        onClick={() => handleAction(schedule.id, "SKIPPED")}
                      >
                        {loading[schedule.id] === "SKIPPED" ? "..." : "Skip"}
                      </button>
                    </>
                  )}

                  {schedule.status === "DONE" && (
                    <>
                      <span className="badge badge-success">Fed</span>
                      {schedule.finalLabelSnapshotId && (
                        <Link
                          href={`/labels/${schedule.finalLabelSnapshotId}`}
                          className="btn btn-outline btn-sm"
                        >
                          View Label
                        </Link>
                      )}
                    </>
                  )}

                  {schedule.status === "SKIPPED" && (
                    <span className="badge badge-neutral">Skipped</span>
                  )}
                </div>

                {errors[schedule.id] && (
                  <div
                    style={{
                      width: "100%",
                      marginTop: 6,
                      padding: "6px 10px",
                      borderRadius: 6,
                      background: "var(--c-danger-soft)",
                      color: "var(--c-danger)",
                      fontSize: "var(--text-xs)",
                    }}
                  >
                    {errors[schedule.id]}
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
