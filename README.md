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

## GitHub + DB + TestFlight

See `/Users/daniel/Desktop/nutrition-autopilot/docs/LAUNCH_SETUP.md`.
