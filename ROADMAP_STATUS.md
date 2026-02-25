# ROADMAP_STATUS

## Current Sprint

**Sprint 1A** — Inventory Intelligence Foundation + OI-3 Lot Consumption Wiring

## Status

`gate_pending` — code complete, deploy verification needed

## Last Completed Gate

| Sprint | Result | Timestamp |
|--------|--------|-----------|
| Pre-roadmap (Kitchen Ops MVP) | gated_pass | 2026-02-25 |
| Pre-roadmap (Kitchen Exec + Sauce) | gated_pass | 2026-02-25 |

## Blockers

None currently identified.

## Next Action

Deploy to Render and run smoke test to close Sprint 1A gate.

## Latest Deploy Verification

| Field | Value |
|-------|-------|
| Required for current sprint | yes |
| Deploy status | not_run |
| Environment | production (Render) |
| Deploy timestamp | — |
| Smoke test summary | — |

## Sprint 1A Deliverables

- [x] Schema: `parLevelG`, `reorderPointG` on IngredientCatalog (migration applied)
- [x] OI-3: Batch lot consumption wiring (FIFO, idempotent, ledger entries)
- [x] Inventory projection engine (`inventory-projections.ts`)
- [x] API: GET /v1/inventory/projections
- [x] API: GET /v1/inventory/demand-forecast
- [x] API: GET /v1/inventory/waste-summary
- [x] API: GET /v1/inventory/allocation
- [x] API: PATCH /v1/inventory/par-levels
- [x] UI: Full inventory intelligence dashboard (inventory-board.tsx)
- [x] 220 tests passing (30 new inventory projection tests)
- [x] Typecheck: clean (API + Web)
- [x] Lint: clean
- [x] Web build: clean (17 routes)
- [ ] Deploy smoke test

## Sprint History

| Sprint | Status | Gate | Notes |
|--------|--------|------|-------|
| Sprint 1A | gate_pending | — | Code complete, awaiting deploy |
| Sprint 1B | not_started | — | Blocked on 1A |
| Sprint 2 | not_started | — | |
| Sprint 3 | not_started | — | |
| Sprint 4 | not_started | — | |
| Sprint 5 | not_started | — | |
