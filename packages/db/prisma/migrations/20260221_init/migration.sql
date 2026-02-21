-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('OWNER', 'ADMIN', 'CSO', 'OPS', 'VIEWER');

-- CreateEnum
CREATE TYPE "NutrientSourceType" AS ENUM ('MANUFACTURER', 'USDA', 'MANUAL', 'DERIVED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('VERIFIED', 'NEEDS_REVIEW', 'REJECTED');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('PLANNED', 'DONE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "LabelType" AS ENUM ('SKU', 'INGREDIENT', 'PRODUCT', 'LOT');

-- CreateEnum
CREATE TYPE "VerificationTaskType" AS ENUM ('SOURCE_RETRIEVAL', 'CONSISTENCY', 'LINEAGE_INTEGRITY');

-- CreateEnum
CREATE TYPE "VerificationTaskSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "VerificationTaskStatus" AS ENUM ('OPEN', 'APPROVED', 'REJECTED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ImportJobType" AS ENUM ('SOT', 'INSTACART_ORDER');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "ImportMode" AS ENUM ('DRY_RUN', 'COMMIT');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" "RoleName" NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "externalRef" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sku" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "servingSizeG" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Sku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "servings" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngredientCatalog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "defaultUnit" TEXT NOT NULL DEFAULT 'g',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "allergenTags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "IngredientCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeLine" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "lineOrder" INTEGER NOT NULL,
    "targetGPerServing" DOUBLE PRECISION NOT NULL,
    "preparation" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "RecipeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCatalog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "brand" TEXT,
    "name" TEXT NOT NULL,
    "upc" TEXT,
    "vendor" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ProductCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NutrientDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL,
    "dailyValue" DOUBLE PRECISION,
    "fdaCore" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "NutrientDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductNutrientValue" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "nutrientDefinitionId" TEXT NOT NULL,
    "valuePer100g" DOUBLE PRECISION,
    "sourceType" "NutrientSourceType" NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ProductNutrientValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotCode" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "quantityReceivedG" DOUBLE PRECISION NOT NULL,
    "quantityAvailableG" DOUBLE PRECISION NOT NULL,
    "unitCostCents" INTEGER,
    "sourceOrderRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "InventoryLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLotLedger" (
    "id" TEXT NOT NULL,
    "inventoryLotId" TEXT NOT NULL,
    "deltaG" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "referenceId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "InventoryLotLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealSchedule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "serviceDate" TIMESTAMP(3) NOT NULL,
    "mealSlot" TEXT NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'PLANNED',
    "plannedServings" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "MealSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealServiceEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "mealScheduleId" TEXT NOT NULL,
    "servedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "servedByUserId" TEXT NOT NULL,
    "scheduleStatusAtService" "ScheduleStatus" NOT NULL,
    "finalLabelSnapshotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "MealServiceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LotConsumptionEvent" (
    "id" TEXT NOT NULL,
    "mealServiceEventId" TEXT NOT NULL,
    "recipeLineId" TEXT NOT NULL,
    "inventoryLotId" TEXT NOT NULL,
    "gramsConsumed" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "LotConsumptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabelSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "labelType" "LabelType" NOT NULL,
    "externalRefId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "renderPayload" JSONB NOT NULL,
    "frozenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "LabelSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabelLineageEdge" (
    "id" TEXT NOT NULL,
    "parentLabelId" TEXT NOT NULL,
    "childLabelId" TEXT NOT NULL,
    "edgeType" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "LabelLineageEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskType" "VerificationTaskType" NOT NULL,
    "severity" "VerificationTaskSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "VerificationTaskStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'agent',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "VerificationTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationReview" (
    "id" TEXT NOT NULL,
    "verificationTaskId" TEXT NOT NULL,
    "reviewedByUserId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "VerificationReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobType" "ImportJobType" NOT NULL,
    "mode" "ImportMode" NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'RUNNING',
    "sourceFileName" TEXT NOT NULL,
    "sourceChecksum" TEXT NOT NULL,
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJobError" (
    "id" TEXT NOT NULL,
    "importJobId" TEXT NOT NULL,
    "sheetName" TEXT,
    "rowNumber" INTEGER,
    "errorCode" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ImportJobError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseBody" JSONB,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstacartDraft" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "horizonHours" INTEGER NOT NULL DEFAULT 72,
    "draftPayload" JSONB NOT NULL,
    "linkBundle" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "InstacartDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "User_organizationId_email_key" ON "User"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_organizationId_name_key" ON "Role"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_roleId_key" ON "UserRole"("userId", "roleId");

-- CreateIndex
CREATE INDEX "Client_organizationId_idx" ON "Client"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_organizationId_externalRef_key" ON "Client"("organizationId", "externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "Sku_organizationId_code_key" ON "Sku"("organizationId", "code");

-- CreateIndex
CREATE INDEX "Recipe_organizationId_skuId_idx" ON "Recipe"("organizationId", "skuId");

-- CreateIndex
CREATE UNIQUE INDEX "IngredientCatalog_organizationId_canonicalKey_key" ON "IngredientCatalog"("organizationId", "canonicalKey");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeLine_recipeId_lineOrder_key" ON "RecipeLine"("recipeId", "lineOrder");

-- CreateIndex
CREATE INDEX "ProductCatalog_organizationId_ingredientId_idx" ON "ProductCatalog"("organizationId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCatalog_organizationId_upc_key" ON "ProductCatalog"("organizationId", "upc");

-- CreateIndex
CREATE UNIQUE INDEX "NutrientDefinition_key_key" ON "NutrientDefinition"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ProductNutrientValue_productId_nutrientDefinitionId_key" ON "ProductNutrientValue"("productId", "nutrientDefinitionId");

-- CreateIndex
CREATE INDEX "InventoryLot_organizationId_productId_idx" ON "InventoryLot"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "InventoryLotLedger_inventoryLotId_occurredAt_idx" ON "InventoryLotLedger"("inventoryLotId", "occurredAt");

-- CreateIndex
CREATE INDEX "MealSchedule_organizationId_clientId_serviceDate_idx" ON "MealSchedule"("organizationId", "clientId", "serviceDate");

-- CreateIndex
CREATE UNIQUE INDEX "MealServiceEvent_mealScheduleId_key" ON "MealServiceEvent"("mealScheduleId");

-- CreateIndex
CREATE INDEX "MealServiceEvent_organizationId_clientId_servedAt_idx" ON "MealServiceEvent"("organizationId", "clientId", "servedAt");

-- CreateIndex
CREATE INDEX "LotConsumptionEvent_mealServiceEventId_idx" ON "LotConsumptionEvent"("mealServiceEventId");

-- CreateIndex
CREATE INDEX "LabelSnapshot_organizationId_labelType_idx" ON "LabelSnapshot"("organizationId", "labelType");

-- CreateIndex
CREATE UNIQUE INDEX "LabelLineageEdge_parentLabelId_childLabelId_edgeType_key" ON "LabelLineageEdge"("parentLabelId", "childLabelId", "edgeType");

-- CreateIndex
CREATE INDEX "VerificationTask_organizationId_status_taskType_idx" ON "VerificationTask"("organizationId", "status", "taskType");

-- CreateIndex
CREATE INDEX "VerificationReview_verificationTaskId_idx" ON "VerificationReview"("verificationTaskId");

-- CreateIndex
CREATE INDEX "ImportJob_organizationId_jobType_status_idx" ON "ImportJob"("organizationId", "jobType", "status");

-- CreateIndex
CREATE INDEX "ImportJobError_importJobId_idx" ON "ImportJobError"("importJobId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_key_key" ON "IdempotencyKey"("key");

-- CreateIndex
CREATE INDEX "InstacartDraft_organizationId_generatedAt_idx" ON "InstacartDraft"("organizationId", "generatedAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sku" ADD CONSTRAINT "Sku_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientCatalog" ADD CONSTRAINT "IngredientCatalog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "IngredientCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCatalog" ADD CONSTRAINT "ProductCatalog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCatalog" ADD CONSTRAINT "ProductCatalog_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "IngredientCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductNutrientValue" ADD CONSTRAINT "ProductNutrientValue_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ProductCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductNutrientValue" ADD CONSTRAINT "ProductNutrientValue_nutrientDefinitionId_fkey" FOREIGN KEY ("nutrientDefinitionId") REFERENCES "NutrientDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ProductCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLotLedger" ADD CONSTRAINT "InventoryLotLedger_inventoryLotId_fkey" FOREIGN KEY ("inventoryLotId") REFERENCES "InventoryLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealSchedule" ADD CONSTRAINT "MealSchedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealSchedule" ADD CONSTRAINT "MealSchedule_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealSchedule" ADD CONSTRAINT "MealSchedule_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealServiceEvent" ADD CONSTRAINT "MealServiceEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealServiceEvent" ADD CONSTRAINT "MealServiceEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealServiceEvent" ADD CONSTRAINT "MealServiceEvent_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealServiceEvent" ADD CONSTRAINT "MealServiceEvent_mealScheduleId_fkey" FOREIGN KEY ("mealScheduleId") REFERENCES "MealSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealServiceEvent" ADD CONSTRAINT "MealServiceEvent_servedByUserId_fkey" FOREIGN KEY ("servedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealServiceEvent" ADD CONSTRAINT "MealServiceEvent_finalLabelSnapshotId_fkey" FOREIGN KEY ("finalLabelSnapshotId") REFERENCES "LabelSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotConsumptionEvent" ADD CONSTRAINT "LotConsumptionEvent_mealServiceEventId_fkey" FOREIGN KEY ("mealServiceEventId") REFERENCES "MealServiceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotConsumptionEvent" ADD CONSTRAINT "LotConsumptionEvent_recipeLineId_fkey" FOREIGN KEY ("recipeLineId") REFERENCES "RecipeLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotConsumptionEvent" ADD CONSTRAINT "LotConsumptionEvent_inventoryLotId_fkey" FOREIGN KEY ("inventoryLotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelSnapshot" ADD CONSTRAINT "LabelSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelLineageEdge" ADD CONSTRAINT "LabelLineageEdge_parentLabelId_fkey" FOREIGN KEY ("parentLabelId") REFERENCES "LabelSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelLineageEdge" ADD CONSTRAINT "LabelLineageEdge_childLabelId_fkey" FOREIGN KEY ("childLabelId") REFERENCES "LabelSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationTask" ADD CONSTRAINT "VerificationTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationReview" ADD CONSTRAINT "VerificationReview_verificationTaskId_fkey" FOREIGN KEY ("verificationTaskId") REFERENCES "VerificationTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationReview" ADD CONSTRAINT "VerificationReview_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJobError" ADD CONSTRAINT "ImportJobError_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstacartDraft" ADD CONSTRAINT "InstacartDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

