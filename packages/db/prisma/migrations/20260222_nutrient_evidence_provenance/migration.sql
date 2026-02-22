-- CreateEnum
CREATE TYPE "NutrientEvidenceGrade" AS ENUM (
  'MANUFACTURER_LABEL',
  'USDA_BRANDED',
  'USDA_GENERIC',
  'OPENFOODFACTS',
  'INFERRED_FROM_INGREDIENT',
  'INFERRED_FROM_SIMILAR_PRODUCT',
  'HISTORICAL_EXCEPTION'
);

-- AlterTable
ALTER TABLE "ProductNutrientValue"
  ADD COLUMN "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "evidenceGrade" "NutrientEvidenceGrade" NOT NULL DEFAULT 'HISTORICAL_EXCEPTION',
  ADD COLUMN "historicalException" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "retrievedAt" TIMESTAMP(3),
  ADD COLUMN "retrievalRunId" TEXT;

-- Backfill evidence metadata for existing rows without deleting any records.
UPDATE "ProductNutrientValue"
SET
  "evidenceGrade" = CASE
    WHEN "sourceRef" ILIKE '%openfoodfacts%' THEN 'OPENFOODFACTS'::"NutrientEvidenceGrade"
    WHEN "sourceRef" = 'agent:trace-floor-imputation' THEN 'HISTORICAL_EXCEPTION'::"NutrientEvidenceGrade"
    WHEN "sourceType" = 'MANUFACTURER' THEN 'MANUFACTURER_LABEL'::"NutrientEvidenceGrade"
    WHEN "sourceType" = 'USDA' THEN 'USDA_GENERIC'::"NutrientEvidenceGrade"
    WHEN "sourceType" = 'DERIVED' AND "sourceRef" LIKE 'fallback:%' THEN 'INFERRED_FROM_INGREDIENT'::"NutrientEvidenceGrade"
    WHEN "sourceType" = 'DERIVED' THEN 'INFERRED_FROM_SIMILAR_PRODUCT'::"NutrientEvidenceGrade"
    ELSE "evidenceGrade"
  END,
  "confidenceScore" = CASE
    WHEN "sourceRef" = 'agent:trace-floor-imputation' THEN 0.05
    WHEN "sourceType" = 'MANUAL' THEN 1.0
    WHEN "sourceType" = 'MANUFACTURER' THEN 0.9
    WHEN "sourceType" = 'USDA' THEN 0.8
    WHEN "sourceType" = 'DERIVED' AND "sourceRef" LIKE 'fallback:%' THEN 0.55
    WHEN "sourceType" = 'DERIVED' THEN 0.35
    ELSE "confidenceScore"
  END,
  "historicalException" = CASE
    WHEN "sourceRef" = 'agent:trace-floor-imputation' THEN true
    ELSE "historicalException"
  END
WHERE TRUE;
