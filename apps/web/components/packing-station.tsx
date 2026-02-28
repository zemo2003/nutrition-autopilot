"use client";

import { useEffect, useState, useCallback } from "react";

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

type FulfillmentItem = {
  id: string;
  mealScheduleId: string;
  skuName: string;
  mealSlot: string;
  servingSizeG: number | null;
  packed: boolean;
};

type FulfillmentOrder = {
  id: string;
  clientId: string;
  clientName: string;
  clientExclusions: string[];
  deliveryDate: string;
  status: string;
  deliveryAddress: string | null;
  deliveryNotes: string | null;
  deliveryZone: string | null;
  items: FulfillmentItem[];
};

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function PackingStation() {
  const [orders, setOrders] = useState<FulfillmentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(formatDate(new Date()));

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch(
        `${resolveApiBase()}/v1/fulfillment?date=${selectedDate}&status=PENDING,PACKING`,
      );
      if (res.ok) {
        const data = await res.json();
        setOrders(Array.isArray(data) ? data : data.orders ?? []);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    setLoading(true);
    fetchOrders();
  }, [fetchOrders]);

  const togglePacked = async (orderId: string, itemId: string) => {
    try {
      await fetch(`${resolveApiBase()}/v1/fulfillment/${orderId}/items/${itemId}/pack`, {
        method: "PATCH",
      });
      await fetchOrders();
    } catch {
      // silently fail
    }
  };

  const markPacked = async (orderId: string) => {
    try {
      await fetch(`${resolveApiBase()}/v1/fulfillment/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PACKED" }),
      });
      await fetchOrders();
    } catch {
      // silently fail
    }
  };

  const printPackingSlip = (orderId: string) => {
    window.open(`/delivery/print/packing-slip/${orderId}`, "_blank");
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Packing Station</h1>
          <p className="page-subtitle">Check off meals as you pack each client&apos;s order</p>
        </div>
        <input
          type="date"
          className="form-input"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="loading-page">
          <div className="loading-shimmer loading-block" />
          <div className="loading-shimmer loading-block" />
        </div>
      ) : orders.length === 0 ? (
        <div className="card">
          <div className="state-box">
            <div className="state-icon">&#x2705;</div>
            <div className="state-title">All Packed</div>
            <div className="state-desc">
              No orders waiting to be packed for this date.
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {orders.map((order) => {
            const isExpanded = expandedId === order.id;
            const allPacked = order.items.every((i) => i.packed);
            const packedCount = order.items.filter((i) => i.packed).length;

            return (
              <div key={order.id} className="card" style={{ padding: 0, overflow: "hidden" }}>
                {/* Header — clickable to expand */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : order.id)}
                  style={{
                    width: "100%",
                    padding: "1rem",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    cursor: "pointer",
                    background: "none",
                    border: "none",
                    textAlign: "left",
                    font: "inherit",
                    color: "inherit",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "1rem" }}>{order.clientName}</div>
                    <div style={{ fontSize: "0.85rem", color: "var(--c-ink-muted)" }}>
                      {order.items.length} meal{order.items.length !== 1 ? "s" : ""} &middot;{" "}
                      {packedCount}/{order.items.length} packed
                      {order.deliveryZone && ` \u00b7 ${order.deliveryZone}`}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span
                      className="badge"
                      style={{
                        background: allPacked ? "var(--c-success)" : "var(--c-warn)",
                        color: "#fff",
                        fontSize: "0.7rem",
                      }}
                    >
                      {allPacked ? "READY" : order.status}
                    </span>
                    <span style={{ fontSize: "1.2rem", color: "var(--c-ink-muted)" }}>
                      {isExpanded ? "\u25B2" : "\u25BC"}
                    </span>
                  </div>
                </button>

                {/* Expanded items checklist */}
                {isExpanded && (
                  <div style={{ borderTop: "1px solid var(--c-border)", padding: "1rem" }}>
                    {order.clientExclusions && order.clientExclusions.length > 0 && (
                      <div
                        className="alert alert-warning"
                        style={{ marginBottom: "0.75rem", fontSize: "0.85rem" }}
                      >
                        <strong>Exclusions:</strong> {order.clientExclusions.join(", ")}
                      </div>
                    )}

                    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                      {order.items.map((item) => (
                        <label
                          key={item.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.75rem",
                            padding: "0.5rem",
                            borderRadius: "0.5rem",
                            background: item.packed ? "var(--c-success-soft)" : "var(--c-surface-alt)",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={item.packed}
                            onChange={() => togglePacked(order.id, item.id)}
                            style={{ width: "1.2rem", height: "1.2rem" }}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 500, textDecoration: item.packed ? "line-through" : "none" }}>
                              {item.skuName}
                            </div>
                            <div style={{ fontSize: "0.8rem", color: "var(--c-ink-muted)" }}>
                              {item.mealSlot}
                              {item.servingSizeG && ` \u00b7 ${item.servingSizeG}g`}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>

                    <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                      <button
                        className="btn btn-primary"
                        disabled={!allPacked}
                        onClick={() => markPacked(order.id)}
                      >
                        {allPacked ? "Mark as Packed" : `${order.items.length - packedCount} remaining`}
                      </button>
                      <button
                        className="btn btn-outline"
                        onClick={() => printPackingSlip(order.id)}
                      >
                        Print Slip
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
