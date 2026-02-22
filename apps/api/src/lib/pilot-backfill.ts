import { addHours } from "date-fns";
import { NutrientSourceType, Prisma, VerificationStatus, prisma } from "@nutrition/db";
import { mapOrderLineToIngredient } from "@nutrition/importers";
import type { InstacartOrderRow, PilotMealRow } from "@nutrition/importers";
import { freezeLabelFromScheduleDone } from "./label-freeze.js";
import { resolveFallbackNutrientsForIngredientKey } from "../worker/nutrient-autofill.js";

const coreNutrientKeys = ["kcal", "protein_g", "carb_g", "fat_g", "sodium_mg"] as const;

const mealSlotPriority: Record<string, number> = {
  BREAKFAST: 1,
  PRE_TRAINING: 2,
  LUNCH: 3,
  POST_TRAINING: 4,
  SNACK: 5,
  DINNER: 6,
  PRE_BED: 7
};

type CoreNutrientValues = {
  kcal?: number;
  protein_g?: number;
  carb_g?: number;
  fat_g?: number;
  sodium_mg?: number;
};

type ScheduleQueueItem = {
  scheduleId: string;
  serviceDate: Date;
  mealSlot: string;
};

type RunPilotBackfillInput = {
  organizationId: string;
  servedByUserId: string;
  createdBy: string;
  mealRows: PilotMealRow[];
  lotRows: InstacartOrderRow[];
  sourceOrderRef?: string;
};

export type RunPilotBackfillResult = {
  createdClients: number;
  createdIngredients: number;
  createdSkus: number;
  createdRecipes: number;
  createdSchedules: number;
  createdLots: number;
  syntheticLotsCreated: number;
  servedEvents: Array<{
    scheduleId: string;
    mealServiceEventId: string;
    labelSnapshotId: string | null;
  }>;
  freezeErrors: Array<{ scheduleId: string; message: string }>;
};

