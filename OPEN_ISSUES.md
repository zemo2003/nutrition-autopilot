# Open Issues — Sprint 2

## P0: Must Fix Before Production

### OI-1: Component seed data ✅ RESOLVED
Seeded 19 components (5 proteins, 5 carb bases, 5 vegetables, 2 sauces, 2 condiments) with 56 ingredient lines.

### OI-2: Client profile empty state
The `clients/profile` page auto-selects the first client. If no clients exist, loading spinner runs forever.
**Action:** Add empty-state fallback in client-profile.tsx.

### OI-11: Quality gate blocking Fed/Skip ✅ RESOLVED
Label freeze strict mode was rejecting imported lots with incomplete core nutrients, blocking all Fed/Skip operations.
**Fix:** Relaxed strict gate to only block synthetic lots and historical exceptions. Incomplete nutrients flagged as INCOMPLETE_CORE_NUTRIENTS and label marked provisional.

## P1: Should Fix Soon

### OI-3: Batch prep — no lot consumption tracking
Batches advance through status but don't deduct from inventory lots. The `BatchLotConsumption` model exists but lot selection isn't wired up during batch operations.
**Action:** Add lot selection UI during batch creation/advancement.

### OI-4: Inventory alerts thresholds hardcoded
Low stock threshold (100g) and expiry horizon (3 days) should be configurable.

### OI-5: Body composition + file records stored as JSON
Works for MVP but limits querying. Consider normalized tables when data grows.

### OI-6: No file upload for client records
File records form captures metadata but doesn't upload files. Needs S3/R2 integration.

### OI-12: Sauce variant macros not linked to nutrient engine
SauceVariant stores macros (kcal/protein/carb/fat per 100g) for display but these aren't integrated into the label computation pipeline. When a sauce variant is selected for a meal, the nutrient engine still uses the ingredient-level data from ComponentLines, not the variant-level overrides.
**Action:** Wire variant macros into label computation when variant is selected.

### OI-13: Timer persistence across browser sessions
Kitchen Mode timers are JS intervals — refreshing the page resets the visual timer. The checkpoint timestamps in the DB are the source of truth, but elapsed time display doesn't recover from them on page reload.
**Action:** On mount, calculate elapsed from last checkpoint timestamp.

### OI-14: Batch checkpoint validation
No validation that checkpoints occur in the correct order (e.g., COOK_START before COOK_END). The API accepts any checkpoint type regardless of batch status.
**Action:** Add state machine validation for checkpoint ordering.

## P2: Nice To Have

### OI-7: Batch code generation
Auto-generate codes like `PROTEIN-20260225-001`.

### OI-8: Component library management UI
Create/update/delete components. Partially addressed by sauce board for SAUCE/CONDIMENT types.

### OI-9: Sauce flavor profiles ✅ RESOLVED
Flavor profile pills now displayed in sauce board UI with color coding.

### OI-10: Inventory adjustments lack undo

### OI-15: Sauce portion selector in meal composition
The sauce board manages variants and pairings, but there's no inline portion selector when composing meals. Would allow chefs to pick sauce + portion during scheduling.

### OI-16: Print views need barcode/QR support
Batch sheets and labels would benefit from scannable codes for tracking.
