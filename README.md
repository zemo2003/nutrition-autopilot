# Nutrition Autopilot

Blank-slate, database-first nutrition operations platform with deterministic label traceability.

## Workspace Layout

- `apps/web` - Next.js operations UI
- `apps/api` - Versioned HTTP API + orchestration + worker
- `apps/mobile` - Expo React Native app (TestFlight target)
- `services/nutrition-engine` - Deterministic FDA and nutrient math engine
- `packages/db` - Prisma schema, migrations, seed, DB client
- `packages/contracts` - Shared Zod contracts and DTOs
- `packages/importers` - SOT and Instacart ingestion logic

## Quick Start

```bash
cp .env.example .env
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev:api
```

In another terminal:

```bash
npm run dev:web
```

Mobile app:

```bash
npm run dev:mobile
```

SOT template generator:

```bash
npm run sot:template
```

Writes `/Users/daniel/Desktop/Nutrition_Autopilot_SOT.xlsx`.

## API v1

- `POST /v1/imports/sot` (`multipart/form-data`: `file`, `mode=dry-run|commit`)
- `POST /v1/imports/instacart-orders` (`multipart/form-data`: `file`, `mode=dry-run|commit`)
- `POST /v1/pilot/backfill-week` (`multipart/form-data`: `meal_file`, optional `lot_file`, optional `week_start_date`, `purchase_date`, `client_external_ref`, `client_name`, `mode`)
- `POST /v1/instacart/drafts/generate`
- `PATCH /v1/schedule/:id/status`
- `GET /v1/clients/:clientId/calendar?month=YYYY-MM`
- `GET /v1/meals/:serviceEventId`
- `GET /v1/labels/:labelId`
- `GET /v1/labels/:labelId/lineage`
- `GET /v1/verification/tasks`
- `PATCH /v1/verification/tasks/:id`
- `GET /v1/system/state`
- `GET /v1/clients`

## Core Rules

1. Empty-state UI until SOT import committed.
2. Labels are frozen at serve time from consumed lots.
3. Label lineage graph is immutable and drill-down capable.
4. Agent writes are proposal-only; human approval required before mutation.

## Fastest Web-First Pilot Path

1. Start API + web:

```bash
npm run dev:api
npm run dev:web
```

2. Open web upload center:

`http://localhost:3000/upload`

3. Run `Pilot Backfill (Historical Week)` with:

- `meal_file`: `/Users/daniel/Downloads/Alex_Week_Workbook_FullDetail.xlsx`
- `lot_file`: `/Users/daniel/Downloads/Walmart_Receipt_Complete_With_Item_Name.xlsx` (or detailed lot CSV)
- `week_start_date`: `2026-02-16`
- `mode`: `commit`

4. Open served calendar and printable labels:

- `http://localhost:3000/clients/<clientId>/calendar?month=2026-02`
- label detail: `/labels/<labelId>`
- print view: `/labels/<labelId>/print`

## Get It Online (Browser Access Anywhere)

This repo now includes `/Users/daniel/Documents/GitHub/nutrition-autopilot/render.yaml` for Render Blueprint deploy.

### Render Deploy Steps

1. In Render, click **New +** -> **Blueprint**.
2. Connect GitHub repo: `zemo2003/nutrition-autopilot`.
3. Render will detect 2 web services from `render.yaml`:
   - `nutrition-autopilot-api`
   - `nutrition-autopilot-web`
4. Set required env vars before first deploy:
   - On `nutrition-autopilot-api`: `DATABASE_URL` = your Neon Postgres URL.
   - On `nutrition-autopilot-web`: `NEXT_PUBLIC_API_BASE` = the public URL of `nutrition-autopilot-api` (for example `https://nutrition-autopilot-api.onrender.com`).
5. Deploy both services.

After deploy:
- Web app URL: `https://<your-web-service>.onrender.com`
- Upload/backfill page: `https://<your-web-service>.onrender.com/upload`

### Optional: Re-Backfill Pilot Week In Hosted Env

From hosted web upload page, run **Pilot Backfill (Historical Week)** again, or use:

```bash
API_BASE="https://<your-api-service>.onrender.com" npm run pilot:backfill
```

## GitHub + DB + TestFlight

See `/Users/daniel/Desktop/nutrition-autopilot/docs/LAUNCH_SETUP.md`.
