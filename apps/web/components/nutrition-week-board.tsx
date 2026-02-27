"use client";

import { useCallback, useEffect, useState } from "react";

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

type DayData = {
  date: string;
  dayOfWeek: string;
  mealCount: number;
  totalKcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fiberG: number;
  meals: {
    id: string;
    servedAt: string;
    mealSlot: string;
    skuName: string;
    kcal: number;
    proteinG: number;
    carbG: number;
    fatG: number;
    fiberG: number;
    estimated: boolean;
  }[];
};

type WeeklyData = {
  clientId: string;
  weekStart: string;
  weekEnd: string;
  days: DayData[];
  summary: {
    totalMeals: number;
    daysWithData: number;
    avgKcal: number;
    avgProteinG: number;
    avgCarbG: number;
    avgFatG: number;
    totalKcal: number;
    totalProteinG: number;
    totalCarbG: number;
    totalFatG: number;
  };
};

function formatDate(d: string) {
  const date = new Date(d + "T12:00:00Z");
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

function BarChart({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{
      width: "100%", height: 18, background: "var(--c-surface-raised, #f0f0f0)",
      borderRadius: "var(--r-sm, 4px)", overflow: "hidden",
    }}>
      <div style={{
        width: `${pct}%`, height: "100%", background: color,
        borderRadius: "var(--r-sm, 4px)", transition: "width 0.3s ease",
        minWidth: value > 0 ? 4 : 0,
      }} />
    </div>
  );
}

