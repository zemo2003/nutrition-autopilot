import path from "node:path";
import XLSX from "xlsx";
import type { IngredientCatalogRow, InstacartOrderRow } from "./types.js";

export type ParseInstacartOrdersOptions = {
  sheetName?: string;
  defaultOrderedAt?: Date;
};

export function parseInstacartOrders(filePath: string, options: ParseInstacartOrdersOptions = {}): InstacartOrderRow[] {
  const workbook = XLSX.readFile(path.resolve(filePath));
  const firstSheetName = options.sheetName && workbook.Sheets[options.sheetName]
    ? options.sheetName
    : workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  return rows
    .map((row) => {
      const productName = pickString(row, ["product_name", "name", "Item Name", "item_name", "product_name"]);
      if (!productName) return null;

      const orderedAtRaw =
        pickString(row, ["ordered_at", "date", "Delivered At", "Delivery Created At", "purchase_date", "ordered_at_local"]) ||
        options.defaultOrderedAt?.toISOString() ||
        new Date().toISOString();
      const orderedAt = parseDateLoose(orderedAtRaw);
      const expiresAtRaw = pickString(row, ["expires_at"]);
      const expiresAt = expiresAtRaw ? parseDateLoose(expiresAtRaw) : null;

      const qty = pickNumber(row, ["qty", "quantity", "Picked Quantity", "Ordered Quantity", "Quantity", "quantity_purchased"], 1);
      const unit = (pickString(row, ["unit", "Cost Unit", "cost_unit", "default_unit"]) || "ea").toLowerCase();
      const gramsPerUnit = resolveGramsPerUnit(row, unit, qty);
      const nutrientSourceType = normalizeSourceType(
        pickString(row, ["nutrient_source_type"])
      );

      return {
        orderedAt,
        productName,
        brand: pickString(row, ["brand", "Brand Name", "brand_name", "brand"]) || null,
        upc: pickString(row, ["upc", "UPC", "Item ID", "item_id"]) || null,
        qty: Number.isFinite(qty) ? qty : 1,
        unit,
        gramsPerUnit: Number.isFinite(gramsPerUnit) ? gramsPerUnit : 1000,
        lotCode: pickString(row, ["lot_code"]) || null,
        expiresAt,
        ingredientKeyHint: pickString(row, ["ingredient_key"]) || null,
        ingredientNameHint: pickString(row, ["ingredient_name_guess"]) || null,
        unitPriceUsd: pickNumberOrNull(row, ["unit_price_usd"]),
        lineTotalUsd: pickNumberOrNull(row, ["line_total_usd", "Line Total ($)", "unit_cost_total"]),
        nutrientSourceTypeHint: nutrientSourceType,
        nutrientSourceRefHint: pickString(row, ["nutrient_source_ref"]) || null,
        nutrientHints: {
          kcal: pickNumberOrNull(row, ["kcal_per_100g"]),
          proteinG: pickNumberOrNull(row, ["protein_g_per_100g"]),
          carbG: pickNumberOrNull(row, ["carb_g_per_100g"]),
          fatG: pickNumberOrNull(row, ["fat_g_per_100g"]),
          sodiumMg: pickNumberOrNull(row, ["sodium_mg_per_100g"])
        }
      } satisfies InstacartOrderRow;
    })
    .filter((x): x is InstacartOrderRow => x !== null);
}

function pickString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value === null || value === undefined) continue;
    const parsed = String(value).trim();
    if (parsed.length > 0) return parsed;
  }
  return "";
}

