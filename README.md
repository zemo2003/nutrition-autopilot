# Numen &mdash; Nutrition Autopilot

A database-first nutrition operations platform with deterministic label traceability, FDA-compliant rounding, and full audit lineage from ingredient to plate.

---

## What It Does

Numen manages the complete lifecycle of a meal prep operation across three operational modes:

### Kitchen Mode
Real-time batch prep workflow. Track batches from planned through cooking, chilling, portioning, and ready. Temperature checkpoints, hold-to-confirm buttons, pull lists, and daily summaries. Mark meals as fed and freeze their nutrition labels at serve time.

### Science Mode
Verification and quality assurance. Audit label lineage with full drill-down from final label back to source lots. Review verification tasks, detect stale labels, flag data quality issues, and track evidence grades across your entire nutrient database.

### Delivery Mode
Fulfillment and routing. Generate packing orders from scheduled meals, manage multi-stop delivery routes, print packing slips and route sheets, and track delivery status from packing through dispatch to delivery.

---

## Client Profile (Cross-Mode)

The client profile is the central hub that follows across all three modes. Every meal scheduled, every label frozen, every delivery routed ties back to a client record.

**Identity & Preferences**
- Full name, email, phone, date of birth, sex
- Dietary goals (free text), food preferences, allergen exclusions (array)
- Timezone-aware scheduling

**Body Composition & Targets**
- Height, weight, activity level
- Target macros: daily kcal, protein (g), carbs (g), fat (g)
- Target body composition: goal weight (kg), goal body fat %
- Body composition snapshot history (JSON timeline)

**Biometrics Tracking**
- Time-series snapshots: weight, body fat %, lean mass, resting HR
- Automatic trend detection (up/down/stable with 1% threshold)
- Stale data alerts (>30 days since last entry)
- Irregular interval detection (3x median gap)

**Health Metrics**
- Custom metric series (CGM glucose, bloodwork panels, sleep, HRV, etc.)
- Verified/unverified status per metric entry
- Rolling period aggregation (7d, 30d, 60d, 90d)

**Documents**
- DEXA scans, bloodwork PDFs, clinical notes
- Document type classification and verification status
- Attached to client timeline

**Nutrition Analytics**
- Weekly nutrition summaries with macro breakdown
- Compliance tracking (days with data / period)
- Trend analysis (first half vs. second half comparison)
- Printable progress reports

**Delivery**
- Dual addresses (home + work) with delivery notes
- Delivery zone assignment
- Address carried into fulfillment orders as snapshot

**How it connects across modes:**
- **Kitchen** &mdash; Client name on every meal card, allergen exclusions checked against compositions, batch portions tagged to client
- **Science** &mdash; Client health dashboard with biometrics, metrics, documents, and TDEE calculations using their profile data (Mifflin-St Jeor with their height/weight/age/sex/activity level)
- **Delivery** &mdash; Client addresses drive route planning, delivery notes shown on packing slips and route sheets

---

## Scientific Foundations

Every calorie on a Numen label is traceable to a peer-reviewed formula, a government database, or a manufacturer declaration. Here is what the math is built on.

### USDA & FDA Standards

| Standard | What It Governs | Implementation |
|---|---|---|
| **USDA FoodData Central** | Nutrient values per 100g for branded and generic foods | Primary enrichment source via API; evidence grade tracked per value |
| **USDA Cooking Yield Factors** (1992, rev. 2007) | Weight change during cooking (e.g., chicken breast loses 25%) | 60+ yield factors by ingredient with prepared-state detection |
| **USDA Nutrient Retention Factors** (Release 6) | Nutrient loss during cooking | Applied alongside yield correction in label pipeline |
| **21 CFR 101.9 & 101.36** | FDA Nutrition Facts label rounding rules | Nutrient-specific rounding (calories to nearest 5/10, fat to nearest 0.5/1, etc.) |
| **FDA Daily Values (2020)** | %DV reference amounts | 40+ nutrients with mandatories, units, and display order |
| **FDA Class I Tolerance** | Acceptable label accuracy | +/- 20% for normal foods, +/- 35% for low-calorie/high-fiber foods |

### Metabolic Calculations

| Formula | Use Case | Details |
|---|---|---|
| **Mifflin-St Jeor** | BMR estimation (primary) | Male: 10W + 6.25H - 5A + 5; Female: 10W + 6.25H - 5A - 161 |
| **Harris-Benedict (revised)** | BMR estimation (secondary) | Male: 88.362 + 13.397W + 4.799H - 5.677A; Female: 447.593 + 9.247W + 3.098H - 4.330A |
| **Atwater Factors** | Energy from macros | Protein: 4 kcal/g, Carbs: 4 kcal/g, Fat: 9 kcal/g |
| **TDEE Activity Multipliers** | Total daily energy expenditure | Sedentary (1.2) through Very Active (1.9) |
| **Goal-Based Macros** | Cut/maintain/bulk recommendations | Cut: TDEE-500, 2.2g protein/kg; Maintain: TDEE, 1.8g/kg; Bulk: TDEE+300, 2.0g/kg |

### Yield Factor Database

