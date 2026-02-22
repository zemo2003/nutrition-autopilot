import { UploadForm } from "../../components/upload-form";
import { PilotBackfillForm } from "../../components/pilot-backfill-form";

export default function UploadPage() {
  return (
    <main>
      <h1>Upload Center</h1>
      <p>Run imports and backfills from one place. Start with pilot backfill for immediate historical labels.</p>

      <div style={{ display: "grid", gap: 16 }}>
        <PilotBackfillForm />
        <UploadForm endpoint="/v1/imports/sot" label="Upload SKU SOT (.xlsx)" modeLabel="commit" />
        <UploadForm endpoint="/v1/imports/instacart-orders" label="Upload Instacart Orders (.csv/.xlsx)" modeLabel="commit" />
      </div>
    </main>
  );
}
