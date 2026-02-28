import { describe, expect, it } from "vitest";
import {
  nutrientKeySchema,
  nutrientValueSchema,
  evidenceSummarySchema,
  labelSnapshotSchema,
  labelLineageNodeSchema,
  mealServiceEventSchema,
  importResultSchema,
  verificationTaskSchema,
  verificationTaskPayloadSchema,
  createBatchBodySchema,
  updateBatchStatusBodySchema,
  inventoryAdjustBodySchema,
  updateVerificationTaskBodySchema,
  createScheduleBodySchema,
  updateScheduleStatusBodySchema,
  bulkScheduleStatusBodySchema,
  updateClientBodySchema,
  createBodyCompositionBodySchema,
  createCheckpointBodySchema,
  createSauceVariantBodySchema,
  createSaucePairingBodySchema,
  updateParLevelsBodySchema,
  createYieldCalibrationBodySchema,
  reviewYieldCalibrationBodySchema,
  createQcIssueBodySchema,
  overrideQcIssueBodySchema,
  createBiometricBodySchema,
  createMetricBodySchema,
} from "./schemas.js";

describe("nutrientKeySchema", () => {
  it("accepts canonical keys", () => {
    expect(nutrientKeySchema.parse("kcal")).toBe("kcal");
    expect(nutrientKeySchema.parse("omega6_g")).toBe("omega6_g");
  });

  it("rejects unknown keys", () => {
    expect(() => nutrientKeySchema.parse("foo")).toThrow();
  });
});

// ============================================================================
// DTO schemas
// ============================================================================

describe("nutrientValueSchema", () => {
  const valid = {
    key: "kcal",
    valuePer100g: 250,
    sourceType: "USDA",
    sourceRef: "usda-12345",
    confidenceScore: 0.95,
    evidenceGrade: "USDA_BRANDED",
    historicalException: false,
    verificationStatus: "VERIFIED",
  };

  it("accepts valid nutrient value", () => {
    expect(() => nutrientValueSchema.parse(valid)).not.toThrow();
  });

  it("rejects negative valuePer100g", () => {
    expect(() => nutrientValueSchema.parse({ ...valid, valuePer100g: -1 })).toThrow();
  });

  it("accepts null valuePer100g", () => {
    expect(() => nutrientValueSchema.parse({ ...valid, valuePer100g: null })).not.toThrow();
  });

  it("rejects unknown sourceType", () => {
    expect(() => nutrientValueSchema.parse({ ...valid, sourceType: "UNKNOWN" })).toThrow();
  });

  it("rejects unknown evidenceGrade", () => {
    expect(() => nutrientValueSchema.parse({ ...valid, evidenceGrade: "WIKIPEDIA" })).toThrow();
  });

  it("rejects unknown verificationStatus", () => {
    expect(() => nutrientValueSchema.parse({ ...valid, verificationStatus: "PENDING" })).toThrow();
  });
});

describe("evidenceSummarySchema", () => {
  it("accepts valid summary", () => {
    const result = evidenceSummarySchema.parse({
      verifiedCount: 30,
      inferredCount: 5,
      exceptionCount: 2,
      provisional: false,
    });
    expect(result.unverifiedCount).toBe(0);
    expect(result.totalNutrientRows).toBe(0);
  });

  it("rejects negative counts", () => {
    expect(() =>
      evidenceSummarySchema.parse({
        verifiedCount: -1,
        inferredCount: 0,
        exceptionCount: 0,
        provisional: false,
      })
    ).toThrow();
  });
});

describe("labelSnapshotSchema", () => {
  it("accepts valid label snapshot", () => {
    const result = labelSnapshotSchema.parse({
      id: "ls-1",
      labelType: "SKU",
      version: 1,
      renderPayload: { servingSize: "170g" },
      createdAt: "2026-01-01T00:00:00Z",
      createdBy: "system",
      frozenAt: null,
    });
    expect(result.provisional).toBe(false);
    expect(result.evidenceSummary).toBeUndefined();
  });

  it("rejects unknown labelType", () => {
    expect(() =>
      labelSnapshotSchema.parse({
        id: "ls-1",
        labelType: "CUSTOM",
        version: 1,
        renderPayload: {},
        createdAt: "2026-01-01",
        createdBy: "system",
        frozenAt: null,
      })
    ).toThrow();
  });

  it("rejects version <= 0", () => {
    expect(() =>
      labelSnapshotSchema.parse({
        id: "ls-1",
        labelType: "SKU",
        version: 0,
        renderPayload: {},
        createdAt: "2026-01-01",
        createdBy: "system",
        frozenAt: null,
      })
    ).toThrow();
  });
});

