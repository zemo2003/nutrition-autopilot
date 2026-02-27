"use client";

import Link from "next/link";
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

type Batch = {
  id: string;
  componentName: string;
  componentType: string;
  status: string;
  plannedDate: string;
  batchCode: string | null;
  rawInputG: number;
  expectedYieldG: number;
  actualYieldG: number | null;
  yieldVariance: number | null;
  portionCount: number | null;
  portionSizeG: number | null;
  cookTempC: number | null;
  cookTimeMin: number | null;
  notes: string | null;
};

type Component = {
  id: string;
  name: string;
  componentType: string;
  defaultYieldFactor: number;
  lineCount: number;
};

const STATUS_ORDER = ["PLANNED", "IN_PREP", "COOKING", "CHILLING", "PORTIONED", "READY", "CANCELLED"];

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PLANNED: { label: "Planned", color: "var(--c-info)" },
  IN_PREP: { label: "In Prep", color: "var(--c-accent)" },
  COOKING: { label: "Cooking", color: "var(--c-danger)" },
  CHILLING: { label: "Chilling", color: "var(--c-info)" },
  PORTIONED: { label: "Portioned", color: "var(--c-warn)" },
  READY: { label: "Ready", color: "var(--c-success)" },
  CANCELLED: { label: "Cancelled", color: "var(--c-ink-muted)" },
};

const TYPE_LABELS: Record<string, string> = {
  PROTEIN: "Protein",
  CARB_BASE: "Carb / Base",
  VEGETABLE: "Vegetable",
  SAUCE: "Sauce",
  CONDIMENT: "Condiment",
  OTHER: "Other",
};

function formatG(grams: number): string {
  if (grams >= 1000) return `${(grams / 1000).toFixed(1)} kg`;
  return `${Math.round(grams)} g`;
}

function StatusBadge({ status }: { status: string }) {
  const info = STATUS_LABELS[status] ?? { label: status, color: "var(--c-ink-muted)" };
  return (
    <span className="badge" style={{ background: `${info.color}22`, color: info.color, border: `1px solid ${info.color}44` }}>
      {info.label}
    </span>
  );
}

function VarianceBadge({ variance }: { variance: number | null }) {
  if (variance === null) return null;
  const pct = Math.round(variance * 100);
  const abs = Math.abs(pct);
  const color = abs > 30 ? "var(--c-danger)" : abs > 15 ? "var(--c-warn)" : "var(--c-success)";
  return (
    <span className="badge" style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}>
      {pct > 0 ? "+" : ""}{pct}% yield
    </span>
  );
}

function nextStatus(current: string): string | null {
  const idx = STATUS_ORDER.indexOf(current);
  if (idx < 0 || idx >= STATUS_ORDER.length - 2) return null; // can't advance past READY
  return STATUS_ORDER[idx + 1] ?? null;
}

