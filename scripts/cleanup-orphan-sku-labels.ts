/**
 * cleanup-orphan-sku-labels.ts
 *
 * Deletes orphaned SKU labels with >30% calorie error that are not linked
 * to any active MealServiceEvent. These are old v1 labels from before the
 * yield factor pipeline was implemented.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Cleanup orphaned high-error SKU labels ===\n");

  // Find orphaned SKU labels with >30% calorie error
  const orphans = await prisma.$queryRaw`
    SELECT ls.id, ls.title,
           (ls."renderPayload"->'qa'->>'percentError')::float as pct_error
    FROM "LabelSnapshot" ls
    LEFT JOIN "MealServiceEvent" mse ON mse."finalLabelSnapshotId" = ls.id
    WHERE ls."labelType" = 'SKU'
    AND ABS((ls."renderPayload"->'qa'->>'percentError')::float) > 0.30
    AND mse.id IS NULL
  ` as any[];

  console.log(`Found ${orphans.length} orphaned high-error SKU labels`);
  for (const o of orphans) {
    console.log(`  ${o.title}: ${(o.pct_error * 100).toFixed(1)}%`);
  }

  const orphanIds = orphans.map((o: any) => o.id);

  if (orphanIds.length === 0) {
    console.log("\nNothing to clean up.");
    await prisma.$disconnect();
    return;
  }

  // Delete lineage edges
  const edgesDeleted = await prisma.$executeRaw`
    DELETE FROM "LabelLineageEdge"
    WHERE "parentLabelId" = ANY(${orphanIds})
    OR "childLabelId" = ANY(${orphanIds})
  `;
  console.log(`\nLineage edges deleted: ${edgesDeleted}`);

  // Delete the labels
  const labelsDeleted = await prisma.$executeRaw`
    DELETE FROM "LabelSnapshot"
    WHERE id = ANY(${orphanIds})
  `;
  console.log(`SKU labels deleted: ${labelsDeleted}`);

  // Verify no remaining high-error labels
  const remaining = await prisma.$queryRaw`
    SELECT COUNT(*) as cnt
    FROM "LabelSnapshot"
    WHERE "labelType" = 'SKU'
    AND ABS(("renderPayload"->'qa'->>'percentError')::float) > 0.30
  ` as any[];
  console.log(`\nRemaining SKU labels with >30% error: ${remaining[0]?.cnt}`);

  // Show overall QA pass rate
  const qaStats = await prisma.$queryRaw`
    SELECT
      COUNT(*) FILTER (WHERE ("renderPayload"->'qa'->>'pass')::boolean = true) as passing,
      COUNT(*) FILTER (WHERE ("renderPayload"->'qa'->>'pass')::boolean = false) as failing,
      COUNT(*) as total
    FROM "LabelSnapshot"
    WHERE "labelType" = 'SKU'
    AND "renderPayload"->'qa' IS NOT NULL
  ` as any[];
  console.log(`\nSKU QA stats: ${qaStats[0]?.passing} passing, ${qaStats[0]?.failing} failing, ${qaStats[0]?.total} total`);

  await prisma.$disconnect();
}

main().catch(console.error);