60+ ingredient-specific yield factors sourced from USDA data, covering:

- **Poultry** &mdash; chicken breast (0.75), thigh (0.72), ground turkey (0.78)
- **Beef** &mdash; ground 95/90/85/80 lean (0.78-0.64), steak (0.72), roast (0.70)
- **Fish** &mdash; salmon (0.80), cod (0.82), shrimp (0.85)
- **Grains** &mdash; white rice (2.50), brown rice (2.40), pasta (2.25), quinoa (2.60), oats (3.00)
- **Vegetables** &mdash; broccoli (0.88), spinach (0.77), sweet potato (0.90)
- **Eggs** &mdash; whole (0.92), whites (0.95)

Yield correction eliminates up to 37% calorie error from raw/cooked nutrient mismatch.

---

## Verification Guardrails

Numen enforces multiple layers of verification to catch errors before they reach a label.

### Nutrient Hierarchy Invariants (FDA)
Enforced both pre-rounding and post-rounding:
- `carb_g >= max(sugars_g, fiber_g, sugars_g + fiber_g)`
- `fat_g >= sat_fat_g + trans_fat_g`
- `added_sugars_g <= sugars_g`
- `kcal >= 50%` of Atwater estimate (catches implausibly low values)

### FDA Rounding Rules (21 CFR 101.9)
Applied at the **final label step only** to prevent rounding error accumulation:
- Calories: <5 = 0, 5-50 = nearest 5, >50 = nearest 10
- Fat: <0.5 = 0, 0.5-5 = nearest 0.5, >5 = nearest 1
- Sodium: <5 = 0, 5-140 = nearest 5, >140 = nearest 10
- And 12 more nutrient-specific rules

### Evidence Grading
Every nutrient value carries a source grade:
- **MANUFACTURER_LABEL** &mdash; from the product package
- **USDA_BRANDED** &mdash; USDA FoodData Central branded product
- **USDA_GENERIC** &mdash; USDA generic/SR Legacy entry
- **OPENFOODFACTS** &mdash; community database
- **INFERRED_FROM_INGREDIENT** / **INFERRED_FROM_SIMILAR_PRODUCT** &mdash; algorithmic estimate
- **HISTORICAL_EXCEPTION** &mdash; manually approved override

Labels track verified, inferred, exception, and unverified counts. Incomplete core nutrients are allowed but flagged **PROVISIONAL**.

### Verification Task Queue
Automated detection of data issues:
- **SOURCE_RETRIEVAL** &mdash; missing nutrient data needs sourcing
- **CONSISTENCY** &mdash; values contradict each other
- **LINEAGE_INTEGRITY** &mdash; ingredient sourcing chain broken

Each task carries severity (LOW through CRITICAL) and requires human resolution (APPROVED / REJECTED / RESOLVED).

### Batch QC Controls
- Temperature checkpoint enforcement at each batch stage
- Yield variance alerts: warning at >15%, critical alert + verification task at >30%
- Issue types: TEMP_MISS, CHILL_TIME_EXCEEDED, MISSING_CHECKPOINT, LATE_CHECKPOINT, YIELD_VARIANCE_CRITICAL
- Append-only checkpoint log (immutable audit trail)

### Label Freeze
When a meal is marked "Fed," the nutrition label is frozen from the actual lots consumed. This snapshot is immutable, creating a permanent, auditable record of exactly what nutrients were served.

---

## Label Computation Pipeline

The nutrition engine is a pure, deterministic math library with zero database dependencies:

1. **Yield Correction** &mdash; Detects mismatch between recipe prepared state and lot nutrient profile state; applies USDA yield factor
2. **Nutrient Aggregation** &mdash; Scales each of 40+ nutrients by (grams consumed / 100) per lot, sums across all lots, divides by servings
3. **Hierarchy Enforcement** &mdash; Clamps sub-components to FDA invariants (pre-rounding)
4. **FDA Rounding** &mdash; Applies nutrient-specific rounding per 21 CFR 101.9
5. **Post-Rounding Clamps** &mdash; Re-enforces hierarchy after rounding
6. **%DV Calculation** &mdash; Against 2020 FDA Daily Values
7. **Allergen Declaration** &mdash; Auto-generates "Contains:" statement for the 9 major allergens (milk, egg, fish, shellfish, tree nuts, peanuts, wheat, soy, sesame)
8. **QA Check** &mdash; Validates Atwater energy vs. labeled calories within FDA tolerance

---

## Features

### Meal Planning
- Schedule meals by client, date, and slot (breakfast through pre-bed)
- ChatGPT Custom GPT Action for natural-language meal planning
- Composition engine with macro split analysis and allergen compatibility checks
- Prep draft generation with weekly planning

### Inventory
- FIFO lot tracking (earliest expiry consumed first)
- Par level management with 72-hour demand horizon alerts
- Inventory projections, demand forecasting, waste summaries
- Allocation tracking across active batches

