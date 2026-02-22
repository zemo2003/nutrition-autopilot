export default function LabelLoading() {
  return (
    <div className="page-shell">
      <div className="loading-page">
        <div className="loading-shimmer loading-bar" style={{ width: "35%" }} />
        <div className="loading-shimmer loading-bar" style={{ width: "55%" }} />
        <div style={{ display: "grid", gap: 20, gridTemplateColumns: "1fr 1fr", marginTop: 8 }}>
          <div className="loading-shimmer loading-block" style={{ height: 400 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="loading-shimmer loading-block" style={{ height: 120 }} />
            <div className="loading-shimmer loading-block" style={{ height: 120 }} />
            <div className="loading-shimmer loading-block" style={{ height: 120 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
