import MetricsBoard from "../../../../components/metrics-board";

export default async function MetricsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Health Metrics</h1>
          <p className="page-subtitle">
            Tracked lab values, vitals, and body composition metrics with reference ranges.
          </p>
        </div>
      </div>
      <MetricsBoard clientId={clientId} />
    </div>
  );
}
