import { PrismaClient, RoleName } from "@prisma/client";
import { nutrientKeys } from "@nutrition/contracts";

const prisma = new PrismaClient();

const nutrientMeta: Record<string, { label: string; unit: string; dailyValue?: number; fdaCore: boolean }> = {
  kcal: { label: "Calories", unit: "kcal", fdaCore: true },
  protein_g: { label: "Protein", unit: "g", fdaCore: true },
  carb_g: { label: "Total Carbohydrate", unit: "g", dailyValue: 275, fdaCore: true },
  fat_g: { label: "Total Fat", unit: "g", dailyValue: 78, fdaCore: true },
  fiber_g: { label: "Dietary Fiber", unit: "g", dailyValue: 28, fdaCore: true },
  sugars_g: { label: "Total Sugars", unit: "g", fdaCore: true },
  added_sugars_g: { label: "Added Sugars", unit: "g", dailyValue: 50, fdaCore: true },
  sat_fat_g: { label: "Saturated Fat", unit: "g", dailyValue: 20, fdaCore: true },
  trans_fat_g: { label: "Trans Fat", unit: "g", fdaCore: true },
  cholesterol_mg: { label: "Cholesterol", unit: "mg", dailyValue: 300, fdaCore: true },
  sodium_mg: { label: "Sodium", unit: "mg", dailyValue: 2300, fdaCore: true },
  vitamin_d_mcg: { label: "Vitamin D", unit: "mcg", dailyValue: 20, fdaCore: true },
  calcium_mg: { label: "Calcium", unit: "mg", dailyValue: 1300, fdaCore: true },
  iron_mg: { label: "Iron", unit: "mg", dailyValue: 18, fdaCore: true },
  potassium_mg: { label: "Potassium", unit: "mg", dailyValue: 4700, fdaCore: true },
  vitamin_a_mcg: { label: "Vitamin A", unit: "mcg", dailyValue: 900, fdaCore: false },
  vitamin_c_mg: { label: "Vitamin C", unit: "mg", dailyValue: 90, fdaCore: false },
  vitamin_e_mg: { label: "Vitamin E", unit: "mg", dailyValue: 15, fdaCore: false },
  vitamin_k_mcg: { label: "Vitamin K", unit: "mcg", dailyValue: 120, fdaCore: false },
  thiamin_mg: { label: "Thiamin", unit: "mg", dailyValue: 1.2, fdaCore: false },
  riboflavin_mg: { label: "Riboflavin", unit: "mg", dailyValue: 1.3, fdaCore: false },
  niacin_mg: { label: "Niacin", unit: "mg", dailyValue: 16, fdaCore: false },
  vitamin_b6_mg: { label: "Vitamin B6", unit: "mg", dailyValue: 1.7, fdaCore: false },
  folate_mcg: { label: "Folate", unit: "mcg", dailyValue: 400, fdaCore: false },
  vitamin_b12_mcg: { label: "Vitamin B12", unit: "mcg", dailyValue: 2.4, fdaCore: false },
  biotin_mcg: { label: "Biotin", unit: "mcg", dailyValue: 30, fdaCore: false },
  pantothenic_acid_mg: { label: "Pantothenic Acid", unit: "mg", dailyValue: 5, fdaCore: false },
  phosphorus_mg: { label: "Phosphorus", unit: "mg", dailyValue: 1250, fdaCore: false },
  iodine_mcg: { label: "Iodine", unit: "mcg", dailyValue: 150, fdaCore: false },
  magnesium_mg: { label: "Magnesium", unit: "mg", dailyValue: 420, fdaCore: false },
  zinc_mg: { label: "Zinc", unit: "mg", dailyValue: 11, fdaCore: false },
  selenium_mcg: { label: "Selenium", unit: "mcg", dailyValue: 55, fdaCore: false },
  copper_mg: { label: "Copper", unit: "mg", dailyValue: 0.9, fdaCore: false },
  manganese_mg: { label: "Manganese", unit: "mg", dailyValue: 2.3, fdaCore: false },
  chromium_mcg: { label: "Chromium", unit: "mcg", dailyValue: 35, fdaCore: false },
  molybdenum_mcg: { label: "Molybdenum", unit: "mcg", dailyValue: 45, fdaCore: false },
  chloride_mg: { label: "Chloride", unit: "mg", dailyValue: 2300, fdaCore: false },
  choline_mg: { label: "Choline", unit: "mg", dailyValue: 550, fdaCore: false },
  omega3_g: { label: "Omega-3", unit: "g", fdaCore: false },
  omega6_g: { label: "Omega-6", unit: "g", fdaCore: false }
};

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: "primary" },
    update: { name: "Primary Organization" },
    create: { slug: "primary", name: "Primary Organization", createdBy: "seed" }
  });

  const owner = await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email: "owner@nutrition-autopilot.local" } },
    update: { fullName: "System Owner" },
    create: {
      organizationId: org.id,
      email: "owner@nutrition-autopilot.local",
      fullName: "System Owner",
      createdBy: "seed"
    }
  });

  for (const roleName of Object.values(RoleName)) {
    const role = await prisma.role.upsert({
      where: { organizationId_name: { organizationId: org.id, name: roleName } },
      update: {},
      create: {
        organizationId: org.id,
        name: roleName,
        description: `${roleName} role`,
        createdBy: "seed"
      }
    });

    if (roleName === RoleName.OWNER) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: owner.id, roleId: role.id } },
        update: {},
        create: { userId: owner.id, roleId: role.id, createdBy: "seed" }
      });
    }
  }

  for (const [idx, key] of nutrientKeys.entries()) {
    const meta = nutrientMeta[key];
    await prisma.nutrientDefinition.upsert({
      where: { key },
      update: {
        label: meta.label,
        unit: meta.unit,
        dailyValue: meta.dailyValue,
        fdaCore: meta.fdaCore,
        displayOrder: idx + 1
      },
      create: {
        key,
        label: meta.label,
        unit: meta.unit,
        dailyValue: meta.dailyValue,
        fdaCore: meta.fdaCore,
        displayOrder: idx + 1,
        createdBy: "seed"
      }
    });
  }

  console.log("Seed complete", { organizationId: org.id, ownerId: owner.id, nutrientCount: nutrientKeys.length });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
