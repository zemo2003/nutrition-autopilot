# ROADMAP_STATUS

## Current Sprint

**Complete** — All 5 sprints delivered, deployed, and hardening audit passed

## Status

`production-ready`

## Last Completed Gate

| Sprint | Result | Timestamp |
|--------|--------|-----------|
| Pre-roadmap (Kitchen Ops MVP) | gated_pass | 2026-02-25 |
| Pre-roadmap (Kitchen Exec + Sauce) | gated_pass | 2026-02-25 |
| Sprint 1A | gated_pass | 2026-02-25T18:00Z |
| Sprint 1B | gated_pass | 2026-02-25T18:55Z |
| Sprint 2 | gated_pass | 2026-02-25T20:10Z |
| Sprint 3 | gated_pass | 2026-02-25T20:55Z |
| Sprint 4 | gated_pass | 2026-02-25T21:30Z |
| Sprint 5 | gated_pass | 2026-02-25T22:00Z |
| Hardening Audit | gated_pass | 2026-02-26T23:35Z |

## Blockers

None.

## Next Action

System hardened and audit-verified. Ready for new feature development.

## Hardening Audit (2026-02-26)

### Phase 1: Critical Safety Fixes
- [x] **Race conditions closed**: Batch lot consumption + inventory adjust now use Serializable isolation transactions
- [x] **Post-rounding hierarchy enforcement**: sugars <= carbs, addedSugars <= sugars, fiber <= carbs, satFat + transFat <= totalFat (pre-rounding AND post-rounding)
- [x] **Zod input validation**: 18 request body schemas added to contracts, applied to 11+ mutation endpoints via `validateBody()` helper
- [x] **Pre-rounding hierarchy call**: `enforceNutrientHierarchy()` was defined but never called in `computeSkuLabel` - now invoked

### Phase 2: Calculation Verification
- [x] **29 new engine tests**: post-rounding hierarchy enforcement (5), Atwater factor consistency with known USDA foods (8), FDA rounding boundary edge cases (14), yield factor edge cases (3)
- [x] **Known food verification**: egg, rice, salmon, sweet potato, olive oil verified against USDA published values
- [x] **QA fix**: QA comparison now uses original (uncorrected) kcal to correctly flag calorie mismatches

### Phase 3: Schema & Data Integrity
- [x] **3 database indexes added**: BatchLotConsumption.inventoryLotId, LabelSnapshot.(organizationId, frozenAt), LotConsumptionEvent.inventoryLotId
- [x] **Importer hardened**: 50kg sanity cap on gramsPerUnit, negative nutrient rejection, qty > 0 validation
- [x] **Data leak prevention**: Label endpoint now filters by organizationId

### Phase 4: Frontend Reliability
- [x] **11 silent catch blocks replaced** across 6 components with user-facing error banners
- [x] **Error states added** to: batch-prep-board, mapping-board, scientific-qa-board, substitution-board, kitchen-dashboard, documents-board
- [x] **Loading states improved**: documents-board now uses shimmer skeletons instead of plain text
- [x] **Mutation error feedback**: All POST/PATCH handlers now surface API error messages to users

### Phase 5: System Integration
- [x] **65 contract schema tests**: Every Zod schema in contracts validated (accept valid, reject invalid, edge cases)
- [x] **8 integration flow tests**: Multi-ingredient label, allergen aggregation, single-ingredient precision, empty nutrient handling, multi-lot blending, serving size scaling, idempotency, hierarchy consistency
- [x] **API error utility**: `apps/api/src/lib/api-error.ts` with standardized error codes and helper functions

### Test Summary

| Phase | Tests Added | Total After |
|-------|------------|-------------|
| Phase 2 (engine) | +29 | 526 |
| Phase 5 (contracts) | +63 | 589 |
| Phase 5 (engine integration) | +8 | 606 |
| **Final total** | **+100** | **606** |

## Deploy Verification

| Field | Value |
|-------|-------|
| Deploy status | live |
| Environment | production (Render) |
| Deploy timestamp | 2026-02-25T22:30Z |
| API smoke test | 11/11 endpoints 200 |
| Web smoke test | 5/5 pages 200 |
| Note | /v1/schedule requires date params (expected 404 without them) |

## Sprint 5 Deliverables

- [x] Audit trace engine: ingredient lineage, lot consumption, nutrient provenance, QA warnings (18 tests)
- [x] Reproducibility engine: nutrient deltas, delta explanations, integrity checks, recompute diff (20 tests)
- [x] Ops Control Tower engine: data quality / client readiness / reliability scoring, attention queue (19 tests)
- [x] API: 4 new endpoints (audit/meal, audit/label, debug/recompute-diff, control-tower)
- [x] UI: Audit Trace Viewer, Control Tower dashboard, 2 print views
- [x] Nav: Ops Tower link, dashboard Operations section
- [x] 497 tests passing (49 new)
- [x] Typecheck: clean (3/3 workspaces)
- [x] Build: 32 routes (5 new)
- [x] Deploy smoke test: passed

## Sprint 4 Deliverables

- [x] Schema: FileAttachment, BiometricSnapshot, ClientDocument, MetricSeries + 3 enums (migration applied to Neon)
- [x] Biometrics engine: time-series analysis, trend detection, BMI, data quality warnings (34 tests)
- [x] Metrics engine: reference ranges, staleness detection, quality reports, category grouping (27 tests)
- [x] File storage adapter: local filesystem + cloud stub, MIME validation, size checks (28 tests)
- [x] API: 12 new endpoints (biometrics CRUD + summary, documents CRUD + verify, metrics CRUD + status, health-summary)
- [x] UI: Biometrics Timeline + Document Management + Metrics Dashboard (3 new client pages)
- [x] Dashboard: Health Data section with per-client links
- [x] 448 tests passing (89 new)
- [x] Typecheck: clean (3/3 workspaces)
- [x] Build: 27 routes (3 new)
- [x] Deploy smoke test: passed

## Sprint History

| Sprint | Status | Gate | Notes |
|--------|--------|------|-------|
| Sprint 1A | gated_pass | 2026-02-25T18:00Z | Deployed, smoke tested |
| Sprint 1B | gated_pass | 2026-02-25T18:55Z | Deployed, smoke tested |
| Sprint 2 | gated_pass | 2026-02-25T20:10Z | Deployed, smoke tested |
| Sprint 3 | gated_pass | 2026-02-25T20:55Z | Deployed, smoke tested |
| Sprint 4 | gated_pass | 2026-02-25T21:30Z | Deployed, smoke tested |
| Sprint 5 | gated_pass | 2026-02-25T22:00Z | Deployed, smoke tested |
