"use client";

/**
 * Sparkline — Inline SVG sparkline chart.
 * Pure CSS/SVG, no external chart libraries.
 */

type SparklinePoint = { x: number; y: number };

type SparklineProps = {
  data: SparklinePoint[];
  width?: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
  showLatestDot?: boolean;
  strokeWidth?: number;
};

export function Sparkline({
  data,
  width = 120,
  height = 40,
  color = "#6366f1",
  fillOpacity = 0.1,
  showLatestDot = true,
  strokeWidth = 1.5,
}: SparklineProps) {
  if (data.length < 2) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <text x={width / 2} y={height / 2} textAnchor="middle" fill="#999" fontSize={10}>
          —
        </text>
      </svg>
    );
  }

  const padding = 4;
  const chartW = width - padding * 2;
  const chartH = height - padding * 2;

  const yValues = data.map((d) => d.y);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const rangeY = maxY - minY || 1;

  const xValues = data.map((d) => d.x);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const rangeX = maxX - minX || 1;

  const points = data.map((d) => ({
    px: padding + ((d.x - minX) / rangeX) * chartW,
    py: padding + chartH - ((d.y - minY) / rangeY) * chartH,
  }));

  const linePoints = points.map((p) => `${p.px},${p.py}`).join(" ");
  const lastPoint = points[points.length - 1]!;

  // Area fill path
  const areaPath = `M ${points[0]!.px},${padding + chartH} ` +
    points.map((p) => `L ${p.px},${p.py}`).join(" ") +
    ` L ${lastPoint.px},${padding + chartH} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {/* Gradient fill */}
      <path d={areaPath} fill={color} opacity={fillOpacity} />
      {/* Line */}
      <polyline
        points={linePoints}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Latest dot */}
      {showLatestDot && (
        <circle cx={lastPoint.px} cy={lastPoint.py} r={3} fill={color} />
      )}
    </svg>
  );
}
