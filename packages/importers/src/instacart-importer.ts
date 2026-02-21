import path from "node:path";
import * as XLSX from "xlsx";
import type { IngredientCatalogRow, InstacartOrderRow } from "./types.js";

export function parseInstacartOrders(filePath: string): InstacartOrderRow[] {
  const workbook = XLSX.readFile(path.resolve(filePath));
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  return rows
    .map((row) => {
      const productName = String(row.product_name || row.name || "").trim();
      if (!productName) return null;

      const orderedAtRaw = row.ordered_at || row.date || new Date().toISOString();
      const orderedAt = new Date(String(orderedAtRaw));

      const qty = Number(row.qty || row.quantity || 1);
      const unit = String(row.unit || "ea");
      const gramsPerUnit = Number(row.grams_per_unit || row.grams || 1000);

      return {
        orderedAt,
        productName,
        brand: String(row.brand || "").trim() || null,
        upc: String(row.upc || "").trim() || null,
        qty: Number.isFinite(qty) ? qty : 1,
        unit,
        gramsPerUnit: Number.isFinite(gramsPerUnit) ? gramsPerUnit : 1000
      } satisfies InstacartOrderRow;
    })
    .filter((x): x is InstacartOrderRow => x !== null);
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
