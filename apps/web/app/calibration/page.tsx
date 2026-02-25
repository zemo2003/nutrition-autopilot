import CalibrationBoard from "../../components/calibration-board";

export default function CalibrationPage() {
  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Yield Calibration</h1>
          <p className="page-subtitle">
            Review yield variance, calibration proposals, and analytics.
          </p>
        </div>
      </div>
      <CalibrationBoard />
    </div>
  );
}
