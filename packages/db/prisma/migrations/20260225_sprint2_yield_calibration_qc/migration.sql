-- Sprint 2: Yield Calibration + QC Issues

CREATE TYPE "CalibrationStatus" AS ENUM ('PENDING_REVIEW', 'ACCEPTED', 'REJECTED', 'SUPERSEDED');
CREATE TYPE "QcIssueType" AS ENUM ('TEMP_MISS', 'CHILL_TIME_EXCEEDED', 'MISSING_CHECKPOINT', 'LATE_CHECKPOINT', 'MANUAL_OVERRIDE', 'YIELD_VARIANCE_HIGH', 'YIELD_VARIANCE_CRITICAL');

CREATE TABLE "YieldCalibration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "method" TEXT,
    "cutForm" TEXT,
    "expectedYieldPct" DOUBLE PRECISION NOT NULL,
    "actualYieldPct" DOUBLE PRECISION NOT NULL,
    "variancePct" DOUBLE PRECISION NOT NULL,
    "sampleCount" INTEGER NOT NULL DEFAULT 1,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "proposedYieldPct" DOUBLE PRECISION,
    "status" "CalibrationStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "isOutlier" BOOLEAN NOT NULL DEFAULT false,
    "outlierReason" TEXT,
    "reviewedBy" TEXT,
    "reviewNotes" TEXT,
    "batchProductionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "YieldCalibration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QcIssue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchProductionId" TEXT NOT NULL,
    "issueType" "QcIssueType" NOT NULL,
    "description" TEXT NOT NULL,
    "expectedValue" TEXT,
    "actualValue" TEXT,
    "overrideAllowed" BOOLEAN NOT NULL DEFAULT true,
    "overrideReason" TEXT,
    "overrideBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "QcIssue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "YieldCalibration_organizationId_componentId_idx" ON "YieldCalibration"("organizationId", "componentId");
CREATE INDEX "YieldCalibration_organizationId_status_idx" ON "YieldCalibration"("organizationId", "status");
CREATE INDEX "QcIssue_organizationId_batchProductionId_idx" ON "QcIssue"("organizationId", "batchProductionId");
CREATE INDEX "QcIssue_organizationId_issueType_idx" ON "QcIssue"("organizationId", "issueType");

ALTER TABLE "YieldCalibration" ADD CONSTRAINT "YieldCalibration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "YieldCalibration" ADD CONSTRAINT "YieldCalibration_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QcIssue" ADD CONSTRAINT "QcIssue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QcIssue" ADD CONSTRAINT "QcIssue_batchProductionId_fkey" FOREIGN KEY ("batchProductionId") REFERENCES "BatchProduction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
