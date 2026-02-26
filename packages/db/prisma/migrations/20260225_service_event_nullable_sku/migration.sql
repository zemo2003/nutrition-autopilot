-- AlterTable: make skuId nullable on MealServiceEvent for composition-based meals
ALTER TABLE "MealServiceEvent" ALTER COLUMN "skuId" DROP NOT NULL;
