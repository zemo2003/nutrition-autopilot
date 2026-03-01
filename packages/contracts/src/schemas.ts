import { z, type ZodType } from "zod";
import { nutrientKeys } from "./nutrients.js";

export const nutrientKeySchema = z.enum(nutrientKeys);

export const nutrientValueSchema = z.object({
  key: nutrientKeySchema,
  valuePer100g: z.number().nonnegative().nullable(),
  sourceType: z.enum(["MANUFACTURER", "USDA", "MANUAL", "DERIVED"]),
  sourceRef: z.string().min(1),
  confidenceScore: z.number().min(0),
  evidenceGrade: z.enum([
    "MANUFACTURER_LABEL",
    "USDA_BRANDED",
    "USDA_GENERIC",
    "OPENFOODFACTS",
    "INFERRED_FROM_INGREDIENT",
    "INFERRED_FROM_SIMILAR_PRODUCT",
    "HISTORICAL_EXCEPTION"
  ]),
  historicalException: z.boolean().default(false),
  retrievedAt: z.string().datetime().nullable().optional(),
  retrievalRunId: z.string().nullable().optional(),
  verificationStatus: z.enum(["VERIFIED", "NEEDS_REVIEW", "REJECTED"])
});

export const evidenceSummarySchema = z.object({
  verifiedCount: z.number().int().nonnegative(),
  inferredCount: z.number().int().nonnegative(),
  exceptionCount: z.number().int().nonnegative(),
  unverifiedCount: z.number().int().nonnegative().default(0),
  totalNutrientRows: z.number().int().nonnegative().default(0),
  provisional: z.boolean()
});

export const labelSnapshotSchema = z.object({
  id: z.string(),
  labelType: z.enum(["SKU", "INGREDIENT", "PRODUCT", "LOT"]),
  version: z.number().int().positive(),
  renderPayload: z.record(z.any()),
  provisional: z.boolean().default(false),
  evidenceSummary: evidenceSummarySchema.optional(),
  createdAt: z.string(),
  createdBy: z.string(),
  frozenAt: z.string().nullable()
});

type LabelLineageNode = {
  labelId: string;
  labelType: "SKU" | "INGREDIENT" | "PRODUCT" | "LOT";
  title: string;
  metadata?: Record<string, unknown>;
  children?: LabelLineageNode[];
};

export const labelLineageNodeSchema: ZodType<LabelLineageNode> = z.object({
  labelId: z.string(),
  labelType: z.enum(["SKU", "INGREDIENT", "PRODUCT", "LOT"]),
  title: z.string(),
  metadata: z.record(z.any()).default({}),
  children: z.array(z.lazy((): ZodType<LabelLineageNode> => labelLineageNodeSchema)).default([])
});

export const mealServiceEventSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  scheduleId: z.string(),
  servedAt: z.string(),
  servedBy: z.string(),
  scheduleStatusAtService: z.enum(["DONE"]),
  finalLabelSnapshotId: z.string().nullable()
});

export const importResultSchema = z.object({
  importJobId: z.string(),
  mode: z.enum(["dry-run", "commit"]),
  status: z.enum(["SUCCEEDED", "FAILED", "PARTIAL"]),
  createdCount: z.number().int().nonnegative(),
  updatedCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  errors: z.array(
    z.object({
      rowNumber: z.number().int().nonnegative().nullable(),
      sheet: z.string().nullable(),
      code: z.string(),
      message: z.string()
    })
  )
});

export const verificationTaskPayloadSchema = z.object({
  productId: z.string().optional(),
  nutrientKeys: z.array(nutrientKeySchema).default([]),
  proposedValues: z.record(z.number().nonnegative()).default({}),
  evidenceRefs: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional(),
  sourceType: z.string().optional(),
  historicalException: z.boolean().optional()
}).catchall(z.any());

