import DocumentsBoard from "../../../../components/documents-board";

export default async function DocumentsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Documents</h1>
          <p className="page-subtitle">
            Upload and manage client documents (DEXA, bloodwork, CGM reports).
          </p>
        </div>
      </div>
      <DocumentsBoard clientId={clientId} />
    </div>
  );
}
