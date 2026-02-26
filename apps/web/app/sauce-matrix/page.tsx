import SauceMatrixBoard from "../../components/sauce-matrix-board";

export default function SauceMatrixPage() {
  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Sauce Matrix</h1>
          <p className="page-subtitle">
            Explore flavor families, portion presets, and component pairings.
          </p>
        </div>
      </div>
      <SauceMatrixBoard />
    </div>
  );
}
