# Claude Coworker Handoff: Nutrition Autopilot

Last updated: 2026-02-23
Authoritative repo path: `/Users/daniel/Documents/GitHub/nutrition-autopilot`
Do not use legacy/other clones (for this project, ignore `/Users/daniel/Desktop/nutrition-autopilot` and other stale copies).

## 1) What This Project Is
Nutrition Autopilot is a database-first nutrition operations system.
It supports SOT imports, lot-level inventory, deterministic nutrition labels, lineage drill-down, verification workflows, and historical calendar views.

Core product rule set:
1. Blank/empty state until valid SOT import is committed.
2. Labels freeze from consumed lots at serve time.
3. Every frozen label is immutable and lineage-linked.
4. Historical rescue is allowed, but must be marked provisional/evidence-scored.

## 2) Repo + Git
Git remote:
- `origin`: `https://github.com/zemo2003/nutrition-autopilot.git`

Primary branch:
- `main`

Recent relevant commits:
- `7cb2b24` fix: prevent animal-protein carb inference and mark superseded labels
- `4af8f34` fix(web): render nutrient maps for non-SKU labels
- `d6475b4` chore: add offset batching to served label refresh
- `2f2c060` feat: automate verification sweep and correct served timestamps
- `b6c2f3a` feat: add historical nutrient rebuild and verification workflow

## 3) Platform/Infra

### Neon (Postgres)
- DB provider: Neon Postgres
- Host: `ep-polished-frog-aiuco99k-pooler.c-4.us-east-1.aws.neon.tech`
- DB name: `neondb`
- Region: AWS us-east-1
- SSL: required

Important:
- Full credentials are in local `.env` only.
- Never commit secrets to git.

### Render
Blueprint file:
- `/Users/daniel/Documents/GitHub/nutrition-autopilot/render.yaml`

Services:
1. `nutrition-autopilot-api` (web)
2. `nutrition-autopilot-web` (web)
3. `nutrition-autopilot-worker` (worker)

Critical env vars on Render:
- API: `DATABASE_URL`
- Web: `NEXT_PUBLIC_API_BASE`
- Worker: `DATABASE_URL`

Health endpoint:
- `GET /v1/health`

Known web URL used in pilot:
- `https://nutrition-autopilot-web-u33r.onrender.com`

## 4) Monorepo Layout
- `apps/web` Next.js UI
- `apps/api` Express API + orchestration + worker runtime
- `apps/mobile` Expo app (not current priority)
- `packages/db` Prisma schema + migrations + seed
- `packages/contracts` Zod contracts
- `packages/importers` SOT + Instacart parsing
- `services/nutrition-engine` deterministic nutrient/label math
- `scripts` operational agents and runbooks

## 5) Local Dev Commands
From repo root:

```bash
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev:api
npm run dev:web
```

Type checks:

```bash
npm run -w apps/api typecheck
npm run -w apps/web typecheck
```

## 6) API Surface (v1)
Main routes in `/Users/daniel/Documents/GitHub/nutrition-autopilot/apps/api/src/routes/v1.ts`:
- `GET /v1/health`
- `GET /v1/system/state`
- `GET /v1/clients`
- `POST /v1/imports/sot`
- `POST /v1/imports/instacart-orders`
- `POST /v1/pilot/backfill-week`
- `POST /v1/instacart/drafts/generate`
- `PATCH /v1/schedule/:id/status`
- `GET /v1/clients/:clientId/calendar?month=YYYY-MM`
- `GET /v1/meals/:serviceEventId`
- `GET /v1/labels/:labelId`
- `GET /v1/labels/:labelId/lineage`
- `POST /v1/agents/nutrients/historical-rebuild`
- `POST /v1/labels/refresh-served`
- `GET /v1/quality/summary?month=YYYY-MM`
- `GET /v1/verification/tasks`
- `PATCH /v1/verification/tasks/:id`

## 7) Data Model Anchors (Prisma)
Schema:
- `/Users/daniel/Documents/GitHub/nutrition-autopilot/packages/db/prisma/schema.prisma`

Most relevant tables/models:
- `IngredientCatalog`
- `ProductCatalog`
- `ProductNutrientValue`
- `InventoryLot`
- `MealSchedule`
- `MealServiceEvent`
- `LotConsumptionEvent`
- `LabelSnapshot`
- `LabelLineageEdge`
- `VerificationTask`
- `VerificationReview`

Evidence/provenance enum to use:
- `NutrientEvidenceGrade`

## 8) Agent System: What Exists Now

### A) Python historical/backfill agents
1. `scripts/agent_nutrient_enrichment.py`
- Purpose: Build full 40 nutrient rows with provenance.
- Priority: existing trusted rows -> OpenFoodFacts -> USDA branded -> USDA generic -> similar-product fallback.
- Supports `--dry-run`.

2. `scripts/agent_auto_verify.py`
- Purpose: repair explicit bad trace rows, set verification status, close/approve tasks.
- Supports `--dry-run`.

