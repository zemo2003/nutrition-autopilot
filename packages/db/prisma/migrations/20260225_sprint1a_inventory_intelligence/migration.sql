-- Sprint 1A: Inventory Intelligence Foundation
-- Add par level and reorder point fields to IngredientCatalog

ALTER TABLE "IngredientCatalog" ADD COLUMN "parLevelG" DOUBLE PRECISION;
ALTER TABLE "IngredientCatalog" ADD COLUMN "reorderPointG" DOUBLE PRECISION;
