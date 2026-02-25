import QcBoard from "../../components/qc-board";

export default function QcIssuesPage() {
  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">QC Issues</h1>
          <p className="page-subtitle">
            Monitor and resolve quality control issues across batches.
          </p>
        </div>
      </div>
      <QcBoard />
    </div>
  );
}
