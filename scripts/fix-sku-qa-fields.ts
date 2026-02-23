/**
 * fix-sku-qa-fields.ts
 *
 * Backfills the `rawCalories` and `percentError` fields on SKU label QA objects
 * that are missing them (from older pipeline versions). Also re-evaluates `pass`
 * using the current tolerance logic (20% for normal, 35% for low-cal/high-fiber).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Fix SKU QA fields ===\n");

  // Find SKU labels where qa is missing percentError or rawCalories
  const labels = await prisma.$queryRaw`
    SELECT id, title, "renderPayload"
    FROM "LabelSnapshot"
    WHERE "labelType" = 'SKU'
    AND "renderPayload"->'qa' IS NOT NULL
    AND (
      "renderPayload"->'qa'->>'percentError' IS NULL
      OR "renderPayload"->'qa'->>'rawCalories' IS NULL
    )
  ` as any[];

  console.log(`Found ${labels.length} SKU labels with incomplete QA\n`);

  let fixed = 0;
  let passChanged = 0;

  for (const label of labels) {
    const p = label.renderPayload;
    const qa = p.qa;
    const perServing = p.perServing;

    if (perServing === undefined || perServing === null) continue;

    // Recalculate QA using current engine logic
    const kcal = perServing.kcal ?? 0;
    const proteinG = perServing.protein_g ?? 0;
    const carbG = perServing.carb_g ?? 0;
    const fatG = perServing.fat_g ?? 0;
    const fiberG = perServing.fiber_g ?? 0;

    const macroKcal = proteinG * 4 + carbG * 4 + fatG * 9;
    const rawCalories = kcal;
    const delta = macroKcal - rawCalories;

    const fiberRatio = carbG > 0 ? fiberG / carbG : 0;
    const isLowCalHighFiber = rawCalories < 60 || fiberRatio > 0.3;
    const tolerancePct = isLowCalHighFiber ? 0.35 : 0.20;

    const percentError = rawCalories > 0 ? Math.abs(delta / rawCalories) : (macroKcal > 0 ? 1 : 0);
    const pass = percentError <= tolerancePct;

    const oldPass = qa.pass;

    // Update the QA object
    p.qa = {
      macroKcal,
      rawCalories,
      labeledCalories: qa.labeledCalories,
      delta,
      percentError,
      pass,
    };

    await prisma.$executeRaw`
      UPDATE "LabelSnapshot"
      SET "renderPayload" = ${JSON.stringify(p)}::jsonb
      WHERE id = ${label.id}
    `;

    if (oldPass !== pass) {
      passChanged++;
    }
    fixed++;
  }

  console.log(`Fixed ${fixed} labels`);
  console.log(`Pass status changed for ${passChanged} labels`);

  // Final stats
  const qaStats = await prisma.$queryRaw`
    SELECT
      COUNT(*) FILTER (WHERE ("renderPayload"->'qa'->>'pass')::boolean = true) as passing,
      COUNT(*) FILTER (WHERE ("renderPayload"->'qa'->>'pass')::boolean = false) as failing,
      COUNT(*) as total
    FROM "LabelSnapshot"
    WHERE "labelType" = 'SKU'
    AND "renderPayload"->'qa' IS NOT NULL
  ` as any[];
  console.log(`\nFinal SKU QA: ${qaStats[0]?.passing} passing, ${qaStats[0]?.failing} failing out of ${qaStats[0]?.total}`);

  // Error distribution
  const dist = await prisma.$queryRaw`
    SELECT
      CASE
        WHEN ABS(("renderPayload"->'qa'->>'percentError')::float) <= 0.05 THEN '0-5%'
        WHEN ABS(("renderPayload"->'qa'->>'percentError')::float) <= 0.10 THEN '5-10%'
        WHEN ABS(("renderPayload"->'qa'->>'percentError')::float) <= 0.20 THEN '10-20%'
        WHEN ABS(("renderPayload"->'qa'->>'percentError')::float) <= 0.30 THEN '20-30%'
        ELSE '>30%'
      END as error_band,
      COUNT(*) as cnt
    FROM "LabelSnapshot"
    WHERE "labelType" = 'SKU'
    AND "renderPayload"->'qa' IS NOT NULL
    GROUP BY error_band
    ORDER BY error_band
  ` as any[];
  console.log("\nError distribution:");
  for (const d of dist) {
    console.log(`  ${d.error_band}: ${d.cnt}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
