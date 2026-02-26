-- Sprint 4: File Storage + Biometrics + Document Ingestion + Parsed Metrics

-- Enums
CREATE TYPE "DocumentType" AS ENUM ('DEXA', 'BLOODWORK', 'CGM', 'OTHER');
CREATE TYPE "ParsingStatus" AS ENUM ('NOT_STARTED', 'QUEUED', 'PARSED_PARTIAL', 'VERIFIED', 'FAILED');
CREATE TYPE "MetricVerification" AS ENUM ('UNVERIFIED', 'MANUAL_ENTRY', 'PARSED_AUTO', 'CLINICIAN_VERIFIED');

-- FileAttachment: abstract file storage metadata
CREATE TABLE "FileAttachment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'local',
    "storageBucket" TEXT,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT,
    "uploadedBy" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "FileAttachment_pkey" PRIMARY KEY ("id")
);

-- BiometricSnapshot: date-stamped client biometric records
CREATE TABLE "BiometricSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "heightCm" DOUBLE PRECISION,
    "weightKg" DOUBLE PRECISION,
    "bodyFatPct" DOUBLE PRECISION,
    "leanMassKg" DOUBLE PRECISION,
    "restingHr" INTEGER,
    "notes" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "BiometricSnapshot_pkey" PRIMARY KEY ("id")
);

-- ClientDocument: structured document records with file linkage
CREATE TABLE "ClientDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fileAttachmentId" TEXT,
    "documentType" "DocumentType" NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceProvider" TEXT,
    "tags" TEXT[],
    "parsingStatus" "ParsingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "parsingError" TEXT,
    "notes" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ClientDocument_pkey" PRIMARY KEY ("id")
);

-- MetricSeries: normalized metric data points with provenance
CREATE TABLE "MetricSeries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "sourceDocumentId" TEXT,
    "verification" "MetricVerification" NOT NULL DEFAULT 'UNVERIFIED',
    "confidenceScore" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "MetricSeries_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "FileAttachment_organizationId_idx" ON "FileAttachment"("organizationId");
CREATE INDEX "FileAttachment_storageKey_idx" ON "FileAttachment"("storageKey");

CREATE INDEX "BiometricSnapshot_organizationId_clientId_measuredAt_idx" ON "BiometricSnapshot"("organizationId", "clientId", "measuredAt");

CREATE INDEX "ClientDocument_organizationId_clientId_idx" ON "ClientDocument"("organizationId", "clientId");
CREATE INDEX "ClientDocument_organizationId_documentType_idx" ON "ClientDocument"("organizationId", "documentType");
CREATE INDEX "ClientDocument_organizationId_parsingStatus_idx" ON "ClientDocument"("organizationId", "parsingStatus");

CREATE INDEX "MetricSeries_organizationId_clientId_metricKey_observedAt_idx" ON "MetricSeries"("organizationId", "clientId", "metricKey", "observedAt");
CREATE INDEX "MetricSeries_organizationId_clientId_observedAt_idx" ON "MetricSeries"("organizationId", "clientId", "observedAt");

-- Foreign keys
ALTER TABLE "FileAttachment" ADD CONSTRAINT "FileAttachment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BiometricSnapshot" ADD CONSTRAINT "BiometricSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BiometricSnapshot" ADD CONSTRAINT "BiometricSnapshot_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_fileAttachmentId_fkey" FOREIGN KEY ("fileAttachmentId") REFERENCES "FileAttachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MetricSeries" ADD CONSTRAINT "MetricSeries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MetricSeries" ADD CONSTRAINT "MetricSeries_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MetricSeries" ADD CONSTRAINT "MetricSeries_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "ClientDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