### Import & Integration
- **SOT (Source of Truth)** &mdash; Excel workbook import for SKU catalog, recipes, and ingredients
- **Instacart CSV** &mdash; Order history import with auto-mapping to ingredient catalog
- **Gmail Auto-Import** &mdash; OAuth-connected automatic parsing of Instacart order confirmation emails
- **ChatGPT GPT Action** &mdash; Push meal plans via natural language (OpenAPI 3.1 spec at `/v1/openapi.json`)
- **USDA Enrichment** &mdash; Async nutrient enrichment from FoodData Central API
- **Pilot Backfill** &mdash; Historical week import for onboarding

### Kitchen Operations
- Batch production with 10 checkpoint types
- Temperature logging and chill time validation
- Sauce library with variants (standard, low-fat, high-fat) and component pairings
- Yield calibration with variance analytics
- Substitution engine with approval workflow
- Printable pull lists, daily summaries, and batch prep sheets

### Delivery Operations
- Fulfillment order generation from scheduled meals
- Packing station with per-item controls
- Multi-stop route planning with drag reorder
- Route dispatch with bulk status updates
- Printable packing slips, delivery manifests, and route sheets
- Dual delivery addresses per client (home + work)

---

## Testing

**856+ tests** across the monorepo, run with Vitest:

```bash
npm test                                    # all workspaces
npm run -w services/nutrition-engine test   # nutrition-engine only
```

The nutrition engine alone has **743 tests** across 18 test suites covering:
- 151 core engine tests (label computation, yield correction, nutrient aggregation)
- 53 scientific QA tests (yield factors, unit conversion, FDA rounding, Atwater validation, hierarchy enforcement)
- 47 yield calibration tests
- 30 inventory projection tests
- 25 prep optimizer tests
- 173 metrics engine tests
- 49 biometrics engine tests
- 24 composition engine tests
- 23 sauce nutrient tests (scaling, variants, rounding, allergens)
- 20 reproducibility tests
- 26 mapping score tests
- 20 substitution engine tests
- 20 TDEE engine tests
- And more

---

## Architecture

```
apps/
  api/              Express API + background worker
  web/              Next.js 15 operations UI (30+ routes)
  mobile/           Expo React Native (TestFlight)

services/
  nutrition-engine/ Pure deterministic math (no DB, ESM-only, 743 tests)

packages/
  db/               Prisma schema + PostgreSQL (Neon)
  contracts/        Zod validation schemas
  importers/        SOT, Instacart, pilot meal parsing
```

**Stack:** TypeScript, ESM throughout, Express, Next.js 15, Prisma, PostgreSQL (Neon), Vitest, Zod

---

## Quick Start

```bash
cp .env.example .env        # configure DATABASE_URL
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev:api             # starts API on :4000
```

In another terminal:

```bash
npm run dev:web             # starts web on :3000
```

## Deploy to Render

This repo includes a `render.yaml` blueprint for one-click deploy:

1. In Render, click **New +** > **Blueprint**
2. Connect GitHub repo: `zemo2003/nutrition-autopilot`
3. Render detects 3 services: API, Web, Worker
4. Set required env vars:
   - `nutrition-autopilot-api`: `DATABASE_URL` (Neon Postgres URL)
   - `nutrition-autopilot-web`: `NEXT_PUBLIC_API_BASE` and `API_BASE` (API public URL)
5. Deploy

### Optional Env Vars

| Variable | Service | Purpose |
|---|---|---|
| `NUMEN_API_KEY` | API | Bearer token for ChatGPT GPT Action |
| `GOOGLE_CLIENT_ID` | API + Worker | Gmail OAuth (Instacart auto-import) |
| `GOOGLE_CLIENT_SECRET` | API + Worker | Gmail OAuth |
| `GOOGLE_REDIRECT_URI` | API + Worker | Gmail OAuth callback URL |
| `WEB_PUBLIC_URL` | API | Web app URL for OAuth redirects |

---

## API

100+ versioned REST endpoints under `/v1/`. Key groups:

- **Import** &mdash; SOT workbook, Instacart CSV, pilot backfill, Gmail sync
- **Schedules** &mdash; CRUD, bulk status, label preview
- **Labels** &mdash; Detail, lineage tree, stale detection, refresh
- **Inventory** &mdash; Lots, projections, demand forecast, waste, par levels
- **Batches** &mdash; Production workflow, checkpoints, portions, yield validation
- **Clients** &mdash; Profiles, biometrics, metrics, documents, health summary
- **Verification** &mdash; Task queue, data quality summary
- **Fulfillment** &mdash; Order generation, packing, routing, dispatch
- **ChatGPT** &mdash; OpenAPI spec, client/SKU listing, meal plan push
- **Gmail** &mdash; OAuth flow, sync trigger, connection status

Full OpenAPI spec: `GET /v1/openapi.json`

---

## Core Rules

1. Labels are frozen at serve time from the actual lots consumed &mdash; immutable once created
2. Label lineage is fully auditable with drill-down to source lots, recipes, and ingredients
3. FDA rounding is applied at the final step only to prevent error accumulation
4. Nutrient hierarchy invariants are enforced both pre- and post-rounding
5. Yield correction is automatic when recipe and lot prepared states differ
6. All lot consumption follows FIFO (first expiry, first out)
7. Verification tasks require human resolution &mdash; no silent auto-approval

---

## License

Private repository. All rights reserved.
