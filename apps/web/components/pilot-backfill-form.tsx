"use client";

import { useState, useRef, useCallback } from "react";

type ResultState = "idle" | "loading" | "success" | "error";

function resolveApiBase() {
  if (process.env.NEXT_PUBLIC_API_BASE) return process.env.NEXT_PUBLIC_API_BASE;
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  }
  return "http://localhost:4000";
}

function getIsoDate(daysAgo = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

export function PilotBackfillForm() {
  const [mode, setMode] = useState<"dry-run" | "commit">("commit");
  const [historicalMode, setHistoricalMode] = useState(true);
  const [weekStartDate, setWeekStartDate] = useState(getIsoDate(6));
  const [purchaseDate, setPurchaseDate] = useState(getIsoDate(7));
  const [clientExternalRef, setClientExternalRef] = useState("ALEX-001");
  const [clientName, setClientName] = useState("Alex");
  const [resultState, setResultState] = useState<ResultState>("idle");
  const [resultMessage, setResultMessage] = useState("Ready");
  const [mealFileName, setMealFileName] = useState<string | null>(null);
  const [lotFileName, setLotFileName] = useState<string | null>(null);
  const mealRef = useRef<HTMLInputElement>(null);
  const lotRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const mealFile = mealRef.current?.files?.[0];
      if (!mealFile) {
        setResultState("error");
        setResultMessage("Meal file is required.");
        return;
      }

      const data = new FormData();
      data.append("mode", mode);
      data.append("meal_file", mealFile);
      const lotFile = lotRef.current?.files?.[0];
      if (lotFile) data.append("lot_file", lotFile);
      if (weekStartDate) data.append("week_start_date", weekStartDate);
      if (purchaseDate) data.append("purchase_date", purchaseDate);
      if (clientExternalRef) data.append("client_external_ref", clientExternalRef);
      if (clientName) data.append("client_name", clientName);
      data.append("historicalMode", historicalMode ? "true" : "false");

      setResultState("loading");
      setResultMessage("Running pilot backfill...");

      try {
        const apiBase = resolveApiBase();
        const response = await fetch(`${apiBase}/v1/pilot/backfill-week`, {
          method: "POST",
          body: data,
        });
        const json = await response.json();
        if (!response.ok) {
          setResultState("error");
          setResultMessage(JSON.stringify(json, null, 2));
          return;
        }
        setResultState("success");
        setResultMessage(JSON.stringify(json, null, 2));
      } catch (err) {
        setResultState("error");
        setResultMessage(err instanceof Error ? err.message : "Unknown error");
      }
    },
    [mode, historicalMode, weekStartDate, purchaseDate, clientExternalRef, clientName]
  );

  return (
    <form className="card" onSubmit={handleSubmit}>
      <div className="card-header">
        <div>
          <h3>Pilot Backfill (Historical Week)</h3>
          <p className="label-text mt-2">
            Import meals, ingest lots, serve meals, and freeze printable labels in one step.
          </p>
        </div>
        <span className="badge badge-info">Recommended</span>
      </div>

      <div className="grid-two">
        <label>
          Meal File *
          <div className="upload-zone" style={{ padding: "var(--sp-4)" }}>
            <div className="upload-zone-text">
              {mealFileName ? <span className="file-selected" style={{ marginTop: 0 }}>{mealFileName}</span> : <><strong>Choose meal file</strong> or drag here</>}
            </div>
            <input
              ref={mealRef}
              name="meal_file"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setMealFileName(e.target.files?.[0]?.name ?? null)}
            />
          </div>
        </label>
        <label>
          Lot File (Optional)
          <div className="upload-zone" style={{ padding: "var(--sp-4)" }}>
            <div className="upload-zone-text">
              {lotFileName ? <span className="file-selected" style={{ marginTop: 0 }}>{lotFileName}</span> : <><strong>Choose lot file</strong> or drag here</>}
            </div>
            <input
              ref={lotRef}
              name="lot_file"
              type="file"
              accept=".xlsx,.xls,.csv,.zip"
              onChange={(e) => setLotFileName(e.target.files?.[0]?.name ?? null)}
            />
          </div>
        </label>
      </div>

      <div className="field-group mt-4">
        <label>
          Week Start (Mon)
          <input type="date" value={weekStartDate} onChange={(e) => setWeekStartDate(e.target.value)} />
        </label>
        <label>
          Purchase Date
          <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
        </label>
        <label>
          Client Ref
          <input value={clientExternalRef} onChange={(e) => setClientExternalRef(e.target.value)} />
        </label>
        <label>
          Client Name
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} />
        </label>
      </div>

      <div className="row mt-6">
        <select value={mode} onChange={(e) => setMode(e.target.value as "dry-run" | "commit")}>
          <option value="dry-run">Dry Run (preview)</option>
          <option value="commit">Commit</option>
        </select>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-2)" }}>
          <input
            type="checkbox"
            checked={historicalMode}
            onChange={(e) => setHistoricalMode(e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          Historical Mode (allow synthetic lots)
        </label>
        <button type="submit" className="btn-lg" disabled={resultState === "loading"}>
          {resultState === "loading" ? "Running..." : "Run Backfill"}
        </button>
      </div>

      <div className={`result-box mt-4 result-${resultState}`}>
        {resultState === "loading" && <strong>Processing backfill...</strong>}
        {resultState === "success" && <strong>Backfill Complete</strong>}
        {resultState === "error" && <strong>Backfill Failed</strong>}
        {resultState === "idle" && <span>Ready to run</span>}
        {resultMessage && resultState !== "idle" && (
          <pre>{resultMessage}</pre>
        )}
      </div>
    </form>
  );
}
