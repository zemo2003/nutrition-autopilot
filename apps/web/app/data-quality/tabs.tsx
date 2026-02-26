"use client";

import { useState } from "react";
import { VerificationQueue } from "../../components/verification-queue";
import { ScientificQABoard } from "../../components/scientific-qa-board";
import QcBoard from "../../components/qc-board";

type Tab = "verification" | "qa" | "qc";

type VerificationTask = {
  id: string;
  taskType: "SOURCE_RETRIEVAL" | "CONSISTENCY" | "LINEAGE_INTEGRITY";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "APPROVED" | "REJECTED" | "RESOLVED";
  title: string;
  description: string;
  payload: {
    productId?: string;
    nutrientKeys?: string[];
    proposedValues?: Record<string, number>;
    evidenceRefs?: string[];
    confidence?: number;
    sourceType?: string;
    historicalException?: boolean;
  };
};

export function DataQualityTabs({
  apiBase,
  initialTasks,
}: {
  apiBase: string;
  initialTasks: VerificationTask[];
}) {
  const [tab, setTab] = useState<Tab>("verification");

  return (
    <>
      <div className="pill-bar">
        <button className={`pill ${tab === "verification" ? "active" : ""}`} onClick={() => setTab("verification")}>
          Verification
        </button>
        <button className={`pill ${tab === "qa" ? "active" : ""}`} onClick={() => setTab("qa")}>
          QA Dashboard
        </button>
        <button className={`pill ${tab === "qc" ? "active" : ""}`} onClick={() => setTab("qc")}>
          QC Issues
        </button>
      </div>

      <div className="mt-6">
        {tab === "verification" && <VerificationQueue apiBase={apiBase} initialTasks={initialTasks} />}
        {tab === "qa" && <ScientificQABoard />}
        {tab === "qc" && <QcBoard />}
      </div>
    </>
  );
}
