/**
 * cleanup-orphan-labels-final.ts
 *
 * Deletes all orphaned (not linked to MealServiceEvent) SKU labels
 * that have QA failures. Also cleans up any remaining orphaned
 * labels from older pipeline versions.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Final orphan label cleanup ===\n");

  // Find all orphaned SKU labels (not linked to any event)
  const orphanSkus = await prisma.$queryRaw`
    SELECT ls.id, ls.title, ls.version,
           ("renderPayload"->'qa'->>'pass')::boolean as pass
    FROM "LabelSnapshot" ls
    LEFT JOIN "MealServiceEvent" mse ON mse."finalLabelSnapshotId" = ls.id
    WHERE ls."labelType" = 'SKU'
    AND mse.id IS NULL
  ` as any[];

  console.log(`Orphaned SKU labels: ${orphanSkus.length}`);
  const passCounts = { true: 0, false: 0, null: 0 };
  for (const o of orphanSkus) {
    if (o.pass === true) passCounts.true++;
    else if (o.pass === false) passCounts.false++;
    else passCounts.null++;
  }
  console.log(`  Passing: ${passCounts.true}, Failing: ${passCounts.false}, No QA: ${passCounts.null}`);

  const orphanIds = orphanSkus.map((o: any) => o.id);

  if (orphanIds.length > 0) {
    // Get all child label IDs that are ONLY linked to these orphan parents
    const orphanChildIds = await prisma.$queryRaw`
      SELECT DISTINCT lle."childLabelId" as id
      FROM "LabelLineageEdge" lle
      WHERE lle."parentLabelId" = ANY(${orphanIds})
      AND NOT EXISTS (
        SELECT 1 FROM "LabelLineageEdge" lle2
        WHERE lle2."childLabelId" = lle."childLabelId"
        AND lle2."parentLabelId" != ALL(${orphanIds})
      )
    ` as any[];

    const childIds = orphanChildIds.map((c: any) => c.id);
    console.log(`  Exclusively-orphaned child labels: ${childIds.length}`);

    // Delete edges first
    const allIds = [...orphanIds, ...childIds];
    const edgesDeleted = await prisma.$executeRaw`
      DELETE FROM "LabelLineageEdge"
      WHERE "parentLabelId" = ANY(${allIds})
      OR "childLabelId" = ANY(${allIds})
    `;
    console.log(`  Lineage edges deleted: ${edgesDeleted}`);

    // Delete orphan SKU labels
    const skusDeleted = await prisma.$executeRaw`
      DELETE FROM "LabelSnapshot"
      WHERE id = ANY(${orphanIds})
    `;
    console.log(`  Orphan SKU labels deleted: ${skusDeleted}`);

    // Delete exclusively-orphaned children
    if (childIds.length > 0) {
      const childrenDeleted = await prisma.$executeRaw`
        DELETE FROM "LabelSnapshot"
        WHERE id = ANY(${childIds})
      `;
      console.log(`  Orphan child labels deleted: ${childrenDeleted}`);
    }
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

  // Final QA stats
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

  await prisma.$disconnect();
}

main().catch(console.error);
