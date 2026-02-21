import { prisma, Prisma, ScheduleStatus } from "@nutrition/db";
import { computeSkuLabel } from "@nutrition/nutrition-engine";

function toNutrientMap(values: { nutrientDefinition: { key: string }; valuePer100g: number | null }[]) {
  const out: Record<string, number> = {};
  for (const row of values) {
    if (typeof row.valuePer100g === "number") {
      out[row.nutrientDefinition.key] = row.valuePer100g;
    }
  }
  return out;
}

async function nextLabelVersion(tx: Prisma.TransactionClient, organizationId: string, labelType: string, externalRefId: string) {
  const count = await tx.labelSnapshot.count({
    where: { organizationId, labelType: labelType as any, externalRefId }
  });
  return count + 1;
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
      include: { lines: { include: { ingredient: true }, orderBy: { lineOrder: "asc" } }
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
        servedByUserId: input.servedByUserId,
        scheduleStatusAtService: ScheduleStatus.DONE,
        createdBy: "system"
      }
    });

    const consumedLots: {
      recipeLineId: string;
      lotId: string;
      productId: string;
      productName: string;
      gramsConsumed: number;
      nutrientsPer100g: Record<string, number>;
      ingredientName: string;
      ingredientAllergens: string[];
      ingredientId: string;
    }[] = [];

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
          productId: lot.productId,
          productName: lot.product.name,
          gramsConsumed: use,
          nutrientsPer100g: toNutrientMap(lot.product.nutrients),
          ingredientName: line.ingredient.name,
          ingredientAllergens: line.ingredient.allergenTags,
          ingredientId: line.ingredient.id
        });

        remaining -= use;
      }

      if (remaining > 0) {
        throw new Error(`Insufficient lot quantity for ingredient ${line.ingredient.name}`);
      }
    }

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
      consumedLots: consumedLots.map((x) => ({
        recipeLineId: x.recipeLineId,
        lotId: x.lotId,
        productId: x.productId,
        productName: x.productName,
        gramsConsumed: x.gramsConsumed,
        nutrientsPer100g: x.nutrientsPer100g
      }))
    });

    const skuLabel = await tx.labelSnapshot.create({
      data: {
        organizationId: schedule.organizationId,
        labelType: "SKU",
        externalRefId: schedule.skuId,
        title: `${schedule.sku.code} - ${schedule.sku.name}`,
        renderPayload: label,
        frozenAt: new Date(),
        createdBy: "system",
        version: await nextLabelVersion(tx, schedule.organizationId, "SKU", schedule.skuId)
      }
    });

    // Child labels and lineage edges
    for (const lot of consumedLots) {
      const ingredientLabel = await tx.labelSnapshot.create({
        data: {
          organizationId: schedule.organizationId,
          labelType: "INGREDIENT",
          externalRefId: lot.ingredientId,
          title: lot.ingredientName,
          renderPayload: { ingredientName: lot.ingredientName },
          frozenAt: new Date(),
          createdBy: "system",
          version: await nextLabelVersion(tx, schedule.organizationId, "INGREDIENT", lot.ingredientId)
        }
      });

      const productLabel = await tx.labelSnapshot.create({
        data: {
          organizationId: schedule.organizationId,
          labelType: "PRODUCT",
          externalRefId: lot.productId,
          title: lot.productName,
          renderPayload: { productName: lot.productName },
          frozenAt: new Date(),
          createdBy: "system",
          version: await nextLabelVersion(tx, schedule.organizationId, "PRODUCT", lot.productId)
        }
      });

      const lotLabel = await tx.labelSnapshot.create({
        data: {
          organizationId: schedule.organizationId,
          labelType: "LOT",
          externalRefId: lot.lotId,
          title: `Lot ${lot.lotId}`,
          renderPayload: {
            lotId: lot.lotId,
            productName: lot.productName,
            gramsConsumed: lot.gramsConsumed,
            nutrientsPer100g: lot.nutrientsPer100g
          },
          frozenAt: new Date(),
          createdBy: "system",
          version: await nextLabelVersion(tx, schedule.organizationId, "LOT", lot.lotId)
        }
      });

      await tx.labelLineageEdge.createMany({
        data: [
          {
            parentLabelId: skuLabel.id,
            childLabelId: ingredientLabel.id,
            edgeType: "SKU_CONTAINS_INGREDIENT",
            createdBy: "system"
          },
          {
            parentLabelId: ingredientLabel.id,
            childLabelId: productLabel.id,
            edgeType: "INGREDIENT_RESOLVED_TO_PRODUCT",
            createdBy: "system"
          },
          {
            parentLabelId: productLabel.id,
            childLabelId: lotLabel.id,
            edgeType: "PRODUCT_CONSUMED_FROM_LOT",
            createdBy: "system"
          }
        ]
      });
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

    return {
      labelId: node.id,
      labelType: node.labelType,
      title: node.title,
      metadata: node.renderPayload,
      children
    };
  }

  return walk(labelId);
}
