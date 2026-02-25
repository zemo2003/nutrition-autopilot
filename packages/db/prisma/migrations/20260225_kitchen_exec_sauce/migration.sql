-- CreateEnum
CREATE TYPE "SauceVariantType" AS ENUM ('STANDARD', 'LOW_FAT', 'HIGH_FAT');

-- CreateEnum
CREATE TYPE "BatchCheckpointType" AS ENUM ('PREP_START', 'COOK_START', 'TEMP_CHECK', 'COOK_END', 'CHILL_START', 'CHILL_TEMP_CHECK', 'CHILL_END', 'PORTION_START', 'PORTION_END', 'READY_CHECK');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FlavorProfile" ADD VALUE 'CITRUS';
ALTER TYPE "FlavorProfile" ADD VALUE 'MEDITERRANEAN';
ALTER TYPE "FlavorProfile" ADD VALUE 'JAPANESE';
ALTER TYPE "FlavorProfile" ADD VALUE 'KOREAN';

-- CreateTable
CREATE TABLE "SauceVariant" (
    "id" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "variantType" "SauceVariantType" NOT NULL DEFAULT 'STANDARD',
    "kcalPer100g" DOUBLE PRECISION,
    "proteinPer100g" DOUBLE PRECISION,
    "carbPer100g" DOUBLE PRECISION,
    "fatPer100g" DOUBLE PRECISION,
    "fiberPer100g" DOUBLE PRECISION,
    "sodiumPer100g" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SauceVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaucePairing" (
    "id" TEXT NOT NULL,
    "sauceComponentId" TEXT NOT NULL,
    "pairedComponentType" "ComponentType" NOT NULL,
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "defaultPortionG" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SaucePairing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchCheckpoint" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "checkpointType" "BatchCheckpointType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tempC" DOUBLE PRECISION,
    "notes" TEXT,
    "timerDurationM" INTEGER,
    "timerStartedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "BatchCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SauceVariant_componentId_idx" ON "SauceVariant"("componentId");

-- CreateIndex
CREATE UNIQUE INDEX "SauceVariant_componentId_variantType_key" ON "SauceVariant"("componentId", "variantType");

-- CreateIndex
CREATE INDEX "SaucePairing_sauceComponentId_idx" ON "SaucePairing"("sauceComponentId");

-- CreateIndex
CREATE UNIQUE INDEX "SaucePairing_sauceComponentId_pairedComponentType_key" ON "SaucePairing"("sauceComponentId", "pairedComponentType");

-- CreateIndex
CREATE INDEX "BatchCheckpoint_batchId_occurredAt_idx" ON "BatchCheckpoint"("batchId", "occurredAt");

-- AddForeignKey
ALTER TABLE "SauceVariant" ADD CONSTRAINT "SauceVariant_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaucePairing" ADD CONSTRAINT "SaucePairing_sauceComponentId_fkey" FOREIGN KEY ("sauceComponentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchCheckpoint" ADD CONSTRAINT "BatchCheckpoint_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BatchProduction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

