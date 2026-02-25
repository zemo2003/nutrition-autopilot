"use client";

import { useCallback, useState, useRef, useEffect } from "react";

type Props = {
  endpoint: string;
  label: string;
  modeLabel?: string;
  description?: string;
  acceptTypes?: string;
};

type ResultState = "idle" | "loading" | "success" | "error";
type EnrichmentState = "idle" | "PROCESSING" | "COMPLETED" | "FAILED";

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

function EnrichmentStatus({ jobId }: { jobId: string }) {
  const [status, setStatus] = useState<EnrichmentState>("PROCESSING");
  const [productsProcessed, setProductsProcessed] = useState<number | null>(null);
  const [upserts, setUpserts] = useState<number | null>(null);

  useEffect(() => {
    if (status === "COMPLETED" || status === "FAILED") return;

    const apiBase = resolveApiBase();
    const poll = async () => {
      try {
        const res = await fetch(`${apiBase}/v1/imports/${jobId}/enrichment-status`);
        const data = await res.json();
        if (data.status === "COMPLETED") {
          setStatus("COMPLETED");
          setProductsProcessed(data.summary?.productsProcessed ?? null);
          setUpserts(data.summary?.upserts ?? null);
        } else if (data.status === "FAILED") {
          setStatus("FAILED");
        }
      } catch {
        // keep polling
      }
    };

    const interval = setInterval(poll, 3000);
    poll();
    return () => clearInterval(interval);
  }, [jobId, status]);

  if (status === "PROCESSING") {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
        borderRadius: 8,
        background: "var(--c-info-soft, #e8f4fd)",
        color: "var(--c-info, #1971c2)",
        fontSize: "var(--text-sm)",
        marginTop: 8,
      }}>
        <span className="enrichment-spinner" />
        <span>
          <strong>Verifying nutrition data...</strong>
          <br />
          <span style={{ fontSize: "var(--text-xs)", opacity: 0.8 }}>
            Cross-referencing with USDA database. This may take a minute.
          </span>
        </span>
      </div>
    );
  }

  if (status === "COMPLETED") {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
        borderRadius: 8,
        background: "var(--c-success-soft, #e6f9e6)",
        color: "var(--c-success, #2b8a3e)",
        fontSize: "var(--text-sm)",
        marginTop: 8,
      }}>
        <span style={{ fontSize: 18 }}>✓</span>
        <span>
          <strong>Nutrition verification complete</strong>
          {productsProcessed !== null && (
            <>
              <br />
              <span style={{ fontSize: "var(--text-xs)", opacity: 0.8 }}>
                {productsProcessed} products enriched · {upserts} nutrient values updated
              </span>
            </>
          )}
        </span>
      </div>
    );
  }

  if (status === "FAILED") {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
        borderRadius: 8,
        background: "var(--c-danger-soft, #fde8e8)",
        color: "var(--c-danger, #c92a2a)",
        fontSize: "var(--text-sm)",
        marginTop: 8,
      }}>
        <span style={{ fontSize: 18 }}>⚠</span>
        <span>
          <strong>Nutrition verification had issues</strong>
          <br />
          <span style={{ fontSize: "var(--text-xs)", opacity: 0.8 }}>
            Some nutrients may need manual review. Check the Verification page.
          </span>
        </span>
      </div>
    );
  }

  return null;
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
  const [enrichmentJobId, setEnrichmentJobId] = useState<string | null>(null);
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
      setEnrichmentJobId(null);

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

        // If enrichment was triggered, show the enrichment status
        if (json.enrichmentStatus === "PROCESSING" && json.importJobId) {
          setEnrichmentJobId(json.importJobId);
        }

        // Clean up the response for display
        const { enrichmentStatus: _es, ...displayJson } = json;
        setResultMessage(JSON.stringify(displayJson, null, 2));
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
        {resultState === "success" && <strong>Import Successful</strong>}
        {resultState === "error" && <strong>Error</strong>}
        {resultState === "idle" && <span>Ready</span>}
        {resultMessage && resultState !== "idle" && (
          <pre>{resultMessage}</pre>
        )}
      </div>

      {enrichmentJobId && <EnrichmentStatus jobId={enrichmentJobId} />}
    </form>
  );
}