describe("labelLineageNodeSchema", () => {
  it("accepts a tree structure", () => {
    const result = labelLineageNodeSchema.parse({
      labelId: "root",
      labelType: "SKU",
      title: "Chicken Bowl",
      children: [
        { labelId: "child-1", labelType: "INGREDIENT", title: "Chicken Breast" },
        { labelId: "child-2", labelType: "INGREDIENT", title: "Rice" },
      ],
    });
    expect(result.children).toHaveLength(2);
  });

  it("accepts deeply nested tree", () => {
    const result = labelLineageNodeSchema.parse({
      labelId: "root",
      labelType: "PRODUCT",
      title: "Product",
      children: [{
        labelId: "lot-1",
        labelType: "LOT",
        title: "Lot 1",
        children: [{
          labelId: "ing-1",
          labelType: "INGREDIENT",
          title: "Ingredient 1",
        }],
      }],
    });
    expect(result.children![0]!.children).toHaveLength(1);
  });
});

describe("verificationTaskSchema", () => {
  it("accepts valid task", () => {
    const result = verificationTaskSchema.parse({
      id: "vt-1",
      taskType: "SOURCE_RETRIEVAL",
      severity: "HIGH",
      status: "OPEN",
      title: "Missing USDA data",
      description: "Product lacks verified source",
    });
    expect(result.payload).toEqual({
      nutrientKeys: [],
      proposedValues: {},
      evidenceRefs: [],
    });
  });

  it("accepts task with full payload", () => {
    verificationTaskSchema.parse({
      id: "vt-1",
      taskType: "CONSISTENCY",
      severity: "CRITICAL",
      status: "OPEN",
      title: "Calorie mismatch",
      description: "Reported != calculated",
      payload: {
        productId: "p-1",
        nutrientKeys: ["kcal", "protein_g"],
        proposedValues: { kcal: 250 },
        evidenceRefs: ["usda-123"],
        confidence: 0.85,
        sourceType: "USDA",
        historicalException: true,
      },
    });
  });

  it("rejects unknown status", () => {
    expect(() =>
      verificationTaskSchema.parse({
        id: "vt-1",
        taskType: "SOURCE_RETRIEVAL",
        severity: "LOW",
        status: "PENDING",
        title: "test",
        description: "test",
      })
    ).toThrow();
  });
});

// ============================================================================
// Request body schemas
// ============================================================================

describe("createBatchBodySchema", () => {
  it("accepts valid batch", () => {
    createBatchBodySchema.parse({
      componentId: "comp-1",
      rawInputG: 2000,
      plannedDate: "2026-03-01",
    });
  });

  it("accepts with optional portionSizeG", () => {
    createBatchBodySchema.parse({
      componentId: "comp-1",
      rawInputG: 500,
      portionSizeG: 170,
      plannedDate: "2026-03-01",
    });
  });

  it("rejects empty componentId", () => {
    expect(() =>
      createBatchBodySchema.parse({ componentId: "", rawInputG: 100, plannedDate: "2026-03-01" })
    ).toThrow();
  });

  it("rejects zero rawInputG", () => {
    expect(() =>
      createBatchBodySchema.parse({ componentId: "c", rawInputG: 0, plannedDate: "2026-03-01" })
    ).toThrow();
  });

  it("rejects negative rawInputG", () => {
    expect(() =>
      createBatchBodySchema.parse({ componentId: "c", rawInputG: -100, plannedDate: "2026-03-01" })
    ).toThrow();
  });

  it("rejects Infinity", () => {
    expect(() =>
      createBatchBodySchema.parse({ componentId: "c", rawInputG: Infinity, plannedDate: "2026-03-01" })
    ).toThrow();
  });

  it("rejects bad date format", () => {
    expect(() =>
      createBatchBodySchema.parse({ componentId: "c", rawInputG: 100, plannedDate: "March 1" })
    ).toThrow();
  });
});

