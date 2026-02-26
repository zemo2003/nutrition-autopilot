import { DataQualityTabs } from "./tabs";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? process.env.API_BASE ?? "http://localhost:4000";

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

async function getTasks() {
  try {
    const url = `${API_BASE}/v1/verification/tasks?status=OPEN`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return [];
    const json = (await response.json()) as { tasks?: VerificationTask[] };
    return json.tasks ?? [];
  } catch {
    return [];
  }
}

export default async function DataQualityPage() {
  const tasks = await getTasks();

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Data Quality</h1>
          <p className="page-subtitle">Verification queue, scientific QA, and quality control.</p>
        </div>
      </div>

      <DataQualityTabs apiBase={API_BASE} initialTasks={tasks} />
    </div>
  );
}
