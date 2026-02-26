import { describe, it, expect } from "vitest";
import {
  extractIngredients,
  extractLots,
  extractNutrientProvenance,
  generateQaWarnings,
  buildMealAuditTrace,
  type AuditLabelPayload,
  type AuditLineageNode,
} from "./audit-trace.js";

function makePayload(overrides: Partial<AuditLabelPayload> = {}): AuditLabelPayload {
  return {
    skuName: "Chicken Bowl",
    recipeName: "Grilled Chicken Rice Bowl",
    servings: 1,
    servingWeightG: 450,
    perServing: { kcal: 520, protein_g: 42, carb_g: 55, fat_g: 14, sodium_mg: 680 },
    provisional: false,
    reasonCodes: [],
    plausibility: { valid: true, errorCount: 0, warningCount: 0, issues: [] },
    evidenceSummary: {
      verifiedCount: 12,
      inferredCount: 0,
      exceptionCount: 0,
      unverifiedCount: 0,
      totalNutrientRows: 12,
      provisional: false,
      sourceRefs: ["USDA_BRANDED"],
      gradeBreakdown: { USDA_BRANDED: 12 },
    },
    ...overrides,
  };
}

function makeTree(): AuditLineageNode {
  return {
    labelId: "label-1",
    labelType: "SKU",
    title: "Chicken Bowl",
    metadata: {},
    children: [
      {
        labelId: "label-2",
        labelType: "INGREDIENT",
        title: "Chicken Breast",
        metadata: {
          ingredientName: "Chicken Breast",
          consumedGrams: 200,
          allergenEvidence: { allergenTags: [] },
          provisional: false,
          reasonCodes: [],
        },
        children: [
          {
            labelId: "label-3",
            labelType: "PRODUCT",
            title: "Organic Chicken Breast",
            metadata: { productName: "Organic Chicken Breast" },
            children: [
              {
                labelId: "label-4",
                labelType: "LOT",
                title: "Lot ABC123",
                metadata: {
                  lotId: "lot-1",
                  lotCode: "ABC123",
                  productName: "Organic Chicken Breast",
                  gramsConsumed: 200,
                  sourceOrderRef: "ORDER-001",
                  receivedAt: "2026-02-20",
                  expiresAt: "2026-03-01",
                  syntheticLot: false,
                  provisional: false,
                },
                children: [],
              },
            ],
          },
        ],
      },
      {
        labelId: "label-5",
        labelType: "INGREDIENT",
        title: "Brown Rice",
        metadata: {
          ingredientName: "Brown Rice",
          consumedGrams: 200,
          allergenEvidence: { allergenTags: ["gluten"] },
          provisional: true,
          reasonCodes: ["UNVERIFIED_SOURCE"],
        },
        children: [
          {
            labelId: "label-6",
            labelType: "LOT",
            title: "Lot DEF456",
            metadata: {
              lotId: "lot-2",
              lotCode: "DEF456",
              productName: "Brown Rice",
              gramsConsumed: 200,
              syntheticLot: true,
              provisional: true,
            },
            children: [],
          },
        ],
      },
    ],
  };
}

