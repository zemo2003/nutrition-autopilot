import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import express from "express";
import multer from "multer";
import { addHours, endOfMonth, parse, startOfMonth, subDays, startOfDay, endOfDay, format } from "date-fns";
import { prisma, NutrientSourceType, VerificationStatus, VerificationTaskStatus, VerificationTaskSeverity, ScheduleStatus, BatchStatus, ComponentType, StorageLocation, SauceVariantType, BatchCheckpointType, MappingResolutionSource, SubstitutionStatus, CalibrationStatus, QcIssueType, MealSource, PrepDraftStatus, DocumentType, ParsingStatus, MetricVerification, FulfillmentStatus, RouteStatus } from "@nutrition/db";
import { parseInstacartOrders, parsePilotMeals, parseSotWorkbook, mapOrderLineToIngredient } from "@nutrition/importers";
import { getDefaultUser, getPrimaryOrganization } from "../lib/context.js";
import { freezeLabelFromScheduleDone, buildLineageTree } from "../lib/label-freeze.js";
import { ensureIdempotency, setIdempotencyResponse } from "../lib/idempotency.js";
import { computeInventoryProjections, computeDemandForecast, computeWasteSummary, computeAllocationSummary } from "../lib/inventory-projections.js";
import { runPilotBackfill } from "../lib/pilot-backfill.js";
import {
  importResultSchema,
  verificationTaskSchema,
  createBatchBodySchema,
  updateBatchStatusBodySchema,
  inventoryAdjustBodySchema,
  updateVerificationTaskBodySchema,
  createScheduleBodySchema,
  updateScheduleStatusBodySchema,
  bulkScheduleStatusBodySchema,
  updateClientBodySchema,
  createBodyCompositionBodySchema,
  createCheckpointBodySchema,
  createSauceVariantBodySchema,
  createSaucePairingBodySchema,
  updateParLevelsBodySchema,
  createYieldCalibrationBodySchema,
  reviewYieldCalibrationBodySchema,
  createQcIssueBodySchema,
  overrideQcIssueBodySchema,
  createBiometricBodySchema,
  createMetricBodySchema,
  generateFulfillmentBodySchema,
  updateFulfillmentStatusBodySchema,
  createRouteBodySchema,
  updateRouteBodySchema,
  addRouteStopsBodySchema,
  reorderRouteStopsBodySchema,
  mealPlanPushBodySchema,
} from "@nutrition/contracts";
import { requireApiKey } from "../lib/auth.js";
import { buildOpenApiSpec } from "../lib/openapi-spec.js";
import { z } from "zod";

const upload = multer({ dest: "/tmp" });
const execFile = promisify(execFileCb);

/** Validate request body against a Zod schema; returns parsed data or sends 400. */
function validateBody<T extends z.ZodTypeAny>(
  schema: T,
  body: unknown,
  res: express.Response
): z.infer<T> | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    res.status(400).json({
      error: "Validation failed",
      details: result.error.flatten(),
    });
    return null;
  }
  return result.data;
}

export const v1Router = express.Router();

const coreNutrientKeyMap = [
  { key: "kcal", field: "kcal" },
  { key: "protein_g", field: "proteinG" },
  { key: "carb_g", field: "carbG" },
  { key: "fat_g", field: "fatG" },
  { key: "sodium_mg", field: "sodiumMg" }
] as const;

function hasAnyHintedNutrients(row: ReturnType<typeof parseInstacartOrders>[number]): boolean {
  return coreNutrientKeyMap.some((x) => {
    const value = row.nutrientHints[x.field];
    return typeof value === "number" && Number.isFinite(value);
  });
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(lowered)) return true;
    if (["0", "false", "no", "n", "off"].includes(lowered)) return false;
  }
  return fallback;
}

function monthBounds(month: string): { start: Date; end: Date } {
  const normalized = /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
  const monthDate = parse(`${normalized}-01`, "yyyy-MM-dd", new Date());
  return {
    start: startOfMonth(monthDate),
    end: endOfMonth(monthDate)
  };
}

async function runJsonScript(scriptRelativePath: string, args: string[]) {
  const scriptPath = path.resolve(process.cwd(), scriptRelativePath);
  const { stdout, stderr } = await execFile("python3", [scriptPath, ...args], {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 1024 * 1024 * 25
  });

  const output = stdout.trim();
  if (!output) {
    throw new Error(`Script ${scriptRelativePath} returned empty output. stderr=${stderr}`);
  }

  try {
    return JSON.parse(output) as Record<string, unknown>;
  } catch {
    throw new Error(`Script ${scriptRelativePath} did not return JSON. stderr=${stderr}\\nstdout=${output}`);
  }
}

// In-memory enrichment status tracking (keyed by importJobId)
const enrichmentJobs = new Map<string, {
  status: "PROCESSING" | "COMPLETED" | "FAILED";
  startedAt: string;
  finishedAt?: string;
  summary?: Record<string, unknown>;
  error?: string;
}>();

