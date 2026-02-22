import path from "node:path";
import XLSX from "xlsx";
import type { PilotMealRow, ValidationError } from "./types.js";

const dayOffsetByLabel: Record<string, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6
};

export type ParsePilotMealsOptions = {
  sheetName?: string;
  weekStartDate?: string;
  defaultClientExternalRef?: string;
  defaultClientName?: string;
};

export type ParsePilotMealsResult = {
  rows: PilotMealRow[];
  errors: ValidationError[];
};

export function parsePilotMeals(filePath: string, options: ParsePilotMealsOptions = {}): ParsePilotMealsResult {
  const errors: ValidationError[] = [];
  const workbook = XLSX.readFile(path.resolve(filePath));
  const sheetName = resolveMealSheetName(workbook, options.sheetName);
  if (!sheetName) {
    return {
      rows: [],
      errors: [
        {
          sheet: options.sheetName ?? "unknown",
          rowNumber: null,
          code: "MISSING_SHEET",
          message: "Could not locate a meal sheet. Expected Ingredient_Log_SKU or detailed meal CSV headers."
        }
      ]
    };
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return {
      rows: [],
      errors: [{ sheet: sheetName, rowNumber: null, code: "MISSING_SHEET", message: "Sheet not found in workbook." }]
    };
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  if (!rawRows.length) {
    return {
      rows: [],
      errors: [{ sheet: sheetName, rowNumber: null, code: "EMPTY_SHEET", message: "Meal sheet has no rows." }]
    };
  }

  const weekStart = options.weekStartDate ? parseDateInput(options.weekStartDate) : null;
  if (options.weekStartDate && !weekStart) {
    errors.push({
      sheet: sheetName,
      rowNumber: null,
      code: "INVALID_WEEK_START_DATE",
      message: `weekStartDate must be YYYY-MM-DD. Received: ${options.weekStartDate}`
    });
  }

  const rows: PilotMealRow[] = [];
  const servingByMealKey = new Map<string, number>();
  const lineOrderByMealKey = new Map<string, number>();
  let generatedRowId = 0;

  for (let index = 0; index < rawRows.length; index += 1) {
    const row = rawRows[index] ?? {};
    const rowNumber = index + 2;
    const ingredientName = pickString(row, ["ingredient_name", "Ingredient", "ingredient"]);
    if (!ingredientName) continue;

    const dayLabel = pickString(row, ["source_day_label", "Day", "day"]) || null;
    const serviceDateRaw = pickString(row, ["service_date", "serviceDate", "Service Date"]);
    const serviceDate = resolveServiceDate(serviceDateRaw, dayLabel, weekStart);
    if (!serviceDate) {
      errors.push({
        sheet: sheetName,
        rowNumber,
        code: "INVALID_SERVICE_DATE",
        message: "Unable to resolve service date. Provide service_date column or valid weekStartDate + day label."
      });
      continue;
    }

    const clientExternalRef =
      pickString(row, ["client_external_ref", "clientExternalRef"]) ||
      options.defaultClientExternalRef ||
      "CLIENT-001";
    const clientName = pickString(row, ["client_name", "clientName"]) || options.defaultClientName || "Client";

    const mealSlotInput = pickString(row, ["meal_slot", "Meal", "meal"]);
    const mealSlot = normalizeMealSlot(mealSlotInput);
    if (!mealSlot) {
      errors.push({
        sheet: sheetName,
        rowNumber,
        code: "INVALID_MEAL_SLOT",
        message: "Meal slot is required."
      });
      continue;
    }

    const sourceSkuCode = pickString(row, ["sku_code", "SKU", "sku"]);
    const skuCode = sourceSkuCode && sourceSkuCode.toUpperCase().startsWith("SKU-")
      ? sourceSkuCode.toUpperCase()
      : buildDateScopedSkuCode(clientExternalRef, serviceDate, mealSlot);
    const skuName = pickString(row, ["sku_name"]) || `${clientName} ${humanizeMealSlot(mealSlot)}`;
    const recipeName = pickString(row, ["recipe_name", "Dish", "dish"]) || `${skuCode} Recipe`;
    const plannedServings = pickNumber(row, ["planned_servings", "servings"], 1);
    const servingSizeG = pickNumber(row, ["serving_size_g"], Number.NaN);

    const mealKey = `${clientExternalRef}|${toDateKey(serviceDate)}|${mealSlot}|${skuCode}`;
    const lineOrderFromSource = pickNumber(row, ["line_order"], Number.NaN);
    const nextLineOrder = (lineOrderByMealKey.get(mealKey) ?? 0) + 1;
    const lineOrder = Number.isFinite(lineOrderFromSource) && lineOrderFromSource > 0
      ? Math.floor(lineOrderFromSource)
      : nextLineOrder;
    lineOrderByMealKey.set(mealKey, Math.max(nextLineOrder, lineOrder));

    const gramsPerServing = pickNumber(row, ["grams_per_serving", "Qty_g", "qty_g"], Number.NaN);
    if (!Number.isFinite(gramsPerServing) || gramsPerServing <= 0) {
      errors.push({
        sheet: sheetName,
        rowNumber,
        code: "INVALID_GRAMS_PER_SERVING",
        message: "grams_per_serving/Qty_g must be a positive number."
      });
      continue;
    }

    const ingredientKey = normalizeIngredientKey(
      pickString(row, ["ingredient_key", "ingredientKey"]) || ingredientName
    );
    const allergenTags = normalizeAllergenTags(
      pickString(row, ["allergen_tags_pipe_delimited", "allergen_tags"]) ||
        inferAllergensFromIngredient(ingredientName)
    );
    const ingredientCategory =
      pickString(row, ["ingredient_category", "category"]) || inferIngredientCategory(ingredientName);
    const defaultUnit = (pickString(row, ["default_unit"]) || "g").toLowerCase();

    const notes = pickString(row, ["review_notes", "Notes", "notes"]) || null;
    const needsReview = toBool(row["needs_review"], false) || inferNeedsReviewFromNotes(notes);

    generatedRowId += 1;
    rows.push({
      mealRowId: pickNumber(row, ["meal_row_id"], generatedRowId),
      clientExternalRef,
      clientName,
      serviceDate,
      mealSlot,
      skuCode,
      skuName,
      recipeName,
      plannedServings: Number.isFinite(plannedServings) && plannedServings > 0 ? plannedServings : 1,
      servingSizeG: Number.isFinite(servingSizeG) && servingSizeG > 0 ? servingSizeG : -1,
      lineOrder,
      ingredientKey,
      ingredientName,
      gramsPerServing,
      preparation: normalizePreparation(
        pickString(row, ["preparation", "Raw/Cooked", "raw_cooked"]) || null
      ),
      required: toBool(row["required"], true),
      allergenTags,
      ingredientCategory,
      defaultUnit,
      sourceDayLabel: dayLabel,
      needsReview,
      reviewNotes: notes
    });

    servingByMealKey.set(mealKey, (servingByMealKey.get(mealKey) ?? 0) + gramsPerServing);
  }

  const finalizedRows = rows.map((row) => {
    if (row.servingSizeG > 0) return row;
    const mealKey = `${row.clientExternalRef}|${toDateKey(row.serviceDate)}|${row.mealSlot}|${row.skuCode}`;
    return {
      ...row,
      servingSizeG: servingByMealKey.get(mealKey) ?? row.gramsPerServing
    };
  });

  return { rows: finalizedRows, errors };
}

function resolveMealSheetName(workbook: XLSX.WorkBook, requestedSheetName?: string): string | null {
  if (requestedSheetName && workbook.Sheets[requestedSheetName]) {
    return requestedSheetName;
  }
  if (workbook.Sheets["Ingredient_Log_SKU"]) {
    return "Ingredient_Log_SKU";
  }

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    const first = rows[0];
    if (!first) continue;
    const keys = Object.keys(first).map((x) => x.toLowerCase());
    const hasMealShape = keys.includes("ingredient_name") || (keys.includes("day") && keys.includes("ingredient"));
    if (hasMealShape) return sheetName;
  }

  return workbook.SheetNames[0] ?? null;
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

function toBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "y", "1"].includes(normalized)) return true;
    if (["false", "no", "n", "0"].includes(normalized)) return false;
  }
  return fallback;
}

