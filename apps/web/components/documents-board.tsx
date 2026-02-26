"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

type ClientDocument = {
  id: string;
  documentType: string;
  collectedAt: string;
  uploadedAt: string;
  sourceProvider: string | null;
  tags: string[];
  parsingStatus: string;
  parsingError: string | null;
  notes: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  fileAttachment: {
    id: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
  } | null;
};

const DOC_TYPES = ["DEXA", "BLOODWORK", "CGM", "OTHER"] as const;
const STATUS_COLORS: Record<string, string> = {
  NOT_STARTED: "var(--c-ink-soft)",
  QUEUED: "var(--c-warning)",
  PARSED_PARTIAL: "var(--c-warning)",
  VERIFIED: "var(--c-success)",
  FAILED: "var(--c-danger)",
};

export default function DocumentsBoard({ clientId }: { clientId: string }) {
  const [documents, setDocuments] = useState<ClientDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"list" | "upload">("list");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const fileRef = useRef<HTMLInputElement>(null);

  // Upload form state
  const [form, setForm] = useState({
    documentType: "OTHER" as string,
    collectedAt: new Date().toISOString().slice(0, 10),
    sourceProvider: "",
    tags: "",
    notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const base = resolveApiBase();
    const params = new URLSearchParams();
    if (filterType !== "all") params.set("type", filterType);
    if (filterStatus !== "all") params.set("status", filterStatus);
    const res = await fetch(`${base}/v1/clients/${clientId}/documents?${params}`);
    if (res.ok) {
      const data = await res.json();
      setDocuments(data.documents ?? []);
    }
    setLoading(false);
  }, [clientId, filterType, filterStatus]);

  useEffect(() => { load(); }, [load]);

  const handleUpload = async () => {
    const base = resolveApiBase();
    const formData = new FormData();
    formData.append("documentType", form.documentType);
    formData.append("collectedAt", form.collectedAt);
    if (form.sourceProvider) formData.append("sourceProvider", form.sourceProvider);
    if (form.tags) formData.append("tags", form.tags);
    if (form.notes) formData.append("notes", form.notes);
    const file = fileRef.current?.files?.[0];
    if (file) formData.append("file", file);

    const res = await fetch(`${base}/v1/clients/${clientId}/documents`, {
      method: "POST",
      body: formData,
    });
    if (res.ok) {
      setForm({ documentType: "OTHER", collectedAt: new Date().toISOString().slice(0, 10), sourceProvider: "", tags: "", notes: "" });
      if (fileRef.current) fileRef.current.value = "";
      setTab("list");
      load();
    }
  };

  const handleVerify = async (id: string) => {
    const base = resolveApiBase();
    await fetch(`${base}/v1/clients/${clientId}/documents/${id}/verify`, { method: "POST" });
    load();
  };

  if (loading) return <div className="state-box"><div className="state-title">Loading documents...</div></div>;

  return (
    <div>
      {/* Tabs */}
      <div className="row" style={{ gap: "var(--sp-2)", marginBottom: "var(--sp-4)" }}>
        <button className={`btn ${tab === "list" ? "btn-primary" : "btn-outline"} btn-sm`} onClick={() => setTab("list")}>Documents</button>
        <button className={`btn ${tab === "upload" ? "btn-primary" : "btn-outline"} btn-sm`} onClick={() => setTab("upload")}>Upload</button>
      </div>

      {tab === "list" && (
        <>
          {/* Filters */}
          <div className="row" style={{ gap: "var(--sp-2)", marginBottom: "var(--sp-3)" }}>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="input" style={{ width: "auto" }}>
              <option value="all">All Types</option>
              {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="input" style={{ width: "auto" }}>
              <option value="all">All Statuses</option>
              <option value="NOT_STARTED">Not Started</option>
              <option value="QUEUED">Queued</option>
              <option value="PARSED_PARTIAL">Partial</option>
              <option value="VERIFIED">Verified</option>
              <option value="FAILED">Failed</option>
            </select>
          </div>

          {documents.length === 0 ? (
            <div className="state-box"><div className="state-title">No documents</div><div className="state-desc">Upload a document to get started.</div></div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th><th>Collected</th><th>File</th><th>Provider</th><th>Status</th><th>Tags</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((d) => (
                    <tr key={d.id}>
                      <td><span className="badge badge-info">{d.documentType}</span></td>
                      <td>{new Date(d.collectedAt).toLocaleDateString()}</td>
                      <td>{d.fileAttachment ? (
                        <span title={`${(d.fileAttachment.sizeBytes / 1024).toFixed(0)} KB`}>{d.fileAttachment.originalName}</span>
                      ) : "—"}</td>
                      <td>{d.sourceProvider ?? "—"}</td>
                      <td><span style={{ color: STATUS_COLORS[d.parsingStatus] ?? "inherit", fontWeight: 600 }}>{d.parsingStatus}</span></td>
                      <td>{d.tags.length > 0 ? d.tags.map((t, i) => <span key={i} className="badge" style={{ marginRight: 4 }}>{t}</span>) : "—"}</td>
                      <td>
                        {d.parsingStatus !== "VERIFIED" && (
                          <button className="btn btn-outline btn-sm" onClick={() => handleVerify(d.id)}>Verify</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "upload" && (
        <div className="card" style={{ maxWidth: 480 }}>
          <div style={{ display: "grid", gap: "var(--sp-3)" }}>
            <label>Document Type
              <select value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value })} className="input">
                {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label>Date Collected <input type="date" value={form.collectedAt} onChange={(e) => setForm({ ...form, collectedAt: e.target.value })} className="input" /></label>
            <label>File <input type="file" ref={fileRef} className="input" accept=".pdf,.jpg,.jpeg,.png,.csv,.xlsx,.json,.txt" /></label>
            <label>Provider <input type="text" value={form.sourceProvider} onChange={(e) => setForm({ ...form, sourceProvider: e.target.value })} className="input" placeholder="Lab name, clinic, etc." /></label>
            <label>Tags (comma-separated) <input type="text" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} className="input" placeholder="annual, follow-up" /></label>
            <label>Notes <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="input" placeholder="Optional notes" /></label>
            <button className="btn btn-primary" onClick={handleUpload}>Upload Document</button>
          </div>
        </div>
      )}
    </div>
  );
}
