"use client";

import Link from "next/link";

type Props = {
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
};

export function KitchenDashboard({ counts, clients, sauceCount }: Props) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="page-shell">
      {/* Hero greeting */}
      <div className="kitchen-hero">
        <h1 className="kitchen-hero-title">Good morning, chef.</h1>
        <p className="kitchen-hero-date">{today}</p>
        <div className="kitchen-hero-summary">
          <span className="hero-stat">{counts.schedules} meals scheduled</span>
          <span className="hero-sep">&middot;</span>
          <span className="hero-stat">{counts.lotsOnHand} lots on hand</span>
          {counts.openVerificationTasks > 0 && (
            <>
              <span className="hero-sep">&middot;</span>
              <span className="hero-stat hero-stat-warn">{counts.openVerificationTasks} alerts</span>
            </>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <section className="section">
        <div className="quick-actions">
          <Link href={"/batch-prep" as any} className="quick-action-card">
            <div className="quick-action-icon">+</div>
            <span>New Batch</span>
          </Link>
          <Link href={"/kitchen/print/pull-list" as any} className="quick-action-card">
            <div className="quick-action-icon">&#x1f4cb;</div>
            <span>Pull List</span>
          </Link>
          <Link href={"/kitchen/print/daily-summary" as any} className="quick-action-card">
            <div className="quick-action-icon">&#x1f4c4;</div>
            <span>Daily Summary</span>
          </Link>
          <Link href={"/kitchen" as any} className="quick-action-card quick-action-live">
            <div className="quick-action-icon">&#x25b6;</div>
            <span>Go Live</span>
          </Link>
        </div>
      </section>

      {/* At a glance */}
      <section className="section">
        <h2 className="section-title">At a Glance</h2>
        <div className="kpi-grid">
          <Link href={"/prep-plan" as any} className="kpi" style={{ textDecoration: "none", cursor: "pointer" }}>
            <div className="kpi-value">{counts.schedules}</div>
            <div className="kpi-label">Upcoming Meals</div>
          </Link>
          <Link href={"/pantry" as any} className="kpi" style={{ textDecoration: "none", cursor: "pointer" }}>
            <div className="kpi-value">{counts.lotsOnHand}</div>
            <div className="kpi-label">Inventory Lots</div>
          </Link>
          <Link href={"/pantry" as any} className="kpi" style={{ textDecoration: "none", cursor: "pointer" }}>
            <div className="kpi-value">{sauceCount}</div>
            <div className="kpi-label">Sauces</div>
          </Link>
          <Link href={"/prep-plan" as any} className="kpi" style={{ textDecoration: "none", cursor: "pointer" }}>
            <div className="kpi-value">{counts.activeSkus}</div>
            <div className="kpi-label">Active SKUs</div>
          </Link>
        </div>
      </section>

      {/* Clients */}
      {clients.length > 0 && (
        <section className="section">
          <h2 className="section-title">Clients</h2>
          <div className="client-grid">
            {clients.map((client) => (
              <Link
                key={client.id}
                href={`/clients/${client.id}/calendar`}
                className="client-card"
              >
                <div className="client-avatar">
                  {client.name.charAt(0).toUpperCase()}
                </div>
                <div className="client-card-info">
                  <div className="client-card-name">{client.name}</div>
                  {client.externalRef && (
                    <div className="client-card-meta">{client.externalRef}</div>
                  )}
                </div>
                <span className="client-card-arrow">&rarr;</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
