# MIGRATION_NOTES.md — Schema Changes for Kitchen Ops MVP

## New Models Added
1. **Component** — Reusable kitchen component (protein, base, vegetable, sauce)
2. **ComponentLine** — Ingredient composition of a component (per 100g output)
3. **BatchProduction** — Tracks batch cooking workflow (planned → ready)
4. **BatchLotConsumption** — Which inventory lots fed into a batch

## Extended Models
1. **Client** — Added: email, phone, heightCm, weightKg, goals, preferences, exclusions, bodyCompositionSnapshots (Json), fileRecords (Json)
2. **InventoryLot** — Added: storageLocation, batchProductionId (links lot to the batch that produced it)

## New Enums
- ComponentType: PROTEIN, CARB_BASE, VEGETABLE, SAUCE, CONDIMENT, OTHER
- BatchStatus: PLANNED, IN_PREP, COOKING, CHILLING, PORTIONED, READY, CANCELLED
- InventoryAdjustmentReason: WASTE, SPOILAGE, CORRECTION, TRANSFER, BATCH_CONSUMPTION, BATCH_OUTPUT, MANUAL
- StorageLocation: FRIDGE, FREEZER, PANTRY, COUNTER
- FlavorProfile: SAVORY, SWEET, SPICY, ACIDIC, UMAMI, NEUTRAL, HERBAL, SMOKY

## Migration Steps (to run on deploy)
```bash
# Generate migration from schema diff
npx prisma migrate dev --name kitchen-ops-mvp --schema packages/db/prisma/schema.prisma

# Or for production:
npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
```

## Data Caveats
- All new models start empty — no data migration needed
- Client extensions are nullable — existing clients unaffected
- InventoryLot.storageLocation defaults to FRIDGE — existing lots get this default
- No existing data is modified or deleted
- All changes are additive (new models + new nullable fields on existing models)

## Backwards Compatibility
- All existing API routes unchanged
- All existing UI pages unchanged
- Import pipeline (SOT, Instacart, enrichment) unaffected
- Label freeze logic unaffected
- Schedule/Fed/Skip flow unaffected
