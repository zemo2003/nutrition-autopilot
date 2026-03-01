import { KitchenExecutionBoard } from "../../components/kitchen-execution-board";

export default function KitchenPage() {
  return (
    <div className="page-shell">
      <div style={{ marginBottom: "var(--sp-2)" }}>
        <span className="breadcrumb"><a href="/">Dashboard</a> / Kitchen</span>
      </div>
      <h1 className="page-title">Kitchen Mode</h1>
      <p className="page-subtitle">Prep queue &amp; batch execution — step-by-step workflow</p>
      <KitchenExecutionBoard />
    </div>
  );
}
