# ASSUMPTIONS.md — Kitchen Ops MVP

## Nutrient Science Assumptions

1. **Yield factors are applied at the RecipeLine level**, not at the product level. A yield factor of 0.75 means 100g raw → 75g cooked. Nutrient density per 100g is for the stated `preparedState`.

2. **ProductNutrientValue.valuePer100g** is always in the prepared state matching the product catalog entry. If a product is listed as "raw chicken breast," the nutrients are per 100g raw. The yield factor on the RecipeLine accounts for cooking loss.

3. **Lot consumption is FIFO** — earliest expiry lot is consumed first. This is not nutritionally significant but matters for food safety and inventory accuracy.

4. **Enrichment confidence scores** are not currently used in label computation — all non-rejected nutrient values are treated equally. This is a known simplification.

5. **FDA rounding rules** are applied at the final label level, not at intermediate aggregation steps. This prevents rounding error accumulation.

6. **Component/batch cooking** introduces a new yield factor application point. When a batch is cooked and portioned, the yield factor applies to the batch, and the portion inherits cooked-state nutrients. This is handled by creating "cooked component" nutrient profiles.

7. **Sauces are treated as components** with their own nutrient profiles. A sauce added at portioning time adds its nutrients proportionally to the portion size.

## Inventory Assumptions

8. **quantityAvailableG** on InventoryLot tracks the current usable quantity. It decreases via LotConsumptionEvent (meal service) and InventoryLotLedger (waste, adjustment, batch prep consumption).

9. **Batch prep consumes inventory lots** and creates a new "batch lot" that represents the cooked output. This batch lot can then be consumed by meal service events.

10. **Low-stock alerts** are based on comparing current available quantity against upcoming scheduled demand (72-hour horizon, matching the Instacart draft logic).

## Batch Prep Assumptions

11. **Batch workflow is linear**: PLANNED → IN_PREP → COOKING → CHILLING → PORTIONED → READY. No branching or parallel sub-workflows in MVP.

12. **A batch produces one component type** (e.g., "sous vide chicken breast"). Multiple batches can be created for the same component.

13. **Expected yield** is calculated from sum of raw input weights × yield factor. Actual yield is entered by the chef. Variance = (actual - expected) / expected.

14. **Variance > 15%** triggers a warning. Variance > 30% triggers a critical alert and creates a VerificationTask.

## Client Profile Assumptions

15. **MVP is single-client**, but the schema supports multiple clients. Body composition snapshots are stored as JSON time-series — not parsed or analyzed in MVP.

16. **File records** (DEXA, bloodwork, CGM) store metadata + file path only. No parsing or analysis in MVP.

## Schema Design Assumptions

17. **Components coexist with existing recipes** — a RecipeLine can reference either an IngredientCatalog item or a Component. Components are themselves composed of ingredients with their own recipe-like structure.

18. **Sauces are a subtype of Component** distinguished by a `componentType` field, not a separate model.

19. **BatchProduction** is a new model that tracks the cooking/prep process. It references consumed InventoryLots (input) and produces a new InventoryLot (output).
