-- Sprint 1B: Instacart Mapping Memory + Substitution Engine

-- New enums
CREATE TYPE "MappingResolutionSource" AS ENUM ('AUTO_EXACT_UPC', 'AUTO_HIGH_CONFIDENCE', 'MANUAL_APPROVED_SUGGESTION', 'MANUAL_SEARCH_SELECT', 'MANUAL_CREATE_NEW', 'MANUAL_PANTRY_NON_TRACKED', 'HISTORICAL_LEARNED');
CREATE TYPE "SubstitutionStatus" AS ENUM ('PROPOSED', 'APPROVED', 'APPLIED', 'REJECTED', 'EXPIRED');

-- InstacartMapping: learned mapping memory
CREATE TABLE "InstacartMapping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceProductName" TEXT NOT NULL,
    "sourceBrand" TEXT,
    "sourceUpc" TEXT,
    "ingredientId" TEXT NOT NULL,
    "productId" TEXT,
    "resolutionSource" "MappingResolutionSource" NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scoreFactors" JSONB,
    "timesUsed" INTEGER NOT NULL DEFAULT 1,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "InstacartMapping_pkey" PRIMARY KEY ("id")
);

-- SubstitutionRecord: substitution audit trail
CREATE TABLE "SubstitutionRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mealScheduleId" TEXT,
    "batchProductionId" TEXT,
    "originalIngredientId" TEXT NOT NULL,
    "substituteIngredientId" TEXT NOT NULL,
    "originalProductId" TEXT,
    "substituteProductId" TEXT,
    "reason" TEXT NOT NULL,
    "status" "SubstitutionStatus" NOT NULL DEFAULT 'PROPOSED',
    "nutrientDelta" JSONB,
    "rankScore" DOUBLE PRECISION,
    "rankFactors" JSONB,
    "appliedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SubstitutionRecord_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "InstacartMapping_organizationId_sourceProductName_sourceBrand_key" ON "InstacartMapping"("organizationId", "sourceProductName", "sourceBrand");
CREATE INDEX "InstacartMapping_organizationId_sourceUpc_idx" ON "InstacartMapping"("organizationId", "sourceUpc");
CREATE INDEX "InstacartMapping_organizationId_ingredientId_idx" ON "InstacartMapping"("organizationId", "ingredientId");
CREATE INDEX "SubstitutionRecord_organizationId_status_idx" ON "SubstitutionRecord"("organizationId", "status");
CREATE INDEX "SubstitutionRecord_organizationId_mealScheduleId_idx" ON "SubstitutionRecord"("organizationId", "mealScheduleId");

-- Foreign keys
ALTER TABLE "InstacartMapping" ADD CONSTRAINT "InstacartMapping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InstacartMapping" ADD CONSTRAINT "InstacartMapping_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "IngredientCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InstacartMapping" ADD CONSTRAINT "InstacartMapping_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ProductCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SubstitutionRecord" ADD CONSTRAINT "SubstitutionRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubstitutionRecord" ADD CONSTRAINT "SubstitutionRecord_originalIngredientId_fkey" FOREIGN KEY ("originalIngredientId") REFERENCES "IngredientCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubstitutionRecord" ADD CONSTRAINT "SubstitutionRecord_substituteIngredientId_fkey" FOREIGN KEY ("substituteIngredientId") REFERENCES "IngredientCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