3. `scripts/agent_refresh_served_labels.py`
- Purpose: regenerate immutable served label snapshots from current nutrient rows.
- Supports pagination with `--limit` and `--offset`.

4. `scripts/agent_correct_served_times.py`
- Purpose: correct historical `servedAt` from schedule date + meal slot.

### B) API worker agent loop
- File: `/Users/daniel/Documents/GitHub/nutrition-autopilot/apps/api/src/worker/index.ts`
- Runs every 60s:
1. `runNutrientAutofillSweep()`
2. consistency task sweep

Worker caveat:
- `apps/api/src/worker/nutrient-autofill.ts` is a pragmatic core-nutrient fallback path.
- Keep this for MVP ops continuity, but do not treat it as gold-standard scientific source.

## 9) Critical Fixes You Must Preserve

### Animal-protein carb/sugar/fiber guardrail
Problem that happened:
- Historical agents filled missing beef/chicken/fish carbs/fiber/sugars from global medians.
- This produced biologically implausible labels.

Fix now in code:
- `scripts/agent_nutrient_enrichment.py`
- `scripts/agent_auto_verify.py`
- Both now enforce zero-carb/fiber/sugars/added sugars for plain animal protein keys when fallback would otherwise infer nonzero values.

### True zero protection
Problem that happened:
- `agent_auto_verify.py` treated near-zero values as “trace” and overwrote them.

Fix now in code:
- verify script only repairs explicit trace/imputation/null patterns, not legitimate zero values.

### Immutable snapshot confusion
Problem that happened:
- Old label links can still show outdated immutable snapshots.

Fix now in code:
- `/v1/labels/:labelId` includes `supersededByLabelId` and `isLatest`.
- Web label and print pages show “Superseded Snapshot” and link to latest corrected snapshot.

## 10) Operational Runbook (Historical Month Repair)
Use this order for month repair (example `2026-02`):

```bash
cd /Users/daniel/Documents/GitHub/nutrition-autopilot
set -a && source .env && set +a

python3 scripts/agent_nutrient_enrichment.py --organization-slug primary --month 2026-02 --historical-mode true
python3 scripts/agent_auto_verify.py --organization-slug primary --month 2026-02 --resolve-non-nutrient true
python3 scripts/agent_refresh_served_labels.py --organization-slug primary --month 2026-02 --only-final-events true
```

Quality checks:

```bash
curl -sS "${NEXT_PUBLIC_API_BASE:-http://localhost:4000}/v1/quality/summary?month=2026-02"
curl -sS "${NEXT_PUBLIC_API_BASE:-http://localhost:4000}/v1/verification/tasks?status=OPEN"
```

## 11) Weekly Operating Path (Going Forward)
Preferred weekly workflow:
1. Build week menu/SKUs and recipe lines into SOT workbook.
2. Import SOT via `/v1/imports/sot`.
3. Import Instacart orders via `/v1/imports/instacart-orders`.
4. Review verification queue.
5. Mark schedule rows `DONE` to freeze labels.
6. Use calendar + label lineage + print pages for delivery and audit.

Historical pilot helper (if needed):
- Script: `/Users/daniel/Documents/GitHub/nutrition-autopilot/scripts/pilot-backfill.sh`
- API endpoint: `POST /v1/pilot/backfill-week`

## 12) Browser UX State To Know
- Dashboard and upload are live and used.
- Calendar route exists and is used for served history.
- Label details now render nutrient data for SKU and non-SKU labels.
- Print view supports provisional labels.

## 13) Safety Rules for Claude
1. Do not commit secrets from `.env`.
2. Do not mutate immutable snapshots directly; regenerate new snapshots.
3. For scientific corrections, update nutrient rows + provenance, then refresh served labels.
4. Never assume old label IDs represent current truth; check `isLatest/supersededByLabelId`.
5. Run typecheck after code changes in API/web.
6. For high-impact changes, use dry-run mode first on agents.

## 14) Fast Troubleshooting

### “Label looks wrong”
1. `GET /v1/labels/:id` and inspect `supersededByLabelId`.
2. Open latest snapshot if superseded.
3. Check product nutrient rows and source refs.
4. Re-run enrichment + refresh pipeline if needed.

### “API Offline” badge in web
1. Verify `NEXT_PUBLIC_API_BASE` on web service.
2. Hit `${API_BASE}/v1/health` directly.
3. Check Render API and worker logs.

### “No nutrient data in label page”
- Ensure label payload has one of: `perServing`, `nutrientsPerServing`, `nutrientsPer100g`, `nutrientsTotal`, or `roundedFda`.

## 15) High-Priority Next Work (for Claude)
1. Raise scientific quality by replacing inferred rows with manufacturer/USDA refs for top consumed products.
2. Add tighter plausibility rules per ingredient class beyond carbs/fiber/sugars.
3. Improve verification UI triage and evidence drill-down.
4. Add automated regression tests for known failure mode (animal-protein nonzero carb fallback).
