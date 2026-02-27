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

type PrintSchedule = {
  clientId: string;
  clientName: string;
  exclusions: string[];
  date: string;
  meals: {
    id: string;
    mealSlot: string;
    skuName: string;
    status: string;
    servings: number;
    allergens: string[];
    ingredients: { name: string; gramsPerServing: number }[];
  }[];
};

function slotLabel(slot: string) {
  return slot.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function PrintSchedulePage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const [clientId, setClientId] = useState<string>("");
  const [schedule, setSchedule] = useState<PrintSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    params.then((p) => setClientId(p.clientId));
  }, [params]);

  const fetchSchedule = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    const base = resolveApiBase();
    try {
      const res = await fetch(`${base}/v1/clients/${clientId}/schedule/print?date=${date}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      setSchedule(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load schedule");
    } finally {
      setLoading(false);
    }
  }, [clientId, date]);

  useEffect(() => { fetchSchedule(); }, [fetchSchedule]);

  if (loading) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "#888" }}>Loading schedule...</div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "#c0392b" }}>{error}</div>
    );
  }

  if (!schedule) return null;

  const formatDate = (d: string) => {
    const dt = new Date(d + "T12:00:00Z");
    return dt.toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
    });
  };

  return (
    <>
      {/* Screen-only controls */}
      <div className="no-print" style={{
        padding: "var(--sp-3) var(--sp-4)",
        background: "var(--c-surface-raised, #f8f9fa)",
        display: "flex", gap: "var(--sp-3)", alignItems: "center",
        borderBottom: "1px solid var(--c-border, #e5e7eb)",
      }}>
        <label style={{ fontSize: "var(--text-sm)" }}>
          Date:{" "}
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input"
            style={{ width: "auto", display: "inline-block" }}
          />
        </label>
        <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
          Print
        </button>
        <button className="btn btn-outline btn-sm" onClick={() => window.history.back()}>
          Back
        </button>
      </div>

      {/* Printable content */}
      <div style={{
        maxWidth: 700, margin: "0 auto", padding: 32,
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 4px" }}>
            Daily Meal Schedule
          </h1>
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            {schedule.clientName}
          </div>
          <div style={{ fontSize: 14, color: "#666", marginTop: 4 }}>
            {formatDate(schedule.date)}
          </div>
        </div>

        {schedule.exclusions.length > 0 && (
          <div style={{
            padding: "8px 12px", marginBottom: 16,
            border: "2px solid #c0392b", borderRadius: 6,
            fontSize: 13, color: "#c0392b", fontWeight: 600,
          }}>
            EXCLUSIONS: {schedule.exclusions.join(", ")}
          </div>
        )}

        {schedule.meals.length === 0 ? (
          <div style={{ textAlign: "center", padding: 32, color: "#888" }}>
            No meals scheduled for this date.
          </div>
        ) : (
          <table style={{
            width: "100%", borderCollapse: "collapse", fontSize: 14,
          }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #333" }}>
                <th style={{ textAlign: "left", padding: "8px 4px" }}>Meal</th>
                <th style={{ textAlign: "left", padding: "8px 4px" }}>Recipe</th>
                <th style={{ textAlign: "left", padding: "8px 4px" }}>Allergens</th>
                <th style={{ textAlign: "center", padding: "8px 4px" }}>Svgs</th>
                <th style={{ textAlign: "center", padding: "8px 4px" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {schedule.meals.map((meal) => (
                <tr key={meal.id} style={{ borderBottom: "1px solid #ddd" }}>
                  <td style={{ padding: "10px 4px", fontWeight: 600 }}>
                    {slotLabel(meal.mealSlot)}
                  </td>
                  <td style={{ padding: "10px 4px" }}>
                    <div style={{ fontWeight: 500 }}>{meal.skuName}</div>
                    {meal.ingredients.length > 0 && (
                      <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                        {meal.ingredients.map((i) => i.name).join(", ")}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "10px 4px" }}>
                    {meal.allergens.length > 0 ? (
                      <span style={{ color: "#c0392b", fontWeight: 600, fontSize: 12 }}>
                        {meal.allergens.join(", ")}
                      </span>
                    ) : (
                      <span style={{ color: "#888", fontSize: 12 }}>None</span>
                    )}
                  </td>
                  <td style={{ padding: "10px 4px", textAlign: "center" }}>
                    {meal.servings}
                  </td>
                  <td style={{ padding: "10px 4px", textAlign: "center" }}>
                    <span style={{
                      display: "inline-block", padding: "2px 8px",
                      borderRadius: 4, fontSize: 11, fontWeight: 600,
                      background: meal.status === "DONE" ? "#dcfce7" : meal.status === "SKIPPED" ? "#fee2e2" : "#f3f4f6",
                      color: meal.status === "DONE" ? "#166534" : meal.status === "SKIPPED" ? "#991b1b" : "#374151",
                    }}>
                      {meal.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Footer */}
        <div style={{
          marginTop: 32, paddingTop: 12,
          borderTop: "1px solid #ddd",
          fontSize: 11, color: "#999", textAlign: "center",
        }}>
          Generated {new Date().toLocaleString()} &middot; Nutrition Autopilot
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; }
        }
      `}</style>
    </>
  );
}
