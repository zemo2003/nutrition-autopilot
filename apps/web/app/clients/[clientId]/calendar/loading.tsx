export default function CalendarLoading() {
  return (
    <div className="page-shell">
      <div className="loading-page">
        <div className="loading-shimmer loading-bar" style={{ width: "30%" }} />
        <div className="loading-shimmer loading-bar" style={{ width: "45%" }} />
        <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
          <div className="loading-shimmer" style={{ width: 80, height: 32, borderRadius: 6 }} />
          <div className="loading-shimmer" style={{ width: 160, height: 32, borderRadius: 6 }} />
          <div className="loading-shimmer" style={{ width: 80, height: 32, borderRadius: 6 }} />
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="loading-shimmer loading-block" style={{ height: 80 }} />
        ))}
      </div>
    </div>
  );
}
