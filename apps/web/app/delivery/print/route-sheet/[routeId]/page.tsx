"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

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

type RouteSheetStop = {
  stopNumber: number;
  clientName: string;
  clientPhone: string | null;
  deliveryAddress: string | null;
  deliveryNotes: string | null;
  deliveryZone: string | null;
  status: string;
  itemCount: number;
  items: { skuName: string; mealSlot: string }[];
};

type RouteSheetData = {
  routeId: string;
  routeDate: string;
  routeName: string;
  driverName: string | null;
  notes: string | null;
  status: string;
  totalStops: number;
  stops: RouteSheetStop[];
};

export default function RouteSheetPrint() {
  const params = useParams();
  const routeId = params.routeId as string;
  const [data, setData] = useState<RouteSheetData | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${resolveApiBase()}/v1/print/route-sheet/${routeId}`);
        if (res.ok) {
          setData(await res.json());
        }
      } catch {
        // silently fail
      }
    })();
  }, [routeId]);

  if (!data) {
    return <div className="print-page"><p>Loading route sheet...</p></div>;
  }

  return (
    <div className="print-page">
      <style>{`
        @media print {
          body { margin: 0; font-size: 11pt; }
          .no-print { display: none !important; }
          .print-page { padding: 0.5in; }
          .stop-card { page-break-inside: avoid; }
        }
        .stop-card { border: 1px solid #ccc; border-radius: 6px; padding: 12px; margin-bottom: 12px; }
        .stop-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
        .stop-num { font-size: 16pt; font-weight: 700; color: #333; min-width: 2rem; }
        .stop-meta { font-size: 10pt; color: #666; }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.5rem" }}>
        <h1 style={{ fontSize: "18pt", margin: 0 }}>Route Sheet</h1>
        <button className="btn btn-outline no-print" onClick={() => window.print()}>
          Print
        </button>
      </div>

      <div style={{ marginBottom: "1rem", lineHeight: 1.6 }}>
        <div><strong>Route:</strong> {data.routeName}</div>
        <div><strong>Date:</strong> {data.routeDate}</div>
        {data.driverName && <div><strong>Driver:</strong> {data.driverName}</div>}
        <div><strong>Stops:</strong> {data.totalStops}</div>
        {data.notes && <div><strong>Notes:</strong> {data.notes}</div>}
      </div>

      {data.stops.map((stop) => (
        <div key={stop.stopNumber} className="stop-card">
          <div className="stop-header">
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem" }}>
              <span className="stop-num">#{stop.stopNumber}</span>
              <span style={{ fontSize: "13pt", fontWeight: 600 }}>{stop.clientName}</span>
            </div>
            <div className="stop-meta">
              {stop.itemCount} meal{stop.itemCount !== 1 ? "s" : ""}
              {stop.deliveryZone && ` \u00b7 ${stop.deliveryZone}`}
            </div>
          </div>

          {stop.deliveryAddress && (
            <div style={{ marginBottom: "4px" }}>
              <strong>Address:</strong> {stop.deliveryAddress}
            </div>
          )}
          {stop.clientPhone && (
            <div style={{ marginBottom: "4px", fontSize: "10pt" }}>
              <strong>Phone:</strong> {stop.clientPhone}
            </div>
          )}
          {stop.deliveryNotes && (
            <div style={{ marginBottom: "4px", fontSize: "10pt", fontStyle: "italic", color: "#666" }}>
              {stop.deliveryNotes}
            </div>
          )}

          <div style={{ marginTop: "6px", fontSize: "10pt" }}>
            <strong>Items:</strong>{" "}
            {stop.items.map((item, i) => (
              <span key={i}>
                {item.skuName} ({item.mealSlot})
                {i < stop.items.length - 1 ? ", " : ""}
              </span>
            ))}
          </div>

          {/* Delivery confirmation checkbox */}
          <div style={{ marginTop: "8px", paddingTop: "6px", borderTop: "1px dashed #ccc", display: "flex", gap: "2rem", fontSize: "10pt" }}>
            <span>&#x2610; Delivered</span>
            <span>&#x2610; Failed &mdash; Reason: _________________________</span>
          </div>
        </div>
      ))}
    </div>
  );
}
