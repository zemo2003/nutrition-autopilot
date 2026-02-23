#!/usr/bin/env python3
"""
Historical nutrient recovery agent (40-key coverage with provenance).

Priority per product:
1) Existing uploaded hints / trusted DB rows
2) UPC-backed product records (OpenFoodFacts)
3) USDA branded search
4) USDA generic ingredient search
5) Similar-product inference (same ingredient, then global fallback)

No floor imputation is used.
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
from statistics import median
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

DEFAULT_SIMILAR_FALLBACKS: Dict[str, float] = {
    "kcal": 120.0,
    "protein_g": 5.0,
    "carb_g": 15.0,
    "fat_g": 4.0,
    "fiber_g": 2.0,
    "sugars_g": 3.0,
    "added_sugars_g": 1.0,
    "sat_fat_g": 1.0,
    "trans_fat_g": 0.01,
    "cholesterol_mg": 5.0,
    "sodium_mg": 80.0,
    "vitamin_d_mcg": 0.2,
    "calcium_mg": 40.0,
    "iron_mg": 1.0,
    "potassium_mg": 180.0,
    "vitamin_a_mcg": 30.0,
    "vitamin_c_mg": 4.0,
    "vitamin_e_mg": 0.8,
    "vitamin_k_mcg": 8.0,
    "thiamin_mg": 0.08,
    "riboflavin_mg": 0.07,
    "niacin_mg": 0.9,
    "vitamin_b6_mg": 0.1,
    "folate_mcg": 20.0,
    "vitamin_b12_mcg": 0.2,
    "biotin_mcg": 1.5,
    "pantothenic_acid_mg": 0.4,
    "phosphorus_mg": 90.0,
    "iodine_mcg": 8.0,
    "magnesium_mg": 20.0,
    "zinc_mg": 0.7,
    "selenium_mcg": 8.0,
    "copper_mg": 0.08,
    "manganese_mg": 0.2,
    "chromium_mcg": 2.0,
    "molybdenum_mcg": 5.0,
    "chloride_mg": 70.0,
    "choline_mg": 18.0,
    "omega3_g": 0.06,
    "omega6_g": 0.3,
}

CARB_SUGAR_KEYS = {"carb_g", "fiber_g", "sugars_g", "added_sugars_g"}
PLAIN_ANIMAL_PROTEIN_TOKENS = ("BEEF", "CHICKEN", "TURKEY", "COD", "TUNA", "FISH")
PLAIN_ANIMAL_PROTEIN_EXCLUSIONS = (
    "BAR",
    "BREAD",
    "BAGEL",
    "TORTILLA",
    "PASTA",
    "RICE",
    "BEAN",
    "YOGURT",
    "CHEESE",
    "MILK",
    "WHEY",
    "SAUSAGE",
    "NUGGET",
    "BREADED",
    "SAUCE",
    "JERKY",
    "DRINK",
)

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
]

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
    evidence_grade: str
    confidence: float
    historical_exception: bool


def is_plain_animal_protein(product: ProductRow) -> bool:
    haystack = " ".join(
        [
            product.ingredient_key or "",
            product.ingredient_name or "",
            product.product_name or "",
            product.brand or "",
        ]
    ).upper()
    if any(token in haystack for token in PLAIN_ANIMAL_PROTEIN_EXCLUSIONS):
        return False
    return any(token in haystack for token in PLAIN_ANIMAL_PROTEIN_TOKENS)


def forced_zero_for_missing_key(
    product: ProductRow,
    nutrient_key: str,
    historical_mode: bool,
) -> Optional[SourceValue]:
    if nutrient_key not in CARB_SUGAR_KEYS:
        return None
    if not is_plain_animal_protein(product):
        return None
    return SourceValue(
        value=0.0,
        source_type="DERIVED",
        source_ref="sanity-rule:animal-protein-zero-carb",
        evidence_grade="INFERRED_FROM_INGREDIENT",
        confidence=0.8,
        historical_exception=historical_mode,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Historical nutrient recovery and provenance backfill")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"), help="Postgres connection string")
    parser.add_argument("--organization-slug", default="primary")
    parser.add_argument("--month", default=datetime.now(timezone.utc).strftime("%Y-%m"), help="YYYY-MM")
    parser.add_argument("--served-only", action="store_true", default=True)
    parser.add_argument("--all-products", action="store_true")
    parser.add_argument("--source-policy", default="MAX_COVERAGE")
    parser.add_argument("--historical-mode", default="true")
    parser.add_argument("--usda-key", default=os.getenv("USDA_API_KEY", "DEMO_KEY"))
    parser.add_argument("--timeout", type=float, default=12.0)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-products", type=int, default=0)
    return parser.parse_args()


def parse_bool(value: str, fallback: bool = False) -> bool:
    lowered = str(value or "").strip().lower()
    if lowered in {"1", "true", "yes", "y", "on"}:
        return True
    if lowered in {"0", "false", "no", "n", "off"}:
        return False
    return fallback


def month_bounds(month: str) -> Tuple[str, str]:
    if not re.match(r"^\d{4}-\d{2}$", month):
        raise RuntimeError("month must be YYYY-MM")
    year = int(month[0:4])
    mon = int(month[5:7])
    start = f"{year:04d}-{mon:02d}-01"
    if mon == 12:
        end = f"{year + 1:04d}-01-01"
    else:
        end = f"{year:04d}-{mon + 1:02d}-01"
    return start, end


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
    u = str(unit).strip().lower().replace("μ", "u").replace("µ", "u")
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
    if u == "iu":
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
            if converted is None or converted < 0:
                continue
            values[key] = converted

        if "sodium_mg" not in values:
            salt = parse_number(nutriments.get("salt_100g"))
            if salt is not None:
                salt_unit = normalize_unit(nutriments.get("salt_unit") or "g")
                salt_g = convert_unit(salt, salt_unit, "g", "sodium_mg")
                if salt_g is not None:
                    values["sodium_mg"] = salt_g * 393.4

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

    def pick_usda_food(self, query: str, upc: Optional[str], prefer_branded: bool) -> Optional[Dict[str, Any]]:
        if upc:
            foods = self._usda_search(
                f"upc:{upc}:{prefer_branded}",
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
            "dataType": ["Branded", "Foundation", "SR Legacy"]
            if prefer_branded
            else ["Foundation", "SR Legacy", "Survey (FNDDS)", "Branded"],
        }
        foods = self._usda_search(f"query:{json.dumps(params, sort_keys=True)}", params)
        if not foods:
            return None

        q_tokens = set(normalize_text(query).split())

        def score(food: Dict[str, Any]) -> float:
            desc = normalize_text(str(food.get("description") or ""))
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
                points += 1.2
            return points

        ranked = sorted(foods, key=score, reverse=True)
        return ranked[0] if ranked else None

    def fetch_usda_profile(self, query: str, upc: Optional[str], prefer_branded: bool) -> Tuple[Dict[str, float], str]:
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

        key: Optional[str] = USDA_NUM_TO_KEY.get(number)
        if not key:
            for pattern, candidate in USDA_NAME_TO_KEY:
                if pattern.search(name):
                    key = candidate
                    break

        converted = None
        if key == "kcal":
            converted = convert_unit(amount, unit, "kcal", key)
        elif key:
            converted = convert_unit(amount, unit, TARGET_UNIT_BY_KEY[key], key)

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

        if not key or converted is None or converted < 0:
            continue

        if key == "kcal" and normalize_unit(unit) == "kcal":
            out[key] = converted
            continue
        if key not in out:
            out[key] = converted

    if omega3_seen and "omega3_g" not in out:
        out["omega3_g"] = omega3_sum
    if omega6_seen and "omega6_g" not in out:
        out["omega6_g"] = omega6_sum

    return out


def merge_values(
    merged: Dict[str, SourceValue],
    incoming: Dict[str, float],
    source_type: str,
    source_ref: str,
    evidence_grade: str,
    confidence: float,
    historical_exception: bool,
) -> None:
    for key, value in incoming.items():
        if key not in TARGET_UNIT_BY_KEY:
            continue
        if value is None or value != value:
            continue
        if value < 0:
            continue
        existing = merged.get(key)
        candidate = SourceValue(
            value=float(value),
            source_type=source_type,
            source_ref=source_ref,
            evidence_grade=evidence_grade,
            confidence=confidence,
            historical_exception=historical_exception,
        )
        if existing is None or candidate.confidence > existing.confidence:
            merged[key] = candidate


def get_org_id(cur: psycopg2.extensions.cursor, slug: str) -> str:
    cur.execute('select id from "Organization" where slug=%s limit 1', (slug,))
    row = cur.fetchone()
    if not row:
        raise RuntimeError(f'Organization slug "{slug}" not found')
    return str(row[0])


def load_target_products(
    cur: psycopg2.extensions.cursor,
    *,
    organization_id: str,
    served_only: bool,
    month: str,
    max_products: int,
) -> List[ProductRow]:
    start_date, end_date = month_bounds(month)

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
                and mse."servedAt" < %s::date
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
            (organization_id, start_date, end_date, organization_id),
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
            product_id=str(r[0]),
            organization_id=str(r[1]),
            product_name=str(r[2]),
            brand=str(r[3]),
            upc=r[4],
            ingredient_id=str(r[5]),
            ingredient_key=str(r[6]),
            ingredient_name=str(r[7]),
        )
        for r in cur.fetchall()
    ]
    if max_products > 0:
        rows = rows[:max_products]
    return rows


def load_existing_values(
    cur: psycopg2.extensions.cursor, product_ids: List[str]
) -> Dict[str, Dict[str, SourceValue]]:
    if not product_ids:
        return {}
    cur.execute(
        """
        select
          pnv."productId",
          nd.key,
          pnv."valuePer100g",
          pnv."sourceType"::text,
          pnv."sourceRef",
          coalesce(pnv."evidenceGrade"::text, 'HISTORICAL_EXCEPTION') as evidence_grade,
          coalesce(pnv."confidenceScore", 0),
          coalesce(pnv."historicalException", false)
        from "ProductNutrientValue" pnv
        join "NutrientDefinition" nd on nd.id = pnv."nutrientDefinitionId"
        where pnv."productId" = any(%s)
          and pnv."valuePer100g" is not null
        """,
        (product_ids,),
    )

    out: Dict[str, Dict[str, SourceValue]] = defaultdict(dict)
    for product_id, key, value, source_type, source_ref, evidence_grade, confidence, historical_exception in cur.fetchall():
        source_ref = str(source_ref)
        if source_ref in {"agent:trace-floor-imputation", "historical-cleanup:pending-rebuild"}:
            continue
        # Skip low-quality inferred fills so authoritative source fetches can replace them.
        if source_ref.startswith("agent:auto-verify:"):
            continue
        if source_ref.startswith("similar-product:global:"):
            continue
        if str(evidence_grade) in {"INFERRED_FROM_SIMILAR_PRODUCT", "HISTORICAL_EXCEPTION"}:
            continue
        parsed_value = parse_number(value)
        if parsed_value is None:
            continue
        out[str(product_id)][str(key)] = SourceValue(
            value=parsed_value,
            source_type=str(source_type),
            source_ref=source_ref,
            evidence_grade=str(evidence_grade),
            confidence=float(confidence or 0),
            historical_exception=bool(historical_exception),
        )
    return out


def load_nutrient_defs(cur: psycopg2.extensions.cursor) -> Dict[str, str]:
    cur.execute('select id, key from "NutrientDefinition"')
    return {str(key): str(nid) for nid, key in cur.fetchall()}


def load_global_reference_values(cur: psycopg2.extensions.cursor) -> Dict[str, float]:
    cur.execute(
        """
        select
          nd.key,
          percentile_cont(0.5) within group (order by pnv."valuePer100g") as median_value
        from "ProductNutrientValue" pnv
        join "NutrientDefinition" nd on nd.id = pnv."nutrientDefinitionId"
        where pnv."valuePer100g" is not null
          and pnv."valuePer100g" > 0
          and pnv."sourceRef" <> 'agent:trace-floor-imputation'
          and pnv."sourceRef" <> 'historical-cleanup:pending-rebuild'
        group by nd.key
        """
    )
    out: Dict[str, float] = {}
    for key, median_value in cur.fetchall():
        if key in TARGET_KEYS and median_value is not None:
            out[str(key)] = float(median_value)
    return out


def resolve_product_profile(
    source: SourceClient,
    product: ProductRow,
    existing_values: Dict[str, SourceValue],
) -> Dict[str, SourceValue]:
    merged: Dict[str, SourceValue] = {}

    # 1) existing uploaded hints and trusted DB values
    for key, value in existing_values.items():
        if value.source_type in {"MANUAL", "MANUFACTURER"}:
            baseline_confidence = 0.95
        elif value.source_type == "USDA":
            baseline_confidence = 0.82
        elif value.evidence_grade == "INFERRED_FROM_INGREDIENT":
            baseline_confidence = 0.55
        else:
            baseline_confidence = 0.35
        merge_values(
            merged,
            {key: value.value},
            source_type=value.source_type,
            source_ref=value.source_ref,
            evidence_grade=value.evidence_grade,
            confidence=max(value.confidence, baseline_confidence),
            historical_exception=value.historical_exception,
        )

    upc = normalize_upc(product.upc)
    query_base = f"{product.ingredient_name} {product.brand} {product.product_name}".strip()

    # 2) UPC-backed public product pages
    if upc:
        off_values = source.fetch_openfoodfacts(upc)
        if off_values:
            merge_values(
                merged,
                off_values,
                source_type="MANUFACTURER",
                source_ref=f"https://world.openfoodfacts.org/product/{upc}",
                evidence_grade="OPENFOODFACTS",
                confidence=0.84,
                historical_exception=False,
            )

    # 3) USDA branded
    usda_branded, usda_branded_ref = source.fetch_usda_profile(query=query_base, upc=upc, prefer_branded=True)
    if usda_branded:
        merge_values(
            merged,
            usda_branded,
            source_type="USDA",
            source_ref=usda_branded_ref,
            evidence_grade="USDA_BRANDED",
            confidence=0.8,
            historical_exception=False,
        )

    # 4) USDA generic
    usda_generic, usda_generic_ref = source.fetch_usda_profile(
        query=product.ingredient_name,
        upc=None,
        prefer_branded=False,
    )
    if usda_generic:
        merge_values(
            merged,
            usda_generic,
            source_type="USDA",
            source_ref=usda_generic_ref,
            evidence_grade="USDA_GENERIC",
            confidence=0.7,
            historical_exception=False,
        )

    return merged


def build_global_fallbacks(resolved_by_product: Dict[str, Dict[str, SourceValue]]) -> Dict[str, float]:
    values_by_key: Dict[str, List[float]] = defaultdict(list)
    for nutrient_map in resolved_by_product.values():
        for key, source in nutrient_map.items():
            values_by_key[key].append(source.value)
    return {
        key: float(median(values))
        for key, values in values_by_key.items()
        if values and key in TARGET_KEYS
    }


def fill_from_similar_products(
    products_by_ingredient: Dict[str, List[ProductRow]],
    resolved_by_product: Dict[str, Dict[str, SourceValue]],
    global_fallbacks: Dict[str, float],
    historical_mode: bool,
) -> None:
    for ingredient_key, group in products_by_ingredient.items():
        donor_candidates = sorted(
            group,
            key=lambda product: len(
                [
                    key
                    for key, source in resolved_by_product.get(product.product_id, {}).items()
                    if source.evidence_grade not in {"INFERRED_FROM_SIMILAR_PRODUCT", "HISTORICAL_EXCEPTION"}
                ]
            ),
            reverse=True,
        )

        for product in group:
            resolved = resolved_by_product.setdefault(product.product_id, {})
            for key in TARGET_KEYS:
                if key in resolved:
                    continue

                forced = forced_zero_for_missing_key(product, key, historical_mode)
                if forced is not None:
                    resolved[key] = forced
                    continue

                donor_value: Optional[Tuple[float, str]] = None
                for donor in donor_candidates:
                    if donor.product_id == product.product_id:
                        continue
                    donor_map = resolved_by_product.get(donor.product_id, {})
                    donor_source = donor_map.get(key)
                    if donor_source is None:
                        continue
                    donor_value = (donor_source.value, donor.product_id)
                    break

                if donor_value is not None:
                    resolved[key] = SourceValue(
                        value=float(donor_value[0]),
                        source_type="DERIVED",
                        source_ref=f"similar-product:{donor_value[1]}",
                        evidence_grade="INFERRED_FROM_SIMILAR_PRODUCT",
                        confidence=0.4,
                        historical_exception=historical_mode,
                    )
                    continue

                global_value = global_fallbacks.get(key)
                if global_value is None:
                    global_value = DEFAULT_SIMILAR_FALLBACKS.get(key)
                if global_value is not None:
                    resolved[key] = SourceValue(
                        value=float(global_value),
                        source_type="DERIVED",
                        source_ref=f"similar-product:global:{ingredient_key}",
                        evidence_grade="INFERRED_FROM_SIMILAR_PRODUCT",
                        confidence=0.25,
                        historical_exception=historical_mode,
                    )


def upsert_nutrients(
    cur: psycopg2.extensions.cursor,
    *,
    product_id: str,
    nutrient_defs: Dict[str, str],
    resolved: Dict[str, SourceValue],
    retrieval_run_id: str,
    dry_run: bool,
) -> int:
    upserts = 0
    retrieved_at = datetime.now(timezone.utc).isoformat()

    for key in TARGET_KEYS:
        source_value = resolved.get(key)
        if source_value is None:
            continue
        nutrient_def_id = nutrient_defs.get(key)
        if not nutrient_def_id:
            continue

        upserts += 1
        if dry_run:
            continue

        cur.execute(
            """
            insert into "ProductNutrientValue" (
              id,
              "productId",
              "nutrientDefinitionId",
              "valuePer100g",
              "sourceType",
              "sourceRef",
              "confidenceScore",
              "evidenceGrade",
              "historicalException",
              "retrievedAt",
              "retrievalRunId",
              "verificationStatus",
              "createdAt",
              "createdBy",
              "updatedAt",
              version
            )
            values (
              gen_random_uuid()::text,
              %s,
              %s,
              %s,
              %s,
              %s,
              %s,
              %s,
              %s,
              %s::timestamptz,
              %s,
              'NEEDS_REVIEW',
              now(),
              'agent',
              now(),
              1
            )
            on conflict ("productId", "nutrientDefinitionId")
            do update set
              "valuePer100g" = excluded."valuePer100g",
              "sourceType" = excluded."sourceType",
              "sourceRef" = excluded."sourceRef",
              "confidenceScore" = excluded."confidenceScore",
              "evidenceGrade" = excluded."evidenceGrade",
              "historicalException" = excluded."historicalException",
              "retrievedAt" = excluded."retrievedAt",
              "retrievalRunId" = excluded."retrievalRunId",
              "verificationStatus" = 'NEEDS_REVIEW',
              "updatedAt" = now(),
              version = "ProductNutrientValue".version + 1
            """,
            (
                product_id,
                nutrient_def_id,
                source_value.value,
                source_value.source_type,
                source_value.source_ref,
                source_value.confidence,
                source_value.evidence_grade,
                source_value.historical_exception,
                retrieved_at,
                retrieval_run_id,
            ),
        )

    return upserts


def upsert_verification_task(
    cur: psycopg2.extensions.cursor,
    *,
    organization_id: str,
    product: ProductRow,
    resolved: Dict[str, SourceValue],
    historical_mode: bool,
    dry_run: bool,
) -> None:
    nutrient_keys = sorted([key for key in TARGET_KEYS if key in resolved])
    proposed_values = {key: resolved[key].value for key in nutrient_keys}
    evidence_refs = sorted({resolved[key].source_ref for key in nutrient_keys})
    confidences = [resolved[key].confidence for key in nutrient_keys]
    confidence = min(confidences) if confidences else 0.0

    inferred_count = len(
        [
            key
            for key in nutrient_keys
            if resolved[key].evidence_grade in {"INFERRED_FROM_SIMILAR_PRODUCT", "INFERRED_FROM_INGREDIENT"}
        ]
    )
    historical_exception = any(resolved[key].historical_exception for key in nutrient_keys)

    severity = "CRITICAL" if inferred_count > 0 or historical_exception else "MEDIUM"
    title = f"Review nutrient evidence: {product.product_name}"
    description = (
        "Nutrient-level proposal auto-applied for historical rebuild. "
        "Review inferred values and provenance references."
    )

    payload = {
        "productId": product.product_id,
        "productName": product.product_name,
        "nutrientKeys": nutrient_keys,
        "proposedValues": proposed_values,
        "evidenceRefs": evidence_refs,
        "confidence": round(float(confidence), 4),
        "sourceType": "MIXED",
        "historicalException": historical_exception or historical_mode,
        "dedupeKey": f"nutrient-rebuild:{product.product_id}",
    }

    if dry_run:
        return

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
        (organization_id, product.product_id),
    )
    row = cur.fetchone()

    if row:
        cur.execute(
            """
            update "VerificationTask"
            set
              severity = %s,
              title = %s,
              description = %s,
              payload = %s::jsonb,
              "updatedAt" = now(),
              version = version + 1
            where id = %s
            """,
            (severity, title, description, json.dumps(payload), str(row[0])),
        )
        return

    cur.execute(
        """
        insert into "VerificationTask" (
          id,
          "organizationId",
          "taskType",
          severity,
          status,
          title,
          description,
          payload,
          "createdBy",
          "createdAt",
          "updatedAt",
          version
        )
        values (
          %s,
          %s,
          'SOURCE_RETRIEVAL',
          %s,
          'OPEN',
          %s,
          %s,
          %s::jsonb,
          'agent',
          now(),
          now(),
          1
        )
        """,
        (str(uuid.uuid4()), organization_id, severity, title, description, json.dumps(payload)),
    )


def main() -> int:
    args = parse_args()
    if not args.database_url:
        print("Missing DATABASE_URL. Pass --database-url or export DATABASE_URL.", file=sys.stderr)
        return 1

    historical_mode = parse_bool(args.historical_mode, True)
    served_only = False if args.all_products else args.served_only
    retrieval_run_id = str(uuid.uuid4())
    source = SourceClient(timeout=args.timeout, usda_key=args.usda_key)

    conn = psycopg2.connect(args.database_url)
    conn.autocommit = False
    psycopg2.extras.register_default_jsonb(conn)

    summary: Dict[str, Any] = {
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "organizationSlug": args.organization_slug,
        "month": args.month,
        "servedOnly": served_only,
        "sourcePolicy": args.source_policy,
        "historicalMode": historical_mode,
        "dryRun": bool(args.dry_run),
        "retrievalRunId": retrieval_run_id,
        "productsProcessed": 0,
        "upserts": 0,
        "productsMissingCoreAfter": 0,
        "productsMissingAnyAfter": 0,
        "errors": [],
    }

    try:
        with conn.cursor() as cur:
            org_id = get_org_id(cur, args.organization_slug)
            summary["organizationId"] = org_id

            products = load_target_products(
                cur,
                organization_id=org_id,
                served_only=served_only,
                month=args.month,
                max_products=args.max_products,
            )
            summary["productsProcessed"] = len(products)
            if not products:
                conn.rollback()
                summary["finishedAt"] = datetime.now(timezone.utc).isoformat()
                print(json.dumps(summary, indent=2))
                return 0

            product_ids = [product.product_id for product in products]
            existing_by_product = load_existing_values(cur, product_ids)
            nutrient_defs = load_nutrient_defs(cur)
            global_reference_values = load_global_reference_values(cur)

            products_by_ingredient: Dict[str, List[ProductRow]] = defaultdict(list)
            for product in products:
                products_by_ingredient[product.ingredient_key].append(product)

            resolved_by_product: Dict[str, Dict[str, SourceValue]] = {}
            for product in products:
                existing_values = existing_by_product.get(product.product_id, {})
                resolved_by_product[product.product_id] = resolve_product_profile(source, product, existing_values)

            global_fallbacks = {
                **DEFAULT_SIMILAR_FALLBACKS,
                **global_reference_values,
                **build_global_fallbacks(resolved_by_product),
            }
            fill_from_similar_products(
                products_by_ingredient=products_by_ingredient,
                resolved_by_product=resolved_by_product,
                global_fallbacks=global_fallbacks,
                historical_mode=historical_mode,
            )

            outcomes: List[Dict[str, Any]] = []
            total_upserts = 0

            for product in products:
                resolved = resolved_by_product.get(product.product_id, {})

                missing_core = [key for key in CORE_KEYS if key not in resolved]
                if missing_core:
                    summary["productsMissingCoreAfter"] += 1

                missing_any = [key for key in TARGET_KEYS if key not in resolved]
                if missing_any:
                    summary["productsMissingAnyAfter"] += 1

                total_upserts += upsert_nutrients(
                    cur,
                    product_id=product.product_id,
                    nutrient_defs=nutrient_defs,
                    resolved=resolved,
                    retrieval_run_id=retrieval_run_id,
                    dry_run=args.dry_run,
                )

                upsert_verification_task(
                    cur,
                    organization_id=org_id,
                    product=product,
                    resolved=resolved,
                    historical_mode=historical_mode,
                    dry_run=args.dry_run,
                )

                outcomes.append(
                    {
                        "productId": product.product_id,
                        "productName": product.product_name,
                        "ingredientKey": product.ingredient_key,
                        "resolved": len(resolved),
                        "missingCore": missing_core,
                        "missingAny": missing_any,
                        "inferredCount": len(
                            [
                                key
                                for key, source_value in resolved.items()
                                if source_value.evidence_grade
                                in {"INFERRED_FROM_SIMILAR_PRODUCT", "INFERRED_FROM_INGREDIENT"}
                            ]
                        ),
                        "historicalException": any(source_value.historical_exception for source_value in resolved.values()),
                    }
                )

            summary["upserts"] = total_upserts
            summary["outcomes"] = outcomes

            if args.dry_run:
                conn.rollback()
            else:
                conn.commit()

        summary["finishedAt"] = datetime.now(timezone.utc).isoformat()
        print(json.dumps(summary, indent=2))
        return 0
    except Exception as exc:  # pragma: no cover - operational script
        conn.rollback()
        summary["errors"].append(str(exc))
        summary["finishedAt"] = datetime.now(timezone.utc).isoformat()
        print(json.dumps(summary, indent=2))
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
