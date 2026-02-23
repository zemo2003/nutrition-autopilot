import { nutrientKeys, type NutrientKey } from "@nutrition/contracts";
import {
  NutrientEvidenceGrade,
  Prisma,
  ScheduleStatus,
  VerificationStatus,
  prisma
} from "@nutrition/db";
import { computeSkuLabel, type NutrientMap, validateFoodProduct, type PlausibilityIssue } from "@nutrition/nutrition-engine";
import { servedAtFromSchedule } from "./served-time.js";

const inferredEvidenceGrades = new Set<NutrientEvidenceGrade>([
  NutrientEvidenceGrade.INFERRED_FROM_INGREDIENT,
  NutrientEvidenceGrade.INFERRED_FROM_SIMILAR_PRODUCT
]);

const reasonCodeOrder = [
  "PLAUSIBILITY_ERROR",
  "PLAUSIBILITY_WARNING",
  "UNVERIFIED_SOURCE",
  "HISTORICAL_EXCEPTION",
  "SYNTHETIC_LOT_USAGE"
] as const;

const coreQualityKeys: NutrientKey[] = ["kcal", "protein_g", "carb_g", "fat_g", "sodium_mg"];

type ReasonCode = (typeof reasonCodeOrder)[number];

type NutrientRow = {
  nutrientDefinition: { key: string };
  valuePer100g: number | null;
  sourceType: string;
  sourceRef: string;
  verificationStatus: VerificationStatus;
  evidenceGrade: NutrientEvidenceGrade;
  confidenceScore: number;
  historicalException: boolean;
};

type ConsumedLot = {
  recipeLineId: string;
  lotId: string;
  lotCode: string | null;
  productId: string;
  productName: string;
  productBrand: string | null;
  productUpc: string | null;
  productVendor: string | null;
  lotSourceOrderRef: string | null;
  receivedAt: Date;
  expiresAt: Date | null;
  gramsConsumed: number;
  nutrients: NutrientRow[];
  nutrientsPer100g: NutrientMap;
  ingredientName: string;
  ingredientAllergens: string[];
  ingredientId: string;
  syntheticLot: boolean;
};

type EvidenceSummary = {
  verifiedCount: number;
  inferredCount: number;
  exceptionCount: number;
  unverifiedCount: number;
  totalNutrientRows: number;
  provisional: boolean;
};

type EvidenceDetails = {
  summary: EvidenceSummary;
  reasonCodes: ReasonCode[];
  sourceRefs: string[];
  gradeBreakdown: Record<string, number>;
};

type GroupedIngredient = {
  ingredientId: string;
  ingredientName: string;
  allergenTags: string[];
  consumedLots: ConsumedLot[];
};

type GroupedProduct = {
  productId: string;
  productName: string;
  productBrand: string | null;
  productUpc: string | null;
  productVendor: string | null;
  consumedLots: ConsumedLot[];
};

function emptyNutrientMap(): NutrientMap {
  return Object.fromEntries(nutrientKeys.map((key) => [key, 0])) as NutrientMap;
}

function toNutrientMap(values: NutrientRow[]): NutrientMap {
  const out = emptyNutrientMap();
  for (const row of values) {
    if (typeof row.valuePer100g !== "number") continue;
    const key = row.nutrientDefinition.key as NutrientKey;
    if (!nutrientKeys.includes(key)) continue;
    out[key] = row.valuePer100g;
  }
  return out;
}

function nextLabelVersion(
  tx: Prisma.TransactionClient,
  organizationId: string,
  labelType: string,
  externalRefId: string
) {
  return tx.labelSnapshot.count({
    where: { organizationId, labelType: labelType as any, externalRefId }
  }).then((count) => count + 1);
}

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function sortReasonCodes(values: Iterable<ReasonCode>): ReasonCode[] {
  const incoming = new Set(values);
  return reasonCodeOrder.filter((code) => incoming.has(code));
}

