/**
 * Ops Control Tower Engine
 *
 * Aggregates operational data into a high-signal dashboard.
 * Pure math — takes pre-fetched data, returns structured summaries.
 */

export interface TodayOpsInput {
  mealsDueToday: number;
  mealsServedToday: number;
  batchesDue: number;
  batchesActive: number;
  batchesBlocked: number;
  shortageCount: number;
  expiringLots: Array<{
    lotId: string;
    productName: string;
    expiresAt: string;
    quantityG: number;
  }>;
}

export interface ScientificQaInput {
  openVerificationTasks: number;
  criticalVerificationTasks: number;
  estimatedNutrientRows: number;
  inferredNutrientRows: number;
  missingProvenanceCount: number;
  pendingSubstitutions: number;
  pendingCalibrationReviews: number;
  openQcIssues: number;
}

export interface ClientDataInput {
  clientsWithStaleBiometrics: number;
  clientsWithUnverifiedDocs: number;
  failedParsingDocs: number;
  staleMetricClients: number;
}

export interface SystemReliabilityInput {
  failedImports: number;
  stuckBatches: number;
  stuckMappings: number;
}

export interface ControlTowerInput {
  today: TodayOpsInput;
  scientificQa: ScientificQaInput;
  clientData: ClientDataInput;
  reliability: SystemReliabilityInput;
}

export type IssueSeverity = "critical" | "high" | "medium" | "low";

export interface AttentionItem {
  id: string;
  severity: IssueSeverity;
  category: string;
  title: string;
  description: string;
  actionUrl: string | null;
  score: number;
}

export interface ControlTowerSummary {
  today: {
    mealsDue: number;
    mealsServed: number;
    mealCompletionPct: number;
    batchesDue: number;
    batchesActive: number;
    batchesBlocked: number;
    shortageCount: number;
    expiringLotCount: number;
    expiringLots: TodayOpsInput["expiringLots"];
  };
  scientificQa: {
    openVerificationTasks: number;
    criticalVerificationTasks: number;
    estimatedNutrientRows: number;
    inferredNutrientRows: number;
    dataQualityScore: number;
    pendingSubstitutions: number;
    pendingCalibrationReviews: number;
    openQcIssues: number;
  };
  clientData: {
    staleBiometrics: number;
    unverifiedDocs: number;
    failedParsing: number;
    staleMetrics: number;
    readinessScore: number;
  };
  reliability: {
    failedImports: number;
    stuckBatches: number;
    stuckMappings: number;
    healthScore: number;
  };
  attentionQueue: AttentionItem[];
  overallHealthScore: number;
}

const SEVERITY_SCORES: Record<IssueSeverity, number> = {
  critical: 100,
  high: 70,
  medium: 40,
  low: 10,
};

/**
 * Compute data quality score (0–100).
 * Higher = better. Penalizes unverified, inferred, and estimated data.
 */
export function computeDataQualityScore(qa: ScientificQaInput): number {
  let score = 100;
  score -= Math.min(qa.criticalVerificationTasks * 15, 40);
  score -= Math.min(qa.openVerificationTasks * 3, 20);
  score -= Math.min(qa.inferredNutrientRows * 0.5, 15);
  score -= Math.min(qa.estimatedNutrientRows * 0.3, 10);
  score -= Math.min(qa.pendingSubstitutions * 5, 10);
  score -= Math.min(qa.openQcIssues * 5, 10);
  return Math.max(0, Math.round(score));
}

/**
 * Compute client data readiness score (0–100).
 */
export function computeClientReadinessScore(cd: ClientDataInput): number {
  let score = 100;
  score -= Math.min(cd.clientsWithStaleBiometrics * 10, 30);
  score -= Math.min(cd.clientsWithUnverifiedDocs * 10, 30);
  score -= Math.min(cd.failedParsingDocs * 15, 25);
  score -= Math.min(cd.staleMetricClients * 10, 15);
  return Math.max(0, Math.round(score));
}

/**
 * Compute system reliability score (0–100).
 */
export function computeReliabilityScore(rel: SystemReliabilityInput): number {
  let score = 100;
  score -= Math.min(rel.failedImports * 20, 40);
  score -= Math.min(rel.stuckBatches * 15, 30);
  score -= Math.min(rel.stuckMappings * 10, 30);
  return Math.max(0, Math.round(score));
}

/**
 * Build the attention queue: prioritized list of actionable issues.
 * Deterministic ordering: severity score (desc), then category (asc), then title (asc).
 */
