-- CreateEnum
CREATE TYPE "ComponentType" AS ENUM ('PROTEIN', 'CARB_BASE', 'VEGETABLE', 'SAUCE', 'CONDIMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('PLANNED', 'IN_PREP', 'COOKING', 'CHILLING', 'PORTIONED', 'READY', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InventoryAdjustmentReason" AS ENUM ('WASTE', 'SPOILAGE', 'CORRECTION', 'TRANSFER', 'BATCH_CONSUMPTION', 'BATCH_OUTPUT', 'MANUAL');

-- CreateEnum
CREATE TYPE "StorageLocation" AS ENUM ('FRIDGE', 'FREEZER', 'PANTRY', 'COUNTER');

-- CreateEnum
CREATE TYPE "FlavorProfile" AS ENUM ('SAVORY', 'SWEET', 'SPICY', 'ACIDIC', 'UMAMI', 'NEUTRAL', 'HERBAL', 'SMOKY');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "bodyCompositionSnapshots" JSONB,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "exclusions" TEXT[],
ADD COLUMN     "fileRecords" JSONB,
ADD COLUMN     "goals" TEXT,
ADD COLUMN     "heightCm" DOUBLE PRECISION,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "preferences" TEXT,
ADD COLUMN     "weightKg" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "InventoryLot" ADD COLUMN     "batchProductionId" TEXT,
ADD COLUMN     "storageLocation" "StorageLocation" NOT NULL DEFAULT 'FRIDGE';

-- CreateTable
CREATE TABLE "Component" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "componentType" "ComponentType" NOT NULL,
    "description" TEXT,
    "defaultYieldFactor" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "shelfLifeHours" INTEGER,
    "storageLocation" "StorageLocation" NOT NULL DEFAULT 'FRIDGE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "allergenTags" TEXT[],
    "flavorProfiles" "FlavorProfile"[],
    "portionIncrementG" DOUBLE PRECISION,
    "macroVariant" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComponentLine" (
    "id" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "lineOrder" INTEGER NOT NULL,
    "targetGPer100g" DOUBLE PRECISION NOT NULL,
    "preparation" TEXT,
    "preparedState" "PreparedState" NOT NULL DEFAULT 'RAW',
    "yieldFactor" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ComponentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchProduction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'PLANNED',
    "plannedDate" TIMESTAMP(3) NOT NULL,
    "batchCode" TEXT,
    "rawInputG" DOUBLE PRECISION NOT NULL,
    "expectedYieldG" DOUBLE PRECISION NOT NULL,
    "actualYieldG" DOUBLE PRECISION,
    "portionCount" INTEGER,
    "portionSizeG" DOUBLE PRECISION,
    "yieldVariance" DOUBLE PRECISION,
    "cookTempC" DOUBLE PRECISION,
    "cookTimeMin" INTEGER,
    "chillStartedAt" TIMESTAMP(3),
    "chillCompletedAt" TIMESTAMP(3),
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "BatchProduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchLotConsumption" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "inventoryLotId" TEXT NOT NULL,
    "gramsConsumed" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "BatchLotConsumption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Component_organizationId_componentType_idx" ON "Component"("organizationId", "componentType");

-- CreateIndex
CREATE UNIQUE INDEX "Component_organizationId_name_key" ON "Component"("organizationId", "name");

-- CreateIndex
CREATE INDEX "ComponentLine_componentId_idx" ON "ComponentLine"("componentId");

-- CreateIndex
CREATE UNIQUE INDEX "ComponentLine_componentId_lineOrder_key" ON "ComponentLine"("componentId", "lineOrder");

-- CreateIndex
CREATE INDEX "BatchProduction_organizationId_status_idx" ON "BatchProduction"("organizationId", "status");

-- CreateIndex
CREATE INDEX "BatchProduction_organizationId_plannedDate_idx" ON "BatchProduction"("organizationId", "plannedDate");

-- CreateIndex
CREATE INDEX "BatchLotConsumption_batchId_idx" ON "BatchLotConsumption"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLot_batchProductionId_key" ON "InventoryLot"("batchProductionId");

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_batchProductionId_fkey" FOREIGN KEY ("batchProductionId") REFERENCES "BatchProduction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Component" ADD CONSTRAINT "Component_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComponentLine" ADD CONSTRAINT "ComponentLine_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComponentLine" ADD CONSTRAINT "ComponentLine_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "IngredientCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchProduction" ADD CONSTRAINT "BatchProduction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchProduction" ADD CONSTRAINT "BatchProduction_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchLotConsumption" ADD CONSTRAINT "BatchLotConsumption_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BatchProduction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchLotConsumption" ADD CONSTRAINT "BatchLotConsumption_inventoryLotId_fkey" FOREIGN KEY ("inventoryLotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
