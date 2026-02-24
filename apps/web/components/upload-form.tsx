"use client";

import { useCallback, useState, useRef } from "react";

type Props = {
  endpoint: string;
  label: string;
  modeLabel?: string;
  description?: string;
  acceptTypes?: string;
};

type ResultState = "idle" | "loading" | "success" | "error";

function resolveApiBase() {
  if (process.env.NEXT_PUBLIC_API_BASE) return process.env.NEXT_PUBLIC_API_BASE;
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    // Deployed on Render: derive API hostname from web hostname
    if (host.includes("onrender.com")) {
      return `${window.location.protocol}//${host.replace("-web", "-api")}`;
    }
    return `${window.location.protocol}//${host}:4000`;
  }
  return "http://localhost:4000";
}

export function UploadForm({
  endpoint,
  label,
  modeLabel = "commit",
  description,
  acceptTypes = ".xlsx,.xls,.csv",
}: Props) {
  const [mode, setMode] = useState<"dry-run" | "commit">("dry-run");
  const [resultState, setResultState] = useState<ResultState>("idle");
  const [resultMessage, setResultMessage] = useState("Ready to upload");
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const file = fileRef.current?.files?.[0];
      if (!file) {
        setResultState("error");
        setResultMessage("Select a file first");
        return;
      }

      const data = new FormData();
      data.append("file", file);
      data.append("mode", mode);

      setResultState("loading");
      setResultMessage("Uploading...");

      try {
        const apiBase = resolveApiBase();
        const response = await fetch(`${apiBase}${endpoint}`, {
          method: "POST",
          body: data,
        });
        const json = await response.json();
        if (!response.ok) {
          setResultState("error");
          setResultMessage(json.error || response.statusText);
          return;
        }
        setResultState("success");
        setResultMessage(JSON.stringify(json, null, 2));
      } catch (err) {
        setResultState("error");
        setResultMessage(err instanceof Error ? err.message : "Upload failed");
      }
    },
    [endpoint, mode]
  );

  return (
    <form className="card" onSubmit={handleSubmit}>
      <div className="card-header">
        <h3>{label}</h3>
        <span className="tag">{endpoint}</span>
      </div>
      {description && <p className="label-text mb-4">{description}</p>}

      <div
        className={`upload-zone ${dragOver ? "drag-over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file && fileRef.current) {
            const dt = new DataTransfer();
            dt.items.add(file);
            fileRef.current.files = dt.files;
            setFileName(file.name);
          }
        }}
      >
        <div className="upload-zone-icon">+</div>
        <div className="upload-zone-text">
          <strong>Choose a file</strong> or drag it here
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={acceptTypes}
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
        />
      </div>

      {fileName && (
        <div className="file-selected">{fileName}</div>
      )}

      <div className="row mt-4">
        <select value={mode} onChange={(e) => setMode(e.target.value as "dry-run" | "commit")}>
          <option value="dry-run">Dry Run (preview)</option>
          <option value="commit">{modeLabel}</option>
        </select>
        <button type="submit" disabled={resultState === "loading"}>
          {resultState === "loading" ? "Uploading..." : "Upload"}
        </button>
      </div>

      <div className={`result-box mt-4 result-${resultState}`}>
        {resultState === "loading" && <strong>Processing...</strong>}
        {resultState === "success" && <strong>Success</strong>}
        {resultState === "error" && <strong>Error</strong>}
        {resultState === "idle" && <span>Ready</span>}
        {resultMessage && resultState !== "idle" && (
          <pre>{resultMessage}</pre>
        )}
      </div>
    </form>
  );
}
