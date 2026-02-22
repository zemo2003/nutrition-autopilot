import { UploadForm } from "../../components/upload-form";
import { PilotBackfillForm } from "../../components/pilot-backfill-form";
import Link from "next/link";

export default function UploadPage() {
  return (
    <div className="page-shell">
      <div className="breadcrumbs">
        <Link href="/">Dashboard</Link>
        <span className="sep">/</span>
        <span className="current">Upload Center</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Upload Center</h1>
          <p className="page-subtitle">
            Import data and run backfills. Start with Pilot Backfill for instant historical labels.
          </p>
        </div>
        <div className="page-header-actions">
          <Link href="/" className="btn btn-outline">
            Back to Dashboard
          </Link>
        </div>
      </div>

      <div className="stack" style={{ gap: "var(--sp-6)" }}>
        <PilotBackfillForm />

        <hr className="divider" />

        <h2 className="section-title">Individual Imports</h2>

        <UploadForm
          endpoint="/v1/imports/sot"
          label="Upload SKU SOT"
          description="Import Source of Truth workbook with SKU Master, Recipe Lines, and Ingredients sheets."
          modeLabel="Commit"
          acceptTypes=".xlsx,.xls"
        />

        <UploadForm
          endpoint="/v1/imports/instacart-orders"
          label="Upload Instacart Orders"
          description="Import Instacart order history CSV or workbook to create inventory lots with nutrient hints."
          modeLabel="Commit"
          acceptTypes=".xlsx,.xls,.csv"
        />
      </div>
    </div>
  );
}
