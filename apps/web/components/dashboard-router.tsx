"use client";

import { useMode } from "./mode-provider";
import { ModePicker } from "./mode-picker";
import { KitchenDashboard } from "./kitchen-dashboard";
import { ScienceDashboard } from "./science-dashboard";

type DashboardData = {
  counts: {
    activeSkus: number;
    activeIngredients: number;
    lotsOnHand: number;
    schedules: number;
    servedMeals: number;
    labels: number;
    openVerificationTasks: number;
  };
  clients: { id: string; name: string; externalRef?: string }[];
  sauceCount: number;
  quality: {
    month: string;
    coverage: {
      productFull40CoverageRatio: number;
      finalLabelFull40CoverageRatio: number;
    };
    evidence: {
      inferredRows: number;
      exceptionRows: number;
      floorRows: number;
      provisionalLabels: number;
    };
    totals: {
      openVerificationTasks: number;
      criticalOrHighVerificationTasks: number;
    };
  } | null;
  isEmpty: boolean;
};

export function DashboardRouter({ data }: { data: DashboardData }) {
  const { mode, isLoaded } = useMode();

  if (!isLoaded) {
    return (
      <div className="page-shell">
        <div className="loading-page">
          <div className="loading-shimmer loading-block" />
          <div className="loading-shimmer loading-block" />
        </div>
      </div>
    );
  }

  if (!mode) {
    return <ModePicker />;
  }

  if (data.isEmpty) {
    return (
      <div className="page-shell">
        <section className="card">
          <div className="state-box">
            <div className="state-icon">&#x1f4e6;</div>
            <div className="state-title">No Data Yet</div>
            <div className="state-desc">
              Upload your SKU catalog and Instacart orders to get started.
            </div>
            <a href="/upload" className="btn btn-primary mt-4">
              Import Data
            </a>
          </div>
        </section>
      </div>
    );
  }

  if (mode === "kitchen") {
    return (
      <KitchenDashboard
        counts={data.counts}
        clients={data.clients}
        sauceCount={data.sauceCount}
      />
    );
  }

  return (
    <ScienceDashboard
      counts={data.counts}
      quality={data.quality}
      clients={data.clients}
    />
  );
}
