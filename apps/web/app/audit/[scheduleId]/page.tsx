import AuditTraceBoard from "../../../components/audit-trace-board";

export default async function AuditPage({ params }: { params: Promise<{ scheduleId: string }> }) {
  const { scheduleId } = await params;
  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Meal Audit Trace</h1>
          <p className="page-subtitle">
            Freeze-time provenance, ingredient lineage, and nutrient evidence.
          </p>
        </div>
      </div>
      <AuditTraceBoard scheduleId={scheduleId} />
    </div>
  );
}
