import PrepBoard from "../../components/prep-board";

export default function PrepPage() {
  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Weekly Prep Optimizer</h1>
          <p className="page-subtitle">
            Generate demand rollups, batch suggestions, and shortage alerts for the week ahead.
          </p>
        </div>
      </div>
      <PrepBoard />
    </div>
  );
}
