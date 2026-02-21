import crypto from "node:crypto";
import fs from "node:fs";
import express from "express";
import multer from "multer";
import { addHours, endOfMonth, parse, startOfMonth } from "date-fns";
import { prisma, VerificationStatus } from "@nutrition/db";
import { parseInstacartOrders, parseSotWorkbook, mapOrderLineToIngredient } from "@nutrition/importers";
import { getDefaultUser, getPrimaryOrganization } from "../lib/context.js";
import { freezeLabelFromScheduleDone, buildLineageTree } from "../lib/label-freeze.js";
import { ensureIdempotency, setIdempotencyResponse } from "../lib/idempotency.js";
import { importResultSchema, verificationTaskSchema } from "@nutrition/contracts";

const upload = multer({ dest: "/tmp" });

export const v1Router = express.Router();

v1Router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "nutrition-autopilot-api", version: "v1" });
});

v1Router.get("/system/state", async (_req, res) => {
  const org = await getPrimaryOrganization();
  const [sotJobs, skuCount, ingredientCount, lotCount, scheduleCount, serviceEventCount, labelCount, verificationOpenCount] =
    await Promise.all([
      prisma.importJob.count({
        where: { organizationId: org.id, jobType: "SOT", mode: "COMMIT", status: { in: ["SUCCEEDED", "PARTIAL"] } }
      }),
      prisma.sku.count({ where: { organizationId: org.id, active: true } }),
      prisma.ingredientCatalog.count({ where: { organizationId: org.id, active: true } }),
      prisma.inventoryLot.count({ where: { organizationId: org.id, quantityAvailableG: { gt: 0 } } }),
      prisma.mealSchedule.count({ where: { organizationId: org.id } }),
      prisma.mealServiceEvent.count({ where: { organizationId: org.id } }),
      prisma.labelSnapshot.count({ where: { organizationId: org.id } }),
      prisma.verificationTask.count({ where: { organizationId: org.id, status: "OPEN" } })
    ]);

  res.json({
    hasCommittedSot: sotJobs > 0,
    counts: {
      activeSkus: skuCount,
      activeIngredients: ingredientCount,
      lotsOnHand: lotCount,
      schedules: scheduleCount,
      servedMeals: serviceEventCount,
      labels: labelCount,
      openVerificationTasks: verificationOpenCount
    }
  });
});

v1Router.get("/clients", async (_req, res) => {
  const org = await getPrimaryOrganization();
  const clients = await prisma.client.findMany({
    where: { organizationId: org.id, active: true },
    orderBy: { fullName: "asc" }
  });
  res.json({
    clients: clients.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      timezone: c.timezone
    }))
  });
});

