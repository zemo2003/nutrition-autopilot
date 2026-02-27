"use client";

import { useCallback, useEffect, useState } from "react";

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

type ClientProfile = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  heightCm: number | null;
  weightKg: number | null;
  goals: string | null;
  preferences: string | null;
  exclusions: string[];
  timezone: string;
  active: boolean;
};

export function ClientProfileView({ clientId }: { clientId: string }) {
  const [client, setClient] = useState<ClientProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit form state
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editHeight, setEditHeight] = useState("");
  const [editWeight, setEditWeight] = useState("");
  const [editGoals, setEditGoals] = useState("");
  const [editPreferences, setEditPreferences] = useState("");
  const [editExclusions, setEditExclusions] = useState("");

  const apiBase = resolveApiBase();

  const fetchClient = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/v1/clients/${clientId}`);
      if (res.ok) {
        const data = await res.json();
        setClient(data);
        setEditEmail(data.email ?? "");
        setEditPhone(data.phone ?? "");
        setEditHeight(data.heightCm?.toString() ?? "");
        setEditWeight(data.weightKg?.toString() ?? "");
        setEditGoals(data.goals ?? "");
        setEditPreferences(data.preferences ?? "");
        setEditExclusions((data.exclusions ?? []).join(", "));
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [apiBase, clientId]);

  useEffect(() => {
    fetchClient();
  }, [fetchClient]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${apiBase}/v1/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: editEmail || null,
          phone: editPhone || null,
          heightCm: editHeight ? parseFloat(editHeight) : null,
          weightKg: editWeight ? parseFloat(editWeight) : null,
          goals: editGoals || null,
          preferences: editPreferences || null,
          exclusions: editExclusions ? editExclusions.split(",").map((s) => s.trim()).filter(Boolean) : [],
        }),
      });
      if (res.ok) {
        setEditing(false);
        fetchClient();
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="loading-shimmer" style={{ height: 300, borderRadius: 12 }} />;
  }

  if (!client) {
    return (
      <div className="state-box" style={{ textAlign: "center", padding: "var(--sp-8)" }}>
        <div className="state-title">Client not found</div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: "var(--sp-4)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "var(--sp-4)" }}>
        <h3>Profile</h3>
        <button className={`btn btn-sm ${editing ? "btn-outline" : "btn-primary"}`} onClick={() => setEditing(!editing)}>
          {editing ? "Cancel" : "Edit"}
        </button>
      </div>

      {editing ? (
        <div className="stack-tight">
          <div className="grid-two" style={{ gap: "var(--sp-3)" }}>
            <div className="field-group">
              <label style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-soft)" }}>Email</label>
              <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div className="field-group">
              <label style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-soft)" }}>Phone</label>
              <input type="tel" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div className="field-group">
              <label style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-soft)" }}>Height (cm)</label>
              <input type="number" value={editHeight} onChange={(e) => setEditHeight(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div className="field-group">
              <label style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-soft)" }}>Weight (kg)</label>
              <input type="number" value={editWeight} onChange={(e) => setEditWeight(e.target.value)} style={{ width: "100%" }} />
            </div>
          </div>
          <div className="field-group">
            <label style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-soft)" }}>Goals</label>
            <textarea value={editGoals} onChange={(e) => setEditGoals(e.target.value)} rows={2} style={{ width: "100%" }} />
          </div>
          <div className="field-group">
            <label style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-soft)" }}>Preferences</label>
            <textarea value={editPreferences} onChange={(e) => setEditPreferences(e.target.value)} rows={2} style={{ width: "100%" }} />
          </div>
          <div className="field-group">
            <label style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-soft)" }}>Exclusions (comma-separated)</label>
            <input type="text" value={editExclusions} onChange={(e) => setEditExclusions(e.target.value)} placeholder="e.g., shellfish, peanuts" style={{ width: "100%" }} />
          </div>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      ) : (
        <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
          <div className="kpi">
            <div className="kpi-label">Email</div>
            <div className="kpi-value" style={{ fontSize: "var(--text-sm)" }}>{client.email ?? "—"}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Phone</div>
            <div className="kpi-value" style={{ fontSize: "var(--text-sm)" }}>{client.phone ?? "—"}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Height</div>
            <div className="kpi-value" style={{ fontSize: "var(--text-sm)" }}>{client.heightCm ? `${client.heightCm} cm` : "—"}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Weight</div>
            <div className="kpi-value" style={{ fontSize: "var(--text-sm)" }}>{client.weightKg ? `${client.weightKg} kg` : "—"}</div>
          </div>
          {client.goals && (
            <div className="kpi" style={{ gridColumn: "span 2" }}>
              <div className="kpi-label">Goals</div>
              <div className="kpi-value" style={{ fontSize: "var(--text-sm)" }}>{client.goals}</div>
            </div>
          )}
          {client.preferences && (
            <div className="kpi" style={{ gridColumn: "span 2" }}>
              <div className="kpi-label">Preferences</div>
              <div className="kpi-value" style={{ fontSize: "var(--text-sm)" }}>{client.preferences}</div>
            </div>
          )}
          {client.exclusions.length > 0 && (
            <div className="kpi" style={{ gridColumn: "span 2" }}>
              <div className="kpi-label">Exclusions</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                {client.exclusions.map((ex) => (
                  <span key={ex} className="badge badge-danger">{ex}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