export const verificationTaskSchema = z.object({
  id: z.string(),
  taskType: z.enum(["SOURCE_RETRIEVAL", "CONSISTENCY", "LINEAGE_INTEGRITY"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  status: z.enum(["OPEN", "APPROVED", "REJECTED", "RESOLVED"]),
  title: z.string(),
  description: z.string(),
  payload: verificationTaskPayloadSchema.default({})
});

// ============================================================================
// REQUEST BODY SCHEMAS (for API input validation)
// ============================================================================

export const createBatchBodySchema = z.object({
  componentId: z.string().min(1),
  rawInputG: z.number().positive().finite(),
  portionSizeG: z.number().positive().finite().optional(),
  plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
});

export const updateBatchStatusBodySchema = z.object({
  status: z.enum(["PLANNED", "IN_PREP", "COOKING", "CHILLING", "PORTIONED", "READY", "CANCELLED"]),
  actualYieldG: z.number().nonnegative().finite().optional(),
  lotOverrides: z.array(z.object({
    ingredientId: z.string().min(1),
    lotId: z.string().min(1),
  })).optional(),
});

export const inventoryAdjustBodySchema = z.object({
  lotId: z.string().min(1),
  deltaG: z.number().finite(),
  reason: z.string().min(1),
  notes: z.string().optional(),
});

export const updateVerificationTaskBodySchema = z.object({
  status: z.enum(["APPROVED", "REJECTED", "RESOLVED"]),
  decision: z.string().min(1),
  notes: z.string().optional(),
});

export const createScheduleItemSchema = z.object({
  skuCode: z.string().min(1),
  clientId: z.string().min(1),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  mealSlot: z.string().min(1),
  servings: z.number().int().positive().default(1),
  notes: z.string().optional(),
});

export const createScheduleBodySchema = z.object({
  items: z.array(createScheduleItemSchema).min(1),
});

export const updateScheduleStatusBodySchema = z.object({
  status: z.enum(["PLANNED", "DONE", "SKIPPED"]),
});

export const bulkScheduleStatusBodySchema = z.object({
  scheduleIds: z.array(z.string().uuid()).min(1).max(100),
  status: z.enum(["DONE", "SKIPPED"]),
});

export const updateClientBodySchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  heightCm: z.number().positive().finite().optional(),
  weightKg: z.number().positive().finite().optional(),
  goals: z.string().optional(),
  preferences: z.string().optional(),
  exclusions: z.array(z.string()).optional(),
  dateOfBirth: z.string().datetime().optional().nullable(),
  sex: z.enum(["male", "female"]).optional().nullable(),
  activityLevel: z.enum(["sedentary", "light", "moderate", "active", "very_active"]).optional().nullable(),
  targetKcal: z.number().positive().finite().optional().nullable(),
  targetProteinG: z.number().nonnegative().finite().optional().nullable(),
  targetCarbG: z.number().nonnegative().finite().optional().nullable(),
  targetFatG: z.number().nonnegative().finite().optional().nullable(),
  targetWeightKg: z.number().positive().finite().optional().nullable(),
  targetBodyFatPct: z.number().min(0).max(100).optional().nullable(),
  deliveryAddress: z.string().optional().nullable(),
  deliveryNotes: z.string().optional().nullable(),
  deliveryZone: z.string().optional().nullable(),
});

export const createBodyCompositionBodySchema = z.object({
  date: z.string().min(1),
  bodyFatPct: z.number().min(0).max(100).optional(),
  leanMassKg: z.number().nonnegative().optional(),
  source: z.string().min(1),
});

export const createCheckpointBodySchema = z.object({
  checkpointType: z.enum(["PREP_START", "COOK_START", "TEMP_CHECK", "COOK_END", "CHILL_START", "CHILL_TEMP_CHECK", "CHILL_END", "PORTION_START", "PORTION_END", "READY_CHECK"]),
  tempC: z.number().finite().optional(),
  notes: z.string().optional(),
  timerDurationM: z.number().positive().finite().optional(),
});

export const createSauceVariantBodySchema = z.object({
  variantType: z.enum(["STANDARD", "LOW_FAT", "HIGH_FAT"]),
  kcalPer100g: z.number().nonnegative().finite().optional(),
  proteinPer100g: z.number().nonnegative().finite().optional(),
  carbPer100g: z.number().nonnegative().finite().optional(),
  fatPer100g: z.number().nonnegative().finite().optional(),
  fiberPer100g: z.number().nonnegative().finite().optional(),
  sodiumPer100g: z.number().nonnegative().finite().optional(),
});

export const createSaucePairingBodySchema = z.object({
  pairedComponentType: z.enum(["PROTEIN", "CARB_BASE", "VEGETABLE", "SAUCE", "CONDIMENT", "OTHER"]),
  recommended: z.boolean().default(false),
  defaultPortionG: z.number().positive().finite().optional(),
  notes: z.string().optional(),
});

export const parLevelUpdateSchema = z.object({
  ingredientId: z.string().min(1),
  parLevelG: z.number().nonnegative().finite().nullable().optional(),
  reorderPointG: z.number().nonnegative().finite().nullable().optional(),
});

export const updateParLevelsBodySchema = z.object({
  updates: z.array(parLevelUpdateSchema).min(1),
});