v1Router.post("/imports/sot", upload.single("file"), async (req, res) => {
  const org = await getPrimaryOrganization();
  const user = await getDefaultUser();

  if (!req.file) {
    return res.status(400).json({ error: "file is required" });
  }
  const uploadedFile = req.file;

  const mode = req.body.mode === "commit" ? "commit" : "dry-run";
  const parsed = parseSotWorkbook(uploadedFile.path);
  const checksum = crypto.createHash("sha256").update(fs.readFileSync(uploadedFile.path)).digest("hex");
  const idempotencyKey = `SOT:${org.id}:${checksum}:${mode}`;
  const idempotency = await ensureIdempotency(
    "SOT_IMPORT",
    idempotencyKey,
    { checksum, mode, sourceFileName: uploadedFile.originalname }
  );
  if (idempotency.replay && idempotency.existing.responseBody) {
    return res.json({ replay: true, ...(idempotency.existing.responseBody as object) });
  }

  const job = await prisma.importJob.create({
    data: {
      organizationId: org.id,
      jobType: "SOT",
      mode: mode === "commit" ? "COMMIT" : "DRY_RUN",
      status: parsed.errors.length ? "FAILED" : "SUCCEEDED",
      sourceFileName: uploadedFile.originalname,
      sourceChecksum: checksum,
      summary: {
        skus: parsed.skus.length,
        recipeLines: parsed.recipeLines.length,
        ingredients: parsed.ingredients.length
      },
      createdBy: user.email
    }
  });

  if (parsed.errors.length) {
    await prisma.importJobError.createMany({
      data: parsed.errors.map((e) => ({
        importJobId: job.id,
        sheetName: e.sheet,
        rowNumber: e.rowNumber,
        errorCode: e.code,
        message: e.message,
        createdBy: user.email
      }))
    });
  }

  let createdCount = 0;
  let updatedCount = 0;

  if (mode === "commit" && parsed.errors.length === 0) {
    await prisma.$transaction(async (tx) => {
      for (const ingredient of parsed.ingredients) {
        const existing = await tx.ingredientCatalog.findFirst({
          where: { organizationId: org.id, canonicalKey: ingredient.ingredientKey }
        });
        if (existing) {
          await tx.ingredientCatalog.update({
            where: { id: existing.id },
            data: {
              name: ingredient.ingredientName,
              category: ingredient.category,
              defaultUnit: ingredient.defaultUnit,
              allergenTags: ingredient.allergenTags,
              createdBy: user.email,
              version: { increment: 1 }
            }
          });
          updatedCount += 1;
        } else {
          await tx.ingredientCatalog.create({
            data: {
              organizationId: org.id,
              canonicalKey: ingredient.ingredientKey,
              name: ingredient.ingredientName,
              category: ingredient.category,
              defaultUnit: ingredient.defaultUnit,
              allergenTags: ingredient.allergenTags,
              createdBy: user.email
            }
          });
          createdCount += 1;
        }
      }

      for (const sku of parsed.skus) {
        const existing = await tx.sku.findFirst({ where: { organizationId: org.id, code: sku.skuCode } });
        let skuId = existing?.id;
        if (existing) {
          await tx.sku.update({
            where: { id: existing.id },
            data: {
              name: sku.skuName,
              servingSizeG: sku.servingSizeG,
              version: { increment: 1 }
            }
          });
          updatedCount += 1;
        } else {
          const created = await tx.sku.create({
            data: {
              organizationId: org.id,
              code: sku.skuCode,
              name: sku.skuName,
              servingSizeG: sku.servingSizeG,
              createdBy: user.email
            }
          });
          skuId = created.id;
          createdCount += 1;
        }

        const recipe = await tx.recipe.upsert({
          where: {
            id: `seed-${org.id}-${sku.skuCode}-${sku.recipeName}`
          },
          update: {
            skuId: skuId!,
            servings: sku.servings,
            active: true,
            version: { increment: 1 }
          },
          create: {
            id: `seed-${org.id}-${sku.skuCode}-${sku.recipeName}`,
            organizationId: org.id,
            skuId: skuId!,
            name: sku.recipeName,
            servings: sku.servings,
            createdBy: user.email
          }
        });

        await tx.recipeLine.deleteMany({ where: { recipeId: recipe.id } });

        const lines = parsed.recipeLines.filter((x) => x.skuCode === sku.skuCode && x.recipeName === sku.recipeName);
        for (const line of lines) {
          const ingredient = await tx.ingredientCatalog.findFirstOrThrow({
            where: { organizationId: org.id, canonicalKey: line.ingredientKey }
          });
          await tx.recipeLine.create({
            data: {
              recipeId: recipe.id,
              ingredientId: ingredient.id,
              lineOrder: line.lineOrder,
              targetGPerServing: line.gramsPerServing,
              preparation: line.preparation,
              required: line.required,
              createdBy: user.email
            }
          });
          createdCount += 1;
        }
      }

      await tx.importJob.update({
        where: { id: job.id },
        data: {
          status: "SUCCEEDED",
          summary: {
            ...(job.summary as object),
            createdCount,
            updatedCount,
            errors: parsed.errors.length
          }
        }
      });
    });
  }

  const response = importResultSchema.parse({
    importJobId: job.id,
    mode,
    status: parsed.errors.length ? "FAILED" : "SUCCEEDED",
    createdCount,
    updatedCount,
    errorCount: parsed.errors.length,
    errors: parsed.errors.map((e) => ({
      rowNumber: e.rowNumber,
      sheet: e.sheet,
      code: e.code,
      message: e.message
    }))
  });

  await setIdempotencyResponse(idempotencyKey, response);
  return res.json(response);
});

