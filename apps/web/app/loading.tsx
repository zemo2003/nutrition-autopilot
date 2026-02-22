export default function Loading() {
  return (
    <div className="page-shell">
      <div className="loading-page">
        <div className="loading-shimmer loading-bar" style={{ width: "40%" }} />
        <div className="loading-shimmer loading-bar" style={{ width: "60%" }} />
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", marginTop: 8 }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="loading-shimmer loading-block" />
          ))}
        </div>
        <div className="loading-shimmer loading-block" style={{ height: 200 }} />
      </div>
    </div>
  );
}
