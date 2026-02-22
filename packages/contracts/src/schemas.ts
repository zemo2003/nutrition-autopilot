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

export type LabelSnapshotDTO = z.infer<typeof labelSnapshotSchema>;
export type LabelLineageNodeDTO = z.infer<typeof labelLineageNodeSchema>;
export type MealServiceEventDTO = z.infer<typeof mealServiceEventSchema>;
export type ImportResultDTO = z.infer<typeof importResultSchema>;
export type VerificationTaskDTO = z.infer<typeof verificationTaskSchema>;
