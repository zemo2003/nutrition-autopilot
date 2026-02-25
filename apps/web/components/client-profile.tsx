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
  bodyCompositionSnapshots: BodyCompSnapshot[] | null;
  fileRecords: FileRecord[] | null;
};

type BodyCompSnapshot = {
  date: string;
  bodyFatPct: number | null;
  leanMassKg: number | null;
  source: string;
};

type FileRecord = {
  date: string;
  type: string;
  fileName: string;
  notes: string | null;
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

  // Body comp form
  const [showBodyComp, setShowBodyComp] = useState(false);
  const [bcDate, setBcDate] = useState(new Date().toISOString().slice(0, 10));
  const [bcBodyFat, setBcBodyFat] = useState("");
  const [bcLeanMass, setBcLeanMass] = useState("");
  const [bcSource, setBcSource] = useState("DEXA");

  // File record form
  const [showFileRecord, setShowFileRecord] = useState(false);
  const [frDate, setFrDate] = useState(new Date().toISOString().slice(0, 10));
  const [frType, setFrType] = useState("DEXA");
  const [frFileName, setFrFileName] = useState("");
  const [frNotes, setFrNotes] = useState("");

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

  const handleAddBodyComp = async () => {
    try {
      const res = await fetch(`${apiBase}/v1/clients/${clientId}/body-composition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: bcDate,
          bodyFatPct: bcBodyFat ? parseFloat(bcBodyFat) : null,
          leanMassKg: bcLeanMass ? parseFloat(bcLeanMass) : null,
          source: bcSource,
        }),
      });
      if (res.ok) {
        setShowBodyComp(false);
        setBcBodyFat("");
        setBcLeanMass("");
        fetchClient();
      }
    } catch {
      // silent
    }
  };

  const handleAddFileRecord = async () => {
    if (!frFileName) return;
    try {
      const res = await fetch(`${apiBase}/v1/clients/${clientId}/file-records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: frDate,
          type: frType,
          fileName: frFileName,
          notes: frNotes || null,
        }),
      });
      if (res.ok) {
        setShowFileRecord(false);
        setFrFileName("");
        setFrNotes("");
        fetchClient();
      }
    } catch {
      // silent
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

  const snapshots = client.bodyCompositionSnapshots ?? [];
  const files = client.fileRecords ?? [];

  return (
    <div className="stack" style={{ gap: "var(--sp-6)" }}>
      {/* Basic Info */}
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

      {/* Body Composition History */}
      <div className="card" style={{ padding: "var(--sp-4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--sp-3)" }}>
          <h3>Body Composition</h3>
          <button className="btn btn-sm btn-outline" onClick={() => setShowBodyComp(!showBodyComp)}>
            + Add
          </button>
        </div>

        {showBodyComp && (
          <div className="stack-tight" style={{ marginBottom: "var(--sp-4)", padding: "var(--sp-3)", background: "var(--c-surface-alt)", borderRadius: "var(--r-md)" }}>
            <div className="grid-two" style={{ gap: "var(--sp-3)" }}>
              <div className="field-group">
                <label style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-soft)" }}>Date</label>
                <input type="date" value={bcDate} onChange={(e) => setBcDate(e.target.value)} style={{ width: "100%" }} />
              </div>
              <div className="field-group">
                <label style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-soft)" }}>Source</label>
                <select value={bcSource} onChange={(e) => setBcSource(e.target.value)} style={{ width: "100%" }}>
                  <option value="DEXA">DEXA Scan</option>
                  <option value="BIOIMPEDANCE">Bioimpedance</option>
                  <option value="CALIPERS">Calipers</option>
                  <option value="VISUAL">Visual Estimate</option>
                </select>
              </div>
              <div className="field-group">
                <label style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-soft)" }}>Body Fat %</label>
                <input type="number" step="0.1" value={bcBodyFat} onChange={(e) => setBcBodyFat(e.target.value)} style={{ width: "100%" }} />
              </div>
              <div className="field-group">
                <label style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-soft)" }}>Lean Mass (kg)</label>
                <input type="number" step="0.1" value={bcLeanMass} onChange={(e) => setBcLeanMass(e.target.value)} style={{ width: "100%" }} />
              </div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={handleAddBodyComp}>Save</button>
          </div>
        )}

        {snapshots.length > 0 ? (
          <div className="stack-tight">
            {snapshots.slice().reverse().map((snap, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "var(--sp-2) 0", borderBottom: i < snapshots.length - 1 ? "1px solid var(--c-border-light)" : undefined }}>
                <span style={{ fontSize: "var(--text-sm)" }}>
                  {new Date(snap.date).toLocaleDateString()}
                  <span className="badge badge-neutral" style={{ marginLeft: 6, fontSize: "var(--text-xs)" }}>{snap.source}</span>
                </span>
                <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)" }}>
                  {snap.bodyFatPct !== null ? `${snap.bodyFatPct}% BF` : "—"}
                  {snap.leanMassKg !== null ? ` · ${snap.leanMassKg} kg lean` : ""}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-muted" style={{ fontSize: "var(--text-sm)" }}>No body composition data yet.</div>
        )}
      </div>

      {/* File Records */}
      <div className="card" style={{ padding: "var(--sp-4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--sp-3)" }}>
          <h3>Records & Files</h3>
          <button className="btn btn-sm btn-outline" onClick={() => setShowFileRecord(!showFileRecord)}>
            + Add
          </button>
        </div>

        {showFileRecord && (
          <div className="stack-tight" style={{ marginBottom: "var(--sp-4)", padding: "var(--sp-3)", background: "var(--c-surface-alt)", borderRadius: "var(--r-md)" }}>
            <div className="grid-two" style={{ gap: "var(--sp-3)" }}>
              <div className="field-group">
                <label style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-soft)" }}>Date</label>
                <input type="date" value={frDate} onChange={(e) => setFrDate(e.target.value)} style={{ width: "100%" }} />
              </div>
              <div className="field-group">
                <label style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-soft)" }}>Type</label>
                <select value={frType} onChange={(e) => setFrType(e.target.value)} style={{ width: "100%" }}>
                  <option value="DEXA">DEXA Scan</option>
                  <option value="BLOODWORK">Bloodwork</option>
                  <option value="CGM">CGM Data</option>
                  <option value="PHOTO">Progress Photo</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
            </div>
            <div className="field-group">
              <label style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-soft)" }}>File Name</label>
              <input type="text" value={frFileName} onChange={(e) => setFrFileName(e.target.value)} placeholder="e.g., dexa-feb-2026.pdf" style={{ width: "100%" }} />
            </div>
            <div className="field-group">
              <label style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-soft)" }}>Notes</label>
              <input type="text" value={frNotes} onChange={(e) => setFrNotes(e.target.value)} style={{ width: "100%" }} />
            </div>
            <button className="btn btn-primary btn-sm" onClick={handleAddFileRecord} disabled={!frFileName}>Save</button>
          </div>
        )}

        {files.length > 0 ? (
          <div className="stack-tight">
            {files.slice().reverse().map((file, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--sp-2) 0", borderBottom: i < files.length - 1 ? "1px solid var(--c-border-light)" : undefined }}>
                <div>
                  <div style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-medium)" }}>{file.fileName}</div>
                  <div className="text-muted" style={{ fontSize: "var(--text-xs)" }}>
                    {new Date(file.date).toLocaleDateString()}
                    {file.notes && ` — ${file.notes}`}
                  </div>
                </div>
                <span className="badge badge-neutral">{file.type}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-muted" style={{ fontSize: "var(--text-sm)" }}>No records uploaded yet.</div>
        )}
      </div>
    </div>
  );
}
