import ControlTowerBoard from "../../components/control-tower-board";

export default function OpsPage() {
  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Ops Tower</h1>
          <p className="page-subtitle">Operational health scores, attention queue, and system alerts.</p>
        </div>
      </div>

      <ControlTowerBoard />
    </div>
  );
}
