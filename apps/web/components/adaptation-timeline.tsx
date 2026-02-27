"use client";

/**
 * Adaptation Timeline
 *
 * Vertical timeline showing nutrition shifts on the left and physiology responses
 * on the right. Connected by a timeline line showing the lag (2-6 weeks).
 * Color-coded: green=favorable, yellow=neutral, red=adverse.
 */

export interface NutritionShiftItem {
  weekStart: string;
  shiftType: string;
  magnitude: number;
  description: string;
}

export interface PhysiologyResponseItem {
  shiftDate: string;
  responseDate: string;
  lagWeeks: number;
  metric: string;
  direction: "improved" | "worsened" | "unchanged";
  magnitude: number;
  description: string;
}

type Props = {
  shifts: NutritionShiftItem[];
  responses: PhysiologyResponseItem[];
};

type TimelineEvent = {
  date: string;
  side: "left" | "right";
  label: string;
  description: string;
  color: string;
  linkedDate?: string;
  lagWeeks?: number;
};

function formatDate(d: string): string {
  const parts = d.split("-");
  if (parts.length < 3) return d;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(parts[1]!, 10) - 1]} ${parseInt(parts[2]!, 10)}`;
}

function shiftIcon(shiftType: string): string {
  if (shiftType.includes("increase")) return "↑";
  if (shiftType.includes("decrease")) return "↓";
  return "↔";
}

function responseColor(direction: "improved" | "worsened" | "unchanged"): string {
  if (direction === "improved") return "#22c55e";
  if (direction === "worsened") return "#ef4444";
  return "#f59e0b";
}

function shiftColor(shiftType: string): string {
  // Kcal decrease or protein increase = intentional intervention (blue)
  if (shiftType === "kcal_decrease" || shiftType === "protein_increase") return "#3b82f6";
  // Kcal increase or protein decrease = potential concern (orange)
  if (shiftType === "kcal_increase" || shiftType === "protein_decrease") return "#f59e0b";
  return "#8b5cf6";
}

export function AdaptationTimeline({ shifts, responses }: Props) {
  if (shifts.length === 0 && responses.length === 0) {
    return (
      <div style={{ color: "var(--c-ink-muted)", fontSize: "var(--text-sm)", padding: "var(--sp-3)" }}>
        Not enough data to detect adaptation patterns. Need at least 5 weeks of nutrition history with biometric measurements.
      </div>
    );
  }

  // Build a unified timeline of events
  const events: TimelineEvent[] = [];

  for (const shift of shifts) {
    events.push({
      date: shift.weekStart,
      side: "left",
      label: `${shiftIcon(shift.shiftType)} ${shift.shiftType.replace(/_/g, " ")}`,
      description: shift.description,
      color: shiftColor(shift.shiftType),
    });
  }

  for (const resp of responses) {
    events.push({
      date: resp.responseDate,
      side: "right",
      label: `${resp.metric.replace(/_/g, " ")} — ${resp.direction}`,
      description: resp.description,
      color: responseColor(resp.direction),
      linkedDate: resp.shiftDate,
      lagWeeks: resp.lagWeeks,
    });
  }

  // Sort by date
  events.sort((a, b) => a.date.localeCompare(b.date));

  if (events.length === 0) {
    return (
      <div style={{ color: "var(--c-ink-muted)", fontSize: "var(--text-sm)", padding: "var(--sp-3)" }}>
        No nutrition shifts or physiology responses detected in the current period.
      </div>
    );
  }

  return (
    <div style={{ position: "relative", padding: "var(--sp-2) 0" }}>
      {/* Legend */}
      <div style={{ display: "flex", gap: "var(--sp-3)", marginBottom: "var(--sp-3)", flexWrap: "wrap", fontSize: "var(--text-xs)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#3b82f6", display: "inline-block" }} />
          Intentional shift
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b", display: "inline-block" }} />
          Caution shift
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
          Favorable response
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />
          Adverse response
        </span>
      </div>

      {/* Timeline spine */}
      <div style={{ position: "relative" }}>
        {/* Vertical line */}
        <div style={{
          position: "absolute",
          left: "50%",
          top: 0,
          bottom: 0,
          width: 2,
          background: "var(--c-border, #e5e7eb)",
          transform: "translateX(-50%)",
          zIndex: 0,
        }} />

        {events.map((event, i) => (
          <div
            key={`${event.date}-${event.side}-${i}`}
            style={{
              display: "flex",
              alignItems: "flex-start",
              marginBottom: "var(--sp-3)",
              position: "relative",
              zIndex: 1,
            }}
          >
            {/* Left side (nutrition shifts) */}
            <div style={{
              flex: 1,
              display: "flex",
              justifyContent: "flex-end",
              paddingRight: "var(--sp-3)",
            }}>
              {event.side === "left" ? (
                <div style={{
                  background: "var(--c-surface-raised, #f8f9fa)",
                  border: `2px solid ${event.color}`,
                  borderRadius: "var(--r-md, 8px)",
                  padding: "var(--sp-2)",
                  maxWidth: 260,
                  fontSize: "var(--text-xs)",
                }}>
                  <div style={{ fontWeight: 700, color: event.color, marginBottom: 2, textTransform: "capitalize" }}>
                    {event.label}
                  </div>
                  <div style={{ color: "var(--c-ink-muted)" }}>{event.description}</div>
                  <div style={{ fontSize: 10, color: "var(--c-ink-faint, #b0b0b0)", marginTop: 2 }}>
                    {formatDate(event.date)}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Center dot */}
            <div style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: event.color,
              border: "2px solid var(--c-surface, #fff)",
              flexShrink: 0,
              marginTop: 4,
              zIndex: 2,
              boxShadow: "0 0 0 2px var(--c-border, #e5e7eb)",
            }} />

            {/* Right side (physiology responses) */}
            <div style={{
              flex: 1,
              paddingLeft: "var(--sp-3)",
            }}>
              {event.side === "right" ? (
                <div style={{
                  background: "var(--c-surface-raised, #f8f9fa)",
                  border: `2px solid ${event.color}`,
                  borderRadius: "var(--r-md, 8px)",
                  padding: "var(--sp-2)",
                  maxWidth: 260,
                  fontSize: "var(--text-xs)",
                }}>
                  <div style={{ fontWeight: 700, color: event.color, marginBottom: 2, textTransform: "capitalize" }}>
                    {event.label}
                  </div>
                  <div style={{ color: "var(--c-ink-muted)" }}>{event.description}</div>
                  {event.lagWeeks != null && (
                    <div style={{ fontSize: 10, color: "var(--c-ink-faint, #b0b0b0)", marginTop: 2 }}>
                      {formatDate(event.date)} · {event.lagWeeks}w after shift
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {/* Summary */}
      {(shifts.length > 0 || responses.length > 0) && (
        <div style={{
          marginTop: "var(--sp-3)",
          padding: "var(--sp-2) var(--sp-3)",
          background: "var(--c-surface-raised, #f8f9fa)",
          borderRadius: "var(--r-md, 8px)",
          fontSize: "var(--text-xs)",
          display: "flex",
          gap: "var(--sp-4)",
          flexWrap: "wrap",
        }}>
          <span><strong>{shifts.length}</strong> nutrition shift{shifts.length !== 1 ? "s" : ""} detected</span>
          <span><strong>{responses.length}</strong> physiology response{responses.length !== 1 ? "s" : ""} observed</span>
          {responses.filter((r) => r.direction === "improved").length > 0 && (
            <span style={{ color: "#22c55e" }}>
              <strong>{responses.filter((r) => r.direction === "improved").length}</strong> favorable
            </span>
          )}
          {responses.filter((r) => r.direction === "worsened").length > 0 && (
            <span style={{ color: "#ef4444" }}>
              <strong>{responses.filter((r) => r.direction === "worsened").length}</strong> adverse
            </span>
          )}
        </div>
      )}
    </div>
  );
}
