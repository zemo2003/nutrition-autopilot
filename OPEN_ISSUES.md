# Open Issues — Kitchen Ops MVP

## P0: Must Fix Before Production

### OI-1: No component seed data
The Components table is empty. The batch prep UI requires at least one component to create batches.
**Action:** Add seed data via a script or the SOT importer extension to populate PROTEIN, CARB_BASE, VEGETABLE, SAUCE components with their ingredient lines.

### OI-2: Client profile GET /clients/:clientId conflicts with calendar route
The existing `GET /clients/:clientId/calendar` route works, but the new `GET /clients/:clientId` for profile data was not previously exposed. The `clients/profile` page auto-selects the first client — if no clients exist, it shows a loading state forever.
**Action:** Add an empty-state fallback in client-profile.tsx.

## P1: Should Fix Soon

### OI-3: Batch prep — no lot consumption tracking
Batches can advance through status but don't actually deduct from inventory lots. The `BatchLotConsumption` model exists but the API doesn't wire up lot selection during batch creation or advancement.
**Action:** Add `POST /v1/batches/:batchId/consume` endpoint and UI for selecting which lots feed each batch.

### OI-4: Inventory alerts thresholds are hardcoded
Low stock threshold is 100g and expiry horizon is 3 days. These should be configurable per-component or per-organization.
**Action:** Add org-level or component-level alert config.

### OI-5: Body composition + file records stored as JSON
The `bodyCompositionSnapshots` and `fileRecords` fields on Client are JSONB columns rather than normalized tables. This works for MVP but limits querying (can't filter/sort by body fat %, can't paginate file records).
**Action:** Consider migrating to proper `BodyCompositionSnapshot` and `FileRecord` tables when the data grows.

### OI-6: No file upload for client records
The file records form captures metadata (fileName, type, notes) but doesn't actually upload files. Needs integration with S3/R2 or similar blob storage.
**Action:** Add file upload endpoint and update the UI.

## P2: Nice To Have

### OI-7: Batch code generation
Batch codes are nullable and never auto-generated. A good pattern would be `{COMPONENT_TYPE}-{DATE}-{SEQ}` (e.g., `PROTEIN-20260225-001`).

### OI-8: Component library management UI
Components can only be queried (GET /components) — there's no create/update/delete UI. Need a components admin page.

### OI-9: Sauce system flavor profiles
The `FlavorProfile` enum and `flavorProfiles` array on Component are schema-ready but not exposed in any UI.

### OI-10: Inventory adjustments lack undo
Once an adjustment is posted, there's no way to reverse it except creating a counter-adjustment.
