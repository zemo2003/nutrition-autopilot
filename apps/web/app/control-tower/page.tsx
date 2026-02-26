import ControlTowerBoard from "../../components/control-tower-board";

export default function ControlTowerPage() {
  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Ops Control Tower</h1>
          <p className="page-subtitle">
            High-signal operational dashboard with attention queue.
          </p>
        </div>
      </div>
      <ControlTowerBoard />
    </div>
  );
}
