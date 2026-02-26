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

type Component = { id: string; name: string; componentType: string };
type Slot = { slotType: string; componentId: string; componentName: string; targetG: number; portionG?: number };
type Template = {
  id: string;
  name: string;
  description: string | null;
  targetKcal: number | null;
  targetProteinG: number | null;
  targetCarbG: number | null;
  targetFatG: number | null;
  slots: { id: string; slotType: string; targetG: number; portionG: number | null; component: Component | null }[];
};

const SLOT_TYPES = ["PROTEIN", "CARB_BASE", "VEGETABLE", "SAUCE"] as const;
const DEFAULT_GRAMS: Record<string, number> = { PROTEIN: 150, CARB_BASE: 200, VEGETABLE: 100, SAUCE: 15 };

export default function ComposerBoard() {
  const [tab, setTab] = useState<"create" | "templates">("create");
  const [components, setComponents] = useState<Component[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Builder state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [slots, setSlots] = useState<Slot[]>(
    SLOT_TYPES.map((t) => ({ slotType: t, componentId: "", componentName: "", targetG: DEFAULT_GRAMS[t] ?? 100 }))
  );

  const API = resolveApiBase();

  const loadComponents = useCallback(async () => {
    try {
      const res = await fetch(`${API}/v1/components`);
      if (res.ok) {
        const json = await res.json();
        setComponents(json.components ?? []);
      }
    } catch { /* ignore */ }
  }, [API]);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/v1/compositions`);
      if (res.ok) {
        const json = await res.json();
        setTemplates(json.compositions ?? []);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [API]);

  useEffect(() => {
    loadComponents();
    if (tab === "templates") loadTemplates();
  }, [tab, loadComponents, loadTemplates]);

  function updateSlot(index: number, field: keyof Slot, value: string | number) {
    setSlots((prev) => prev.map((s, i) => {
      if (i !== index) return s;
      if (field === "componentId") {
        const comp = components.find((c) => c.id === value);
        return { ...s, componentId: value as string, componentName: comp?.name ?? "" };
      }
      return { ...s, [field]: value };
    }));
  }

  async function saveTemplate() {
    if (!name.trim()) { setError("Name required"); return; }
    const filledSlots = slots.filter((s) => s.componentId);
    if (filledSlots.length === 0) { setError("Select at least one component"); return; }

    setError(null);
    try {
      const res = await fetch(`${API}/v1/compositions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          slots: filledSlots.map((s, i) => ({
            slotType: s.slotType,
            componentId: s.componentId,
            targetG: s.targetG,
            portionG: s.portionG,
            slotOrder: i + 1,
          })),
        }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      setSuccess("Template saved!");
      setName("");
      setDescription("");
      setSlots(SLOT_TYPES.map((t) => ({ slotType: t, componentId: "", componentName: "", targetG: DEFAULT_GRAMS[t] ?? 100 })));
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function deleteTemplate(id: string) {
    try {
      await fetch(`${API}/v1/compositions/${id}`, { method: "DELETE" });
      loadTemplates();
    } catch { /* ignore */ }
  }

  const byType = (type: string) => components.filter((c) => c.componentType === type);

  return (
    <div>
      <div className="row" style={{ gap: "var(--sp-2)", marginBottom: "var(--sp-4)" }}>
        <button className={`btn ${tab === "create" ? "btn-primary" : "btn-outline"} btn-sm`} onClick={() => setTab("create")}>Build Meal</button>
        <button className={`btn ${tab === "templates" ? "btn-primary" : "btn-outline"} btn-sm`} onClick={() => setTab("templates")}>Saved Templates</button>
      </div>

      {error && <div className="card" style={{ borderColor: "var(--c-danger)", padding: "var(--sp-3)", marginBottom: "var(--sp-3)" }}>{error}</div>}
      {success && <div className="card" style={{ borderColor: "var(--c-success)", padding: "var(--sp-3)", marginBottom: "var(--sp-3)", color: "var(--c-success)" }}>{success}</div>}

      {tab === "create" && (
        <div className="card" style={{ padding: "var(--sp-4)" }}>
          <div style={{ marginBottom: "var(--sp-3)" }}>
            <label style={{ fontWeight: 600, display: "block", marginBottom: "var(--sp-1)" }}>Template Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. High Protein Chicken Bowl" style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--c-border)", borderRadius: 6, background: "var(--c-surface)", color: "var(--c-ink)", fontSize: "0.9rem" }} />
          </div>
          <div style={{ marginBottom: "var(--sp-4)" }}>
            <label style={{ fontWeight: 600, display: "block", marginBottom: "var(--sp-1)" }}>Description</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional notes" style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--c-border)", borderRadius: 6, background: "var(--c-surface)", color: "var(--c-ink)", fontSize: "0.9rem" }} />
          </div>

          <h3 style={{ marginBottom: "var(--sp-3)", fontWeight: 600 }}>Composition Slots</h3>
          <div style={{ display: "grid", gap: "var(--sp-3)" }}>
            {slots.map((slot, i) => (
              <div key={slot.slotType} style={{ display: "grid", gridTemplateColumns: "120px 1fr 80px", gap: "var(--sp-2)", alignItems: "center", padding: "var(--sp-2)", background: "var(--c-surface-alt)", borderRadius: 6 }}>
                <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{slot.slotType.replace("_", " ")}</div>
                <select value={slot.componentId} onChange={(e) => updateSlot(i, "componentId", e.target.value)} style={{ padding: "6px 10px", border: "1px solid var(--c-border)", borderRadius: 4, background: "var(--c-surface)", color: "var(--c-ink)", fontSize: "0.85rem" }}>
                  <option value="">— Select —</option>
                  {byType(slot.slotType).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                  {/* Also show all components for flexibility */}
                  {byType(slot.slotType).length === 0 && components.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.componentType})</option>
                  ))}
                </select>
                <input type="number" value={slot.targetG} onChange={(e) => updateSlot(i, "targetG", Number(e.target.value))} min={1} style={{ padding: "6px 10px", border: "1px solid var(--c-border)", borderRadius: 4, background: "var(--c-surface)", color: "var(--c-ink)", fontSize: "0.85rem", textAlign: "right" }} />
              </div>
            ))}
          </div>

          <div style={{ marginTop: "var(--sp-3)", fontSize: "0.85rem", color: "var(--c-ink-soft)" }}>
            Total: {slots.reduce((s, sl) => s + (sl.componentId ? sl.targetG : 0), 0)}g from {slots.filter((s) => s.componentId).length} slots
          </div>

          <button className="btn btn-primary" style={{ marginTop: "var(--sp-4)" }} onClick={saveTemplate} disabled={!name.trim()}>
            Save Template
          </button>
        </div>
      )}

      {tab === "templates" && !loading && (
        <div className="card" style={{ overflowX: "auto" }}>
          {templates.length === 0 ? (
            <div style={{ padding: "var(--sp-4)", textAlign: "center", color: "var(--c-ink-soft)" }}>No templates yet. Build one!</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Slots</th>
                  <th>Total Grams</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{t.name}</div>
                      {t.description && <div style={{ fontSize: "0.75rem", color: "var(--c-ink-soft)" }}>{t.description}</div>}
                    </td>
                    <td>
                      {t.slots.map((s) => (
                        <div key={s.id} style={{ fontSize: "0.8rem" }}>
                          <span className="badge badge-info" style={{ marginRight: "var(--sp-1)" }}>{s.slotType.replace("_", " ")}</span>
                          {s.component?.name ?? "—"} ({s.targetG}g)
                        </div>
                      ))}
                    </td>
                    <td>{t.slots.reduce((sum, s) => sum + s.targetG, 0)}g</td>
                    <td>
                      <button className="btn btn-outline btn-sm" style={{ color: "var(--c-danger)" }} onClick={() => deleteTemplate(t.id)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {loading && <div style={{ color: "var(--c-ink-soft)" }}>Loading...</div>}
    </div>
  );
}
