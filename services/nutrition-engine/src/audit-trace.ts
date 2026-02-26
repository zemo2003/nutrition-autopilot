/**
 * Audit Trace Engine
 *
 * Extracts and formats freeze-time label provenance for human-readable audit.
 * Works with LabelSnapshot renderPayload data. Pure math — no DB dependency.
 */

export interface AuditLabelPayload {
  skuName?: string;
  recipeName?: string;
  servings?: number;
  servingWeightG?: number;
  perServing?: Record<string, number>;
  provisional?: boolean;
  reasonCodes?: string[];
  plausibility?: {
    valid: boolean;
    errorCount: number;
    warningCount: number;
    issues?: Array<{ message: string; severity: string }>;
  };
  evidenceSummary?: {
    verifiedCount?: number;
    inferredCount?: number;
    exceptionCount?: number;
    unverifiedCount?: number;
    totalNutrientRows?: number;
    provisional?: boolean;
    sourceRefs?: string[];
    gradeBreakdown?: Record<string, number>;
  };
}

export interface AuditLineageNode {
  labelId: string;
  labelType: string;
  title: string;
  metadata: Record<string, unknown>;
  children: AuditLineageNode[];
}

export interface AuditIngredientSummary {
  ingredientName: string;
  consumedGrams: number;
  allergenTags: string[];
  provisional: boolean;
  reasonCodes: string[];
}

export interface AuditLotSummary {
  lotId: string;
  lotCode: string | null;
  productName: string;
  gramsConsumed: number;
  sourceOrderRef: string | null;
  receivedAt: string | null;
  expiresAt: string | null;
  syntheticLot: boolean;
  provisional: boolean;
}

export interface AuditNutrientProvenance {
  nutrientKey: string;
  valuePerServing: number;
  sources: string[];
  evidenceGrades: string[];
  verifiedPct: number;
}

export interface MealAuditTrace {
  scheduleId: string;
  clientName: string;
  skuName: string;
  recipeName: string;
  serviceDate: string;
  mealSlot: string;
  servings: number;
  servingWeightG: number;
  provisional: boolean;
  reasonCodes: string[];
  plausibilityValid: boolean;
  plausibilityIssues: Array<{ message: string; severity: string }>;
  ingredients: AuditIngredientSummary[];
  lots: AuditLotSummary[];
  nutrientProvenance: AuditNutrientProvenance[];
  evidenceSummary: {
    verifiedCount: number;
    inferredCount: number;
    exceptionCount: number;
    unverifiedCount: number;
    totalRows: number;
    verifiedPct: number;
  };
  qaWarnings: string[];
}

/**
 * Extract ingredient summaries from a lineage tree.
 */
export function extractIngredients(tree: AuditLineageNode): AuditIngredientSummary[] {
  const ingredients: AuditIngredientSummary[] = [];

  for (const child of tree.children) {
    if (child.labelType === "INGREDIENT") {
      const meta = child.metadata;
      ingredients.push({
        ingredientName: (meta.ingredientName as string) ?? child.title,
        consumedGrams: (meta.consumedGrams as number) ?? 0,
        allergenTags: ((meta.allergenEvidence as Record<string, unknown>)?.allergenTags as string[]) ?? [],
        provisional: Boolean(meta.provisional),
        reasonCodes: (meta.reasonCodes as string[]) ?? [],
      });
    }
  }

  return ingredients.sort((a, b) => b.consumedGrams - a.consumedGrams);
}

/**
 * Extract lot consumption details from a lineage tree (recursive).
 */
export function extractLots(tree: AuditLineageNode): AuditLotSummary[] {
  const lots: AuditLotSummary[] = [];

  function walk(node: AuditLineageNode) {
    if (node.labelType === "LOT") {
      const meta = node.metadata;
      lots.push({
        lotId: (meta.lotId as string) ?? node.labelId,
        lotCode: (meta.lotCode as string) ?? null,
        productName: (meta.productName as string) ?? node.title,
        gramsConsumed: (meta.gramsConsumed as number) ?? 0,
        sourceOrderRef: (meta.sourceOrderRef as string) ?? null,
        receivedAt: meta.receivedAt ? String(meta.receivedAt) : null,
        expiresAt: meta.expiresAt ? String(meta.expiresAt) : null,
        syntheticLot: Boolean(meta.syntheticLot),
        provisional: Boolean(meta.provisional),
      });
    }
    for (const child of node.children) {
      walk(child);
    }
  }

  walk(tree);
  return lots;
}

/**
 * Extract nutrient provenance from a label payload.
 */
