"use client";

import { useState } from "react";
import { BatchPrepBoard } from "../../components/batch-prep-board";
import PrepBoard from "../../components/prep-board";
import ComposerBoard from "../../components/composer-board";

type Tab = "batches" | "optimizer" | "composer";

export default function PrepPlanPage() {
  const [tab, setTab] = useState<Tab>("batches");

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Prep Plan</h1>
          <p className="page-subtitle">Plan batches, optimize weekly prep, compose meals.</p>
        </div>
      </div>

      <div className="pill-bar">
        <button className={`pill ${tab === "batches" ? "active" : ""}`} onClick={() => setTab("batches")}>
          Batch Prep
        </button>
        <button className={`pill ${tab === "optimizer" ? "active" : ""}`} onClick={() => setTab("optimizer")}>
          Optimizer
        </button>
        <button className={`pill ${tab === "composer" ? "active" : ""}`} onClick={() => setTab("composer")}>
          Composer
        </button>
      </div>

      <div className="mt-6">
        {tab === "batches" && <BatchPrepBoard />}
        {tab === "optimizer" && <PrepBoard />}
        {tab === "composer" && <ComposerBoard />}
      </div>
    </div>
  );
}
