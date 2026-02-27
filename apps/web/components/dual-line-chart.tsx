"use client";

/**
 * DualLineChart — Inline SVG chart with two overlaid line series.
 * Shared x-axis (dates), separate y-axes for different scales.
 * Pure CSS/SVG, no external chart libraries.
 */

export type ChartDataPoint = { date: string; value: number | null };

type DualLineChartProps = {
  series1: ChartDataPoint[];
  series2: ChartDataPoint[];
  label1: string;
  label2: string;
  color1?: string;
  color2?: string;
  unit1?: string;
  unit2?: string;
  height?: number;
};

export function DualLineChart({
  series1,
  series2,
  label1,
  label2,
  color1 = "#34d399",
  color2 = "#f59e0b",
  unit1 = "",
  unit2 = "",
  height = 200,
}: DualLineChartProps) {
  const s1 = series1.filter((p) => p.value !== null) as { date: string; value: number }[];
  const s2 = series2.filter((p) => p.value !== null) as { date: string; value: number }[];

  if (s1.length < 2 && s2.length < 2) {
    return (
      <div style={{ textAlign: "center", padding: "var(--sp-4)", color: "var(--c-ink-muted)", fontSize: "var(--text-sm)" }}>
        Not enough data points for a chart. Need at least 2 measurements.
      </div>
    );
  }

  const width = 600;
  const pad = { top: 20, right: 60, bottom: 40, left: 60 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  // Combine all dates for shared x-axis
  const allDates = Array.from(new Set([...s1.map((p) => p.date), ...s2.map((p) => p.date)])).sort();
  const dateToX = (d: string) => {
    const idx = allDates.indexOf(d);
    return pad.left + (allDates.length > 1 ? (idx / (allDates.length - 1)) * chartW : chartW / 2);
  };

  function scaleY(values: { value: number }[], padPct = 0.1) {
    if (values.length === 0) return { min: 0, max: 1, toY: () => pad.top + chartH / 2 };
    const vals = values.map((v) => v.value);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    const padded = range * padPct;
    const yMin = min - padded;
    const yMax = max + padded;
    return {
      min: yMin,
      max: yMax,
      toY: (v: number) => pad.top + chartH - ((v - yMin) / (yMax - yMin)) * chartH,
    };
  }

  const scale1 = scaleY(s1);
  const scale2 = scaleY(s2);

  const points1 = s1.map((p) => `${dateToX(p.date)},${scale1.toY(p.value)}`).join(" ");
  const points2 = s2.map((p) => `${dateToX(p.date)},${scale2.toY(p.value)}`).join(" ");

  // Show at most 6 x-axis labels
  const labelStep = Math.max(1, Math.ceil(allDates.length / 6));
  const xLabels = allDates.filter((_, i) => i % labelStep === 0);

  // Y-axis ticks (3 each)
  const yTicks1 = [0, 0.5, 1].map((t) => scale1.min + t * (scale1.max - scale1.min));
  const yTicks2 = [0, 0.5, 1].map((t) => scale2.min + t * (scale2.max - scale2.min));

  return (
    <div>
      {/* Legend */}
      <div style={{ display: "flex", gap: "var(--sp-4)", marginBottom: "var(--sp-2)", fontSize: "var(--text-xs)" }}>
        <span><span style={{ display: "inline-block", width: 12, height: 3, background: color1, borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />{label1}</span>
        <span><span style={{ display: "inline-block", width: 12, height: 3, background: color2, borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />{label2}</span>
      </div>

      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ overflow: "visible" }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <line
            key={t}
            x1={pad.left}
            x2={pad.left + chartW}
            y1={pad.top + (1 - t) * chartH}
            y2={pad.top + (1 - t) * chartH}
            stroke="var(--c-border, #e5e7eb)"
            strokeWidth={0.5}
          />
        ))}

        {/* Left Y-axis ticks */}
        {yTicks1.map((val, i) => (
          <text
            key={`y1-${i}`}
            x={pad.left - 6}
            y={scale1.toY(val)}
            textAnchor="end"
            fill={color1}
            fontSize={9}
            dominantBaseline="middle"
          >
            {Math.round(val)}{unit1}
          </text>
        ))}

        {/* Right Y-axis ticks */}
        {yTicks2.map((val, i) => (
          <text
            key={`y2-${i}`}
            x={pad.left + chartW + 6}
            y={scale2.toY(val)}
            textAnchor="start"
            fill={color2}
            fontSize={9}
            dominantBaseline="middle"
          >
            {Math.round(val)}{unit2}
          </text>
        ))}

        {/* X-axis labels */}
        {xLabels.map((d) => (
          <text
            key={d}
            x={dateToX(d)}
            y={pad.top + chartH + 16}
            textAnchor="middle"
            fill="var(--c-ink-muted, #999)"
            fontSize={9}
          >
            {d.slice(5)}
          </text>
        ))}

        {/* Series lines */}
        {s1.length >= 2 && (
          <polyline
            points={points1}
            fill="none"
            stroke={color1}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {s2.length >= 2 && (
          <polyline
            points={points2}
            fill="none"
            stroke={color2}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Data dots */}
        {s1.map((p) => (
          <circle key={`d1-${p.date}`} cx={dateToX(p.date)} cy={scale1.toY(p.value)} r={3} fill={color1} />
        ))}
        {s2.map((p) => (
          <circle key={`d2-${p.date}`} cx={dateToX(p.date)} cy={scale2.toY(p.value)} r={3} fill={color2} />
        ))}
      </svg>
    </div>
  );
}
