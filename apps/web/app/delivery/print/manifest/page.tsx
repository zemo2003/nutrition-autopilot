"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

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

type ManifestItem = {
  skuName: string;
  mealSlot: string;
  servingSizeG: number | null;
  packed: boolean;
};

type ManifestOrder = {
  id: string;
  clientName: string;
  status: string;
  deliveryAddress: string | null;
  deliveryNotes: string | null;
  items: ManifestItem[];
};

type ManifestZone = {
  zone: string;
  orderCount: number;
  orders: ManifestOrder[];
};

type ManifestData = {
  date: string;
  totalOrders: number;
  totalItems: number;
  zones: ManifestZone[];
};

export default function DeliveryManifestPrint() {
  const searchParams = useSearchParams();
  const date = searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const [data, setData] = useState<ManifestData | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${resolveApiBase()}/v1/print/delivery-manifest/${date}`);
        if (res.ok) {
          setData(await res.json());
        }
      } catch {
        // silently fail
      }
    })();
  }, [date]);

  if (!data) {
    return <div className="print-page"><p>Loading manifest...</p></div>;
  }

  return (
    <div className="print-page">
      <style>{`
        @media print {
          body { margin: 0; font-size: 11pt; }
          .no-print { display: none !important; }
          .print-page { padding: 0.5in; }
        }
        .manifest-table { width: 100%; border-collapse: collapse; margin: 0.5rem 0 1.5rem; }
        .manifest-table th, .manifest-table td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; font-size: 10pt; }
        .manifest-table th { background: #f5f5f5; font-weight: 600; }
        .zone-header { font-size: 14pt; font-weight: 700; margin: 1rem 0 0.3rem; border-bottom: 2px solid #333; padding-bottom: 0.25rem; }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1rem" }}>
        <div>
          <h1 style={{ fontSize: "18pt", margin: 0 }}>Delivery Manifest</h1>
          <p style={{ margin: "0.25rem 0", color: "#666" }}>
            {data.date} &middot; {data.totalOrders} orders &middot; {data.totalItems} meals
          </p>
        </div>
        <button className="btn btn-outline no-print" onClick={() => window.print()}>
          Print
        </button>
      </div>

      {data.zones.map((zone) => (
        <div key={zone.zone}>
          <div className="zone-header">{zone.zone} ({zone.orderCount})</div>
          <table className="manifest-table">
            <thead>
              <tr>
                <th style={{ width: "20%" }}>Client</th>
                <th style={{ width: "30%" }}>Address</th>
                <th style={{ width: "35%" }}>Meals</th>
                <th style={{ width: "15%" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {zone.orders.map((order) => (
                <tr key={order.id}>
                  <td style={{ fontWeight: 500 }}>{order.clientName}</td>
                  <td>
                    {order.deliveryAddress ?? "No address"}
                    {order.deliveryNotes && (
                      <div style={{ fontSize: "9pt", color: "#666", fontStyle: "italic" }}>
                        {order.deliveryNotes}
                      </div>
                    )}
                  </td>
                  <td>
                    {order.items.map((item, i) => (
                      <span key={i}>
                        {item.skuName}
                        {item.servingSizeG ? ` (${item.servingSizeG}g)` : ""}
                        {i < order.items.length - 1 ? ", " : ""}
                      </span>
                    ))}
                  </td>
                  <td>{order.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
