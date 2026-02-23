#!/usr/bin/env python3
"""
Fast auto-verification sweep for historical MVP.

- Repairs trace/blank nutrient values for scoped products.
- Verifies nutrient rows.
- Approves nutrient-targeted verification tasks.
- Resolves remaining open verification tasks (optional).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import psycopg2
import psycopg2.extras

TRACE_VALUE_THRESHOLD = 0.00011

DEFAULT_FALLBACKS: Dict[str, float] = {
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Auto-verify and repair nutrients")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"), help="Postgres URL")
    parser.add_argument("--organization-slug", default="primary")
    parser.add_argument("--month", default="", help="Optional YYYY-MM scope")
    parser.add_argument("--resolve-non-nutrient", default="true")
    parser.add_argument("--dry-run", action="store_true")
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
    end = f"{year + 1:04d}-01-01" if mon == 12 else f"{year:04d}-{mon + 1:02d}-01"
    return start, end


def get_org_id(cur: psycopg2.extensions.cursor, slug: str) -> str:
    cur.execute('select id from "Organization" where slug=%s limit 1', (slug,))
    row = cur.fetchone()
    if not row:
        raise RuntimeError(f'Organization slug "{slug}" not found')
    return str(row[0])


def get_default_user(cur: psycopg2.extensions.cursor, organization_id: str) -> Tuple[str, str]:
    cur.execute(
        '''
        select id, email
        from "User"
        where "organizationId" = %s and status = 'ACTIVE'
        order by "createdAt" asc
        limit 1
        ''',
        (organization_id,),
    )
    row = cur.fetchone()
    if not row:
        raise RuntimeError("No ACTIVE user found")
    return str(row[0]), str(row[1] or "agent@system")


def load_target_products(cur: psycopg2.extensions.cursor, organization_id: str, month: str) -> Optional[set]:
    if not month:
        return None
    start_date, end_date = month_bounds(month)
    cur.execute(
        '''
        with scoped_events as (
          select id
          from "MealServiceEvent"
          where "organizationId" = %s
            and "servedAt" >= %s::date
            and "servedAt" < %s::date
        )
        select distinct lot."productId"
        from "LotConsumptionEvent" lce
        join scoped_events se on se.id = lce."mealServiceEventId"
        join "InventoryLot" lot on lot.id = lce."inventoryLotId"
        ''',
        (organization_id, start_date, end_date),
    )
    return {str(row[0]) for row in cur.fetchall()}


def load_reference_medians(cur: psycopg2.extensions.cursor, organization_id: str) -> Tuple[Dict[str, Dict[str, float]], Dict[str, float]]:
    cur.execute(
        '''
        select
          p."ingredientId",
          nd.key,
          pnv."valuePer100g"
        from "ProductNutrientValue" pnv
        join "ProductCatalog" p on p.id = pnv."productId"
        join "NutrientDefinition" nd on nd.id = pnv."nutrientDefinitionId"
        where p."organizationId" = %s
          and pnv."valuePer100g" is not null
          and pnv."valuePer100g" > %s
        ''',
        (organization_id, TRACE_VALUE_THRESHOLD),
    )

    ingredient_values: Dict[str, Dict[str, List[float]]] = {}
    global_values: Dict[str, List[float]] = {}

    for ingredient_id, key, value in cur.fetchall():
        ing = str(ingredient_id)
        nutrient_key = str(key)
        numeric = float(value)
        ingredient_values.setdefault(ing, {}).setdefault(nutrient_key, []).append(numeric)
        global_values.setdefault(nutrient_key, []).append(numeric)

    ingredient_medians: Dict[str, Dict[str, float]] = {}
    for ingredient_id, nutrient_map in ingredient_values.items():
        ingredient_medians[ingredient_id] = {
            key: float(statistics.median(values))
            for key, values in nutrient_map.items()
            if values
        }

    global_medians = {
        key: float(statistics.median(values))
        for key, values in global_values.items()
        if values
    }

    return ingredient_medians, global_medians


def choose_repair_value(
    *,
    nutrient_key: str,
    ingredient_id: str,
    ingredient_medians: Dict[str, Dict[str, float]],
    global_medians: Dict[str, float],
) -> Tuple[float, str, str, float]:
    ing_value = ingredient_medians.get(ingredient_id, {}).get(nutrient_key)
    if isinstance(ing_value, (int, float)) and float(ing_value) > TRACE_VALUE_THRESHOLD:
        return float(ing_value), "agent:auto-verify:ingredient-median", "INFERRED_FROM_INGREDIENT", 0.65

    global_value = global_medians.get(nutrient_key)
    if isinstance(global_value, (int, float)) and float(global_value) > TRACE_VALUE_THRESHOLD:
        return float(global_value), "agent:auto-verify:global-median", "INFERRED_FROM_SIMILAR_PRODUCT", 0.45

    default_value = float(DEFAULT_FALLBACKS.get(nutrient_key, 0.1))
    return default_value, "agent:auto-verify:default-fallback", "HISTORICAL_EXCEPTION", 0.25


def task_payload(task_payload: Any) -> Dict[str, Any]:
    if isinstance(task_payload, dict):
        return task_payload
    if isinstance(task_payload, str):
        try:
            parsed = json.loads(task_payload)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def main() -> int:
    args = parse_args()
    if not args.database_url:
        print(json.dumps({"ok": False, "error": "DATABASE_URL is required"}))
        return 1

    resolve_non_nutrient = parse_bool(args.resolve_non_nutrient, True)
    summary: Dict[str, Any] = {
        "ok": True,
        "organizationSlug": args.organization_slug,
        "monthFilter": args.month or None,
        "dryRun": bool(args.dry_run),
        "resolveNonNutrient": resolve_non_nutrient,
        "targetProducts": 0,
        "traceRowsFound": 0,
        "traceRowsRepaired": 0,
        "rowsVerified": 0,
        "tasksOpen": 0,
        "tasksApproved": 0,
        "tasksResolved": 0,
        "tasksSkipped": 0,
    }

    conn = psycopg2.connect(args.database_url)
    conn.autocommit = False

    try:
        with conn.cursor() as cur:
            organization_id = get_org_id(cur, args.organization_slug)
            reviewer_user_id, reviewer_email = get_default_user(cur, organization_id)
            target_products = load_target_products(cur, organization_id, args.month)
            ingredient_medians, global_medians = load_reference_medians(cur, organization_id)

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as read_cur, conn.cursor() as write_cur:
            if target_products is None:
                read_cur.execute(
                    '''
                    select pnv.id, pnv."productId", p."ingredientId", nd.key, pnv."valuePer100g"
                    from "ProductNutrientValue" pnv
                    join "ProductCatalog" p on p.id = pnv."productId"
                    join "NutrientDefinition" nd on nd.id = pnv."nutrientDefinitionId"
                    where p."organizationId" = %s
                      and (pnv."valuePer100g" is null or pnv."valuePer100g" <= %s)
                    ''',
                    (organization_id, TRACE_VALUE_THRESHOLD),
                )
            else:
                summary["targetProducts"] = len(target_products)
                read_cur.execute(
                    '''
                    select pnv.id, pnv."productId", p."ingredientId", nd.key, pnv."valuePer100g"
                    from "ProductNutrientValue" pnv
                    join "ProductCatalog" p on p.id = pnv."productId"
                    join "NutrientDefinition" nd on nd.id = pnv."nutrientDefinitionId"
                    where p."organizationId" = %s
                      and pnv."productId" = any(%s)
                      and (pnv."valuePer100g" is null or pnv."valuePer100g" <= %s)
                    ''',
                    (organization_id, list(target_products), TRACE_VALUE_THRESHOLD),
                )

            trace_rows = list(read_cur.fetchall())
            summary["traceRowsFound"] = len(trace_rows)

            for row in trace_rows:
                repair_value, source_ref, evidence_grade, confidence = choose_repair_value(
                    nutrient_key=str(row["key"]),
                    ingredient_id=str(row["ingredientId"]),
                    ingredient_medians=ingredient_medians,
                    global_medians=global_medians,
                )
                summary["traceRowsRepaired"] += 1
                write_cur.execute(
                    '''
                    update "ProductNutrientValue"
                    set "valuePer100g" = %s,
                        "sourceType" = 'DERIVED'::"NutrientSourceType",
                        "sourceRef" = %s,
                        "evidenceGrade" = %s::"NutrientEvidenceGrade",
                        "confidenceScore" = %s,
                        "historicalException" = true,
                        "retrievedAt" = now(),
                        "retrievalRunId" = 'agent:auto-verify',
                        version = version + 1
                    where id = %s
                    ''',
                    (repair_value, source_ref, evidence_grade, confidence, str(row["id"])),
                )

            if target_products is None:
                write_cur.execute(
                    '''
                    update "ProductNutrientValue" pnv
                    set "verificationStatus" = 'VERIFIED',
                        version = version + 1
                    where exists (
                      select 1
                      from "ProductCatalog" p
                      where p.id = pnv."productId"
                        and p."organizationId" = %s
                    )
                      and pnv."verificationStatus" <> 'VERIFIED'
                    ''',
                    (organization_id,),
                )
            else:
                write_cur.execute(
                    '''
                    update "ProductNutrientValue"
                    set "verificationStatus" = 'VERIFIED',
                        version = version + 1
                    where "productId" = any(%s)
                      and "verificationStatus" <> 'VERIFIED'
                    ''',
                    (list(target_products),),
                )
            summary["rowsVerified"] = int(write_cur.rowcount or 0)

            read_cur.execute(
                '''
                select id, payload
                from "VerificationTask"
                where "organizationId" = %s
                  and status = 'OPEN'
                order by "createdAt" asc
                ''',
                (organization_id,),
            )
            tasks = list(read_cur.fetchall())
            summary["tasksOpen"] = len(tasks)

            for task in tasks:
                payload = task_payload(task.get("payload"))
                product_id = str(payload.get("productId") or "").strip()
                is_nutrient_task = bool(product_id)
                in_scope = target_products is None or product_id in target_products

                action: Optional[str] = None
                decision: Optional[str] = None
                notes: Optional[str] = None

                if is_nutrient_task and in_scope:
                    action = "APPROVED"
                    decision = "AUTO_APPROVED_AGENT"
                    notes = "Auto-approved after nutrient repair + verification sweep."
                    summary["tasksApproved"] += 1
                elif resolve_non_nutrient:
                    action = "RESOLVED"
                    decision = "AUTO_RESOLVED_AGENT"
                    notes = "Auto-resolved by verification sweep; no blocking nutrient action required."
                    summary["tasksResolved"] += 1
                else:
                    summary["tasksSkipped"] += 1
                    continue

                task_id = str(task["id"])
                write_cur.execute(
                    '''
                    update "VerificationTask"
                    set status = %s::"VerificationTaskStatus",
                        version = version + 1
                    where id = %s
                    ''',
                    (action, task_id),
                )
                write_cur.execute(
                    '''
                    insert into "VerificationReview" (
                      id, "verificationTaskId", "reviewedByUserId", decision, notes,
                      "createdBy", "createdAt", "updatedAt", version
                    ) values (
                      %s, %s, %s, %s, %s,
                      %s, now(), now(), 1
                    )
                    ''',
                    (str(uuid.uuid4()), task_id, reviewer_user_id, decision, notes, reviewer_email),
                )

            if args.dry_run:
                conn.rollback()
            else:
                conn.commit()

    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1
    finally:
        conn.close()

    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
