# USDA Fallback Data Package

This package provides comprehensive USDA FoodData Central nutritional data for common meal prep ingredients. It serves as a fallback data source for the nutrition autopilot system.

## Structure

- **usda-fallbacks.json**: Complete USDA-sourced nutritional data per 100g for 60+ ingredients
- **index.ts**: TypeScript loader module with utility functions

## Data Format

The JSON structure contains metadata and ingredient entries:

```json
{
  "meta": {
    "source": "USDA FoodData Central - SR Legacy & Foundation Foods",
    "generatedAt": "2026-02-23",
    "nutrientsPer": "100g",
    "version": 1
  },
  "ingredients": {
    "ING-EGGS-WHOLE": {
      "fdcId": 171287,
      "description": "Egg, whole, raw, fresh",
      "dataType": "SR Legacy",
      "category": "EGGS",
      "nutrients": {
        "kcal": 143,
        "protein_g": 12.56,
        "carb_g": 0.72,
        ...all 40 nutrient keys
      }
    }
  }
}
```

## 40 Nutrient Keys

All ingredients include data for these 40 nutrients (per 100g):

- **Macronutrients**: kcal, protein_g, carb_g, fat_g, fiber_g, sugars_g, added_sugars_g
- **Fats**: sat_fat_g, trans_fat_g, omega3_g, omega6_g
- **Minerals**: sodium_mg, calcium_mg, iron_mg, potassium_mg, magnesium_mg, zinc_mg, phosphorus_mg, iodine_mcg, copper_mg, manganese_mg, chromium_mcg, molybdenum_mcg, selenium_mcg, chloride_mg
- **Vitamins**: vitamin_d_mcg, vitamin_a_mcg, vitamin_c_mg, vitamin_e_mg, vitamin_k_mcg, thiamin_mg, riboflavin_mg, niacin_mg, vitamin_b6_mg, folate_mcg, vitamin_b12_mcg, biotin_mcg, pantothenic_acid_mg, choline_mg
- **Other**: cholesterol_mg

## Ingredient Categories

Data includes:
- **Proteins** (13): eggs, poultry, beef, fish, shellfish, tofu
- **Dairy** (5): cottage cheese, Greek yogurt, milk, cheeses
- **Grains** (8): oats, rice, pasta, bread, bagel, quinoa
- **Legumes** (4): kidney beans, black beans, chickpeas, lentils
- **Vegetables** (8): broccoli, spinach, sweet potato, tomato, cucumber, peppers, kale, carrots
- **Fruits** (5): banana, blueberry, apple, avocado, strawberry
- **Nuts/Seeds** (5): peanut butter, almonds, walnuts, chia seeds, flax seeds
- **Fats/Oils** (3): olive oil, coconut oil, butter
- **Other** (2): honey, granola, sports drinks

## API

### `getFallbackNutrients(ingredientKey: string)`
Returns partial nutrient record for an ingredient key, or null if not found.

```typescript
const nutrients = getFallbackNutrients("ING-EGGS-WHOLE");
// { kcal: 143, protein_g: 12.56, ... }
```

### `getFallbackEntry(ingredientKey: string)`
Returns the complete entry with FDC ID, description, data type, category, and nutrients.

```typescript
const entry = getFallbackEntry("ING-CHICKEN-BREAST-COOKED");
// { fdcId: 171534, description: "...", dataType: "SR Legacy", category: "POULTRY", nutrients: {...} }
```

### `getAllFallbackKeys()`
Returns array of all available ingredient keys.

```typescript
const keys = getAllFallbackKeys();
// ["ING-EGGS-WHOLE", "ING-EGG-WHITES", ...]
```

### `usdaFallbackData`
Direct access to the full USDA data object.

## Data Sources

All values are sourced from:
- **USDA FoodData Central** (https://fdc.nal.usda.gov/)
- **SR Legacy Database**: Standard reference nutrient data
- **Foundation Foods Database**: Newer standardized food definitions

Values represent nutritional content per 100g of food. For cooked foods, measurements are post-cooking. For dry goods, values are before preparation.

## Usage Example

```typescript
import { getFallbackNutrients, getAllFallbackKeys } from "@nutrition/data";

// Get nutrients for a specific ingredient
const eggNutrients = getFallbackNutrients("ING-EGGS-WHOLE");
if (eggNutrients) {
  console.log(`Eggs have ${eggNutrients.kcal} kcal per 100g`);
}

// List all available ingredients
const available = getAllFallbackKeys();
console.log(`${available.length} ingredients available`);
```

## Integration with Autofill Worker

The `apps/api/src/worker/nutrient-autofill.ts` worker can now be updated to use this data package instead of the hardcoded fallback map:

```typescript
import { getFallbackNutrients } from "@nutrition/data";

// In resolveNutrients() function:
const fallback = getFallbackNutrients(product.ingredient.canonicalKey);
```

## Data Accuracy & Limitations

- All values are accurate per USDA FoodData Central as of 2026-02-23
- For nutrients not naturally present in foods (e.g., cholesterol in vegetables), values are 0
- Some trace nutrients may be listed as 0 when USDA data is not available
- Values are per 100g and should be scaled for portion sizes
- Cooked vs. raw ingredients have separate entries to reflect cooking water absorption/concentration

## Version History

- **v1** (2026-02-23): Initial comprehensive dataset with 60+ common meal prep ingredients covering all 40 nutrients
