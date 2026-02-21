import { UploadForm } from "../../components/upload-form";

export default function UploadPage() {
  return (
    <main>
      <h1>Upload Center</h1>
      <p>Two source-of-truth channels: SKU SOT workbook and Instacart inventory files.</p>

      <div style={{ display: "grid", gap: 16 }}>
        <UploadForm endpoint="/v1/imports/sot" label="Upload SKU SOT (.xlsx)" modeLabel="commit" />
        <UploadForm endpoint="/v1/imports/instacart-orders" label="Upload Instacart Orders (.csv/.xlsx)" modeLabel="commit" />
      </div>
    </main>
  );
}
