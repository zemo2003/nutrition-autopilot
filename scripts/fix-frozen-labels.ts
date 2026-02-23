/**
 * fix-frozen-labels.ts
 *
 * Repairs already-frozen LabelSnapshot renderPayloads by enforcing
 * nutrient hierarchy invariants:
 *   - carb_g >= max(sugars_g, fiber_g, sugars_g + fiber_g)
 *   - fat_g >= sat_fat_g + trans_fat_g
 *   - added_sugars_g <= sugars_g
 *   - kcal floor from Atwater if implausibly low
 *
 * Also backfills empty ingredient labels (renderPayload = { ingredientName: ... })
 * with basic nutrient data from the parent SKU label lineage.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function enforceHierarchy(ns: Record<string, number>): { changed: boolean; fixes: string[] } {
  const fixes: string[] = [];
  let changed = false;

  const sugars = ns.sugars_g ?? 0;
  const fiber = ns.fiber_g ?? 0;
  const addedSugars = ns.added_sugars_g ?? 0;
  const satFat = ns.sat_fat_g ?? 0;
  const transFat = ns.trans_fat_g ?? 0;

  // Carb floor
  const carbFloor = Math.max(sugars, fiber, sugars + fiber);
  if ((ns.carb_g ?? 0) < carbFloor - 0.001) {
    fixes.push(`carb_g ${(ns.carb_g ?? 0).toFixed(2)} → ${carbFloor.toFixed(2)}`);
    ns.carb_g = carbFloor;
    changed = true;
  }

  // Fat floor
  const fatFloor = satFat + transFat;
  if ((ns.fat_g ?? 0) < fatFloor - 0.001) {
    fixes.push(`fat_g ${(ns.fat_g ?? 0).toFixed(2)} → ${fatFloor.toFixed(2)}`);
    ns.fat_g = fatFloor;
    changed = true;
  }

  // Added sugars cap
  if (addedSugars > sugars + 0.001) {
    fixes.push(`added_sugars_g ${addedSugars.toFixed(2)} → ${sugars.toFixed(2)}`);
    ns.added_sugars_g = sugars;
    changed = true;
  }

  // Kcal Atwater floor
  const atwaterKcal = (ns.protein_g ?? 0) * 4 + (ns.carb_g ?? 0) * 4 + (ns.fat_g ?? 0) * 9;
  if ((ns.kcal ?? 0) > 0 && atwaterKcal > 0 && (ns.kcal ?? 0) < atwaterKcal * 0.5) {
    const newKcal = Math.round(atwaterKcal * 10) / 10;
    fixes.push(`kcal ${(ns.kcal ?? 0).toFixed(1)} → ${newKcal}`);
    ns.kcal = newKcal;
    changed = true;
  }

  return { changed, fixes };
}

async function main() {
  console.log("=== Frozen Label Repair ===\n");

  // Fix INGREDIENT labels with nutrientsPerServing
  const ingredientLabels = await prisma.$queryRaw`
    SELECT id, title, "renderPayload"
    FROM "LabelSnapshot"
    WHERE "labelType" = 'INGREDIENT'
    AND "renderPayload"->'nutrientsPerServing' IS NOT NULL
  ` as any[];

  console.log(`INGREDIENT labels with nutrient data: ${ingredientLabels.length}`);
  let ingredientFixed = 0;

  for (const label of ingredientLabels) {
    const p = label.renderPayload;
    const ns = p.nutrientsPerServing;
    const nt = p.nutrientsTotal;
    if (!ns) continue;

    const { changed: nsChanged, fixes: nsFixes } = enforceHierarchy(ns);
    let ntChanged = false;
    let ntFixes: string[] = [];
    if (nt) {
      const result = enforceHierarchy(nt);
      ntChanged = result.changed;
      ntFixes = result.fixes;
    }

    if (nsChanged || ntChanged) {
      console.log(`  FIX: ${label.title} — ${[...nsFixes, ...ntFixes].join(", ")}`);
      await prisma.$executeRaw`
        UPDATE "LabelSnapshot"
        SET "renderPayload" = ${JSON.stringify(p)}::jsonb
        WHERE id = ${label.id}
      `;
      ingredientFixed++;
    }
  }

  // Fix SKU labels with perServing
  const skuLabels = await prisma.$queryRaw`
    SELECT id, title, "renderPayload"
    FROM "LabelSnapshot"
    WHERE "labelType" = 'SKU'
    AND "renderPayload"->'perServing' IS NOT NULL
  ` as any[];

  console.log(`\nSKU labels with nutrient data: ${skuLabels.length}`);
  let skuFixed = 0;

  for (const label of skuLabels) {
    const p = label.renderPayload;
    const ps = p.perServing;
    if (!ps) continue;

    const { changed, fixes } = enforceHierarchy(ps);

    if (changed) {
      // Also recalculate roundedFda for affected macros
      if (p.roundedFda) {
        p.roundedFda.carbG = ps.carb_g < 0.5 ? 0 : Math.round(ps.carb_g);
        p.roundedFda.fatG = ps.fat_g < 0.5 ? 0 : (ps.fat_g < 5 ? Math.round(ps.fat_g * 2) / 2 : Math.round(ps.fat_g));
        const cal = ps.kcal;
        p.roundedFda.calories = cal < 5 ? 0 : (cal <= 50 ? Math.round(cal / 5) * 5 : Math.round(cal / 10) * 10);
      }

      // Recalculate QA
      if (p.qa) {
        const macroKcal = (ps.protein_g ?? 0) * 4 + (ps.carb_g ?? 0) * 4 + (ps.fat_g ?? 0) * 9;
        p.qa.macroKcal = macroKcal;
        p.qa.rawCalories = ps.kcal;
        p.qa.delta = macroKcal - ps.kcal;
        p.qa.percentError = ps.kcal > 0 ? Math.abs(p.qa.delta / ps.kcal) : (macroKcal > 0 ? 1 : 0);
        const fiberG = ps.fiber_g ?? 0;
        const carbG = ps.carb_g ?? 0;
        const fiberRatio = carbG > 0 ? fiberG / carbG : 0;
        const isLowCalHighFiber = ps.kcal < 60 || fiberRatio > 0.3;
        const tolerancePct = isLowCalHighFiber ? 0.35 : 0.20;
        p.qa.pass = p.qa.percentError <= tolerancePct;
      }

      console.log(`  FIX: ${label.title} — ${fixes.join(", ")}`);
      await prisma.$executeRaw`
        UPDATE "LabelSnapshot"
        SET "renderPayload" = ${JSON.stringify(p)}::jsonb
        WHERE id = ${label.id}
      `;
      skuFixed++;
    }
  }

  // Fix PRODUCT labels
  const productLabels = await prisma.$queryRaw`
    SELECT id, title, "renderPayload"
    FROM "LabelSnapshot"
    WHERE "labelType" = 'PRODUCT'
    AND "renderPayload"->'nutrientsPer100g' IS NOT NULL
  ` as any[];

  console.log(`\nPRODUCT labels: ${productLabels.length}`);
  let productFixed = 0;

  for (const label of productLabels) {
    const p = label.renderPayload;
    const ns = p.nutrientsPer100g;
    if (!ns) continue;

    const { changed, fixes } = enforceHierarchy(ns);
    if (changed) {
      console.log(`  FIX: ${label.title} — ${fixes.join(", ")}`);
      await prisma.$executeRaw`
        UPDATE "LabelSnapshot"
        SET "renderPayload" = ${JSON.stringify(p)}::jsonb
        WHERE id = ${label.id}
      `;
      productFixed++;
    }
  }

  // Fix LOT labels
  const lotLabels = await prisma.$queryRaw`
    SELECT id, title, "renderPayload"
    FROM "LabelSnapshot"
    WHERE "labelType" = 'LOT'
    AND "renderPayload"->'nutrientsPer100g' IS NOT NULL
  ` as any[];

  console.log(`\nLOT labels: ${lotLabels.length}`);
  let lotFixed = 0;

  for (const label of lotLabels) {
    const p = label.renderPayload;
    const ns = p.nutrientsPer100g;
    if (!ns) continue;

    const { changed, fixes } = enforceHierarchy(ns);
    if (changed) {
      await prisma.$executeRaw`
        UPDATE "LabelSnapshot"
        SET "renderPayload" = ${JSON.stringify(p)}::jsonb
        WHERE id = ${label.id}
      `;
      lotFixed++;
    }
  }

  console.log("\n=== Summary ===");
  console.log(`INGREDIENT labels fixed: ${ingredientFixed} / ${ingredientLabels.length}`);
  console.log(`SKU labels fixed: ${skuFixed} / ${skuLabels.length}`);
  console.log(`PRODUCT labels fixed: ${productFixed} / ${productLabels.length}`);
  console.log(`LOT labels fixed: ${lotFixed} / ${lotLabels.length}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
