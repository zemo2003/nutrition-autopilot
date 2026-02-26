"use client";

import Link from "next/link";

type Props = {
  counts: {
    activeSkus: number;
    activeIngredients: number;
    lotsOnHand: number;
    schedules: number;
    servedMeals: number;
    labels: number;
    openVerificationTasks: number;
  };
  quality: {
    month: string;
    coverage: {
      productFull40CoverageRatio: number;
      finalLabelFull40CoverageRatio: number;
    };
    evidence: {
      inferredRows: number;
      exceptionRows: number;
      floorRows: number;
      provisionalLabels: number;
    };
    totals: {
      openVerificationTasks: number;
      criticalOrHighVerificationTasks: number;
    };
  } | null;
  clients: { id: string; name: string; externalRef?: string }[];
};

export function ScienceDashboard({ counts, quality, clients }: Props) {
  const productCoverage = quality
    ? (quality.coverage.productFull40CoverageRatio * 100).toFixed(0)
    : "—";
  const labelCoverage = quality
    ? (quality.coverage.finalLabelFull40CoverageRatio * 100).toFixed(0)
    : "—";

  return (
    <div className="page-shell">
      {/* Hero */}
      <div className="science-hero">
        <h1 className="science-hero-title">Data Quality Snapshot</h1>
        <p className="science-hero-date">{quality?.month ?? new Date().toISOString().slice(0, 7)}</p>
      </div>

      {/* Verification queue summary */}
      <section className="section">
        <h2 className="section-title">Verification Queue</h2>
        <div className="kpi-grid">
          <div className="kpi">
            <div className="kpi-value">{counts.openVerificationTasks}</div>
            <div className="kpi-label">Open Tasks</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">{quality?.totals.criticalOrHighVerificationTasks ?? 0}</div>
            <div className="kpi-label">Critical / High</div>
            {(quality?.totals.criticalOrHighVerificationTasks ?? 0) > 0 && (
              <div className="kpi-note"><span className="badge badge-danger">Needs Attention</span></div>
            )}
          </div>
          <div className="kpi">
            <div className="kpi-value">{quality?.evidence.provisionalLabels ?? 0}</div>
            <div className="kpi-label">Provisional Labels</div>
          </div>
          <Link href={"/data-quality" as any} className="kpi" style={{ textDecoration: "none", cursor: "pointer" }}>
            <div className="kpi-value" style={{ fontSize: "var(--text-lg)" }}>Review Queue</div>
            <div className="kpi-label">Open verification tasks</div>
            <div className="kpi-note"><span className="badge badge-info">Open</span></div>
          </Link>
        </div>
      </section>

      {/* Coverage */}
      <section className="section">
        <h2 className="section-title">Nutrient Coverage</h2>
        <div className="kpi-grid">
          <div className="kpi">
            <div className="kpi-value">{productCoverage}%</div>
            <div className="kpi-label">Product Coverage (40-nutrient)</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">{labelCoverage}%</div>
            <div className="kpi-label">Label Coverage (40-nutrient)</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">{quality?.evidence.inferredRows ?? 0}</div>
            <div className="kpi-label">Inferred Nutrients</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">{quality?.evidence.exceptionRows ?? 0}</div>
            <div className="kpi-label">Exception Rows</div>
          </div>
        </div>
      </section>

      {/* System overview */}
      <section className="section">
        <h2 className="section-title">System Overview</h2>
        <div className="kpi-grid">
          <div className="kpi">
            <div className="kpi-value">{counts.activeSkus}</div>
            <div className="kpi-label">Active SKUs</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">{counts.activeIngredients}</div>
            <div className="kpi-label">Ingredients</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">{counts.servedMeals}</div>
            <div className="kpi-label">Served Meals</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">{counts.labels}</div>
            <div className="kpi-label">Frozen Labels</div>
          </div>
        </div>
      </section>

      {/* Quick links */}
      <section className="section">
        <h2 className="section-title">Quick Links</h2>
        <div className="row" style={{ gap: "var(--sp-2)" }}>
          <Link href={"/data-quality" as any} className="btn btn-outline">Verification</Link>
          <Link href={"/audit-labels" as any} className="btn btn-outline">Audit Trail</Link>
          <Link href={"/ops" as any} className="btn btn-outline">Ops Tower</Link>
          <Link href={"/upload" as any} className="btn btn-outline">Import Data</Link>
        </div>
      </section>

      {/* Clients */}
      {clients.length > 0 && (
        <section className="section">
          <h2 className="section-title">Client Health Data</h2>
          <div className="kpi-grid">
            {clients.slice(0, 4).map((client) => (
              <div key={client.id} style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
                <div style={{ fontWeight: 600, marginBottom: "var(--sp-1)" }}>{client.name}</div>
                <Link href={`/clients/${client.id}/biometrics` as any} className="btn btn-outline btn-sm">Biometrics</Link>
                <Link href={`/clients/${client.id}/documents` as any} className="btn btn-outline btn-sm">Documents</Link>
                <Link href={`/clients/${client.id}/metrics` as any} className="btn btn-outline btn-sm">Metrics</Link>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