v1Router.post("/imports/instacart-orders", upload.single("file"), async (req, res) => {
  const org = await getPrimaryOrganization();
  const user = await getDefaultUser();

  if (!req.file) {
    return res.status(400).json({ error: "file is required" });
  }
  const uploadedFile = req.file;

  const mode = req.body.mode === "commit" ? "commit" : "dry-run";
  const rows = parseInstacartOrders(uploadedFile.path);
  const ingredients = await prisma.ingredientCatalog.findMany({ where: { organizationId: org.id, active: true } });

  const checksum = crypto.createHash("sha256").update(fs.readFileSync(uploadedFile.path)).digest("hex");
  const idempotencyKey = `INSTACART_IMPORT:${org.id}:${checksum}:${mode}`;
  const idempotency = await ensureIdempotency(
    "INSTACART_ORDER_IMPORT",
    idempotencyKey,
    { checksum, mode, sourceFileName: uploadedFile.originalname }
  );
  if (idempotency.replay && idempotency.existing.responseBody) {
    return res.json({ replay: true, ...(idempotency.existing.responseBody as object) });
  }
  const job = await prisma.importJob.create({
    data: {
      organizationId: org.id,
      jobType: "INSTACART_ORDER",
      mode: mode === "commit" ? "COMMIT" : "DRY_RUN",
      status: "RUNNING",
      sourceFileName: uploadedFile.originalname,
      sourceChecksum: checksum,
      summary: { rows: rows.length },
      createdBy: user.email
    }
  });

  let createdCount = 0;
  let updatedCount = 0;
  const errors: { sheet: string; rowNumber: number | null; code: string; message: string }[] = [];

  if (mode === "commit") {
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i]!;
        const mapping = mapOrderLineToIngredient(
          `${row.brand ?? ""} ${row.productName}`.trim(),
          ingredients.map((x) => ({
            ingredientKey: x.canonicalKey,
            ingredientName: x.name,
            category: x.category,
            defaultUnit: x.defaultUnit,
            allergenTags: x.allergenTags
          }))
        );

        if (!mapping.ingredientKey) {
          const task = await tx.verificationTask.create({
            data: {
              organizationId: org.id,
              taskType: "SOURCE_RETRIEVAL",
              severity: "HIGH",
              status: "OPEN",
              title: `Map Instacart product: ${row.productName}`,
              description: "No deterministic ingredient match met threshold.",
              payload: { row, confidence: mapping.confidence },
              createdBy: "agent"
            }
          });
          errors.push({ sheet: "INSTACART_ORDERS", rowNumber: i + 2, code: "LOW_CONFIDENCE_MAPPING", message: `verification_task=${task.id}` });
          continue;
        }

        const ingredient = await tx.ingredientCatalog.findFirstOrThrow({
          where: { organizationId: org.id, canonicalKey: mapping.ingredientKey }
        });

        const product = await tx.productCatalog.upsert({
          where: {
            organizationId_upc: {
              organizationId: org.id,
              upc: row.upc ?? `NOUPC-${ingredient.id}-${row.productName}`
            }
          },
          update: {
            name: row.productName,
            brand: row.brand,
            vendor: "Instacart",
            version: { increment: 1 }
          },
          create: {
            organizationId: org.id,
            ingredientId: ingredient.id,
            name: row.productName,
            brand: row.brand,
            upc: row.upc ?? `NOUPC-${ingredient.id}-${row.productName}`,
            vendor: "Instacart",
            createdBy: user.email
          }
        });

        const totalGrams = row.qty * row.gramsPerUnit;
        const lot = await tx.inventoryLot.create({
          data: {
            organizationId: org.id,
            productId: product.id,
            lotCode: null,
            receivedAt: row.orderedAt,
            expiresAt: addHours(row.orderedAt, 24 * 10),
            quantityReceivedG: totalGrams,
            quantityAvailableG: totalGrams,
            sourceOrderRef: uploadedFile.originalname,
            createdBy: user.email
          }
        });

        await tx.inventoryLotLedger.create({
          data: {
            inventoryLotId: lot.id,
            deltaG: totalGrams,
            reason: "INSTACART_ORDER_IMPORT",
            referenceId: job.id,
            createdBy: user.email
          }
        });

        const nutrientCount = await tx.productNutrientValue.count({ where: { productId: product.id } });
        if (!nutrientCount) {
          await tx.verificationTask.create({
            data: {
              organizationId: org.id,
              taskType: "SOURCE_RETRIEVAL",
              severity: "CRITICAL",
              status: "OPEN",
              title: `Missing nutrient profile: ${product.name}`,
              description: "Product has no nutrient rows. Human verification required before high-confidence labels.",
              payload: { productId: product.id, productName: product.name },
              createdBy: "agent"
            }
          });
        }

        createdCount += 2;
        if (mapping.confidence < 0.95) {
          updatedCount += 1;
        }
      }

      await tx.importJob.update({
        where: { id: job.id },
        data: {
          status: errors.length ? "PARTIAL" : "SUCCEEDED",
          summary: {
            rows: rows.length,
            createdCount,
            updatedCount,
            errorCount: errors.length
          }
        }
      });

      if (errors.length) {
        await tx.importJobError.createMany({
          data: errors.map((e) => ({
            importJobId: job.id,
            sheetName: e.sheet,
            rowNumber: e.rowNumber,
            errorCode: e.code,
            message: e.message,
            createdBy: user.email
          }))
        });
      }
    });
  } else {
    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: "SUCCEEDED" }
    });
  }

  const response = importResultSchema.parse({
    importJobId: job.id,
    mode,
    status: errors.length ? "PARTIAL" : "SUCCEEDED",
    createdCount,
    updatedCount,
    errorCount: errors.length,
    errors
  });
  await setIdempotencyResponse(idempotencyKey, response);
  return res.json(response);
});