export async function runPilotBackfill(input: RunPilotBackfillInput): Promise<RunPilotBackfillResult> {
  const queue: ScheduleQueueItem[] = [];
  const created = {
    clients: 0,
    ingredients: 0,
    skus: 0,
    recipes: 0,
    schedules: 0,
    lots: 0,
    syntheticLots: 0
  };

  await prisma.$transaction(async (tx) => {
    const nutrientDefinitions = await tx.nutrientDefinition.findMany({
      where: { key: { in: coreNutrientKeys as unknown as string[] } }
    });
    const nutrientDefinitionByKey = new Map(nutrientDefinitions.map((row) => [row.key, row]));

    const clientByExternalRef = new Map<string, { id: string; fullName: string }>();
    const uniqueClientRows = new Map<string, { externalRef: string; fullName: string }>();

    for (const row of input.mealRows) {
      if (!uniqueClientRows.has(row.clientExternalRef)) {
        uniqueClientRows.set(row.clientExternalRef, {
          externalRef: row.clientExternalRef,
          fullName: row.clientName
        });
      }
    }

    for (const clientSeed of uniqueClientRows.values()) {
      const existing = await tx.client.findUnique({
        where: {
          organizationId_externalRef: {
            organizationId: input.organizationId,
            externalRef: clientSeed.externalRef
          }
        }
      });

      const client = await tx.client.upsert({
        where: {
          organizationId_externalRef: {
            organizationId: input.organizationId,
            externalRef: clientSeed.externalRef
          }
        },
        update: {
          fullName: clientSeed.fullName,
          active: true,
          version: { increment: 1 }
        },
        create: {
          organizationId: input.organizationId,
          externalRef: clientSeed.externalRef,
          fullName: clientSeed.fullName,
          timezone: "America/New_York",
          createdBy: input.createdBy
        }
      });

      if (!existing) created.clients += 1;
      clientByExternalRef.set(clientSeed.externalRef, { id: client.id, fullName: client.fullName });
    }

    const ingredientSeedByKey = new Map<
      string,
      {
        name: string;
        category: string;
        defaultUnit: string;
        allergenTags: string[];
      }
    >();

    for (const row of input.mealRows) {
      const existingSeed = ingredientSeedByKey.get(row.ingredientKey);
      if (!existingSeed) {
        ingredientSeedByKey.set(row.ingredientKey, {
          name: row.ingredientName,
          category: row.ingredientCategory,
          defaultUnit: row.defaultUnit,
          allergenTags: row.allergenTags
        });
        continue;
      }

      if (!existingSeed.name && row.ingredientName) existingSeed.name = row.ingredientName;
      if (existingSeed.category === "UNMAPPED" && row.ingredientCategory !== "UNMAPPED") {
        existingSeed.category = row.ingredientCategory;
      }
      if ((!existingSeed.defaultUnit || existingSeed.defaultUnit === "g") && row.defaultUnit) {
        existingSeed.defaultUnit = row.defaultUnit;
      }
      if (!existingSeed.allergenTags.length && row.allergenTags.length) {
        existingSeed.allergenTags = row.allergenTags;
      }
    }

    const ingredientByKey = new Map<string, { id: string; canonicalKey: string; name: string }>();

    for (const [ingredientKey, seed] of ingredientSeedByKey.entries()) {
      const existing = await tx.ingredientCatalog.findUnique({
        where: {
          organizationId_canonicalKey: {
            organizationId: input.organizationId,
            canonicalKey: ingredientKey
          }
        }
      });

      const ingredient = await tx.ingredientCatalog.upsert({
        where: {
          organizationId_canonicalKey: {
            organizationId: input.organizationId,
            canonicalKey: ingredientKey
          }
        },
        update: {
          name: seed.name,
          category: seed.category || "UNMAPPED",
          defaultUnit: seed.defaultUnit || "g",
          allergenTags: seed.allergenTags,
          active: true,
          version: { increment: 1 }
        },
        create: {
          organizationId: input.organizationId,
          canonicalKey: ingredientKey,
          name: seed.name,
          category: seed.category || "UNMAPPED",
          defaultUnit: seed.defaultUnit || "g",
          allergenTags: seed.allergenTags,
          createdBy: input.createdBy
        }
      });

      if (!existing) created.ingredients += 1;
      ingredientByKey.set(ingredientKey, { id: ingredient.id, canonicalKey: ingredient.canonicalKey, name: ingredient.name });
    }

    const skuRowsByCode = new Map<string, PilotMealRow[]>();
    for (const row of input.mealRows) {
      const current = skuRowsByCode.get(row.skuCode) ?? [];
      current.push(row);
      skuRowsByCode.set(row.skuCode, current);
    }

    const skuIdByCode = new Map<string, string>();

    for (const [skuCode, rows] of skuRowsByCode.entries()) {
      const first = rows[0];
      if (!first) continue;
      const existingSku = await tx.sku.findUnique({
        where: {
          organizationId_code: {
            organizationId: input.organizationId,
            code: skuCode
          }
        }
      });
      const sku = await tx.sku.upsert({
        where: {
          organizationId_code: {
            organizationId: input.organizationId,
            code: skuCode
          }
        },
        update: {
          name: first.skuName,
          servingSizeG: first.servingSizeG,
          active: true,
          version: { increment: 1 }
        },
        create: {
          organizationId: input.organizationId,
          code: skuCode,
          name: first.skuName,
          servingSizeG: first.servingSizeG,
          createdBy: input.createdBy
        }
      });
      if (!existingSku) created.skus += 1;
      skuIdByCode.set(skuCode, sku.id);

      const recipeId = buildRecipeId(input.organizationId, skuCode);
      const existingRecipe = await tx.recipe.findUnique({ where: { id: recipeId } });
      await tx.recipe.upsert({
        where: { id: recipeId },
        update: {
          skuId: sku.id,
          name: first.recipeName,
          servings: first.plannedServings,
          active: true,
          version: { increment: 1 }
        },
        create: {
          id: recipeId,
          organizationId: input.organizationId,
          skuId: sku.id,
          name: first.recipeName,
          servings: first.plannedServings,
          createdBy: input.createdBy
        }
      });
      if (!existingRecipe) created.recipes += 1;

      const sortedLines = [...rows].sort((a, b) => a.lineOrder - b.lineOrder);
      let safeLineOrder = 1;
      for (const line of sortedLines) {
        const ingredient = ingredientByKey.get(line.ingredientKey);
        if (!ingredient) continue;
        await tx.recipeLine.upsert({
          where: {
            recipeId_lineOrder: {
              recipeId,
              lineOrder: safeLineOrder
            }
          },
          update: {
            ingredientId: ingredient.id,
            targetGPerServing: line.gramsPerServing,
            preparation: line.preparation ?? undefined,
            required: line.required,
            version: { increment: 1 }
          },
          create: {
            recipeId,
            ingredientId: ingredient.id,
            lineOrder: safeLineOrder,
            targetGPerServing: line.gramsPerServing,
            preparation: line.preparation ?? undefined,
            required: line.required,
            createdBy: input.createdBy
          }
        });
        safeLineOrder += 1;
      }

      const staleLines = await tx.recipeLine.findMany({
        where: { recipeId, lineOrder: { gte: safeLineOrder } },
        select: { id: true }
      });

      if (staleLines.length > 0) {
        const staleIds = staleLines.map((line) => line.id);
        const blockedRows = await tx.lotConsumptionEvent.findMany({
          where: { recipeLineId: { in: staleIds } },
          select: { recipeLineId: true }
        });
        const blockedIds = new Set(blockedRows.map((row) => row.recipeLineId));
        const deletableIds = staleIds.filter((id) => !blockedIds.has(id));

        if (deletableIds.length > 0) {
          await tx.recipeLine.deleteMany({ where: { id: { in: deletableIds } } });
        }

        if (blockedIds.size > 0) {
          await ensureOpenTask(tx, {
            organizationId: input.organizationId,
            taskType: "LINEAGE_INTEGRITY",
            severity: "LOW",
            title: `Preserved historical recipe lines: ${first.recipeName}`,
            description:
              "Recipe lines tied to historical lot consumption were preserved during pilot backfill rerun.",
            dedupeKey: `pilot-recipe-line-preserve:${recipeId}`,
            payload: {
              recipeId,
              preservedRecipeLineIds: Array.from(blockedIds)
            }
          });
        }
      }
    }

    const scheduleKeySet = new Set<string>();
    const scheduleQueueLocal: ScheduleQueueItem[] = [];

    for (const row of input.mealRows) {
      const client = clientByExternalRef.get(row.clientExternalRef);
      const skuId = skuIdByCode.get(row.skuCode);
      if (!client || !skuId) continue;
      const scheduleKey = `${client.id}|${skuId}|${toDateOnlyKey(row.serviceDate)}|${row.mealSlot}`;
      if (scheduleKeySet.has(scheduleKey)) continue;
      scheduleKeySet.add(scheduleKey);

      const existing = await tx.mealSchedule.findFirst({
        where: {
          organizationId: input.organizationId,
          clientId: client.id,
          skuId,
          serviceDate: row.serviceDate,
          mealSlot: row.mealSlot
        },
        include: {
          serviceEvent: {
            select: { id: true }
          }
        }
      });

      const schedule = existing?.serviceEvent
        ? existing
        : existing
          ? await tx.mealSchedule.update({
              where: { id: existing.id },
              data: {
                plannedServings: row.plannedServings,
                notes: existing.notes ?? "pilot_backfill",
                version: { increment: 1 }
              }
            })
          : await tx.mealSchedule.create({
              data: {
                organizationId: input.organizationId,
                clientId: client.id,
                skuId,
                serviceDate: row.serviceDate,
                mealSlot: row.mealSlot,
                plannedServings: row.plannedServings,
                status: "PLANNED",
                notes: "pilot_backfill",
                createdBy: input.createdBy
              }
            });

      if (!existing) created.schedules += 1;
      if (!existing?.serviceEvent) {
        scheduleQueueLocal.push({
          scheduleId: schedule.id,
          serviceDate: schedule.serviceDate,
          mealSlot: schedule.mealSlot
        });
      }
    }

    const ingredientRowsForMatching = [...ingredientByKey.values()].map((ingredient) => ({
      ingredientKey: ingredient.canonicalKey,
      ingredientName: ingredient.name,
      category: "UNMAPPED",
      defaultUnit: "g",
      allergenTags: [] as string[]
    }));

    for (let idx = 0; idx < input.lotRows.length; idx += 1) {
      const lotRow = input.lotRows[idx];
      if (!lotRow) continue;

      const mappedIngredientKey = resolveLotIngredientKey(lotRow, ingredientRowsForMatching);
      if (!mappedIngredientKey) {
        await ensureOpenTask(tx, {
          organizationId: input.organizationId,
          taskType: "SOURCE_RETRIEVAL",
          severity: "HIGH",
          title: `Map lot row ingredient: ${lotRow.productName}`,
          description: "Could not map lot row to ingredient catalog.",
          dedupeKey: `lot-map:${lotRow.upc ?? lotRow.productName}`,
          payload: {
            productName: lotRow.productName,
            upc: lotRow.upc,
            lotRowIndex: idx + 2
          }
        });
        continue;
      }

      let ingredient = ingredientByKey.get(mappedIngredientKey);
      if (!ingredient) {
        const createdIngredient = await tx.ingredientCatalog.create({
          data: {
            organizationId: input.organizationId,
            canonicalKey: mappedIngredientKey,
            name: lotRow.ingredientNameHint ?? lotRow.productName,
            category: "UNMAPPED",
            defaultUnit: "g",
            allergenTags: [],
            createdBy: "agent"
          }
        });
        ingredient = {
          id: createdIngredient.id,
          canonicalKey: createdIngredient.canonicalKey,
          name: createdIngredient.name
        };
        ingredientByKey.set(ingredient.canonicalKey, ingredient);
        ingredientRowsForMatching.push({
          ingredientKey: ingredient.canonicalKey,
          ingredientName: ingredient.name,
          category: "UNMAPPED",
          defaultUnit: "g",
          allergenTags: []
        });
        created.ingredients += 1;
      }

      const product = await tx.productCatalog.upsert({
        where: {
          organizationId_upc: {
            organizationId: input.organizationId,
            upc: resolveProductUpc(lotRow.upc, ingredient.id, lotRow.productName)
          }
        },
        update: {
          ingredientId: ingredient.id,
          name: lotRow.productName,
          brand: lotRow.brand,
          vendor: "Walmart",
          active: true,
          version: { increment: 1 }
        },
        create: {
          organizationId: input.organizationId,
          ingredientId: ingredient.id,
          name: lotRow.productName,
          brand: lotRow.brand,
          upc: resolveProductUpc(lotRow.upc, ingredient.id, lotRow.productName),
          vendor: "Walmart",
          createdBy: input.createdBy
        }
      });

      const gramsPerUnit = Number.isFinite(lotRow.gramsPerUnit) && lotRow.gramsPerUnit > 0 ? lotRow.gramsPerUnit : 100;
      const totalGrams = Math.max(1, gramsPerUnit * lotRow.qty);
      const orderedAt = lotRow.orderedAt;
      const lotCode = lotRow.lotCode ?? `LOT-${toDateCompact(orderedAt)}-${String(idx + 1).padStart(3, "0")}`;
      const sourceOrderRef = input.sourceOrderRef ?? "pilot_backfill";
      const existingLot = await tx.inventoryLot.findFirst({
        where: {
          organizationId: input.organizationId,
          productId: product.id,
          lotCode,
          sourceOrderRef
        }
      });

      if (!existingLot) {
        const lot = await tx.inventoryLot.create({
          data: {
            organizationId: input.organizationId,
            productId: product.id,
            lotCode,
            receivedAt: orderedAt,
            expiresAt: lotRow.expiresAt ?? addHours(orderedAt, 24 * 21),
            quantityReceivedG: totalGrams,
            quantityAvailableG: totalGrams,
            unitCostCents: resolveUnitCostCents(lotRow),
            sourceOrderRef,
            createdBy: input.createdBy
          }
        });
        await tx.inventoryLotLedger.create({
          data: {
            inventoryLotId: lot.id,
            deltaG: totalGrams,
            reason: "PILOT_BACKFILL_IMPORT",
            referenceId: sourceOrderRef,
            createdBy: input.createdBy
          }
        });
        created.lots += 1;
      }

      const hintedValues: CoreNutrientValues = {
        kcal: lotRow.nutrientHints.kcal ?? undefined,
        protein_g: lotRow.nutrientHints.proteinG ?? undefined,
        carb_g: lotRow.nutrientHints.carbG ?? undefined,
        fat_g: lotRow.nutrientHints.fatG ?? undefined,
        sodium_mg: lotRow.nutrientHints.sodiumMg ?? undefined
      };

      if (hasCoreHints(hintedValues)) {
        await upsertCoreNutrients(tx, {
          productId: product.id,
          nutrientDefinitionByKey,
          values: hintedValues,
          sourceType: lotRow.nutrientSourceTypeHint ?? NutrientSourceType.MANUFACTURER,
          sourceRef: lotRow.nutrientSourceRefHint ?? `${sourceOrderRef}:row:${idx + 2}`
        });
      } else {
        const fallback = resolveFallbackNutrientsForIngredientKey(ingredient.canonicalKey);
        if (fallback) {
          await upsertCoreNutrients(tx, {
            productId: product.id,
            nutrientDefinitionByKey,
            values: fallback,
            sourceType: NutrientSourceType.DERIVED,
            sourceRef: `fallback:${ingredient.canonicalKey}`
          });
          await ensureOpenTask(tx, {
            organizationId: input.organizationId,
            taskType: "SOURCE_RETRIEVAL",
            severity: "MEDIUM",
            title: `Review fallback nutrients: ${product.name}`,
            description: "Autofilled from ingredient fallback map. Verify against manufacturer/USDA source.",
            dedupeKey: `nutrient-fallback:${product.id}`,
            payload: {
              productId: product.id,
              productName: product.name,
              sourceRef: `fallback:${ingredient.canonicalKey}`,
              ingredientKey: ingredient.canonicalKey
            }
          });
        } else {
          await ensureOpenTask(tx, {
            organizationId: input.organizationId,
            taskType: "SOURCE_RETRIEVAL",
            severity: "CRITICAL",
            title: `Missing nutrients for ${product.name}`,
            description: "No nutrient hints or fallback found. Human source retrieval required.",
            dedupeKey: `missing-nutrients:${product.id}`,
            payload: {
              productId: product.id,
              productName: product.name,
              ingredientKey: ingredient.canonicalKey
            }
          });
        }
      }
    }

    const requiredByIngredient = new Map<string, number>();
    for (const row of input.mealRows) {
      const grams = row.gramsPerServing * row.plannedServings;
      requiredByIngredient.set(row.ingredientKey, (requiredByIngredient.get(row.ingredientKey) ?? 0) + grams);
    }

    const currentLots = await tx.inventoryLot.findMany({
      where: { organizationId: input.organizationId, quantityAvailableG: { gt: 0 } },
      include: {
        product: {
          include: {
            ingredient: true
          }
        }
      }
    });
    const availableByIngredient = new Map<string, number>();
    for (const lot of currentLots) {
      const key = lot.product.ingredient.canonicalKey;
      availableByIngredient.set(key, (availableByIngredient.get(key) ?? 0) + lot.quantityAvailableG);
    }

    for (const [ingredientKey, requiredG] of requiredByIngredient.entries()) {
      const availableG = availableByIngredient.get(ingredientKey) ?? 0;
      if (availableG + 0.01 >= requiredG) continue;
      const shortageG = Math.max(1, Math.ceil((requiredG - availableG) * 1.05));

      let ingredient = ingredientByKey.get(ingredientKey);
      if (!ingredient) {
        const createdIngredient = await tx.ingredientCatalog.create({
          data: {
            organizationId: input.organizationId,
            canonicalKey: ingredientKey,
            name: ingredientKey,
            category: "UNMAPPED",
            defaultUnit: "g",
            allergenTags: [],
            createdBy: "agent"
          }
        });
        ingredient = {
          id: createdIngredient.id,
          canonicalKey: createdIngredient.canonicalKey,
          name: createdIngredient.name
        };
        ingredientByKey.set(ingredient.canonicalKey, ingredient);
        created.ingredients += 1;
      }

      const syntheticProduct = await tx.productCatalog.upsert({
        where: {
          organizationId_upc: {
            organizationId: input.organizationId,
            upc: `SYNTH-${ingredient.canonicalKey}`
          }
        },
        update: {
          ingredientId: ingredient.id,
          name: `Historical Estimated ${ingredient.name}`,
          vendor: "SYSTEM_SYNTHETIC",
          active: true,
          version: { increment: 1 }
        },
        create: {
          organizationId: input.organizationId,
          ingredientId: ingredient.id,
          name: `Historical Estimated ${ingredient.name}`,
          upc: `SYNTH-${ingredient.canonicalKey}`,
          vendor: "SYSTEM_SYNTHETIC",
          createdBy: "agent"
        }
      });

      const fallback = resolveFallbackNutrientsForIngredientKey(ingredient.canonicalKey) ?? {};
      await upsertCoreNutrients(tx, {
        productId: syntheticProduct.id,
        nutrientDefinitionByKey,
        values: {
          kcal: fallback.kcal ?? 0,
          protein_g: fallback.protein_g ?? 0,
          carb_g: fallback.carb_g ?? 0,
          fat_g: fallback.fat_g ?? 0,
          sodium_mg: fallback.sodium_mg ?? 0
        },
        sourceType: NutrientSourceType.DERIVED,
        sourceRef: `synthetic:${ingredient.canonicalKey}`
      });

      const lot = await tx.inventoryLot.create({
        data: {
          organizationId: input.organizationId,
          productId: syntheticProduct.id,
          lotCode: `SYNTH-${toDateCompact(new Date())}-${ingredient.canonicalKey.slice(0, 24)}`,
          receivedAt: new Date(),
          expiresAt: null,
          quantityReceivedG: shortageG,
          quantityAvailableG: shortageG,
          unitCostCents: 0,
          sourceOrderRef: input.sourceOrderRef ?? "pilot_backfill",
          createdBy: "agent"
        }
      });
      await tx.inventoryLotLedger.create({
        data: {
          inventoryLotId: lot.id,
          deltaG: shortageG,
          reason: "PILOT_SYNTHETIC_FILL",
          referenceId: ingredient.canonicalKey,
          createdBy: "agent"
        }
      });
      created.lots += 1;
      created.syntheticLots += 1;

      await ensureOpenTask(tx, {
        organizationId: input.organizationId,
        taskType: "SOURCE_RETRIEVAL",
        severity: "HIGH",
        title: `Synthetic lot created: ${ingredient.name}`,
        description: "Synthetic inventory was created to complete historical label freeze. Replace with real lot data.",
        dedupeKey: `synthetic:${ingredient.canonicalKey}`,
        payload: {
          ingredientKey: ingredient.canonicalKey,
          shortageG,
          syntheticProductId: syntheticProduct.id
        }
      });
    }

    const rowsNeedingReview = input.mealRows.filter((row) => row.needsReview);
    for (const row of rowsNeedingReview) {
      const dedupe = `meal-row-review:${row.skuCode}:${row.lineOrder}:${toDateOnlyKey(row.serviceDate)}`;
      await ensureOpenTask(tx, {
        organizationId: input.organizationId,
        taskType: "CONSISTENCY",
        severity: "MEDIUM",
        title: `Review estimated meal line: ${row.ingredientName}`,
        description: "Meal line includes approximation/estimate and should be verified.",
        dedupeKey: dedupe,
        payload: {
          skuCode: row.skuCode,
          ingredientKey: row.ingredientKey,
          lineOrder: row.lineOrder,
          serviceDate: toDateOnlyKey(row.serviceDate),
          notes: row.reviewNotes
        }
      });
    }

    for (const item of scheduleQueueLocal) {
      queue.push(item);
    }
  }, { maxWait: 30_000, timeout: 180_000 });

  const servedEvents: RunPilotBackfillResult["servedEvents"] = [];
  const freezeErrors: RunPilotBackfillResult["freezeErrors"] = [];
  const sortedQueue = [...queue].sort((a, b) => {
    const dateDiff = a.serviceDate.getTime() - b.serviceDate.getTime();
    if (dateDiff !== 0) return dateDiff;
    return (mealSlotPriority[a.mealSlot] ?? 999) - (mealSlotPriority[b.mealSlot] ?? 999);
  });

  for (const item of sortedQueue) {
    try {
      await prisma.mealSchedule.update({
        where: { id: item.scheduleId },
        data: {
          status: "DONE",
          version: { increment: 1 }
        }
      });
      const frozen = await freezeLabelFromScheduleDone({
        mealScheduleId: item.scheduleId,
        servedByUserId: input.servedByUserId
      });
      servedEvents.push({
        scheduleId: item.scheduleId,
        mealServiceEventId: frozen.mealServiceEventId,
        labelSnapshotId: frozen.labelSnapshotId ?? null
      });
    } catch (error) {
      await prisma.mealSchedule.update({
        where: { id: item.scheduleId },
        data: {
          status: "PLANNED",
          version: { increment: 1 }
        }
      });
      freezeErrors.push({
        scheduleId: item.scheduleId,
        message: error instanceof Error ? error.message : "Freeze failed"
      });
    }
  }

  return {
    createdClients: created.clients,
    createdIngredients: created.ingredients,
    createdSkus: created.skus,
    createdRecipes: created.recipes,
    createdSchedules: created.schedules,
    createdLots: created.lots,
    syntheticLotsCreated: created.syntheticLots,
    servedEvents,
    freezeErrors
  };
}

