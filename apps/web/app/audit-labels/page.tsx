"use client";

import { useState } from "react";
import AuditTraceBoard from "../../components/audit-trace-board";
import CalibrationBoard from "../../components/calibration-board";

type Tab = "audit" | "calibration";

export default function AuditLabelsPage() {
  const [tab, setTab] = useState<Tab>("audit");
  const [scheduleId, setScheduleId] = useState("");
  const [activeScheduleId, setActiveScheduleId] = useState("");

  const handleLookup = () => {
    if (scheduleId.trim()) {
      setActiveScheduleId(scheduleId.trim());
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit & Labels</h1>
          <p className="page-subtitle">Meal audit traces, label provenance, and yield calibration.</p>
        </div>
      </div>

      <div className="pill-bar">
        <button className={`pill ${tab === "audit" ? "active" : ""}`} onClick={() => setTab("audit")}>
          Audit Trace
        </button>
        <button className={`pill ${tab === "calibration" ? "active" : ""}`} onClick={() => setTab("calibration")}>
          Calibration
        </button>
      </div>

      <div className="mt-6">
        {tab === "audit" && (
          <>
            <div className="row mb-4" style={{ gap: "var(--sp-2)" }}>
              <input
                type="text"
                placeholder="Enter schedule ID to trace..."
                value={scheduleId}
                onChange={(e) => setScheduleId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLookup()}
                style={{ maxWidth: 400 }}
              />
              <button className="btn btn-primary btn-sm" onClick={handleLookup}>
                Trace
              </button>
            </div>
            {activeScheduleId ? (
              <AuditTraceBoard scheduleId={activeScheduleId} />
            ) : (
              <section className="card">
                <div className="state-box">
                  <div className="state-icon">&#x1f50d;</div>
                  <div className="state-title">Enter a Schedule ID</div>
                  <div className="state-desc">
                    Paste a meal schedule ID above to view the full audit trace with ingredient lineage and nutrient provenance.
                  </div>
                </div>
              </section>
            )}
          </>
        )}
        {tab === "calibration" && <CalibrationBoard />}
      </div>
    </div>
  );
}
