import Link from "next/link";
import { ScientificQABoard } from "../../components/scientific-qa-board";

export default function ScientificQAPage() {
  return (
    <div className="page-shell">
      <div className="breadcrumbs">
        <Link href="/">Dashboard</Link>
        <span className="sep">/</span>
        <span className="current">Scientific QA</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Scientific QA</h1>
          <p className="page-subtitle">
            Nutrient coverage, evidence quality, stale labels, and scientific review queue.
          </p>
        </div>
        <div className="page-header-actions">
          <Link href="/verification" className="btn btn-outline">
            Full Verification Queue
          </Link>
        </div>
      </div>

      <ScientificQABoard />
    </div>
  );
}
