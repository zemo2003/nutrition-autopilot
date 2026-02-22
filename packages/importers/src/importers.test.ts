import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";
import { mapOrderLineToIngredient, parseInstacartOrders } from "./instacart-importer.js";
import { parsePilotMeals } from "./pilot-meals-importer.js";

describe("mapOrderLineToIngredient", () => {
  it("returns best ingredient with confidence", () => {
    const result = mapOrderLineToIngredient("Good Culture Cottage Cheese", [
      {
        ingredientKey: "cottage_cheese",
        ingredientName: "Cottage Cheese",
        category: "dairy",
        defaultUnit: "g",
        allergenTags: ["milk"]
      },
      {
        ingredientKey: "broccoli",
        ingredientName: "Broccoli",
        category: "vegetable",
        defaultUnit: "g",
        allergenTags: []
      }
    ]);

    expect(result.ingredientKey).toBe("cottage_cheese");
    expect(result.confidence).toBeGreaterThan(0.85);
  });
});

describe("parseInstacartOrders", () => {
  it("parses walmart-style lot csv fields", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "na-importers-"));
    const file = path.join(dir, "lots.xlsx");
    const wb = XLSX.utils.book_new();
    const rows = [
      [
        "purchase_date",
        "product_name",
        "upc",
        "quantity_purchased",
        "default_unit",
        "grams_per_unit",
        "ingredient_key",
        "lot_code",
        "unit_price_usd",
        "line_total_usd",
        "nutrient_source_type",
        "nutrient_source_ref",
        "kcal_per_100g",
        "protein_g_per_100g",
        "carb_g_per_100g",
        "fat_g_per_100g",
        "sodium_mg_per_100g"
      ],
      [
        "2026-02-15",
        "Greek Yogurt",
        "007835431151",
        "3",
        "ea",
        "170",
        "ING-GREEK-YOGURT-NONFAT",
        "LOT-20260215-004",
        "4.72",
        "14.16",
        "MANUFACTURER",
        "label",
        "59",
        "10.3",
        "3.6",
        "0.4",
        "36"
      ]
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
    XLSX.writeFile(wb, file);

    const parsed = parseInstacartOrders(file);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.ingredientKeyHint).toBe("ING-GREEK-YOGURT-NONFAT");
    expect(parsed[0]?.lotCode).toBe("LOT-20260215-004");
    expect(parsed[0]?.nutrientHints.kcal).toBe(59);
    expect(parsed[0]?.unitPriceUsd).toBe(4.72);
  });
});

describe("parsePilotMeals", () => {
  it("parses Ingredient_Log_SKU workbook format into date-scoped meal rows", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "na-pilot-meals-"));
    const file = path.join(dir, "pilot-week.xlsx");
    const wb = XLSX.utils.book_new();
    const rows = [
      ["Day", "Meal", "SKU", "Dish", "Ingredient", "Qty_g", "Raw/Cooked", "Notes"],
      ["Monday", "Breakfast", "BF-OATYOG", "Oats + Yogurt", "Greek yogurt, nonfat", 140, "Raw", ""],
      ["Monday", "Breakfast", "BF-OATYOG", "Oats + Yogurt", "Rolled oats, dry", 90, "Raw", ""],
      ["Monday", "Breakfast", "BF-OATYOG", "Oats + Yogurt", "Honey", 10, "Raw", "Approx"]
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Ingredient_Log_SKU");
    XLSX.writeFile(wb, file);

    const parsed = parsePilotMeals(file, {
      weekStartDate: "2026-02-16",
      defaultClientExternalRef: "ALEX-001",
      defaultClientName: "Alex"
    });

    expect(parsed.errors).toHaveLength(0);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0]?.serviceDate.toISOString().slice(0, 10)).toBe("2026-02-16");
    expect(parsed.rows[0]?.skuCode).toBe("SKU-ALEX-001-20260216-BREAKFAST");
    expect(parsed.rows[0]?.servingSizeG).toBe(240);
    expect(parsed.rows[2]?.needsReview).toBe(true);
  });
});