function summarizeEvidence(rows: NutrientRow[], syntheticLot: boolean): EvidenceDetails {
  const gradeBreakdown: Record<string, number> = {};
  const sourceRefs = new Set<string>();
  const reasonCodes = new Set<ReasonCode>();
  let verifiedCount = 0;
  let inferredCount = 0;
  let exceptionCount = 0;
  let unverifiedCount = 0;

  for (const row of rows) {
    const grade = row.evidenceGrade;
    gradeBreakdown[grade] = (gradeBreakdown[grade] ?? 0) + 1;
    sourceRefs.add(row.sourceRef);

    if (row.verificationStatus === VerificationStatus.VERIFIED) {
      verifiedCount += 1;
    } else {
      unverifiedCount += 1;
      reasonCodes.add("UNVERIFIED_SOURCE");
    }

    if (inferredEvidenceGrades.has(grade)) {
      inferredCount += 1;
    }

    if (row.historicalException || grade === NutrientEvidenceGrade.HISTORICAL_EXCEPTION) {
      exceptionCount += 1;
      reasonCodes.add("HISTORICAL_EXCEPTION");
    }
  }

  if (syntheticLot) {
    reasonCodes.add("SYNTHETIC_LOT_USAGE");
    reasonCodes.add("HISTORICAL_EXCEPTION");
  }

  const totalNutrientRows = rows.length;
  const provisional = unverifiedCount > 0 || exceptionCount > 0 || inferredCount > 0 || syntheticLot;

  return {
    summary: {
      verifiedCount,
      inferredCount,
      exceptionCount,
      unverifiedCount,
      totalNutrientRows,
      provisional
    },
    reasonCodes: sortReasonCodes(reasonCodes),
    sourceRefs: uniq([...sourceRefs]),
    gradeBreakdown
  };
}

function aggregateNutrientsByLots(lots: ConsumedLot[], servings: number): {
  total: NutrientMap;
  perServing: NutrientMap;
} {
  const total = emptyNutrientMap();
  const safeServings = servings > 0 ? servings : 1;

  for (const lot of lots) {
    for (const key of nutrientKeys) {
      const value = lot.nutrientsPer100g[key] ?? 0;
      total[key] = (total[key] ?? 0) + (value * lot.gramsConsumed) / 100;
    }
  }

  const perServing = emptyNutrientMap();
  for (const key of nutrientKeys) {
    perServing[key] = (total[key] ?? 0) / safeServings;
  }

  return { total, perServing };
}

function groupConsumedLotsByIngredient(consumedLots: ConsumedLot[]): GroupedIngredient[] {
  const byIngredient = new Map<string, GroupedIngredient>();

  for (const lot of consumedLots) {
    const existing = byIngredient.get(lot.ingredientId);
    if (existing) {
      existing.consumedLots.push(lot);
      for (const tag of lot.ingredientAllergens) {
        if (!existing.allergenTags.includes(tag)) existing.allergenTags.push(tag);
      }
      continue;
    }

    byIngredient.set(lot.ingredientId, {
      ingredientId: lot.ingredientId,
      ingredientName: lot.ingredientName,
      allergenTags: [...lot.ingredientAllergens],
      consumedLots: [lot]
    });
  }

  return [...byIngredient.values()].sort((a, b) => a.ingredientName.localeCompare(b.ingredientName));
}

function groupConsumedLotsByProduct(consumedLots: ConsumedLot[]): GroupedProduct[] {
  const byProduct = new Map<string, GroupedProduct>();

  for (const lot of consumedLots) {
    const existing = byProduct.get(lot.productId);
    if (existing) {
      existing.consumedLots.push(lot);
      continue;
    }

    byProduct.set(lot.productId, {
      productId: lot.productId,
      productName: lot.productName,
      productBrand: lot.productBrand,
      productUpc: lot.productUpc,
      productVendor: lot.productVendor,
      consumedLots: [lot]
    });
  }

  return [...byProduct.values()].sort((a, b) => a.productName.localeCompare(b.productName));
}