export default function NutritionWeekBoard({ clientId }: { clientId: string }) {
  const [data, setData] = useState<WeeklyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weekOf, setWeekOf] = useState(() => new Date().toISOString().slice(0, 10));

  const fetchWeek = useCallback(async () => {
    setLoading(true);
    setError(null);
    const base = resolveApiBase();
    try {
      const res = await fetch(`${base}/v1/clients/${clientId}/nutrition/weekly?date=${weekOf}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load nutrition data (${res.status})`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load weekly nutrition");
    } finally {
      setLoading(false);
    }
  }, [clientId, weekOf]);

  useEffect(() => { fetchWeek(); }, [fetchWeek]);

  const shiftWeek = (days: number) => {
    const d = new Date(weekOf + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    setWeekOf(d.toISOString().slice(0, 10));
  };

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
        <div className="loading-shimmer" style={{ height: 36, borderRadius: "var(--r-md)", width: "40%" }} />
        <div className="loading-shimmer" style={{ height: 120, borderRadius: "var(--r-md)" }} />
        <div className="loading-shimmer" style={{ height: 200, borderRadius: "var(--r-md)" }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: "var(--sp-3)", padding: "var(--sp-3) var(--sp-4)",
        background: "var(--c-danger-soft)", color: "var(--c-danger)",
        border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--r-md)", fontSize: "var(--text-sm)",
      }}>
        <span>{error}</span>
        <button className="btn btn-sm" style={{ background: "var(--c-danger)", color: "#fff" }}
          onClick={fetchWeek}>Retry</button>
      </div>
    );
  }

  if (!data) return null;

  const maxKcal = Math.max(...data.days.map((d) => d.totalKcal), 1);

  return (
    <div>
      {/* Week navigation */}
      <div style={{
        display: "flex", alignItems: "center", gap: "var(--sp-3)",
        marginBottom: "var(--sp-4)",
      }}>
        <button className="btn btn-outline btn-sm" onClick={() => shiftWeek(-7)}>&larr; Prev Week</button>
        <div style={{ flex: 1, textAlign: "center", fontWeight: 600, fontSize: "var(--text-sm)" }}>
          {formatDate(data.weekStart)} &mdash; {formatDate(data.weekEnd)}
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => shiftWeek(7)}>Next Week &rarr;</button>
      </div>

      {/* Summary cards */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
        gap: "var(--sp-3)", marginBottom: "var(--sp-4)",
      }}>
        <div className="kpi">
          <div className="kpi-value">{data.summary.avgKcal}</div>
          <div className="kpi-label">Avg kcal/day</div>
        </div>
        <div className="kpi">
          <div className="kpi-value">{data.summary.avgProteinG}g</div>
          <div className="kpi-label">Avg Protein</div>
        </div>
        <div className="kpi">
          <div className="kpi-value">{data.summary.avgCarbG}g</div>
          <div className="kpi-label">Avg Carbs</div>
        </div>
        <div className="kpi">
          <div className="kpi-value">{data.summary.avgFatG}g</div>
          <div className="kpi-label">Avg Fat</div>
        </div>
        <div className="kpi">
          <div className="kpi-value">{data.summary.totalMeals}</div>
          <div className="kpi-label">Total Meals</div>
        </div>
      </div>

      {/* Daily breakdown table */}
      <div style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Day</th>
              <th>Meals</th>
              <th style={{ textAlign: "right" }}>kcal</th>
              <th style={{ textAlign: "right" }}>Protein</th>
              <th style={{ textAlign: "right" }}>Carbs</th>
              <th style={{ textAlign: "right" }}>Fat</th>
              <th style={{ width: 120 }}>kcal Bar</th>
            </tr>
          </thead>
          <tbody>
            {data.days.map((day) => (
              <tr key={day.date} style={day.mealCount === 0 ? { opacity: 0.4 } : {}}>
                <td>
                  <div style={{ fontWeight: 600 }}>{day.dayOfWeek}</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)" }}>
                    {day.date}
                  </div>
                </td>
                <td>{day.mealCount}</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{day.totalKcal}</td>
                <td style={{ textAlign: "right" }}>{day.proteinG}g</td>
                <td style={{ textAlign: "right" }}>{day.carbG}g</td>
                <td style={{ textAlign: "right" }}>{day.fatG}g</td>
                <td>
                  <BarChart value={day.totalKcal} max={maxKcal} color="var(--c-primary, #4f46e5)" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Meal details for days with data */}
      {data.days.filter((d) => d.mealCount > 0).map((day) => (
        <details key={day.date} style={{ marginTop: "var(--sp-3)" }}>
          <summary style={{
            cursor: "pointer", fontWeight: 600, fontSize: "var(--text-sm)",
            padding: "var(--sp-2) 0",
          }}>
            {day.dayOfWeek} {day.date} — {day.mealCount} meal{day.mealCount !== 1 ? "s" : ""}, {day.totalKcal} kcal
          </summary>
          <div style={{ paddingLeft: "var(--sp-4)" }}>
            {day.meals.map((meal) => (
              <div key={meal.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "var(--sp-2) 0",
                borderBottom: "1px solid var(--c-border, #eee)",
                fontSize: "var(--text-sm)",
              }}>
                <div>
                  <span style={{ fontWeight: 500 }}>{meal.skuName}</span>
                  <span style={{ color: "var(--c-ink-muted)", marginLeft: "var(--sp-2)" }}>
                    {meal.mealSlot}
                  </span>
                  {meal.estimated && (
                    <span style={{
                      marginLeft: "var(--sp-2)", fontSize: "var(--text-xs)",
                      color: "var(--c-warning)", fontStyle: "italic",
                    }}>
                      estimated
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: "var(--sp-3)", color: "var(--c-ink-muted)" }}>
                  <span>{meal.kcal} kcal</span>
                  <span>P: {meal.proteinG}g</span>
                  <span>C: {meal.carbG}g</span>
                  <span>F: {meal.fatG}g</span>
                </div>
              </div>
            ))}
          </div>
        </details>
      ))}

      {data.summary.totalMeals === 0 && (
        <div className="state-box" style={{ marginTop: "var(--sp-4)" }}>
          <div className="state-title">No meals served this week</div>
          <div className="state-desc">Nutrition data will appear here once meals are marked as Fed.</div>
        </div>
      )}
    </div>
  );
}