export const createYieldCalibrationBodySchema = z.object({
  componentId: z.string().min(1),
  method: z.string().optional(),
  cutForm: z.string().optional(),
  expectedYieldPct: z.number().positive().finite(),
  actualYieldPct: z.number().positive().finite(),
  batchProductionId: z.string().optional(),
});

export const reviewYieldCalibrationBodySchema = z.object({
  status: z.enum(["ACCEPTED", "REJECTED"]),
  reviewNotes: z.string().optional(),
});

export const createQcIssueBodySchema = z.object({
  batchProductionId: z.string().min(1),
  issueType: z.string().min(1),
  description: z.string().min(1),
  expectedValue: z.string().optional(),
  actualValue: z.string().optional(),
});

export const overrideQcIssueBodySchema = z.object({
  overrideReason: z.string().min(1),
});

export const createBiometricBodySchema = z.object({
  measuredAt: z.string().min(1),
  heightCm: z.number().positive().finite().nullable().optional(),
  weightKg: z.number().positive().finite().nullable().optional(),
  bodyFatPct: z.number().min(0).max(100).nullable().optional(),
  leanMassKg: z.number().nonnegative().finite().nullable().optional(),
  restingHr: z.number().positive().int().nullable().optional(),
  notes: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
});

export const createMetricBodySchema = z.object({
  metricKey: z.string().min(1),
  value: z.number().finite(),
  unit: z.string().min(1),
  observedAt: z.string().min(1),
  sourceDocumentId: z.string().optional(),
  verification: z.enum(["UNVERIFIED", "SELF_REPORTED", "PROVIDER_VERIFIED"]).optional(),
  notes: z.string().optional(),
});

// ============================================================================
// DELIVERY MODE
// ============================================================================

export const generateFulfillmentBodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
});

export const updateFulfillmentStatusBodySchema = z.object({
  status: z.enum(["PENDING", "PACKING", "PACKED", "DISPATCHED", "DELIVERED", "FAILED"]),
  failureReason: z.string().min(1).optional(),
});

export const createRouteBodySchema = z.object({
  routeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  name: z.string().min(1),
  driverName: z.string().optional(),
  notes: z.string().optional(),
});

export const updateRouteBodySchema = z.object({
  name: z.string().min(1).optional(),
  driverName: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const addRouteStopsBodySchema = z.object({
  stops: z.array(z.object({
    fulfillmentOrderId: z.string().min(1),
    stopOrder: z.number().int().positive(),
  })).min(1),
});

export const reorderRouteStopsBodySchema = z.object({
  stopIds: z.array(z.string().min(1)).min(1),
});

// ============================================================================
// SCHEDULE-AWARE BATCH PREP
// ============================================================================

export const scheduleAwarePrepDraftBodySchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scheduleAware: z.boolean().optional(),
});

export const createBatchFromScheduleBodySchema = z.object({
  componentId: z.string().min(1),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  portionSizeG: z.number().positive().optional(),
});

export const updateBatchPortionBodySchema = z.object({
  sealed: z.boolean(),
});

// ============================================================================
// CHATGPT MEAL PLAN PUSH
// ============================================================================

const mealSlotEnum = z.enum([
  "breakfast", "lunch", "dinner", "snack",
  "pre_training", "post_training", "pre_bed",
  "BREAKFAST", "LUNCH", "DINNER", "SNACK",
  "PRE_TRAINING", "POST_TRAINING", "PRE_BED",
]);

const ingredientLineSchema = z.object({
  name: z.string().min(1),
  grams: z.number().positive(),
  preparedState: z.enum(["RAW", "COOKED", "DRY", "CANNED", "FROZEN"]).optional().default("RAW"),
  category: z.string().optional().default("general"),
});

export const mealPlanPushBodySchema = z.object({
  meals: z.array(z.object({
    clientName: z.string().min(1),
    mealName: z.string().min(1),
    serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    mealSlot: mealSlotEnum,
    servings: z.number().positive().optional().default(1),
    notes: z.string().optional(),
    ingredients: z.array(ingredientLineSchema).optional(),
  })).min(1).max(200),
});

// ============================================================================
// DTO TYPES
// ============================================================================

export type LabelSnapshotDTO = z.infer<typeof labelSnapshotSchema>;
export type LabelLineageNodeDTO = z.infer<typeof labelLineageNodeSchema>;
export type MealServiceEventDTO = z.infer<typeof mealServiceEventSchema>;
export type ImportResultDTO = z.infer<typeof importResultSchema>;
export type VerificationTaskDTO = z.infer<typeof verificationTaskSchema>;