describe("audit-trace", () => {
  describe("extractIngredients", () => {
    it("extracts ingredient summaries from lineage tree", () => {
      const tree = makeTree();
      const ingredients = extractIngredients(tree);
      expect(ingredients.length).toBe(2);
      expect(ingredients[0]!.ingredientName).toBe("Chicken Breast");
      expect(ingredients[0]!.consumedGrams).toBe(200);
    });

    it("sorts by grams consumed (descending)", () => {
      const tree = makeTree();
      tree.children[0]!.metadata.consumedGrams = 100;
      tree.children[1]!.metadata.consumedGrams = 300;
      const ingredients = extractIngredients(tree);
      expect(ingredients[0]!.ingredientName).toBe("Brown Rice");
    });

    it("extracts allergen tags", () => {
      const tree = makeTree();
      const ingredients = extractIngredients(tree);
      const rice = ingredients.find((i) => i.ingredientName === "Brown Rice");
      expect(rice?.allergenTags).toContain("gluten");
    });

    it("extracts provisional status", () => {
      const tree = makeTree();
      const ingredients = extractIngredients(tree);
      expect(ingredients.find((i) => i.ingredientName === "Brown Rice")?.provisional).toBe(true);
      expect(ingredients.find((i) => i.ingredientName === "Chicken Breast")?.provisional).toBe(false);
    });
  });

  describe("extractLots", () => {
    it("extracts all lots recursively", () => {
      const tree = makeTree();
      const lots = extractLots(tree);
      expect(lots.length).toBe(2);
    });

    it("identifies synthetic lots", () => {
      const tree = makeTree();
      const lots = extractLots(tree);
      const synthetic = lots.filter((l) => l.syntheticLot);
      expect(synthetic.length).toBe(1);
      expect(synthetic[0]!.lotCode).toBe("DEF456");
    });

    it("extracts lot metadata correctly", () => {
      const tree = makeTree();
      const lots = extractLots(tree);
      const lot1 = lots.find((l) => l.lotCode === "ABC123");
      expect(lot1?.gramsConsumed).toBe(200);
      expect(lot1?.sourceOrderRef).toBe("ORDER-001");
    });
  });

  describe("extractNutrientProvenance", () => {
    it("extracts nutrient provenance from payload", () => {
      const payload = makePayload();
      const provenance = extractNutrientProvenance(payload);
      expect(provenance.length).toBe(5);
      const kcal = provenance.find((p) => p.nutrientKey === "kcal");
      expect(kcal?.valuePerServing).toBe(520);
      expect(kcal?.verifiedPct).toBe(100);
    });

    it("returns empty for missing perServing", () => {
      expect(extractNutrientProvenance({})).toEqual([]);
    });

    it("filters out zero-value nutrients", () => {
      const payload = makePayload({ perServing: { kcal: 520, protein_g: 0 } });
      const provenance = extractNutrientProvenance(payload);
      expect(provenance.length).toBe(1);
    });
  });

  describe("generateQaWarnings", () => {
    it("returns no warnings for clean label", () => {
      const warnings = generateQaWarnings(makePayload());
      expect(warnings.length).toBe(0);
    });

    it("warns on provisional label", () => {
      const warnings = generateQaWarnings(makePayload({ provisional: true }));
      expect(warnings.some((w) => w.includes("PROVISIONAL"))).toBe(true);
    });

    it("warns on inferred nutrient values", () => {
      const payload = makePayload({
        evidenceSummary: { ...makePayload().evidenceSummary!, inferredCount: 3 },
      });
      const warnings = generateQaWarnings(payload);
      expect(warnings.some((w) => w.includes("inferred"))).toBe(true);
    });

    it("warns on plausibility failure", () => {
      const payload = makePayload({
        plausibility: {
          valid: false,
          errorCount: 1,
          warningCount: 0,
          issues: [{ message: "Kcal too high", severity: "ERROR" }],
        },
      });
      const warnings = generateQaWarnings(payload);
      expect(warnings.some((w) => w.includes("Plausibility"))).toBe(true);
    });

    it("warns on synthetic lots when tree provided", () => {
      const payload = makePayload({ reasonCodes: ["SYNTHETIC_LOT_USAGE"] });
      const tree = makeTree();
      const warnings = generateQaWarnings(payload, tree);
      expect(warnings.some((w) => w.includes("synthetic"))).toBe(true);
    });

    it("warns on unverified sources", () => {
      const payload = makePayload({
        evidenceSummary: { ...makePayload().evidenceSummary!, unverifiedCount: 5 },
      });
      const warnings = generateQaWarnings(payload);
      expect(warnings.some((w) => w.includes("unverified"))).toBe(true);
    });
  });

  describe("buildMealAuditTrace", () => {
    it("builds a complete audit trace", () => {
      const schedule = {
        id: "sched-1",
        clientName: "John",
        serviceDate: "2026-02-25",
        mealSlot: "lunch",
        servings: 1,
      };
      const trace = buildMealAuditTrace(schedule, makePayload(), makeTree());
      expect(trace.scheduleId).toBe("sched-1");
      expect(trace.clientName).toBe("John");
      expect(trace.skuName).toBe("Chicken Bowl");
      expect(trace.ingredients.length).toBe(2);
      expect(trace.lots.length).toBe(2);
      expect(trace.nutrientProvenance.length).toBeGreaterThan(0);
      expect(trace.evidenceSummary.verifiedPct).toBe(100);
    });

    it("includes QA warnings in trace", () => {
      const schedule = { id: "s1", clientName: "Jane", serviceDate: "2026-02-25", mealSlot: "dinner", servings: 1 };
      const payload = makePayload({ provisional: true });
      const trace = buildMealAuditTrace(schedule, payload, makeTree());
      expect(trace.provisional).toBe(true);
      expect(trace.qaWarnings.length).toBeGreaterThan(0);
    });
  });
});
