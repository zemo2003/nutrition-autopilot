import Link from "next/link";
import { VerificationQueue } from "../../components/verification-queue";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

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

function buildQuery(search: {
  status?: string;
  severity?: string;
  historicalException?: string;
  sourceType?: string;
  confidenceMin?: string;
}) {
  const params = new URLSearchParams();
  if (search.status) params.set("status", search.status);
  if (search.severity) params.set("severity", search.severity);
  if (search.historicalException) params.set("historicalException", search.historicalException);
  if (search.sourceType) params.set("sourceType", search.sourceType);
  if (search.confidenceMin) params.set("confidenceMin", search.confidenceMin);
  return params.toString();
}

async function getTasks(search: {
  status?: string;
  severity?: string;
  historicalException?: string;
  sourceType?: string;
  confidenceMin?: string;
}) {
  const query = buildQuery(search);
  const url = `${API_BASE}/v1/verification/tasks${query ? `?${query}` : ""}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    return [] as VerificationTask[];
  }

  const json = (await response.json()) as { tasks?: VerificationTask[] };
  return json.tasks ?? [];
}

export default async function VerificationPage({
  searchParams
}: {
  searchParams?: Promise<{
    status?: string;
    severity?: string;
    historicalException?: string;
    sourceType?: string;
    confidenceMin?: string;
  }>;
}) {
  const rawParams = (await searchParams) ?? {};
  const params = { ...rawParams, status: rawParams.status ?? "OPEN" };
  const tasks = await getTasks(params);

  return (
    <div className="page-shell">
      <div className="breadcrumbs">
        <Link href="/">Dashboard</Link>
        <span className="sep">/</span>
        <span className="current">Verification</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Verification Queue</h1>
          <p className="page-subtitle">
            Review flagged nutrient values to keep your labels accurate.
          </p>
        </div>
        <div className="page-header-actions">
          <Link href="/" className="btn btn-outline">
            Dashboard
          </Link>
        </div>
      </div>

      <section className="card section">
        <div className="card-header">
          <h3>Filters</h3>
        </div>
        <form method="GET" className="filters-grid">
          <label>
            Status
            <select name="status" defaultValue={params.status ?? "OPEN"}>
              <option value="">Any</option>
              <option value="OPEN">OPEN</option>
              <option value="APPROVED">APPROVED</option>
              <option value="REJECTED">REJECTED</option>
              <option value="RESOLVED">RESOLVED</option>
            </select>
          </label>
          <label>
            Severity
            <select name="severity" defaultValue={params.severity ?? ""}>
              <option value="">Any</option>
              <option value="CRITICAL">CRITICAL</option>
              <option value="HIGH">HIGH</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="LOW">LOW</option>
            </select>
          </label>
          <label>
            Source Type
            <select name="sourceType" defaultValue={params.sourceType ?? ""}>
              <option value="">Any</option>
              <option value="MANUFACTURER">MANUFACTURER</option>
              <option value="USDA">USDA</option>
              <option value="DERIVED">DERIVED</option>
              <option value="MANUAL">MANUAL</option>
              <option value="MIXED">MIXED</option>
            </select>
          </label>
          <label>
            Confidence Min
            <input
              name="confidenceMin"
              type="number"
              step="0.05"
              min="0"
              max="1"
              placeholder="0.00"
              defaultValue={params.confidenceMin ?? ""}
            />
          </label>
          <label>
            Historical Exception
            <select name="historicalException" defaultValue={params.historicalException ?? ""}>
              <option value="">Any</option>
              <option value="true">Only Historical Exceptions</option>
            </select>
          </label>
          <div className="row">
            <button type="submit" className="btn btn-primary btn-sm">
              Apply
            </button>
            <Link href={"/verification" as any} className="btn btn-outline btn-sm">
              Reset
            </Link>
          </div>
        </form>
      </section>

      <VerificationQueue apiBase={API_BASE} initialTasks={tasks} />
    </div>
  );
}
