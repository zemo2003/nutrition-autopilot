import Link from "next/link";
import { InventoryBoard } from "../../components/inventory-board";

export default function InventoryPage() {
  return (
    <div className="page-shell">
      <div className="breadcrumbs">
        <Link href="/">Dashboard</Link>
        <span className="sep">/</span>
        <span className="current">Inventory</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Inventory</h1>
          <p className="page-subtitle">
            Track on-hand stock, expiry dates, and log waste or adjustments.
          </p>
        </div>
        <div className="page-header-actions">
          <Link href="/upload" className="btn btn-outline">
            Import Orders
          </Link>
        </div>
      </div>

      <InventoryBoard />
    </div>
  );
}
