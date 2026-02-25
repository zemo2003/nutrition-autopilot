import Link from "next/link";
import { BatchPrepBoard } from "../../components/batch-prep-board";

export default function BatchPrepPage() {
  return (
    <div className="page-shell">
      <div className="breadcrumbs">
        <Link href="/">Dashboard</Link>
        <span className="sep">/</span>
        <span className="current">Batch Prep</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Batch Prep</h1>
          <p className="page-subtitle">
            Plan and track weekly component prep — proteins, bases, vegetables, sauces.
          </p>
        </div>
      </div>

      <BatchPrepBoard />
    </div>
  );
}