describe("updateBatchStatusBodySchema", () => {
  it("accepts valid statuses", () => {
    for (const status of ["PLANNED", "IN_PREP", "COOKING", "CHILLING", "PORTIONED", "READY", "CANCELLED"]) {
      expect(() => updateBatchStatusBodySchema.parse({ status })).not.toThrow();
    }
  });

  it("rejects unknown status", () => {
    expect(() => updateBatchStatusBodySchema.parse({ status: "DELETED" })).toThrow();
  });

  it("rejects old Zod-only statuses that do not exist in DB", () => {
    for (const invalid of ["COOLING", "PORTIONING", "SERVED"]) {
      expect(() => updateBatchStatusBodySchema.parse({ status: invalid })).toThrow();
    }
  });
});

describe("inventoryAdjustBodySchema", () => {
  it("accepts positive delta (restock)", () => {
    inventoryAdjustBodySchema.parse({ lotId: "lot-1", deltaG: 500, reason: "Restock" });
  });

  it("accepts negative delta (consumption)", () => {
    inventoryAdjustBodySchema.parse({ lotId: "lot-1", deltaG: -200, reason: "Used in prep" });
  });

  it("rejects empty lotId", () => {
    expect(() => inventoryAdjustBodySchema.parse({ lotId: "", deltaG: 100, reason: "test" })).toThrow();
  });

  it("rejects empty reason", () => {
    expect(() => inventoryAdjustBodySchema.parse({ lotId: "lot-1", deltaG: 100, reason: "" })).toThrow();
  });

  it("rejects Infinity delta", () => {
    expect(() => inventoryAdjustBodySchema.parse({ lotId: "lot-1", deltaG: Infinity, reason: "test" })).toThrow();
  });
});

describe("createScheduleBodySchema", () => {
  it("accepts valid schedule with items", () => {
    createScheduleBodySchema.parse({
      items: [{
        skuCode: "CHICKEN-BOWL",
        clientId: "client-1",
        serviceDate: "2026-03-01",
        mealSlot: "LUNCH",
      }],
    });
  });

  it("rejects empty items array", () => {
    expect(() => createScheduleBodySchema.parse({ items: [] })).toThrow();
  });

  it("applies default servings=1", () => {
    const result = createScheduleBodySchema.parse({
      items: [{
        skuCode: "BOWL",
        clientId: "c-1",
        serviceDate: "2026-03-01",
        mealSlot: "DINNER",
      }],
    });
    expect(result.items[0]!.servings).toBe(1);
  });
});

describe("createBiometricBodySchema", () => {
  it("accepts full biometric record", () => {
    createBiometricBodySchema.parse({
      measuredAt: "2026-03-01T10:00:00Z",
      heightCm: 175,
      weightKg: 80,
      bodyFatPct: 15,
      leanMassKg: 68,
      restingHr: 60,
      notes: "Morning measurement",
      source: "DEXA scan",
    });
  });

  it("accepts minimal biometric", () => {
    createBiometricBodySchema.parse({ measuredAt: "2026-03-01T10:00:00Z" });
  });

  it("rejects bodyFatPct > 100", () => {
    expect(() =>
      createBiometricBodySchema.parse({ measuredAt: "2026-03-01", bodyFatPct: 101 })
    ).toThrow();
  });

  it("rejects non-integer restingHr", () => {
    expect(() =>
      createBiometricBodySchema.parse({ measuredAt: "2026-03-01", restingHr: 60.5 })
    ).toThrow();
  });
});

describe("createMetricBodySchema", () => {
  it("accepts valid metric", () => {
    createMetricBodySchema.parse({
      metricKey: "glucose",
      value: 95,
      unit: "mg/dL",
      observedAt: "2026-03-01T08:00:00Z",
    });
  });

  it("accepts optional verification level", () => {
    const result = createMetricBodySchema.parse({
      metricKey: "ldl_cholesterol",
      value: 120,
      unit: "mg/dL",
      observedAt: "2026-03-01",
      verification: "PROVIDER_VERIFIED",
    });
    expect(result.verification).toBe("PROVIDER_VERIFIED");
  });

  it("rejects unknown verification", () => {
    expect(() =>
      createMetricBodySchema.parse({
        metricKey: "test",
        value: 1,
        unit: "mg",
        observedAt: "2026-03-01",
        verification: "TRUST_ME_BRO",
      })
    ).toThrow();
  });
});

