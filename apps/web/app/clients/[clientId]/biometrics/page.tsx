import BiometricsBoard from "../../../../components/biometrics-board";

export default async function BiometricsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Biometrics Timeline</h1>
          <p className="page-subtitle">
            Track height, weight, body composition, and trends over time.
          </p>
        </div>
      </div>
      <BiometricsBoard clientId={clientId} />
    </div>
  );
}
