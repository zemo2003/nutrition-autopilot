import { PrismaClient, RoleName, ComponentType, StorageLocation, FlavorProfile, PreparedState } from "@prisma/client";
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

  // ── Component seed data ───────────────────────────────────────────────
  // Look up ingredients by canonicalKey for linking ComponentLines
  const ingredientByKey = new Map<string, string>();
  const allIngredients = await prisma.ingredientCatalog.findMany({ select: { id: true, canonicalKey: true } });
  for (const ing of allIngredients) ingredientByKey.set(ing.canonicalKey, ing.id);

  const componentDefs: Array<{
    name: string;
    componentType: ComponentType;
    defaultYieldFactor: number;
    shelfLifeHours: number;
    storageLocation: StorageLocation;
    allergenTags: string[];
    flavorProfiles: FlavorProfile[];
    portionIncrementG: number;
    lines: Array<{
      ingredientKey: string;
      lineOrder: number;
      targetGPer100g: number;
      preparation: string;
      preparedState: PreparedState;
    }>;
  }> = [
    // ── PROTEINS ──
    {
      name: "Grilled Chicken Breast",
      componentType: ComponentType.PROTEIN,
      defaultYieldFactor: 0.75,
      shelfLifeHours: 96,
      storageLocation: StorageLocation.FRIDGE,
      allergenTags: [],
      flavorProfiles: [FlavorProfile.SAVORY],
      portionIncrementG: 112,
      lines: [
        { ingredientKey: "chicken_breast_kosher", lineOrder: 1, targetGPer100g: 90, preparation: "trimmed, butterflied", preparedState: PreparedState.RAW },
        { ingredientKey: "olive_oil_evoo", lineOrder: 2, targetGPer100g: 3, preparation: "light coat", preparedState: PreparedState.RAW },
        { ingredientKey: "ING-SALT", lineOrder: 3, targetGPer100g: 0.5, preparation: "seasoning", preparedState: PreparedState.RAW },
        { ingredientKey: "ING-BLACK-PEPPER", lineOrder: 4, targetGPer100g: 0.3, preparation: "seasoning", preparedState: PreparedState.RAW },
      ],
    },
    {
      name: "Seasoned Ground Turkey",
      componentType: ComponentType.PROTEIN,
      defaultYieldFactor: 0.78,
      shelfLifeHours: 72,
      storageLocation: StorageLocation.FRIDGE,
      allergenTags: [],
      flavorProfiles: [FlavorProfile.SAVORY, FlavorProfile.SPICY],
      portionIncrementG: 112,
      lines: [
        { ingredientKey: "ING-GROUND-TURKEY-93-COOKED", lineOrder: 1, targetGPer100g: 92, preparation: "crumbled", preparedState: PreparedState.RAW },
        { ingredientKey: "ING-ONION", lineOrder: 2, targetGPer100g: 5, preparation: "diced fine", preparedState: PreparedState.RAW },
        { ingredientKey: "ING-SALT", lineOrder: 3, targetGPer100g: 0.4, preparation: "seasoning", preparedState: PreparedState.RAW },
      ],
    },
    {
      name: "Baked Salmon Portions",
      componentType: ComponentType.PROTEIN,
      defaultYieldFactor: 0.82,
      shelfLifeHours: 72,
      storageLocation: StorageLocation.FRIDGE,
      allergenTags: ["fish"],
      flavorProfiles: [FlavorProfile.SAVORY, FlavorProfile.UMAMI],
      portionIncrementG: 140,
      lines: [
        { ingredientKey: "salmon_portions_atlantic", lineOrder: 1, targetGPer100g: 93, preparation: "skin-on fillet", preparedState: PreparedState.RAW },
        { ingredientKey: "olive_oil_evoo", lineOrder: 2, targetGPer100g: 2, preparation: "drizzle", preparedState: PreparedState.RAW },
        { ingredientKey: "ING-LEMON-JUICE", lineOrder: 3, targetGPer100g: 2, preparation: "squeeze", preparedState: PreparedState.RAW },
        { ingredientKey: "ING-SALT", lineOrder: 4, targetGPer100g: 0.4, preparation: "seasoning", preparedState: PreparedState.RAW },
      ],
    },
    {
      name: "Lean Ground Beef",
      componentType: ComponentType.PROTEIN,
      defaultYieldFactor: 0.73,
      shelfLifeHours: 72,
      storageLocation: StorageLocation.FRIDGE,
      allergenTags: [],
      flavorProfiles: [FlavorProfile.SAVORY, FlavorProfile.UMAMI],
      portionIncrementG: 112,
      lines: [
        { ingredientKey: "ground_beef_kosher", lineOrder: 1, targetGPer100g: 95, preparation: "crumbled", preparedState: PreparedState.RAW },
        { ingredientKey: "ING-SALT", lineOrder: 2, targetGPer100g: 0.4, preparation: "seasoning", preparedState: PreparedState.RAW },
        { ingredientKey: "ING-BLACK-PEPPER", lineOrder: 3, targetGPer100g: 0.2, preparation: "seasoning", preparedState: PreparedState.RAW },
      ],
    },
    {
      name: "Baked Cod Fillet",
      componentType: ComponentType.PROTEIN,
      defaultYieldFactor: 0.80,
      shelfLifeHours: 48,
      storageLocation: StorageLocation.FRIDGE,
      allergenTags: ["fish"],
      flavorProfiles: [FlavorProfile.SAVORY, FlavorProfile.HERBAL],
      portionIncrementG: 140,
      lines: [
        { ingredientKey: "ING-COD-COOKED", lineOrder: 1, targetGPer100g: 93, preparation: "fillet, patted dry", preparedState: PreparedState.RAW },
        { ingredientKey: "olive_oil_evoo", lineOrder: 2, targetGPer100g: 2, preparation: "drizzle", preparedState: PreparedState.RAW },
        { ingredientKey: "ING-LEMON-JUICE", lineOrder: 3, targetGPer100g: 2, preparation: "squeeze", preparedState: PreparedState.RAW },
      ],
    },

    // ── CARB BASES ──
    {
      name: "Steamed White Rice",
      componentType: ComponentType.CARB_BASE,
      defaultYieldFactor: 2.2,
      shelfLifeHours: 96,
      storageLocation: StorageLocation.FRIDGE,
      allergenTags: [],
      flavorProfiles: [FlavorProfile.NEUTRAL],
      portionIncrementG: 150,
      lines: [
        { ingredientKey: "ING-WHITE-RICE-COOKED", lineOrder: 1, targetGPer100g: 98, preparation: "rinsed", preparedState: PreparedState.DRY },
        { ingredientKey: "ING-SALT", lineOrder: 2, targetGPer100g: 0.3, preparation: "in water", preparedState: PreparedState.RAW },
      ],
    },
    {
      name: "Roasted Sweet Potato",
      componentType: ComponentType.CARB_BASE,
      defaultYieldFactor: 0.85,
      shelfLifeHours: 96,
      storageLocation: StorageLocation.FRIDGE,
      allergenTags: [],
      flavorProfiles: [FlavorProfile.SWEET, FlavorProfile.SAVORY],
      portionIncrementG: 150,
      lines: [
        { ingredientKey: "sweet_potato", lineOrder: 1, targetGPer100g: 95, preparation: "cubed 1-inch", preparedState: PreparedState.RAW },
        { ingredientKey: "olive_oil_evoo", lineOrder: 2, targetGPer100g: 3, preparation: "toss to coat", preparedState: PreparedState.RAW },
        { ingredientKey: "ING-SALT", lineOrder: 3, targetGPer100g: 0.3, preparation: "seasoning", preparedState: PreparedState.RAW },
      ],
    },
    {
      name: "Cooked Quinoa",
      componentType: ComponentType.CARB_BASE,
      defaultYieldFactor: 2.5,
      shelfLifeHours: 120,
      storageLocation: StorageLocation.FRIDGE,
      allergenTags: [],
      flavorProfiles: [FlavorProfile.NEUTRAL, FlavorProfile.SAVORY],
      portionIncrementG: 140,
      lines: [
        { ingredientKey: "quinoa_white_red_steamables", lineOrder: 1, targetGPer100g: 98, preparation: "rinsed", preparedState: PreparedState.DRY },
        { ingredientKey: "ING-SALT", lineOrder: 2, targetGPer100g: 0.3, preparation: "in water", preparedState: PreparedState.RAW },
      ],
    },
    {
      name: "Baked White Potato",
      componentType: ComponentType.CARB_BASE,
      defaultYieldFactor: 0.88,
      shelfLifeHours: 96,
      storageLocation: StorageLocation.FRIDGE,
      allergenTags: [],
      flavorProfiles: [FlavorProfile.NEUTRAL],
      portionIncrementG: 170,
      lines: [
        { ingredientKey: "white_potato", lineOrder: 1, targetGPer100g: 97, preparation: "cubed or halved", preparedState: PreparedState.RAW },
        { ingredientKey: "olive_oil_evoo", lineOrder: 2, targetGPer100g: 2, preparation: "light coat", preparedState: PreparedState.RAW },
        { ingredientKey: "ING-SALT", lineOrder: 3, targetGPer100g: 0.3, preparation: "seasoning", preparedState: PreparedState.RAW },
      ],
    },
    {
      name: "Overnight Oats Base",
      componentType: ComponentType.CARB_BASE,
      defaultYieldFactor: 1.8,
      shelfLifeHours: 72,
      storageLocation: StorageLocation.FRIDGE,
      allergenTags: ["gluten"],
      flavorProfiles: [FlavorProfile.SWEET, FlavorProfile.NEUTRAL],
      portionIncrementG: 200,
      lines: [
        { ingredientKey: "oats_rolled_old_fashioned", lineOrder: 1, targetGPer100g: 45, preparation: "dry", preparedState: PreparedState.DRY },
        { ingredientKey: "greek_yogurt_2pct_plain", lineOrder: 2, targetGPer100g: 30, preparation: "mixed in", preparedState: PreparedState.RAW },
        { ingredientKey: "raw_honey", lineOrder: 3, targetGPer100g: 5, preparation: "drizzle", preparedState: PreparedState.RAW },
      ],
    },

    // ── VEGETABLES ──
    {
      name: "Steamed California Blend",
      componentType: ComponentType.VEGETABLE,
      defaultYieldFactor: 0.88,
      shelfLifeHours: 72,
      storageLocation: StorageLocation.FRIDGE,
      allergenTags: [],
      flavorProfiles: [FlavorProfile.SAVORY, FlavorProfile.NEUTRAL],
      portionIncrementG: 100,
      lines: [
        { ingredientKey: "california_blend_veg", lineOrder: 1, targetGPer100g: 97, preparation: "steamed al dente", preparedState: PreparedState.FROZEN },
        { ingredientKey: "ING-SALT", lineOrder: 2, targetGPer100g: 0.3, preparation: "light seasoning", preparedState: PreparedState.RAW },
      ],
    },
    {
      name: "Sautéed Spinach",
      componentType: ComponentType.VEGETABLE,
      defaultYieldFactor: 0.30,
      shelfLifeHours: 48,
      storageLocation: StorageLocation.FRIDGE,
      allergenTags: [],
      flavorProfiles: [FlavorProfile.SAVORY, FlavorProfile.HERBAL],
      portionIncrementG: 60,
      lines: [
        { ingredientKey: "baby_spinach", lineOrder: 1, targetGPer100g: 92, preparation: "washed, stems removed", preparedState: PreparedState.RAW },
        { ingredientKey: "olive_oil_evoo", lineOrder: 2, targetGPer100g: 4, preparation: "sauté medium", preparedState: PreparedState.RAW },
        { ingredientKey: "ING-SALT", lineOrder: 3, targetGPer100g: 0.3, preparation: "seasoning", preparedState: PreparedState.RAW },
      ],
    },
    {
      name: "Roasted Butternut Squash",
      componentType: ComponentType.VEGETABLE,
      defaultYieldFactor: 0.82,
      shelfLifeHours: 96,
      storageLocation: StorageLocation.FRIDGE,
      allergenTags: [],
      flavorProfiles: [FlavorProfile.SWEET, FlavorProfile.SAVORY],
      portionIncrementG: 120,
      lines: [
        { ingredientKey: "butternut_squash", lineOrder: 1, targetGPer100g: 93, preparation: "peeled, cubed 1-inch", preparedState: PreparedState.RAW },
        { ingredientKey: "olive_oil_evoo", lineOrder: 2, targetGPer100g: 3, preparation: "toss to coat", preparedState: PreparedState.RAW },
        { ingredientKey: "ING-CEYLON-CINNAMON", lineOrder: 3, targetGPer100g: 0.5, preparation: "dusted", preparedState: PreparedState.DRY },
        { ingredientKey: "ING-SALT", lineOrder: 4, targetGPer100g: 0.3, preparation: "seasoning", preparedState: PreparedState.RAW },
      ],
    },
    {
      name: "Steamed Mixed Vegetables",
      componentType: ComponentType.VEGETABLE,
      defaultYieldFactor: 0.90,
      shelfLifeHours: 72,
      storageLocation: StorageLocation.FRIDGE,
      allergenTags: [],
      flavorProfiles: [FlavorProfile.SAVORY, FlavorProfile.NEUTRAL],
      portionIncrementG: 100,
      lines: [
        { ingredientKey: "ING-MIXED-VEGETABLES", lineOrder: 1, targetGPer100g: 97, preparation: "steamed", preparedState: PreparedState.FROZEN },
        { ingredientKey: "ING-SALT", lineOrder: 2, targetGPer100g: 0.3, preparation: "seasoning", preparedState: PreparedState.RAW },
      ],
    },
    {
      name: "Roasted Zucchini",
      componentType: ComponentType.VEGETABLE,
      defaultYieldFactor: 0.78,
      shelfLifeHours: 72,
      storageLocation: StorageLocation.FRIDGE,
      allergenTags: [],
      flavorProfiles: [FlavorProfile.SAVORY, FlavorProfile.HERBAL],
      portionIncrementG: 100,
      lines: [
        { ingredientKey: "zucchini", lineOrder: 1, targetGPer100g: 93, preparation: "halved lengthwise, sliced ½-inch", preparedState: PreparedState.RAW },
        { ingredientKey: "olive_oil_evoo", lineOrder: 2, targetGPer100g: 3, preparation: "toss to coat", preparedState: PreparedState.RAW },
        { ingredientKey: "ING-SALT", lineOrder: 3, targetGPer100g: 0.3, preparation: "seasoning", preparedState: PreparedState.RAW },
      ],
    },

    // ── SAUCES ──
    {
      name: "Marinara Sauce",
      componentType: ComponentType.SAUCE,
      defaultYieldFactor: 0.95,
      shelfLifeHours: 120,
      storageLocation: StorageLocation.FRIDGE,
      allergenTags: [],
      flavorProfiles: [FlavorProfile.SAVORY, FlavorProfile.ACIDIC, FlavorProfile.HERBAL],
      portionIncrementG: 60,
      lines: [
        { ingredientKey: "ING-MARINARA-PASTA-SAUCE", lineOrder: 1, targetGPer100g: 85, preparation: "heated and reduced", preparedState: PreparedState.CANNED },
        { ingredientKey: "olive_oil_evoo", lineOrder: 2, targetGPer100g: 5, preparation: "base sauté", preparedState: PreparedState.RAW },
        { ingredientKey: "ING-ONION", lineOrder: 3, targetGPer100g: 5, preparation: "diced fine", preparedState: PreparedState.RAW },
        { ingredientKey: "ING-SALT", lineOrder: 4, targetGPer100g: 0.3, preparation: "to taste", preparedState: PreparedState.RAW },
      ],
    },
    {
      name: "Red Curry Sauce",
      componentType: ComponentType.SAUCE,
      defaultYieldFactor: 1.0,
      shelfLifeHours: 96,
      storageLocation: StorageLocation.FRIDGE,
      allergenTags: [],
      flavorProfiles: [FlavorProfile.SPICY, FlavorProfile.SAVORY, FlavorProfile.UMAMI],
      portionIncrementG: 50,
      lines: [
        { ingredientKey: "ING-RED-CURRY-PASTE", lineOrder: 1, targetGPer100g: 15, preparation: "bloom in oil", preparedState: PreparedState.CANNED },
        { ingredientKey: "olive_oil_evoo", lineOrder: 2, targetGPer100g: 5, preparation: "base", preparedState: PreparedState.RAW },
        { ingredientKey: "ING-ONION", lineOrder: 3, targetGPer100g: 8, preparation: "diced", preparedState: PreparedState.RAW },
      ],
    },

    // ── CONDIMENTS ──
    {
      name: "Honey Lemon Drizzle",
      componentType: ComponentType.CONDIMENT,
      defaultYieldFactor: 1.0,
      shelfLifeHours: 168,
      storageLocation: StorageLocation.FRIDGE,
      allergenTags: [],
      flavorProfiles: [FlavorProfile.SWEET, FlavorProfile.ACIDIC],
      portionIncrementG: 15,
      lines: [
        { ingredientKey: "raw_honey", lineOrder: 1, targetGPer100g: 60, preparation: "warmed slightly", preparedState: PreparedState.RAW },
        { ingredientKey: "ING-LEMON-JUICE", lineOrder: 2, targetGPer100g: 35, preparation: "fresh squeezed", preparedState: PreparedState.RAW },
        { ingredientKey: "ING-SALT", lineOrder: 3, targetGPer100g: 0.2, preparation: "pinch", preparedState: PreparedState.RAW },
      ],
    },
    {
      name: "PB Drizzle",
      componentType: ComponentType.CONDIMENT,
      defaultYieldFactor: 1.0,
      shelfLifeHours: 168,
      storageLocation: StorageLocation.PANTRY,
      allergenTags: ["peanut", "tree nut"],
      flavorProfiles: [FlavorProfile.SAVORY, FlavorProfile.SWEET, FlavorProfile.UMAMI],
      portionIncrementG: 16,
      lines: [
        { ingredientKey: "ING-PEANUT-BUTTER", lineOrder: 1, targetGPer100g: 90, preparation: "stirred smooth", preparedState: PreparedState.RAW },
        { ingredientKey: "raw_honey", lineOrder: 2, targetGPer100g: 8, preparation: "sweetener", preparedState: PreparedState.RAW },
      ],
    },
  ];

  let componentCount = 0;
  let lineCount = 0;

  for (const def of componentDefs) {
    // Verify all ingredient keys exist before creating
    const missingKeys = def.lines
      .filter(l => !ingredientByKey.has(l.ingredientKey))
      .map(l => l.ingredientKey);

    if (missingKeys.length > 0) {
      console.warn(`Skipping component "${def.name}" — missing ingredients: ${missingKeys.join(", ")}`);
      continue;
    }

    const component = await prisma.component.upsert({
      where: { organizationId_name: { organizationId: org.id, name: def.name } },
      update: {
        componentType: def.componentType,
        defaultYieldFactor: def.defaultYieldFactor,
        shelfLifeHours: def.shelfLifeHours,
        storageLocation: def.storageLocation,
        allergenTags: def.allergenTags,
        flavorProfiles: def.flavorProfiles,
        portionIncrementG: def.portionIncrementG,
      },
      create: {
        organizationId: org.id,
        name: def.name,
        componentType: def.componentType,
        defaultYieldFactor: def.defaultYieldFactor,
        shelfLifeHours: def.shelfLifeHours,
        storageLocation: def.storageLocation,
        allergenTags: def.allergenTags,
        flavorProfiles: def.flavorProfiles,
        portionIncrementG: def.portionIncrementG,
        createdBy: "seed",
      },
    });

    // Upsert each line
    for (const lineDef of def.lines) {
      const ingredientId = ingredientByKey.get(lineDef.ingredientKey)!;
      await prisma.componentLine.upsert({
        where: { componentId_lineOrder: { componentId: component.id, lineOrder: lineDef.lineOrder } },
        update: {
          ingredientId,
          targetGPer100g: lineDef.targetGPer100g,
          preparation: lineDef.preparation,
          preparedState: lineDef.preparedState,
        },
        create: {
          componentId: component.id,
          ingredientId,
          lineOrder: lineDef.lineOrder,
          targetGPer100g: lineDef.targetGPer100g,
          preparation: lineDef.preparation,
          preparedState: lineDef.preparedState,
        },
      });
      lineCount++;
    }
    componentCount++;
  }

  console.log("Component seed complete", { componentCount, lineCount });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