export function buildAttentionQueue(input: ControlTowerInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  let idCounter = 1;

  // Critical shortages
  if (input.today.shortageCount > 0) {
    items.push({
      id: `attn-${idCounter++}`,
      severity: "critical",
      category: "operations",
      title: `${input.today.shortageCount} ingredient shortage(s)`,
      description: "Active shortages may block meal service or batch production today.",
      actionUrl: "/inventory",
      score: SEVERITY_SCORES.critical + input.today.shortageCount,
    });
  }

  // Blocked batches
  if (input.today.batchesBlocked > 0) {
    items.push({
      id: `attn-${idCounter++}`,
      severity: "high",
      category: "operations",
      title: `${input.today.batchesBlocked} batch(es) blocked`,
      description: "Blocked batches need attention to proceed with production.",
      actionUrl: "/kitchen",
      score: SEVERITY_SCORES.high + input.today.batchesBlocked * 5,
    });
  }

  // Critical verification tasks
  if (input.scientificQa.criticalVerificationTasks > 0) {
    items.push({
      id: `attn-${idCounter++}`,
      severity: "critical",
      category: "scientific_qa",
      title: `${input.scientificQa.criticalVerificationTasks} critical verification task(s)`,
      description: "Critical-severity verification tasks need immediate review.",
      actionUrl: "/verification",
      score: SEVERITY_SCORES.critical + input.scientificQa.criticalVerificationTasks * 10,
    });
  }

  // Open QC issues
  if (input.scientificQa.openQcIssues > 0) {
    items.push({
      id: `attn-${idCounter++}`,
      severity: "high",
      category: "scientific_qa",
      title: `${input.scientificQa.openQcIssues} open QC issue(s)`,
      description: "Quality control issues need resolution or override.",
      actionUrl: "/qc-issues",
      score: SEVERITY_SCORES.high + input.scientificQa.openQcIssues * 3,
    });
  }

  // Pending calibration reviews
  if (input.scientificQa.pendingCalibrationReviews > 0) {
    items.push({
      id: `attn-${idCounter++}`,
      severity: "medium",
      category: "scientific_qa",
      title: `${input.scientificQa.pendingCalibrationReviews} calibration review(s) pending`,
      description: "Yield calibration proposals await accept/reject decision.",
      actionUrl: "/calibration",
      score: SEVERITY_SCORES.medium + input.scientificQa.pendingCalibrationReviews * 2,
    });
  }

  // Pending substitutions
  if (input.scientificQa.pendingSubstitutions > 0) {
    items.push({
      id: `attn-${idCounter++}`,
      severity: "medium",
      category: "scientific_qa",
      title: `${input.scientificQa.pendingSubstitutions} substitution(s) pending review`,
      description: "Ingredient substitution proposals need approval.",
      actionUrl: "/substitutions",
      score: SEVERITY_SCORES.medium + input.scientificQa.pendingSubstitutions * 2,
    });
  }

  // Expiring inventory
  if (input.today.expiringLots.length > 0) {
    items.push({
      id: `attn-${idCounter++}`,
      severity: "medium",
      category: "operations",
      title: `${input.today.expiringLots.length} lot(s) expiring soon`,
      description: "Inventory lots nearing expiration — consider priority usage or disposal.",
      actionUrl: "/inventory",
      score: SEVERITY_SCORES.medium + input.today.expiringLots.length,
    });
  }

  // Unverified documents
  if (input.clientData.clientsWithUnverifiedDocs > 0) {
    items.push({
      id: `attn-${idCounter++}`,
      severity: "medium",
      category: "client_data",
      title: `${input.clientData.clientsWithUnverifiedDocs} client(s) with unverified documents`,
      description: "Uploaded documents need verification before metrics can be trusted.",
      actionUrl: null,
      score: SEVERITY_SCORES.medium + input.clientData.clientsWithUnverifiedDocs,
    });
  }

  // Stale biometrics
  if (input.clientData.clientsWithStaleBiometrics > 0) {
    items.push({
      id: `attn-${idCounter++}`,
      severity: "low",
      category: "client_data",
      title: `${input.clientData.clientsWithStaleBiometrics} client(s) with stale biometrics`,
      description: "Biometric data older than 30 days — consider scheduling measurements.",
      actionUrl: null,
      score: SEVERITY_SCORES.low + input.clientData.clientsWithStaleBiometrics,
    });
  }

  // Failed imports
  if (input.reliability.failedImports > 0) {
    items.push({
      id: `attn-${idCounter++}`,
      severity: "high",
      category: "system",
      title: `${input.reliability.failedImports} failed import(s)`,
      description: "Data imports failed and may need retry or investigation.",
      actionUrl: "/upload",
      score: SEVERITY_SCORES.high + input.reliability.failedImports * 10,
    });
  }

  // Stuck batches
  if (input.reliability.stuckBatches > 0) {
    items.push({
      id: `attn-${idCounter++}`,
      severity: "high",
      category: "system",
      title: `${input.reliability.stuckBatches} stuck batch(es)`,
      description: "Batch productions in unexpected state — may need manual intervention.",
      actionUrl: "/kitchen",
      score: SEVERITY_SCORES.high + input.reliability.stuckBatches * 5,
    });
  }

  // Sort: by score descending, then category, then title for deterministic ordering
  return items.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.title.localeCompare(b.title);
  });
}

/**
 * Build the complete control tower summary.
 */
export function buildControlTowerSummary(input: ControlTowerInput): ControlTowerSummary {
  const mealCompletionPct = input.today.mealsDueToday > 0
    ? Math.round((input.today.mealsServedToday / input.today.mealsDueToday) * 100)
    : 100;

  const dataQualityScore = computeDataQualityScore(input.scientificQa);
  const readinessScore = computeClientReadinessScore(input.clientData);
  const reliabilityScore = computeReliabilityScore(input.reliability);

  const overallHealthScore = Math.round(
    (dataQualityScore * 0.4 + readinessScore * 0.3 + reliabilityScore * 0.3),
  );

  return {
    today: {
      mealsDue: input.today.mealsDueToday,
      mealsServed: input.today.mealsServedToday,
      mealCompletionPct,
      batchesDue: input.today.batchesDue,
      batchesActive: input.today.batchesActive,
      batchesBlocked: input.today.batchesBlocked,
      shortageCount: input.today.shortageCount,
      expiringLotCount: input.today.expiringLots.length,
      expiringLots: input.today.expiringLots,
    },
    scientificQa: {
      ...input.scientificQa,
      dataQualityScore,
    },
    clientData: {
      staleBiometrics: input.clientData.clientsWithStaleBiometrics,
      unverifiedDocs: input.clientData.clientsWithUnverifiedDocs,
      failedParsing: input.clientData.failedParsingDocs,
      staleMetrics: input.clientData.staleMetricClients,
      readinessScore,
    },
    reliability: {
      ...input.reliability,
      healthScore: reliabilityScore,
    },
    attentionQueue: buildAttentionQueue(input),
    overallHealthScore,
  };
}
