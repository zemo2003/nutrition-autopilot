"use client";

import { useState, useCallback } from "react";

function resolveApiBase() {
  if (process.env.NEXT_PUBLIC_API_BASE) return process.env.NEXT_PUBLIC_API_BASE;
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host.includes("onrender.com")) {
      return `${window.location.protocol}//${host.replace("-web", "-api")}`;
    }
    return `${window.location.protocol}//${host}:4000`;
  }
  return "http://localhost:4000";
}

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

// Meal slot display order (chef's daily flow)
const SLOT_ORDER: Record<string, number> = {
  BREAKFAST: 0,
  LUNCH: 1,
  PRE_TRAINING: 2,
  POST_TRAINING: 3,
  SNACK: 4,
  DINNER: 5,
  PRE_BED: 6,
};

function slotSortKey(slot: string): number {
  return SLOT_ORDER[slot.toUpperCase()] ?? 99;
}

// Group categories for chef-friendly display order
const CATEGORY_ORDER = ["protein", "vegetable", "grain", "fruit", "dairy", "fat", "condiment", "other", "unmapped"];
const CATEGORY_LABELS: Record<string, string> = {
  protein: "Protein",
  vegetable: "Vegetables & Carbs",
  grain: "Grains",
  fruit: "Fruit",
  dairy: "Dairy",
  fat: "Fats & Oils",
  condiment: "Condiments",
  other: "Other",
  unmapped: "Other",
};

function groupByCategory(lines: RecipeLine[]): Array<{ category: string; label: string; items: RecipeLine[] }> {
  const map = new Map<string, RecipeLine[]>();
  for (const line of lines) {
    const cat = line.category || "other";
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(line);
  }
  return CATEGORY_ORDER
    .filter((cat) => map.has(cat))
    .map((cat) => ({
      category: cat,
      label: CATEGORY_LABELS[cat] ?? cat,
      items: map.get(cat)!,
    }));
}

function RecipeBreakdown({ lines, servings }: { lines: RecipeLine[]; servings: number }) {
  if (lines.length === 0) return null;
  const groups = groupByCategory(lines);
  const totalG = lines.reduce((s, l) => s + l.gramsPerServing, 0) * servings;

  return (
    <div style={{ width: "100%", marginTop: 8, borderTop: "1px solid var(--c-border-light)", paddingTop: 8 }}>
      {groups.map((group) => (
        <div key={group.category} style={{ marginBottom: 6 }}>
          <div style={{
            fontSize: "var(--text-xs)",
            fontWeight: 600,
            color: "var(--c-ink-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: 2,
          }}>
            {group.label}
          </div>
          {group.items.map((line, idx) => (
            <div
              key={idx}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: "var(--text-sm)",
                padding: "2px 0",
                gap: 8,
              }}
            >
              <span style={{ color: "var(--c-ink-soft)" }}>
                {line.ingredientName}
                {line.preparation ? (
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)", marginLeft: 4 }}>
                    ({line.preparation})
                  </span>
                ) : null}
              </span>
              <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                {(line.gramsPerServing * servings).toFixed(0)}g
              </span>
            </div>
          ))}
        </div>
      ))}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        borderTop: "1px solid var(--c-border-light)",
        paddingTop: 4,
        marginTop: 4,
        fontSize: "var(--text-sm)",
        fontWeight: 600,
      }}>
        <span>Total</span>
        <span>{totalG.toFixed(0)}g</span>
      </div>
    </div>
  );
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const grouped: Record<string, ScheduleItem[]> = {};
  for (const s of schedules) {
    const day = s.serviceDate;
    if (!grouped[day]) grouped[day] = [];
    grouped[day]!.push(s);
  }
  // Sort meals within each day by slot order
  for (const day of Object.keys(grouped)) {
    grouped[day]!.sort((a, b) => slotSortKey(a.mealSlot) - slotSortKey(b.mealSlot));
  }

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

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

        await res.json();

        // Remove from list — fed meals go to calendar, skipped meals disappear
        setSchedules((prev) => prev.filter((s) => s.id !== scheduleId));
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
              >
                <div
                  className="meal-info"
                  style={{ cursor: schedule.recipeLines.length > 0 ? "pointer" : undefined, flex: 1, minWidth: 0 }}
                  onClick={() => schedule.recipeLines.length > 0 && toggleExpand(schedule.id)}
                >
                  <div className="meal-name">
                    {schedule.recipeLines.length > 0 && (
                      <span style={{ display: "inline-block", width: 16, fontSize: "var(--text-xs)", color: "var(--c-ink-muted)" }}>
                        {expanded[schedule.id] ? "\u25BC" : "\u25B6"}
                      </span>
                    )}
                    {schedule.skuName}
                  </div>
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
                </div>

                {expanded[schedule.id] && schedule.recipeLines.length > 0 && (
                  <RecipeBreakdown
                    lines={schedule.recipeLines}
                    servings={schedule.plannedServings}
                  />
                )}

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
