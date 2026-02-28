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

type Client = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  deliveryAddressHome: string | null;
  deliveryAddressWork: string | null;
  deliveryNotes: string | null;
  deliveryZone: string | null;
};

type DeliveryHistory = {
  id: string;
  deliveryDate: string;
  status: string;
  itemCount: number;
};

export function DeliveryClients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{
    deliveryAddressHome: string;
    deliveryAddressWork: string;
    deliveryNotes: string;
    deliveryZone: string;
  }>({ deliveryAddressHome: "", deliveryAddressWork: "", deliveryNotes: "", deliveryZone: "" });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [history, setHistory] = useState<DeliveryHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [zoneFilter, setZoneFilter] = useState("");

  const fetchClients = useCallback(async () => {
    try {
      const res = await fetch(`${resolveApiBase()}/v1/clients`);
      if (res.ok) {
        const data = await res.json();
        setClients(Array.isArray(data) ? data : data.clients ?? []);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const startEditing = (client: Client) => {
    setEditingId(client.id);
    setEditValues({
      deliveryAddressHome: client.deliveryAddressHome ?? "",
      deliveryAddressWork: client.deliveryAddressWork ?? "",
      deliveryNotes: client.deliveryNotes ?? "",
      deliveryZone: client.deliveryZone ?? "",
    });
  };

  const saveClient = async (clientId: string) => {
    try {
      await fetch(`${resolveApiBase()}/v1/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliveryAddressHome: editValues.deliveryAddressHome || null,
          deliveryAddressWork: editValues.deliveryAddressWork || null,
          deliveryNotes: editValues.deliveryNotes || null,
          deliveryZone: editValues.deliveryZone || null,
        }),
      });
      setEditingId(null);
      await fetchClients();
    } catch {
      // silently fail
    }
  };

  const toggleHistory = async (clientId: string) => {
    if (expandedId === clientId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(clientId);
    setHistoryLoading(true);
    try {
      const res = await fetch(`${resolveApiBase()}/v1/fulfillment?clientId=${clientId}`);
      if (res.ok) {
        const raw = await res.json();
        const data = Array.isArray(raw) ? raw : raw.orders ?? [];
        setHistory(
          data.slice(0, 10).map((o: { id: string; deliveryDate: string; status: string; itemCount: number }) => ({
            id: o.id,
            deliveryDate: o.deliveryDate,
            status: o.status,
            itemCount: o.itemCount,
          })),
        );
      }
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Gather unique zones for filter
  const zones = Array.from(new Set(clients.map((c) => c.deliveryZone).filter(Boolean))) as string[];

  // Filter
  const filtered = zoneFilter
    ? clients.filter((c) => c.deliveryZone === zoneFilter)
    : clients;

  const missingBoth = clients.filter((c) => !c.deliveryAddressHome && !c.deliveryAddressWork);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Delivery Clients</h1>
          <p className="page-subtitle">Manage addresses, zones, and delivery notes</p>
        </div>
        {zones.length > 0 && (
          <select
            className="form-input"
            value={zoneFilter}
            onChange={(e) => setZoneFilter(e.target.value)}
          >
            <option value="">All Zones</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        )}
      </div>

      {missingBoth.length > 0 && (
        <div className="alert alert-warning" style={{ marginBottom: "1rem" }}>
          <strong>{missingBoth.length} client{missingBoth.length > 1 ? "s" : ""}</strong> missing both delivery addresses:{" "}
          {missingBoth.map((c) => c.fullName).join(", ")}
        </div>
      )}

      {loading ? (
        <div className="loading-page">
          <div className="loading-shimmer loading-block" />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Home Address</th>
                <th>Work Address</th>
                <th>Zone</th>
                <th>Notes</th>
                <th style={{ width: "120px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((client) => (
                <>
                  <tr key={client.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{client.fullName}</div>
                      {client.phone && (
                        <div style={{ fontSize: "0.8rem", color: "var(--c-ink-muted)" }}>{client.phone}</div>
                      )}
                    </td>
                    <td>
                      {editingId === client.id ? (
                        <input
                          className="form-input"
                          value={editValues.deliveryAddressHome}
                          onChange={(e) =>
                            setEditValues({ ...editValues, deliveryAddressHome: e.target.value })
                          }
                          placeholder="Home address"
                          style={{ width: "100%" }}
                        />
                      ) : (
                        <span style={{ color: client.deliveryAddressHome ? "inherit" : "var(--c-ink-muted)" }}>
                          {client.deliveryAddressHome || "Not set"}
                        </span>
                      )}
                    </td>
                    <td>
                      {editingId === client.id ? (
                        <input
                          className="form-input"
                          value={editValues.deliveryAddressWork}
                          onChange={(e) =>
                            setEditValues({ ...editValues, deliveryAddressWork: e.target.value })
                          }
                          placeholder="Work address"
                          style={{ width: "100%" }}
                        />
                      ) : (
                        <span style={{ color: client.deliveryAddressWork ? "inherit" : "var(--c-ink-muted)" }}>
                          {client.deliveryAddressWork || "Not set"}
                        </span>
                      )}
                    </td>
                    <td>
                      {editingId === client.id ? (
                        <input
                          className="form-input"
                          value={editValues.deliveryZone}
                          onChange={(e) =>
                            setEditValues({ ...editValues, deliveryZone: e.target.value })
                          }
                          placeholder="e.g., North"
                          style={{ width: "100%" }}
                        />
                      ) : (
                        <span style={{ color: client.deliveryZone ? "inherit" : "var(--c-ink-muted)" }}>
                          {client.deliveryZone || "\u2014"}
                        </span>
                      )}
                    </td>
                    <td>
                      {editingId === client.id ? (
                        <input
                          className="form-input"
                          value={editValues.deliveryNotes}
                          onChange={(e) =>
                            setEditValues({ ...editValues, deliveryNotes: e.target.value })
                          }
                          placeholder="Gate code, etc."
                          style={{ width: "100%" }}
                        />
                      ) : (
                        <span style={{ color: client.deliveryNotes ? "inherit" : "var(--c-ink-muted)" }}>
                          {client.deliveryNotes || "\u2014"}
                        </span>
                      )}
                    </td>
                    <td>
                      {editingId === client.id ? (
                        <div style={{ display: "flex", gap: "0.3rem" }}>
                          <button className="btn btn-sm btn-primary" onClick={() => saveClient(client.id)}>
                            Save
                          </button>
                          <button className="btn btn-sm btn-outline" onClick={() => setEditingId(null)}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: "0.3rem" }}>
                          <button className="btn btn-sm btn-outline" onClick={() => startEditing(client)}>
                            Edit
                          </button>
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={() => toggleHistory(client.id)}
                          >
                            {expandedId === client.id ? "Hide" : "History"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {expandedId === client.id && (
                    <tr key={`${client.id}-history`}>
                      <td colSpan={6} style={{ background: "var(--c-surface-alt)", padding: "0.75rem" }}>
                        <strong style={{ fontSize: "0.85rem" }}>Recent Deliveries</strong>
                        {historyLoading ? (
                          <div style={{ padding: "0.5rem", color: "var(--c-ink-muted)" }}>Loading...</div>
                        ) : history.length === 0 ? (
                          <div style={{ padding: "0.5rem", color: "var(--c-ink-muted)" }}>No delivery history</div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", marginTop: "0.4rem" }}>
                            {history.map((h) => (
                              <div
                                key={h.id}
                                style={{ display: "flex", gap: "1rem", fontSize: "0.85rem", padding: "0.25rem 0" }}
                              >
                                <span style={{ minWidth: "6rem" }}>{h.deliveryDate}</span>
                                <span
                                  className="badge"
                                  style={{
                                    fontSize: "0.7rem",
                                    background:
                                      h.status === "DELIVERED"
                                        ? "var(--c-success)"
                                        : h.status === "FAILED"
                                          ? "var(--c-danger)"
                                          : "#6b6b76",
                                    color: "#fff",
                                  }}
                                >
                                  {h.status}
                                </span>
                                <span style={{ color: "var(--c-ink-muted)" }}>
                                  {h.itemCount} meal{h.itemCount !== 1 ? "s" : ""}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