v1Router.post("/instacart/drafts/generate", async (_req, res) => {
  const org = await getPrimaryOrganization();
  const now = new Date();
  const horizon = addHours(now, 72);

  const schedules = await prisma.mealSchedule.findMany({
    where: {
      organizationId: org.id,
      status: "PLANNED",
      serviceDate: { gte: now, lte: horizon }
    },
    include: {
      sku: {
        include: {
          recipes: {
            where: { active: true },
            include: {
              lines: {
                include: {
                  ingredient: true
                }
              }
            }
          }
        }
      }
    }
  });

  const demand = new Map<string, { ingredientName: string; grams: number; skuCodes: Set<string> }>();

  for (const schedule of schedules) {
    const recipe = schedule.sku.recipes[0];
    if (!recipe) continue;
    for (const line of recipe.lines) {
      const grams = line.targetGPerServing * schedule.plannedServings;
      const prev = demand.get(line.ingredientId) ?? {
        ingredientName: line.ingredient.name,
        grams: 0,
        skuCodes: new Set<string>()
      };
      prev.grams += grams;
      prev.skuCodes.add(schedule.sku.code);
      demand.set(line.ingredientId, prev);
    }
  }

  const lots = await prisma.inventoryLot.findMany({
    where: { organizationId: org.id, quantityAvailableG: { gt: 0 } },
    include: { product: true }
  });

  const availableByIngredient = new Map<string, number>();
  for (const lot of lots) {
    const key = lot.product.ingredientId;
    availableByIngredient.set(key, (availableByIngredient.get(key) ?? 0) + lot.quantityAvailableG);
  }

  const items = [...demand.entries()].map(([ingredientId, d]) => {
    const available = availableByIngredient.get(ingredientId) ?? 0;
    const shortage = Math.max(0, d.grams - available);
    return {
      ingredientId,
      ingredientName: d.ingredientName,
      requiredG: Math.round(d.grams),
      availableG: Math.round(available),
      shortageG: Math.round(shortage),
      linkedSkus: [...d.skuCodes],
      instacartProductLink: `https://www.instacart.com/store/search_v3/${encodeURIComponent(d.ingredientName)}`,
      instacartRecipeLink: `https://www.instacart.com/store/recipes?search=${encodeURIComponent(d.ingredientName)}`
    };
  });

  const payload = {
    generatedAt: now.toISOString(),
    horizonHours: 72,
    items: items.filter((x) => x.shortageG > 0).sort((a, b) => b.shortageG - a.shortageG)
  };

  const draft = await prisma.instacartDraft.create({
    data: {
      organizationId: org.id,
      horizonHours: 72,
      draftPayload: payload,
      linkBundle: {
        type: "prefilled_links",
        shoppingLinks: payload.items.map((x) => x.instacartProductLink)
      },
      createdBy: "system"
    }
  });

  return res.json({ id: draft.id, ...payload });
});

v1Router.patch("/schedule/:id/status", async (req, res) => {
  const user = await getDefaultUser();
  const { id } = req.params;
  const { status } = req.body as { status?: "PLANNED" | "DONE" | "SKIPPED" };

  if (!status) {
    return res.status(400).json({ error: "status is required" });
  }

  const schedule = await prisma.mealSchedule.update({
    where: { id },
    data: {
      status,
      version: { increment: 1 }
    }
  });

  let freeze = null;
  try {
    if (status === "DONE") {
      freeze = await freezeLabelFromScheduleDone({
        mealScheduleId: schedule.id,
        servedByUserId: user.id
      });
    }
  } catch (error) {
    // Keep schedule integrity: if freeze fails, restore to PLANNED.
    await prisma.mealSchedule.update({
      where: { id: schedule.id },
      data: {
        status: "PLANNED",
        version: { increment: 1 }
      }
    });
    const message = error instanceof Error ? error.message : "Label freeze failed";
    return res.status(400).json({ error: message });
  }

  return res.json({ scheduleId: schedule.id, status: status === "DONE" && !freeze ? "PLANNED" : schedule.status, freeze });
});