function pickNumber(row: Record<string, unknown>, keys: string[], fallback: number): number {
  for (const key of keys) {
    const value = row[key];
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(String(value).replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function pickNumberOrNull(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(String(value).replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeSourceType(input: string): "MANUFACTURER" | "USDA" | "MANUAL" | null {
  const normalized = input.trim().toUpperCase();
  if (normalized === "MANUFACTURER" || normalized === "USDA" || normalized === "MANUAL") {
    return normalized;
  }
  return null;
}

function parseDateLoose(input: string): Date {
  const direct = new Date(input);
  if (!Number.isNaN(direct.getTime())) return direct;

  // Instacart exports often use timezone abbreviations (e.g. EST) that can fail in some runtimes.
  const withoutTzAbbrev = input.replace(/\s+[A-Z]{2,5}$/, "");
  const fallback = new Date(withoutTzAbbrev);
  if (!Number.isNaN(fallback.getTime())) return fallback;

  return new Date();
}

function resolveGramsPerUnit(row: Record<string, unknown>, unitRaw: string, qty: number): number {
  const direct = pickNumber(row, ["grams_per_unit", "grams"], Number.NaN);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const normalizedUnit = unitRaw.toLowerCase().trim();
  // Walmart feeds often include dimensions in product names/descriptions.
  const productName = pickString(row, ["product_name", "name", "Item Name", "item_name", "product_name"]);
  const receiptDescription = pickString(row, ["receipt_description", "Receipt Description"]);
  const sizeFromText = parseGramsFromText(`${productName} ${receiptDescription}`);
  if (Number.isFinite(sizeFromText) && sizeFromText > 0) {
    return sizeFromText;
  }

  const weightValue = pickNumber(row, ["Picked Weight", "Ordered Weight", "picked_weight", "ordered_weight"], Number.NaN);
  const weightMultiplier = gramsMultiplierForUnit(normalizedUnit);
  if (Number.isFinite(weightValue) && weightValue > 0 && weightMultiplier && qty > 0) {
    return (weightValue * weightMultiplier) / qty;
  }

  if (weightMultiplier) return weightMultiplier;
  if (normalizedUnit === "each" || normalizedUnit === "ea" || normalizedUnit === "ct") return 100;
  if (normalizedUnit === "fl oz") return 29.5735;
  return 1000;
}

function parseGramsFromText(input: string): number {
  const lower = input.toLowerCase();
  const lb = lower.match(/(\d+(?:\.\d+)?)\s*lb\b/);
  if (lb) {
    const value = Number(lb[1]);
    if (Number.isFinite(value) && value > 0) return value * 453.59237;
  }
  const oz = lower.match(/(\d+(?:\.\d+)?)\s*oz\b/);
  if (oz) {
    const value = Number(oz[1]);
    if (Number.isFinite(value) && value > 0) return value * 28.3495231;
  }
  const gal = lower.match(/(\d+(?:\.\d+)?)\s*gallon\b/);
  if (gal) {
    const value = Number(gal[1]);
    if (Number.isFinite(value) && value > 0) return value * 3785.41;
  }
  return Number.NaN;
}

function gramsMultiplierForUnit(unit: string): number | null {
  switch (unit) {
    case "kg":
      return 1000;
    case "g":
      return 1;
    case "lb":
    case "lbs":
      return 453.59237;
    case "oz":
      return 28.3495231;
    default:
      return null;
  }
}

function normalize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function scoreIngredientMatch(productName: string, ingredient: IngredientCatalogRow): number {
  const p = new Set(normalize(productName));
  const i = new Set(normalize(ingredient.ingredientName));
  const overlap = [...p].filter((x) => i.has(x)).length;
  const denom = Math.max(1, Math.min(p.size, i.size));
  return overlap / denom;
}

export function mapOrderLineToIngredient(
  productName: string,
  ingredients: IngredientCatalogRow[]
): { ingredientKey: string | null; confidence: number } {
  let best: { ingredientKey: string; confidence: number } | null = null;

  for (const ingredient of ingredients) {
    const confidence = scoreIngredientMatch(productName, ingredient);
    if (!best || confidence > best.confidence) {
      best = { ingredientKey: ingredient.ingredientKey, confidence };
    }
  }

  if (!best || best.confidence < 0.85) {
    return { ingredientKey: null, confidence: best?.confidence ?? 0 };
  }

  return best;
}