function groupLotConsumptions(consumedLots: ConsumedLot[]): Array<{
  lotId: string;
  lotCode: string | null;
  gramsConsumed: number;
  sourceOrderRef: string | null;
  receivedAt: Date;
  expiresAt: Date | null;
  productName: string;
  productId: string;
  nutrientRows: NutrientRow[];
  nutrientsPer100g: NutrientMap;
  syntheticLot: boolean;
}> {
  const byLot = new Map<string, {
    lotId: string;
    lotCode: string | null;
    gramsConsumed: number;
    sourceOrderRef: string | null;
    receivedAt: Date;
    expiresAt: Date | null;
    productName: string;
    productId: string;
    nutrientRows: NutrientRow[];
    nutrientsPer100g: NutrientMap;
    syntheticLot: boolean;
  }>();

  for (const lot of consumedLots) {
    const existing = byLot.get(lot.lotId);
    if (existing) {
      existing.gramsConsumed += lot.gramsConsumed;
      continue;
    }

    byLot.set(lot.lotId, {
      lotId: lot.lotId,
      lotCode: lot.lotCode,
      gramsConsumed: lot.gramsConsumed,
      sourceOrderRef: lot.lotSourceOrderRef,
      receivedAt: lot.receivedAt,
      expiresAt: lot.expiresAt,
      productName: lot.productName,
      productId: lot.productId,
      nutrientRows: lot.nutrients,
      nutrientsPer100g: lot.nutrientsPer100g,
      syntheticLot: lot.syntheticLot
    });
  }

  return [...byLot.values()];
}

