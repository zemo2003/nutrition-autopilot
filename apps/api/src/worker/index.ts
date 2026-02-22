import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { prisma } from "@nutrition/db";
import { runNutrientAutofillSweep } from "./nutrient-autofill.js";

function bootstrapEnv() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
    path.resolve(here, "../../../.env")
  ];

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    loadEnv({ path: envPath, override: false });
    return;
  }
}

bootstrapEnv();

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
    const coreSet = new Set(
      product.nutrients
        .filter((n) => typeof n.valuePer100g === "number")
        .map((n) => n.nutrientDefinition.key)
    );
    const hasCore = ["kcal", "protein_g", "carb_g", "fat_g"].every((k) => coreSet.has(k));
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
  await runNutrientAutofillSweep();
  await runConsistencySweep();
  setInterval(async () => {
    try {
      await runNutrientAutofillSweep();
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