export function BatchPrepBoard() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [components, setComponents] = useState<Component[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [newComponentId, setNewComponentId] = useState("");
  const [newRawInputG, setNewRawInputG] = useState("");
  const [newPortionSizeG, setNewPortionSizeG] = useState("");
  const [newPlannedDate, setNewPlannedDate] = useState(new Date().toISOString().slice(0, 10));

  // Advance state
  const [advancingId, setAdvancingId] = useState<string | null>(null);
  const [actualYield, setActualYield] = useState("");

  // Lot selection modal state
  type LotOption = { id: string; lotCode: string | null; productName: string; availableG: number; receivedAt: string; expiresAt: string | null; isDefault: boolean };
  type IngredientLots = { ingredientId: string; ingredientName: string; neededG: number; lots: LotOption[] };
  const [lotModal, setLotModal] = useState<{ batchId: string; ingredients: IngredientLots[] } | null>(null);
  const [lotSelections, setLotSelections] = useState<Record<string, string>>({});
  const [lotModalLoading, setLotModalLoading] = useState(false);

  const apiBase = resolveApiBase();

  const fetchData = useCallback(async () => {
    try {
      setFetchError(null);
      const statusParam = statusFilter === "active" ? "status=PLANNED,IN_PREP,COOKING,CHILLING,PORTIONED" : statusFilter !== "all" ? `status=${statusFilter}` : "";
      const [batchRes, compRes] = await Promise.all([
        fetch(`${apiBase}/v1/batches${statusParam ? `?${statusParam}` : ""}`),
        fetch(`${apiBase}/v1/components`),
      ]);
      if (!batchRes.ok || !compRes.ok) {
        setFetchError(`Failed to load data (batches: ${batchRes.status}, components: ${compRes.status})`);
      }
      if (batchRes.ok) setBatches(await batchRes.json());
      if (compRes.ok) setComponents(await compRes.json());
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Network error — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [apiBase, statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const [mutationError, setMutationError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newComponentId || !newRawInputG) return;
    setMutationError(null);
    try {
      const res = await fetch(`${apiBase}/v1/batches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          componentId: newComponentId,
          rawInputG: parseFloat(newRawInputG),
          portionSizeG: newPortionSizeG ? parseFloat(newPortionSizeG) : undefined,
          plannedDate: newPlannedDate,
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        setNewComponentId("");
        setNewRawInputG("");
        setNewPortionSizeG("");
        fetchData();
      } else {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        setMutationError(body.error || body.details?.formErrors?.[0] || `Create failed (${res.status})`);
      }
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Network error creating batch");
    }
  };

  const executeAdvance = async (batchId: string, newStatus: string, overrides?: { ingredientId: string; lotId: string }[]) => {
    const body: Record<string, unknown> = { status: newStatus };
    if (newStatus === "PORTIONED" && actualYield) {
      body.actualYieldG = parseFloat(actualYield);
    }
    if (overrides && overrides.length > 0) {
      body.lotOverrides = overrides;
    }
    setMutationError(null);
    try {
      const res = await fetch(`${apiBase}/v1/batches/${batchId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setAdvancingId(null);
        setActualYield("");
        setLotModal(null);
        setLotSelections({});
        fetchData();
      } else {
        const errBody = await res.json().catch(() => ({ error: res.statusText }));
        setMutationError(errBody.error || `Advance failed (${res.status})`);
      }
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Network error advancing batch");
    }
  };

  const handleAdvance = async (batchId: string, newStatus: string) => {
    // Show lot selection modal when advancing to IN_PREP
    if (newStatus === "IN_PREP") {
      setLotModalLoading(true);
      try {
        const res = await fetch(`${apiBase}/v1/batches/${batchId}/available-lots`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          const ingredients: IngredientLots[] = data.ingredients ?? [];
          // Only show modal if there are multiple lot choices for any ingredient
          const hasChoices = ingredients.some((ing) => ing.lots.length > 1);
          if (hasChoices) {
            // Pre-select defaults (FIFO — first lot)
            const defaults: Record<string, string> = {};
            for (const ing of ingredients) {
              if (ing.lots.length > 0) defaults[ing.ingredientId] = ing.lots[0]!.id;
            }
            setLotSelections(defaults);
            setLotModal({ batchId, ingredients });
            setLotModalLoading(false);
            return;
          }
        }
      } catch {
        // If lot fetch fails, proceed with FIFO
      }
      setLotModalLoading(false);
    }
    // No lot selection needed — proceed directly
    await executeAdvance(batchId, newStatus);
  };

  if (loading) {
    return (
      <div className="card" style={{ padding: "var(--sp-5)" }}>
        <div className="loading-shimmer loading-bar" style={{ width: "40%", height: 18, marginBottom: "var(--sp-4)" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
          <div className="loading-shimmer" style={{ height: 56, borderRadius: "var(--r-md)" }} />
          <div className="loading-shimmer" style={{ height: 56, borderRadius: "var(--r-md)" }} />
          <div className="loading-shimmer" style={{ height: 56, borderRadius: "var(--r-md)" }} />
        </div>
      </div>
    );
  }

  // Group batches by component type
  const grouped: Record<string, Batch[]> = {};
  for (const batch of batches) {
    const type = batch.componentType || "OTHER";
    if (!grouped[type]) grouped[type] = [];
    grouped[type]!.push(batch);
  }

  const typeOrder = ["PROTEIN", "CARB_BASE", "VEGETABLE", "SAUCE", "CONDIMENT", "OTHER"];

  return (
    <>
      {/* Filter + Create */}
      <div className="row" style={{ gap: "var(--sp-2)", marginBottom: "var(--sp-4)", flexWrap: "wrap", justifyContent: "space-between" }}>
        <div className="row" style={{ gap: "var(--sp-2)", flexWrap: "wrap" }}>
          {["active", "READY", "all"].map((s) => (
            <button
              key={s}
              className={`btn btn-sm ${statusFilter === s ? "btn-primary" : "btn-outline"}`}
              onClick={() => setStatusFilter(s)}
            >
              {s === "active" ? "Active" : s === "all" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
          + New Batch
        </button>
      </div>

      {/* Error banner */}
      {fetchError && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--sp-3)",
            padding: "var(--sp-3) var(--sp-4)",
            marginBottom: "var(--sp-4)",
            background: "var(--c-danger-soft)",
            color: "var(--c-danger)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: "var(--r-md)",
            fontSize: "var(--text-sm)",
          }}
        >
          <span>{fetchError}</span>
          <div style={{ display: "flex", gap: "var(--sp-2)", flexShrink: 0 }}>
            <button
              className="btn btn-sm"
              style={{ background: "var(--c-danger)", color: "#fff" }}
              onClick={() => { setLoading(true); fetchData(); }}
            >
              Retry
            </button>
            <button
              className="btn btn-ghost btn-sm"
              style={{ color: "var(--c-danger)" }}
              onClick={() => setFetchError(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Mutation error banner */}
      {mutationError && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--sp-3)",
            padding: "var(--sp-3) var(--sp-4)",
            marginBottom: "var(--sp-4)",
            background: "var(--c-danger-soft)",
            color: "var(--c-danger)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: "var(--r-md)",
            fontSize: "var(--text-sm)",
          }}
        >
          <span>{mutationError}</span>
          <button
            className="btn btn-ghost btn-sm"
            style={{ color: "var(--c-danger)" }}
            onClick={() => setMutationError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Batch cards by component family */}
      {typeOrder.map((type) => {
        const typeBatches = grouped[type];
        if (!typeBatches?.length) return null;

        return (
          <div key={type} style={{ marginBottom: "var(--sp-6)" }}>
            <h3 style={{ fontSize: "var(--text-md)", marginBottom: "var(--sp-3)" }}>
              {TYPE_LABELS[type] ?? type}
              <span className="text-muted" style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-normal)", marginLeft: "var(--sp-2)" }}>
                ({typeBatches.length})
              </span>
            </h3>

            <div className="stack-tight">
              {typeBatches.map((batch) => {
                const next = nextStatus(batch.status);
                const needsYield = next === "PORTIONED";

                return (
                  <div key={batch.id} className="card" style={{ padding: "var(--sp-3)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--sp-3)", flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap" }}>
                          <span style={{ fontWeight: "var(--weight-semibold)" }}>{batch.componentName}</span>
                          <StatusBadge status={batch.status} />
                          <VarianceBadge variance={batch.yieldVariance} />
                        </div>
                        <div className="text-muted" style={{ fontSize: "var(--text-sm)", marginTop: 4 }}>
                          {formatG(batch.rawInputG)} raw
                          {" → "}
                          {batch.actualYieldG !== null ? formatG(batch.actualYieldG) : formatG(batch.expectedYieldG)}
                          {batch.actualYieldG === null && " (expected)"}
                          {batch.portionCount && ` · ${batch.portionCount} portions`}
                        </div>
                        {batch.cookTempC && (
                          <div className="text-muted" style={{ fontSize: "var(--text-xs)", marginTop: 2 }}>
                            {batch.cookTempC}°C · {batch.cookTimeMin ?? "—"}min
                          </div>
                        )}
                        {batch.notes && (
                          <div style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-soft)", marginTop: 4, fontStyle: "italic" }}>
                            {batch.notes}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", alignItems: "flex-end" }}>
                        {next && advancingId !== batch.id && (
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => {
                              if (needsYield) {
                                setAdvancingId(batch.id);
                              } else {
                                handleAdvance(batch.id, next);
                              }
                            }}
                          >
                            → {STATUS_LABELS[next]?.label ?? next}
                          </button>
                        )}
                        {advancingId === batch.id && (
                          <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
                            <input
                              type="number"
                              placeholder="Actual yield (g)"
                              value={actualYield}
                              onChange={(e) => setActualYield(e.target.value)}
                              style={{ width: 140, fontSize: "var(--text-sm)" }}
                            />
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => handleAdvance(batch.id, next!)}
                              disabled={!actualYield}
                            >
                              Confirm
                            </button>
                            <button className="btn btn-outline btn-sm" onClick={() => setAdvancingId(null)}>
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {batches.length === 0 && !fetchError && (
        <div className="state-box" style={{ textAlign: "center", padding: "var(--sp-8)" }}>
          <div className="state-title">No batches yet</div>
          <div className="state-desc">Create a batch to start prepping components.</div>
          <Link
            href={"/kitchen" as any}
            style={{
              marginTop: "var(--sp-3)",
              fontSize: "var(--text-sm)",
              color: "var(--c-primary)",
              textDecoration: "none",
              fontWeight: "var(--weight-medium)",
            }}
          >
            &rarr; Switch to Kitchen Mode for guided execution
          </Link>
        </div>
      )}

      {/* Create Batch Modal */}
      {showCreate && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 200,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,0.6)", padding: "var(--sp-4)",
        }} onClick={() => setShowCreate(false)}>
          <div className="card" style={{ maxWidth: 420, width: "100%", padding: "var(--sp-6)" }}
            onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: "var(--sp-4)" }}>New Batch</h3>

            <div className="field-group" style={{ marginBottom: "var(--sp-3)" }}>
              <label style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-soft)" }}>Component</label>
              <select value={newComponentId} onChange={(e) => setNewComponentId(e.target.value)} style={{ width: "100%" }}>
                <option value="">Select component...</option>
                {components.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({TYPE_LABELS[c.componentType] ?? c.componentType})
                  </option>
                ))}
              </select>
            </div>

            <div className="field-group" style={{ marginBottom: "var(--sp-3)" }}>
              <label style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-soft)" }}>Raw input (grams)</label>
              <input
                type="number"
                value={newRawInputG}
                onChange={(e) => setNewRawInputG(e.target.value)}
                placeholder="e.g., 2000"
                style={{ width: "100%" }}
              />
              {newRawInputG && newComponentId && (() => {
                const comp = components.find((c) => c.id === newComponentId);
                if (!comp) return null;
                const expected = parseFloat(newRawInputG) * comp.defaultYieldFactor;
                return (
                  <div className="text-muted" style={{ fontSize: "var(--text-xs)", marginTop: 4 }}>
                    Expected yield: {formatG(expected)} (x{comp.defaultYieldFactor} factor)
                  </div>
                );
              })()}
            </div>

            <div className="field-group" style={{ marginBottom: "var(--sp-3)" }}>
              <label style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-soft)" }}>Portion size (grams, optional)</label>
              <input
                type="number"
                value={newPortionSizeG}
                onChange={(e) => setNewPortionSizeG(e.target.value)}
                placeholder="e.g., 170"
                style={{ width: "100%" }}
              />
            </div>

            <div className="field-group" style={{ marginBottom: "var(--sp-4)" }}>
              <label style={{ fontSize: "var(--text-sm)", color: "var(--c-ink-soft)" }}>Planned date</label>
              <input
                type="date"
                value={newPlannedDate}
                onChange={(e) => setNewPlannedDate(e.target.value)}
                style={{ width: "100%" }}
              />
            </div>

            <div className="row" style={{ gap: "var(--sp-2)" }}>
              <button className="btn btn-outline" onClick={() => setShowCreate(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={!newComponentId || !newRawInputG}
              >
                Create Batch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lot selection modal */}
      {lotModal && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.5)", padding: "var(--sp-4)",
          }}
          onClick={() => setLotModal(null)}
        >
          <div
            style={{
              background: "var(--c-surface, #fff)", borderRadius: "var(--r-lg, 12px)",
              padding: "var(--sp-5, 24px)", maxWidth: 560, width: "100%",
              maxHeight: "80vh", overflow: "auto",
              boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 var(--sp-3) 0", fontSize: "var(--text-lg, 18px)" }}>
              Select Lots for Prep
            </h3>
            <p style={{ margin: "0 0 var(--sp-4) 0", fontSize: "var(--text-sm)", color: "var(--c-ink-muted)" }}>
              Choose which inventory lots to use for each ingredient. Default is FIFO (oldest first).
            </p>

            {lotModal.ingredients.map((ing) => (
              <div key={ing.ingredientId} style={{ marginBottom: "var(--sp-4)" }}>
                <div style={{
                  fontWeight: 600, fontSize: "var(--text-sm)",
                  marginBottom: "var(--sp-2)",
                }}>
                  {ing.ingredientName}
                  <span style={{ color: "var(--c-ink-muted)", fontWeight: 400, marginLeft: "var(--sp-2)" }}>
                    (need {Math.round(ing.neededG)}g)
                  </span>
                </div>
                {ing.lots.length === 0 ? (
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--c-danger)" }}>
                    No lots available!
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
                    {ing.lots.map((lot) => (
                      <label
                        key={lot.id}
                        style={{
                          display: "flex", alignItems: "center", gap: "var(--sp-2)",
                          padding: "var(--sp-2) var(--sp-3)",
                          borderRadius: "var(--r-md, 8px)",
                          border: lotSelections[ing.ingredientId] === lot.id
                            ? "2px solid var(--c-primary, #4f46e5)"
                            : "1px solid var(--c-border, #e5e7eb)",
                          cursor: "pointer",
                          fontSize: "var(--text-sm)",
                          background: lotSelections[ing.ingredientId] === lot.id
                            ? "var(--c-primary-soft, rgba(79,70,229,0.05))"
                            : "transparent",
                        }}
                      >
                        <input
                          type="radio"
                          name={`lot-${ing.ingredientId}`}
                          checked={lotSelections[ing.ingredientId] === lot.id}
                          onChange={() => setLotSelections((prev) => ({ ...prev, [ing.ingredientId]: lot.id }))}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500 }}>
                            {lot.productName}
                            {lot.lotCode && <span style={{ color: "var(--c-ink-muted)", marginLeft: 4 }}>({lot.lotCode})</span>}
                          </div>
                          <div style={{ fontSize: "var(--text-xs)", color: "var(--c-ink-muted)" }}>
                            {Math.round(lot.availableG)}g available
                            {" \u00b7 "}Rcvd {lot.receivedAt}
                            {lot.expiresAt && ` \u00b7 Exp ${lot.expiresAt}`}
                            {lot.isDefault && (
                              <span style={{ color: "var(--c-primary)", marginLeft: 4, fontWeight: 600 }}>FIFO</span>
                            )}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}

            <div style={{ display: "flex", gap: "var(--sp-2)", justifyContent: "flex-end", marginTop: "var(--sp-3)" }}>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => { setLotModal(null); setLotSelections({}); }}
              >
                Cancel
              </button>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => {
                  // Use defaults — proceed without overrides
                  setLotModal(null);
                  setLotSelections({});
                  executeAdvance(lotModal.batchId, "IN_PREP");
                }}
              >
                Use Defaults (FIFO)
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  const overrides = Object.entries(lotSelections).map(([ingredientId, lotId]) => ({
                    ingredientId,
                    lotId,
                  }));
                  executeAdvance(lotModal.batchId, "IN_PREP", overrides);
                }}
              >
                Start Prep with Selected Lots
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
