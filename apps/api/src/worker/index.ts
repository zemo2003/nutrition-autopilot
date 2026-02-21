import "dotenv/config";
import { prisma } from "@nutrition/db";

async function runConsistencySweep() {
  const products = await prisma.productCatalog.findMany({
    include: {
      nutrients: {
        include: {
          nutrientDefinition: true
        }
      }
    }
  });

  for (const product of products) {
    const hasCore = product.nutrients.some((n) =>
      ["kcal", "protein_g", "carb_g", "fat_g"].includes(n.nutrientDefinition.key)
    );
    if (!hasCore) {
      const existing = await prisma.verificationTask.findFirst({
        where: {
          organizationId: product.organizationId,
          taskType: "CONSISTENCY",
          status: "OPEN",
          payload: {
            path: ["productId"],
            equals: product.id
          }
        }
      });

      if (!existing) {
        await prisma.verificationTask.create({
          data: {
            organizationId: product.organizationId,
            taskType: "CONSISTENCY",
            severity: "HIGH",
            status: "OPEN",
            title: `Missing core nutrients for ${product.name}`,
            description: "Product nutrient profile missing one or more core macro rows.",
            payload: { productId: product.id, productName: product.name },
            createdBy: "agent"
          }
        });
      }
    }
  }
}

async function main() {
  console.log("worker started");
  await runConsistencySweep();
  setInterval(async () => {
    try {
      await runConsistencySweep();
      console.log("worker sweep complete", new Date().toISOString());
    } catch (error) {
      console.error("worker sweep failed", error);
    }
  }, 60_000);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