describe("createYieldCalibrationBodySchema", () => {
  it("accepts valid calibration", () => {
    createYieldCalibrationBodySchema.parse({
      componentId: "comp-1",
      expectedYieldPct: 80,
      actualYieldPct: 75,
    });
  });

  it("rejects zero expectedYieldPct", () => {
    expect(() =>
      createYieldCalibrationBodySchema.parse({
        componentId: "comp-1",
        expectedYieldPct: 0,
        actualYieldPct: 75,
      })
    ).toThrow();
  });
});

describe("createQcIssueBodySchema", () => {
  it("accepts valid QC issue", () => {
    createQcIssueBodySchema.parse({
      batchProductionId: "batch-1",
      issueType: "TEMP_OUT_OF_RANGE",
      description: "Temperature below safe threshold",
      expectedValue: "165°F",
      actualValue: "140°F",
    });
  });

  it("rejects empty description", () => {
    expect(() =>
      createQcIssueBodySchema.parse({
        batchProductionId: "batch-1",
        issueType: "TEMP",
        description: "",
      })
    ).toThrow();
  });
});

describe("updateClientBodySchema", () => {
  it("accepts partial updates", () => {
    updateClientBodySchema.parse({ email: "test@example.com" });
    updateClientBodySchema.parse({ weightKg: 80 });
    updateClientBodySchema.parse({ exclusions: ["dairy", "gluten"] });
  });

  it("accepts empty object (no updates)", () => {
    expect(() => updateClientBodySchema.parse({})).not.toThrow();
  });

  it("rejects invalid email", () => {
    expect(() => updateClientBodySchema.parse({ email: "not-an-email" })).toThrow();
  });

  it("rejects negative weight", () => {
    expect(() => updateClientBodySchema.parse({ weightKg: -10 })).toThrow();
  });
});

describe("createSauceVariantBodySchema", () => {
  it("accepts valid variant", () => {
    createSauceVariantBodySchema.parse({ variantType: "STANDARD" });
  });

  it("accepts with nutrient overrides", () => {
    createSauceVariantBodySchema.parse({
      variantType: "LOW_FAT",
      kcalPer100g: 45,
      proteinPer100g: 1,
      carbPer100g: 8,
      fatPer100g: 0.5,
    });
  });

  it("rejects unknown variant type", () => {
    expect(() => createSauceVariantBodySchema.parse({ variantType: "ULTRA_SPICY" })).toThrow();
  });

  it("rejects negative nutrient values", () => {
    expect(() =>
      createSauceVariantBodySchema.parse({ variantType: "STANDARD", kcalPer100g: -10 })
    ).toThrow();
  });
});

describe("createSaucePairingBodySchema", () => {
  it("accepts valid pairing", () => {
    const result = createSaucePairingBodySchema.parse({
      pairedComponentType: "PROTEIN",
    });
    expect(result.recommended).toBe(false);
  });

  it("rejects unknown component type", () => {
    expect(() =>
      createSaucePairingBodySchema.parse({ pairedComponentType: "DESSERT" })
    ).toThrow();
  });
});

describe("createCheckpointBodySchema", () => {
  it("accepts valid checkpoint types matching DB enum", () => {
    for (const checkpointType of [
      "PREP_START", "COOK_START", "TEMP_CHECK", "COOK_END",
      "CHILL_START", "CHILL_TEMP_CHECK", "CHILL_END",
      "PORTION_START", "PORTION_END", "READY_CHECK",
    ]) {
      expect(() => createCheckpointBodySchema.parse({ checkpointType })).not.toThrow();
    }
  });

  it("accepts checkpoint with optional fields", () => {
    const result = createCheckpointBodySchema.parse({
      checkpointType: "TEMP_CHECK",
      tempC: 74.5,
      notes: "Internal temp reached target",
    });
    expect(result.checkpointType).toBe("TEMP_CHECK");
    expect(result.tempC).toBe(74.5);
  });

  it("rejects old Zod-only checkpoint types that do not exist in DB", () => {
    for (const invalid of ["WEIGHT_CHECK", "TIMER", "QUALITY_CHECK", "PHOTO", "NOTE"]) {
      expect(() => createCheckpointBodySchema.parse({ checkpointType: invalid })).toThrow();
    }
  });

  it("rejects unknown checkpoint type", () => {
    expect(() => createCheckpointBodySchema.parse({ checkpointType: "RANDOM" })).toThrow();
  });
});

