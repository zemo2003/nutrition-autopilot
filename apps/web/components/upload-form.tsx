"use client";

import { useState } from "react";

type Props = {
  endpoint: string;
  label: string;
  modeLabel?: string;
};

function resolveApiBase() {
  if (process.env.NEXT_PUBLIC_API_BASE) return process.env.NEXT_PUBLIC_API_BASE;
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  }
  return "http://localhost:4000";
}

export function UploadForm({ endpoint, label, modeLabel = "commit" }: Props) {
  const [status, setStatus] = useState<string>("Idle");
  const [mode, setMode] = useState<"dry-run" | "commit">("dry-run");

  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fileInput = form.querySelector("input[type=file]") as HTMLInputElement | null;
        const file = fileInput?.files?.[0];
        if (!file) {
          setStatus("Select a file first");
          return;
        }

        const data = new FormData();
        data.append("file", file);
        data.append("mode", mode);

        setStatus("Uploading...");
        const apiBase = resolveApiBase();

        const response = await fetch(`${apiBase}${endpoint}`, {
          method: "POST",
          body: data
        });
        const json = await response.json();
        if (!response.ok) {
          setStatus(`Failed: ${json.error || response.statusText}`);
          return;
        }
        setStatus(`Done: ${JSON.stringify(json)}`);
      }}
    >
      <h3>{label}</h3>
      <div className="row">
        <input type="file" accept=".xlsx,.xls,.csv" />
        <select value={mode} onChange={(e) => setMode(e.target.value as "dry-run" | "commit")}>
          <option value="dry-run">dry-run</option>
          <option value="commit">{modeLabel}</option>
        </select>
        <button type="submit">Upload</button>
      </div>
      <p style={{ whiteSpace: "pre-wrap" }}>{status}</p>
    </form>
  );
}
