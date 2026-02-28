"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

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

interface SyncLogEntry {
  id: string;
  syncedAt: string;
  emailsScanned: number;
  ordersImported: number;
  ordersSkipped: number;
  errors: string[] | null;
}

interface GmailStatus {
  connected: boolean;
  email?: string;
  lastSyncAt?: string;
  syncStatus?: string;
  syncError?: string;
  history?: SyncLogEntry[];
}

export function GmailPanel() {
  const searchParams = useSearchParams();
  const justConnected = searchParams.get("connected") === "true";

  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const apiBase = resolveApiBase();

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/v1/gmail/status`);
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Poll while syncing
  useEffect(() => {
    if (status?.syncStatus !== "SYNCING") return;
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [status?.syncStatus, fetchStatus]);

  const handleConnect = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/v1/gmail/auth-url`);
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error("Failed to get auth URL:", err);
    }
  }, [apiBase]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      await fetch(`${apiBase}/v1/gmail/sync`, { method: "POST" });
      // Refetch status to show syncing state
      setTimeout(fetchStatus, 1000);
    } catch (err) {
      console.error("Failed to trigger sync:", err);
    } finally {
      setSyncing(false);
    }
  }, [apiBase, fetchStatus]);

  const handleDisconnect = useCallback(async () => {
    if (!confirm("Are you sure you want to disconnect Gmail? You can reconnect later.")) return;
    setDisconnecting(true);
    try {
      await fetch(`${apiBase}/v1/gmail/disconnect`, { method: "POST" });
      await fetchStatus();
    } catch (err) {
      console.error("Failed to disconnect:", err);
    } finally {
      setDisconnecting(false);
    }
  }, [apiBase, fetchStatus]);

  if (loading) {
    return (
      <div className="page-shell">
        <div className="card">
          <div className="state-box">
            <div className="state-title">Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="breadcrumbs">
        <Link href="/">Dashboard</Link>
        <span className="sep">/</span>
        <Link href={"/upload" as any}>Import</Link>
        <span className="sep">/</span>
        <span className="current">Gmail</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Gmail Auto-Import</h1>
          <p className="page-subtitle">
            Automatically import Instacart order confirmations from your Gmail.
          </p>
        </div>
        <div className="page-header-actions">
          <Link href={"/upload" as any} className="btn btn-outline">
            Back to Import
          </Link>
        </div>
      </div>

      {justConnected && (
        <div className="card" style={{ borderLeft: "4px solid var(--green, #22c55e)", marginBottom: "var(--sp-4)" }}>
          <div className="card-body" style={{ color: "var(--green, #22c55e)" }}>
            Gmail connected successfully! You can now sync Instacart orders.
          </div>
        </div>
      )}

      <div className="stack" style={{ gap: "var(--sp-6)" }}>
        {/* Connection Status */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Connection Status</h2>
          </div>
          <div className="card-body">
            {!status?.connected ? (
              <div className="state-box">
                <div className="state-icon" style={{ fontSize: "2rem" }}>📧</div>
                <div className="state-title">Gmail Not Connected</div>
                <div className="state-desc">
                  Connect your Gmail account to automatically import Instacart order confirmation
                  emails. Only read-only access is requested &mdash; we never send or modify emails.
                </div>
                <button className="btn-primary mt-4" onClick={handleConnect}>
                  Connect Gmail
                </button>
              </div>
            ) : (
              <div>
                <div className="row" style={{ alignItems: "center", gap: "var(--sp-3)", marginBottom: "var(--sp-4)" }}>
                  <span
                    className="status-dot green"
                    style={{ width: 10, height: 10, borderRadius: "50%", display: "inline-block" }}
                  />
                  <span style={{ fontWeight: 600 }}>Connected: {status.email}</span>
                </div>

                {status.lastSyncAt && (
                  <p style={{ color: "var(--fg-muted)", marginBottom: "var(--sp-2)", fontSize: "var(--fs-sm)" }}>
                    Last sync: {new Date(status.lastSyncAt).toLocaleString()}
                  </p>
                )}

                {status.syncError && (
                  <p style={{ color: "var(--red, #ef4444)", marginBottom: "var(--sp-2)", fontSize: "var(--fs-sm)" }}>
                    Last error: {status.syncError}
                  </p>
                )}

                <div className="row mt-4" style={{ gap: "var(--sp-2)" }}>
                  <button
                    className="btn-primary"
                    onClick={handleSync}
                    disabled={syncing || status.syncStatus === "SYNCING"}
                  >
                    {status.syncStatus === "SYNCING" ? "Syncing..." : syncing ? "Starting..." : "Sync Now"}
                  </button>
                  <button
                    className="btn btn-outline"
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                    style={{ color: "var(--red, #ef4444)" }}
                  >
                    {disconnecting ? "Disconnecting..." : "Disconnect"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sync History */}
        {status?.connected && status.history && status.history.length > 0 && (
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Sync History</h2>
            </div>
            <div className="card-body">
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Emails Scanned</th>
                      <th>Orders Imported</th>
                      <th>Skipped</th>
                      <th>Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.history.map((entry) => (
                      <tr key={entry.id}>
                        <td>{new Date(entry.syncedAt).toLocaleString()}</td>
                        <td>{entry.emailsScanned}</td>
                        <td style={{ color: entry.ordersImported > 0 ? "var(--green, #22c55e)" : undefined }}>
                          {entry.ordersImported}
                        </td>
                        <td>{entry.ordersSkipped}</td>
                        <td style={{ color: entry.errors ? "var(--red, #ef4444)" : undefined }}>
                          {entry.errors ? (Array.isArray(entry.errors) ? entry.errors.length : 1) : 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* How it works */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">How It Works</h2>
          </div>
          <div className="card-body" style={{ color: "var(--fg-muted)" }}>
            <ol style={{ paddingLeft: "var(--sp-5)", lineHeight: 1.8 }}>
              <li>Connect your Gmail account (read-only access)</li>
              <li>Numen automatically searches for Instacart order confirmation emails</li>
              <li>Items are parsed from order emails and imported into your inventory</li>
              <li>New products create review tasks for ingredient mapping</li>
              <li>Sync runs automatically every hour, or click &ldquo;Sync Now&rdquo;</li>
            </ol>
            <p style={{ marginTop: "var(--sp-3)", fontSize: "var(--fs-sm)" }}>
              You can also continue to{" "}
              <Link href={"/upload" as any} style={{ color: "var(--accent)" }}>
                upload Instacart CSVs manually
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