export async function freezeLabelFromScheduleDone(input: {
  mealScheduleId: string;
  servedByUserId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const schedule = await tx.mealSchedule.findUnique({
      where: { id: input.mealScheduleId },
      include: {
        client: true,
        sku: true
      }
    });

    if (!schedule) {
      throw new Error("Schedule row not found");
    }

    if (schedule.status !== ScheduleStatus.DONE) {
      throw new Error("Schedule must be DONE before freeze");
    }

    const existingEvent = await tx.mealServiceEvent.findUnique({ where: { mealScheduleId: schedule.id } });
    if (existingEvent) {
      return { mealServiceEventId: existingEvent.id, labelSnapshotId: existingEvent.finalLabelSnapshotId };
    }

    const recipe = await tx.recipe.findFirst({
      where: { skuId: schedule.skuId, active: true },
      include: {
        lines: {
          include: { ingredient: true },
          orderBy: { lineOrder: "asc" }
        }
      }
    });

    if (!recipe) {
      throw new Error("No active recipe for schedule SKU");
    }

    const serviceEvent = await tx.mealServiceEvent.create({
      data: {
        organizationId: schedule.organizationId,
        clientId: schedule.clientId,
        skuId: schedule.skuId,
        mealScheduleId: schedule.id,
        servedAt: servedAtFromSchedule(schedule.serviceDate, schedule.mealSlot),
        servedByUserId: input.servedByUserId,
        scheduleStatusAtService: ScheduleStatus.DONE,
        createdBy: "system"
      }
    });

    const consumedLots: ConsumedLot[] = [];
    const strictMode = (schedule.notes ?? "").toLowerCase() !== "pilot_backfill";

    for (const line of recipe.lines) {
      let remaining = line.targetGPerServing * schedule.plannedServings;

      const lots = await tx.inventoryLot.findMany({
        where: {
          organizationId: schedule.organizationId,
          quantityAvailableG: { gt: 0 },
          product: {
            ingredientId: line.ingredientId
          }
        },
        include: {
          product: {
            include: {
              nutrients: {
                include: {
                  nutrientDefinition: true
                }
              }
            }
          }
        },
        orderBy: [{ expiresAt: "asc" }, { receivedAt: "asc" }]
      });

      if (!lots.length) {
        throw new Error(`No inventory lot found for ingredient ${line.ingredient.name}`);
      }

      for (const lot of lots) {
        if (remaining <= 0) break;
        const use = Math.min(remaining, lot.quantityAvailableG);
        if (use <= 0) continue;

        const nutrientRows = lot.product.nutrients.map((nutrient) => ({
          nutrientDefinition: { key: nutrient.nutrientDefinition.key },
          valuePer100g: nutrient.valuePer100g,
          sourceType: nutrient.sourceType,
          sourceRef: nutrient.sourceRef,
          verificationStatus: nutrient.verificationStatus,
          evidenceGrade: nutrient.evidenceGrade,
          confidenceScore: nutrient.confidenceScore,
          historicalException: nutrient.historicalException
        }));
        const nutrientMap = toNutrientMap(nutrientRows);
        const syntheticLot = lot.product.vendor === "SYSTEM_SYNTHETIC" || (lot.product.upc ?? "").startsWith("SYNTH-");
        const corePresent = new Set(
          nutrientRows
            .filter((row) => typeof row.valuePer100g === "number")
            .map((row) => row.nutrientDefinition.key as NutrientKey)
        );
        const hasRequiredCore = coreQualityKeys.every((key) => corePresent.has(key));

        if (strictMode && (!hasRequiredCore || syntheticLot || nutrientRows.some((row) => row.historicalException))) {
          continue;
        }

        await tx.lotConsumptionEvent.create({
          data: {
            mealServiceEventId: serviceEvent.id,
            recipeLineId: line.id,
            inventoryLotId: lot.id,
            gramsConsumed: use,
            createdBy: "system"
          }
        });

        await tx.inventoryLot.update({
          where: { id: lot.id },
          data: { quantityAvailableG: { decrement: use } }
        });

        await tx.inventoryLotLedger.create({
          data: {
            inventoryLotId: lot.id,
            deltaG: -use,
            reason: "MEAL_SERVICE_CONSUMPTION",
            referenceId: serviceEvent.id,
            createdBy: "system"
          }
        });

        consumedLots.push({
          recipeLineId: line.id,
          lotId: lot.id,
          lotCode: lot.lotCode,
          productId: lot.productId,
          productName: lot.product.name,
          productBrand: lot.product.brand,
          productUpc: lot.product.upc,
          productVendor: lot.product.vendor,
          lotSourceOrderRef: lot.sourceOrderRef,
          receivedAt: lot.receivedAt,
          expiresAt: lot.expiresAt,
          gramsConsumed: use,
          nutrients: nutrientRows,
          nutrientsPer100g: nutrientMap,
          ingredientName: line.ingredient.name,
          ingredientAllergens: line.ingredient.allergenTags,
          ingredientId: line.ingredient.id,
          syntheticLot
        });

        remaining -= use;
      }

      if (remaining > 0) {
        if (strictMode) {
          throw new Error(
            `Quality gate blocked freeze for ingredient ${line.ingredient.name}; require non-synthetic lots with complete core nutrients`
          );
        }
        throw new Error(`Insufficient lot quantity for ingredient ${line.ingredient.name}`);
      }
    }

    const skuEvidence = summarizeEvidence(
      consumedLots.flatMap((lot) => lot.nutrients),
      consumedLots.some((lot) => lot.syntheticLot)
    );

    const label = computeSkuLabel({
      skuName: schedule.sku.name,
      recipeName: recipe.name,
      servings: schedule.plannedServings,
      lines: recipe.lines.map((line) => ({
        lineId: line.id,
        ingredientName: line.ingredient.name,
        ingredientAllergens: line.ingredient.allergenTags,
        gramsPerServing: line.targetGPerServing
      })),
      consumedLots: consumedLots.map((lot) => ({
        recipeLineId: lot.recipeLineId,
        lotId: lot.lotId,
        productId: lot.productId,
        productName: lot.productName,
        gramsConsumed: lot.gramsConsumed,
        nutrientsPer100g: lot.nutrientsPer100g
      })),
      provisional: skuEvidence.summary.provisional,
      evidenceSummary: {
        ...skuEvidence.summary,
        provisional: skuEvidence.summary.provisional
      }
    });

    // Plausibility gate: validate the computed per-serving nutrients
    const plausibilityIssues = validateFoodProduct(label.perServing, schedule.sku.name);

    const plausibilityErrors = plausibilityIssues.filter(
      (i: PlausibilityIssue) => i.severity === "ERROR"
    );
    const plausibilityWarnings = plausibilityIssues.filter(
      (i: PlausibilityIssue) => i.severity === "WARNING"
    );

    const skuLabelPayload = {
      ...label,
      reasonCodes: [
        ...skuEvidence.reasonCodes,
        ...(plausibilityErrors.length > 0 ? ["PLAUSIBILITY_ERROR" as const] : []),
        ...(plausibilityWarnings.length > 0 ? ["PLAUSIBILITY_WARNING" as const] : [])
      ],
      plausibility: {
        valid: plausibilityErrors.length === 0,
        errorCount: plausibilityErrors.length,
        warningCount: plausibilityWarnings.length,
        issues: plausibilityIssues.slice(0, 10) // cap at 10 for payload size
      },
      evidenceSummary: {
        ...label.evidenceSummary,
        sourceRefs: skuEvidence.sourceRefs,
        gradeBreakdown: skuEvidence.gradeBreakdown
      }
    };

    const skuLabel = await tx.labelSnapshot.create({
      data: {
        organizationId: schedule.organizationId,
        labelType: "SKU",
        externalRefId: schedule.skuId,
        title: `${schedule.sku.code} - ${schedule.sku.name}`,
        renderPayload: skuLabelPayload,
        frozenAt: new Date(),
        createdBy: "system",
        version: await nextLabelVersion(tx, schedule.organizationId, "SKU", schedule.skuId)
      }
    });

    // Create verification tasks for plausibility errors
    if (plausibilityErrors.length > 0) {
      await tx.verificationTask.create({
        data: {
          organizationId: schedule.organizationId,
          taskType: "CONSISTENCY",
          severity: "CRITICAL",
          status: "OPEN",
          title: `Plausibility errors: ${schedule.sku.name}`,
          description: plausibilityErrors.map((e: PlausibilityIssue) => e.message).join("; "),
          payload: {
            labelSnapshotId: skuLabel.id,
            skuId: schedule.skuId,
            skuName: schedule.sku.name,
            issues: plausibilityErrors
          },
          createdBy: "system"
        }
      });
    }

    const ingredientGroups = groupConsumedLotsByIngredient(consumedLots);

    for (const ingredientGroup of ingredientGroups) {
      const ingredientAggregate = aggregateNutrientsByLots(ingredientGroup.consumedLots, schedule.plannedServings);
      const ingredientEvidence = summarizeEvidence(
        ingredientGroup.consumedLots.flatMap((lot) => lot.nutrients),
        ingredientGroup.consumedLots.some((lot) => lot.syntheticLot)
      );

      const ingredientLabel = await tx.labelSnapshot.create({
        data: {
          organizationId: schedule.organizationId,
          labelType: "INGREDIENT",
          externalRefId: ingredientGroup.ingredientId,
          title: ingredientGroup.ingredientName,
          renderPayload: {
            ingredientId: ingredientGroup.ingredientId,
            ingredientName: ingredientGroup.ingredientName,
            consumedGrams: ingredientGroup.consumedLots.reduce((sum, lot) => sum + lot.gramsConsumed, 0),
            allergenEvidence: {
              allergenTags: ingredientGroup.allergenTags,
              source: "IngredientCatalog"
            },
            nutrientsTotal: ingredientAggregate.total,
            nutrientsPerServing: ingredientAggregate.perServing,
            evidenceSummary: ingredientEvidence.summary,
            reasonCodes: ingredientEvidence.reasonCodes,
            sourceRefs: ingredientEvidence.sourceRefs,
            gradeBreakdown: ingredientEvidence.gradeBreakdown,
            provisional: ingredientEvidence.summary.provisional
          },
          frozenAt: new Date(),
          createdBy: "system",
          version: await nextLabelVersion(tx, schedule.organizationId, "INGREDIENT", ingredientGroup.ingredientId)
        }
      });

      await tx.labelLineageEdge.create({
        data: {
          parentLabelId: skuLabel.id,
          childLabelId: ingredientLabel.id,
          edgeType: "SKU_CONTAINS_INGREDIENT",
          createdBy: "system"
        }
      });

      const productGroups = groupConsumedLotsByProduct(ingredientGroup.consumedLots);
      for (const productGroup of productGroups) {
        const representativeLot = productGroup.consumedLots[0]!;
        const productRows = representativeLot.nutrients;
        const productEvidence = summarizeEvidence(productRows, productGroup.consumedLots.some((lot) => lot.syntheticLot));

        const productLabel = await tx.labelSnapshot.create({
          data: {
            organizationId: schedule.organizationId,
            labelType: "PRODUCT",
            externalRefId: productGroup.productId,
            title: productGroup.productName,
            renderPayload: {
              productId: productGroup.productId,
              productName: productGroup.productName,
              brand: productGroup.productBrand,
              upc: productGroup.productUpc,
              vendor: productGroup.productVendor,
              nutrientsPer100g: representativeLot.nutrientsPer100g,
              sourceRefs: productEvidence.sourceRefs,
              evidenceSummary: productEvidence.summary,
              gradeBreakdown: productEvidence.gradeBreakdown,
              verificationStatusSummary: {
                verified: productRows.filter((row) => row.verificationStatus === VerificationStatus.VERIFIED).length,
                needsReview: productRows.filter((row) => row.verificationStatus === VerificationStatus.NEEDS_REVIEW).length,
                rejected: productRows.filter((row) => row.verificationStatus === VerificationStatus.REJECTED).length
              },
              reasonCodes: productEvidence.reasonCodes,
              provisional: productEvidence.summary.provisional
            },
            frozenAt: new Date(),
            createdBy: "system",
            version: await nextLabelVersion(tx, schedule.organizationId, "PRODUCT", productGroup.productId)
          }
        });

        await tx.labelLineageEdge.create({
          data: {
            parentLabelId: ingredientLabel.id,
            childLabelId: productLabel.id,
            edgeType: "INGREDIENT_RESOLVED_TO_PRODUCT",
            createdBy: "system"
          }
        });

        const lotGroups = groupLotConsumptions(productGroup.consumedLots);

        for (const lotGroup of lotGroups) {
          const lotEvidence = summarizeEvidence(lotGroup.nutrientRows, lotGroup.syntheticLot);
          const lotLabel = await tx.labelSnapshot.create({
            data: {
              organizationId: schedule.organizationId,
              labelType: "LOT",
              externalRefId: lotGroup.lotId,
              title: lotGroup.lotCode ? `Lot ${lotGroup.lotCode}` : `Lot ${lotGroup.lotId}`,
              renderPayload: {
                lotId: lotGroup.lotId,
                lotCode: lotGroup.lotCode,
                productId: lotGroup.productId,
                productName: lotGroup.productName,
                sourceOrderRef: lotGroup.sourceOrderRef,
                receivedAt: lotGroup.receivedAt,
                expiresAt: lotGroup.expiresAt,
                gramsConsumed: lotGroup.gramsConsumed,
                nutrientsPer100g: lotGroup.nutrientsPer100g,
                evidenceSummary: lotEvidence.summary,
                reasonCodes: lotEvidence.reasonCodes,
                sourceRefs: lotEvidence.sourceRefs,
                verificationStatusSummary: {
                  verified: lotGroup.nutrientRows.filter((row) => row.verificationStatus === VerificationStatus.VERIFIED)
                    .length,
                  needsReview: lotGroup.nutrientRows.filter(
                    (row) => row.verificationStatus === VerificationStatus.NEEDS_REVIEW
                  ).length,
                  rejected: lotGroup.nutrientRows.filter((row) => row.verificationStatus === VerificationStatus.REJECTED)
                    .length
                },
                syntheticLot: lotGroup.syntheticLot,
                provisional: lotEvidence.summary.provisional
              },
              frozenAt: new Date(),
              createdBy: "system",
              version: await nextLabelVersion(tx, schedule.organizationId, "LOT", lotGroup.lotId)
            }
          });

          await tx.labelLineageEdge.create({
            data: {
              parentLabelId: productLabel.id,
              childLabelId: lotLabel.id,
              edgeType: "PRODUCT_CONSUMED_FROM_LOT",
              createdBy: "system"
            }
          });
        }
      }
    }

    await tx.mealServiceEvent.update({
      where: { id: serviceEvent.id },
      data: { finalLabelSnapshotId: skuLabel.id }
    });

    return { mealServiceEventId: serviceEvent.id, labelSnapshotId: skuLabel.id };
  });
}

export async function buildLineageTree(labelId: string) {
  const visited = new Set<string>();

  async function walk(nodeId: string): Promise<any> {
    if (visited.has(nodeId)) {
      return null;
    }
    visited.add(nodeId);

    const node = await prisma.labelSnapshot.findUnique({ where: { id: nodeId } });
    if (!node) return null;

    const edges = await prisma.labelLineageEdge.findMany({ where: { parentLabelId: nodeId } });
    const children = [] as any[];

    for (const edge of edges) {
      const child = await walk(edge.childLabelId);
      if (child) {
        children.push(child);
      }
    }

    const payload = (node.renderPayload ?? {}) as Record<string, unknown>;
    const evidenceSummary = (payload.evidenceSummary ?? null) as Record<string, unknown> | null;

    return {
      labelId: node.id,
      labelType: node.labelType,
      title: node.title,
      metadata: {
        ...payload,
        provisional: Boolean(payload.provisional),
        evidenceSummary
      },
      children
    };
  }

  return walk(labelId);
}