function buildRecipeId(organizationId: string, skuCode: string): string {
  const token = skuCode.replace(/[^a-zA-Z0-9]/g, "").slice(0, 48);
  return `pilot-${organizationId}-${token}`;
}

function toDateOnlyKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function toDateCompact(date: Date): string {
  return toDateOnlyKey(date).replace(/-/g, "");
}

function resolveProductUpc(upc: string | null, ingredientId: string, productName: string): string {
  const numeric = (upc ?? "").replace(/[^0-9]/g, "");
  if (numeric.length >= 8) return numeric;
  const fallbackName = productName.replace(/[^a-zA-Z0-9]+/g, "").slice(0, 32).toUpperCase();
  return `NOUPC-${ingredientId}-${fallbackName}`;
}

function resolveUnitCostCents(row: InstacartOrderRow): number | null {
  if (typeof row.unitPriceUsd === "number" && Number.isFinite(row.unitPriceUsd)) {
    return Math.round(row.unitPriceUsd * 100);
  }
  if (typeof row.lineTotalUsd === "number" && Number.isFinite(row.lineTotalUsd) && row.qty > 0) {
    return Math.round((row.lineTotalUsd / row.qty) * 100);
  }
  return null;
}

function hasCoreHints(values: CoreNutrientValues): boolean {
  return coreNutrientKeys.some((key) => {
    const value = values[key];
    return typeof value === "number" && Number.isFinite(value);
  });
}