function parseDateInput(input: string): Date | null {
  const trimmed = input.trim();
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoDate) {
    const year = Number(isoDate[1]);
    const month = Number(isoDate[2]);
    const day = Number(isoDate[3]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 12, 0, 0, 0));
}

function resolveServiceDate(serviceDateRaw: string, dayLabel: string | null, weekStart: Date | null): Date | null {
  if (serviceDateRaw) {
    return parseDateInput(serviceDateRaw);
  }
  if (!dayLabel || !weekStart) return null;
  const offset = dayOffsetByLabel[dayLabel.trim().toLowerCase()];
  if (typeof offset !== "number") return null;
  return addDaysUtc(weekStart, offset);
}

function addDaysUtc(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function toDateKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeMealSlot(input: string): string {
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (!normalized) return "";
  if (normalized === "pre") return "PRE_TRAINING";
  if (normalized === "post") return "POST_TRAINING";
  if (normalized === "pre_bed" || normalized === "prebed") return "PRE_BED";
  return normalized.toUpperCase();
}

function humanizeMealSlot(mealSlot: string): string {
  return mealSlot
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeIngredientKey(input: string): string {
  const token = input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return token.startsWith("ING-") ? token : `ING-${token}`;
}

function buildDateScopedSkuCode(clientExternalRef: string, serviceDate: Date, mealSlot: string): string {
  const clientToken = clientExternalRef
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const compactDate = toDateKey(serviceDate).replace(/-/g, "");
  return `SKU-${clientToken}-${compactDate}-${mealSlot}`;
}

function normalizeAllergenTags(input: string): string[] {
  if (!input) return [];
  const tags = input
    .split(/[|,]/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .map((token) => {
      if (token === "dairy") return "milk";
      if (token === "gluten") return "wheat";
      if (token === "nuts") return "tree_nuts";
      if (token === "nut") return "tree_nuts";
      if (token === "peanut") return "peanuts";
      return token.replace(/\s+/g, "_");
    });
  return [...new Set(tags)];
}

function inferAllergensFromIngredient(ingredientName: string): string {
  const lower = ingredientName.toLowerCase();
  const inferred: string[] = [];
  if (/\b(yogurt|whey|milk|butter|cottage cheese|cheese)\b/.test(lower)) inferred.push("milk");
  if (/\begg/.test(lower)) inferred.push("egg");
  if (/\b(cod|fish|tuna)\b/.test(lower)) inferred.push("fish");
  if (/\b(peanut|peanuts)\b/.test(lower)) inferred.push("peanuts");
  if (/\b(almond|walnut|cashew|pistachio|tree nut|nuts)\b/.test(lower)) inferred.push("tree_nuts");
  if (/\b(soy|tofu)\b/.test(lower)) inferred.push("soy");
  if (/\b(bagel|bread|pasta|penne|oat|granola|tortilla|wheat)\b/.test(lower)) inferred.push("wheat");
  return inferred.join("|");
}

function inferIngredientCategory(ingredientName: string): string {
  const lower = ingredientName.toLowerCase();
  if (/\b(oil|butter|avocado|almond|peanut butter)\b/.test(lower)) return "FAT";
  if (/\b(chicken|beef|turkey|cod|fish|tuna|whey|egg)\b/.test(lower)) return "PROTEIN";
  if (/\b(berry|banana|cherr|fruit|raisin)\b/.test(lower)) return "FRUIT";
  if (/\b(pepper|onion|spinach|beet|carrot|potato|vegetable|greens)\b/.test(lower)) return "VEGETABLE";
  if (/\b(honey|salt|pepper|cinnamon|vanilla|lemon|jam|sauce|paste)\b/.test(lower)) return "CONDIMENT";
  if (/\b(rice|oat|pasta|penne|bagel|bread|granola|beans)\b/.test(lower)) return "CARB";
  return "UNMAPPED";
}

function normalizePreparation(input: string | null): string | null {
  if (!input) return null;
  const normalized = input.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return normalized || null;
}

function inferNeedsReviewFromNotes(notes: string | null): boolean {
  if (!notes) return false;
  return /approx|estimate|to taste|~|unknown|from plan|user-specified/i.test(notes);
}
