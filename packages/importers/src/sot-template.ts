import path from "node:path";
import * as XLSX from "xlsx";

export function createSotTemplate(outputPath = "/Users/daniel/Desktop/Nutrition_Autopilot_SOT.xlsx") {
  const wb = XLSX.utils.book_new();

  const skuRows = [
    ["sku_code", "sku_name", "recipe_name", "servings", "serving_size_g"],
    ["", "", "", "", ""]
  ];
  const recipeRows = [
    [
      "sku_code",
      "recipe_name",
      "line_order",
      "ingredient_key",
      "ingredient_name",
      "grams_per_serving",
      "preparation",
      "required"
    ],
    ["", "", "", "", "", "", "", "TRUE"]
  ];
  const ingredientRows = [
    ["ingredient_key", "ingredient_name", "category", "default_unit", "allergen_tags_pipe_delimited"],
    ["", "", "", "g", ""]
  ];

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(skuRows), "SKU_Master");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(recipeRows), "Recipe_Lines");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ingredientRows), "Ingredient_Catalog");

  XLSX.writeFile(wb, path.resolve(outputPath));
  return outputPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] || "/Users/daniel/Desktop/Nutrition_Autopilot_SOT.xlsx";
  const wrote = createSotTemplate(out);
  console.log(`SOT template written: ${wrote}`);
}
