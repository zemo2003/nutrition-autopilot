#!/usr/bin/env python3
"""
Agent sweep: enrich product nutrient values from public sources (USDA + OpenFoodFacts).

This script is built for rapid pilot cleanup while preserving traceability:
- pulls nutrients per 100g from source APIs
- maps source nutrients to the platform's canonical 40-key dictionary
- upserts ProductNutrientValue rows
- leaves verificationStatus as NEEDS_REVIEW for human sign-off
- writes/updates source retrieval tasks when core macros remain incomplete
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

import psycopg2
import psycopg2.extras
import requests


TARGET_KEYS: List[str] = [
    "kcal",
    "protein_g",
    "carb_g",
    "fat_g",
    "fiber_g",
    "sugars_g",
    "added_sugars_g",
    "sat_fat_g",
    "trans_fat_g",
    "cholesterol_mg",
    "sodium_mg",
    "vitamin_d_mcg",
    "calcium_mg",
    "iron_mg",
    "potassium_mg",
    "vitamin_a_mcg",
    "vitamin_c_mg",
    "vitamin_e_mg",
    "vitamin_k_mcg",
    "thiamin_mg",
    "riboflavin_mg",
    "niacin_mg",
    "vitamin_b6_mg",
    "folate_mcg",
    "vitamin_b12_mcg",
    "biotin_mcg",
    "pantothenic_acid_mg",
    "phosphorus_mg",
    "iodine_mcg",
    "magnesium_mg",
    "zinc_mg",
    "selenium_mcg",
    "copper_mg",
    "manganese_mg",
    "chromium_mcg",
    "molybdenum_mcg",
    "chloride_mg",
    "choline_mg",
    "omega3_g",
    "omega6_g",
]

CORE_KEYS = ["kcal", "protein_g", "carb_g", "fat_g", "sodium_mg"]

TARGET_UNIT_BY_KEY: Dict[str, str] = {
    "kcal": "kcal",
    "protein_g": "g",
    "carb_g": "g",
    "fat_g": "g",
    "fiber_g": "g",
    "sugars_g": "g",
    "added_sugars_g": "g",
    "sat_fat_g": "g",
    "trans_fat_g": "g",
    "cholesterol_mg": "mg",
    "sodium_mg": "mg",
    "vitamin_d_mcg": "mcg",
    "calcium_mg": "mg",
    "iron_mg": "mg",
    "potassium_mg": "mg",
    "vitamin_a_mcg": "mcg",
    "vitamin_c_mg": "mg",
    "vitamin_e_mg": "mg",
    "vitamin_k_mcg": "mcg",
    "thiamin_mg": "mg",
    "riboflavin_mg": "mg",
    "niacin_mg": "mg",
    "vitamin_b6_mg": "mg",
    "folate_mcg": "mcg",
    "vitamin_b12_mcg": "mcg",
    "biotin_mcg": "mcg",
    "pantothenic_acid_mg": "mg",
    "phosphorus_mg": "mg",
    "iodine_mcg": "mcg",
    "magnesium_mg": "mg",
    "zinc_mg": "mg",
    "selenium_mcg": "mcg",
    "copper_mg": "mg",
    "manganese_mg": "mg",
    "chromium_mcg": "mcg",
    "molybdenum_mcg": "mcg",
    "chloride_mg": "mg",
    "choline_mg": "mg",
    "omega3_g": "g",
    "omega6_g": "g",
}


USDA_NAME_TO_KEY: List[Tuple[re.Pattern[str], str]] = [
    (re.compile(r"^protein$"), "protein_g"),
    (re.compile(r"carbohydrate, by difference"), "carb_g"),
    (re.compile(r"total lipid \(fat\)"), "fat_g"),
    (re.compile(r"fiber, total dietary"), "fiber_g"),
    (re.compile(r"sugars, total"), "sugars_g"),
    (re.compile(r"sugars, added"), "added_sugars_g"),
    (re.compile(r"fatty acids, total saturated"), "sat_fat_g"),
    (re.compile(r"fatty acids, total trans"), "trans_fat_g"),
    (re.compile(r"^cholesterol"), "cholesterol_mg"),
    (re.compile(r"^sodium, na"), "sodium_mg"),
    (re.compile(r"vitamin d"), "vitamin_d_mcg"),
    (re.compile(r"^calcium, ca"), "calcium_mg"),
    (re.compile(r"^iron, fe"), "iron_mg"),
    (re.compile(r"^potassium, k"), "potassium_mg"),
    (re.compile(r"vitamin a, rae"), "vitamin_a_mcg"),
    (re.compile(r"vitamin c"), "vitamin_c_mg"),
    (re.compile(r"vitamin e"), "vitamin_e_mg"),
    (re.compile(r"vitamin k"), "vitamin_k_mcg"),
    (re.compile(r"^thiamin"), "thiamin_mg"),
    (re.compile(r"^riboflavin"), "riboflavin_mg"),
    (re.compile(r"^niacin"), "niacin_mg"),
    (re.compile(r"vitamin b-?6"), "vitamin_b6_mg"),
    (re.compile(r"^folate, total"), "folate_mcg"),
    (re.compile(r"vitamin b-?12"), "vitamin_b12_mcg"),
    (re.compile(r"^biotin"), "biotin_mcg"),
    (re.compile(r"pantothenic acid"), "pantothenic_acid_mg"),
    (re.compile(r"^phosphorus, p"), "phosphorus_mg"),
    (re.compile(r"^iodine, i"), "iodine_mcg"),
    (re.compile(r"^magnesium, mg"), "magnesium_mg"),
    (re.compile(r"^zinc, zn"), "zinc_mg"),
    (re.compile(r"^selenium, se"), "selenium_mcg"),
    (re.compile(r"^copper, cu"), "copper_mg"),
    (re.compile(r"^manganese, mn"), "manganese_mg"),
    (re.compile(r"^chromium, cr"), "chromium_mcg"),
    (re.compile(r"^molybdenum, mo"), "molybdenum_mcg"),
    (re.compile(r"^chloride, cl"), "chloride_mg"),
    (re.compile(r"^choline, total"), "choline_mg"),
    (re.compile(r"omega-3"), "omega3_g"),
    (re.compile(r"omega-6"), "omega6_g"),
]

USDA_NUM_TO_KEY: Dict[str, str] = {
    "208": "kcal",
    "1008": "kcal",
    "203": "protein_g",
    "205": "carb_g",
    "204": "fat_g",
    "291": "fiber_g",
    "269": "sugars_g",
    "539": "added_sugars_g",
    "606": "sat_fat_g",
    "605": "trans_fat_g",
    "601": "cholesterol_mg",
    "307": "sodium_mg",
    "324": "vitamin_d_mcg",
    "301": "calcium_mg",
    "303": "iron_mg",
    "306": "potassium_mg",
    "320": "vitamin_a_mcg",
    "401": "vitamin_c_mg",
    "323": "vitamin_e_mg",
    "430": "vitamin_k_mcg",
    "404": "thiamin_mg",
    "405": "riboflavin_mg",
    "406": "niacin_mg",
    "415": "vitamin_b6_mg",
    "417": "folate_mcg",
    "418": "vitamin_b12_mcg",
    "416": "biotin_mcg",
    "410": "pantothenic_acid_mg",
    "305": "phosphorus_mg",
    "353": "iodine_mcg",
    "304": "magnesium_mg",
    "309": "zinc_mg",
    "317": "selenium_mcg",
    "312": "copper_mg",
    "315": "manganese_mg",
    "334": "chromium_mcg",
    "341": "molybdenum_mcg",
    "313": "chloride_mg",
    "421": "choline_mg",
}

USDA_OMEGA3_PATTERNS = [
    re.compile(r"18:3 n-3"),
    re.compile(r"18:4"),
    re.compile(r"20:5 n-3"),
    re.compile(r"22:5 n-3"),
    re.compile(r"22:6 n-3"),
]
USDA_OMEGA6_PATTERNS = [
    re.compile(r"18:2 n-6"),
    re.compile(r"18:3 n-6"),
    re.compile(r"20:2 n-6"),
    re.compile(r"20:3 n-6"),
    re.compile(r"20:4 n-6"),
    re.compile(r"22:2 n-6"),
]


OFF_FIELD_TO_KEY = {
    "energy-kcal_100g": "kcal",
    "proteins_100g": "protein_g",
    "carbohydrates_100g": "carb_g",
    "fat_100g": "fat_g",
    "fiber_100g": "fiber_g",
    "sugars_100g": "sugars_g",
    "added-sugars_100g": "added_sugars_g",
    "saturated-fat_100g": "sat_fat_g",
    "trans-fat_100g": "trans_fat_g",
    "cholesterol_100g": "cholesterol_mg",
    "sodium_100g": "sodium_mg",
    "vitamin-d_100g": "vitamin_d_mcg",
    "calcium_100g": "calcium_mg",
    "iron_100g": "iron_mg",
    "potassium_100g": "potassium_mg",
    "vitamin-a_100g": "vitamin_a_mcg",
    "vitamin-c_100g": "vitamin_c_mg",
    "vitamin-e_100g": "vitamin_e_mg",
    "vitamin-k_100g": "vitamin_k_mcg",
    "vitamin-b1_100g": "thiamin_mg",
    "vitamin-b2_100g": "riboflavin_mg",
    "vitamin-pp_100g": "niacin_mg",
    "vitamin-b6_100g": "vitamin_b6_mg",
    "folates_100g": "folate_mcg",
    "vitamin-b12_100g": "vitamin_b12_mcg",
    "biotin_100g": "biotin_mcg",
    "pantothenic-acid_100g": "pantothenic_acid_mg",
    "phosphorus_100g": "phosphorus_mg",
    "iodine_100g": "iodine_mcg",
    "magnesium_100g": "magnesium_mg",
    "zinc_100g": "zinc_mg",
    "selenium_100g": "selenium_mcg",
    "copper_100g": "copper_mg",
    "manganese_100g": "manganese_mg",
    "chromium_100g": "chromium_mcg",
    "molybdenum_100g": "molybdenum_mcg",
    "chloride_100g": "chloride_mg",
    "choline_100g": "choline_mg",
    "omega-3-fat_100g": "omega3_g",
    "omega-6-fat_100g": "omega6_g",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Enrich nutrient rows from USDA/OpenFoodFacts.")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"), help="Postgres connection string")
    parser.add_argument("--organization-slug", default="primary")
    parser.add_argument("--since-date", default="2026-02-01", help="UTC date filter for served products (YYYY-MM-DD)")
    parser.add_argument("--served-only", action="store_true", default=True, help="Target only products consumed in service events")
    parser.add_argument("--all-products", action="store_true", help="Ignore served-only filter")
    parser.add_argument("--usda-key", default=os.getenv("USDA_API_KEY", "DEMO_KEY"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--timeout", type=float, default=12.0)
    parser.add_argument("--max-products", type=int, default=0, help="Optional cap for debugging")
    parser.add_argument(
        "--nonzero-floor",
        type=float,
        default=0.0,
        help="If > 0, fill missing or zero nutrient values with this tiny derived floor value.",
    )
    return parser.parse_args()


def normalize_upc(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    digits = re.sub(r"[^0-9]", "", value)
    if len(digits) < 8:
        return None
    return digits


def normalize_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def parse_number(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        if value != value:
            return None
        return float(value)
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return float(stripped)
        except ValueError:
            return None
    return None


def normalize_unit(unit: Optional[str]) -> str:
    if unit is None:
        return ""
    u = str(unit).strip().lower()
    u = u.replace("μ", "u").replace("µ", "u")
    if u in ("ug", "mcg"):
        return "mcg"
    if u in ("milligram", "milligrams"):
        return "mg"
    if u in ("gram", "grams"):
        return "g"
    if u in ("kcal", "calorie", "calories"):
        return "kcal"
    if u in ("kj", "kilojoule", "kilojoules"):
        return "kj"
    if u in ("iu",):
        return "iu"
    return u


def convert_unit(value: float, from_unit: str, to_unit: str, key: str) -> Optional[float]:
    f = normalize_unit(from_unit)
    t = normalize_unit(to_unit)
    if t == "kcal":
        if f == "kcal":
            return value
        if f == "kj":
            return value / 4.184
        return None

    if key == "vitamin_d_mcg" and f == "iu":
        return value * 0.025
    if key == "vitamin_a_mcg" and f == "iu":
        return value * 0.3

    if t == "g":
        if f == "g":
            return value
        if f == "mg":
            return value / 1000.0
        if f == "mcg":
            return value / 1_000_000.0
        return None
    if t == "mg":
        if f == "mg":
            return value
        if f == "g":
            return value * 1000.0
        if f == "mcg":
            return value / 1000.0
        return None
    if t == "mcg":
        if f == "mcg":
            return value
        if f == "mg":
            return value * 1000.0
        if f == "g":
            return value * 1_000_000.0
        return None
    return None


@dataclass
class ProductRow:
    product_id: str
    organization_id: str
    product_name: str
    brand: str
    upc: Optional[str]
    ingredient_id: str
    ingredient_key: str
    ingredient_name: str


@dataclass
class SourceValue:
    value: float
    source_type: str
    source_ref: str
    confidence: float


class SourceClient:
    def __init__(self, timeout: float, usda_key: str):
        self.timeout = timeout
        self.usda_key = usda_key
        self.session = requests.Session()
        self.off_cache: Dict[str, Dict[str, float]] = {}
        self.usda_search_cache: Dict[str, List[Dict[str, Any]]] = {}
        self.usda_food_cache: Dict[int, Dict[str, Any]] = {}
        self.usda_rate_limited = False

    def _get_json(self, url: str, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        if self.usda_rate_limited and "api.nal.usda.gov" in url:
            return None
        for attempt in range(3):
            try:
                response = self.session.get(url, params=params, timeout=self.timeout)
                if response.status_code == 404:
                    return None
                if response.status_code == 429 and "api.nal.usda.gov" in url:
                    self.usda_rate_limited = True
                    return None
                if response.status_code in (429, 500, 502, 503, 504):
                    time.sleep(0.6 * (attempt + 1))
                    continue
                response.raise_for_status()
                return response.json()
            except Exception:
                if attempt == 2:
                    return None
                time.sleep(0.5 * (attempt + 1))
        return None

    def fetch_openfoodfacts(self, upc: str) -> Dict[str, float]:
        if upc in self.off_cache:
            return self.off_cache[upc]

        json_data = self._get_json(f"https://world.openfoodfacts.org/api/v2/product/{upc}.json")
        values: Dict[str, float] = {}
        if not json_data or json_data.get("status") != 1:
            self.off_cache[upc] = values
            return values

        product = json_data.get("product") or {}
        nutriments = product.get("nutriments") or {}

        for off_field, key in OFF_FIELD_TO_KEY.items():
            amount = parse_number(nutriments.get(off_field))
            if amount is None:
                continue
            unit = nutriments.get(off_field.replace("_100g", "_unit"))
            target_unit = TARGET_UNIT_BY_KEY[key]
            converted = convert_unit(amount, unit or target_unit, target_unit, key)
            if converted is None:
                continue
            if converted < 0:
                continue
            values[key] = converted

        # Fall back to salt -> sodium conversion when sodium field is absent.
        if "sodium_mg" not in values:
            salt = parse_number(nutriments.get("salt_100g"))
            if salt is not None:
                salt_unit = normalize_unit(nutriments.get("salt_unit") or "g")
                salt_g = convert_unit(salt, salt_unit, "g", "sodium_mg")
                if salt_g is not None:
                    values["sodium_mg"] = salt_g * 393.4

        # Fall back to kcal from kJ if kcal missing.
        if "kcal" not in values:
            kj = parse_number(nutriments.get("energy-kj_100g"))
            if kj is not None:
                values["kcal"] = kj / 4.184

        self.off_cache[upc] = values
        return values

    def _usda_search(self, cache_key: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        if self.usda_rate_limited:
            return []
        if cache_key in self.usda_search_cache:
            return self.usda_search_cache[cache_key]
        payload = self._get_json("https://api.nal.usda.gov/fdc/v1/foods/search", params=params)
        foods = (payload or {}).get("foods") or []
        self.usda_search_cache[cache_key] = foods
        return foods

    def _usda_food(self, fdc_id: int) -> Optional[Dict[str, Any]]:
        if self.usda_rate_limited:
            return None
        if fdc_id in self.usda_food_cache:
            return self.usda_food_cache[fdc_id]
        payload = self._get_json(f"https://api.nal.usda.gov/fdc/v1/food/{fdc_id}", params={"api_key": self.usda_key})
        if not payload:
            return None
        self.usda_food_cache[fdc_id] = payload
        return payload

    def pick_usda_food(self, *, query: str, upc: Optional[str] = None, prefer_branded: bool = False) -> Optional[Dict[str, Any]]:
        if upc:
            foods = self._usda_search(
                f"upc:{upc}",
                {
                    "api_key": self.usda_key,
                    "query": upc,
                    "pageSize": 10,
                    "dataType": ["Branded"],
                    "requireAllWords": "true",
                },
            )
            exact = [f for f in foods if normalize_upc(str(f.get("gtinUpc") or "")) == upc]
            if exact:
                return exact[0]
            if foods:
                return foods[0]

        params = {
            "api_key": self.usda_key,
            "query": query,
            "pageSize": 12,
            "requireAllWords": "false",
        }
        if prefer_branded:
            params["dataType"] = ["Branded", "Foundation", "SR Legacy"]
        else:
            params["dataType"] = ["Foundation", "SR Legacy", "Survey (FNDDS)", "Branded"]
        foods = self._usda_search(f"query:{json.dumps(params, sort_keys=True)}", params)
        if not foods:
            return None

        q = normalize_text(query)
        q_tokens = set(q.split())

        def score(food: Dict[str, Any]) -> float:
            desc = normalize_text(str(food.get("description") or ""))
            brand = normalize_text(str(food.get("brandOwner") or food.get("brandName") or ""))
            data_type = str(food.get("dataType") or "")
            points = 0.0
            if desc:
                overlap = len([tok for tok in q_tokens if tok in desc.split()])
                points += overlap * 1.2
            if upc and normalize_upc(str(food.get("gtinUpc") or "")) == upc:
                points += 10.0
            if prefer_branded and data_type == "Branded":
                points += 2.0
            if not prefer_branded and data_type in ("Foundation", "SR Legacy"):
                points += 1.5
            if brand and brand in q:
                points += 1.0
            return points

        ranked = sorted(foods, key=score, reverse=True)
        return ranked[0] if ranked else None

    def fetch_usda_profile(self, *, query: str, upc: Optional[str] = None, prefer_branded: bool = False) -> Tuple[Dict[str, float], str]:
        food = self.pick_usda_food(query=query, upc=upc, prefer_branded=prefer_branded)
        if not food:
            return {}, ""
        fdc_id = food.get("fdcId")
        if not isinstance(fdc_id, int):
            return {}, ""
        detail = self._usda_food(fdc_id)
        if not detail:
            return {}, ""
        nutrients = detail.get("foodNutrients") or []
        values = map_usda_nutrients(nutrients)
        source_ref = f"https://fdc.nal.usda.gov/fdc-app.html#/food-details/{fdc_id}/nutrients"
        return values, source_ref


def map_usda_nutrients(rows: Iterable[Dict[str, Any]]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    omega3_sum = 0.0
    omega6_sum = 0.0
    omega3_seen = False
    omega6_seen = False

    for row in rows:
        nutrient = row.get("nutrient") or {}
        number = str(nutrient.get("number") or row.get("nutrientNumber") or "").strip()
        name = str(nutrient.get("name") or row.get("nutrientName") or "").strip().lower()
        unit = nutrient.get("unitName") or row.get("unitName") or ""
        amount = parse_number(row.get("amount"))
        if amount is None:
            amount = parse_number(row.get("value"))
        if amount is None:
            continue

        key: Optional[str] = None
        if number in USDA_NUM_TO_KEY:
            key = USDA_NUM_TO_KEY[number]
        else:
            for pattern, candidate in USDA_NAME_TO_KEY:
                if pattern.search(name):
                    key = candidate
                    break

        if key == "kcal":
            converted = convert_unit(amount, unit, "kcal", key)
        elif key:
            converted = convert_unit(amount, unit, TARGET_UNIT_BY_KEY[key], key)
        else:
            converted = None

        # Handle omega sums by component names if direct omega values are absent.
        if any(p.search(name) for p in USDA_OMEGA3_PATTERNS):
            omega_val = convert_unit(amount, unit, "g", "omega3_g")
            if omega_val is not None and omega_val >= 0:
                omega3_sum += omega_val
                omega3_seen = True
        if any(p.search(name) for p in USDA_OMEGA6_PATTERNS):
            omega_val = convert_unit(amount, unit, "g", "omega6_g")
            if omega_val is not None and omega_val >= 0:
                omega6_sum += omega_val
                omega6_seen = True

        if not key or converted is None:
            continue
        if converted < 0:
            continue

        # Prefer explicit kcal over converted kJ when both exist.
        if key == "kcal" and normalize_unit(unit) == "kcal":
            out[key] = converted
            continue
        if key not in out:
            out[key] = converted

    if omega3_seen and omega3_sum > 0 and "omega3_g" not in out:
        out["omega3_g"] = omega3_sum
    if omega6_seen and omega6_sum > 0 and "omega6_g" not in out:
        out["omega6_g"] = omega6_sum

    return out


def merge_source_values(
    merged: Dict[str, SourceValue],
    incoming: Dict[str, float],
    *,
    source_type: str,
    source_ref: str,
    confidence: float,
) -> None:
    for key, value in incoming.items():
        if key not in TARGET_UNIT_BY_KEY:
            continue
        if value is None:
            continue
        if value != value or value < 0:
            continue
        existing = merged.get(key)
        if existing is None or confidence > existing.confidence:
            merged[key] = SourceValue(value=float(value), source_type=source_type, source_ref=source_ref, confidence=confidence)


def apply_floor(value: float, floor: float) -> float:
    if floor <= 0:
        return value
    if value <= 0:
        return floor
    return value


def get_org_id(cur: psycopg2.extensions.cursor, slug: str) -> str:
    cur.execute('select id from "Organization" where slug=%s limit 1', (slug,))
    row = cur.fetchone()
    if not row:
        raise RuntimeError(f'Organization slug "{slug}" not found')
    return row[0]


def load_target_products(
    cur: psycopg2.extensions.cursor,
    *,
    organization_id: str,
    served_only: bool,
    since_date: str,
    max_products: int,
) -> List[ProductRow]:
    if served_only:
        cur.execute(
            """
            with served_products as (
              select distinct lot."productId" as product_id
              from "MealServiceEvent" mse
              join "LotConsumptionEvent" lce on lce."mealServiceEventId" = mse.id
              join "InventoryLot" lot on lot.id = lce."inventoryLotId"
              where mse."organizationId" = %s
                and mse."servedAt" >= %s::date
            )
            select
              p.id,
              p."organizationId",
              p.name,
              coalesce(p.brand, '') as brand,
              p.upc,
              i.id as ingredient_id,
              i."canonicalKey",
              i.name as ingredient_name
            from "ProductCatalog" p
            join served_products sp on sp.product_id = p.id
            join "IngredientCatalog" i on i.id = p."ingredientId"
            where p."organizationId" = %s
            order by i."canonicalKey", p.name
            """,
            (organization_id, since_date, organization_id),
        )
    else:
        cur.execute(
            """
            select
              p.id,
              p."organizationId",
              p.name,
              coalesce(p.brand, '') as brand,
              p.upc,
              i.id as ingredient_id,
              i."canonicalKey",
              i.name as ingredient_name
            from "ProductCatalog" p
            join "IngredientCatalog" i on i.id = p."ingredientId"
            where p."organizationId" = %s and p.active = true
            order by i."canonicalKey", p.name
            """,
            (organization_id,),
        )

    rows = [
        ProductRow(
            product_id=r[0],
            organization_id=r[1],
            product_name=r[2],
            brand=r[3],
            upc=r[4],
            ingredient_id=r[5],
            ingredient_key=r[6],
            ingredient_name=r[7],
        )
        for r in cur.fetchall()
    ]
    if max_products > 0:
        rows = rows[:max_products]
    return rows


def load_existing_nutrients(
    cur: psycopg2.extensions.cursor, product_ids: List[str]
) -> Dict[str, Dict[str, float]]:
    if not product_ids:
        return {}
    cur.execute(
        """
        select v."productId", nd.key, v."valuePer100g"
        from "ProductNutrientValue" v
        join "NutrientDefinition" nd on nd.id = v."nutrientDefinitionId"
        where v."productId" = any(%s)
          and v."valuePer100g" is not null
        """,
        (product_ids,),
    )
    out: Dict[str, Dict[str, float]] = defaultdict(dict)
    for product_id, key, value in cur.fetchall():
        out[product_id][key] = float(value)
    return out


def load_nutrient_defs(cur: psycopg2.extensions.cursor) -> Dict[str, str]:
    cur.execute('select id, key from "NutrientDefinition"')
    return {key: nid for nid, key in cur.fetchall()}


def load_default_user_id(cur: psycopg2.extensions.cursor, organization_id: str) -> Optional[str]:
    cur.execute(
        """
        select id
        from "User"
        where "organizationId" = %s and status = 'ACTIVE'
        order by "createdAt" asc
        limit 1
        """,
        (organization_id,),
    )
    row = cur.fetchone()
    return row[0] if row else None


def representative_product(products: List[ProductRow]) -> ProductRow:
    def score(row: ProductRow) -> Tuple[int, int]:
        upc = normalize_upc(row.upc)
        non_synth = 0 if (row.upc or "").startswith("SYNTH-") else 1
        return (1 if upc else 0, non_synth)

    return sorted(products, key=score, reverse=True)[0]


def ensure_source_task(
    cur: psycopg2.extensions.cursor,
    *,
    organization_id: str,
    product_id: str,
    product_name: str,
    missing_keys: List[str],
) -> None:
    cur.execute(
        """
        select id
        from "VerificationTask"
        where "organizationId" = %s
          and "taskType" = 'SOURCE_RETRIEVAL'
          and status = 'OPEN'
          and payload->>'productId' = %s
        limit 1
        """,
        (organization_id, product_id),
    )
    if cur.fetchone():
        return

    payload = json.dumps(
        {
            "productId": product_id,
            "productName": product_name,
            "missingCore": missing_keys,
            "source": "agent_nutrient_enrichment",
        }
    )
    cur.execute(
        """
        insert into "VerificationTask" (
          id, "organizationId", "taskType", severity, status, title, description, payload, "createdBy", "createdAt", "updatedAt", version
        )
        values (
          %s, %s, 'SOURCE_RETRIEVAL', 'HIGH', 'OPEN', %s, %s, %s::jsonb, 'agent', now(), now(), 1
        )
        """,
        (
            str(uuid.uuid4()),
            organization_id,
            f"Missing nutrient profile: {product_name}",
            "Agent enrichment still missing one or more core nutrient values.",
            payload,
        ),
    )


def resolve_profile_for_ingredient(
    source: SourceClient, group: List[ProductRow]
) -> Dict[str, SourceValue]:
    merged: Dict[str, SourceValue] = {}
    rep = representative_product(group)
    upc = normalize_upc(rep.upc)
    query_base = f"{rep.ingredient_name} {rep.brand} {rep.product_name}".strip()

    if upc:
        off_values = source.fetch_openfoodfacts(upc)
        if off_values:
            merge_source_values(
                merged,
                off_values,
                source_type="MANUFACTURER",
                source_ref=f"https://world.openfoodfacts.org/product/{upc}",
                confidence=0.96,
            )

        usda_branded, source_ref = source.fetch_usda_profile(
            query=query_base, upc=upc, prefer_branded=True
        )
        if usda_branded:
            merge_source_values(
                merged,
                usda_branded,
                source_type="USDA",
                source_ref=source_ref,
                confidence=0.9,
            )

    usda_generic, source_ref = source.fetch_usda_profile(
        query=rep.ingredient_name, upc=None, prefer_branded=False
    )
    if usda_generic:
        merge_source_values(
            merged,
            usda_generic,
            source_type="USDA",
            source_ref=source_ref,
            confidence=0.82,
        )

    return merged


def main() -> int:
    args = parse_args()
    if not args.database_url:
        print("Missing DATABASE_URL. Pass --database-url or export DATABASE_URL.", file=sys.stderr)
        return 1

    served_only = False if args.all_products else args.served_only
    source = SourceClient(timeout=args.timeout, usda_key=args.usda_key)

    conn = psycopg2.connect(args.database_url)
    conn.autocommit = False
    psycopg2.extras.register_default_jsonb(conn)

    summary: Dict[str, Any] = {
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "organizationSlug": args.organization_slug,
        "servedOnly": served_only,
        "sinceDate": args.since_date,
        "dryRun": bool(args.dry_run),
        "groupsProcessed": 0,
        "productsProcessed": 0,
        "upserts": 0,
        "productsWithMissingCoreAfter": 0,
        "errors": [],
    }

    try:
        with conn.cursor() as cur:
            org_id = get_org_id(cur, args.organization_slug)
            summary["organizationId"] = org_id
            default_user_id = load_default_user_id(cur, org_id)
            summary["defaultUserId"] = default_user_id

            products = load_target_products(
                cur,
                organization_id=org_id,
                served_only=served_only,
                since_date=args.since_date,
                max_products=args.max_products,
            )
            summary["productsProcessed"] = len(products)
            if not products:
                conn.rollback()
                print(json.dumps(summary, indent=2))
                return 0

            product_ids = [p.product_id for p in products]
            existing = load_existing_nutrients(cur, product_ids)
            nutrient_defs = load_nutrient_defs(cur)

            products_by_ingredient: Dict[str, List[ProductRow]] = defaultdict(list)
            for row in products:
                products_by_ingredient[row.ingredient_key].append(row)

            total_upserts = 0
            per_group_outcome: List[Dict[str, Any]] = []

            for ingredient_key, group in products_by_ingredient.items():
                summary["groupsProcessed"] += 1
                merged_profile = resolve_profile_for_ingredient(source, group)
                note = None
                if not merged_profile:
                    note = "no_source_match"

                resolved_keys = set(merged_profile.keys())
                for product in group:
                    existing_values = existing.get(product.product_id, {})
                    final_values: Dict[str, SourceValue] = {}
                    for key in TARGET_KEYS:
                        if key in existing_values:
                            final_values[key] = SourceValue(
                                value=apply_floor(float(existing_values[key]), args.nonzero_floor),
                                source_type="MANUAL",
                                source_ref="existing-db",
                                confidence=1.0,
                            )
                        elif key in merged_profile:
                            incoming = merged_profile[key]
                            final_values[key] = SourceValue(
                                value=apply_floor(float(incoming.value), args.nonzero_floor),
                                source_type=incoming.source_type,
                                source_ref=incoming.source_ref,
                                confidence=incoming.confidence,
                            )
                        elif args.nonzero_floor > 0:
                            final_values[key] = SourceValue(
                                value=args.nonzero_floor,
                                source_type="DERIVED",
                                source_ref="agent:trace-floor-imputation",
                                confidence=0.2,
                            )

                    missing_core = [k for k in CORE_KEYS if k not in final_values]

                    for key, source_value in final_values.items():
                        nutrient_def_id = nutrient_defs.get(key)
                        if not nutrient_def_id:
                            continue
                        if key in existing_values and abs(existing_values[key] - source_value.value) < 1e-9:
                            continue

                        if args.dry_run:
                            total_upserts += 1
                            continue

                        cur.execute(
                            """
                            insert into "ProductNutrientValue" (
                              id, "productId", "nutrientDefinitionId", "valuePer100g", "sourceType", "sourceRef",
                              "verificationStatus", "createdAt", "createdBy", "updatedAt", version
                            )
                            values (
                              gen_random_uuid()::text, %s, %s, %s, %s, %s, 'NEEDS_REVIEW', now(), 'agent', now(), 1
                            )
                            on conflict ("productId", "nutrientDefinitionId")
                            do update set
                              "valuePer100g" = excluded."valuePer100g",
                              "sourceType" = excluded."sourceType",
                              "sourceRef" = excluded."sourceRef",
                              "verificationStatus" = 'NEEDS_REVIEW',
                              "updatedAt" = now(),
                              version = "ProductNutrientValue".version + 1
                            """,
                            (
                                product.product_id,
                                nutrient_def_id,
                                source_value.value,
                                source_value.source_type,
                                source_value.source_ref,
                            ),
                        )
                        total_upserts += 1

                    if missing_core:
                        summary["productsWithMissingCoreAfter"] += 1
                        if not args.dry_run:
                            ensure_source_task(
                                cur,
                                organization_id=org_id,
                                product_id=product.product_id,
                                product_name=product.product_name,
                                missing_keys=missing_core,
                            )

                per_group_outcome.append(
                    {
                        "ingredientKey": ingredient_key,
                        "ingredientName": group[0].ingredient_name,
                        "products": len(group),
                        "resolvedKeys": len(resolved_keys),
                        "coreResolved": all(k in resolved_keys for k in CORE_KEYS),
                        "note": note,
                    }
                )

            summary["upserts"] = total_upserts
            summary["groupOutcomes"] = per_group_outcome

            if args.dry_run:
                conn.rollback()
            else:
                conn.commit()

        summary["finishedAt"] = datetime.now(timezone.utc).isoformat()
        print(json.dumps(summary, indent=2))
        return 0
    except Exception as exc:
        conn.rollback()
        summary["errors"].append(str(exc))
        summary["finishedAt"] = datetime.now(timezone.utc).isoformat()
        print(json.dumps(summary, indent=2))
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
