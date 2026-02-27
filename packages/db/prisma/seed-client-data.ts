/**
 * Seed Client Data from Extracted Documents
 *
 * Inserts data extracted from Alex Rosenthal's uploaded documents:
 * - DEXA scan (02/12/2026)
 * - Bloodwork panel (02/21/2026)
 * - CGM data (02/15–02/23/2026)
 *
 * Run: npx tsx packages/db/prisma/seed-client-data.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CLIENT_ID = "cmlx7ed0w0002fxce6vkdgcyi";
const DEXA_DOC_ID = "cmm4c85lh0003mnoo259rzw9s";
const BLOODWORK_DOC_ID = "cmm4c9hfh0007mnoos7kr7awj";
const CGM_DOC_ID = "cmm4cafsg000bmnooi3rsl1bt";

async function main() {
  // 1. Look up the client to get organizationId
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: CLIENT_ID },
  });
  const orgId = client.organizationId;
  console.log(`Found client: ${client.fullName} (org: ${orgId})`);

  // 2. Update client profile with demographic data from DEXA
  await prisma.client.update({
    where: { id: CLIENT_ID },
    data: {
      dateOfBirth: new Date("2004-09-05T00:00:00Z"),
      sex: "male",
      heightCm: 180.3,
      weightKg: 88.5,
      activityLevel: "active", // 21-year-old athlete
    },
  });
  console.log("Updated client profile (DOB, sex, height, weight, activity)");

  // 3. Create BiometricSnapshot from DEXA (02/12/2026)
  const dexaSnapshot = await prisma.biometricSnapshot.upsert({
    where: {
      id: "seed-dexa-2026-02-12", // stable ID for idempotency
    },
    update: {
      weightKg: 88.5,
      bodyFatPct: 10.7,
      leanMassKg: 74.7,
      heightCm: 180.3,
      source: "dexa",
      notes: "DEXA scan at body composition facility. Fat-free mass 79.2 kg, BMC 4.4 kg, BMI 27.2",
    },
    create: {
      id: "seed-dexa-2026-02-12",
      organizationId: orgId,
      clientId: CLIENT_ID,
      measuredAt: new Date("2026-02-12T12:00:00Z"),
      weightKg: 88.5,
      bodyFatPct: 10.7,
      leanMassKg: 74.7,
      heightCm: 180.3,
      source: "dexa",
      notes: "DEXA scan at body composition facility. Fat-free mass 79.2 kg, BMC 4.4 kg, BMI 27.2",
      createdBy: "seed-client-data",
    },
  });
  console.log(`BiometricSnapshot created: ${dexaSnapshot.id}`);

  // 4. DEXA MetricSeries entries
  const dexaMetrics: Array<{ key: string; value: number; unit: string; notes?: string }> = [
    { key: "body_fat_pct", value: 10.7, unit: "%" },
    { key: "lean_mass_kg", value: 74.7, unit: "kg" },
    { key: "fat_mass_kg", value: 9.0, unit: "kg" },
    { key: "fat_free_mass_kg", value: 79.2, unit: "kg" },
    { key: "bone_mineral_content_kg", value: 4.4, unit: "kg" },
    { key: "bmi", value: 27.2, unit: "kg/m2" },
    { key: "bmd_total", value: 1.717, unit: "g/cm2", notes: "Total body BMD, T-score 5.1, Z-score 4.7" },
    { key: "android_fat_pct", value: 6.6, unit: "%", notes: "Abdominal region fat %" },
    { key: "gynoid_fat_pct", value: 9.6, unit: "%", notes: "Hip region fat %" },
    { key: "ag_ratio", value: 0.68, unit: "ratio", notes: "Android/Gynoid ratio — lower is better" },
    { key: "vat_mass_lbs", value: 0.29, unit: "lbs", notes: "Visceral adipose tissue" },
    { key: "arm_fat_pct", value: 10.0, unit: "%" },
    { key: "leg_fat_pct", value: 11.4, unit: "%" },
    { key: "trunk_fat_pct", value: 9.2, unit: "%" },
    { key: "weight_kg", value: 88.5, unit: "kg" },
    { key: "height_cm", value: 180.3, unit: "cm" },
  ];

  let dexaCount = 0;
  for (const m of dexaMetrics) {
    await prisma.metricSeries.upsert({
      where: { id: `seed-dexa-${m.key}` },
      update: { value: m.value, unit: m.unit, notes: m.notes ?? null },
      create: {
        id: `seed-dexa-${m.key}`,
        organizationId: orgId,
        clientId: CLIENT_ID,
        metricKey: m.key,
        value: m.value,
        unit: m.unit,
        observedAt: new Date("2026-02-12T12:00:00Z"),
        sourceDocumentId: DEXA_DOC_ID,
        verification: "PARSED_AUTO",
        confidenceScore: 0.95,
        notes: m.notes ?? null,
        createdBy: "seed-client-data",
      },
    });
    dexaCount++;
  }
  console.log(`DEXA metrics inserted: ${dexaCount}`);

  // 5. Bloodwork MetricSeries entries (02/21/2026)
  const bloodworkMetrics: Array<{ key: string; value: number; unit: string; notes?: string }> = [
    { key: "shbg", value: 49.2, unit: "nmol/L" },
    { key: "ferritin", value: 131, unit: "ng/mL" },
    { key: "total_testosterone", value: 390, unit: "ng/dL", notes: "Low for performance range (700-1100). Unfasted midafternoon draw" },
    { key: "free_testosterone", value: 56.56, unit: "pg/mL", notes: "Low for performance range" },
    { key: "vitamin_d", value: 47.2, unit: "ng/mL" },
    { key: "albumin", value: 5.14, unit: "g/dL" },
    { key: "total_cholesterol", value: 211, unit: "mg/dL" },
    { key: "hdl", value: 77.4, unit: "mg/dL" },
    { key: "ldl", value: 118.54, unit: "mg/dL" },
    { key: "triglycerides", value: 75.3, unit: "mg/dL" },
    { key: "apob", value: 74.6, unit: "mg/dL" },
    { key: "free_t3", value: 2.33, unit: "pg/mL" },
    { key: "tsh", value: 1.00, unit: "uIU/mL" },
    { key: "creatinine", value: 1.22, unit: "mg/dL" },
    { key: "crp", value: 0.5, unit: "mg/L", notes: "CRP <0.5 mg/L — excellent inflammatory marker" },
    { key: "estrogen", value: 12, unit: "pg/mL", notes: "Below detectable range (<12)" },
    { key: "remnant_cholesterol", value: 15.05, unit: "mg/dL" },
    { key: "tc_hdl_ratio", value: 2.72, unit: "ratio" },
    { key: "tg_hdl_ratio", value: 0.97, unit: "ratio" },
    { key: "ldl_apob_ratio", value: 1.58, unit: "ratio" },
  ];

  let bloodCount = 0;
  for (const m of bloodworkMetrics) {
    await prisma.metricSeries.upsert({
      where: { id: `seed-blood-${m.key}` },
      update: { value: m.value, unit: m.unit, notes: m.notes ?? null },
      create: {
        id: `seed-blood-${m.key}`,
        organizationId: orgId,
        clientId: CLIENT_ID,
        metricKey: m.key,
        value: m.value,
        unit: m.unit,
        observedAt: new Date("2026-02-21T12:00:00Z"),
        sourceDocumentId: BLOODWORK_DOC_ID,
        verification: "PARSED_AUTO",
        confidenceScore: 0.90,
        notes: m.notes ?? null,
        createdBy: "seed-client-data",
      },
    });
    bloodCount++;
  }
  console.log(`Bloodwork metrics inserted: ${bloodCount}`);

  // 6. CGM Summary MetricSeries entries (02/15–02/23/2026, mid-point date)
  const cgmMetrics: Array<{ key: string; value: number; unit: string; notes?: string }> = [
    { key: "cgm_avg_glucose", value: 81, unit: "mg/dL", notes: "9-day average (2191 readings)" },
    { key: "cgm_min_glucose", value: 55, unit: "mg/dL" },
    { key: "cgm_max_glucose", value: 155, unit: "mg/dL" },
    { key: "cgm_median_glucose", value: 79, unit: "mg/dL" },
    { key: "cgm_stddev_glucose", value: 13, unit: "mg/dL" },
    { key: "cgm_time_in_range_pct", value: 81, unit: "%", notes: "70-140 mg/dL range" },
    { key: "cgm_time_below_range_pct", value: 19, unit: "%", notes: "Below 70 mg/dL — significant hypoglycemia" },
    { key: "cgm_time_above_range_pct", value: 0, unit: "%", notes: "Above 140 mg/dL" },
    { key: "cgm_fasting_glucose_avg", value: 71, unit: "mg/dL", notes: "5-7 AM average" },
    { key: "cgm_readings_count", value: 2191, unit: "count", notes: "15 out-of-range readings excluded" },
  ];

  let cgmCount = 0;
  for (const m of cgmMetrics) {
    await prisma.metricSeries.upsert({
      where: { id: `seed-cgm-${m.key}` },
      update: { value: m.value, unit: m.unit, notes: m.notes ?? null },
      create: {
        id: `seed-cgm-${m.key}`,
        organizationId: orgId,
        clientId: CLIENT_ID,
        metricKey: m.key,
        value: m.value,
        unit: m.unit,
        observedAt: new Date("2026-02-19T12:00:00Z"), // mid-point of 02/15–02/23
        sourceDocumentId: CGM_DOC_ID,
        verification: "PARSED_AUTO",
        confidenceScore: 0.95,
        notes: m.notes ?? null,
        createdBy: "seed-client-data",
      },
    });
    cgmCount++;
  }
  console.log(`CGM summary metrics inserted: ${cgmCount}`);

  // 7. Update document parsing statuses to VERIFIED
  for (const docId of [DEXA_DOC_ID, BLOODWORK_DOC_ID, CGM_DOC_ID]) {
    await prisma.clientDocument.update({
      where: { id: docId },
      data: {
        parsingStatus: "VERIFIED",
        verifiedAt: new Date(),
        verifiedBy: "seed-client-data",
        sourceProvider: docId === DEXA_DOC_ID
          ? "DEXA body composition facility"
          : docId === BLOODWORK_DOC_ID
            ? "Rythm Health (Dr. Guiyuan Li)"
            : "Lingo CGM (Abbott)",
      },
    });
  }
  console.log("Document parsing statuses updated to VERIFIED");

  // Summary
  const totalMetrics = dexaCount + bloodCount + cgmCount;
  console.log(`\nSeed complete:
  - Client profile updated (DOB, sex, height, weight, activity)
  - 1 BiometricSnapshot (DEXA)
  - ${totalMetrics} MetricSeries entries (${dexaCount} DEXA + ${bloodCount} bloodwork + ${cgmCount} CGM)
  - 3 documents marked VERIFIED`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
