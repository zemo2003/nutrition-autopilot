import { UploadForm } from "../../components/upload-form";
import Link from "next/link";

export default function UploadPage() {
  return (
    <div className="page-shell">
      <div className="breadcrumbs">
        <Link href="/">Dashboard</Link>
        <span className="sep">/</span>
        <span className="current">Import</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Import Data</h1>
          <p className="page-subtitle">
            Upload your SKU catalog or Instacart orders to keep your nutrition data current.
          </p>
        </div>
        <div className="page-header-actions">
          <Link href="/" className="btn btn-outline">
            Back to Dashboard
          </Link>
        </div>
      </div>

      <div className="stack" style={{ gap: "var(--sp-6)" }}>
        <UploadForm
          endpoint="/v1/imports/sot"
          label="Upload SKU Catalog"
          description="Import your Source of Truth workbook with SKU Master, Recipe Lines, and Ingredients."
          modeLabel="Commit"
          acceptTypes=".xlsx,.xls"
        />

        <UploadForm
          endpoint="/v1/imports/instacart-orders"
          label="Upload Instacart Orders"
          description="Import Instacart order history to update inventory and generate nutrition labels."
          modeLabel="Commit"
          acceptTypes=".xlsx,.xls,.csv"
        />

        <div className="card" style={{ textAlign: "center", padding: "var(--sp-5)" }}>
          <p style={{ color: "var(--fg-muted)", marginBottom: "var(--sp-3)" }}>
            Or auto-import Instacart orders from your Gmail
          </p>
          <Link href={"/gmail" as any} className="btn btn-outline">
            Set up Gmail Auto-Import
          </Link>
        </div>
      </div>
    </div>
  );
}