export function extractNutrientProvenance(
  payload: AuditLabelPayload,
): AuditNutrientProvenance[] {
  if (!payload.perServing) return [];

  const evidence = payload.evidenceSummary;
  const totalRows = evidence?.totalNutrientRows ?? 0;
  const verifiedCount = evidence?.verifiedCount ?? 0;
  const verifiedPct = totalRows > 0 ? Math.round((verifiedCount / totalRows) * 100) : 0;

  return Object.entries(payload.perServing)
    .filter(([, v]) => typeof v === "number" && v > 0)
    .map(([key, value]) => ({
      nutrientKey: key,
      valuePerServing: Math.round((value as number) * 100) / 100,
      sources: evidence?.sourceRefs ?? [],
      evidenceGrades: Object.keys(evidence?.gradeBreakdown ?? {}),
      verifiedPct,
    }));
}

/**
 * Generate QA warnings from the audit data.
 */
export function generateQaWarnings(payload: AuditLabelPayload, tree?: AuditLineageNode): string[] {
  const warnings: string[] = [];

  if (payload.provisional) {
    warnings.push("Label is PROVISIONAL — not all nutrient sources verified");
  }

  const evidence = payload.evidenceSummary;
  if (evidence) {
    if ((evidence.inferredCount ?? 0) > 0) {
      warnings.push(`${evidence.inferredCount} nutrient value(s) are inferred (not from manufacturer label)`);
    }
    if ((evidence.exceptionCount ?? 0) > 0) {
      warnings.push(`${evidence.exceptionCount} nutrient value(s) use historical exceptions`);
    }
    if ((evidence.unverifiedCount ?? 0) > 0) {
      warnings.push(`${evidence.unverifiedCount} nutrient value(s) are unverified`);
    }
  }

  if (payload.plausibility && !payload.plausibility.valid) {
    warnings.push(`Plausibility check failed: ${payload.plausibility.errorCount} error(s)`);
    for (const issue of payload.plausibility.issues ?? []) {
      if (issue.severity === "ERROR") {
        warnings.push(`  - ${issue.message}`);
      }
    }
  }

  const reasonCodes = payload.reasonCodes ?? [];
  if (reasonCodes.includes("SYNTHETIC_LOT_USAGE")) {
    warnings.push("Contains synthetic (system-generated) inventory lot data");
  }
  if (reasonCodes.includes("INCOMPLETE_CORE_NUTRIENTS")) {
    warnings.push("Some core nutrients are missing from source data");
  }

  if (tree) {
    const lots = extractLots(tree);
    const syntheticLots = lots.filter((l) => l.syntheticLot);
    if (syntheticLots.length > 0) {
      warnings.push(`${syntheticLots.length} lot(s) are synthetic/system-generated`);
    }
  }

  return warnings;
}

/**
 * Build a complete meal audit trace from schedule data, label payload, and lineage tree.
 */
export function buildMealAuditTrace(
  schedule: {
    id: string;
    clientName: string;
    serviceDate: string;
    mealSlot: string;
    servings: number;
  },
  payload: AuditLabelPayload,
  tree: AuditLineageNode,
): MealAuditTrace {
  const ingredients = extractIngredients(tree);
  const lots = extractLots(tree);
  const nutrientProvenance = extractNutrientProvenance(payload);
  const qaWarnings = generateQaWarnings(payload, tree);

  const evidence = payload.evidenceSummary;
  const totalRows = evidence?.totalNutrientRows ?? 0;
  const verifiedCount = evidence?.verifiedCount ?? 0;

  return {
    scheduleId: schedule.id,
    clientName: schedule.clientName,
    skuName: payload.skuName ?? "",
    recipeName: payload.recipeName ?? "",
    serviceDate: schedule.serviceDate,
    mealSlot: schedule.mealSlot,
    servings: schedule.servings,
    servingWeightG: payload.servingWeightG ?? 0,
    provisional: Boolean(payload.provisional),
    reasonCodes: payload.reasonCodes ?? [],
    plausibilityValid: payload.plausibility?.valid ?? true,
    plausibilityIssues: payload.plausibility?.issues ?? [],
    ingredients,
    lots,
    nutrientProvenance,
    evidenceSummary: {
      verifiedCount,
      inferredCount: evidence?.inferredCount ?? 0,
      exceptionCount: evidence?.exceptionCount ?? 0,
      unverifiedCount: evidence?.unverifiedCount ?? 0,
      totalRows,
      verifiedPct: totalRows > 0 ? Math.round((verifiedCount / totalRows) * 100) : 0,
    },
    qaWarnings,
  };
}