// Fire-and-forget enrichment after an import completes
async function triggerEnrichmentAsync(importJobId: string, orgSlug: string, month: string) {
  enrichmentJobs.set(importJobId, {
    status: "PROCESSING",
    startedAt: new Date().toISOString(),
  });

  try {
    const enrichment = await runJsonScript("scripts/agent_nutrient_enrichment.py", [
      "--organization-slug", orgSlug,
      "--month", month,
      "--all-products",
      "--source-policy", "MAX_COVERAGE",
      "--historical-mode", "true",
    ]);

    enrichmentJobs.set(importJobId, {
      status: "COMPLETED",
      startedAt: enrichmentJobs.get(importJobId)!.startedAt,
      finishedAt: new Date().toISOString(),
      summary: enrichment,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[enrichment] Failed for import ${importJobId}: ${message}`);
    enrichmentJobs.set(importJobId, {
      status: "FAILED",
      startedAt: enrichmentJobs.get(importJobId)!.startedAt,
      finishedAt: new Date().toISOString(),
      error: message,
    });
  }
}

v1Router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "nutrition-autopilot-api", version: "v1" });
});

v1Router.get("/imports/:jobId/enrichment-status", (req, res) => {
  const { jobId } = req.params;
  const status = enrichmentJobs.get(jobId);
  if (!status) {
    return res.json({ status: "NOT_STARTED" });
  }
  return res.json(status);
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
      timezone: c.timezone,
      email: c.email ?? null,
      phone: c.phone ?? null,
      externalRef: c.externalRef ?? null,
      deliveryAddressHome: c.deliveryAddressHome ?? null,
      deliveryAddressWork: c.deliveryAddressWork ?? null,
      deliveryNotes: c.deliveryNotes ?? null,
      deliveryZone: c.deliveryZone ?? null,
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
        ingredients: parsed.ingredients.length,
        weeklySchedule: parsed.weeklySchedule.length
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
    // Phase 1: Upsert ingredients, SKUs, recipes inside a transaction
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
    }, { timeout: 30000 });

    // Phase 2: Create PLANNED schedules OUTSIDE the transaction
    // (idempotent with dedup — safe to run separately)
    let schedulesCreated = 0;
    let schedulesSkipped = 0;
    if (parsed.weeklySchedule.length > 0) {
      // Resolve/create clients by name
      const clientIdByName = new Map<string, string>();
      for (const entry of parsed.weeklySchedule) {
        if (clientIdByName.has(entry.clientName)) continue;
        const existing = await prisma.client.findFirst({
          where: { organizationId: org.id, fullName: entry.clientName },
        });
        if (existing) {
          clientIdByName.set(entry.clientName, existing.id);
        } else {
          const created = await prisma.client.create({
            data: {
              organizationId: org.id,
              fullName: entry.clientName,
              externalRef: entry.clientName.toUpperCase().replace(/[^A-Z0-9]+/g, "-"),
              createdBy: user.email,
            },
          });
          clientIdByName.set(entry.clientName, created.id);
          createdCount += 1;
        }
      }

      for (const entry of parsed.weeklySchedule) {
        const sku = await prisma.sku.findFirst({
          where: { organizationId: org.id, code: entry.skuCode },
        });
        if (!sku) continue; // Already validated by parser

        const clientId = clientIdByName.get(entry.clientName);
        if (!clientId) continue;

        const serviceDate = parseDateOnlyUtc(entry.serviceDate);

        // Dedup: skip if identical schedule already exists
        const dup = await prisma.mealSchedule.findFirst({
          where: {
            organizationId: org.id,
            clientId,
            skuId: sku.id,
            serviceDate,
            mealSlot: entry.mealSlot,
          },
        });
        if (dup) {
          schedulesSkipped += 1;
          continue;
        }

        await prisma.mealSchedule.create({
          data: {
            organizationId: org.id,
            clientId,
            skuId: sku.id,
            serviceDate,
            mealSlot: entry.mealSlot,
            plannedServings: entry.servings,
            status: "PLANNED",
            createdBy: user.email,
          },
        });
        schedulesCreated += 1;
        createdCount += 1;
      }
    }

    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: "SUCCEEDED",
        summary: {
          ...(job.summary as object),
          createdCount,
          updatedCount,
          schedulesCreated,
          schedulesSkipped,
          errors: parsed.errors.length
        }
      }
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

  // Auto-trigger nutrient enrichment in background on successful commit imports
  if (mode === "commit" && !parsed.errors.length) {
    const currentMonth = new Date().toISOString().slice(0, 7);
    triggerEnrichmentAsync(job.id, org.slug, currentMonth).catch(() => {});
  }

  return res.json({ ...response, enrichmentStatus: mode === "commit" && !parsed.errors.length ? "PROCESSING" : undefined });
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
    const ingredientKeySet = new Set(ingredients.map((x) => x.canonicalKey));

    await prisma.$transaction(async (tx) => {
      const coreNutrientDefinitions = await tx.nutrientDefinition.findMany({
        where: { key: { in: coreNutrientKeyMap.map((x) => x.key) } }
      });
      const nutrientDefinitionByKey = new Map(coreNutrientDefinitions.map((x) => [x.key, x]));

      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i]!;
        let resolvedIngredientKey: string | null = null;
        let mappingConfidence = 1;

        if (row.ingredientKeyHint) {
          if (!ingredientKeySet.has(row.ingredientKeyHint)) {
            const createdIngredient = await tx.ingredientCatalog.create({
              data: {
                organizationId: org.id,
                canonicalKey: row.ingredientKeyHint,
                name: row.ingredientNameHint ?? row.productName,
                category: "UNMAPPED",
                defaultUnit: "g",
                allergenTags: [],
                createdBy: "agent"
              }
            });
            ingredientKeySet.add(createdIngredient.canonicalKey);
            ingredients.push(createdIngredient);

            await tx.verificationTask.create({
              data: {
                organizationId: org.id,
                taskType: "SOURCE_RETRIEVAL",
                severity: "MEDIUM",
                status: "OPEN",
                title: `Review auto-created ingredient: ${createdIngredient.name}`,
                description: "Created from inventory hint key; requires taxonomy/allergen validation.",
                payload: {
                  ingredientId: createdIngredient.id,
                  canonicalKey: createdIngredient.canonicalKey,
                  source: "inventory_import_hint"
                },
                createdBy: "agent"
              }
            });
          }

          resolvedIngredientKey = row.ingredientKeyHint;
        } else {
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
          resolvedIngredientKey = mapping.ingredientKey;
          mappingConfidence = mapping.confidence;
        }

        if (!resolvedIngredientKey) {
          const task = await tx.verificationTask.create({
            data: {
              organizationId: org.id,
              taskType: "SOURCE_RETRIEVAL",
              severity: "HIGH",
              status: "OPEN",
              title: `Map Instacart product: ${row.productName}`,
              description: "No deterministic ingredient match met threshold.",
              payload: { row, confidence: mappingConfidence, ingredientKeyHint: row.ingredientKeyHint },
              createdBy: "agent"
            }
          });
          errors.push({
            sheet: "INSTACART_ORDERS",
            rowNumber: i + 2,
            code: "LOW_CONFIDENCE_MAPPING",
            message: `verification_task=${task.id}`
          });
          continue;
        }

        const ingredient = await tx.ingredientCatalog.findFirstOrThrow({
          where: { organizationId: org.id, canonicalKey: resolvedIngredientKey }
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
            vendor: "ImportedCSV",
            version: { increment: 1 }
          },
          create: {
            organizationId: org.id,
            ingredientId: ingredient.id,
            name: row.productName,
            brand: row.brand,
            upc: row.upc ?? `NOUPC-${ingredient.id}-${row.productName}`,
            vendor: "ImportedCSV",
            createdBy: user.email
          }
        });

        const totalGrams = row.qty * row.gramsPerUnit;
        const unitCostCents =
          typeof row.unitPriceUsd === "number" && Number.isFinite(row.unitPriceUsd)
            ? Math.round(row.unitPriceUsd * 100)
            : typeof row.lineTotalUsd === "number" && Number.isFinite(row.lineTotalUsd) && row.qty > 0
              ? Math.round((row.lineTotalUsd / row.qty) * 100)
              : null;

        const lot = await tx.inventoryLot.create({
          data: {
            organizationId: org.id,
            productId: product.id,
            lotCode: row.lotCode,
            receivedAt: row.orderedAt,
            expiresAt: row.expiresAt ?? addHours(row.orderedAt, 24 * 10),
            quantityReceivedG: totalGrams,
            quantityAvailableG: totalGrams,
            unitCostCents,
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

        if (hasAnyHintedNutrients(row)) {
          for (const nutrient of coreNutrientKeyMap) {
            const value = row.nutrientHints[nutrient.field];
            if (typeof value !== "number" || !Number.isFinite(value)) continue;
            const def = nutrientDefinitionByKey.get(nutrient.key);
            if (!def) continue;

            await tx.productNutrientValue.upsert({
              where: {
                productId_nutrientDefinitionId: {
                  productId: product.id,
                  nutrientDefinitionId: def.id
                }
              },
              update: {
                valuePer100g: value,
                sourceType: row.nutrientSourceTypeHint ?? NutrientSourceType.MANUAL,
                sourceRef: row.nutrientSourceRefHint ?? `${uploadedFile.originalname}:row:${i + 2}`,
                verificationStatus: VerificationStatus.NEEDS_REVIEW,
                version: { increment: 1 }
              },
              create: {
                productId: product.id,
                nutrientDefinitionId: def.id,
                valuePer100g: value,
                sourceType: row.nutrientSourceTypeHint ?? NutrientSourceType.MANUAL,
                sourceRef: row.nutrientSourceRefHint ?? `${uploadedFile.originalname}:row:${i + 2}`,
                verificationStatus: VerificationStatus.NEEDS_REVIEW,
                createdBy: "agent"
              }
            });
            updatedCount += 1;
          }
        }

        const coreNutrientCount = await tx.productNutrientValue.count({
          where: {
            productId: product.id,
            valuePer100g: { not: null },
            nutrientDefinition: { key: { in: ["kcal", "protein_g", "carb_g", "fat_g"] } }
          }
        });
        if (coreNutrientCount < 4) {
          const existingMissingTask = await tx.verificationTask.findFirst({
            where: {
              organizationId: org.id,
              taskType: "SOURCE_RETRIEVAL",
              status: "OPEN",
              payload: {
                path: ["productId"],
                equals: product.id
              }
            }
          });
          if (!existingMissingTask) {
            await tx.verificationTask.create({
              data: {
                organizationId: org.id,
                taskType: "SOURCE_RETRIEVAL",
                severity: "CRITICAL",
                status: "OPEN",
                title: `Missing nutrient profile: ${product.name}`,
                description: "Product has no complete core macro nutrient rows. Human verification required.",
                payload: { productId: product.id, productName: product.name, source: "import" },
                createdBy: "agent"
              }
            });
          }
        }

        createdCount += 2;
        if (mappingConfidence < 0.95 || !!row.ingredientKeyHint) {
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
    }, { timeout: 60000 });
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

  // Auto-trigger nutrient enrichment in background on successful commit imports
  if (mode === "commit") {
    const currentMonth = new Date().toISOString().slice(0, 7);
    triggerEnrichmentAsync(job.id, org.slug, currentMonth).catch(() => {});
  }

  return res.json({ ...response, enrichmentStatus: mode === "commit" ? "PROCESSING" : undefined });
});

v1Router.post(
  "/pilot/backfill-week",
  upload.fields([
    { name: "meal_file", maxCount: 1 },
    { name: "lot_file", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const org = await getPrimaryOrganization();
      const user = await getDefaultUser();
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const mealFile = files?.meal_file?.[0];
      const lotFile = files?.lot_file?.[0];

      if (!mealFile) {
        return res.status(400).json({ error: "meal_file is required" });
      }

      const mode = req.body.mode === "dry-run" ? "dry-run" : "commit";
      const historicalMode = parseBoolean(req.body.historicalMode, false);
      const weekStartDate = typeof req.body.week_start_date === "string" ? req.body.week_start_date : undefined;
      const clientExternalRef =
        typeof req.body.client_external_ref === "string" ? req.body.client_external_ref : undefined;
      const clientName = typeof req.body.client_name === "string" ? req.body.client_name : undefined;

      const mealParsed = parsePilotMeals(mealFile.path, {
        weekStartDate,
        defaultClientExternalRef: clientExternalRef,
        defaultClientName: clientName
      });

      const purchaseDate = typeof req.body.purchase_date === "string" ? req.body.purchase_date : undefined;
      const lotSheetName = typeof req.body.lot_sheet_name === "string" ? req.body.lot_sheet_name : undefined;
      const fallbackOrderedAt = parseDateOnlyUtc(
        purchaseDate ?? mealParsed.rows[0]?.serviceDate.toISOString().slice(0, 10) ?? new Date().toISOString().slice(0, 10)
      );

      let lotRows = lotFile
        ? parseInstacartOrders(lotFile.path, {
            sheetName: lotSheetName,
            defaultOrderedAt: fallbackOrderedAt
          })
        : [];

      if (lotFile && lotRows.length === 0 && !lotSheetName) {
        lotRows = parseInstacartOrders(lotFile.path, {
          sheetName: "Walmart_Receipt",
          defaultOrderedAt: fallbackOrderedAt
        });
      }

      const parseErrors = mealParsed.errors;
      if (parseErrors.length > 0) {
        return res.status(400).json({
          error: "Meal import parse validation failed",
          errorCount: parseErrors.length,
          errors: parseErrors
        });
      }
      if (mealParsed.rows.length === 0) {
        return res.status(400).json({ error: "No meal rows found in meal_file" });
      }

      const payloadChecksum = crypto
        .createHash("sha256")
        .update(fs.readFileSync(mealFile.path))
        .update(lotFile ? fs.readFileSync(lotFile.path) : "")
        .update(weekStartDate ?? "")
        .update(clientExternalRef ?? "")
        .digest("hex");
      const idempotencyKey = `PILOT_BACKFILL:${org.id}:${payloadChecksum}:${mode}`;
      const idempotency = await ensureIdempotency("PILOT_BACKFILL", idempotencyKey, {
        mode,
        weekStartDate,
        clientExternalRef,
        clientName,
        mealRows: mealParsed.rows.length,
        lotRows: lotRows.length,
        mealFileName: mealFile.originalname,
        lotFileName: lotFile?.originalname ?? null
      });

      if (idempotency.replay && idempotency.existing.responseBody) {
        return res.json({ replay: true, ...(idempotency.existing.responseBody as object) });
      }

      if (mode === "dry-run") {
        const mealDays = new Set(mealParsed.rows.map((row) => row.serviceDate.toISOString().slice(0, 10)));
        const skuCodes = new Set(mealParsed.rows.map((row) => row.skuCode));
        const ingredientKeys = new Set(mealParsed.rows.map((row) => row.ingredientKey));
        const dryRunResponse = {
          mode,
          status: "SUCCEEDED",
          counts: {
            mealRows: mealParsed.rows.length,
            lotRows: lotRows.length,
            serviceDays: mealDays.size,
            skus: skuCodes.size,
            ingredients: ingredientKeys.size
          },
          warnings: lotRows.length === 0 ? ["No lot rows parsed; synthetic lots would be created on commit."] : []
        };
        await setIdempotencyResponse(idempotencyKey, dryRunResponse);
        return res.json(dryRunResponse);
      }

      const run = await runPilotBackfill({
        organizationId: org.id,
        servedByUserId: user.id,
        createdBy: user.email,
        mealRows: mealParsed.rows,
        lotRows,
        sourceOrderRef: lotFile?.originalname ?? mealFile.originalname,
        historicalMode
      });

      const response = {
        mode,
        status: run.freezeErrors.length ? "PARTIAL" : "SUCCEEDED",
        ...run
      };
      await setIdempotencyResponse(idempotencyKey, response);
      return res.json(response);
    } catch (error) {
      console.error("pilot backfill failed", error);
      return res.status(500).json({
        error: "Pilot backfill failed",
        detail: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
);

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
    if (!schedule.sku) continue;
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

function parseDateOnlyUtc(input: string): Date {
  const normalized = input.trim().slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) return new Date();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return new Date();
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
}

// ── Schedules ─────────────────────────────────────────────────

v1Router.get("/schedules", async (req, res) => {
  const org = await getPrimaryOrganization();
  const statusRaw = typeof req.query.status === "string" ? req.query.status.toUpperCase() : undefined;
  const status = statusRaw && Object.values(ScheduleStatus).includes(statusRaw as ScheduleStatus)
    ? (statusRaw as ScheduleStatus) : undefined;
  const clientId = typeof req.query.clientId === "string" ? req.query.clientId : undefined;
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;

  const schedules = await prisma.mealSchedule.findMany({
    where: {
      organizationId: org.id,
      ...(status ? { status } : {}),
      ...(clientId ? { clientId } : {}),
      ...(from || to
        ? {
            serviceDate: {
              ...(from ? { gte: parseDateOnlyUtc(from) } : {}),
              ...(to ? { lte: parseDateOnlyUtc(to) } : {}),
            },
          }
        : {}),
    },
    include: {
      sku: {
        include: {
          recipes: {
            where: { active: true },
            take: 1,
            include: {
              lines: {
                include: { ingredient: true },
                orderBy: { lineOrder: "asc" },
              },
            },
          },
        },
      },
      client: true,
      serviceEvent: {
        select: { id: true, finalLabelSnapshotId: true },
      },
    },
    orderBy: [{ serviceDate: "asc" }, { mealSlot: "asc" }],
  });

  return res.json({
    schedules: schedules.map((s) => {
      const recipe = s.sku?.recipes[0];
      return {
        id: s.id,
        clientId: s.clientId,
        clientName: s.client.fullName,
        skuId: s.skuId,
        skuName: s.sku?.name ?? null,
        skuCode: s.sku?.code ?? null,
        servingSizeG: s.sku?.servingSizeG ?? null,
        serviceDate: s.serviceDate.toISOString().slice(0, 10),
        mealSlot: s.mealSlot,
        status: s.status,
        plannedServings: s.plannedServings,
        serviceEventId: s.serviceEvent?.id ?? null,
        finalLabelSnapshotId: s.serviceEvent?.finalLabelSnapshotId ?? null,
        recipeLines: recipe
          ? recipe.lines.map((l) => ({
              ingredientName: l.ingredient.name,
              category: l.ingredient.category.toLowerCase(),
              gramsPerServing: l.targetGPerServing,
              preparation: l.preparation,
            }))
          : [],
      };
    }),
  });
});

v1Router.post("/schedules", async (req, res) => {
  const org = await getPrimaryOrganization();
  const user = await getDefaultUser();
  const items = Array.isArray(req.body?.items) ? req.body.items : [];

  if (items.length === 0) {
    return res.status(400).json({ error: "items array is required and must not be empty" });
  }

  let created = 0;
  let skipped = 0;
  const errors: Array<{ index: number; message: string }> = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const skuCode = typeof item.skuCode === "string" ? item.skuCode : null;
    const clientId = typeof item.clientId === "string" ? item.clientId : null;
    const serviceDate = typeof item.serviceDate === "string" ? item.serviceDate : null;
    const mealSlot = typeof item.mealSlot === "string" ? item.mealSlot : null;
    const servings = typeof item.servings === "number" ? item.servings : 1;
    const notes = typeof item.notes === "string" ? item.notes : null;

    if (!skuCode || !clientId || !serviceDate || !mealSlot) {
      errors.push({ index: i, message: "skuCode, clientId, serviceDate, and mealSlot are required" });
      continue;
    }

    const sku = await prisma.sku.findFirst({
      where: { organizationId: org.id, code: skuCode },
    });
    if (!sku) {
      errors.push({ index: i, message: `SKU not found: ${skuCode}` });
      continue;
    }

    // Dedup: skip if identical schedule already exists
    const existing = await prisma.mealSchedule.findFirst({
      where: {
        organizationId: org.id,
        clientId,
        skuId: sku.id,
        serviceDate: parseDateOnlyUtc(serviceDate),
        mealSlot,
      },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    await prisma.mealSchedule.create({
      data: {
        organizationId: org.id,
        clientId,
        skuId: sku.id,
        serviceDate: parseDateOnlyUtc(serviceDate),
        mealSlot,
        plannedServings: servings,
        status: "PLANNED",
        notes,
        createdBy: user.email,
      },
    });
    created += 1;
  }

  return res.json({ created, skipped, errors });
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
  let freezeWarning: string | null = null;

  if (status === "DONE") {
    try {
      freeze = await freezeLabelFromScheduleDone({
        mealScheduleId: schedule.id,
        servedByUserId: user.id
      });
    } catch (error) {
      freezeWarning = error instanceof Error ? error.message : "Label freeze failed";
    }
  }

  return res.json({
    scheduleId: schedule.id,
    status: schedule.status,
    freeze,
    freezeWarning,
  });
});

// ── Bulk schedule status update ──────────────────────────────────────────────
v1Router.post("/schedules/bulk-status", async (req, res) => {
  const parsed = validateBody(bulkScheduleStatusBodySchema, req.body, res);
  if (!parsed) return;
  const { scheduleIds, status } = parsed;
  const user = await getDefaultUser();

  const freezeWarnings: string[] = [];
  let updated = 0;

  try {
    await prisma.$transaction(async (tx) => {
      for (const id of scheduleIds) {
        const schedule = await tx.mealSchedule.findUnique({ where: { id } });
        if (!schedule) {
          freezeWarnings.push(`Schedule ${id} not found — skipped`);
          continue;
        }
        if (schedule.status === status) {
          // Already in the target status — idempotent, skip
          continue;
        }

        await tx.mealSchedule.update({
          where: { id },
          data: { status, version: { increment: 1 } },
        });
        updated += 1;

        if (status === "DONE") {
          try {
            await freezeLabelFromScheduleDone({
              mealScheduleId: id,
              servedByUserId: user.id,
            });
          } catch (error) {
            freezeWarnings.push(
              `Label freeze for ${id}: ${error instanceof Error ? error.message : "failed"}`
            );
          }
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: "Bulk status update failed",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }

  return res.json({ updated, freezeWarnings });
});

// ── Label preview for a schedule (pre-service validation) ────────────────────
v1Router.get("/schedules/:id/label-preview", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { id } = req.params;

  const schedule = await prisma.mealSchedule.findFirst({
    where: { id, organizationId: org.id },
    include: { sku: true },
  });
  if (!schedule) {
    return res.status(404).json({ error: "Schedule not found" });
  }
  if (!schedule.skuId) {
    return res.json({ warnings: ["No SKU assigned to this schedule"], labelId: null, provisional: true });
  }

  // Find latest label for this SKU
  const latestLabel = await prisma.labelSnapshot.findFirst({
    where: {
      organizationId: org.id,
      labelType: "SKU",
      externalRefId: schedule.skuId,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  if (!latestLabel) {
    return res.json({ warnings: ["No label exists for this SKU yet"], labelId: null, provisional: true });
  }

  const payload = (latestLabel.renderPayload ?? {}) as Record<string, unknown>;
  const evidenceSummary = (payload.evidenceSummary ?? null) as Record<string, unknown> | null;
  const provisional = Boolean(payload.provisional ?? evidenceSummary?.provisional ?? false);
  const qa = (payload.qa ?? null) as Record<string, unknown> | null;

  const warnings: string[] = [];

  if (provisional) {
    warnings.push("Label is provisional — not all data is verified");
  }

  if (qa && qa.pass === false) {
    const pctError = typeof qa.percentError === "number" ? qa.percentError.toFixed(1) : "?";
    warnings.push(`QA check failed — ${pctError}% calorie discrepancy`);
  }

  if (evidenceSummary) {
    const unverified = Number(evidenceSummary.unverifiedCount ?? 0);
    const inferred = Number(evidenceSummary.inferredCount ?? 0);
    const exceptions = Number(evidenceSummary.exceptionCount ?? 0);
    if (unverified > 0) warnings.push(`${unverified} unverified nutrient source(s)`);
    if (inferred > 0) warnings.push(`${inferred} inferred nutrient value(s)`);
    if (exceptions > 0) warnings.push(`${exceptions} historical exception(s)`);
  }

  return res.json({
    labelId: latestLabel.id,
    skuName: schedule.sku?.name ?? null,
    provisional,
    warnings,
  });
});

v1Router.get("/clients/:clientId/calendar", async (req, res) => {
  const org = await getPrimaryOrganization();
  const clientId = req.params.clientId!;
  const month = String(req.query.month || new Date().toISOString().slice(0, 7));
  const { start, end } = monthBounds(month);

  const events = await prisma.mealServiceEvent.findMany({
    where: {
      organizationId: org.id,
      clientId,
      servedAt: { gte: start, lte: end }
    },
    include: {
      sku: true,
      mealSchedule: true,
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
      mealSlot: e.mealSchedule.mealSlot,
      skuName: e.sku?.name ?? e.mealSchedule.notes ?? "Meal",
      sku: e.sku ? { id: e.sku.id, code: e.sku.code, name: e.sku.name } : null,
      finalLabelSnapshotId: e.finalLabelSnapshotId
    }))
  });
});

v1Router.get("/clients/:clientId/nutrition/weekly", async (req, res) => {
  const org = await getPrimaryOrganization();
  const clientId = req.params.clientId!;
  const dateStr = String(req.query.date || new Date().toISOString().slice(0, 10));
  const anchorDate = parse(dateStr, "yyyy-MM-dd", new Date());
  const weekStart = startOfDay(subDays(anchorDate, 6));
  const weekEnd = endOfDay(anchorDate);

  const events = await prisma.mealServiceEvent.findMany({
    where: {
      organizationId: org.id,
      clientId,
      servedAt: { gte: weekStart, lte: weekEnd }
    },
    include: {
      sku: true,
      mealSchedule: true,
      finalLabelSnapshot: true
    },
    orderBy: { servedAt: "asc" }
  });

  // Build recipe-based macro estimates as fallback for missing/empty labels
  const allSkuIds = [...new Set(events.filter((e) => e.skuId).map((e) => e.skuId!))];

  const recipeEstimates = new Map<string, { proteinG: number; carbG: number; fatG: number; fiberG: number }>();
  if (allSkuIds.length > 0) {
    const recipes = await prisma.recipe.findMany({
      where: { skuId: { in: allSkuIds }, active: true },
      include: {
        lines: {
          include: {
            ingredient: {
              include: {
                products: {
                  where: { active: true },
                  include: {
                    nutrients: { include: { nutrientDefinition: true } }
                  },
                  take: 1
                }
              }
            }
          }
        }
      }
    });
    for (const recipe of recipes) {
      let prot = 0, carb = 0, fat = 0, fiber = 0;
      for (const line of recipe.lines) {
        const product = line.ingredient.products[0];
        if (!product) continue;
        const nMap = new Map<string, number | null>(product.nutrients.map((n) => [n.nutrientDefinition.key, n.valuePer100g]));
        const g = line.targetGPerServing;
        prot += ((nMap.get("protein_g") ?? 0) * g) / 100;
        carb += ((nMap.get("carb_g") ?? 0) * g) / 100;
        fat += ((nMap.get("fat_g") ?? 0) * g) / 100;
        fiber += ((nMap.get("fiber_g") ?? 0) * g) / 100;
      }
      recipeEstimates.set(recipe.skuId, {
        proteinG: Math.round(prot),
        carbG: Math.round(carb),
        fatG: Math.round(fat),
        fiberG: Math.round(fiber)
      });
    }
  }

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayMap = new Map<string, { date: string; dayOfWeek: string; mealCount: number; totalKcal: number; proteinG: number; carbG: number; fatG: number; fiberG: number; meals: { id: string; servedAt: Date; mealSlot: string; skuName: string; kcal: number; proteinG: number; carbG: number; fatG: number; fiberG: number; estimated: boolean }[] }>();

  // Initialize 7 days with zeroes
  for (let i = 6; i >= 0; i--) {
    const d = subDays(anchorDate, i);
    const key = format(d, "yyyy-MM-dd");
    dayMap.set(key, {
      date: key,
      dayOfWeek: dayNames[d.getDay()]!,
      mealCount: 0,
      totalKcal: 0,
      proteinG: 0,
      carbG: 0,
      fatG: 0,
      fiberG: 0,
      meals: []
    });
  }

  for (const e of events) {
    const key = format(e.servedAt, "yyyy-MM-dd");
    const day = dayMap.get(key);
    if (!day) continue;

    const label = e.finalLabelSnapshot?.renderPayload as Record<string, unknown> | null;
    const fda = (label?.roundedFda ?? {}) as Record<string, number>;
    let prot = fda.proteinG ?? 0;
    let carb = fda.carbG ?? 0;
    let fat = fda.fatG ?? 0;
    let fiber = fda.fiberG ?? 0;
    let estimated = false;

    // Fallback: estimate from recipe when label is missing or has all-zero macros
    const labelEmpty = prot === 0 && carb === 0 && fat === 0;
    if (labelEmpty && e.skuId) {
      const est = recipeEstimates.get(e.skuId);
      if (est) {
        const servings = e.mealSchedule.plannedServings;
        prot = Math.round(est.proteinG * servings);
        carb = Math.round(est.carbG * servings);
        fat = Math.round(est.fatG * servings);
        fiber = Math.round(est.fiberG * servings);
        estimated = true;
      }
    }

    // Always derive kcal from macros (Atwater) for consistency
    const kcal = Math.round(prot * 4 + carb * 4 + fat * 9);

    day.mealCount += 1;
    day.totalKcal += kcal;
    day.proteinG += prot;
    day.carbG += carb;
    day.fatG += fat;
    day.fiberG += fiber;
    day.meals.push({
      id: e.id,
      servedAt: e.servedAt,
      mealSlot: e.mealSchedule.mealSlot,
      skuName: e.sku?.name ?? e.mealSchedule.notes ?? "Meal",
      kcal,
      proteinG: prot,
      carbG: carb,
      fatG: fat,
      fiberG: fiber,
      estimated
    });
  }

  const days = Array.from(dayMap.values());
  const daysWithData = days.filter((d) => d.mealCount > 0);
  const totalMeals = days.reduce((s, d) => s + d.mealCount, 0);
  const totalKcal = days.reduce((s, d) => s + d.totalKcal, 0);
  const totalProtein = days.reduce((s, d) => s + d.proteinG, 0);
  const totalCarb = days.reduce((s, d) => s + d.carbG, 0);
  const totalFat = days.reduce((s, d) => s + d.fatG, 0);
  const n = daysWithData.length || 1;

  return res.json({
    clientId,
    weekStart: format(weekStart, "yyyy-MM-dd"),
    weekEnd: format(anchorDate, "yyyy-MM-dd"),
    days,
    summary: {
      totalMeals,
      daysWithData: daysWithData.length,
      avgKcal: Math.round(totalKcal / n),
      avgProteinG: Math.round(totalProtein / n),
      avgCarbG: Math.round(totalCarb / n),
      avgFatG: Math.round(totalFat / n),
      totalKcal,
      totalProteinG: Math.round(totalProtein),
      totalCarbG: Math.round(totalCarb),
      totalFatG: Math.round(totalFat)
    }
  });
});

// ── Per-client nutrition history (30/60/90 day) ──────────────────────────────
v1Router.get("/clients/:clientId/nutrition/history", async (req, res) => {
  const org = await getPrimaryOrganization();
  const clientId = req.params.clientId!;
  const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 365);
  const now = new Date();
  const from = subDays(now, days);

  const events = await prisma.mealServiceEvent.findMany({
    where: { organizationId: org.id, clientId, servedAt: { gte: startOfDay(from), lte: endOfDay(now) } },
    include: { sku: true, finalLabelSnapshot: true },
    orderBy: { servedAt: "asc" },
  });

  // Build daily aggregates
  const dailyMap = new Map<string, { kcal: number; proteinG: number; carbG: number; fatG: number; fiberG: number; mealCount: number }>();
  for (const ev of events) {
    const day = format(ev.servedAt, "yyyy-MM-dd");
    if (!dailyMap.has(day)) dailyMap.set(day, { kcal: 0, proteinG: 0, carbG: 0, fatG: 0, fiberG: 0, mealCount: 0 });
    const entry = dailyMap.get(day)!;
    entry.mealCount++;

    const payload = ev.finalLabelSnapshot?.renderPayload as Record<string, unknown> | null;
    if (payload) {
      const macros = (payload.macros ?? payload) as Record<string, number>;
      const p = Number(macros.proteinG ?? macros.protein_g ?? 0);
      const c = Number(macros.carbG ?? macros.carb_g ?? 0);
      const f = Number(macros.fatG ?? macros.fat_g ?? 0);
      const fi = Number(macros.fiberG ?? macros.fiber_g ?? 0);
      const k = Number(macros.kcal ?? macros.calories ?? (p * 4 + c * 4 + f * 9));
      entry.proteinG += p;
      entry.carbG += c;
      entry.fatG += f;
      entry.fiberG += fi;
      entry.kcal += k;
    }
  }

  // Build weekly rollups
  const dailyData = Array.from(dailyMap.entries()).map(([date, d]) => ({
    date,
    kcal: Math.round(d.kcal),
    proteinG: Math.round(d.proteinG),
    carbG: Math.round(d.carbG),
    fatG: Math.round(d.fatG),
    fiberG: Math.round(d.fiberG),
    mealCount: d.mealCount,
  }));

  // Group by ISO week
  const weekGroups = new Map<string, typeof dailyData>();
  for (const day of dailyData) {
    const d = new Date(day.date + "T12:00:00Z");
    const dayOfWeek = d.getUTCDay();
    const diff = (dayOfWeek === 0 ? -6 : 1) - dayOfWeek;
    const ws = new Date(d);
    ws.setUTCDate(ws.getUTCDate() + diff);
    const key = ws.toISOString().slice(0, 10);
    if (!weekGroups.has(key)) weekGroups.set(key, []);
    weekGroups.get(key)!.push(day);
  }

  const weeks = Array.from(weekGroups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ws, wDays]) => {
      const withData = wDays.filter((d) => d.mealCount > 0);
      const n = withData.length || 1;
      const weDate = new Date(ws + "T12:00:00Z");
      weDate.setUTCDate(weDate.getUTCDate() + 6);
      return {
        weekStart: ws,
        weekEnd: weDate.toISOString().slice(0, 10),
        avgKcal: Math.round(withData.reduce((s, d) => s + d.kcal, 0) / n),
        avgProteinG: Math.round(withData.reduce((s, d) => s + d.proteinG, 0) / n),
        avgCarbG: Math.round(withData.reduce((s, d) => s + d.carbG, 0) / n),
        avgFatG: Math.round(withData.reduce((s, d) => s + d.fatG, 0) / n),
        avgFiberG: Math.round(withData.reduce((s, d) => s + d.fiberG, 0) / n),
        totalMeals: withData.reduce((s, d) => s + d.mealCount, 0),
        daysWithData: withData.length,
      };
    });

  const withData = dailyData.filter((d) => d.mealCount > 0);
  const n = withData.length || 1;
  const summary = {
    periodDays: days,
    totalMeals: withData.reduce((s, d) => s + d.mealCount, 0),
    daysWithData: withData.length,
    avgKcal: Math.round(withData.reduce((s, d) => s + d.kcal, 0) / n),
    avgProteinG: Math.round(withData.reduce((s, d) => s + d.proteinG, 0) / n),
    avgCarbG: Math.round(withData.reduce((s, d) => s + d.carbG, 0) / n),
    avgFatG: Math.round(withData.reduce((s, d) => s + d.fatG, 0) / n),
    avgFiberG: Math.round(withData.reduce((s, d) => s + d.fiberG, 0) / n),
    compliancePct: Math.round((withData.length / days) * 100),
  };

  return res.json({ clientId, days, weeks, summary });
});

// ── Per-client print schedule ────────────────────────────────────────────────
v1Router.get("/clients/:clientId/schedule/print", async (req, res) => {
  const org = await getPrimaryOrganization();
  const clientId = req.params.clientId!;
  const dateStr = typeof req.query.date === "string" ? req.query.date : new Date().toISOString().slice(0, 10);
  const targetDate = parseDateOnlyUtc(dateStr);

  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: org.id },
    select: { id: true, fullName: true, exclusions: true },
  });
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }

  const schedules = await prisma.mealSchedule.findMany({
    where: {
      organizationId: org.id,
      clientId,
      serviceDate: targetDate,
    },
    include: {
      sku: {
        include: {
          recipes: {
            where: { active: true },
            take: 1,
            include: {
              lines: {
                include: { ingredient: true },
                orderBy: { lineOrder: "asc" },
              },
            },
          },
        },
      },
    },
    orderBy: { mealSlot: "asc" },
  });

  const meals = schedules.map((s) => {
    const recipe = s.sku?.recipes[0];
    const allergens = new Set<string>();
    if (recipe) {
      for (const line of recipe.lines) {
        for (const a of line.ingredient.allergenTags) {
          allergens.add(a);
        }
      }
    }

    return {
      id: s.id,
      mealSlot: s.mealSlot,
      skuName: s.sku?.name ?? "Untitled",
      status: s.status,
      servings: s.plannedServings,
      allergens: Array.from(allergens),
      ingredients: recipe
        ? recipe.lines.map((l) => ({
            name: l.ingredient.name,
            gramsPerServing: l.targetGPerServing,
          }))
        : [],
    };
  });

  return res.json({
    clientId,
    clientName: client.fullName,
    exclusions: client.exclusions,
    date: dateStr,
    meals,
  });
});

v1Router.get("/clients/:clientId/calendar/export", async (req, res) => {
  const XLSX = await import("xlsx");
  const org = await getPrimaryOrganization();
  const clientId = req.params.clientId!;
  const month = String(req.query.month || new Date().toISOString().slice(0, 7));
  const { start, end } = monthBounds(month);

  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: org.id }
  });
  const clientName = client?.fullName ?? clientId.slice(0, 8);

  const events = await prisma.mealServiceEvent.findMany({
    where: {
      organizationId: org.id,
      clientId,
      servedAt: { gte: start, lte: end }
    },
    include: {
      sku: true,
      mealSchedule: true,
      finalLabelSnapshot: true,
      lotConsumptions: {
        include: {
          recipeLine: { include: { ingredient: true } },
          inventoryLot: { include: { product: true } }
        }
      }
    },
    orderBy: { servedAt: "asc" }
  });

  const rows: Record<string, unknown>[] = [];
  for (const e of events) {
    const label = e.finalLabelSnapshot?.renderPayload as Record<string, unknown> | null;
    const fda = (label?.roundedFda ?? {}) as Record<string, number>;

    const mealName = e.sku?.name ?? e.mealSchedule.notes ?? "Meal";
    if (e.lotConsumptions.length > 0) {
      for (const lc of e.lotConsumptions) {
        rows.push({
          Client: clientName,
          Date: e.servedAt.toISOString().slice(0, 10),
          Meal: mealName,
          "Meal Slot": e.mealSchedule.mealSlot,
          Ingredient: lc.recipeLine.ingredient.name,
          "Grams Served": Number(lc.gramsConsumed.toFixed(1)),
          Calories: fda.calories ?? "",
          "Protein (g)": fda.proteinG ?? "",
          "Carbs (g)": fda.carbG ?? "",
          "Fat (g)": fda.fatG ?? "",
          "Fiber (g)": fda.fiberG ?? "",
          "Sodium (mg)": fda.sodiumMg ?? "",
          "Cholesterol (mg)": fda.cholesterolMg ?? "",
        });
      }
    } else {
      rows.push({
        Client: clientName,
        Date: e.servedAt.toISOString().slice(0, 10),
        Meal: mealName,
        "Meal Slot": e.mealSchedule.mealSlot,
        Ingredient: "",
        "Grams Served": "",
        Calories: fda.calories ?? "",
        "Protein (g)": fda.proteinG ?? "",
        "Carbs (g)": fda.carbG ?? "",
        "Fat (g)": fda.fatG ?? "",
        "Fiber (g)": fda.fiberG ?? "",
        "Sodium (mg)": fda.sodiumMg ?? "",
        "Cholesterol (mg)": fda.cholesterolMg ?? "",
      });
    }
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Calendar");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="numen-calendar-${month}.xlsx"`);
  return res.send(buf);
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
    sku: event.sku ? { id: event.sku.id, code: event.sku.code, name: event.sku.name } : null,
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
  const org = await getPrimaryOrganization();
  const { labelId } = req.params;
  // TODO: multi-tenant — org filter ensures data isolation
  const label = await prisma.labelSnapshot.findFirst({ where: { id: labelId, organizationId: org.id } });
  if (!label) {
    return res.status(404).json({ error: "Label not found" });
  }

  const payload = (label.renderPayload ?? {}) as Record<string, unknown>;
  const evidenceSummary = (payload.evidenceSummary ?? null) as Record<string, unknown> | null;
  const provisional = Boolean(payload.provisional ?? evidenceSummary?.provisional ?? false);
  const latestForEntity = await prisma.labelSnapshot.findFirst({
    where: {
      organizationId: label.organizationId,
      labelType: label.labelType,
      externalRefId: label.externalRefId
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true }
  });
  const supersededByLabelId =
    latestForEntity && latestForEntity.id !== label.id ? latestForEntity.id : null;

  // Fetch recipe lines from the SKU for recipe breakdown display
  let recipeLines: Array<{ ingredientName: string; category: string; gramsPerServing: number; preparation: string | null }> = [];
  if (label.externalRefId) {
    const recipe = await prisma.recipe.findFirst({
      where: { skuId: label.externalRefId, active: true },
      include: {
        lines: {
          include: { ingredient: true },
          orderBy: { lineOrder: "asc" },
        },
      },
    });
    if (recipe) {
      recipeLines = recipe.lines.map((l) => ({
        ingredientName: l.ingredient.name,
        category: l.ingredient.category.toLowerCase(),
        gramsPerServing: l.targetGPerServing,
        preparation: l.preparation,
      }));
    }
  }

  return res.json({
    ...label,
    provisional,
    evidenceSummary,
    supersededByLabelId,
    isLatest: supersededByLabelId === null,
    recipeLines
  });
});

v1Router.get("/labels/:labelId/lineage", async (req, res) => {
  const { labelId } = req.params;
  const tree = await buildLineageTree(labelId);
  if (!tree) {
    return res.status(404).json({ error: "Label not found" });
  }
  return res.json(tree);
});

v1Router.post("/agents/nutrients/historical-rebuild", async (req, res) => {
  const org = await getPrimaryOrganization();
  const month = typeof req.body?.month === "string" ? req.body.month : new Date().toISOString().slice(0, 7);
  const autoApply = parseBoolean(req.body?.autoApply, true);
  const sourcePolicy = typeof req.body?.sourcePolicy === "string" ? req.body.sourcePolicy : "MAX_COVERAGE";
  const historicalMode = parseBoolean(req.body?.historicalMode, true);

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "month must be YYYY-MM" });
  }
  if (!historicalMode) {
    return res.status(400).json({ error: "historicalMode=true is required for this endpoint" });
  }

  try {
    const cleanup = await runJsonScript("scripts/cleanup_floor_imputation.py", [
      "--organization-slug",
      org.slug,
      "--month",
      month,
      ...(autoApply ? [] : ["--dry-run"])
    ]);

    const enrichment = await runJsonScript("scripts/agent_nutrient_enrichment.py", [
      "--organization-slug",
      org.slug,
      "--month",
      month,
      "--source-policy",
      sourcePolicy,
      "--historical-mode",
      historicalMode ? "true" : "false",
      ...(autoApply ? [] : ["--dry-run"])
    ]);

    return res.json({
      status: "ok",
      month,
      autoApply,
      sourcePolicy,
      historicalMode,
      cleanup,
      enrichment
    });
  } catch (error) {
    return res.status(500).json({
      error: "historical nutrient rebuild failed",
      detail: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

v1Router.post("/labels/refresh-served", async (req, res) => {
  const org = await getPrimaryOrganization();
  const month = typeof req.body?.month === "string" ? req.body.month : new Date().toISOString().slice(0, 7);
  const onlyFinalEvents = parseBoolean(req.body?.onlyFinalEvents, true);

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "month must be YYYY-MM" });
  }

  try {
    const refresh = await runJsonScript("scripts/agent_refresh_served_labels.py", [
      "--organization-slug",
      org.slug,
      "--month",
      month,
      "--only-final-events",
      onlyFinalEvents ? "true" : "false"
    ]);
    return res.json({
      status: "ok",
      month,
      onlyFinalEvents,
      refresh
    });
  } catch (error) {
    return res.status(500).json({
      error: "served label refresh failed",
      detail: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

v1Router.get("/quality/summary", async (req, res) => {
  const org = await getPrimaryOrganization();
  const month = typeof req.query.month === "string" ? req.query.month : new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "month must be YYYY-MM" });
  }

  const { start, end } = monthBounds(month);
  const [nutrientDefinitionCount, events, openTasks, criticalTasks] = await Promise.all([
    prisma.nutrientDefinition.count(),
    prisma.mealServiceEvent.findMany({
      where: { organizationId: org.id, servedAt: { gte: start, lte: end } },
      select: { id: true, finalLabelSnapshotId: true }
    }),
    prisma.verificationTask.count({ where: { organizationId: org.id, status: "OPEN" } }),
    prisma.verificationTask.count({
      where: { organizationId: org.id, status: "OPEN", severity: { in: ["HIGH", "CRITICAL"] } }
    })
  ]);

  const eventIds = events.map((event) => event.id);
  const finalLabelIds = events
    .map((event) => event.finalLabelSnapshotId)
    .filter((labelId): labelId is string => Boolean(labelId));

  const consumptions = eventIds.length
    ? await prisma.lotConsumptionEvent.findMany({
        where: { mealServiceEventId: { in: eventIds } },
        include: {
          inventoryLot: {
            include: {
              product: true
            }
          }
        }
      })
    : [];

  const productIds = [...new Set(consumptions.map((consumption) => consumption.inventoryLot.productId))];
  const syntheticUsageCount = consumptions.filter((consumption) => {
    const product = consumption.inventoryLot.product;
    return product.vendor === "SYSTEM_SYNTHETIC" || (product.upc ?? "").startsWith("SYNTH-");
  }).length;

  const nutrientRows = productIds.length
    ? await prisma.productNutrientValue.findMany({
        where: { productId: { in: productIds } },
        select: {
          productId: true,
          valuePer100g: true,
          sourceRef: true,
          evidenceGrade: true,
          historicalException: true,
          verificationStatus: true
        }
      })
    : [];

  const finalLabels = finalLabelIds.length
    ? await prisma.labelSnapshot.findMany({
        where: { id: { in: finalLabelIds } },
        select: { id: true, renderPayload: true }
      })
    : [];

  const nonNullByProduct = new Map<string, number>();
  for (const row of nutrientRows) {
    if (typeof row.valuePer100g !== "number") continue;
    nonNullByProduct.set(row.productId, (nonNullByProduct.get(row.productId) ?? 0) + 1);
  }

  const fullCoverageProducts = productIds.filter(
    (productId) => (nonNullByProduct.get(productId) ?? 0) >= nutrientDefinitionCount
  ).length;
  const inferredRows = nutrientRows.filter((row) =>
    ["INFERRED_FROM_INGREDIENT", "INFERRED_FROM_SIMILAR_PRODUCT"].includes(row.evidenceGrade)
  ).length;
  const exceptionRows = nutrientRows.filter(
    (row) => row.historicalException || row.evidenceGrade === "HISTORICAL_EXCEPTION"
  ).length;
  const floorRows = nutrientRows.filter((row) => row.sourceRef === "agent:trace-floor-imputation").length;
  const verifiedRows = nutrientRows.filter((row) => row.verificationStatus === "VERIFIED").length;

  let provisionalLabels = 0;
  let completeLabelNutrientCoverage = 0;
  for (const label of finalLabels) {
    const payload = (label.renderPayload ?? {}) as Record<string, unknown>;
    const perServing = (payload.perServing ?? {}) as Record<string, unknown>;
    const keysWithNumbers = Object.values(perServing).filter((value) => typeof value === "number").length;
    if (keysWithNumbers >= nutrientDefinitionCount) {
      completeLabelNutrientCoverage += 1;
    }
    const evidence = payload.evidenceSummary as Record<string, unknown> | undefined;
    if (payload.provisional === true || evidence?.provisional === true) {
      provisionalLabels += 1;
    }
  }

  return res.json({
    month,
    nutrientDefinitionCount,
    totals: {
      serviceEvents: events.length,
      consumedProducts: productIds.length,
      consumedLots: consumptions.length,
      openVerificationTasks: openTasks,
      criticalOrHighVerificationTasks: criticalTasks
    },
    coverage: {
      productFull40CoverageCount: fullCoverageProducts,
      productFull40CoverageRatio: productIds.length ? fullCoverageProducts / productIds.length : 0,
      finalLabelFull40CoverageCount: completeLabelNutrientCoverage,
      finalLabelFull40CoverageRatio: finalLabels.length ? completeLabelNutrientCoverage / finalLabels.length : 0
    },
    evidence: {
      verifiedRows,
      inferredRows,
      exceptionRows,
      floorRows,
      provisionalLabels,
      totalLabelsServed: finalLabels.length
    },
    syntheticUsage: {
      syntheticLots: syntheticUsageCount,
      totalLots: consumptions.length,
      syntheticLotRatio: consumptions.length > 0 ? syntheticUsageCount / consumptions.length : 0
    }
  });
});

// SR-3: Label staleness detection — find labels whose underlying nutrient data
// has been updated after the label was frozen, indicating the label is stale
v1Router.get("/labels/stale", async (req, res) => {
  const org = await getPrimaryOrganization();

  try {
    // Find all frozen SKU labels with their linked product nutrient updates
    const staleLabels = await prisma.$queryRaw<Array<{
      labelId: string;
      labelTitle: string;
      frozenAt: Date;
      productId: string;
      productName: string;
      nutrientUpdatedAt: Date;
      staleDays: number;
    }>>`
      SELECT
        ls.id AS "labelId",
        ls.title AS "labelTitle",
        ls."frozenAt",
        pc.id AS "productId",
        pc.name AS "productName",
        MAX(pnv."updatedAt") AS "nutrientUpdatedAt",
        EXTRACT(DAY FROM MAX(pnv."updatedAt") - ls."frozenAt")::int AS "staleDays"
      FROM "LabelSnapshot" ls
      JOIN "LabelLineageEdge" lle ON lle."parentLabelId" = ls.id
      JOIN "LabelSnapshot" child ON child.id = lle."childLabelId"
      JOIN "LabelLineageEdge" lle2 ON lle2."parentLabelId" = child.id
      JOIN "LabelSnapshot" prodLabel ON prodLabel.id = lle2."childLabelId"
      JOIN "ProductCatalog" pc ON pc.id = prodLabel."externalRefId"
      JOIN "ProductNutrientValue" pnv ON pnv."productId" = pc.id
      WHERE ls."organizationId" = ${org.id}
        AND ls."labelType" = 'SKU'
        AND ls."frozenAt" IS NOT NULL
        AND pnv."updatedAt" > ls."frozenAt"
      GROUP BY ls.id, ls.title, ls."frozenAt", pc.id, pc.name
      ORDER BY MAX(pnv."updatedAt") DESC
      LIMIT 100
    `;

    return res.json({
      staleCount: staleLabels.length,
      labels: staleLabels,
      staleLabels: staleLabels.map((l) => ({
        labelId: l.labelId,
        title: l.labelTitle,
        frozenAt: l.frozenAt,
        staleNutrients: l.staleDays,
      })),
    });
  } catch (error) {
    return res.status(500).json({
      error: "staleness check failed",
      detail: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

v1Router.get("/verification/tasks", async (req, res) => {
  const org = await getPrimaryOrganization();

  const statusRaw = typeof req.query.status === "string" ? req.query.status.toUpperCase() : undefined;
  const severityRaw = typeof req.query.severity === "string" ? req.query.severity.toUpperCase() : undefined;
  const sourceType = typeof req.query.sourceType === "string" ? req.query.sourceType.toUpperCase() : undefined;
  const historicalException = parseBoolean(req.query.historicalException, false);
  const confidenceMinRaw = Number(req.query.confidenceMin);
  const confidenceMin = Number.isFinite(confidenceMinRaw) ? confidenceMinRaw : null;

  const status = statusRaw && Object.values(VerificationTaskStatus).includes(statusRaw as VerificationTaskStatus)
    ? (statusRaw as VerificationTaskStatus) : undefined;
  const severities = severityRaw
    ? severityRaw.split(",").filter((s): s is VerificationTaskSeverity =>
        Object.values(VerificationTaskSeverity).includes(s as VerificationTaskSeverity)
      )
    : undefined;

  const tasks = await prisma.verificationTask.findMany({
    where: {
      organizationId: org.id,
      ...(status ? { status } : {}),
      ...(severities?.length ? { severity: { in: severities } } : {})
    },
    orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
    include: { reviews: true }
  });

  const parsed = tasks
    .map((task) =>
      verificationTaskSchema.parse({
        id: task.id,
        taskType: task.taskType,
        severity: task.severity,
        status: task.status,
        title: task.title,
        description: task.description,
        payload: task.payload
      })
    )
    .filter((task) => {
      if (sourceType) {
        const taskSourceType = typeof task.payload.sourceType === "string" ? task.payload.sourceType.toUpperCase() : "";
        if (taskSourceType !== sourceType) return false;
      }
      if (historicalException && task.payload.historicalException !== true) {
        return false;
      }
      if (confidenceMin === null) return true;
      const confidence = typeof task.payload.confidence === "number" ? task.payload.confidence : null;
      if (confidence === null) return true;
      return confidence >= confidenceMin;
    });

  return res.json({ tasks: parsed });
});

v1Router.patch("/verification/tasks/:id", async (req, res) => {
  const body = validateBody(updateVerificationTaskBodySchema, req.body, res);
  if (!body) return;
  const { status, decision, notes } = body;
  const user = await getDefaultUser();
  const { id } = req.params;

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
    // Verify only nutrient rows explicitly targeted by the task payload.
    const payload = (task.payload ?? {}) as {
      productId?: string;
      nutrientKeys?: string[];
      proposedValues?: Record<string, number>;
      evidenceRefs?: string[];
      confidence?: number;
      sourceType?: string;
      historicalException?: boolean;
    };

    const productId = payload.productId;
    const nutrientKeys = Array.isArray(payload.nutrientKeys)
      ? payload.nutrientKeys.filter((key): key is string => typeof key === "string" && key.length > 0)
      : [];
    const proposedValues = payload.proposedValues ?? {};

    if (productId) {
      const definitions = await prisma.nutrientDefinition.findMany({
        where: nutrientKeys.length ? { key: { in: nutrientKeys } } : undefined,
        select: { id: true, key: true }
      });
      const defsByKey = new Map(definitions.map((definition) => [definition.key, definition.id]));

      if (nutrientKeys.length > 0) {
        for (const nutrientKey of nutrientKeys) {
          const nutrientDefinitionId = defsByKey.get(nutrientKey);
          if (!nutrientDefinitionId) continue;
          const proposedValue = proposedValues[nutrientKey];

          await prisma.productNutrientValue.updateMany({
            where: {
              productId,
              nutrientDefinitionId
            },
            data: {
              ...(typeof proposedValue === "number" && Number.isFinite(proposedValue)
                ? { valuePer100g: proposedValue }
                : {}),
              verificationStatus: VerificationStatus.VERIFIED,
              version: { increment: 1 }
            }
          });
        }
      } else {
        await prisma.productNutrientValue.updateMany({
          where: { productId },
          data: { verificationStatus: VerificationStatus.VERIFIED, version: { increment: 1 } }
        });
      }
    }
  }

  return res.json({ id: task.id, status: task.status });
});

// ── Kitchen Ops: Inventory ─────────────────────────────────────

v1Router.get("/inventory", async (req, res) => {
  const org = await getPrimaryOrganization();
  const storageLocation = typeof req.query.storageLocation === "string"
    ? req.query.storageLocation.toUpperCase()
    : undefined;

  const lots = await prisma.inventoryLot.findMany({
    where: {
      organizationId: org.id,
      quantityAvailableG: { gt: 0 },
      ...(storageLocation && Object.values(StorageLocation).includes(storageLocation as StorageLocation)
        ? { storageLocation: storageLocation as StorageLocation }
        : {}),
    },
    include: {
      product: {
        include: { ingredient: true },
      },
    },
    orderBy: [{ expiresAt: "asc" }, { receivedAt: "desc" }],
  });

  return res.json(
    lots.map((lot) => ({
      id: lot.id,
      productName: lot.product.name,
      ingredientName: lot.product.ingredient.name,
      lotCode: lot.lotCode,
      receivedAt: lot.receivedAt,
      expiresAt: lot.expiresAt,
      quantityReceivedG: lot.quantityReceivedG,
      quantityAvailableG: lot.quantityAvailableG,
      storageLocation: lot.storageLocation,
      sourceOrderRef: lot.sourceOrderRef,
    }))
  );
});

v1Router.get("/inventory/alerts", async (_req, res) => {
  const org = await getPrimaryOrganization();
  const now = new Date();
  const threeDaysOut = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const lots = await prisma.inventoryLot.findMany({
    where: {
      organizationId: org.id,
      quantityAvailableG: { gt: 0 },
    },
    include: { product: true },
  });

  const alerts: Array<{ lotId: string; productName: string; alertType: string; details: string }> = [];

  for (const lot of lots) {
    // Low stock: less than 100g remaining
    if (lot.quantityAvailableG < 100) {
      alerts.push({
        lotId: lot.id,
        productName: lot.product.name,
        alertType: "LOW_STOCK",
        details: `Only ${Math.round(lot.quantityAvailableG)}g remaining`,
      });
    }
    // Expiring soon: within 3 days
    if (lot.expiresAt && lot.expiresAt <= threeDaysOut) {
      const daysLeft = Math.max(0, Math.round((lot.expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
      alerts.push({
        lotId: lot.id,
        productName: lot.product.name,
        alertType: "EXPIRING_SOON",
        details: daysLeft === 0 ? "Expires today" : `Expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
      });
    }
  }

  return res.json(alerts);
});

v1Router.post("/inventory/adjust", async (req, res) => {
  const body = validateBody(inventoryAdjustBodySchema, req.body, res);
  if (!body) return;
  const { lotId, deltaG, reason, notes } = body;

  const org = await getPrimaryOrganization();
  const user = await getDefaultUser();

  // Race-condition fix: use serializable transaction so the read + check + update
  // is atomic. Prevents concurrent adjustments from over-drawing.
  const result = await prisma.$transaction(async (tx) => {
    const lot = await tx.inventoryLot.findFirst({
      where: { id: lotId, organizationId: org.id },
    });
    if (!lot) return { error: "Lot not found", status: 404 } as const;

    const newAvailable = lot.quantityAvailableG + deltaG;
    if (newAvailable < 0) {
      return { error: "Adjustment would result in negative quantity", status: 400 } as const;
    }

    await tx.inventoryLot.update({
      where: { id: lotId },
      data: { quantityAvailableG: newAvailable, version: { increment: 1 } },
    });

    await tx.inventoryLotLedger.create({
      data: {
        inventoryLotId: lotId,
        deltaG,
        reason: `${reason}${notes ? `: ${notes}` : ""}`,
        referenceId: `manual-${Date.now()}`,
        createdBy: user.email,
      },
    });

    return { lotId, newAvailableG: newAvailable } as const;
  }, { isolationLevel: "Serializable" });

  if ("error" in result) {
    return res.status(result.status as number).json({ error: result.error });
  }

  return res.json(result);
});

// ── Kitchen Ops: Components ────────────────────────────────────

v1Router.get("/components", async (req, res) => {
  const org = await getPrimaryOrganization();
  const typeRaw = typeof req.query.type === "string" ? req.query.type : undefined;
  const typeFilter = typeRaw
    ? typeRaw.split(",")
        .map((t) => t.trim().toUpperCase())
        .filter((t): t is ComponentType => Object.values(ComponentType).includes(t as ComponentType))
    : undefined;

  const components = await prisma.component.findMany({
    where: {
      organizationId: org.id,
      active: true,
      ...(typeFilter?.length ? { componentType: { in: typeFilter } } : {}),
    },
    include: { _count: { select: { lines: true } } },
    orderBy: [{ componentType: "asc" }, { name: "asc" }],
  });

  return res.json(
    components.map((c) => ({
      id: c.id,
      name: c.name,
      componentType: c.componentType,
      defaultYieldFactor: c.defaultYieldFactor,
      lineCount: c._count.lines,
    }))
  );
});

// ── Kitchen Ops: Batch Prep ────────────────────────────────────

v1Router.get("/batches", async (req, res) => {
  const org = await getPrimaryOrganization();
  const statusRaw = typeof req.query.status === "string" ? req.query.status.toUpperCase() : undefined;
  const statuses = statusRaw
    ? statusRaw.split(",").filter((s): s is BatchStatus =>
        Object.values(BatchStatus).includes(s as BatchStatus)
      )
    : undefined;

  const batches = await prisma.batchProduction.findMany({
    where: {
      organizationId: org.id,
      ...(statuses?.length ? { status: { in: statuses } } : {}),
    },
    include: { component: true },
    orderBy: [{ plannedDate: "desc" }, { createdAt: "desc" }],
  });

  return res.json(
    batches.map((b) => ({
      id: b.id,
      componentName: b.component.name,
      componentType: b.component.componentType,
      status: b.status,
      plannedDate: b.plannedDate.toISOString().slice(0, 10),
      batchCode: b.batchCode,
      rawInputG: b.rawInputG,
      expectedYieldG: b.expectedYieldG,
      actualYieldG: b.actualYieldG,
      yieldVariance: b.yieldVariance,
      portionCount: b.portionCount,
      portionSizeG: b.portionSizeG,
      cookTempC: b.cookTempC,
      cookTimeMin: b.cookTimeMin,
      notes: b.notes,
    }))
  );
});

v1Router.post("/batches", async (req, res) => {
  const body = validateBody(createBatchBodySchema, req.body, res);
  if (!body) return;
  const { componentId, rawInputG, portionSizeG, plannedDate } = body;

  const org = await getPrimaryOrganization();
  const user = await getDefaultUser();

  const component = await prisma.component.findFirst({
    where: { id: componentId, organizationId: org.id },
  });
  if (!component) {
    return res.status(404).json({ error: "Component not found" });
  }

  const expectedYieldG = rawInputG * component.defaultYieldFactor;
  const portionCount = portionSizeG && portionSizeG > 0
    ? Math.floor(expectedYieldG / portionSizeG)
    : null;

  const batch = await prisma.batchProduction.create({
    data: {
      organizationId: org.id,
      componentId,
      rawInputG,
      expectedYieldG,
      portionSizeG: portionSizeG ?? null,
      portionCount,
      plannedDate: parseDateOnlyUtc(plannedDate),
      status: "PLANNED",
      createdBy: user.email,
    },
  });

  return res.json({
    id: batch.id,
    componentName: component.name,
    componentType: component.componentType,
    status: batch.status,
    plannedDate: batch.plannedDate.toISOString().slice(0, 10),
    rawInputG: batch.rawInputG,
    expectedYieldG: batch.expectedYieldG,
    portionCount: batch.portionCount,
    portionSizeG: batch.portionSizeG,
  });
});

v1Router.patch("/batches/:batchId/status", async (req, res) => {
  const body = validateBody(updateBatchStatusBodySchema, req.body, res);
  if (!body) return;
  const { status, actualYieldG, lotOverrides } = body;
  const { batchId } = req.params;

  const batch = await prisma.batchProduction.findUnique({ where: { id: batchId } });
  if (!batch) {
    return res.status(404).json({ error: "Batch not found" });
  }

  const yieldVariance = typeof actualYieldG === "number" && batch.expectedYieldG > 0
    ? (actualYieldG - batch.expectedYieldG) / batch.expectedYieldG
    : batch.yieldVariance;

  const portionCount = typeof actualYieldG === "number" && batch.portionSizeG && batch.portionSizeG > 0
    ? Math.floor(actualYieldG / batch.portionSizeG)
    : batch.portionCount;

  // Build lot override map: ingredientId → preferred lotId
  const overrideMap = new Map<string, string>();
  if (lotOverrides) {
    for (const o of lotOverrides) {
      overrideMap.set(o.ingredientId, o.lotId);
    }
  }

  // ── OI-3: Batch Lot Consumption (FIFO or override) when moving to IN_PREP ──
  // Race-condition fix: idempotency check is now INSIDE the serializable
  // transaction so concurrent advance calls cannot double-consume lots.
  if (status === "IN_PREP") {
    await prisma.$transaction(async (tx) => {
      // Idempotency guard inside transaction prevents double-consumption
      const existingConsumptions = await tx.batchLotConsumption.count({
        where: { batchId },
      });
      if (existingConsumptions > 0) return; // Already consumed, skip

      const componentLines = await tx.componentLine.findMany({
        where: { componentId: batch.componentId },
        include: { ingredient: true },
      });

      for (const line of componentLines) {
        let remaining = line.targetGPer100g * (batch.rawInputG / 100);

        // Check for lot override — prefer specified lot first
        const overrideLotId = overrideMap.get(line.ingredientId);
        let lots;
        if (overrideLotId) {
          // Put the override lot first, then FIFO for the rest
          const overrideLot = await tx.inventoryLot.findFirst({
            where: {
              id: overrideLotId,
              organizationId: batch.organizationId,
              quantityAvailableG: { gt: 0 },
              product: { ingredientId: line.ingredientId },
            },
          });
          const otherLots = await tx.inventoryLot.findMany({
            where: {
              organizationId: batch.organizationId,
              quantityAvailableG: { gt: 0 },
              product: { ingredientId: line.ingredientId },
              id: { not: overrideLotId },
            },
            orderBy: [{ expiresAt: "asc" }, { receivedAt: "asc" }],
          });
          lots = overrideLot ? [overrideLot, ...otherLots] : otherLots;
        } else {
          lots = await tx.inventoryLot.findMany({
            where: {
              organizationId: batch.organizationId,
              quantityAvailableG: { gt: 0 },
              product: { ingredientId: line.ingredientId },
            },
            orderBy: [{ expiresAt: "asc" }, { receivedAt: "asc" }],
          });
        }

        for (const lot of lots) {
          if (remaining <= 0) break;
          const use = Math.min(remaining, lot.quantityAvailableG);
          if (use <= 0) continue;

          await tx.batchLotConsumption.create({
            data: {
              batchId,
              inventoryLotId: lot.id,
              gramsConsumed: use,
            },
          });

          await tx.inventoryLot.update({
            where: { id: lot.id },
            data: { quantityAvailableG: { decrement: use } },
          });

          await tx.inventoryLotLedger.create({
            data: {
              inventoryLotId: lot.id,
              deltaG: -use,
              reason: "BATCH_CONSUMPTION",
              referenceId: batchId,
              createdBy: "system",
            },
          });

          remaining -= use;
        }
      }
    }, { isolationLevel: "Serializable" });
  }

  const updated = await prisma.batchProduction.update({
    where: { id: batchId },
    data: {
      status: status as BatchStatus,
      ...(typeof actualYieldG === "number" ? { actualYieldG } : {}),
      ...(yieldVariance !== batch.yieldVariance ? { yieldVariance } : {}),
      ...(portionCount !== batch.portionCount ? { portionCount } : {}),
      ...(status === "READY" ? { completedAt: new Date() } : {}),
      version: { increment: 1 },
    },
    include: { component: true },
  });

  return res.json({
    id: updated.id,
    componentName: updated.component.name,
    componentType: updated.component.componentType,
    status: updated.status,
    rawInputG: updated.rawInputG,
    expectedYieldG: updated.expectedYieldG,
    actualYieldG: updated.actualYieldG,
    yieldVariance: updated.yieldVariance,
    portionCount: updated.portionCount,
  });
});

// ── Kitchen Ops: Client Profile ────────────────────────────────

v1Router.get("/clients/:clientId", async (req, res) => {
  const org = await getPrimaryOrganization();
  const clientId = req.params.clientId!;

  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: org.id },
  });
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }

  return res.json({
    id: client.id,
    fullName: client.fullName,
    email: client.email,
    phone: client.phone,
    heightCm: client.heightCm,
    weightKg: client.weightKg,
    goals: client.goals,
    preferences: client.preferences,
    exclusions: client.exclusions,
    timezone: client.timezone,
    active: client.active,
    dateOfBirth: client.dateOfBirth,
    sex: client.sex,
    activityLevel: client.activityLevel,
    targetKcal: client.targetKcal,
    targetProteinG: client.targetProteinG,
    targetCarbG: client.targetCarbG,
    targetFatG: client.targetFatG,
    targetWeightKg: client.targetWeightKg,
    targetBodyFatPct: client.targetBodyFatPct,
    bodyCompositionSnapshots: client.bodyCompositionSnapshots ?? [],
    fileRecords: client.fileRecords ?? [],
  });
});

v1Router.patch("/clients/:clientId", async (req, res) => {
  const org = await getPrimaryOrganization();
  const clientId = req.params.clientId!;
  const {
    email, phone, heightCm, weightKg, goals, preferences, exclusions,
    dateOfBirth, sex, activityLevel,
    targetKcal, targetProteinG, targetCarbG, targetFatG, targetWeightKg, targetBodyFatPct,
    deliveryAddressHome, deliveryAddressWork, deliveryNotes, deliveryZone,
  } = req.body as Record<string, unknown>;

  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: org.id },
  });
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }

  const data: Record<string, unknown> = { version: { increment: 1 } };
  if (email !== undefined) data.email = email;
  if (phone !== undefined) data.phone = phone;
  if (typeof heightCm === "number") data.heightCm = heightCm;
  if (typeof weightKg === "number") data.weightKg = weightKg;
  if (goals !== undefined) data.goals = goals;
  if (preferences !== undefined) data.preferences = preferences;
  if (Array.isArray(exclusions)) data.exclusions = exclusions;
  if (dateOfBirth !== undefined) data.dateOfBirth = dateOfBirth ? new Date(dateOfBirth as string) : null;
  if (sex !== undefined) data.sex = sex;
  if (activityLevel !== undefined) data.activityLevel = activityLevel;
  if (targetKcal !== undefined) data.targetKcal = targetKcal;
  if (targetProteinG !== undefined) data.targetProteinG = targetProteinG;
  if (targetCarbG !== undefined) data.targetCarbG = targetCarbG;
  if (targetFatG !== undefined) data.targetFatG = targetFatG;
  if (targetWeightKg !== undefined) data.targetWeightKg = targetWeightKg;
  if (targetBodyFatPct !== undefined) data.targetBodyFatPct = targetBodyFatPct;
  if (deliveryAddressHome !== undefined) data.deliveryAddressHome = deliveryAddressHome;
  if (deliveryAddressWork !== undefined) data.deliveryAddressWork = deliveryAddressWork;
  if (deliveryNotes !== undefined) data.deliveryNotes = deliveryNotes;
  if (deliveryZone !== undefined) data.deliveryZone = deliveryZone;

  const updated = await prisma.client.update({
    where: { id: clientId },
    data,
  });

  return res.json({
    id: updated.id,
    fullName: updated.fullName,
    email: updated.email,
    phone: updated.phone,
    heightCm: updated.heightCm,
    weightKg: updated.weightKg,
    goals: updated.goals,
    preferences: updated.preferences,
    exclusions: updated.exclusions,
    dateOfBirth: updated.dateOfBirth,
    sex: updated.sex,
    activityLevel: updated.activityLevel,
    targetKcal: updated.targetKcal,
    targetProteinG: updated.targetProteinG,
    targetCarbG: updated.targetCarbG,
    targetFatG: updated.targetFatG,
    targetWeightKg: updated.targetWeightKg,
    targetBodyFatPct: updated.targetBodyFatPct,
    deliveryAddressHome: updated.deliveryAddressHome,
    deliveryAddressWork: updated.deliveryAddressWork,
    deliveryNotes: updated.deliveryNotes,
    deliveryZone: updated.deliveryZone,
  });
});

v1Router.post("/clients/:clientId/body-composition", async (req, res) => {
  const org = await getPrimaryOrganization();
  const clientId = req.params.clientId!;
  const { date, bodyFatPct, leanMassKg, source } = req.body as {
    date?: string;
    bodyFatPct?: number;
    leanMassKg?: number;
    source?: string;
  };

  if (!date || !source) {
    return res.status(400).json({ error: "date and source are required" });
  }

  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: org.id },
  });
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }

  const existing = Array.isArray(client.bodyCompositionSnapshots) ? client.bodyCompositionSnapshots : [];
  const newSnapshot = { date, bodyFatPct: bodyFatPct ?? null, leanMassKg: leanMassKg ?? null, source, createdAt: new Date().toISOString() };

  await prisma.client.update({
    where: { id: clientId },
    data: {
      bodyCompositionSnapshots: [...existing, newSnapshot] as unknown as import("@prisma/client").Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });

  return res.json(newSnapshot);
});

v1Router.post("/clients/:clientId/file-records", async (req, res) => {
  const org = await getPrimaryOrganization();
  const clientId = req.params.clientId!;
  const { date, type, fileName, notes } = req.body as {
    date?: string;
    type?: string;
    fileName?: string;
    notes?: string;
  };

  if (!date || !type || !fileName) {
    return res.status(400).json({ error: "date, type, and fileName are required" });
  }

  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: org.id },
  });
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }

  const existing = Array.isArray(client.fileRecords) ? client.fileRecords : [];
  const newRecord = { date, type, fileName, notes: notes ?? null, createdAt: new Date().toISOString() };

  await prisma.client.update({
    where: { id: clientId },
    data: {
      fileRecords: [...existing, newRecord] as unknown as import("@prisma/client").Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });

  return res.json(newRecord);
});

// ── Kitchen Ops: Sauce Management ──────────────────────────────

v1Router.get("/sauces", async (_req, res) => {
  const org = await getPrimaryOrganization();

  const components = await prisma.component.findMany({
    where: {
      organizationId: org.id,
      componentType: { in: [ComponentType.SAUCE, ComponentType.CONDIMENT] },
    },
    include: {
      _count: { select: { lines: true } },
      sauceVariants: true,
      saucePairings: true,
    },
    orderBy: [{ componentType: "asc" }, { name: "asc" }],
  });

  return res.json(
    components.map((c) => ({
      id: c.id,
      name: c.name,
      componentType: c.componentType,
      description: c.description,
      defaultYieldFactor: c.defaultYieldFactor,
      allergenTags: c.allergenTags,
      flavorProfiles: c.flavorProfiles,
      portionIncrementG: c.portionIncrementG,
      macroVariant: c.macroVariant,
      active: c.active,
      lineCount: c._count.lines,
      variants: c.sauceVariants,
      pairings: c.saucePairings,
    }))
  );
});

v1Router.post("/sauces/:componentId/variants", async (req, res) => {
  const org = await getPrimaryOrganization();
  const user = await getDefaultUser();
  const { componentId } = req.params;
  const { variantType, kcalPer100g, proteinPer100g, carbPer100g, fatPer100g, fiberPer100g, sodiumPer100g } = req.body as {
    variantType?: string;
    kcalPer100g?: number;
    proteinPer100g?: number;
    carbPer100g?: number;
    fatPer100g?: number;
    fiberPer100g?: number;
    sodiumPer100g?: number;
  };

  if (!variantType || !Object.values(SauceVariantType).includes(variantType as SauceVariantType)) {
    return res.status(400).json({ error: "variantType is required and must be a valid SauceVariantType" });
  }

  const component = await prisma.component.findFirst({
    where: { id: componentId, organizationId: org.id },
  });
  if (!component) {
    return res.status(404).json({ error: "Component not found" });
  }
  if (component.componentType !== ComponentType.SAUCE && component.componentType !== ComponentType.CONDIMENT) {
    return res.status(400).json({ error: "Component must be SAUCE or CONDIMENT type" });
  }

  const variant = await prisma.sauceVariant.upsert({
    where: {
      componentId_variantType: {
        componentId,
        variantType: variantType as SauceVariantType,
      },
    },
    update: {
      ...(typeof kcalPer100g === "number" ? { kcalPer100g } : {}),
      ...(typeof proteinPer100g === "number" ? { proteinPer100g } : {}),
      ...(typeof carbPer100g === "number" ? { carbPer100g } : {}),
      ...(typeof fatPer100g === "number" ? { fatPer100g } : {}),
      ...(typeof fiberPer100g === "number" ? { fiberPer100g } : {}),
      ...(typeof sodiumPer100g === "number" ? { sodiumPer100g } : {}),
      version: { increment: 1 },
    },
    create: {
      componentId,
      variantType: variantType as SauceVariantType,
      kcalPer100g: kcalPer100g ?? null,
      proteinPer100g: proteinPer100g ?? null,
      carbPer100g: carbPer100g ?? null,
      fatPer100g: fatPer100g ?? null,
      fiberPer100g: fiberPer100g ?? null,
      sodiumPer100g: sodiumPer100g ?? null,
      createdBy: user.email,
    },
  });

  return res.json(variant);
});

v1Router.post("/sauces/:componentId/pairings", async (req, res) => {
  const org = await getPrimaryOrganization();
  const user = await getDefaultUser();
  const { componentId } = req.params;
  const { pairedComponentType, recommended, defaultPortionG, notes } = req.body as {
    pairedComponentType?: string;
    recommended?: boolean;
    defaultPortionG?: number;
    notes?: string;
  };

  if (!pairedComponentType || !Object.values(ComponentType).includes(pairedComponentType as ComponentType)) {
    return res.status(400).json({ error: "pairedComponentType is required and must be a valid ComponentType" });
  }

  const component = await prisma.component.findFirst({
    where: { id: componentId, organizationId: org.id },
  });
  if (!component) {
    return res.status(404).json({ error: "Component not found" });
  }
  if (component.componentType !== ComponentType.SAUCE && component.componentType !== ComponentType.CONDIMENT) {
    return res.status(400).json({ error: "Component must be SAUCE or CONDIMENT type" });
  }

  const pairing = await prisma.saucePairing.upsert({
    where: {
      sauceComponentId_pairedComponentType: {
        sauceComponentId: componentId,
        pairedComponentType: pairedComponentType as ComponentType,
      },
    },
    update: {
      ...(typeof recommended === "boolean" ? { recommended } : {}),
      ...(typeof defaultPortionG === "number" ? { defaultPortionG } : {}),
      ...(notes !== undefined ? { notes } : {}),
      version: { increment: 1 },
    },
    create: {
      sauceComponentId: componentId,
      pairedComponentType: pairedComponentType as ComponentType,
      recommended: recommended ?? false,
      defaultPortionG: defaultPortionG ?? null,
      notes: notes ?? null,
      createdBy: user.email,
    },
  });

  return res.json(pairing);
});

v1Router.delete("/sauces/:componentId/pairings/:pairingId", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { componentId, pairingId } = req.params;

  const component = await prisma.component.findFirst({
    where: { id: componentId, organizationId: org.id },
  });
  if (!component) {
    return res.status(404).json({ error: "Component not found" });
  }

  const pairing = await prisma.saucePairing.findFirst({
    where: { id: pairingId, sauceComponentId: componentId },
  });
  if (!pairing) {
    return res.status(404).json({ error: "Pairing not found" });
  }

  await prisma.saucePairing.delete({ where: { id: pairingId } });

  return res.json({ deleted: true, id: pairingId });
});

// ── Kitchen Ops: Batch Checkpoints ─────────────────────────────

v1Router.post("/batches/:batchId/checkpoints", async (req, res) => {
  const body = validateBody(createCheckpointBodySchema, req.body, res);
  if (!body) return;
  const { checkpointType, tempC, notes, timerDurationM } = body;
  const user = await getDefaultUser();
  const { batchId } = req.params;

  const batch = await prisma.batchProduction.findUnique({ where: { id: batchId } });
  if (!batch) {
    return res.status(404).json({ error: "Batch not found" });
  }

  const checkpoint = await prisma.batchCheckpoint.create({
    data: {
      batchId,
      checkpointType: checkpointType as BatchCheckpointType,
      tempC: tempC ?? null,
      notes: notes ?? null,
      timerDurationM: timerDurationM ?? null,
      timerStartedAt: timerDurationM ? new Date() : null,
      createdBy: user.email,
    },
  });

  return res.json(checkpoint);
});

v1Router.get("/batches/:batchId/checkpoints", async (req, res) => {
  const { batchId } = req.params;

  const batch = await prisma.batchProduction.findUnique({ where: { id: batchId } });
  if (!batch) {
    return res.status(404).json({ error: "Batch not found" });
  }

  const checkpoints = await prisma.batchCheckpoint.findMany({
    where: { batchId },
    orderBy: { occurredAt: "asc" },
  });

  return res.json(checkpoints);
});

// ── Kitchen Ops: Batch Detail ──────────────────────────────────

v1Router.get("/batches/:batchId", async (req, res) => {
  const { batchId } = req.params;

  const batch = await prisma.batchProduction.findUnique({
    where: { id: batchId },
    include: {
      component: {
        include: {
          lines: {
            include: { ingredient: true },
            orderBy: { lineOrder: "asc" },
          },
        },
      },
      checkpoints: {
        orderBy: { occurredAt: "asc" },
      },
      lotConsumptions: {
        include: {
          inventoryLot: {
            include: { product: true },
          },
        },
      },
    },
  });

  if (!batch) {
    return res.status(404).json({ error: "Batch not found" });
  }

  return res.json({
    id: batch.id,
    componentId: batch.componentId,
    status: batch.status,
    plannedDate: batch.plannedDate.toISOString().slice(0, 10),
    batchCode: batch.batchCode,
    rawInputG: batch.rawInputG,
    expectedYieldG: batch.expectedYieldG,
    actualYieldG: batch.actualYieldG,
    yieldVariance: batch.yieldVariance,
    portionCount: batch.portionCount,
    portionSizeG: batch.portionSizeG,
    cookTempC: batch.cookTempC,
    cookTimeMin: batch.cookTimeMin,
    chillStartedAt: batch.chillStartedAt,
    chillCompletedAt: batch.chillCompletedAt,
    notes: batch.notes,
    completedAt: batch.completedAt,
    component: {
      id: batch.component.id,
      name: batch.component.name,
      componentType: batch.component.componentType,
      defaultYieldFactor: batch.component.defaultYieldFactor,
      lines: batch.component.lines.map((l) => ({
        id: l.id,
        ingredientId: l.ingredientId,
        ingredientName: l.ingredient.name,
        lineOrder: l.lineOrder,
        targetGPer100g: l.targetGPer100g,
        preparation: l.preparation,
        preparedState: l.preparedState,
        yieldFactor: l.yieldFactor,
        required: l.required,
      })),
    },
    checkpoints: batch.checkpoints,
    lotConsumptions: batch.lotConsumptions.map((lc) => ({
      id: lc.id,
      inventoryLotId: lc.inventoryLotId,
      gramsConsumed: lc.gramsConsumed,
      productName: lc.inventoryLot.product.name,
    })),
  });
});

// ── Available lots for a batch (for lot selection UI) ─────────────────────
v1Router.get("/batches/:batchId/available-lots", async (req, res) => {
  const { batchId } = req.params;

  const batch = await prisma.batchProduction.findUnique({
    where: { id: batchId },
    include: {
      component: {
        include: {
          lines: {
            include: { ingredient: true },
            orderBy: { lineOrder: "asc" },
          },
        },
      },
    },
  });

  if (!batch) {
    return res.status(404).json({ error: "Batch not found" });
  }

  const result = [];
  for (const line of batch.component.lines) {
    const neededG = line.targetGPer100g * (batch.rawInputG / 100);
    const lots = await prisma.inventoryLot.findMany({
      where: {
        organizationId: batch.organizationId,
        quantityAvailableG: { gt: 0 },
        product: { ingredientId: line.ingredientId },
      },
      include: { product: true },
      orderBy: [{ expiresAt: "asc" }, { receivedAt: "asc" }],
    });

    result.push({
      ingredientId: line.ingredientId,
      ingredientName: line.ingredient.name,
      neededG,
      lots: lots.map((lot) => ({
        id: lot.id,
        lotCode: lot.lotCode,
        productName: lot.product.name,
        availableG: lot.quantityAvailableG,
        receivedAt: lot.receivedAt.toISOString().slice(0, 10),
        expiresAt: lot.expiresAt?.toISOString().slice(0, 10) ?? null,
        isDefault: true, // FIFO order — first lot is default
      })),
    });

    // Mark only the first lot as default
    if (result[result.length - 1]!.lots.length > 1) {
      for (let i = 1; i < result[result.length - 1]!.lots.length; i++) {
        result[result.length - 1]!.lots[i]!.isDefault = false;
      }
    }
  }

  return res.json({ ingredients: result });
});

// ── Schedule-Aware Batch Prep ──────────────────────────────────

/** POST /v1/batches/from-schedule — create a batch with auto-generated portions */
v1Router.post("/batches/from-schedule", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { componentId, weekStart, weekEnd, portionSizeG } = req.body as {
    componentId: string;
    weekStart: string;
    weekEnd: string;
    portionSizeG?: number;
  };

  if (!componentId || !weekStart || !weekEnd) {
    return res.status(400).json({ error: "componentId, weekStart, weekEnd required" });
  }

  const start = new Date(weekStart);
  const end = new Date(weekEnd);

  // Verify component exists
  const component = await prisma.component.findFirst({
    where: { id: componentId, organizationId: org.id },
  });
  if (!component) {
    return res.status(404).json({ error: "Component not found" });
  }

  // Find MealSchedules that use this component via Sku → Recipe → RecipeLine
  const schedules = await prisma.mealSchedule.findMany({
    where: {
      organizationId: org.id,
      status: "PLANNED" as ScheduleStatus,
      serviceDate: { gte: start, lte: end },
      skuId: { not: null },
    },
    include: {
      client: { select: { id: true, fullName: true } },
      sku: {
        include: {
          recipes: {
            where: { active: true },
            include: {
              lines: {
                where: { ingredientId: componentId },
                include: { ingredient: { select: { id: true, name: true } } },
              },
            },
            take: 1,
          },
        },
      },
    },
  });

  // Build portion entries
  type PortionEntry = {
    mealScheduleId: string;
    clientId: string;
    clientName: string;
    serviceDate: Date;
    mealSlot: string;
    cookedG: number;
  };
  const portions: PortionEntry[] = [];

  for (const s of schedules) {
    const recipe = s.sku?.recipes?.[0];
    if (!recipe?.lines?.length) continue;
    for (const line of recipe.lines) {
      portions.push({
        mealScheduleId: s.id,
        clientId: s.clientId,
        clientName: s.client.fullName,
        serviceDate: s.serviceDate,
        mealSlot: s.mealSlot,
        cookedG: line.targetGPerServing * (recipe.servings ?? 1),
      });
    }
  }

  if (portions.length === 0) {
    return res.status(400).json({ error: "No scheduled meals found for this component in the date range" });
  }

  // Compute totals
  const totalCookedG = portions.reduce((sum, p) => sum + p.cookedG, 0);

  // Get yield factor
  const calibration = await prisma.yieldCalibration.findFirst({
    where: {
      organizationId: org.id,
      componentId,
      status: "ACCEPTED" as CalibrationStatus,
    },
    orderBy: { createdAt: "desc" },
  });
  const yieldFactor = calibration?.proposedYieldPct ? calibration.proposedYieldPct / 100 : component.defaultYieldFactor;
  const rawInputG = yieldFactor > 0 ? Math.round((totalCookedG / yieldFactor) * 100) / 100 : totalCookedG;
  const expectedYieldG = Math.round(rawInputG * yieldFactor * 100) / 100;

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Create batch + portions in a transaction
  const batch = await prisma.$transaction(async (tx) => {
    const b = await tx.batchProduction.create({
      data: {
        organizationId: org.id,
        componentId,
        status: "PLANNED" as BatchStatus,
        plannedDate: start,
        rawInputG,
        expectedYieldG,
        portionCount: portions.length,
        portionSizeG: portionSizeG ?? null,
        notes: `Schedule-aware batch for ${weekStart} to ${weekEnd}`,
      },
    });

    for (const p of portions) {
      const d = p.serviceDate;
      const dayName = dayNames[d.getUTCDay()] ?? d.toISOString().slice(0, 10);
      const slotLabel = p.mealSlot.charAt(0) + p.mealSlot.slice(1).toLowerCase();
      const label = `${p.clientName} / ${dayName} ${slotLabel} / ${Math.round(p.cookedG)}g`;

      await tx.batchPortion.create({
        data: {
          batchProductionId: b.id,
          mealScheduleId: p.mealScheduleId,
          clientId: p.clientId,
          serviceDate: p.serviceDate,
          mealSlot: p.mealSlot,
          portionG: p.cookedG,
          label,
        },
      });
    }

    return b;
  });

  // Fetch back with portions
  const result = await prisma.batchProduction.findUnique({
    where: { id: batch.id },
    include: {
      component: { select: { id: true, name: true, componentType: true } },
      portions: { orderBy: { serviceDate: "asc" } },
    },
  });

  return res.json(result);
});

/** GET /v1/batches/:batchId/portions — list portions for a batch */
v1Router.get("/batches/:batchId/portions", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { batchId } = req.params;

  const batch = await prisma.batchProduction.findFirst({
    where: { id: batchId, organizationId: org.id },
  });
  if (!batch) {
    return res.status(404).json({ error: "Batch not found" });
  }

  const portions = await prisma.batchPortion.findMany({
    where: { batchProductionId: batchId },
    include: {
      client: { select: { id: true, fullName: true } },
    },
    orderBy: [{ serviceDate: "asc" }, { label: "asc" }],
  });

  return res.json({
    portions: portions.map((p) => ({
      id: p.id,
      label: p.label,
      portionG: p.portionG,
      serviceDate: p.serviceDate?.toISOString().slice(0, 10) ?? null,
      mealSlot: p.mealSlot,
      clientId: p.clientId,
      clientName: p.client?.fullName ?? null,
      sealed: p.sealed,
      mealScheduleId: p.mealScheduleId,
    })),
  });
});

/** PATCH /v1/batches/:batchId/portions/:portionId — update portion (toggle sealed) */
v1Router.patch("/batches/:batchId/portions/:portionId", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { batchId, portionId } = req.params;
  const { sealed } = req.body as { sealed: boolean };

  if (typeof sealed !== "boolean") {
    return res.status(400).json({ error: "sealed (boolean) required" });
  }

  const batch = await prisma.batchProduction.findFirst({
    where: { id: batchId, organizationId: org.id },
  });
  if (!batch) {
    return res.status(404).json({ error: "Batch not found" });
  }

  const portion = await prisma.batchPortion.findFirst({
    where: { id: portionId, batchProductionId: batchId },
  });
  if (!portion) {
    return res.status(404).json({ error: "Portion not found" });
  }

  const updated = await prisma.batchPortion.update({
    where: { id: portionId },
    data: { sealed },
  });

  return res.json(updated);
});

// ── Kitchen Ops: Print Data ────────────────────────────────────

v1Router.get("/print/batch-sheet/:batchId", async (req, res) => {
  const { batchId } = req.params;

  const batch = await prisma.batchProduction.findUnique({
    where: { id: batchId },
    include: {
      component: {
        include: {
          lines: {
            include: { ingredient: true },
            orderBy: { lineOrder: "asc" },
          },
        },
      },
      checkpoints: {
        orderBy: { occurredAt: "asc" },
      },
    },
  });

  if (!batch) {
    return res.status(404).json({ error: "Batch not found" });
  }

  // Generate expected steps based on component type
  const expectedSteps: string[] = [];
  const ct = batch.component.componentType;
  expectedSteps.push("Weigh raw ingredients");
  if (ct === ComponentType.PROTEIN) {
    expectedSteps.push("Season and prepare protein");
    expectedSteps.push("Cook to target temperature");
    expectedSteps.push("Rest and check internal temp");
    expectedSteps.push("Chill to safe temperature");
    expectedSteps.push("Portion into containers");
  } else if (ct === ComponentType.SAUCE || ct === ComponentType.CONDIMENT) {
    expectedSteps.push("Combine base ingredients");
    expectedSteps.push("Cook/reduce to target consistency");
    expectedSteps.push("Season and adjust");
    expectedSteps.push("Cool and portion");
  } else if (ct === ComponentType.VEGETABLE) {
    expectedSteps.push("Wash and prep vegetables");
    expectedSteps.push("Cook to desired doneness");
    expectedSteps.push("Season and cool");
    expectedSteps.push("Portion into containers");
  } else if (ct === ComponentType.CARB_BASE) {
    expectedSteps.push("Prepare carb base (rinse if needed)");
    expectedSteps.push("Cook to target texture");
    expectedSteps.push("Cool and portion");
  } else {
    expectedSteps.push("Prepare ingredients");
    expectedSteps.push("Cook or assemble");
    expectedSteps.push("Cool and portion");
  }
  expectedSteps.push("Label and store");

  return res.json({
    batch: {
      id: batch.id,
      status: batch.status,
      plannedDate: batch.plannedDate.toISOString().slice(0, 10),
      batchCode: batch.batchCode,
      rawInputG: batch.rawInputG,
      expectedYieldG: batch.expectedYieldG,
      portionCount: batch.portionCount,
      portionSizeG: batch.portionSizeG,
      cookTempC: batch.cookTempC,
      cookTimeMin: batch.cookTimeMin,
      notes: batch.notes,
    },
    component: {
      name: batch.component.name,
      type: batch.component.componentType,
      lines: batch.component.lines.map((l) => ({
        ingredientName: l.ingredient.name,
        targetGPer100g: l.targetGPer100g,
        preparation: l.preparation,
        preparedState: l.preparedState,
      })),
    },
    checkpoints: batch.checkpoints,
    expectedSteps,
  });
});

v1Router.get("/print/pull-list", async (req, res) => {
  const org = await getPrimaryOrganization();
  const hoursAheadRaw = Number(req.query.hoursAhead);
  const hoursAhead = Number.isFinite(hoursAheadRaw) && hoursAheadRaw > 0 ? hoursAheadRaw : 24;

  const now = new Date();
  const horizon = addHours(now, hoursAhead);

  const batches = await prisma.batchProduction.findMany({
    where: {
      organizationId: org.id,
      status: BatchStatus.PLANNED,
      plannedDate: { gte: now, lte: horizon },
    },
    include: {
      component: {
        include: {
          lines: {
            include: {
              ingredient: {
                include: {
                  products: {
                    include: {
                      inventoryLots: {
                        where: { quantityAvailableG: { gt: 0 } },
                        orderBy: { expiresAt: "asc" },
                        take: 3,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  // Group by component, aggregate ingredient quantities
  const componentMap = new Map<string, {
    componentName: string;
    componentType: string;
    ingredients: Map<string, {
      name: string;
      totalNeededG: number;
      storageLocation: string | null;
      suggestedLots: Array<{ lotId: string; availableG: number; expiresAt: string | null }>;
    }>;
  }>();

  for (const batch of batches) {
    const key = batch.componentId;
    if (!componentMap.has(key)) {
      componentMap.set(key, {
        componentName: batch.component.name,
        componentType: batch.component.componentType,
        ingredients: new Map(),
      });
    }
    const entry = componentMap.get(key)!;

    for (const line of batch.component.lines) {
      const ingredientNeededG = (line.targetGPer100g / 100) * batch.rawInputG;
      const ingKey = line.ingredientId;

      if (!entry.ingredients.has(ingKey)) {
        // Find best storage location from available lots
        const allLots = line.ingredient.products.flatMap((p) => p.inventoryLots);
        const topLot = allLots[0];

        entry.ingredients.set(ingKey, {
          name: line.ingredient.name,
          totalNeededG: 0,
          storageLocation: topLot?.storageLocation ?? null,
          suggestedLots: allLots.slice(0, 3).map((lot) => ({
            lotId: lot.id,
            availableG: lot.quantityAvailableG,
            expiresAt: lot.expiresAt?.toISOString() ?? null,
          })),
        });
      }
      const ingEntry = entry.ingredients.get(ingKey)!;
      ingEntry.totalNeededG += ingredientNeededG;
    }
  }

  const result = [...componentMap.values()].map((c) => ({
    componentName: c.componentName,
    componentType: c.componentType,
    ingredients: [...c.ingredients.values()].map((ing) => ({
      name: ing.name,
      totalNeededG: Math.round(ing.totalNeededG * 10) / 10,
      storageLocation: ing.storageLocation,
      suggestedLots: ing.suggestedLots,
    })),
  }));

  return res.json(result);
});

v1Router.get("/print/daily-summary", async (req, res) => {
  const org = await getPrimaryOrganization();
  const dateRaw = typeof req.query.date === "string" ? req.query.date : new Date().toISOString().slice(0, 10);
  const targetDate = parseDateOnlyUtc(dateRaw);
  const startOfDay = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), 0, 0, 0));
  const endOfDay = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), 23, 59, 59, 999));

  const batches = await prisma.batchProduction.findMany({
    where: {
      organizationId: org.id,
      plannedDate: { gte: startOfDay, lte: endOfDay },
    },
    include: { component: true },
    orderBy: [{ component: { componentType: "asc" } }, { plannedDate: "asc" }],
  });

  // Group by componentType
  const groupMap = new Map<string, Array<{
    name: string;
    status: string;
    plannedDate: string;
    rawInputG: number;
    expectedYieldG: number;
    actualYieldG: number | null;
  }>>();

  for (const batch of batches) {
    const ct = batch.component.componentType;
    if (!groupMap.has(ct)) {
      groupMap.set(ct, []);
    }
    groupMap.get(ct)!.push({
      name: batch.component.name,
      status: batch.status,
      plannedDate: batch.plannedDate.toISOString().slice(0, 10),
      rawInputG: batch.rawInputG,
      expectedYieldG: batch.expectedYieldG,
      actualYieldG: batch.actualYieldG,
    });
  }

  return res.json({
    date: dateRaw,
    groups: [...groupMap.entries()].map(([componentType, batchList]) => ({
      componentType,
      batches: batchList,
    })),
  });
});

// ── Sprint 1A: Inventory Intelligence Endpoints ──────────────────

v1Router.get("/inventory/projections", async (_req, res) => {
  const org = await getPrimaryOrganization();
  const days = parseInt(String(_req.query.days ?? "7"), 10);
  const projections = await computeInventoryProjections(org.id, days);
  return res.json({ projections });
});

v1Router.get("/inventory/demand-forecast", async (_req, res) => {
  const org = await getPrimaryOrganization();
  const days = parseInt(String(_req.query.days ?? "7"), 10);
  const forecast = await computeDemandForecast(org.id, days);
  return res.json({ forecast });
});

v1Router.get("/inventory/waste-summary", async (_req, res) => {
  const org = await getPrimaryOrganization();
  const lookback = parseInt(String(_req.query.lookback ?? "30"), 10);
  const waste = await computeWasteSummary(org.id, lookback);
  return res.json({ waste });
});

v1Router.get("/inventory/allocation", async (_req, res) => {
  const org = await getPrimaryOrganization();
  const allocation = await computeAllocationSummary(org.id);
  return res.json({ allocation });
});

v1Router.patch("/inventory/par-levels", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { updates } = req.body as {
    updates: { ingredientId: string; parLevelG?: number | null; reorderPointG?: number | null }[];
  };

  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: "updates array is required" });
  }

  const results = await prisma.$transaction(
    updates.map((u) =>
      prisma.ingredientCatalog.update({
        where: { id: u.ingredientId },
        data: {
          ...(u.parLevelG !== undefined ? { parLevelG: u.parLevelG } : {}),
          ...(u.reorderPointG !== undefined ? { reorderPointG: u.reorderPointG } : {}),
        },
        select: { id: true, name: true, parLevelG: true, reorderPointG: true },
      })
    )
  );

  return res.json({ updated: results });
});

// ─── Sprint 1B: Instacart Mapping UX ─────────────────────────────────

/** GET /v1/mappings/unmapped — unmapped line item queue */
v1Router.get("/mappings/unmapped", async (req, res) => {
  const org = await getPrimaryOrganization();
  const tasks = await prisma.verificationTask.findMany({
    where: {
      organizationId: org.id,
      taskType: "SOURCE_RETRIEVAL",
      status: { in: ["OPEN"] },
    },
    orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
  });

  const unmapped = tasks
    .filter((t) => {
      const payload = t.payload as Record<string, unknown>;
      return payload?.row || payload?.confidence !== undefined;
    })
    .map((t) => {
      const payload = t.payload as Record<string, unknown>;
      const row = (payload.row ?? {}) as Record<string, unknown>;
      return {
        taskId: t.id,
        severity: t.severity,
        productName: row.productName ?? t.title,
        brand: row.brand ?? null,
        upc: row.upc ?? null,
        quantity: row.qty ?? null,
        unit: row.unit ?? null,
        confidence: payload.confidence ?? null,
        ingredientKeyHint: row.ingredientKeyHint ?? payload.ingredientKeyHint ?? null,
        createdAt: t.createdAt,
      };
    });

  return res.json({ unmapped, count: unmapped.length });
});

/** GET /v1/mappings/suggestions?productName=...&brand=...&upc=... — candidate suggestions */
v1Router.get("/mappings/suggestions", async (req, res) => {
  const org = await getPrimaryOrganization();
  const productName = String(req.query.productName ?? "");
  const brand = req.query.brand ? String(req.query.brand) : null;
  const upc = req.query.upc ? String(req.query.upc) : null;

  if (!productName) return res.status(400).json({ error: "productName is required" });

  // Fetch all ingredients and products for scoring
  const ingredients = await prisma.ingredientCatalog.findMany({
    where: { organizationId: org.id, active: true },
    include: {
      products: { where: { active: true }, select: { id: true, name: true, brand: true, upc: true } },
    },
  });

  // Build historical mapping lookup
  const existingMappings = await prisma.instacartMapping.findMany({
    where: { organizationId: org.id, active: true },
    select: { sourceProductName: true, sourceBrand: true, ingredientId: true },
  });
  const historicalMap = new Map<string, string>();
  for (const m of existingMappings) {
    const key = [m.sourceProductName, m.sourceBrand].filter(Boolean).join(" ").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    historicalMap.set(key, m.ingredientId);
  }

  // Build candidate list: one entry per ingredient, one per product
  type Candidate = {
    ingredientId: string;
    ingredientName: string;
    ingredientCategory: string;
    productId?: string;
    productName?: string;
    productBrand?: string;
    productUpc?: string;
  };

  const candidates: Candidate[] = [];
  for (const ing of ingredients) {
    // Ingredient-level candidate
    candidates.push({
      ingredientId: ing.id,
      ingredientName: ing.name,
      ingredientCategory: ing.category,
    });
    // Product-level candidates
    for (const prod of ing.products) {
      candidates.push({
        ingredientId: ing.id,
        ingredientName: ing.name,
        ingredientCategory: ing.category,
        productId: prod.id,
        productName: prod.name,
        productBrand: prod.brand ?? undefined,
        productUpc: prod.upc ?? undefined,
      });
    }
  }

  // Import scoring engine dynamically (ESM)
  const { rankCandidates, classifyConfidence } = await import("@nutrition/nutrition-engine/mapping-score");

  const ranked = rankCandidates(
    { productName, brand, upc },
    candidates,
    historicalMap
  );

  // Return top 10 suggestions
  const suggestions = ranked.slice(0, 10).map((s) => ({
    ingredientId: s.candidate.ingredientId,
    ingredientName: s.candidate.ingredientName,
    ingredientCategory: s.candidate.ingredientCategory,
    productId: s.candidate.productId,
    productName: s.candidate.productName,
    productBrand: s.candidate.productBrand,
    productUpc: s.candidate.productUpc,
    totalScore: Math.round(s.totalScore * 1000) / 1000,
    confidence: classifyConfidence(s.totalScore),
    isExactUpc: s.isExactUpc,
    isHistorical: s.isHistorical,
    factors: s.factors,
  }));

  return res.json({ suggestions, query: { productName, brand, upc } });
});

/** POST /v1/mappings/resolve — resolve a mapping (approve, create new, mark pantry) */
v1Router.post("/mappings/resolve", async (req, res) => {
  const org = await getPrimaryOrganization();
  const user = await getDefaultUser();
  const {
    taskId,
    action,
    ingredientId,
    productId,
    newIngredientName,
    newIngredientCategory,
    pantryReason,
  } = req.body as {
    taskId: string;
    action: "approve" | "search_select" | "create_new" | "mark_pantry";
    ingredientId?: string;
    productId?: string;
    newIngredientName?: string;
    newIngredientCategory?: string;
    pantryReason?: string;
  };

  if (!taskId || !action) return res.status(400).json({ error: "taskId and action required" });

  const task = await prisma.verificationTask.findUnique({ where: { id: taskId } });
  if (!task || task.organizationId !== org.id) return res.status(404).json({ error: "task not found" });
  if (task.status !== "OPEN") return res.status(400).json({ error: "task already resolved" });

  const payload = task.payload as Record<string, unknown>;
  const row = (payload.row ?? {}) as Record<string, unknown>;
  const sourceName = String(row.productName ?? "");
  const sourceBrand = row.brand ? String(row.brand) : null;
  const sourceUpc = row.upc ? String(row.upc) : null;

  let resolvedIngredientId = ingredientId;
  let resolutionSource: MappingResolutionSource;
  let decision: string;

  switch (action) {
    case "approve":
      if (!ingredientId) return res.status(400).json({ error: "ingredientId required for approve" });
      resolutionSource = "MANUAL_APPROVED_SUGGESTION" as MappingResolutionSource;
      decision = `Approved mapping: ${sourceName} → ingredient ${ingredientId}`;
      break;

    case "search_select":
      if (!ingredientId) return res.status(400).json({ error: "ingredientId required for search_select" });
      resolutionSource = "MANUAL_SEARCH_SELECT" as MappingResolutionSource;
      decision = `Manual select: ${sourceName} → ingredient ${ingredientId}`;
      break;

    case "create_new":
      if (!newIngredientName) return res.status(400).json({ error: "newIngredientName required" });
      const newIng = await prisma.ingredientCatalog.create({
        data: {
          organizationId: org.id,
          canonicalKey: newIngredientName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
          name: newIngredientName,
          category: newIngredientCategory ?? "UNMAPPED",
        },
      });
      resolvedIngredientId = newIng.id;
      resolutionSource = "MANUAL_CREATE_NEW" as MappingResolutionSource;
      decision = `Created new ingredient: ${newIngredientName} (${newIng.id})`;
      break;

    case "mark_pantry":
      // Mark as non-tracked pantry item, resolve the task
      await prisma.verificationTask.update({
        where: { id: taskId },
        data: { status: "RESOLVED" },
      });
      await prisma.verificationReview.create({
        data: {
          verificationTaskId: taskId,
          reviewedByUserId: user.id,
          decision: `Marked as pantry/non-tracked: ${pantryReason ?? "no reason given"}`,
        },
      });
      return res.json({ resolved: true, action: "mark_pantry", taskId });

    default:
      return res.status(400).json({ error: `unknown action: ${action}` });
  }

  if (!resolvedIngredientId) return res.status(400).json({ error: "could not resolve ingredient" });

  // Save mapping memory
  await prisma.instacartMapping.upsert({
    where: {
      organizationId_sourceProductName_sourceBrand: {
        organizationId: org.id,
        sourceProductName: sourceName,
        sourceBrand: sourceBrand ?? "",
      },
    },
    update: {
      ingredientId: resolvedIngredientId,
      productId: productId ?? null,
      resolutionSource,
      timesUsed: { increment: 1 },
      lastUsedAt: new Date(),
    },
    create: {
      organizationId: org.id,
      sourceProductName: sourceName,
      sourceBrand: sourceBrand,
      sourceUpc: sourceUpc,
      ingredientId: resolvedIngredientId,
      productId: productId ?? null,
      resolutionSource,
      confidenceScore: 1.0,
    },
  });

  // Resolve verification task
  await prisma.verificationTask.update({
    where: { id: taskId },
    data: { status: "RESOLVED" },
  });
  await prisma.verificationReview.create({
    data: {
      verificationTaskId: taskId,
      reviewedByUserId: user.id,
      decision,
    },
  });

  return res.json({
    resolved: true,
    action,
    taskId,
    ingredientId: resolvedIngredientId,
    productId: productId ?? null,
  });
});

/** GET /v1/mappings/history — learned mappings list */
v1Router.get("/mappings/history", async (_req, res) => {
  const org = await getPrimaryOrganization();
  const mappings = await prisma.instacartMapping.findMany({
    where: { organizationId: org.id },
    include: {
      ingredient: { select: { id: true, name: true, category: true } },
      product: { select: { id: true, name: true, brand: true } },
    },
    orderBy: { lastUsedAt: "desc" },
    take: 200,
  });
  return res.json({ mappings, count: mappings.length });
});

// ─── Sprint 1B: Substitution Engine ──────────────────────────────────

/** GET /v1/substitutions/suggest?ingredientId=...&requiredG=... — substitution suggestions */
v1Router.get("/substitutions/suggest", async (req, res) => {
  const org = await getPrimaryOrganization();
  const ingredientId = String(req.query.ingredientId ?? "");
  const requiredG = parseFloat(String(req.query.requiredG ?? "100"));
  const mealScheduleId = req.query.mealScheduleId ? String(req.query.mealScheduleId) : null;

  if (!ingredientId) return res.status(400).json({ error: "ingredientId required" });

  // Get original ingredient
  const original = await prisma.ingredientCatalog.findUnique({
    where: { id: ingredientId },
    include: {
      products: {
        where: { active: true },
        include: {
          nutrients: {
            include: { nutrientDefinition: true },
          },
        },
        take: 1,
      },
    },
  });
  if (!original || original.organizationId !== org.id) return res.status(404).json({ error: "ingredient not found" });

  // Get client exclusions (if meal context)
  let clientExclusions: string[] = [];
  if (mealScheduleId) {
    const schedule = await prisma.mealSchedule.findUnique({
      where: { id: mealScheduleId },
      include: { client: { select: { exclusions: true } } },
    });
    clientExclusions = schedule?.client?.exclusions ?? [];
  }

  // Build original nutrient profile
  const origNutrients: Record<string, number> = {};
  if (original.products[0]) {
    for (const nv of original.products[0].nutrients) {
      if (nv.valuePer100g !== null) {
        origNutrients[nv.nutrientDefinition.key] = nv.valuePer100g;
      }
    }
  }

  // Get all same-category ingredients with available inventory
  const sameCategory = await prisma.ingredientCatalog.findMany({
    where: {
      organizationId: org.id,
      category: original.category,
      active: true,
      id: { not: ingredientId },
    },
    include: {
      products: {
        where: { active: true },
        include: {
          nutrients: { include: { nutrientDefinition: true } },
          inventoryLots: {
            where: { quantityAvailableG: { gt: 0 } },
            select: { quantityAvailableG: true },
          },
        },
      },
    },
  });

  // Also get other-category ingredients (scored lower but available)
  const otherCategory = await prisma.ingredientCatalog.findMany({
    where: {
      organizationId: org.id,
      category: { not: original.category },
      active: true,
      id: { not: ingredientId },
    },
    include: {
      products: {
        where: { active: true },
        include: {
          nutrients: { include: { nutrientDefinition: true } },
          inventoryLots: {
            where: { quantityAvailableG: { gt: 0 } },
            select: { quantityAvailableG: true },
          },
        },
      },
    },
    take: 20,
  });

  // Build candidate list
  type SubCandidate = {
    ingredientId: string;
    ingredientName: string;
    category: string;
    allergenTags: string[];
    availableG: number;
    nutrientsPer100g: Record<string, number | undefined>;
  };

  const buildCandidates = (ingredients: typeof sameCategory): SubCandidate[] =>
    ingredients
      .filter((i) => i.products.length > 0)
      .map((i) => {
        const nutrients: Record<string, number | undefined> = {};
        for (const nv of i.products[0]!.nutrients) {
          if (nv.valuePer100g !== null) {
            nutrients[nv.nutrientDefinition.key] = nv.valuePer100g;
          }
        }
        const availableG = i.products.reduce(
          (sum, p) => sum + p.inventoryLots.reduce((s, l) => s + l.quantityAvailableG, 0),
          0
        );
        return {
          ingredientId: i.id,
          ingredientName: i.name,
          category: i.category,
          allergenTags: i.allergenTags,
          availableG,
          nutrientsPer100g: nutrients,
        };
      });

  const candidates = [...buildCandidates(sameCategory), ...buildCandidates(otherCategory)];

  const { rankSubstitutions, classifySubstitution } = await import("@nutrition/nutrition-engine/substitution-engine");

  const ranked = rankSubstitutions(
    {
      originalIngredient: {
        ingredientId: original.id,
        ingredientName: original.name,
        category: original.category,
        allergenTags: original.allergenTags,
        nutrientsPer100g: origNutrients,
      },
      requiredG,
      clientExclusions,
    },
    candidates as any
  );

  const suggestions = ranked.slice(0, 10).map((s) => ({
    ingredientId: s.candidate.ingredientId,
    ingredientName: s.candidate.ingredientName,
    category: s.candidate.category,
    availableG: s.candidate.availableG,
    totalScore: Math.round(s.totalScore * 1000) / 1000,
    quality: classifySubstitution(s),
    allergenSafe: s.allergenSafe,
    sufficientInventory: s.sufficientInventory,
    nutrientDeltas: s.nutrientDeltas,
    totalNutrientDeltaPercent: Math.round(s.totalNutrientDeltaPercent * 10) / 10,
    factors: s.factors,
    warnings: s.warnings,
  }));

  return res.json({
    suggestions,
    original: { ingredientId: original.id, ingredientName: original.name, category: original.category },
    query: { requiredG, mealScheduleId },
  });
});

/** POST /v1/substitutions/apply — apply a substitution to future meals */
v1Router.post("/substitutions/apply", async (req, res) => {
  const org = await getPrimaryOrganization();
  const {
    mealScheduleId,
    batchProductionId,
    originalIngredientId,
    substituteIngredientId,
    reason,
    nutrientDelta,
    rankScore,
    rankFactors,
  } = req.body as {
    mealScheduleId?: string;
    batchProductionId?: string;
    originalIngredientId: string;
    substituteIngredientId: string;
    reason: string;
    nutrientDelta?: Record<string, unknown>;
    rankScore?: number;
    rankFactors?: Record<string, unknown>;
  };

  if (!originalIngredientId || !substituteIngredientId || !reason) {
    return res.status(400).json({ error: "originalIngredientId, substituteIngredientId, and reason required" });
  }

  // Verify meal is PLANNED (future only — never touch served/frozen)
  if (mealScheduleId) {
    const schedule = await prisma.mealSchedule.findUnique({ where: { id: mealScheduleId } });
    if (!schedule || schedule.organizationId !== org.id) return res.status(404).json({ error: "schedule not found" });
    if (schedule.status !== "PLANNED") {
      return res.status(400).json({ error: "Can only substitute for PLANNED meals, not served/frozen ones" });
    }
  }

  const record = await prisma.substitutionRecord.create({
    data: {
      organizationId: org.id,
      mealScheduleId,
      batchProductionId,
      originalIngredientId,
      substituteIngredientId,
      reason,
      status: "APPLIED" as SubstitutionStatus,
      nutrientDelta: (nutrientDelta ?? undefined) as any,
      rankScore,
      rankFactors: (rankFactors ?? undefined) as any,
      appliedAt: new Date(),
    },
  });

  return res.json({ substitution: record });
});

/** GET /v1/substitutions — list substitution history */
v1Router.get("/substitutions", async (req, res) => {
  const org = await getPrimaryOrganization();
  const status = req.query.status ? String(req.query.status) : undefined;
  const records = await prisma.substitutionRecord.findMany({
    where: {
      organizationId: org.id,
      ...(status ? { status: status as SubstitutionStatus } : {}),
    },
    include: {
      originalIngredient: { select: { id: true, name: true, category: true } },
      substituteIngredient: { select: { id: true, name: true, category: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return res.json({ substitutions: records, count: records.length });
});

// ── Sprint 2: Yield Calibration + QC ─────────────────

/** GET /v1/yield-calibrations — list yield calibration records */
v1Router.get("/yield-calibrations", async (req, res) => {
  const org = await getPrimaryOrganization();
  const componentId = req.query.componentId ? String(req.query.componentId) : undefined;
  const status = req.query.status ? String(req.query.status) as CalibrationStatus : undefined;

  const records = await prisma.yieldCalibration.findMany({
    where: {
      organizationId: org.id,
      ...(componentId ? { componentId } : {}),
      ...(status ? { status } : {}),
    },
    include: {
      component: { select: { id: true, name: true, componentType: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return res.json({ calibrations: records, count: records.length });
});

/** GET /v1/yield-calibrations/proposals — generate calibration proposals from batch history */
v1Router.get("/yield-calibrations/proposals", async (req, res) => {
  const org = await getPrimaryOrganization();
  const componentId = req.query.componentId ? String(req.query.componentId) : undefined;

  // Find components with completed batches that have yield data
  const batches = await prisma.batchProduction.findMany({
    where: {
      organizationId: org.id,
      status: BatchStatus.READY,
      actualYieldG: { not: null },
      ...(componentId ? { componentId } : {}),
    },
    include: {
      component: { select: { id: true, name: true, componentType: true } },
    },
    orderBy: { completedAt: "desc" },
  });

  // Group by component
  const componentGroups = new Map<string, typeof batches>();
  for (const batch of batches) {
    const existing = componentGroups.get(batch.componentId) ?? [];
    existing.push(batch);
    componentGroups.set(batch.componentId, existing);
  }

  const { generateCalibrationProposal } = await import("@nutrition/nutrition-engine/yield-calibration");

  const proposals = [];
  for (const [compId, compBatches] of componentGroups.entries()) {
    const first = compBatches[0];
    if (!first) continue;
    const comp = first.component;
    const samples = compBatches.map((b) => {
      const expectedYieldPct = b.rawInputG > 0 ? (b.expectedYieldG / b.rawInputG) * 100 : 0;
      const actualYieldPct = b.rawInputG > 0 && b.actualYieldG ? (b.actualYieldG / b.rawInputG) * 100 : 0;
      return {
        batchId: b.id,
        expectedYieldPct,
        actualYieldPct,
        variancePct: expectedYieldPct > 0 ? ((actualYieldPct - expectedYieldPct) / expectedYieldPct) * 100 : 0,
        createdAt: b.createdAt.toISOString(),
      };
    });

    // Use first batch's expected yield as default
    const defaultYieldPct = samples[0]?.expectedYieldPct ?? 85;
    const proposal = generateCalibrationProposal(compId, comp.name, defaultYieldPct, samples);
    proposals.push(proposal);
  }

  return res.json({ proposals, count: proposals.length });
});

/** POST /v1/yield-calibrations — record a yield calibration entry */
v1Router.post("/yield-calibrations", async (req, res) => {
  const body = validateBody(createYieldCalibrationBodySchema, req.body, res);
  if (!body) return;
  const { componentId, method, cutForm, expectedYieldPct, actualYieldPct, batchProductionId } = body;
  const org = await getPrimaryOrganization();

  const variancePct = expectedYieldPct > 0
    ? ((actualYieldPct - expectedYieldPct) / expectedYieldPct) * 100
    : 0;

  const { classifyVariance } = await import("@nutrition/nutrition-engine/yield-calibration");
  const severity = classifyVariance(variancePct);

  const record = await prisma.yieldCalibration.create({
    data: {
      organizationId: org.id,
      componentId,
      method,
      cutForm,
      expectedYieldPct,
      actualYieldPct,
      variancePct,
      batchProductionId,
      status: "PENDING_REVIEW" as CalibrationStatus,
    },
  });

  // Auto-create QC issue for high variance
  if (batchProductionId && (severity === "warning" || severity === "critical")) {
    await prisma.qcIssue.create({
      data: {
        organizationId: org.id,
        batchProductionId,
        issueType: (severity === "critical" ? "YIELD_VARIANCE_CRITICAL" : "YIELD_VARIANCE_HIGH") as QcIssueType,
        description: `Yield variance ${variancePct.toFixed(1)}% (expected ${expectedYieldPct}%, actual ${actualYieldPct}%)`,
        expectedValue: `${expectedYieldPct}%`,
        actualValue: `${actualYieldPct}%`,
      },
    });
  }

  return res.json({ calibration: record, varianceSeverity: severity });
});

/** PATCH /v1/yield-calibrations/:id/review — accept or reject a calibration */
v1Router.patch("/yield-calibrations/:id/review", async (req, res) => {
  const body = validateBody(reviewYieldCalibrationBodySchema, req.body, res);
  if (!body) return;
  const { status, reviewNotes } = body;
  const org = await getPrimaryOrganization();
  const { id } = req.params;

  const existing = await prisma.yieldCalibration.findUnique({ where: { id } });
  if (!existing || existing.organizationId !== org.id) {
    return res.status(404).json({ error: "calibration not found" });
  }

  const updated = await prisma.yieldCalibration.update({
    where: { id },
    data: {
      status: status as CalibrationStatus,
      reviewedBy: "system",
      reviewNotes,
      version: { increment: 1 },
    },
  });

  return res.json({ calibration: updated });
});

/** GET /v1/yield-calibrations/variance-analytics — variance summary by component */
v1Router.get("/yield-calibrations/variance-analytics", async (req, res) => {
  const org = await getPrimaryOrganization();

  const records = await prisma.yieldCalibration.findMany({
    where: { organizationId: org.id },
    include: {
      component: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const { classifyVariance, mean, stdDev } = await import("@nutrition/nutrition-engine/yield-calibration");

  // Group by component
  const byComponent = new Map<string, typeof records>();
  for (const r of records) {
    const existing = byComponent.get(r.componentId) ?? [];
    existing.push(r);
    byComponent.set(r.componentId, existing);
  }

  const analytics = Array.from(byComponent.entries()).map(([compId, recs]) => {
    const actuals = recs.map((r) => r.actualYieldPct);
    const variances = recs.map((r) => r.variancePct);
    const severities = variances.map((v) => classifyVariance(v));

    return {
      componentId: compId,
      componentName: recs[0]!.component.name,
      sampleCount: recs.length,
      meanActualYieldPct: Math.round(mean(actuals) * 100) / 100,
      stdDevPct: Math.round(stdDev(actuals) * 100) / 100,
      meanVariancePct: Math.round(mean(variances) * 100) / 100,
      normalCount: severities.filter((s) => s === "normal").length,
      warningCount: severities.filter((s) => s === "warning").length,
      criticalCount: severities.filter((s) => s === "critical").length,
    };
  });

  return res.json({ analytics, count: analytics.length });
});

/** GET /v1/qc-issues — list QC issues */
v1Router.get("/qc-issues", async (req, res) => {
  const org = await getPrimaryOrganization();
  const batchId = req.query.batchId ? String(req.query.batchId) : undefined;
  const issueType = req.query.issueType ? String(req.query.issueType) as QcIssueType : undefined;
  const resolved = req.query.resolved;

  const records = await prisma.qcIssue.findMany({
    where: {
      organizationId: org.id,
      ...(batchId ? { batchProductionId: batchId } : {}),
      ...(issueType ? { issueType } : {}),
      ...(resolved === "true" ? { resolvedAt: { not: null } } : {}),
      ...(resolved === "false" ? { resolvedAt: null } : {}),
    },
    include: {
      batchProduction: { select: { id: true, batchCode: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return res.json({ issues: records, count: records.length });
});

/** POST /v1/qc-issues — create a QC issue */
v1Router.post("/qc-issues", async (req, res) => {
  const body = validateBody(createQcIssueBodySchema, req.body, res);
  if (!body) return;
  const { batchProductionId, issueType, description, expectedValue, actualValue } = body;
  const org = await getPrimaryOrganization();

  const record = await prisma.qcIssue.create({
    data: {
      organizationId: org.id,
      batchProductionId,
      issueType: issueType as QcIssueType,
      description,
      expectedValue,
      actualValue,
    },
  });

  return res.json({ issue: record });
});

/** PATCH /v1/qc-issues/:id/override — override/resolve a QC issue */
v1Router.patch("/qc-issues/:id/override", async (req, res) => {
  const body = validateBody(overrideQcIssueBodySchema, req.body, res);
  if (!body) return;
  const { overrideReason } = body;
  const org = await getPrimaryOrganization();
  const { id } = req.params;

  const existing = await prisma.qcIssue.findUnique({ where: { id } });
  if (!existing || existing.organizationId !== org.id) {
    return res.status(404).json({ error: "issue not found" });
  }
  if (!existing.overrideAllowed) {
    return res.status(403).json({ error: "Override not allowed for this issue type" });
  }

  const updated = await prisma.qcIssue.update({
    where: { id },
    data: {
      overrideReason,
      overrideBy: "system",
      resolvedAt: new Date(),
      version: { increment: 1 },
    },
  });

  return res.json({ issue: updated });
});

/** POST /v1/batches/:id/validate-checkpoint — validate checkpoint gate for status transition */
v1Router.post("/batches/:id/validate-checkpoint", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { id } = req.params;
  const { targetStatus } = req.body as { targetStatus: string };

  if (!targetStatus) {
    return res.status(400).json({ error: "targetStatus required" });
  }

  const batch = await prisma.batchProduction.findUnique({
    where: { id },
    include: { checkpoints: { select: { checkpointType: true } } },
  });

  if (!batch || batch.organizationId !== org.id) {
    return res.status(404).json({ error: "batch not found" });
  }

  const { validateCheckpointGate } = await import("@nutrition/nutrition-engine/yield-calibration");
  const existingTypes = batch.checkpoints.map((c) => c.checkpointType);
  const result = validateCheckpointGate(targetStatus, existingTypes);

  return res.json({
    batchId: id,
    targetStatus,
    ...result,
  });
});

// ── Sprint 3: Composition Templates + Menu Composer + Prep Optimizer ──

/** GET /v1/compositions — list composition templates */
v1Router.get("/compositions", async (req, res) => {
  const org = await getPrimaryOrganization();
  const templates = await prisma.compositionTemplate.findMany({
    where: { organizationId: org.id, active: true },
    include: {
      slots: {
        include: { component: { select: { id: true, name: true, componentType: true } } },
        orderBy: { slotOrder: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return res.json({ compositions: templates, count: templates.length });
});

/** GET /v1/compositions/:id — get single composition template */
v1Router.get("/compositions/:id", async (req, res) => {
  const org = await getPrimaryOrganization();
  const template = await prisma.compositionTemplate.findUnique({
    where: { id: req.params.id },
    include: {
      slots: {
        include: { component: { select: { id: true, name: true, componentType: true } } },
        orderBy: { slotOrder: "asc" },
      },
    },
  });
  if (!template || template.organizationId !== org.id) {
    return res.status(404).json({ error: "composition not found" });
  }
  return res.json({ composition: template });
});

/** POST /v1/compositions — create a composition template */
v1Router.post("/compositions", async (req, res) => {
  const org = await getPrimaryOrganization();
  const {
    name,
    description,
    targetKcal,
    targetProteinG,
    targetCarbG,
    targetFatG,
    allergenTags,
    flavorProfiles,
    slots,
  } = req.body as {
    name: string;
    description?: string;
    targetKcal?: number;
    targetProteinG?: number;
    targetCarbG?: number;
    targetFatG?: number;
    allergenTags?: string[];
    flavorProfiles?: string[];
    slots: { slotType: string; componentId?: string; targetG: number; portionG?: number; sauceVariantId?: string; slotOrder: number; required?: boolean }[];
  };

  if (!name || !Array.isArray(slots) || slots.length === 0) {
    return res.status(400).json({ error: "name and at least one slot required" });
  }

  const template = await prisma.compositionTemplate.create({
    data: {
      organizationId: org.id,
      name,
      description,
      targetKcal,
      targetProteinG,
      targetCarbG,
      targetFatG,
      allergenTags: allergenTags ?? [],
      flavorProfiles: (flavorProfiles ?? []) as any,
      slots: {
        create: slots.map((s) => ({
          slotType: s.slotType as ComponentType,
          componentId: s.componentId ?? null,
          targetG: s.targetG,
          portionG: s.portionG ?? null,
          sauceVariantId: s.sauceVariantId ?? null,
          slotOrder: s.slotOrder,
          required: s.required ?? true,
        })),
      },
    },
    include: {
      slots: {
        include: { component: { select: { id: true, name: true, componentType: true } } },
        orderBy: { slotOrder: "asc" },
      },
    },
  });

  return res.json({ composition: template });
});

/** POST /v1/compositions/:id/preview — preview macro aggregation for a composition */
v1Router.post("/compositions/:id/preview", async (req, res) => {
  const org = await getPrimaryOrganization();
  const template = await prisma.compositionTemplate.findUnique({
    where: { id: req.params.id },
    include: {
      slots: {
        include: {
          component: {
            include: {
              lines: {
                include: { ingredient: { select: { id: true, name: true, allergenTags: true } } },
              },
            },
          },
        },
        orderBy: { slotOrder: "asc" },
      },
    },
  });

  if (!template || template.organizationId !== org.id) {
    return res.status(404).json({ error: "composition not found" });
  }

  const { aggregateComposition, checkAllergenWarnings } = await import("@nutrition/nutrition-engine/composition-engine");

  // Build slot inputs from component data
  const slotInputs = template.slots
    .filter((s) => s.component)
    .map((s) => {
      const comp = s.component!;
      // Approximate nutrients per 100g from component lines
      // In a real implementation this would come from cached nutrient data
      return {
        slotType: s.slotType,
        componentId: comp.id,
        componentName: comp.name,
        targetG: s.targetG,
        portionG: s.portionG ?? undefined,
        nutrientsPer100g: {
          kcal: 0,
          proteinG: 0,
          carbG: 0,
          fatG: 0,
        },
        allergenTags: comp.allergenTags,
        flavorProfiles: comp.flavorProfiles,
      };
    });

  const clientExclusions = req.body.clientExclusions ?? [];
  const result = aggregateComposition(slotInputs);
  const allergenCheck = checkAllergenWarnings(slotInputs, clientExclusions as string[]);

  return res.json({
    preview: result,
    allergenCheck,
    template: { id: template.id, name: template.name },
  });
});

/** DELETE /v1/compositions/:id — soft delete (deactivate) a composition template */
v1Router.delete("/compositions/:id", async (req, res) => {
  const org = await getPrimaryOrganization();
  const existing = await prisma.compositionTemplate.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.organizationId !== org.id) {
    return res.status(404).json({ error: "composition not found" });
  }

  await prisma.compositionTemplate.update({
    where: { id: req.params.id },
    data: { active: false, version: { increment: 1 } },
  });

  return res.json({ deleted: true });
});

/** POST /v1/prep-drafts — generate a weekly prep draft (optionally schedule-aware) */
v1Router.post("/prep-drafts", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { weekStart, weekEnd, scheduleAware } = req.body as {
    weekStart: string;
    weekEnd: string;
    scheduleAware?: boolean;
  };

  if (!weekStart || !weekEnd) {
    return res.status(400).json({ error: "weekStart and weekEnd required" });
  }

  const start = new Date(weekStart);
  const end = new Date(weekEnd);

  // Get planned meals in the week (Sku → Recipe → RecipeLine → ingredient)
  const schedules = await prisma.mealSchedule.findMany({
    where: {
      organizationId: org.id,
      status: "PLANNED" as ScheduleStatus,
      serviceDate: { gte: start, lte: end },
      skuId: { not: null },
    },
    include: {
      sku: {
        include: {
          recipes: {
            where: { active: true },
            include: {
              lines: {
                include: { ingredient: { select: { id: true, name: true, category: true } } },
              },
            },
            take: 1,
          },
        },
      },
      client: scheduleAware ? { select: { id: true, fullName: true } } : false,
    },
  });

  // Build meal demands from schedule → sku → recipe → lines
  type MealEntry = {
    mealId: string;
    serviceDate: string;
    componentId: string;
    componentName: string;
    componentType: string;
    cookedG: number;
    clientId?: string;
    clientName?: string;
    mealSlot?: string;
  };
  const meals: MealEntry[] = [];

  for (const s of schedules) {
    const recipe = s.sku?.recipes?.[0];
    if (!recipe?.lines) continue;
    for (const line of recipe.lines) {
      const entry: MealEntry = {
        mealId: s.id,
        serviceDate: s.serviceDate.toISOString().slice(0, 10),
        componentId: line.ingredientId,
        componentName: line.ingredient.name,
        componentType: line.ingredient.category,
        cookedG: line.targetGPerServing * (recipe.servings ?? 1),
      };
      // Enrich with client info for schedule-aware mode
      if (scheduleAware && (s as any).client) {
        entry.clientId = s.clientId;
        entry.clientName = (s as any).client.fullName;
        entry.mealSlot = s.mealSlot;
      }
      meals.push(entry);
    }
  }

  // Get yield info from calibrations
  const calibrations = await prisma.yieldCalibration.findMany({
    where: {
      organizationId: org.id,
      status: "ACCEPTED" as CalibrationStatus,
    },
    orderBy: { createdAt: "desc" },
  });

  const yieldMap = new Map<string, { yieldFactor: number; basis: "calibrated" | "default" }>();
  for (const cal of calibrations) {
    if (!yieldMap.has(cal.componentId) && cal.proposedYieldPct) {
      yieldMap.set(cal.componentId, {
        yieldFactor: cal.proposedYieldPct / 100,
        basis: "calibrated",
      });
    }
  }

  const yields = Array.from(yieldMap.entries()).map(([id, info]) => ({
    componentId: id,
    ...info,
  }));

  // Get inventory on hand (productId → ingredientId via product catalog)
  const lots = await prisma.inventoryLot.findMany({
    where: {
      organizationId: org.id,
      quantityAvailableG: { gt: 0 },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: { product: { select: { ingredientId: true } } },
  });

  const inventoryMap = new Map<string, number>();
  for (const lot of lots) {
    const ingId = lot.product.ingredientId;
    const current = inventoryMap.get(ingId) ?? 0;
    inventoryMap.set(ingId, current + lot.quantityAvailableG);
  }

  const inventory = Array.from(inventoryMap.entries()).map(([id, g]) => ({
    componentId: id,
    availableG: g,
  }));

  let draft;
  if (scheduleAware) {
    const { generateScheduleAwarePrepDraft } = await import("@nutrition/nutrition-engine/prep-optimizer");
    draft = generateScheduleAwarePrepDraft(weekStart, weekEnd, meals, yields, inventory);
  } else {
    const { generatePrepDraft } = await import("@nutrition/nutrition-engine/prep-optimizer");
    draft = generatePrepDraft(weekStart, weekEnd, meals, yields, inventory);
  }

  // Save to DB
  const record = await prisma.prepDraft.create({
    data: {
      organizationId: org.id,
      weekStart: start,
      weekEnd: end,
      status: "DRAFT" as PrepDraftStatus,
      demandPayload: draft.demand as any,
      batchSuggestions: draft.batchSuggestions as any,
      shortages: draft.shortages as any,
    },
  });

  return res.json({ draft: { ...draft, id: record.id } });
});

/** GET /v1/prep-drafts — list prep drafts */
v1Router.get("/prep-drafts", async (req, res) => {
  const org = await getPrimaryOrganization();
  const records = await prisma.prepDraft.findMany({
    where: { organizationId: org.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return res.json({ drafts: records, count: records.length });
});

/** PATCH /v1/prep-drafts/:id/approve — approve a prep draft */
v1Router.patch("/prep-drafts/:id/approve", async (req, res) => {
  const org = await getPrimaryOrganization();
  const existing = await prisma.prepDraft.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.organizationId !== org.id) {
    return res.status(404).json({ error: "prep draft not found" });
  }
  if (existing.status !== "DRAFT") {
    return res.status(400).json({ error: `Cannot approve draft in status ${existing.status}` });
  }

  const updated = await prisma.prepDraft.update({
    where: { id: req.params.id },
    data: {
      status: "APPROVED" as PrepDraftStatus,
      approvedAt: new Date(),
      approvedBy: "system",
      version: { increment: 1 },
    },
  });

  return res.json({ draft: updated });
});

/** GET /v1/sauce-matrix — sauce matrix data (flavor families, pairings, portion presets) */
v1Router.get("/sauce-matrix", async (req, res) => {
  const org = await getPrimaryOrganization();

  // Get all sauce components with variants and pairings
  const sauces = await prisma.component.findMany({
    where: {
      organizationId: org.id,
      componentType: "SAUCE" as ComponentType,
      active: true,
    },
    include: {
      sauceVariants: { where: { active: true } },
      saucePairings: true,
    },
    orderBy: { name: "asc" },
  });

  const matrix = sauces.map((sauce) => ({
    id: sauce.id,
    name: sauce.name,
    flavorProfiles: sauce.flavorProfiles,
    allergenTags: sauce.allergenTags,
    variants: sauce.sauceVariants.map((v) => ({
      id: v.id,
      type: v.variantType,
      kcalPer100g: v.kcalPer100g,
      proteinPer100g: v.proteinPer100g,
      carbPer100g: v.carbPer100g,
      fatPer100g: v.fatPer100g,
      portionPresets: [5, 10, 15, 20, 30].map((g) => ({
        portionG: g,
        kcal: v.kcalPer100g ? Math.round(v.kcalPer100g * g) / 100 : null,
        proteinG: v.proteinPer100g ? Math.round(v.proteinPer100g * g) / 100 : null,
        carbG: v.carbPer100g ? Math.round(v.carbPer100g * g) / 100 : null,
        fatG: v.fatPer100g ? Math.round(v.fatPer100g * g) / 100 : null,
      })),
    })),
    pairings: sauce.saucePairings.map((p) => ({
      pairedComponentType: p.pairedComponentType,
      recommended: p.recommended,
      defaultPortionG: p.defaultPortionG,
    })),
  }));

  return res.json({ sauces: matrix, count: matrix.length });
});

// ── Sprint 4: Biometrics, Documents, Metrics, File Storage ──────────

/** GET /v1/clients/:clientId/biometrics — list biometric snapshots */
v1Router.get("/clients/:clientId/biometrics", async (req, res) => {
  const org = await getPrimaryOrganization();
  const clientId = req.params.clientId!;
  const snapshots = await prisma.biometricSnapshot.findMany({
    where: { organizationId: org.id, clientId },
    orderBy: { measuredAt: "desc" },
  });
  return res.json({ snapshots, count: snapshots.length });
});

/** POST /v1/clients/:clientId/biometrics — create biometric snapshot */
v1Router.post("/clients/:clientId/biometrics", async (req, res) => {
  const body = validateBody(createBiometricBodySchema, req.body, res);
  if (!body) return;
  const { measuredAt, heightCm, weightKg, bodyFatPct, leanMassKg, restingHr, notes, source } = body;
  const org = await getPrimaryOrganization();
  const user = await getDefaultUser();
  const clientId = req.params.clientId!;

  const snapshot = await prisma.biometricSnapshot.create({
    data: {
      organizationId: org.id,
      clientId,
      measuredAt: new Date(measuredAt),
      heightCm: heightCm != null ? Number(heightCm) : null,
      weightKg: weightKg != null ? Number(weightKg) : null,
      bodyFatPct: bodyFatPct != null ? Number(bodyFatPct) : null,
      leanMassKg: leanMassKg != null ? Number(leanMassKg) : null,
      restingHr: restingHr != null ? Number(restingHr) : null,
      notes: notes ?? null,
      source: source ?? "manual",
      createdBy: user.id,
    },
  });
  return res.status(201).json(snapshot);
});

/** PATCH /v1/clients/:clientId/biometrics/:id — update biometric snapshot */
v1Router.patch("/clients/:clientId/biometrics/:id", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { id } = req.params;
  const { measuredAt, heightCm, weightKg, bodyFatPct, leanMassKg, restingHr, notes, source } = req.body;

  const existing = await prisma.biometricSnapshot.findFirst({
    where: { id, organizationId: org.id },
  });
  if (!existing) return res.status(404).json({ error: "Snapshot not found" });

  const updated = await prisma.biometricSnapshot.update({
    where: { id },
    data: {
      ...(measuredAt != null && { measuredAt: new Date(measuredAt) }),
      ...(heightCm !== undefined && { heightCm: heightCm != null ? Number(heightCm) : null }),
      ...(weightKg !== undefined && { weightKg: weightKg != null ? Number(weightKg) : null }),
      ...(bodyFatPct !== undefined && { bodyFatPct: bodyFatPct != null ? Number(bodyFatPct) : null }),
      ...(leanMassKg !== undefined && { leanMassKg: leanMassKg != null ? Number(leanMassKg) : null }),
      ...(restingHr !== undefined && { restingHr: restingHr != null ? Number(restingHr) : null }),
      ...(notes !== undefined && { notes }),
      ...(source !== undefined && { source }),
    },
  });
  return res.json(updated);
});

/** DELETE /v1/clients/:clientId/biometrics/:id — delete biometric snapshot */
v1Router.delete("/clients/:clientId/biometrics/:id", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { id } = req.params;

  const existing = await prisma.biometricSnapshot.findFirst({
    where: { id, organizationId: org.id },
  });
  if (!existing) return res.status(404).json({ error: "Snapshot not found" });

  await prisma.biometricSnapshot.delete({ where: { id } });
  return res.json({ deleted: true });
});

/** GET /v1/clients/:clientId/biometrics/summary — biometric summary with trends */
v1Router.get("/clients/:clientId/biometrics/summary", async (req, res) => {
  const org = await getPrimaryOrganization();
  const clientId = req.params.clientId!;
  const snapshots = await prisma.biometricSnapshot.findMany({
    where: { organizationId: org.id, clientId },
    orderBy: { measuredAt: "asc" },
  });

  const { generateBiometricSummary, computeBMI, classifyBMI } = await import("@nutrition/nutrition-engine/biometrics-engine");
  const dataPoints = snapshots.map((s) => ({
    measuredAt: s.measuredAt,
    heightCm: s.heightCm,
    weightKg: s.weightKg,
    bodyFatPct: s.bodyFatPct,
    leanMassKg: s.leanMassKg,
    restingHr: s.restingHr,
    source: s.source,
  }));

  const summary = generateBiometricSummary(dataPoints);
  const latest = summary.latestSnapshot;
  const bmi = (latest?.heightCm && latest?.weightKg) ? computeBMI(latest.heightCm, latest.weightKg) : null;
  const bmiCategory = bmi ? classifyBMI(bmi) : null;

  return res.json({ ...summary, bmi, bmiCategory });
});

/** GET /v1/clients/:clientId/documents — list client documents */
v1Router.get("/clients/:clientId/documents", async (req, res) => {
  const org = await getPrimaryOrganization();
  const clientId = req.params.clientId!;
  const { type, status } = req.query;

  const documents = await prisma.clientDocument.findMany({
    where: {
      organizationId: org.id,
      clientId,
      ...(type && { documentType: type as DocumentType }),
      ...(status && { parsingStatus: status as ParsingStatus }),
    },
    include: { fileAttachment: true },
    orderBy: { collectedAt: "desc" },
  });
  return res.json({ documents, count: documents.length });
});

/** POST /v1/clients/:clientId/documents — create document record (with optional file upload) */
v1Router.post("/clients/:clientId/documents", upload.single("file"), async (req, res) => {
  const org = await getPrimaryOrganization();
  const user = await getDefaultUser();
  const clientId = req.params.clientId!;
  const { documentType, collectedAt, sourceProvider, tags, notes } = req.body;

  if (!documentType || !collectedAt) {
    return res.status(400).json({ error: "documentType and collectedAt are required" });
  }

  let fileAttachmentId: string | null = null;

  // Handle file upload if present
  if (req.file) {
    const { generateStorageKey, isAllowedMimeType, isFileSizeValid, createStorageAdapter } = await import("@nutrition/nutrition-engine/file-storage");

    if (!isAllowedMimeType(req.file.mimetype)) {
      return res.status(400).json({ error: `Unsupported file type: ${req.file.mimetype}` });
    }
    if (!isFileSizeValid(req.file.size)) {
      return res.status(400).json({ error: "File too large (max 20 MB)" });
    }

    const storageKey = generateStorageKey(org.id, clientId, req.file.originalname);
    const fileData = fs.readFileSync(req.file.path);
    const adapter = createStorageAdapter();
    const result = await adapter.upload(storageKey, fileData, req.file.mimetype);

    // Clean up temp file
    fs.unlinkSync(req.file.path);

    const attachment = await prisma.fileAttachment.create({
      data: {
        organizationId: org.id,
        storageProvider: result.storageProvider,
        storageBucket: result.storageBucket,
        storageKey: result.storageKey,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: result.sizeBytes,
        checksum: result.checksum,
        uploadedBy: user.id,
      },
    });
    fileAttachmentId = attachment.id;
  }

  const parsedTags = typeof tags === "string" ? tags.split(",").map((t: string) => t.trim()).filter(Boolean) : Array.isArray(tags) ? tags : [];

  const document = await prisma.clientDocument.create({
    data: {
      organizationId: org.id,
      clientId,
      fileAttachmentId,
      documentType: documentType as DocumentType,
      collectedAt: new Date(collectedAt),
      sourceProvider: sourceProvider ?? null,
      tags: parsedTags,
      notes: notes ?? null,
      createdBy: user.id,
    },
    include: { fileAttachment: true },
  });
  return res.status(201).json(document);
});

/** PATCH /v1/clients/:clientId/documents/:id — update document metadata */
v1Router.patch("/clients/:clientId/documents/:id", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { id } = req.params;
  const { documentType, collectedAt, sourceProvider, tags, notes, parsingStatus, verifiedBy } = req.body;

  const existing = await prisma.clientDocument.findFirst({
    where: { id, organizationId: org.id },
  });
  if (!existing) return res.status(404).json({ error: "Document not found" });

  const updated = await prisma.clientDocument.update({
    where: { id },
    data: {
      ...(documentType && { documentType: documentType as DocumentType }),
      ...(collectedAt && { collectedAt: new Date(collectedAt) }),
      ...(sourceProvider !== undefined && { sourceProvider }),
      ...(tags && { tags: Array.isArray(tags) ? tags : (tags as string).split(",").map((t: string) => t.trim()) }),
      ...(notes !== undefined && { notes }),
      ...(parsingStatus && { parsingStatus: parsingStatus as ParsingStatus }),
      ...(verifiedBy && { verifiedBy, verifiedAt: new Date() }),
    },
    include: { fileAttachment: true },
  });
  return res.json(updated);
});

/** POST /v1/clients/:clientId/documents/:id/verify — mark document as verified */
v1Router.post("/clients/:clientId/documents/:id/verify", async (req, res) => {
  const org = await getPrimaryOrganization();
  const user = await getDefaultUser();
  const { id } = req.params;

  const existing = await prisma.clientDocument.findFirst({
    where: { id, organizationId: org.id },
  });
  if (!existing) return res.status(404).json({ error: "Document not found" });

  const updated = await prisma.clientDocument.update({
    where: { id },
    data: {
      parsingStatus: "VERIFIED" as ParsingStatus,
      verifiedBy: user.id,
      verifiedAt: new Date(),
    },
  });
  return res.json(updated);
});

/** GET /v1/clients/:clientId/metrics — list client metrics */
v1Router.get("/clients/:clientId/metrics", async (req, res) => {
  const org = await getPrimaryOrganization();
  const clientId = req.params.clientId!;
  const { key } = req.query;

  const metrics = await prisma.metricSeries.findMany({
    where: {
      organizationId: org.id,
      clientId,
      ...(key && { metricKey: key as string }),
    },
    include: { sourceDocument: { select: { id: true, documentType: true, collectedAt: true } } },
    orderBy: { observedAt: "desc" },
  });
  return res.json({ metrics, count: metrics.length });
});

/** POST /v1/clients/:clientId/metrics — create metric data point (manual entry) */
v1Router.post("/clients/:clientId/metrics", async (req, res) => {
  const body = validateBody(createMetricBodySchema, req.body, res);
  if (!body) return;
  const { metricKey, value, unit, observedAt, sourceDocumentId, verification, notes } = body;
  const org = await getPrimaryOrganization();
  const user = await getDefaultUser();
  const clientId = req.params.clientId!;

  const metric = await prisma.metricSeries.create({
    data: {
      organizationId: org.id,
      clientId,
      metricKey,
      value: Number(value),
      unit,
      observedAt: new Date(observedAt),
      sourceDocumentId: sourceDocumentId ?? null,
      verification: (verification as MetricVerification) ?? "MANUAL_ENTRY",
      notes: notes ?? null,
      createdBy: user.id,
    },
  });
  return res.status(201).json(metric);
});

/** GET /v1/clients/:clientId/metrics/status — metric quality report */
v1Router.get("/clients/:clientId/metrics/status", async (req, res) => {
  const org = await getPrimaryOrganization();
  const clientId = req.params.clientId!;

  const metrics = await prisma.metricSeries.findMany({
    where: { organizationId: org.id, clientId },
    orderBy: { observedAt: "asc" },
  });

  const { computeMetricStatuses, generateMetricQualityReport, groupMetricsByCategory } = await import("@nutrition/nutrition-engine/metrics-engine");
  const dataPoints = metrics.map((m) => ({
    metricKey: m.metricKey,
    value: m.value,
    unit: m.unit,
    observedAt: m.observedAt,
    verification: m.verification as "UNVERIFIED" | "MANUAL_ENTRY" | "PARSED_AUTO" | "CLINICIAN_VERIFIED",
    sourceDocumentId: m.sourceDocumentId,
    confidenceScore: m.confidenceScore,
  }));

  const statuses = computeMetricStatuses(dataPoints);
  const qualityReport = generateMetricQualityReport(dataPoints);
  const grouped = groupMetricsByCategory(statuses);

  return res.json({ statuses, qualityReport, grouped });
});

/** GET /v1/clients/:clientId/health-summary — combined biometrics + metrics overview */
v1Router.get("/clients/:clientId/health-summary", async (req, res) => {
  const org = await getPrimaryOrganization();
  const clientId = req.params.clientId!;

  const [biometrics, metricRows, documents] = await Promise.all([
    prisma.biometricSnapshot.findMany({
      where: { organizationId: org.id, clientId },
      orderBy: { measuredAt: "asc" },
    }),
    prisma.metricSeries.findMany({
      where: { organizationId: org.id, clientId },
      orderBy: { observedAt: "asc" },
    }),
    prisma.clientDocument.findMany({
      where: { organizationId: org.id, clientId },
      select: { id: true, documentType: true, parsingStatus: true, verifiedAt: true },
    }),
  ]);

  const { generateBiometricSummary, computeBMI, classifyBMI } = await import("@nutrition/nutrition-engine/biometrics-engine");
  const { generateMetricQualityReport } = await import("@nutrition/nutrition-engine/metrics-engine");

  const bioDataPoints = biometrics.map((s) => ({
    measuredAt: s.measuredAt,
    heightCm: s.heightCm,
    weightKg: s.weightKg,
    bodyFatPct: s.bodyFatPct,
    leanMassKg: s.leanMassKg,
    restingHr: s.restingHr,
    source: s.source,
  }));
  const bioSummary = generateBiometricSummary(bioDataPoints);
  const latest = bioSummary.latestSnapshot;
  const bmi = (latest?.heightCm && latest?.weightKg) ? computeBMI(latest.heightCm, latest.weightKg) : null;

  const metricDataPoints = metricRows.map((m) => ({
    metricKey: m.metricKey,
    value: m.value,
    unit: m.unit,
    observedAt: m.observedAt,
    verification: m.verification as "UNVERIFIED" | "MANUAL_ENTRY" | "PARSED_AUTO" | "CLINICIAN_VERIFIED",
    sourceDocumentId: m.sourceDocumentId,
    confidenceScore: m.confidenceScore,
  }));
  const metricReport = generateMetricQualityReport(metricDataPoints);

  const unverifiedDocs = documents.filter((d) => d.parsingStatus !== "VERIFIED").length;
  const failedParsing = documents.filter((d) => d.parsingStatus === "FAILED").length;

  const warnings: string[] = [
    ...bioSummary.dataQuality.warnings,
    ...metricReport.warnings,
  ];
  if (unverifiedDocs > 0) warnings.push(`${unverifiedDocs} document(s) not yet verified`);
  if (failedParsing > 0) warnings.push(`${failedParsing} document(s) failed parsing`);

  return res.json({
    biometrics: { ...bioSummary, bmi, bmiCategory: bmi ? classifyBMI(bmi) : null },
    metrics: metricReport,
    documents: { total: documents.length, unverified: unverifiedDocs, failedParsing },
    warnings,
  });
});

/** GET /v1/clients/:clientId/training-export — comprehensive data export for model training */
v1Router.get("/clients/:clientId/training-export", async (req, res) => {
  const org = await getPrimaryOrganization();
  const clientId = req.params.clientId!;

  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: org.id },
  });
  if (!client) return res.status(404).json({ error: "Client not found" });

  const [biometrics, metricRows, documents, events] = await Promise.all([
    prisma.biometricSnapshot.findMany({
      where: { organizationId: org.id, clientId },
      orderBy: { measuredAt: "asc" },
    }),
    prisma.metricSeries.findMany({
      where: { organizationId: org.id, clientId },
      orderBy: { observedAt: "asc" },
    }),
    prisma.clientDocument.findMany({
      where: { organizationId: org.id, clientId },
      select: { id: true, documentType: true, collectedAt: true, parsingStatus: true },
    }),
    prisma.mealServiceEvent.findMany({
      where: { organizationId: org.id, clientId },
      include: { finalLabelSnapshot: true },
      orderBy: { servedAt: "asc" },
    }),
  ]);

  // Build daily nutrition from events
  const dailyNutrition = new Map<string, { kcal: number; proteinG: number; carbG: number; fatG: number; mealCount: number }>();
  for (const ev of events) {
    const day = format(ev.servedAt, "yyyy-MM-dd");
    if (!dailyNutrition.has(day)) dailyNutrition.set(day, { kcal: 0, proteinG: 0, carbG: 0, fatG: 0, mealCount: 0 });
    const entry = dailyNutrition.get(day)!;
    entry.mealCount++;
    const payload = ev.finalLabelSnapshot?.renderPayload as Record<string, unknown> | null;
    if (payload) {
      const macros = (payload.macros ?? payload) as Record<string, number>;
      const p = Number(macros.proteinG ?? macros.protein_g ?? 0);
      const c = Number(macros.carbG ?? macros.carb_g ?? 0);
      const f = Number(macros.fatG ?? macros.fat_g ?? 0);
      entry.proteinG += p;
      entry.carbG += c;
      entry.fatG += f;
      entry.kcal += Number(macros.kcal ?? macros.calories ?? (p * 4 + c * 4 + f * 9));
    }
  }

  const nutritionDays = Array.from(dailyNutrition.entries()).map(([date, d]) => ({
    date, ...d,
  }));

  // Group into weekly rollups
  const weekMap = new Map<string, typeof nutritionDays>();
  for (const day of nutritionDays) {
    const d = new Date(day.date + "T12:00:00Z");
    const dow = d.getUTCDay();
    const diff = (dow === 0 ? -6 : 1) - dow;
    const ws = new Date(d);
    ws.setUTCDate(ws.getUTCDate() + diff);
    const key = ws.toISOString().slice(0, 10);
    if (!weekMap.has(key)) weekMap.set(key, []);
    weekMap.get(key)!.push(day);
  }

  const nutritionWeeks = Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ws, days]) => {
      const wd = days.filter((d) => d.mealCount > 0);
      const n = wd.length || 1;
      return {
        weekStart: ws,
        avgKcal: Math.round(wd.reduce((s, d) => s + d.kcal, 0) / n),
        avgProteinG: Math.round(wd.reduce((s, d) => s + d.proteinG, 0) / n),
        avgCarbG: Math.round(wd.reduce((s, d) => s + d.carbG, 0) / n),
        avgFatG: Math.round(wd.reduce((s, d) => s + d.fatG, 0) / n),
        mealCount: wd.reduce((s, d) => s + d.mealCount, 0),
      };
    });

  const exportData = {
    exportedAt: new Date().toISOString(),
    client: {
      id: client.id,
      sex: client.sex,
      dateOfBirth: client.dateOfBirth,
      activityLevel: client.activityLevel,
      heightCm: client.heightCm,
      weightKg: client.weightKg,
      targets: {
        kcal: client.targetKcal,
        proteinG: client.targetProteinG,
        carbG: client.targetCarbG,
        fatG: client.targetFatG,
        weightKg: client.targetWeightKg,
        bodyFatPct: client.targetBodyFatPct,
      },
    },
    biometrics: biometrics.map((s) => ({
      date: format(s.measuredAt, "yyyy-MM-dd"),
      weightKg: s.weightKg,
      bodyFatPct: s.bodyFatPct,
      leanMassKg: s.leanMassKg,
      restingHr: s.restingHr,
      heightCm: s.heightCm,
    })),
    metrics: metricRows.map((m) => ({
      date: format(m.observedAt, "yyyy-MM-dd"),
      metricKey: m.metricKey,
      value: m.value,
      unit: m.unit,
      verification: m.verification,
    })),
    nutritionWeeks,
    documents: documents.map((d) => ({
      type: d.documentType,
      collectedAt: d.collectedAt ? format(d.collectedAt, "yyyy-MM-dd") : null,
      parsingStatus: d.parsingStatus,
    })),
  };

  res.setHeader("Content-Disposition", `attachment; filename="training-export-${clientId.slice(0, 8)}.json"`);
  res.setHeader("Content-Type", "application/json");
  return res.json(exportData);
});

// ── Sprint 5: Audit Trace, Reproducibility, Ops Control Tower ───────

/** GET /v1/audit/meal/:scheduleId — full audit trace for a served meal */
v1Router.get("/audit/meal/:scheduleId", async (req, res) => {
  const org = await getPrimaryOrganization();
  const scheduleId = req.params.scheduleId!;

  const schedule = await prisma.mealSchedule.findFirst({
    where: { id: scheduleId, organizationId: org.id },
    include: { client: true, sku: true },
  });
  if (!schedule) return res.status(404).json({ error: "Schedule not found" });

  const serviceEvent = await prisma.mealServiceEvent.findUnique({
    where: { mealScheduleId: scheduleId },
  });
  if (!serviceEvent?.finalLabelSnapshotId) {
    return res.status(404).json({ error: "No label snapshot found for this meal (not yet served/frozen)" });
  }

  const labelSnapshot = await prisma.labelSnapshot.findUnique({
    where: { id: serviceEvent.finalLabelSnapshotId },
  });
  if (!labelSnapshot) return res.status(404).json({ error: "Label snapshot not found" });

  const { buildLineageTree } = await import("../lib/label-freeze.js");
  const tree = await buildLineageTree(labelSnapshot.id);

  const { buildMealAuditTrace } = await import("@nutrition/nutrition-engine/audit-trace");
  const payload = labelSnapshot.renderPayload as Record<string, unknown>;

  const trace = buildMealAuditTrace(
    {
      id: schedule.id,
      clientName: schedule.client.fullName,
      serviceDate: schedule.serviceDate.toISOString(),
      mealSlot: schedule.mealSlot,
      servings: schedule.plannedServings,
    },
    payload as any,
    tree as any,
  );

  return res.json({ trace, labelSnapshot: { id: labelSnapshot.id, frozenAt: labelSnapshot.frozenAt } });
});

/** GET /v1/audit/label/:labelId — label snapshot provenance with lineage tree */
v1Router.get("/audit/label/:labelId", async (req, res) => {
  const org = await getPrimaryOrganization();
  const labelId = req.params.labelId!;

  const label = await prisma.labelSnapshot.findFirst({
    where: { id: labelId, organizationId: org.id },
  });
  if (!label) return res.status(404).json({ error: "Label not found" });

  const { buildLineageTree } = await import("../lib/label-freeze.js");
  const tree = await buildLineageTree(labelId);

  const { extractNutrientProvenance, generateQaWarnings } = await import("@nutrition/nutrition-engine/audit-trace");
  const payload = label.renderPayload as Record<string, unknown>;
  const provenance = extractNutrientProvenance(payload as any);
  const qaWarnings = generateQaWarnings(payload as any, tree as any);

  return res.json({
    label: { id: label.id, type: label.labelType, title: label.title, frozenAt: label.frozenAt },
    payload,
    lineageTree: tree,
    provenance,
    qaWarnings,
  });
});

/** GET /v1/debug/recompute-diff/:labelId — non-destructive recompute diff */
v1Router.get("/debug/recompute-diff/:labelId", async (req, res) => {
  const org = await getPrimaryOrganization();
  const labelId = req.params.labelId!;

  const label = await prisma.labelSnapshot.findFirst({
    where: { id: labelId, organizationId: org.id, labelType: "SKU" },
  });
  if (!label) return res.status(404).json({ error: "SKU label snapshot not found" });

  const payload = label.renderPayload as Record<string, unknown>;
  const { runIntegrityChecks, buildRecomputeDiff } = await import("@nutrition/nutrition-engine/reproducibility");

  // Build snapshot data from payload
  const snapshotData = {
    labelId: label.id,
    frozenAt: label.frozenAt?.toISOString() ?? "",
    skuName: (payload.skuName as string) ?? "",
    recipeName: (payload.recipeName as string) ?? "",
    servings: (payload.servings as number) ?? 1,
    servingWeightG: (payload.servingWeightG as number) ?? 0,
    perServing: (payload.perServing as Record<string, number>) ?? {},
    provisional: Boolean(payload.provisional),
    reasonCodes: (payload.reasonCodes as string[]) ?? [],
    evidenceSummary: {
      verifiedCount: (payload.evidenceSummary as any)?.verifiedCount ?? 0,
      inferredCount: (payload.evidenceSummary as any)?.inferredCount ?? 0,
      exceptionCount: (payload.evidenceSummary as any)?.exceptionCount ?? 0,
      totalNutrientRows: (payload.evidenceSummary as any)?.totalNutrientRows ?? 0,
      sourceRefs: (payload.evidenceSummary as any)?.sourceRefs ?? [],
      gradeBreakdown: (payload.evidenceSummary as any)?.gradeBreakdown ?? {},
    },
  };

  // For MVP, we return integrity checks + diff against itself (demonstrating the tool works).
  // Full recompute would re-run label-freeze logic without mutation.
  const integrityChecks = runIntegrityChecks(snapshotData);
  const diff = buildRecomputeDiff(snapshotData, {
    perServing: snapshotData.perServing,
    servingWeightG: snapshotData.servingWeightG,
    provisional: snapshotData.provisional,
    reasonCodes: snapshotData.reasonCodes,
    evidenceSummary: snapshotData.evidenceSummary,
  });

  return res.json({ diff, integrityChecks });
});

/** GET /v1/control-tower — aggregated ops dashboard data */
v1Router.get("/control-tower", async (req, res) => {
  const org = await getPrimaryOrganization();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const expiryHorizon = new Date(today);
  expiryHorizon.setDate(expiryHorizon.getDate() + 3);

  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [
    mealsDueToday, mealsServedToday,
    batchesDue, batchesActive, batchesBlocked,
    expiringLots,
    openVerificationTasks, criticalVerificationTasks,
    pendingSubstitutions, pendingCalibrationReviews, openQcIssues,
    failedImports,
    unverifiedDocClients, failedParsingDocs,
  ] = await Promise.all([
    prisma.mealSchedule.count({ where: { organizationId: org.id, serviceDate: { gte: today, lt: tomorrow }, status: "PLANNED" } }),
    prisma.mealServiceEvent.count({ where: { organizationId: org.id, servedAt: { gte: today, lt: tomorrow } } }),
    prisma.batchProduction.count({ where: { organizationId: org.id, plannedDate: { gte: today, lt: tomorrow }, status: "PLANNED" } }),
    prisma.batchProduction.count({ where: { organizationId: org.id, status: { in: ["IN_PREP", "COOKING", "CHILLING"] } } }),
    prisma.batchProduction.count({ where: { organizationId: org.id, status: "PLANNED", plannedDate: { lt: today } } }),
    prisma.inventoryLot.findMany({
      where: { organizationId: org.id, quantityAvailableG: { gt: 0 }, expiresAt: { lte: expiryHorizon, gte: today } },
      include: { product: { select: { name: true } } },
      take: 20,
    }),
    prisma.verificationTask.count({ where: { organizationId: org.id, status: "OPEN" } }),
    prisma.verificationTask.count({ where: { organizationId: org.id, status: "OPEN", severity: { in: ["CRITICAL", "HIGH"] } } }),
    prisma.substitutionRecord.count({ where: { organizationId: org.id, status: "PROPOSED" } }),
    prisma.yieldCalibration.count({ where: { organizationId: org.id, status: "PENDING_REVIEW" } }),
    prisma.qcIssue.count({ where: { organizationId: org.id, resolvedAt: null } }),
    prisma.importJob.count({ where: { organizationId: org.id, status: "FAILED" } }),
    prisma.clientDocument.groupBy({ by: ["clientId"], where: { organizationId: org.id, parsingStatus: { not: "VERIFIED" } }, _count: true }),
    prisma.clientDocument.count({ where: { organizationId: org.id, parsingStatus: "FAILED" } }),
  ]);

  // Stale biometrics: clients whose latest biometric is >30 days old
  const clients = await prisma.client.findMany({ where: { organizationId: org.id, active: true }, select: { id: true } });
  let staleBioCount = 0;
  for (const client of clients) {
    const latest = await prisma.biometricSnapshot.findFirst({
      where: { organizationId: org.id, clientId: client.id },
      orderBy: { measuredAt: "desc" },
      select: { measuredAt: true },
    });
    if (!latest || latest.measuredAt < thirtyDaysAgo) staleBioCount++;
  }

  // Stuck batches (active for >24h)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const stuckBatches = await prisma.batchProduction.count({
    where: { organizationId: org.id, status: { in: ["IN_PREP", "COOKING", "CHILLING"] }, updatedAt: { lt: oneDayAgo } },
  });

  // Shortage detection: ingredients below par level
  const shortages = await prisma.ingredientCatalog.findMany({
    where: { organizationId: org.id, active: true, parLevelG: { not: null } },
    select: { id: true, parLevelG: true },
  });
  let shortageCount = 0;
  for (const ing of shortages) {
    if (!ing.parLevelG) continue;
    const totalAvailable = await prisma.inventoryLot.aggregate({
      where: { organizationId: org.id, product: { ingredientId: ing.id }, quantityAvailableG: { gt: 0 } },
      _sum: { quantityAvailableG: true },
    });
    if ((totalAvailable._sum.quantityAvailableG ?? 0) < ing.parLevelG) {
      shortageCount++;
    }
  }

  const { buildControlTowerSummary } = await import("@nutrition/nutrition-engine/ops-control-tower");

  const summary = buildControlTowerSummary({
    today: {
      mealsDueToday,
      mealsServedToday,
      batchesDue,
      batchesActive,
      batchesBlocked,
      shortageCount,
      expiringLots: expiringLots.map((l) => ({
        lotId: l.id,
        productName: l.product.name,
        expiresAt: l.expiresAt?.toISOString() ?? "",
        quantityG: l.quantityAvailableG,
      })),
    },
    scientificQa: {
      openVerificationTasks,
      criticalVerificationTasks,
      estimatedNutrientRows: 0, // would require a separate aggregation query
      inferredNutrientRows: 0,
      missingProvenanceCount: 0,
      pendingSubstitutions,
      pendingCalibrationReviews,
      openQcIssues,
    },
    clientData: {
      clientsWithStaleBiometrics: staleBioCount,
      clientsWithUnverifiedDocs: unverifiedDocClients.length,
      failedParsingDocs,
      staleMetricClients: 0, // simplified for MVP
    },
    reliability: {
      failedImports,
      stuckBatches,
      stuckMappings: 0,
    },
  });

  return res.json(summary);
});

// ── Fulfillment Orders ──────────────────────────────────────────

/** Auto-generate fulfillment orders from PLANNED schedules for a date */
v1Router.post("/fulfillment/generate", async (req, res) => {
  const org = await getPrimaryOrganization();
  const user = await getDefaultUser();
  const body = validateBody(generateFulfillmentBodySchema, req.body, res);
  if (!body) return;

  const deliveryDate = parseDateOnlyUtc(body.date);
  const dayStart = startOfDay(deliveryDate);
  const dayEnd = endOfDay(deliveryDate);

  // Find all PLANNED schedules for this date
  const schedules = await prisma.mealSchedule.findMany({
    where: {
      organizationId: org.id,
      serviceDate: { gte: dayStart, lte: dayEnd },
      status: "PLANNED",
    },
    include: { client: true },
  });

  // Group by clientId
  const byClient = new Map<string, typeof schedules>();
  for (const s of schedules) {
    const arr = byClient.get(s.clientId) ?? [];
    arr.push(s);
    byClient.set(s.clientId, arr);
  }

  let created = 0;
  let existing = 0;

  for (const [clientId, clientSchedules] of byClient) {
    const client = clientSchedules[0]!.client;

    // Upsert fulfillment order for this client+date
    const existingOrder = await prisma.fulfillmentOrder.findUnique({
      where: {
        organizationId_clientId_deliveryDate: {
          organizationId: org.id,
          clientId,
          deliveryDate,
        },
      },
      include: { items: true },
    });

    if (existingOrder) {
      // Add any new schedules not already linked
      const linkedScheduleIds = new Set(existingOrder.items.map((i) => i.mealScheduleId));
      const newSchedules = clientSchedules.filter((s) => !linkedScheduleIds.has(s.id));
      if (newSchedules.length > 0) {
        await prisma.fulfillmentItem.createMany({
          data: newSchedules.map((s) => ({
            fulfillmentOrderId: existingOrder.id,
            mealScheduleId: s.id,
          })),
        });
      }
      existing++;
      continue;
    }

    // Create new fulfillment order with snapshot of client delivery info
    await prisma.fulfillmentOrder.create({
      data: {
        organizationId: org.id,
        clientId,
        deliveryDate,
        status: FulfillmentStatus.PENDING,
        deliveryAddress: client.deliveryAddressHome ?? client.deliveryAddressWork,
        deliveryNotes: client.deliveryNotes,
        deliveryZone: client.deliveryZone,
        createdBy: user.email,
        items: {
          create: clientSchedules.map((s) => ({
            mealScheduleId: s.id,
          })),
        },
      },
    });
    created++;
  }

  return res.json({ created, existing });
});

/** List fulfillment orders with filters */
v1Router.get("/fulfillment", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { date, status, clientId } = req.query as {
    date?: string;
    status?: string;
    clientId?: string;
  };

  // Build typed where clause
  const dateFilter = date ? (() => {
    const d = parseDateOnlyUtc(date);
    return { gte: startOfDay(d), lte: endOfDay(d) };
  })() : undefined;
  const statusFilter = status ? (() => {
    const statuses = status.split(",") as FulfillmentStatus[];
    return statuses.length === 1 ? statuses[0] : { in: statuses };
  })() : undefined;

  const orders = await prisma.fulfillmentOrder.findMany({
    where: {
      organizationId: org.id,
      ...(dateFilter ? { deliveryDate: dateFilter } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(clientId ? { clientId } : {}),
    },
    include: {
      client: { select: { id: true, fullName: true, deliveryZone: true } },
      items: {
        include: {
          mealSchedule: {
            include: { sku: { select: { id: true, name: true } } },
          },
        },
      },
      routeStop: {
        include: { route: { select: { id: true, name: true, status: true } } },
      },
    },
    orderBy: [{ deliveryZone: "asc" }, { client: { fullName: "asc" } }],
  });

  return res.json(
    orders.map((o) => ({
      id: o.id,
      clientId: o.clientId,
      clientName: o.client.fullName,
      deliveryDate: o.deliveryDate.toISOString().slice(0, 10),
      status: o.status,
      deliveryAddress: o.deliveryAddress,
      deliveryNotes: o.deliveryNotes,
      deliveryZone: o.deliveryZone,
      itemCount: o.items.length,
      packedCount: o.items.filter((i) => i.packed).length,
      packedAt: o.packedAt?.toISOString() ?? null,
      dispatchedAt: o.dispatchedAt?.toISOString() ?? null,
      deliveredAt: o.deliveredAt?.toISOString() ?? null,
      failedAt: o.failedAt?.toISOString() ?? null,
      failureReason: o.failureReason,
      route: o.routeStop
        ? { id: o.routeStop.route.id, name: o.routeStop.route.name, stopOrder: o.routeStop.stopOrder }
        : null,
      items: o.items.map((i) => ({
        id: i.id,
        mealScheduleId: i.mealScheduleId,
        skuName: i.mealSchedule.sku?.name ?? "Unknown",
        mealSlot: i.mealSchedule.mealSlot,
        packed: i.packed,
      })),
    })),
  );
});

/** Get single fulfillment order with full detail */
v1Router.get("/fulfillment/:id", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { id } = req.params;

  const order = await prisma.fulfillmentOrder.findFirst({
    where: { id, organizationId: org.id },
    include: {
      client: { select: { id: true, fullName: true, deliveryZone: true, exclusions: true } },
      packedBy: { select: { id: true, email: true } },
      items: {
        include: {
          mealSchedule: {
            include: {
              sku: {
                select: {
                  id: true,
                  name: true,
                  servingSizeG: true,
                },
              },
            },
          },
        },
      },
      routeStop: {
        include: { route: { select: { id: true, name: true, status: true } } },
      },
    },
  });

  if (!order) {
    return res.status(404).json({ error: "Fulfillment order not found" });
  }

  return res.json({
    id: order.id,
    clientId: order.clientId,
    clientName: order.client.fullName,
    clientExclusions: order.client.exclusions,
    deliveryDate: order.deliveryDate.toISOString().slice(0, 10),
    status: order.status,
    deliveryAddress: order.deliveryAddress,
    deliveryNotes: order.deliveryNotes,
    deliveryZone: order.deliveryZone,
    packedAt: order.packedAt?.toISOString() ?? null,
    packedBy: order.packedBy?.email ?? null,
    dispatchedAt: order.dispatchedAt?.toISOString() ?? null,
    deliveredAt: order.deliveredAt?.toISOString() ?? null,
    failedAt: order.failedAt?.toISOString() ?? null,
    failureReason: order.failureReason,
    route: order.routeStop
      ? { id: order.routeStop.route.id, name: order.routeStop.route.name, stopOrder: order.routeStop.stopOrder }
      : null,
    items: order.items.map((i) => ({
      id: i.id,
      mealScheduleId: i.mealScheduleId,
      skuName: i.mealSchedule.sku?.name ?? "Unknown",
      mealSlot: i.mealSchedule.mealSlot,
      servingSizeG: i.mealSchedule.sku?.servingSizeG ?? null,
      packed: i.packed,
    })),
  });
});

/** Update fulfillment order status */
v1Router.patch("/fulfillment/:id/status", async (req, res) => {
  const org = await getPrimaryOrganization();
  const user = await getDefaultUser();
  const { id } = req.params;
  const body = validateBody(updateFulfillmentStatusBodySchema, req.body, res);
  if (!body) return;

  const order = await prisma.fulfillmentOrder.findFirst({
    where: { id, organizationId: org.id },
    include: { items: true },
  });
  if (!order) {
    return res.status(404).json({ error: "Fulfillment order not found" });
  }

  const data: Record<string, unknown> = {
    status: body.status,
    version: { increment: 1 },
  };

  switch (body.status) {
    case "PACKED":
      data.packedAt = new Date();
      data.packedByUserId = user.id;
      break;
    case "DISPATCHED":
      data.dispatchedAt = new Date();
      break;
    case "DELIVERED":
      data.deliveredAt = new Date();
      break;
    case "FAILED":
      data.failedAt = new Date();
      data.failureReason = body.failureReason ?? null;
      break;
  }

  const updated = await prisma.fulfillmentOrder.update({
    where: { id },
    data,
  });

  // When DELIVERED, mark all linked MealSchedules as DONE (triggers label freeze + inventory)
  const freezeResults: Array<{ mealScheduleId: string; success: boolean; warning?: string }> = [];
  if (body.status === "DELIVERED") {
    for (const item of order.items) {
      try {
        await freezeLabelFromScheduleDone({
          mealScheduleId: item.mealScheduleId,
          servedByUserId: user.id,
        });
        freezeResults.push({ mealScheduleId: item.mealScheduleId, success: true });
      } catch (error) {
        freezeResults.push({
          mealScheduleId: item.mealScheduleId,
          success: false,
          warning: error instanceof Error ? error.message : "Label freeze failed",
        });
      }
    }
    // Also update the schedules to DONE
    await prisma.mealSchedule.updateMany({
      where: { id: { in: order.items.map((i) => i.mealScheduleId) } },
      data: { status: "DONE", version: { increment: 1 } },
    });
  }

  return res.json({
    id: updated.id,
    status: updated.status,
    packedAt: updated.packedAt?.toISOString() ?? null,
    dispatchedAt: updated.dispatchedAt?.toISOString() ?? null,
    deliveredAt: updated.deliveredAt?.toISOString() ?? null,
    failedAt: updated.failedAt?.toISOString() ?? null,
    failureReason: updated.failureReason,
    ...(freezeResults.length > 0 ? { freezeResults } : {}),
  });
});

/** Toggle packed status on individual fulfillment item */
v1Router.patch("/fulfillment/:id/items/:itemId/pack", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { id, itemId } = req.params;

  // Verify order belongs to org
  const order = await prisma.fulfillmentOrder.findFirst({
    where: { id, organizationId: org.id },
  });
  if (!order) {
    return res.status(404).json({ error: "Fulfillment order not found" });
  }

  const item = await prisma.fulfillmentItem.findFirst({
    where: { id: itemId, fulfillmentOrderId: id },
  });
  if (!item) {
    return res.status(404).json({ error: "Fulfillment item not found" });
  }

  const updated = await prisma.fulfillmentItem.update({
    where: { id: itemId },
    data: { packed: !item.packed },
  });

  // Auto-transition order to PACKING if still PENDING
  if (order.status === FulfillmentStatus.PENDING) {
    await prisma.fulfillmentOrder.update({
      where: { id },
      data: { status: FulfillmentStatus.PACKING, version: { increment: 1 } },
    });
  }

  return res.json({
    id: updated.id,
    mealScheduleId: updated.mealScheduleId,
    packed: updated.packed,
  });
});

// ── Delivery Routes ─────────────────────────────────────────────

/** Create a delivery route */
v1Router.post("/routes", async (req, res) => {
  const org = await getPrimaryOrganization();
  const body = validateBody(createRouteBodySchema, req.body, res);
  if (!body) return;

  const route = await prisma.deliveryRoute.create({
    data: {
      organizationId: org.id,
      routeDate: parseDateOnlyUtc(body.routeDate),
      name: body.name,
      driverName: body.driverName ?? null,
      notes: body.notes ?? null,
    },
  });

  return res.status(201).json({
    id: route.id,
    routeDate: route.routeDate.toISOString().slice(0, 10),
    name: route.name,
    driverName: route.driverName,
    notes: route.notes,
    status: route.status,
  });
});

/** List delivery routes */
v1Router.get("/routes", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { date, status } = req.query as { date?: string; status?: string };

  const routeDateFilter = date ? (() => {
    const d = parseDateOnlyUtc(date);
    return { gte: startOfDay(d), lte: endOfDay(d) };
  })() : undefined;

  const routes = await prisma.deliveryRoute.findMany({
    where: {
      organizationId: org.id,
      ...(routeDateFilter ? { routeDate: routeDateFilter } : {}),
      ...(status ? { status: status as RouteStatus } : {}),
    },
    include: {
      stops: {
        include: {
          fulfillmentOrder: {
            include: {
              client: { select: { id: true, fullName: true } },
            },
          },
        },
        orderBy: { stopOrder: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  return res.json(
    routes.map((r) => ({
      id: r.id,
      routeDate: r.routeDate.toISOString().slice(0, 10),
      name: r.name,
      driverName: r.driverName,
      notes: r.notes,
      status: r.status,
      dispatchedAt: r.dispatchedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      stopCount: r.stops.length,
      stops: r.stops.map((s) => ({
        id: s.id,
        stopOrder: s.stopOrder,
        fulfillmentOrderId: s.fulfillmentOrderId,
        clientName: s.fulfillmentOrder.client.fullName,
        deliveryAddress: s.fulfillmentOrder.deliveryAddress,
        deliveryZone: s.fulfillmentOrder.deliveryZone,
        status: s.fulfillmentOrder.status,
      })),
    })),
  );
});

/** Get single delivery route with stops */
v1Router.get("/routes/:id", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { id } = req.params;

  const route = await prisma.deliveryRoute.findFirst({
    where: { id, organizationId: org.id },
    include: {
      stops: {
        include: {
          fulfillmentOrder: {
            include: {
              client: { select: { id: true, fullName: true, exclusions: true } },
              items: {
                include: {
                  mealSchedule: {
                    include: { sku: { select: { id: true, name: true } } },
                  },
                },
              },
            },
          },
        },
        orderBy: { stopOrder: "asc" },
      },
    },
  });

  if (!route) {
    return res.status(404).json({ error: "Route not found" });
  }

  return res.json({
    id: route.id,
    routeDate: route.routeDate.toISOString().slice(0, 10),
    name: route.name,
    driverName: route.driverName,
    notes: route.notes,
    status: route.status,
    dispatchedAt: route.dispatchedAt?.toISOString() ?? null,
    completedAt: route.completedAt?.toISOString() ?? null,
    stops: route.stops.map((s) => ({
      id: s.id,
      stopOrder: s.stopOrder,
      fulfillmentOrderId: s.fulfillmentOrderId,
      clientName: s.fulfillmentOrder.client.fullName,
      deliveryAddress: s.fulfillmentOrder.deliveryAddress,
      deliveryNotes: s.fulfillmentOrder.deliveryNotes,
      deliveryZone: s.fulfillmentOrder.deliveryZone,
      status: s.fulfillmentOrder.status,
      items: s.fulfillmentOrder.items.map((i) => ({
        skuName: i.mealSchedule.sku?.name ?? "Unknown",
        mealSlot: i.mealSchedule.mealSlot,
        packed: i.packed,
      })),
    })),
  });
});

/** Update route metadata */
v1Router.patch("/routes/:id", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { id } = req.params;
  const body = validateBody(updateRouteBodySchema, req.body, res);
  if (!body) return;

  const route = await prisma.deliveryRoute.findFirst({
    where: { id, organizationId: org.id },
  });
  if (!route) {
    return res.status(404).json({ error: "Route not found" });
  }

  const updated = await prisma.deliveryRoute.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.driverName !== undefined ? { driverName: body.driverName } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    },
  });

  return res.json({
    id: updated.id,
    name: updated.name,
    driverName: updated.driverName,
    notes: updated.notes,
    status: updated.status,
  });
});

/** Add stops to a route */
v1Router.post("/routes/:id/stops", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { id } = req.params;
  const body = validateBody(addRouteStopsBodySchema, req.body, res);
  if (!body) return;

  const route = await prisma.deliveryRoute.findFirst({
    where: { id, organizationId: org.id },
  });
  if (!route) {
    return res.status(404).json({ error: "Route not found" });
  }

  // Verify all fulfillment orders exist and belong to org
  const orderIds = body.stops.map((s) => s.fulfillmentOrderId);
  const orders = await prisma.fulfillmentOrder.findMany({
    where: { id: { in: orderIds }, organizationId: org.id },
  });
  if (orders.length !== orderIds.length) {
    return res.status(400).json({ error: "One or more fulfillment orders not found" });
  }

  // Check for orders already assigned to routes
  const existingStops = await prisma.deliveryRouteStop.findMany({
    where: { fulfillmentOrderId: { in: orderIds } },
  });
  if (existingStops.length > 0) {
    return res.status(400).json({
      error: "One or more orders are already assigned to a route",
      conflicting: existingStops.map((s) => s.fulfillmentOrderId),
    });
  }

  const created = await prisma.deliveryRouteStop.createMany({
    data: body.stops.map((s) => ({
      routeId: id!,
      fulfillmentOrderId: s.fulfillmentOrderId,
      stopOrder: s.stopOrder,
    })),
  });

  return res.status(201).json({ added: created.count });
});

/** Reorder stops within a route */
v1Router.patch("/routes/:id/stops/reorder", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { id } = req.params;
  const body = validateBody(reorderRouteStopsBodySchema, req.body, res);
  if (!body) return;

  const route = await prisma.deliveryRoute.findFirst({
    where: { id, organizationId: org.id },
  });
  if (!route) {
    return res.status(404).json({ error: "Route not found" });
  }

  // Update each stop's order
  const updates = body.stopIds.map((stopId, index) =>
    prisma.deliveryRouteStop.update({
      where: { id: stopId },
      data: { stopOrder: index + 1 },
    }),
  );
  await prisma.$transaction(updates);

  return res.json({ reordered: body.stopIds.length });
});

/** Remove a stop from a route */
v1Router.delete("/routes/:id/stops/:stopId", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { id, stopId } = req.params;

  const route = await prisma.deliveryRoute.findFirst({
    where: { id, organizationId: org.id },
  });
  if (!route) {
    return res.status(404).json({ error: "Route not found" });
  }

  const stop = await prisma.deliveryRouteStop.findFirst({
    where: { id: stopId, routeId: id },
  });
  if (!stop) {
    return res.status(404).json({ error: "Stop not found on this route" });
  }

  await prisma.deliveryRouteStop.delete({ where: { id: stopId } });

  return res.json({ deleted: true });
});

/** Dispatch a route — sets all fulfillment orders to DISPATCHED */
v1Router.post("/routes/:id/dispatch", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { id } = req.params;

  const route = await prisma.deliveryRoute.findFirst({
    where: { id, organizationId: org.id },
    include: {
      stops: { include: { fulfillmentOrder: true } },
    },
  });
  if (!route) {
    return res.status(404).json({ error: "Route not found" });
  }

  if (route.status !== "PLANNING") {
    return res.status(400).json({ error: "Route has already been dispatched" });
  }

  const now = new Date();

  // Update route status
  await prisma.deliveryRoute.update({
    where: { id },
    data: { status: "DISPATCHED", dispatchedAt: now },
  });

  // Update all fulfillment orders on this route to DISPATCHED
  const orderIds = route.stops.map((s) => s.fulfillmentOrderId);
  await prisma.fulfillmentOrder.updateMany({
    where: { id: { in: orderIds } },
    data: { status: FulfillmentStatus.DISPATCHED, dispatchedAt: now, version: { increment: 1 } },
  });

  return res.json({
    routeId: id,
    status: "DISPATCHED",
    dispatchedAt: now.toISOString(),
    ordersDispatched: orderIds.length,
  });
});

// ── Delivery Print Endpoints ────────────────────────────────────

/** Daily delivery manifest — all clients & meals for a date, grouped by zone */
v1Router.get("/print/delivery-manifest/:date", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { date } = req.params;
  const deliveryDate = parseDateOnlyUtc(date!);
  const dayStart = startOfDay(deliveryDate);
  const dayEnd = endOfDay(deliveryDate);

  const orders = await prisma.fulfillmentOrder.findMany({
    where: {
      organizationId: org.id,
      deliveryDate: { gte: dayStart, lte: dayEnd },
    },
    include: {
      client: { select: { id: true, fullName: true } },
      items: {
        include: {
          mealSchedule: {
            include: { sku: { select: { name: true, servingSizeG: true } } },
          },
        },
      },
    },
    orderBy: [{ deliveryZone: "asc" }, { client: { fullName: "asc" } }],
  });

  // Group by zone
  const zones = new Map<string, typeof orders>();
  for (const o of orders) {
    const zone = o.deliveryZone ?? "Unassigned";
    const arr = zones.get(zone) ?? [];
    arr.push(o);
    zones.set(zone, arr);
  }

  return res.json({
    date: date,
    totalOrders: orders.length,
    totalItems: orders.reduce((sum, o) => sum + o.items.length, 0),
    zones: Array.from(zones.entries()).map(([zone, zoneOrders]) => ({
      zone,
      orderCount: zoneOrders.length,
      orders: zoneOrders.map((o) => ({
        id: o.id,
        clientName: o.client.fullName,
        status: o.status,
        deliveryAddress: o.deliveryAddress,
        deliveryNotes: o.deliveryNotes,
        items: o.items.map((i) => ({
          skuName: i.mealSchedule.sku?.name ?? "Unknown",
          mealSlot: i.mealSchedule.mealSlot,
          servingSizeG: i.mealSchedule.sku?.servingSizeG ?? null,
          packed: i.packed,
        })),
      })),
    })),
  });
});

/** Per-client packing slip */
v1Router.get("/print/packing-slip/:fulfillmentId", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { fulfillmentId } = req.params;

  const order = await prisma.fulfillmentOrder.findFirst({
    where: { id: fulfillmentId, organizationId: org.id },
    include: {
      client: {
        select: { id: true, fullName: true, exclusions: true, preferences: true },
      },
      items: {
        include: {
          mealSchedule: {
            include: {
              sku: {
                select: {
                  name: true,
                  servingSizeG: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!order) {
    return res.status(404).json({ error: "Fulfillment order not found" });
  }

  return res.json({
    orderId: order.id,
    deliveryDate: order.deliveryDate.toISOString().slice(0, 10),
    client: {
      name: order.client.fullName,
      exclusions: order.client.exclusions,
      preferences: order.client.preferences,
    },
    deliveryAddress: order.deliveryAddress,
    deliveryNotes: order.deliveryNotes,
    deliveryZone: order.deliveryZone,
    status: order.status,
    items: order.items.map((i) => ({
      id: i.id,
      skuName: i.mealSchedule.sku?.name ?? "Unknown",
      mealSlot: i.mealSchedule.mealSlot,
      servingSizeG: i.mealSchedule.sku?.servingSizeG ?? null,
      packed: i.packed,
    })),
    totalItems: order.items.length,
    packedItems: order.items.filter((i) => i.packed).length,
  });
});

/** Driver's route sheet */
v1Router.get("/print/route-sheet/:routeId", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { routeId } = req.params;

  const route = await prisma.deliveryRoute.findFirst({
    where: { id: routeId, organizationId: org.id },
    include: {
      stops: {
        include: {
          fulfillmentOrder: {
            include: {
              client: { select: { fullName: true, phone: true } },
              items: {
                include: {
                  mealSchedule: {
                    include: { sku: { select: { name: true } } },
                  },
                },
              },
            },
          },
        },
        orderBy: { stopOrder: "asc" },
      },
    },
  });

  if (!route) {
    return res.status(404).json({ error: "Route not found" });
  }

  return res.json({
    routeId: route.id,
    routeDate: route.routeDate.toISOString().slice(0, 10),
    routeName: route.name,
    driverName: route.driverName,
    notes: route.notes,
    status: route.status,
    totalStops: route.stops.length,
    stops: route.stops.map((s) => ({
      stopNumber: s.stopOrder,
      clientName: s.fulfillmentOrder.client.fullName,
      clientPhone: s.fulfillmentOrder.client.phone,
      deliveryAddress: s.fulfillmentOrder.deliveryAddress,
      deliveryNotes: s.fulfillmentOrder.deliveryNotes,
      deliveryZone: s.fulfillmentOrder.deliveryZone,
      status: s.fulfillmentOrder.status,
      itemCount: s.fulfillmentOrder.items.length,
      items: s.fulfillmentOrder.items.map((i) => ({
        skuName: i.mealSchedule.sku?.name ?? "Unknown",
        mealSlot: i.mealSchedule.mealSlot,
      })),
    })),
  });
});

// ─── GPT Action Endpoints ────────────────────────────────────

/** GET /v1/skus — list active SKUs for GPT meal planning */
v1Router.get("/skus", requireApiKey, async (_req: express.Request, res: express.Response) => {
  const org = await getPrimaryOrganization();
  const skus = await prisma.sku.findMany({
    where: { organizationId: org.id, active: true },
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true, servingSizeG: true },
  });
  return res.json({ skus });
});

/** GET /v1/openapi.json — OpenAPI spec for ChatGPT Custom GPT Action */
v1Router.get("/openapi.json", (_req: express.Request, res: express.Response) => {
  const proto = _req.get("x-forwarded-proto") || _req.protocol;
  const apiBase = process.env.API_PUBLIC_URL || `${proto}://${_req.get("host")}`;
  const spec = buildOpenApiSpec(apiBase);
  res.setHeader("Content-Type", "application/json");
  return res.json(spec);
});

/** POST /v1/meal-plans/push — bulk push meal plan from ChatGPT GPT Action */
v1Router.post("/meal-plans/push", requireApiKey, async (req: express.Request, res: express.Response) => {
  const parsed = mealPlanPushBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
  }

  const org = await getPrimaryOrganization();
  const { meals } = parsed.data;

  // Pre-load clients, SKUs, and ingredients for resolution
  const clients = await prisma.client.findMany({
    where: { organizationId: org.id },
    select: { id: true, fullName: true },
  });

  const existingSkus = await prisma.sku.findMany({
    where: { organizationId: org.id, active: true },
    select: { id: true, code: true, name: true },
  });

  const existingIngredients = await prisma.ingredientCatalog.findMany({
    where: { organizationId: org.id, active: true },
    select: { id: true, canonicalKey: true, name: true },
  });

  const results = {
    created: 0,
    skipped: 0,
    skusCreated: [] as string[],
    recipesCreated: [] as string[],
    ingredientsCreated: [] as string[],
    errors: [] as string[],
  };

  // Helper: build a canonical key from ingredient name
  const toCanonicalKey = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  // Helper: resolve or create an ingredient
  const resolveIngredient = async (name: string, category: string) => {
    const key = toCanonicalKey(name);
    let ing = existingIngredients.find(
      (i) => i.canonicalKey === key || i.name.toLowerCase() === name.toLowerCase()
    );
    if (!ing) {
      ing = await prisma.ingredientCatalog.create({
        data: {
          organizationId: org.id,
          canonicalKey: key || `ing-${Date.now()}`,
          name,
          category,
          defaultUnit: "g",
          active: true,
        },
        select: { id: true, canonicalKey: true, name: true },
      });
      existingIngredients.push(ing);
      results.ingredientsCreated.push(name);
    }
    return ing;
  };

  for (const meal of meals) {
    // 1. Resolve client by name (case-insensitive)
    const clientMatches = clients.filter(
      (c) => c.fullName.toLowerCase() === meal.clientName.toLowerCase()
    );
    if (clientMatches.length === 0) {
      // Try partial match
      const partial = clients.filter(
        (c) => c.fullName.toLowerCase().includes(meal.clientName.toLowerCase())
      );
      if (partial.length === 1) {
        clientMatches.push(partial[0]!);
      } else {
        results.errors.push(
          `Client "${meal.clientName}" not found${partial.length > 1 ? ` (${partial.length} partial matches — be more specific)` : ""}`
        );
        continue;
      }
    }
    if (clientMatches.length > 1) {
      results.errors.push(`Client "${meal.clientName}" matched ${clientMatches.length} records — be more specific`);
      continue;
    }
    const client = clientMatches[0]!;

    // 2. Resolve SKU by name (case-insensitive exact, then fuzzy, then auto-create)
    let sku = existingSkus.find(
      (s) => s.name.toLowerCase() === meal.mealName.toLowerCase() || s.code.toLowerCase() === meal.mealName.toLowerCase()
    );

    if (!sku) {
      // Fuzzy: check if mealName is contained in sku name or vice versa
      const fuzzy = existingSkus.filter(
        (s) =>
          s.name.toLowerCase().includes(meal.mealName.toLowerCase()) ||
          meal.mealName.toLowerCase().includes(s.name.toLowerCase())
      );
      if (fuzzy.length === 1) {
        sku = fuzzy[0];
      }
    }

    let skuIsNew = false;
    if (!sku) {
      // Auto-create placeholder SKU
      const code = meal.mealName
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 30);

      // Calculate total serving size from ingredients if available
      const totalG = meal.ingredients
        ? meal.ingredients.reduce((sum, ing) => sum + ing.grams, 0)
        : 0;

      const newSku = await prisma.sku.create({
        data: {
          organizationId: org.id,
          code: code || `SKU-${Date.now()}`,
          name: meal.mealName,
          servingSizeG: Math.round(totalG),
          active: true,
        },
        select: { id: true, code: true, name: true },
      });
      existingSkus.push(newSku);
      sku = newSku;
      skuIsNew = true;
      results.skusCreated.push(meal.mealName);
    }

    // 3. Create recipe with ingredients if provided and SKU is new (or has no recipe)
    if (meal.ingredients && meal.ingredients.length > 0) {
      // Check if this SKU already has an active recipe
      const existingRecipe = await prisma.recipe.findFirst({
        where: { skuId: sku.id, active: true },
      });

      if (!existingRecipe) {
        // Create the recipe
        const recipe = await prisma.recipe.create({
          data: {
            organizationId: org.id,
            skuId: sku.id,
            name: meal.mealName,
            servings: meal.servings ?? 1,
            active: true,
            createdBy: "chatgpt-push",
          },
        });

        // Create recipe lines with ingredient resolution
        for (let i = 0; i < meal.ingredients.length; i++) {
          const ingLine = meal.ingredients[i]!;
          const ingredient = await resolveIngredient(ingLine.name, ingLine.category ?? "general");

          await prisma.recipeLine.create({
            data: {
              recipeId: recipe.id,
              ingredientId: ingredient.id,
              lineOrder: i + 1,
              targetGPerServing: ingLine.grams,
              preparedState: (ingLine.preparedState as "RAW" | "COOKED" | "DRY" | "CANNED" | "FROZEN") ?? "RAW",
              required: true,
              createdBy: "chatgpt-push",
            },
          });
        }

        results.recipesCreated.push(meal.mealName);
      }
    }

    // 4. Normalize meal slot to uppercase
    const mealSlot = meal.mealSlot.toUpperCase() as
      | "BREAKFAST"
      | "LUNCH"
      | "DINNER"
      | "SNACK"
      | "PRE_TRAINING"
      | "POST_TRAINING"
      | "PRE_BED";

    // 5. Parse service date
    const serviceDate = new Date(meal.serviceDate + "T00:00:00Z");

    // 6. Dedup check — same client + date + slot + sku
    const existing = await prisma.mealSchedule.findFirst({
      where: {
        clientId: client.id,
        serviceDate,
        mealSlot,
        skuId: sku.id,
      },
    });

    if (existing) {
      results.skipped++;
      continue;
    }

    // 7. Create MealSchedule
    await prisma.mealSchedule.create({
      data: {
        organizationId: org.id,
        clientId: client.id,
        skuId: sku.id,
        serviceDate,
        mealSlot,
        plannedServings: meal.servings ?? 1,
        status: "PLANNED",
        notes: meal.notes ?? null,
      },
    });

    results.created++;
  }

  return res.json(results);
});

// ─── Gmail Integration Endpoints ─────────────────────────────

/** GET /v1/gmail/auth-url — returns Google OAuth consent URL */
v1Router.get("/gmail/auth-url", async (_req: express.Request, res: express.Response) => {
  try {
    const { getAuthUrl } = await import("../lib/gmail-client.js");
    const url = getAuthUrl();
    return res.json({ url });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** GET /v1/gmail/callback — OAuth redirect handler */
v1Router.get("/gmail/callback", async (req: express.Request, res: express.Response) => {
  const code = req.query.code as string;
  if (!code) {
    return res.status(400).json({ error: "Missing authorization code" });
  }

  try {
    const { exchangeCode } = await import("../lib/gmail-client.js");
    const tokens = await exchangeCode(code);

    if (!tokens.refresh_token) {
      return res.status(400).json({ error: "No refresh token received. Please revoke access and try again." });
    }

    const org = await getPrimaryOrganization();

    // Decode the ID token or use a default email label
    // Google tokens include an email in the id_token
    let email = "unknown@gmail.com";
    if (tokens.id_token) {
      try {
        const payload = JSON.parse(
          Buffer.from(tokens.id_token.split(".")[1]!, "base64url").toString()
        );
        if (payload.email) email = payload.email;
      } catch {
        // ignore decode errors
      }
    }

    // Upsert the Gmail integration
    await prisma.gmailIntegration.upsert({
      where: {
        organizationId_email: { organizationId: org.id, email },
      },
      update: {
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token ?? null,
        tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        active: true,
        syncError: null,
        version: { increment: 1 },
      },
      create: {
        organizationId: org.id,
        email,
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token ?? null,
        tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      },
    });

    // Redirect to the web app Gmail settings page
    const webBase = process.env.WEB_PUBLIC_URL || "http://localhost:3000";
    return res.redirect(`${webBase}/gmail?connected=true`);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** GET /v1/gmail/status — returns connection status + sync history */
v1Router.get("/gmail/status", async (_req: express.Request, res: express.Response) => {
  const org = await getPrimaryOrganization();

  const integration = await prisma.gmailIntegration.findFirst({
    where: { organizationId: org.id, active: true },
    include: {
      syncHistory: {
        orderBy: { syncedAt: "desc" },
        take: 10,
      },
    },
  });

  if (!integration) {
    return res.json({ connected: false });
  }

  return res.json({
    connected: true,
    email: integration.email,
    lastSyncAt: integration.lastSyncAt,
    syncStatus: integration.syncStatus,
    syncError: integration.syncError,
    history: integration.syncHistory.map((h) => ({
      id: h.id,
      syncedAt: h.syncedAt,
      emailsScanned: h.emailsScanned,
      ordersImported: h.ordersImported,
      ordersSkipped: h.ordersSkipped,
      errors: h.errors,
    })),
  });
});

/** POST /v1/gmail/disconnect — deactivate Gmail integration */
v1Router.post("/gmail/disconnect", async (_req: express.Request, res: express.Response) => {
  const org = await getPrimaryOrganization();

  const integration = await prisma.gmailIntegration.findFirst({
    where: { organizationId: org.id, active: true },
  });

  if (!integration) {
    return res.status(404).json({ error: "No active Gmail integration found" });
  }

  await prisma.gmailIntegration.update({
    where: { id: integration.id },
    data: { active: false, version: { increment: 1 } },
  });

  return res.json({ ok: true });
});

/** POST /v1/gmail/sync — trigger manual Gmail sync */
v1Router.post("/gmail/sync", async (_req: express.Request, res: express.Response) => {
  const org = await getPrimaryOrganization();

  const integration = await prisma.gmailIntegration.findFirst({
    where: { organizationId: org.id, active: true },
  });

  if (!integration) {
    return res.status(404).json({ error: "No active Gmail integration found" });
  }

  if (integration.syncStatus === "SYNCING") {
    return res.status(409).json({ error: "Sync already in progress" });
  }

  // Run sync asynchronously
  const { syncGmailOrders } = await import("../lib/gmail-sync.js");
  syncGmailOrders(integration.id).catch((err) => {
    console.error("[gmail-sync] Manual sync error:", err);
  });

  return res.json({ ok: true, message: "Sync started" });
});
