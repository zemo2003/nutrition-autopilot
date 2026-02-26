-- Sprint 3: Composition Templates + Menu Composer + Prep Optimizer

CREATE TYPE "MealSource" AS ENUM ('RECIPE', 'COMPOSITION');
CREATE TYPE "PrepDraftStatus" AS ENUM ('DRAFT', 'APPROVED', 'COMMITTED', 'CANCELLED');

-- Composition template: reusable meal compositions (protein + base + veg + sauce slots)
CREATE TABLE "CompositionTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "targetKcal" DOUBLE PRECISION,
    "targetProteinG" DOUBLE PRECISION,
    "targetCarbG" DOUBLE PRECISION,
    "targetFatG" DOUBLE PRECISION,
    "allergenTags" TEXT[],
    "flavorProfiles" "FlavorProfile"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CompositionTemplate_pkey" PRIMARY KEY ("id")
);

-- Composition slot: individual slot in a template
CREATE TABLE "CompositionSlot" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "slotType" "ComponentType" NOT NULL,
    "componentId" TEXT,
    "targetG" DOUBLE PRECISION NOT NULL,
    "portionG" DOUBLE PRECISION,
    "sauceVariantId" TEXT,
    "slotOrder" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompositionSlot_pkey" PRIMARY KEY ("id")
);

-- Weekly prep draft (demand rollup → batch suggestions)
CREATE TABLE "PrepDraft" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "status" "PrepDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "demandPayload" JSONB NOT NULL,
    "batchSuggestions" JSONB NOT NULL,
    "shortages" JSONB,
    "notes" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "PrepDraft_pkey" PRIMARY KEY ("id")
);

-- Add mealSource and compositionId to MealSchedule
ALTER TABLE "MealSchedule" ADD COLUMN "mealSource" "MealSource" NOT NULL DEFAULT 'RECIPE';
ALTER TABLE "MealSchedule" ADD COLUMN "compositionId" TEXT;
ALTER TABLE "MealSchedule" ALTER COLUMN "skuId" DROP NOT NULL;

-- Indexes
CREATE INDEX "CompositionTemplate_organizationId_idx" ON "CompositionTemplate"("organizationId");
CREATE UNIQUE INDEX "CompositionSlot_templateId_slotOrder_key" ON "CompositionSlot"("templateId", "slotOrder");
CREATE INDEX "CompositionSlot_templateId_idx" ON "CompositionSlot"("templateId");
CREATE INDEX "PrepDraft_organizationId_weekStart_idx" ON "PrepDraft"("organizationId", "weekStart");

-- Foreign keys
ALTER TABLE "CompositionTemplate" ADD CONSTRAINT "CompositionTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompositionSlot" ADD CONSTRAINT "CompositionSlot_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CompositionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompositionSlot" ADD CONSTRAINT "CompositionSlot_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PrepDraft" ADD CONSTRAINT "PrepDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MealSchedule" ADD CONSTRAINT "MealSchedule_compositionId_fkey" FOREIGN KEY ("compositionId") REFERENCES "CompositionTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
