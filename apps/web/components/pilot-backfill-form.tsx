"use client";

import { useMemo, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

function getIsoDate(daysAgo = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

export function PilotBackfillForm() {
  const [mode, setMode] = useState<"dry-run" | "commit">("commit");
  const [weekStartDate, setWeekStartDate] = useState<string>(getIsoDate(6));
  const [purchaseDate, setPurchaseDate] = useState<string>(getIsoDate(7));
  const [clientExternalRef, setClientExternalRef] = useState("ALEX-001");
  const [clientName, setClientName] = useState("Alex");
  const [status, setStatus] = useState("Idle");
  const [busy, setBusy] = useState(false);

  const hints = useMemo(
    () => [
      "meal_file accepts detailed meal CSV or Alex_Week_Workbook_FullDetail.xlsx (Ingredient_Log_SKU sheet).",
      "lot_file accepts detailed lot CSV or workbook with Walmart_Receipt sheet."
    ],
    []
  );

  return (
    <form
      className="card"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const mealFile = (form.querySelector("input[name=meal_file]") as HTMLInputElement | null)?.files?.[0];
        const lotFile = (form.querySelector("input[name=lot_file]") as HTMLInputElement | null)?.files?.[0];

        if (!mealFile) {
          setStatus("meal_file is required.");
          return;
        }

        const data = new FormData();
        data.append("mode", mode);
        data.append("meal_file", mealFile);
        if (lotFile) data.append("lot_file", lotFile);
        if (weekStartDate) data.append("week_start_date", weekStartDate);
        if (purchaseDate) data.append("purchase_date", purchaseDate);
        if (clientExternalRef) data.append("client_external_ref", clientExternalRef);
        if (clientName) data.append("client_name", clientName);

        setBusy(true);
        setStatus("Running pilot backfill...");

        try {
          const response = await fetch(`${API_BASE}/v1/pilot/backfill-week`, {
            method: "POST",
            body: data
          });
          const json = await response.json();
          if (!response.ok) {
            setStatus(`Failed: ${JSON.stringify(json)}`);
            return;
          }
          setStatus(`Done: ${JSON.stringify(json, null, 2)}`);
        } catch (error) {
          setStatus(`Failed: ${error instanceof Error ? error.message : "unknown error"}`);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Pilot Backfill (Historical Week)</h3>
      <p>Imports last-week meals, ingests lots, auto-fills gaps, serves meals, and freezes printable labels.</p>
      <div className="stack">
        {hints.map((hint) => (
          <small key={hint}>{hint}</small>
        ))}
      </div>

      <div className="grid-two">
        <label>
          Meal File
          <input name="meal_file" type="file" accept=".xlsx,.xls,.csv" />
        </label>
        <label>
          Lot File (Optional)
          <input name="lot_file" type="file" accept=".xlsx,.xls,.csv,.zip" />
        </label>
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

      <div className="row" style={{ marginTop: 12 }}>
        <select value={mode} onChange={(e) => setMode(e.target.value as "dry-run" | "commit")}>
          <option value="dry-run">dry-run</option>
          <option value="commit">commit</option>
        </select>
        <button type="submit" disabled={busy}>
          {busy ? "Running..." : "Run Backfill"}
        </button>
      </div>

      <pre>{status}</pre>
    </form>
  );
}