describe("importResultSchema", () => {
  it("validates import result shape", () => {
    const result = importResultSchema.parse({
      importJobId: "job-1",
      mode: "dry-run",
      status: "SUCCEEDED",
      createdCount: 10,
      updatedCount: 3,
      errorCount: 0,
      errors: [],
    });
    expect(result.createdCount).toBe(10);
  });

  it("validates error entries", () => {
    importResultSchema.parse({
      importJobId: "job-2",
      mode: "commit",
      status: "PARTIAL",
      createdCount: 5,
      updatedCount: 0,
      errorCount: 2,
      errors: [
        { rowNumber: 3, sheet: "Products", code: "MISSING_UPC", message: "UPC is required" },
        { rowNumber: null, sheet: null, code: "GENERAL", message: "Unknown error" },
      ],
    });
  });
});

describe("overrideQcIssueBodySchema", () => {
  it("accepts valid override", () => {
    overrideQcIssueBodySchema.parse({ overrideReason: "Chef approved variance" });
  });

  it("rejects empty reason", () => {
    expect(() => overrideQcIssueBodySchema.parse({ overrideReason: "" })).toThrow();
  });
});

describe("reviewYieldCalibrationBodySchema", () => {
  it("accepts ACCEPTED", () => {
    reviewYieldCalibrationBodySchema.parse({ status: "ACCEPTED" });
  });

  it("accepts REJECTED with notes", () => {
    reviewYieldCalibrationBodySchema.parse({ status: "REJECTED", reviewNotes: "Bad data" });
  });

  it("rejects unknown status", () => {
    expect(() => reviewYieldCalibrationBodySchema.parse({ status: "PENDING" })).toThrow();
  });
});

describe("updateParLevelsBodySchema", () => {
  it("accepts valid par level updates", () => {
    updateParLevelsBodySchema.parse({
      updates: [
        { ingredientId: "ing-1", parLevelG: 5000, reorderPointG: 1000 },
        { ingredientId: "ing-2", parLevelG: null },
      ],
    });
  });

  it("rejects empty updates", () => {
    expect(() => updateParLevelsBodySchema.parse({ updates: [] })).toThrow();
  });
});

// ============================================================================
// bulkScheduleStatusBodySchema
// ============================================================================

describe("bulkScheduleStatusBodySchema", () => {
  it("accepts valid bulk status update", () => {
    const data = bulkScheduleStatusBodySchema.parse({
      scheduleIds: ["550e8400-e29b-41d4-a716-446655440000"],
      status: "DONE",
    });
    expect(data.scheduleIds).toHaveLength(1);
    expect(data.status).toBe("DONE");
  });

  it("accepts SKIPPED status", () => {
    bulkScheduleStatusBodySchema.parse({
      scheduleIds: ["550e8400-e29b-41d4-a716-446655440000"],
      status: "SKIPPED",
    });
  });

  it("rejects empty scheduleIds array", () => {
    expect(() =>
      bulkScheduleStatusBodySchema.parse({ scheduleIds: [], status: "DONE" })
    ).toThrow();
  });

  it("rejects non-uuid scheduleIds", () => {
    expect(() =>
      bulkScheduleStatusBodySchema.parse({ scheduleIds: ["not-a-uuid"], status: "DONE" })
    ).toThrow();
  });

  it("rejects PLANNED status (only DONE/SKIPPED allowed)", () => {
    expect(() =>
      bulkScheduleStatusBodySchema.parse({
        scheduleIds: ["550e8400-e29b-41d4-a716-446655440000"],
        status: "PLANNED",
      })
    ).toThrow();
  });

  it("rejects more than 100 IDs", () => {
    const ids = Array.from({ length: 101 }, (_, i) =>
      `550e8400-e29b-41d4-a716-${String(i).padStart(12, "0")}`
    );
    expect(() =>
      bulkScheduleStatusBodySchema.parse({ scheduleIds: ids, status: "DONE" })
    ).toThrow();
  });
});
