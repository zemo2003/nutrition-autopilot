import Link from "next/link";
import NutritionWeekBoard from "../../../../components/nutrition-week-board";

export default async function NutritionPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;

  return (
    <div className="page-shell">
      <div className="breadcrumbs">
        <Link href="/">Dashboard</Link>
        <span className="sep">/</span>
        <Link href={`/clients/${clientId}/calendar`}>Client</Link>
        <span className="sep">/</span>
        <span className="current">Weekly Nutrition</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Weekly Nutrition</h1>
          <p className="page-subtitle">
            7-day nutrient breakdown for client <code>{clientId.slice(0, 8)}...</code>
          </p>
        </div>
        <div className="page-header-actions">
          <Link href={`/clients/${clientId}/calendar`} className="btn btn-outline">Calendar</Link>
          <Link href={`/clients/${clientId}/biometrics`} className="btn btn-outline">Biometrics</Link>
          <Link href="/" className="btn btn-outline">Dashboard</Link>
        </div>
      </div>

      <NutritionWeekBoard clientId={clientId} />
    </div>
  );
}
