"use client";

import { useMemo, useState } from "react";

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

export function VerificationQueue({
  apiBase,
  initialTasks
}: {
  apiBase: string;
  initialTasks: VerificationTask[];
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reviewTask(taskId: string, status: "APPROVED" | "REJECTED") {
    setError(null);
    setLoadingTaskId(taskId);
    try {
      const response = await fetch(`${apiBase}/v1/verification/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          decision: status === "APPROVED" ? "approve_nutrient_subset" : "reject_nutrient_subset",
          notes: "Reviewed from verification queue"
        })
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || `Request failed (${response.status})`);
      }

      setTasks((prev) =>
        prev.map((task) => (task.id === taskId ? { ...task, status } : task))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Task update failed");
    } finally {
      setLoadingTaskId(null);
    }
  }

  const openCount = useMemo(() => tasks.filter((task) => task.status === "OPEN").length, [tasks]);

  return (
    <div className="stack">
      <div className="card">
        <div className="card-header">
          <h3>Queue Status</h3>
          <span className="badge badge-neutral">{openCount} open</span>
        </div>
        <p className="label-text">
          Approvals are nutrient-key scoped. Each action only verifies the nutrient keys contained in that task payload.
        </p>
        {error ? <p className="alert error mt-4">{error}</p> : null}
      </div>

      {tasks.length === 0 ? (
        <div className="card">
          <div className="state-box">
            <div className="state-icon">&#x2713;</div>
            <div className="state-title">No Verification Tasks</div>
            <div className="state-desc">No tasks match the active filters.</div>
          </div>
        </div>
      ) : (
        tasks.map((task) => {
          const isUpdating = loadingTaskId === task.id;
          const severityBadge =
            task.severity === "CRITICAL"
              ? "badge-danger"
              : task.severity === "HIGH"
                ? "badge-warn"
                : "badge-neutral";
          const nutrientKeys = task.payload.nutrientKeys ?? [];

          return (
            <div key={task.id} className="card">
              <div className="card-header">
                <div>
                  <h3>{task.title}</h3>
                  <p className="label-text mt-2">{task.description}</p>
                </div>
                <div className="row">
                  <span className={`badge ${severityBadge}`}>{task.severity}</span>
                  <span className="badge badge-neutral">{task.status}</span>
                </div>
              </div>

              <div className="verification-meta">
                {task.payload.productId ? (
                  <span className="tag">Product: {task.payload.productId.slice(0, 10)}...</span>
                ) : null}
                {typeof task.payload.confidence === "number" ? (
                  <span className="tag">Confidence: {(task.payload.confidence * 100).toFixed(0)}%</span>
                ) : null}
                {task.payload.sourceType ? <span className="tag">Source: {task.payload.sourceType}</span> : null}
                {task.payload.historicalException ? (
                  <span className="badge badge-warn">Historical Exception</span>
                ) : null}
              </div>

              <div className="verification-nutrients">
                <strong>Nutrient Keys ({nutrientKeys.length})</strong>
                <div className="row mt-2">
                  {nutrientKeys.slice(0, 20).map((key) => (
                    <span key={key} className="tag">
                      {key}
                    </span>
                  ))}
                  {nutrientKeys.length > 20 ? <span className="tag">+{nutrientKeys.length - 20} more</span> : null}
                </div>
              </div>

              <div className="row mt-4">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={isUpdating || task.status !== "OPEN"}
                  onClick={() => reviewTask(task.id, "APPROVED")}
                >
                  {isUpdating ? "Saving..." : "Approve"}
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={isUpdating || task.status !== "OPEN"}
                  onClick={() => reviewTask(task.id, "REJECTED")}
                >
                  Reject
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
