/**
 * fix-animal-protein-carbs.ts
 *
 * Zeroes out carb_g, fiber_g, sugars_g, and added_sugars_g for frozen
 * INGREDIENT LabelSnapshots whose title matches animal protein patterns
 * (chicken, turkey, beef, pork, cod, salmon, shrimp, etc.) and where
 * carb_g > 3 — values that are nutritionally implausible for plain
 * animal protein and resulted from the ghost-nutrient contamination.
 *
 * Also recalculates kcal from Atwater after zeroing carbs.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Matches common animal protein ingredient names
const ANIMAL_PROTEIN_PATTERN = /\b(chicken|turkey|beef|pork|lamb|veal|bison|duck|goose|venison|cod|salmon|tuna|tilapia|shrimp|prawns?|crab|lobster|scallops?|mussels?|clams?|oysters?|sardines?|anchovies?|halibut|trout|bass|catfish|swordfish|mahi|snapper|haddock|pollock|mackerel|herring|perch|sole|flounder|grouper)\b/i;

// These keys should be zero for plain animal protein
const CARB_KEYS = ["carb_g", "fiber_g", "sugars_g", "added_sugars_g"] as const;

async function main() {
  console.log("=== Animal Protein Carb Fix ===\n");

  // Find INGREDIENT labels with nutrientsPerServing
  const labels = await prisma.$queryRaw`
    SELECT id, title, "renderPayload"
    FROM "LabelSnapshot"
    WHERE "labelType" = 'INGREDIENT'
    AND "renderPayload"->'nutrientsPerServing' IS NOT NULL
  ` as any[];

  console.log(`Total INGREDIENT labels with nutrient data: ${labels.length}`);

  let fixed = 0;
  let skipped = 0;

  for (const label of labels) {
    // Check if this is an animal protein by title
    if (!ANIMAL_PROTEIN_PATTERN.test(label.title)) continue;

    const p = label.renderPayload;
    const ns = p.nutrientsPerServing;
    const nt = p.nutrientsTotal;
    if (!ns) continue;

    const carbG = ns.carb_g ?? 0;
    // Only fix if carb_g is implausibly high for animal protein
    if (carbG <= 3) {
      skipped++;
      continue;
    }

    const fixes: string[] = [];
    let changed = false;

    // Zero out carb-related nutrients in perServing
    for (const key of CARB_KEYS) {
      if ((ns[key] ?? 0) > 0) {
        fixes.push(`${key} ${(ns[key] ?? 0).toFixed(2)} → 0`);
        ns[key] = 0;
        changed = true;
      }
    }

    // Recalculate kcal from Atwater after zeroing carbs
    const atwaterKcal = (ns.protein_g ?? 0) * 4 + (ns.carb_g ?? 0) * 4 + (ns.fat_g ?? 0) * 9;
    if (ns.kcal > atwaterKcal * 1.5 || ns.kcal < atwaterKcal * 0.5) {
      const newKcal = Math.round(atwaterKcal * 10) / 10;
      fixes.push(`kcal ${(ns.kcal ?? 0).toFixed(1)} → ${newKcal}`);
      ns.kcal = newKcal;
    }

    // Also fix nutrientsTotal if present
    if (nt) {
      for (const key of CARB_KEYS) {
        if ((nt[key] ?? 0) > 0) {
          nt[key] = 0;
        }
      }
      const ntAtwater = (nt.protein_g ?? 0) * 4 + (nt.carb_g ?? 0) * 4 + (nt.fat_g ?? 0) * 9;
      if (nt.kcal > ntAtwater * 1.5 || nt.kcal < ntAtwater * 0.5) {
        nt.kcal = Math.round(ntAtwater * 10) / 10;
      }
    }

    if (changed) {
      console.log(`  FIX: ${label.title} — ${fixes.join(", ")}`);
      await prisma.$executeRaw`
        UPDATE "LabelSnapshot"
        SET "renderPayload" = ${JSON.stringify(p)}::jsonb
        WHERE id = ${label.id}
      `;
      fixed++;
    }
  }

  // Also check PRODUCT and LOT labels for the same pattern
  for (const labelType of ["PRODUCT", "LOT"] as const) {
    const otherLabels = await prisma.$queryRaw`
      SELECT id, title, "renderPayload"
      FROM "LabelSnapshot"
      WHERE "labelType" = ${labelType}::"LabelType"
      AND "renderPayload"->'nutrientsPer100g' IS NOT NULL
    ` as any[];

    let otherFixed = 0;
    for (const label of otherLabels) {
      if (!ANIMAL_PROTEIN_PATTERN.test(label.title)) continue;

      const p = label.renderPayload;
      const ns = p.nutrientsPer100g;
      if (!ns || (ns.carb_g ?? 0) <= 3) continue;

      let changed = false;
      for (const key of CARB_KEYS) {
        if ((ns[key] ?? 0) > 0) {
          ns[key] = 0;
          changed = true;
        }
      }

      if (changed) {
        const atwaterKcal = (ns.protein_g ?? 0) * 4 + (ns.carb_g ?? 0) * 4 + (ns.fat_g ?? 0) * 9;
        if (ns.kcal > atwaterKcal * 1.5 || ns.kcal < atwaterKcal * 0.5) {
          ns.kcal = Math.round(atwaterKcal * 10) / 10;
        }

        await prisma.$executeRaw`
          UPDATE "LabelSnapshot"
          SET "renderPayload" = ${JSON.stringify(p)}::jsonb
          WHERE id = ${label.id}
        `;
        otherFixed++;
      }
    }

    if (otherFixed > 0) {
      console.log(`\n${labelType} labels fixed: ${otherFixed}`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Animal protein ingredient labels fixed: ${fixed}`);
  console.log(`Animal protein ingredient labels skipped (carb ≤ 3): ${skipped}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
