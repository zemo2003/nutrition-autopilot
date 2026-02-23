-- CreateEnum: PreparedState
CREATE TYPE "PreparedState" AS ENUM ('RAW', 'COOKED', 'DRY', 'CANNED', 'FROZEN');

-- AlterTable: RecipeLine — add yield factor fields
ALTER TABLE "RecipeLine" ADD COLUMN "preparedState" "PreparedState" NOT NULL DEFAULT 'RAW';
ALTER TABLE "RecipeLine" ADD COLUMN "yieldFactor" DOUBLE PRECISION NOT NULL DEFAULT 1.0;

-- SR-2: Add CHECK constraint on ProductNutrientValue.valuePer100g
-- Prevents physically impossible nutrient values from being stored
ALTER TABLE "ProductNutrientValue" ADD CONSTRAINT "chk_valuePer100g_range"
  CHECK ("valuePer100g" IS NULL OR ("valuePer100g" >= 0 AND "valuePer100g" <= 10000));
