export default function UploadLoading() {
  return (
    <div className="page-shell">
      <div className="loading-page">
        <div className="loading-shimmer loading-bar" style={{ width: "30%" }} />
        <div className="loading-shimmer loading-bar" style={{ width: "50%" }} />
        <div className="loading-shimmer loading-block" style={{ height: 300 }} />
        <div className="loading-shimmer loading-block" style={{ height: 200 }} />
      </div>
    </div>
  );
}
