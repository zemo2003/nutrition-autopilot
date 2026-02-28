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

type PackingSlipData = {
  orderId: string;
  deliveryDate: string;
  client: {
    name: string;
    exclusions: string[];
    preferences: string | null;
  };
  deliveryAddress: string | null;
  deliveryNotes: string | null;
  deliveryZone: string | null;
  status: string;
  items: {
    id: string;
    skuName: string;
    mealSlot: string;
    servingSizeG: number | null;
    packed: boolean;
  }[];
  totalItems: number;
  packedItems: number;
};

export default function PackingSlipPrint() {
  const params = useParams();
  const fulfillmentId = params.fulfillmentId as string;
  const [data, setData] = useState<PackingSlipData | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${resolveApiBase()}/v1/print/packing-slip/${fulfillmentId}`);
        if (res.ok) {
          setData(await res.json());
        }
      } catch {
        // silently fail
      }
    })();
  }, [fulfillmentId]);

  if (!data) {
    return <div className="print-page"><p>Loading packing slip...</p></div>;
  }

  return (
    <div className="print-page">
      <style>{`
        @media print {
          body { margin: 0; font-size: 11pt; }
          .no-print { display: none !important; }
          .print-page { padding: 0.5in; }
        }
        .slip-table { width: 100%; border-collapse: collapse; margin: 0.75rem 0; }
        .slip-table th, .slip-table td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
        .slip-table th { background: #f5f5f5; font-weight: 600; }
        .checkbox-col { width: 40px; text-align: center; }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.5rem" }}>
        <h1 style={{ fontSize: "18pt", margin: 0 }}>Packing Slip</h1>
        <button className="btn btn-outline no-print" onClick={() => window.print()}>
          Print
        </button>
      </div>

      <div style={{ marginBottom: "1rem", lineHeight: 1.6 }}>
        <div><strong>Client:</strong> {data.client.name}</div>
        <div><strong>Date:</strong> {data.deliveryDate}</div>
        {data.deliveryAddress && <div><strong>Address:</strong> {data.deliveryAddress}</div>}
        {data.deliveryZone && <div><strong>Zone:</strong> {data.deliveryZone}</div>}
        {data.deliveryNotes && <div><strong>Notes:</strong> {data.deliveryNotes}</div>}
        {data.client.exclusions && data.client.exclusions.length > 0 && (
          <div style={{ color: "red", fontWeight: 600 }}>
            Exclusions: {data.client.exclusions.join(", ")}
          </div>
        )}
      </div>

      <table className="slip-table">
        <thead>
          <tr>
            <th className="checkbox-col">&#x2610;</th>
            <th>Meal</th>
            <th>Slot</th>
            <th>Size</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => (
            <tr key={item.id}>
              <td className="checkbox-col" style={{ fontSize: "1.2rem" }}>
                {item.packed ? "\u2611" : "\u2610"}
              </td>
              <td>{item.skuName}</td>
              <td>{item.mealSlot}</td>
              <td>{item.servingSizeG ? `${item.servingSizeG}g` : "\u2014"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: "1rem", fontSize: "10pt", color: "#666" }}>
        {data.packedItems}/{data.totalItems} items packed &middot; Order ID: {data.orderId.slice(0, 8)}
      </div>
    </div>
  );
}
