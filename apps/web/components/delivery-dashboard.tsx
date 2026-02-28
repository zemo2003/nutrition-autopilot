"use client";

import Link from "next/link";
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

type FulfillmentOrder = {
  id: string;
  clientId: string;
  clientName: string;
  deliveryDate: string;
  status: string;
  deliveryAddress: string | null;
  deliveryNotes: string | null;
  deliveryZone: string | null;
  itemCount: number;
  packedCount: number;
  packedAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  route: { id: string; name: string; stopOrder: number } | null;
  items: {
    id: string;
    mealScheduleId: string;
    skuName: string;
    mealSlot: string;
    packed: boolean;
  }[];
};

const STATUS_PIPELINE = ["PENDING", "PACKING", "PACKED", "DISPATCHED", "DELIVERED"] as const;

function statusColor(s: string) {
  switch (s) {
    case "PENDING": return "#6b6b76";
    case "PACKING": return "#f59e0b";
    case "PACKED": return "#60a5fa";
    case "DISPATCHED": return "#a78bfa";
    case "DELIVERED": return "#34d399";
    case "FAILED": return "#ef4444";
    default: return "#6b6b76";
  }
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function DeliveryDashboard() {
  const [orders, setOrders] = useState<FulfillmentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedDate, setSelectedDate] = useState(formatDate(new Date()));
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch(`${resolveApiBase()}/v1/fulfillment?date=${selectedDate}`);
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

  const generateOrders = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`${resolveApiBase()}/v1/fulfillment/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: selectedDate }),
      });
      if (res.ok) {
        const result = await res.json();
        setError(null);
        await fetchOrders();
        if (result.created === 0 && result.existing === 0) {
          setError("No PLANNED schedules found for this date.");
        }
      } else {
        setError("Failed to generate orders");
      }
    } catch {
      setError("Failed to generate orders");
    } finally {
      setGenerating(false);
    }
  };

  const updateStatus = async (orderId: string, status: string) => {
    try {
      await fetch(`${resolveApiBase()}/v1/fulfillment/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await fetchOrders();
    } catch {
      // silently fail
    }
  };

  // Pipeline counts
  const counts: Record<string, number> = {};
  for (const s of STATUS_PIPELINE) counts[s] = 0;
  counts["FAILED"] = 0;
  for (const o of orders) {
    counts[o.status] = (counts[o.status] ?? 0) + 1;
  }

  const totalMeals = orders.reduce((sum, o) => sum + o.itemCount, 0);
  const packedMeals = orders.reduce((sum, o) => sum + o.packedCount, 0);

  // Alerts
  const missingAddress = orders.filter((o) => !o.deliveryAddress);
  const overdue = orders.filter(
    (o) => o.status === "PENDING" || o.status === "PACKING",
  );

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Delivery Dashboard</h1>
          <p className="page-subtitle">Pack. Route. Deliver.</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="date"
            className="form-input"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
          <button
            className="btn btn-primary"
            onClick={generateOrders}
            disabled={generating}
          >
            {generating ? "Generating..." : "Generate Orders"}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-warning" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {/* Status pipeline */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", gap: "0.25rem", alignItems: "center", flexWrap: "wrap" }}>
          {STATUS_PIPELINE.map((s, i) => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
              <div
                style={{
                  background: statusColor(s),
                  color: "#fff",
                  borderRadius: "999px",
                  padding: "0.35rem 0.9rem",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  minWidth: "3rem",
                  textAlign: "center",
                }}
              >
                {s} ({counts[s] ?? 0})
              </div>
              {i < STATUS_PIPELINE.length - 1 && (
                <span style={{ color: "var(--c-ink-muted)", fontSize: "0.9rem" }}>&rarr;</span>
              )}
            </div>
          ))}
          {counts["FAILED"] > 0 && (
            <div
              style={{
                background: statusColor("FAILED"),
                color: "#fff",
                borderRadius: "999px",
                padding: "0.35rem 0.9rem",
                fontSize: "0.8rem",
                fontWeight: 600,
                marginLeft: "0.5rem",
              }}
            >
              FAILED ({counts["FAILED"]})
            </div>
          )}
        </div>
      </div>

      {/* Summary stats */}
      <div className="stat-grid" style={{ marginBottom: "1.5rem" }}>
        <div className="stat-card">
          <div className="stat-value">{orders.length}</div>
          <div className="stat-label">Total Orders</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalMeals}</div>
          <div className="stat-label">Total Meals</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{packedMeals}</div>
          <div className="stat-label">Meals Packed</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{counts["DELIVERED"] ?? 0}</div>
          <div className="stat-label">Delivered</div>
        </div>
      </div>

      {/* Alerts */}
      {missingAddress.length > 0 && (
        <div className="alert alert-warning" style={{ marginBottom: "1rem" }}>
          <strong>{missingAddress.length} client{missingAddress.length > 1 ? "s" : ""}</strong> missing delivery address:{" "}
          {missingAddress.map((o) => o.clientName).join(", ")}
        </div>
      )}

      {/* Order cards */}
      {loading ? (
        <div className="loading-page">
          <div className="loading-shimmer loading-block" />
          <div className="loading-shimmer loading-block" />
        </div>
      ) : orders.length === 0 ? (
        <div className="card">
          <div className="state-box">
            <div className="state-icon">&#x1F4E6;</div>
            <div className="state-title">No Orders for This Date</div>
            <div className="state-desc">
              Click &quot;Generate Orders&quot; to create fulfillment orders from planned schedules.
            </div>
          </div>
        </div>
      ) : (
        <div className="card-grid">
          {orders.map((order) => (
            <div key={order.id} className="card" style={{ padding: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "1rem" }}>{order.clientName}</div>
                  {order.deliveryZone && (
                    <span
                      className="badge"
                      style={{ background: "#60a5fa", color: "#fff", fontSize: "0.7rem", marginTop: "0.25rem" }}
                    >
                      {order.deliveryZone}
                    </span>
                  )}
                </div>
                <span
                  className="badge"
                  style={{ background: statusColor(order.status), color: "#fff", fontSize: "0.7rem" }}
                >
                  {order.status}
                </span>
              </div>

              <div style={{ fontSize: "0.85rem", color: "var(--c-ink-soft)", marginBottom: "0.5rem" }}>
                {order.itemCount} meal{order.itemCount !== 1 ? "s" : ""} &middot;{" "}
                {order.packedCount}/{order.itemCount} packed
              </div>

              {order.deliveryAddress && (
                <div style={{ fontSize: "0.8rem", color: "var(--c-ink-muted)", marginBottom: "0.5rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {order.deliveryAddress}
                </div>
              )}

              {order.route && (
                <div style={{ fontSize: "0.8rem", color: "var(--c-ink-muted)", marginBottom: "0.5rem" }}>
                  Route: {order.route.name} (Stop #{order.route.stopOrder})
                </div>
              )}

              {/* Quick action buttons */}
              <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
                {order.status === "PENDING" && (
                  <button className="btn btn-sm btn-outline" onClick={() => updateStatus(order.id, "PACKING")}>
                    Start Packing
                  </button>
                )}
                {order.status === "PACKING" && (
                  <button className="btn btn-sm btn-outline" onClick={() => updateStatus(order.id, "PACKED")}>
                    Mark Packed
                  </button>
                )}
                {order.status === "PACKED" && (
                  <button className="btn btn-sm btn-outline" onClick={() => updateStatus(order.id, "DISPATCHED")}>
                    Dispatch
                  </button>
                )}
                {order.status === "DISPATCHED" && (
                  <button className="btn btn-sm btn-success" onClick={() => updateStatus(order.id, "DELIVERED")}>
                    Delivered
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
