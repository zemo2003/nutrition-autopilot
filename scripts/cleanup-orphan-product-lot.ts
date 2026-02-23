import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  console.log("=== Cleanup orphaned PRODUCT and LOT labels ===\n");

  // Find PRODUCT/LOT labels not linked to any parent via lineage
  for (const labelType of ["PRODUCT", "LOT"] as const) {
    const orphans = await prisma.$queryRaw`
      SELECT ls.id
      FROM "LabelSnapshot" ls
      WHERE ls."labelType" = ${labelType}::"LabelType"
      AND NOT EXISTS (
        SELECT 1 FROM "LabelLineageEdge" lle
        WHERE lle."childLabelId" = ls.id
      )
    ` as any[];

    if (orphans.length === 0) {
      console.log(`${labelType}: no orphans`);
      continue;
    }

    const ids = orphans.map((o: any) => o.id);

    // Delete edges where these are parents
    const edgesDeleted = await prisma.$executeRaw`
      DELETE FROM "LabelLineageEdge"
      WHERE "parentLabelId" = ANY(${ids})
    `;

    const deleted = await prisma.$executeRaw`
      DELETE FROM "LabelSnapshot"
      WHERE id = ANY(${ids})
    `;
    console.log(`${labelType}: deleted ${deleted} orphans, ${edgesDeleted} edges`);
  }

  // Also clean up INGREDIENT labels not linked to any parent
  const orphanIngredients = await prisma.$queryRaw`
    SELECT ls.id
    FROM "LabelSnapshot" ls
    WHERE ls."labelType" = 'INGREDIENT'
    AND NOT EXISTS (
      SELECT 1 FROM "LabelLineageEdge" lle
      WHERE lle."childLabelId" = ls.id
    )
  ` as any[];

  if (orphanIngredients.length > 0) {
    const ids = orphanIngredients.map((o: any) => o.id);
    const deleted = await prisma.$executeRaw`
      DELETE FROM "LabelSnapshot"
      WHERE id = ANY(${ids})
    `;
    console.log(`INGREDIENT: deleted ${deleted} orphans`);
  } else {
    console.log("INGREDIENT: no orphans");
  }

  // Final counts
  const finalCounts = await prisma.$queryRaw`
    SELECT "labelType", COUNT(*) as cnt
    FROM "LabelSnapshot"
    GROUP BY "labelType"
    ORDER BY "labelType"
  ` as any[];
  console.log("\nFinal LabelSnapshot counts:");
  for (const c of finalCounts) {
    console.log(`  ${c.labelType}: ${c.cnt}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
