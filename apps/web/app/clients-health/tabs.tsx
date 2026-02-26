"use client";

import { useState } from "react";
import { ClientProfileView } from "../../components/client-profile";
import BiometricsBoard from "../../components/biometrics-board";
import DocumentsBoard from "../../components/documents-board";
import MetricsBoard from "../../components/metrics-board";

type Tab = "profile" | "biometrics" | "documents" | "metrics";

type Client = { id: string; name: string; externalRef?: string };

export function ClientHealthTabs({ clients }: { clients: Client[] }) {
  const [selectedClient, setSelectedClient] = useState<string>(clients[0]?.id ?? "");
  const [tab, setTab] = useState<Tab>("biometrics");

  if (clients.length === 0) {
    return (
      <section className="card">
        <div className="state-box">
          <div className="state-icon">&#x1f464;</div>
          <div className="state-title">No Clients</div>
          <div className="state-desc">Import data to see client health profiles.</div>
        </div>
      </section>
    );
  }

  return (
    <>
      {/* Client selector */}
      <div className="client-selector">
        {clients.map((c) => (
          <button
            key={c.id}
            className={`client-chip ${selectedClient === c.id ? "active" : ""}`}
            onClick={() => setSelectedClient(c.id)}
          >
            <span className="client-chip-avatar">{c.name.charAt(0).toUpperCase()}</span>
            {c.name}
          </button>
        ))}
      </div>

      {/* Sub-tabs */}
      <div className="pill-bar mt-4">
        <button className={`pill ${tab === "biometrics" ? "active" : ""}`} onClick={() => setTab("biometrics")}>
          Biometrics
        </button>
        <button className={`pill ${tab === "documents" ? "active" : ""}`} onClick={() => setTab("documents")}>
          Documents
        </button>
        <button className={`pill ${tab === "metrics" ? "active" : ""}`} onClick={() => setTab("metrics")}>
          Metrics
        </button>
        <button className={`pill ${tab === "profile" ? "active" : ""}`} onClick={() => setTab("profile")}>
          Profile
        </button>
      </div>

      <div className="mt-6" key={selectedClient}>
        {tab === "biometrics" && <BiometricsBoard clientId={selectedClient} />}
        {tab === "documents" && <DocumentsBoard clientId={selectedClient} />}
        {tab === "metrics" && <MetricsBoard clientId={selectedClient} />}
        {tab === "profile" && <ClientProfileView clientId={selectedClient} />}
      </div>
    </>
  );
}
