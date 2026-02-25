import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import express from "express";
import multer from "multer";
import { addHours, endOfMonth, parse, startOfMonth } from "date-fns";
import { prisma, NutrientSourceType, VerificationStatus, VerificationTaskStatus, VerificationTaskSeverity, ScheduleStatus, BatchStatus, ComponentType, StorageLocation, SauceVariantType, BatchCheckpointType, MappingResolutionSource, SubstitutionStatus } from "@nutrition/db";
import { parseInstacartOrders, parsePilotMeals, parseSotWorkbook, mapOrderLineToIngredient } from "@nutrition/importers";
import { getDefaultUser, getPrimaryOrganization } from "../lib/context.js";
import { freezeLabelFromScheduleDone, buildLineageTree } from "../lib/label-freeze.js";
import { ensureIdempotency, setIdempotencyResponse } from "../lib/idempotency.js";
import { computeInventoryProjections, computeDemandForecast, computeWasteSummary, computeAllocationSummary } from "../lib/inventory-projections.js";
import { runPilotBackfill } from "../lib/pilot-backfill.js";
import { importResultSchema, verificationTaskSchema } from "@nutrition/contracts";

const upload = multer({ dest: "/tmp" });
const execFile = promisify(execFileCb);

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
      const recipe = s.sku.recipes[0];
      return {
        id: s.id,
        clientId: s.clientId,
        clientName: s.client.fullName,
        skuId: s.skuId,
        skuName: s.sku.name,
        skuCode: s.sku.code,
        servingSizeG: s.sku.servingSizeG ?? null,
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
      sku: { id: e.sku.id, code: e.sku.code, name: e.sku.name },
      finalLabelSnapshotId: e.finalLabelSnapshotId
    }))
  });
});

v1Router.get("/clients/:clientId/calendar/export", async (req, res) => {
  const XLSX = await import("xlsx");
  const org = await getPrimaryOrganization();
  const { clientId } = req.params;
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

    if (e.lotConsumptions.length > 0) {
      for (const lc of e.lotConsumptions) {
        rows.push({
          Client: clientName,
          Date: e.servedAt.toISOString().slice(0, 10),
          Meal: e.sku.name,
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
        Meal: e.sku.name,
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
  const org = await getPrimaryOrganization();
  const user = await getDefaultUser();
  const { lotId, deltaG, reason, notes } = req.body as {
    lotId?: string;
    deltaG?: number;
    reason?: string;
    notes?: string;
  };

  if (!lotId || typeof deltaG !== "number" || !reason) {
    return res.status(400).json({ error: "lotId, deltaG, and reason are required" });
  }

  const lot = await prisma.inventoryLot.findFirst({
    where: { id: lotId, organizationId: org.id },
  });
  if (!lot) {
    return res.status(404).json({ error: "Lot not found" });
  }

  const newAvailable = lot.quantityAvailableG + deltaG;
  if (newAvailable < 0) {
    return res.status(400).json({ error: "Adjustment would result in negative quantity" });
  }

  await prisma.$transaction([
    prisma.inventoryLot.update({
      where: { id: lotId },
      data: { quantityAvailableG: newAvailable, version: { increment: 1 } },
    }),
    prisma.inventoryLotLedger.create({
      data: {
        inventoryLotId: lotId,
        deltaG,
        reason: `${reason}${notes ? `: ${notes}` : ""}`,
        referenceId: `manual-${Date.now()}`,
        createdBy: user.email,
      },
    }),
  ]);

  return res.json({ lotId, newAvailableG: newAvailable });
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
  const org = await getPrimaryOrganization();
  const user = await getDefaultUser();
  const { componentId, rawInputG, portionSizeG, plannedDate } = req.body as {
    componentId?: string;
    rawInputG?: number;
    portionSizeG?: number;
    plannedDate?: string;
  };

  if (!componentId || typeof rawInputG !== "number" || !plannedDate) {
    return res.status(400).json({ error: "componentId, rawInputG, and plannedDate are required" });
  }

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
  const { batchId } = req.params;
  const { status, actualYieldG } = req.body as {
    status?: string;
    actualYieldG?: number;
  };

  if (!status) {
    return res.status(400).json({ error: "status is required" });
  }
  if (!Object.values(BatchStatus).includes(status as BatchStatus)) {
    return res.status(400).json({ error: `Invalid status: ${status}` });
  }

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

  // ── OI-3: Batch Lot Consumption (FIFO) when moving to IN_PREP ──
  if (status === "IN_PREP") {
    // Idempotency: skip if lots already consumed for this batch
    const existingConsumptions = await prisma.batchLotConsumption.count({
      where: { batchId },
    });
    if (existingConsumptions === 0) {
      await prisma.$transaction(async (tx) => {
        const componentLines = await tx.componentLine.findMany({
          where: { componentId: batch.componentId },
          include: { ingredient: true },
        });

        for (const line of componentLines) {
          let remaining = line.targetGPer100g * (batch.rawInputG / 100);

          const lots = await tx.inventoryLot.findMany({
            where: {
              organizationId: batch.organizationId,
              quantityAvailableG: { gt: 0 },
              product: { ingredientId: line.ingredientId },
            },
            orderBy: [{ expiresAt: "asc" }, { receivedAt: "asc" }],
          });

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
      });
    }
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
  const { clientId } = req.params;

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
    bodyCompositionSnapshots: client.bodyCompositionSnapshots ?? [],
    fileRecords: client.fileRecords ?? [],
  });
});

v1Router.patch("/clients/:clientId", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { clientId } = req.params;
  const { email, phone, heightCm, weightKg, goals, preferences, exclusions } = req.body as {
    email?: string;
    phone?: string;
    heightCm?: number;
    weightKg?: number;
    goals?: string;
    preferences?: string;
    exclusions?: string[];
  };

  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: org.id },
  });
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }

  const updated = await prisma.client.update({
    where: { id: clientId },
    data: {
      ...(email !== undefined ? { email } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(typeof heightCm === "number" ? { heightCm } : {}),
      ...(typeof weightKg === "number" ? { weightKg } : {}),
      ...(goals !== undefined ? { goals } : {}),
      ...(preferences !== undefined ? { preferences } : {}),
      ...(Array.isArray(exclusions) ? { exclusions } : {}),
      version: { increment: 1 },
    },
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
  });
});

v1Router.post("/clients/:clientId/body-composition", async (req, res) => {
  const org = await getPrimaryOrganization();
  const { clientId } = req.params;
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
  const { clientId } = req.params;
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
  const user = await getDefaultUser();
  const { batchId } = req.params;
  const { checkpointType, tempC, notes, timerDurationM } = req.body as {
    checkpointType?: string;
    tempC?: number;
    notes?: string;
    timerDurationM?: number;
  };

  if (!checkpointType || !Object.values(BatchCheckpointType).includes(checkpointType as BatchCheckpointType)) {
    return res.status(400).json({ error: "checkpointType is required and must be a valid BatchCheckpointType" });
  }

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
