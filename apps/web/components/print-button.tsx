"use client";

export function PrintButton() {
  return (
    <button className="btn-outline no-print" onClick={() => window.print()}>
      Print Label
    </button>
  );
}
