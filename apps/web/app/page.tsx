import { DashboardRouter } from "../components/dashboard-router";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? process.env.API_BASE ?? "http://localhost:4000";

type SystemState = {
  hasCommittedSot: boolean;
  counts: {
    activeSkus: number;
    activeIngredients: number;
    lotsOnHand: number;
    schedules: number;
    servedMeals: number;
    labels: number;
    openVerificationTasks: number;
  };
};

type QualitySummary = {
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
};

async function getState() {
  try {
    const response = await fetch(`${API_BASE}/v1/system/state`, { cache: "no-store" });
    if (!response.ok) return null;
    const json = (await response.json()) as Partial<SystemState>;
    if (!json || typeof json !== "object") return null;
    return {
      hasCommittedSot: Boolean(json.hasCommittedSot),
      counts: {
        activeSkus: Number(json.counts?.activeSkus ?? 0),
        activeIngredients: Number(json.counts?.activeIngredients ?? 0),
        lotsOnHand: Number(json.counts?.lotsOnHand ?? 0),
        schedules: Number(json.counts?.schedules ?? 0),
        servedMeals: Number(json.counts?.servedMeals ?? 0),
        labels: Number(json.counts?.labels ?? 0),
        openVerificationTasks: Number(json.counts?.openVerificationTasks ?? 0),
      },
    } satisfies SystemState;
  } catch {
    return null;
  }
}

async function getClients() {
  try {
    const response = await fetch(`${API_BASE}/v1/clients`, { cache: "no-store" });
    if (!response.ok) return [];
    const json = (await response.json()) as {
      clients?: Array<{ id?: string; fullName?: string; externalRef?: string }>;
    };
    return (json.clients ?? [])
      .filter((client) => typeof client.id === "string" && typeof client.fullName === "string")
      .map((client) => ({
        id: client.id!,
        name: client.fullName!,
        externalRef: client.externalRef,
      }));
  } catch {
    return [];
  }
}

async function getSauceCount() {
  try {
    const response = await fetch(`${API_BASE}/v1/sauces`, { cache: "no-store" });
    if (!response.ok) return 0;
    const json = await response.json();
    if (Array.isArray(json)) return json.length;
    if (json && Array.isArray(json.sauces)) return json.sauces.length;
    return 0;
  } catch {
    return 0;
  }
}

async function getQualitySummary() {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const response = await fetch(`${API_BASE}/v1/quality/summary?month=${month}`, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as QualitySummary;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const [state, clients, quality, sauceCount] = await Promise.all([
    getState(),
    getClients(),
    getQualitySummary(),
    getSauceCount(),
  ]);

  const isEmpty = !state || !state.hasCommittedSot;
  const counts = state?.counts ?? {
    activeSkus: 0,
    activeIngredients: 0,
    lotsOnHand: 0,
    schedules: 0,
    servedMeals: 0,
    labels: 0,
    openVerificationTasks: 0,
  };

  return (
    <DashboardRouter
      data={{ counts, clients, sauceCount, quality, isEmpty }}
    />
  );
}