function resolveLotIngredientKey(
  row: InstacartOrderRow,
  ingredientRows: Array<{
    ingredientKey: string;
    ingredientName: string;
    category: string;
    defaultUnit: string;
    allergenTags: string[];
  }>
): string | null {
  if (row.ingredientKeyHint) return row.ingredientKeyHint;
  const mapping = mapOrderLineToIngredient(`${row.brand ?? ""} ${row.productName}`.trim(), ingredientRows);
  if (mapping.ingredientKey) return mapping.ingredientKey;
  return null;
}

async function upsertCoreNutrients(
  tx: Prisma.TransactionClient,
  input: {
    productId: string;
    nutrientDefinitionByKey: Map<string, { id: string }>;
    values: CoreNutrientValues;
    sourceType: NutrientSourceType;
    sourceRef: string;
  }
) {
  for (const key of coreNutrientKeys) {
    const value = input.values[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const def = input.nutrientDefinitionByKey.get(key);
    if (!def) continue;

    await tx.productNutrientValue.upsert({
      where: {
        productId_nutrientDefinitionId: {
          productId: input.productId,
          nutrientDefinitionId: def.id
        }
      },
      update: {
        valuePer100g: value,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        verificationStatus: VerificationStatus.NEEDS_REVIEW,
        version: { increment: 1 }
      },
      create: {
        productId: input.productId,
        nutrientDefinitionId: def.id,
        valuePer100g: value,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        verificationStatus: VerificationStatus.NEEDS_REVIEW,
        createdBy: "agent"
      }
    });
  }
}

async function ensureOpenTask(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    taskType: "SOURCE_RETRIEVAL" | "CONSISTENCY" | "LINEAGE_INTEGRITY";
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    title: string;
    description: string;
    dedupeKey: string;
    payload: Prisma.InputJsonValue;
  }
) {
  const existing = await tx.verificationTask.findFirst({
    where: {
      organizationId: input.organizationId,
      status: "OPEN",
      taskType: input.taskType,
      payload: {
        path: ["dedupeKey"],
        equals: input.dedupeKey
      }
    }
  });
  if (existing) return existing;

  return tx.verificationTask.create({
    data: {
      organizationId: input.organizationId,
      taskType: input.taskType,
      severity: input.severity,
      status: "OPEN",
      title: input.title,
      description: input.description,
      payload: {
        ...(input.payload as object),
        dedupeKey: input.dedupeKey
      },
      createdBy: "agent"
    }
  });
}
