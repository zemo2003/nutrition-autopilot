import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import express from "express";
import multer from "multer";
import { addHours, endOfMonth, parse, startOfMonth } from "date-fns";
import { prisma, NutrientSourceType, VerificationStatus } from "@nutrition/db";
import { parseInstacartOrders, parsePilotMeals, parseSotWorkbook, mapOrderLineToIngredient } from "@nutrition/importers";
import { getDefaultUser, getPrimaryOrganization } from "../lib/context.js";
import { freezeLabelFromScheduleDone, buildLineageTree } from "../lib/label-freeze.js";
import { ensureIdempotency, setIdempotencyResponse } from "../lib/idempotency.js";
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

  return res.json({
    ...label,
    provisional,
    evidenceSummary,
    supersededByLabelId,
    isLatest: supersededByLabelId === null
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
    if (payload.provisional === true || (payload.evidenceSummary as any)?.provisional === true) {
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
      inferredRows,
      exceptionRows,
      verifiedRows,
      provisionalLabels,
      floorRows
    },
    syntheticUsage: {
      lotConsumptionEvents: syntheticUsageCount
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
      labels: staleLabels
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

  const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : undefined;
  const severity = typeof req.query.severity === "string" ? req.query.severity.toUpperCase() : undefined;
  const sourceType = typeof req.query.sourceType === "string" ? req.query.sourceType.toUpperCase() : undefined;
  const historicalException = parseBoolean(req.query.historicalException, false);
  const confidenceMinRaw = Number(req.query.confidenceMin);
  const confidenceMin = Number.isFinite(confidenceMinRaw) ? confidenceMinRaw : null;

  const tasks = await prisma.verificationTask.findMany({
    where: {
      organizationId: org.id,
      ...(status ? { status: status as any } : {}),
      ...(severity ? { severity: severity as any } : {})
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