v1Router.get("/clients/:clientId/calendar", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { clientId } = req.params;
  const month = String(req.query.month || new Date().toISOString().slice(0, 7));
  const monthDate = parse(`${month}-01`, "yyyy-MM-dd", new Date());
  const start = startOfMonth(monthDate);
  const end = endOfMonth(monthDate);

  const events = await prisma.mealServiceEvent.findMany({
    where: {
      organizationId: org.id,
      clientId,
      servedAt: { gte: start, lte: end }
    },
    include: {
      sku: true,
      finalLabelSnapshot: true
    },
    orderBy: { servedAt: "asc" }
  });

  return res.json({
    month,
    clientId,
    events: events.map((e) => ({
      id: e.id,
      servedAt: e.servedAt,
      sku: { id: e.sku.id, code: e.sku.code, name: e.sku.name },
      finalLabelSnapshotId: e.finalLabelSnapshotId
    }))
  });
});

v1Router.get("/meals/:serviceEventId", async (req, res) => {
  const { serviceEventId } = req.params;
  const event = await prisma.mealServiceEvent.findUnique({
    where: { id: serviceEventId },
    include: {
      client: true,
      sku: true,
      mealSchedule: true,
      servedBy: true,
      finalLabelSnapshot: true,
      lotConsumptions: {
        include: {
          inventoryLot: {
            include: {
              product: true
            }
          },
          recipeLine: {
            include: {
              ingredient: true
            }
          }
        }
      }
    }
  });

  if (!event) {
    return res.status(404).json({ error: "Meal service event not found" });
  }

  return res.json({
    id: event.id,
    servedAt: event.servedAt,
    servedBy: event.servedBy.fullName,
    client: { id: event.client.id, name: event.client.fullName },
    sku: { id: event.sku.id, code: event.sku.code, name: event.sku.name },
    schedule: {
      id: event.mealSchedule.id,
      serviceDate: event.mealSchedule.serviceDate,
      mealSlot: event.mealSchedule.mealSlot,
      status: event.mealSchedule.status
    },
    finalLabelSnapshotId: event.finalLabelSnapshotId,
    consumedLots: event.lotConsumptions.map((x) => ({
      gramsConsumed: x.gramsConsumed,
      ingredient: x.recipeLine.ingredient.name,
      product: x.inventoryLot.product.name,
      lotId: x.inventoryLot.id
    }))
  });
});

v1Router.get("/labels/:labelId", async (req, res) => {
  const { labelId } = req.params;
  const label = await prisma.labelSnapshot.findUnique({ where: { id: labelId } });
  if (!label) {
    return res.status(404).json({ error: "Label not found" });
  }
  return res.json(label);
});

v1Router.get("/labels/:labelId/lineage", async (req, res) => {
  const { labelId } = req.params;
  const tree = await buildLineageTree(labelId);
  if (!tree) {
    return res.status(404).json({ error: "Label not found" });
  }
  return res.json(tree);
});

v1Router.get("/verification/tasks", async (_req, res) => {
  const org = await getPrimaryOrganization();
  const tasks = await prisma.verificationTask.findMany({
    where: { organizationId: org.id },
    orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
    include: { reviews: true }
  });

  const parsed = tasks.map((task) =>
    verificationTaskSchema.parse({
      id: task.id,
      taskType: task.taskType,
      severity: task.severity,
      status: task.status,
      title: task.title,
      description: task.description,
      payload: task.payload
    })
  );

  return res.json({ tasks: parsed });
});

v1Router.patch("/verification/tasks/:id", async (req, res) => {
  const user = await getDefaultUser();
  const { id } = req.params;
  const { status, decision, notes } = req.body as {
    status?: "APPROVED" | "REJECTED" | "RESOLVED";
    decision?: string;
    notes?: string;
  };

  if (!status || !decision) {
    return res.status(400).json({ error: "status and decision are required" });
  }

  const task = await prisma.verificationTask.update({
    where: { id },
    data: {
      status,
      version: { increment: 1 }
    }
  });

  await prisma.verificationReview.create({
    data: {
      verificationTaskId: task.id,
      reviewedByUserId: user.id,
      decision,
      notes,
      createdBy: user.email
    }
  });

  if (status === "APPROVED") {
    // Mark product nutrient values as verified when explicitly reviewed.
    const productId = (task.payload as any)?.productId;
    if (productId) {
      await prisma.productNutrientValue.updateMany({
        where: { productId },
        data: { verificationStatus: VerificationStatus.VERIFIED, version: { increment: 1 } }
      });
    }
  }

  return res.json({ id: task.id, status: task.status });
});
