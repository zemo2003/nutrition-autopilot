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

type RouteStop = {
  id: string;
  stopOrder: number;
  fulfillmentOrderId: string;
  clientName: string;
  deliveryAddress: string | null;
  deliveryZone: string | null;
  status: string;
};

type DeliveryRoute = {
  id: string;
  routeDate: string;
  name: string;
  driverName: string | null;
  notes: string | null;
  status: string;
  dispatchedAt: string | null;
  completedAt: string | null;
  stopCount: number;
  stops: RouteStop[];
};

type UnassignedOrder = {
  id: string;
  clientName: string;
  deliveryAddress: string | null;
  deliveryZone: string | null;
  itemCount: number;
};

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function statusColor(s: string) {
  switch (s) {
    case "PLANNING": return "#f59e0b";
    case "DISPATCHED": return "#a78bfa";
    case "COMPLETE": return "#34d399";
    default: return "#6b6b76";
  }
}

export function RouteManager() {
  const [routes, setRoutes] = useState<DeliveryRoute[]>([]);
  const [unassigned, setUnassigned] = useState<UnassignedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(formatDate(new Date()));
  const [showCreate, setShowCreate] = useState(false);
  const [newRouteName, setNewRouteName] = useState("");
  const [newDriverName, setNewDriverName] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const [routesRes, ordersRes] = await Promise.all([
        fetch(`${resolveApiBase()}/v1/routes?date=${selectedDate}`),
        fetch(`${resolveApiBase()}/v1/fulfillment?date=${selectedDate}&status=PACKED`),
      ]);

      if (routesRes.ok) {
        setRoutes(await routesRes.json());
      }

      if (ordersRes.ok) {
        const allPacked: FulfillmentOrderSummary[] = await ordersRes.json();
        // Filter to those NOT already on a route
        setUnassigned(
          allPacked
            .filter((o) => !o.route)
            .map((o) => ({
              id: o.id,
              clientName: o.clientName,
              deliveryAddress: o.deliveryAddress,
              deliveryZone: o.deliveryZone,
              itemCount: o.itemCount,
            })),
        );
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  const createRoute = async () => {
    if (!newRouteName.trim()) return;
    try {
      await fetch(`${resolveApiBase()}/v1/routes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routeDate: selectedDate,
          name: newRouteName.trim(),
          driverName: newDriverName.trim() || undefined,
        }),
      });
      setNewRouteName("");
      setNewDriverName("");
      setShowCreate(false);
      await fetchData();
    } catch {
      // silently fail
    }
  };

  const addToRoute = async (routeId: string, orderId: string) => {
    // Find max stopOrder
    const route = routes.find((r) => r.id === routeId);
    const maxOrder = route?.stops.reduce((max, s) => Math.max(max, s.stopOrder), 0) ?? 0;

    try {
      await fetch(`${resolveApiBase()}/v1/routes/${routeId}/stops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stops: [{ fulfillmentOrderId: orderId, stopOrder: maxOrder + 1 }],
        }),
      });
      await fetchData();
    } catch {
      // silently fail
    }
  };

  const removeStop = async (routeId: string, stopId: string) => {
    try {
      await fetch(`${resolveApiBase()}/v1/routes/${routeId}/stops/${stopId}`, {
        method: "DELETE",
      });
      await fetchData();
    } catch {
      // silently fail
    }
  };

  const dispatchRoute = async (routeId: string) => {
    try {
      await fetch(`${resolveApiBase()}/v1/routes/${routeId}/dispatch`, {
        method: "POST",
      });
      await fetchData();
    } catch {
      // silently fail
    }
  };

  const printRouteSheet = (routeId: string) => {
    window.open(`/delivery/print/route-sheet/${routeId}`, "_blank");
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Route Manager</h1>
          <p className="page-subtitle">Organize packed orders into delivery routes</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="date"
            className="form-input"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            New Route
          </button>
        </div>
      </div>

      {/* Create route form */}
      {showCreate && (
        <div className="card" style={{ marginBottom: "1rem", padding: "1rem" }}>
          <h3 style={{ marginBottom: "0.5rem" }}>Create New Route</h3>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "end" }}>
            <div>
              <label className="form-label">Route Name</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g., North Route"
                value={newRouteName}
                onChange={(e) => setNewRouteName(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">Driver (optional)</label>
              <input
                type="text"
                className="form-input"
                placeholder="Driver name"
                value={newDriverName}
                onChange={(e) => setNewDriverName(e.target.value)}
              />
            </div>
            <button className="btn btn-primary" onClick={createRoute} disabled={!newRouteName.trim()}>
              Create
            </button>
            <button className="btn btn-outline" onClick={() => setShowCreate(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading-page">
          <div className="loading-shimmer loading-block" />
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1rem", alignItems: "start" }}>
          {/* Left: Unassigned orders */}
          <div>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
              Unassigned ({unassigned.length})
            </h2>
            {unassigned.length === 0 ? (
              <div className="card" style={{ padding: "1rem", textAlign: "center", color: "var(--c-ink-muted)" }}>
                No packed orders waiting for a route
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {unassigned.map((order) => (
                  <div key={order.id} className="card" style={{ padding: "0.75rem" }}>
                    <div style={{ fontWeight: 500 }}>{order.clientName}</div>
                    <div style={{ fontSize: "0.8rem", color: "var(--c-ink-muted)" }}>
                      {order.itemCount} meal{order.itemCount !== 1 ? "s" : ""}
                      {order.deliveryZone && ` \u00b7 ${order.deliveryZone}`}
                    </div>
                    {order.deliveryAddress && (
                      <div style={{ fontSize: "0.8rem", color: "var(--c-ink-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {order.deliveryAddress}
                      </div>
                    )}
                    {routes.filter((r) => r.status === "PLANNING").length > 0 && (
                      <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                        {routes
                          .filter((r) => r.status === "PLANNING")
                          .map((r) => (
                            <button
                              key={r.id}
                              className="btn btn-sm btn-outline"
                              onClick={() => addToRoute(r.id, order.id)}
                            >
                              + {r.name}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Routes */}
          <div>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
              Routes ({routes.length})
            </h2>
            {routes.length === 0 ? (
              <div className="card" style={{ padding: "1rem", textAlign: "center", color: "var(--c-ink-muted)" }}>
                No routes created for this date yet
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {routes.map((route) => (
                  <div key={route.id} className="card" style={{ padding: "1rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: "1.05rem" }}>{route.name}</span>
                        {route.driverName && (
                          <span style={{ color: "var(--c-ink-muted)", marginLeft: "0.5rem", fontSize: "0.85rem" }}>
                            &middot; {route.driverName}
                          </span>
                        )}
                      </div>
                      <span
                        className="badge"
                        style={{ background: statusColor(route.status), color: "#fff", fontSize: "0.7rem" }}
                      >
                        {route.status}
                      </span>
                    </div>

                    {/* Stops */}
                    {route.stops.length === 0 ? (
                      <div style={{ fontSize: "0.85rem", color: "var(--c-ink-muted)", fontStyle: "italic", padding: "0.5rem 0" }}>
                        No stops added yet
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", margin: "0.5rem 0" }}>
                        {route.stops.map((stop) => (
                          <div
                            key={stop.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "0.5rem",
                              padding: "0.4rem 0.6rem",
                              borderRadius: "0.4rem",
                              background: "var(--c-surface-alt)",
                              fontSize: "0.85rem",
                            }}
                          >
                            <span style={{ fontWeight: 600, color: "var(--c-ink-muted)", minWidth: "1.5rem" }}>
                              #{stop.stopOrder}
                            </span>
                            <span style={{ flex: 1 }}>{stop.clientName}</span>
                            {stop.deliveryZone && (
                              <span style={{ fontSize: "0.75rem", color: "var(--c-ink-muted)" }}>
                                {stop.deliveryZone}
                              </span>
                            )}
                            {route.status === "PLANNING" && (
                              <button
                                className="btn btn-sm btn-danger"
                                style={{ padding: "0.15rem 0.4rem", fontSize: "0.7rem" }}
                                onClick={() => removeStop(route.id, stop.id)}
                              >
                                &times;
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Route actions */}
                    <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.5rem" }}>
                      {route.status === "PLANNING" && route.stops.length > 0 && (
                        <button className="btn btn-sm btn-primary" onClick={() => dispatchRoute(route.id)}>
                          Dispatch Route
                        </button>
                      )}
                      <button className="btn btn-sm btn-outline" onClick={() => printRouteSheet(route.id)}>
                        Print Sheet
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Internal type to match the API response for the fulfillment list
type FulfillmentOrderSummary = {
  id: string;
  clientName: string;
  deliveryAddress: string | null;
  deliveryZone: string | null;
  itemCount: number;
  route: { id: string; name: string; stopOrder: number } | null;
};
