#!/usr/bin/env python3
"""
Recompute/freeze new label snapshots for already-served meals using existing lot consumption events.

Why this exists:
- historical service events already point to frozen labels computed before nutrient enrichment
- this script writes new immutable label snapshots + lineage edges
- then repoints MealServiceEvent.finalLabelSnapshotId to the latest snapshot
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import psycopg2
import psycopg2.extras


MAJOR_ALLERGENS = {"milk", "egg", "fish", "shellfish", "tree_nuts", "peanuts", "wheat", "soy", "sesame"}

CORE_KEYS = [
    "kcal",
    "fat_g",
    "sat_fat_g",
    "trans_fat_g",
    "cholesterol_mg",
    "sodium_mg",
    "carb_g",
    "fiber_g",
    "sugars_g",
    "added_sugars_g",
    "protein_g",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh served-meal frozen labels from current nutrient rows.")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"), help="Postgres connection string")
    parser.add_argument("--organization-slug", default="primary")
    parser.add_argument("--month", default="2026-02", help="YYYY-MM filter")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    return parser.parse_args()


def round_calories(value: float) -> int:
    if value < 5:
        return 0
    if value <= 50:
        return int(round(value / 5.0) * 5)
    return int(round(value / 10.0) * 10)


def round_fat_like(value: float) -> float:
    if value < 0.5:
        return 0.0
    if value < 5:
        return round(value * 2.0) / 2.0
    return float(round(value))


def round_general_g(value: float) -> int:
    if value < 0.5:
        return 0
    return int(round(value))


def round_sodium_mg(value: float) -> int:
    if value < 5:
        return 0
    if value <= 140:
        return int(round(value / 5.0) * 5)
    return int(round(value / 10.0) * 10)


def round_cholesterol_mg(value: float) -> int:
    if value < 2:
        return 0
    return int(round(value / 5.0) * 5)


def get_org_id(cur: psycopg2.extensions.cursor, slug: str) -> str:
    cur.execute('select id from "Organization" where slug=%s limit 1', (slug,))
    row = cur.fetchone()
    if not row:
        raise RuntimeError(f'Organization slug "{slug}" not found')
    return row[0]


def month_bounds(month: str) -> Tuple[str, str]:
    if not re.match(r"^\d{4}-\d{2}$", month):
        raise RuntimeError(f"Invalid month: {month}")
    start = f"{month}-01"
    year = int(month[0:4])
    mon = int(month[5:7])
    if mon == 12:
        end = f"{year + 1:04d}-01-01"
    else:
        end = f"{year:04d}-{mon + 1:02d}-01"
    return start, end


def fetch_events(
    cur: psycopg2.extensions.cursor,
    *,
    organization_id: str,
    month: str,
    limit: int,
) -> List[Dict[str, Any]]:
    start_date, end_date = month_bounds(month)
    sql = """
      select
        mse.id,
        mse."organizationId",
        mse."clientId",
        mse."skuId",
        mse."mealScheduleId",
        mse."servedByUserId",
        mse."finalLabelSnapshotId",
        ms."plannedServings",
        ms."serviceDate",
        ms."mealSlot",
        sku.code,
        sku.name
      from "MealServiceEvent" mse
      join "MealSchedule" ms on ms.id = mse."mealScheduleId"
      join "Sku" sku on sku.id = mse."skuId"
      where mse."organizationId" = %s
        and mse."servedAt" >= %s::date
        and mse."servedAt" < %s::date
      order by mse."servedAt" asc
    """
    if limit > 0:
        sql += f" limit {int(limit)}"
    cur.execute(sql, (organization_id, start_date, end_date))
    rows = cur.fetchall()
    out: List[Dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "event_id": r[0],
                "organization_id": r[1],
                "client_id": r[2],
                "sku_id": r[3],
                "meal_schedule_id": r[4],
                "served_by_user_id": r[5],
                "prior_label_id": r[6],
                "planned_servings": float(r[7]) if r[7] is not None else 1.0,
                "service_date": r[8],
                "meal_slot": r[9],
                "sku_code": r[10],
                "sku_name": r[11],
            }
        )
    return out


def fetch_recipe_lines(cur: psycopg2.extensions.cursor, sku_id: str) -> List[Dict[str, Any]]:
    cur.execute(
        """
        select r.id
        from "Recipe" r
        where r."skuId" = %s and r.active = true
        order by r."updatedAt" desc
        limit 1
        """,
        (sku_id,),
    )
    row = cur.fetchone()
    if not row:
        return []
    recipe_id = row[0]
    cur.execute(
        """
        select
          rl.id,
          rl."lineOrder",
          rl."targetGPerServing",
          i.id,
          i.name,
          i."allergenTags"
        from "RecipeLine" rl
        join "IngredientCatalog" i on i.id = rl."ingredientId"
        where rl."recipeId" = %s
        order by rl."lineOrder" asc
        """,
        (recipe_id,),
    )
    lines = []
    for r in cur.fetchall():
        lines.append(
            {
                "recipe_line_id": r[0],
                "line_order": r[1],
                "target_g_per_serving": float(r[2]),
                "ingredient_id": r[3],
                "ingredient_name": r[4],
                "allergens": list(r[5] or []),
            }
        )
    return lines


def fetch_consumed_lots(cur: psycopg2.extensions.cursor, event_id: str) -> List[Dict[str, Any]]:
    cur.execute(
        """
        select
          lce.id,
          lce."recipeLineId",
          lce."inventoryLotId",
          lce."gramsConsumed",
          lot."productId",
          p.name as product_name,
          i.id as ingredient_id,
          i.name as ingredient_name,
          i."allergenTags",
          coalesce(
            jsonb_object_agg(nd.key, pnv."valuePer100g") filter (where nd.key is not null and pnv."valuePer100g" is not null),
            '{}'::jsonb
          ) as nutrients
        from "LotConsumptionEvent" lce
        join "InventoryLot" lot on lot.id = lce."inventoryLotId"
        join "ProductCatalog" p on p.id = lot."productId"
        join "IngredientCatalog" i on i.id = p."ingredientId"
        left join "ProductNutrientValue" pnv on pnv."productId" = p.id
        left join "NutrientDefinition" nd on nd.id = pnv."nutrientDefinitionId"
        where lce."mealServiceEventId" = %s
        group by
          lce.id, lce."recipeLineId", lce."inventoryLotId", lce."gramsConsumed",
          lot."productId", p.name, i.id, i.name, i."allergenTags"
        order by lce.id asc
        """,
        (event_id,),
    )
    rows = []
    for r in cur.fetchall():
        rows.append(
            {
                "consumption_id": r[0],
                "recipe_line_id": r[1],
                "lot_id": r[2],
                "grams_consumed": float(r[3]),
                "product_id": r[4],
                "product_name": r[5],
                "ingredient_id": r[6],
                "ingredient_name": r[7],
                "ingredient_allergens": list(r[8] or []),
                "nutrients_per_100g": dict(r[9] or {}),
            }
        )
    return rows


def compute_label_payload(
    *,
    lines: List[Dict[str, Any]],
    consumed_lots: List[Dict[str, Any]],
    servings: float,
) -> Dict[str, Any]:
    servings_safe = servings if servings > 0 else 1.0
    total_nutrients: Dict[str, float] = defaultdict(float)
    total_weight = 0.0

    for lot in consumed_lots:
        grams = lot["grams_consumed"]
        total_weight += grams
        nutrients = lot["nutrients_per_100g"]
        for key, raw in nutrients.items():
            try:
                value = float(raw)
            except (TypeError, ValueError):
                continue
            total_nutrients[key] += (value * grams) / 100.0

    per_serving: Dict[str, float] = {}
    for key, total_value in total_nutrients.items():
        per_serving[key] = total_value / servings_safe

    # Keep parity with engine behavior for core keys.
    for key in CORE_KEYS:
        if key not in per_serving:
            per_serving[key] = 0.0

    rounded_fda = {
        "calories": round_calories(float(per_serving.get("kcal", 0.0))),
        "fatG": round_fat_like(float(per_serving.get("fat_g", 0.0))),
        "satFatG": round_fat_like(float(per_serving.get("sat_fat_g", 0.0))),
        "transFatG": round_fat_like(float(per_serving.get("trans_fat_g", 0.0))),
        "cholesterolMg": round_cholesterol_mg(float(per_serving.get("cholesterol_mg", 0.0))),
        "sodiumMg": round_sodium_mg(float(per_serving.get("sodium_mg", 0.0))),
        "carbG": round_general_g(float(per_serving.get("carb_g", 0.0))),
        "fiberG": round_general_g(float(per_serving.get("fiber_g", 0.0))),
        "sugarsG": round_general_g(float(per_serving.get("sugars_g", 0.0))),
        "addedSugarsG": round_general_g(float(per_serving.get("added_sugars_g", 0.0))),
        "proteinG": round_general_g(float(per_serving.get("protein_g", 0.0))),
    }

    ingredient_declaration = "Ingredients: " + ", ".join(
        [x["ingredient_name"] for x in sorted(lines, key=lambda y: y["target_g_per_serving"], reverse=True)]
    )

    allergen_set = set()
    for line in lines:
        for allergen in line["allergens"]:
            if allergen in MAJOR_ALLERGENS:
                allergen_set.add(allergen)
    if allergen_set:
        allergen_statement = "Contains: " + ", ".join(sorted([a.replace("_", " ") for a in allergen_set]))
    else:
        allergen_statement = "Contains: None of the 9 major allergens"

    protein = float(per_serving.get("protein_g", 0.0))
    carb = float(per_serving.get("carb_g", 0.0))
    fat = float(per_serving.get("fat_g", 0.0))
    macro_kcal = protein * 4.0 + carb * 4.0 + fat * 9.0
    delta = macro_kcal - float(rounded_fda["calories"])

    return {
        "servingWeightG": total_weight / servings_safe,
        "perServing": per_serving,
        "roundedFda": rounded_fda,
        "ingredientDeclaration": ingredient_declaration,
        "allergenStatement": allergen_statement,
        "qa": {
            "macroKcal": macro_kcal,
            "labeledCalories": rounded_fda["calories"],
            "delta": delta,
            "pass": abs(delta) <= 20,
        },
    }


def next_label_version(
    cur: psycopg2.extensions.cursor, organization_id: str, label_type: str, external_ref_id: str
) -> int:
    cur.execute(
        """
        select count(*)
        from "LabelSnapshot"
        where "organizationId" = %s and "labelType" = %s and "externalRefId" = %s
        """,
        (organization_id, label_type, external_ref_id),
    )
    return int(cur.fetchone()[0]) + 1


def insert_label_snapshot(
    cur: psycopg2.extensions.cursor,
    *,
    organization_id: str,
    label_type: str,
    external_ref_id: str,
    title: str,
    payload: Dict[str, Any],
    created_by: str,
) -> str:
    version = next_label_version(cur, organization_id, label_type, external_ref_id)
    cur.execute(
        """
        insert into "LabelSnapshot" (
          id, "organizationId", "labelType", "externalRefId", title, "renderPayload", "frozenAt",
          "createdAt", "createdBy", "updatedAt", version
        )
        values (
          %s, %s, %s, %s, %s, %s::jsonb, now(),
          now(), %s, now(), %s
        )
        returning id
        """,
        (
            str(uuid.uuid4()),
            organization_id,
            label_type,
            external_ref_id,
            title,
            json.dumps(payload),
            created_by,
            version,
        ),
    )
    return str(cur.fetchone()[0])


def insert_edge(
    cur: psycopg2.extensions.cursor,
    *,
    parent_label_id: str,
    child_label_id: str,
    edge_type: str,
    created_by: str,
) -> None:
    cur.execute(
        """
        insert into "LabelLineageEdge" (
          id, "parentLabelId", "childLabelId", "edgeType", "createdAt", "createdBy", "updatedAt", version
        )
        values (
          %s, %s, %s, %s, now(), %s, now(), 1
        )
        """,
        (str(uuid.uuid4()), parent_label_id, child_label_id, edge_type, created_by),
    )


def refresh_event(cur: psycopg2.extensions.cursor, event: Dict[str, Any], created_by: str) -> Dict[str, Any]:
    lines = fetch_recipe_lines(cur, event["sku_id"])
    if not lines:
        raise RuntimeError(f"No active recipe lines for sku_id={event['sku_id']}")

    consumed_lots = fetch_consumed_lots(cur, event["event_id"])
    if not consumed_lots:
        raise RuntimeError(f"No lot consumptions for meal_service_event={event['event_id']}")

    payload = compute_label_payload(lines=lines, consumed_lots=consumed_lots, servings=event["planned_servings"])

    sku_label_id = insert_label_snapshot(
        cur,
        organization_id=event["organization_id"],
        label_type="SKU",
        external_ref_id=event["sku_id"],
        title=f"{event['sku_code']} - {event['sku_name']}",
        payload=payload,
        created_by=created_by,
    )

    for lot in consumed_lots:
        ingredient_label_id = insert_label_snapshot(
            cur,
            organization_id=event["organization_id"],
            label_type="INGREDIENT",
            external_ref_id=lot["ingredient_id"],
            title=lot["ingredient_name"],
            payload={"ingredientName": lot["ingredient_name"]},
            created_by=created_by,
        )
        product_label_id = insert_label_snapshot(
            cur,
            organization_id=event["organization_id"],
            label_type="PRODUCT",
            external_ref_id=lot["product_id"],
            title=lot["product_name"],
            payload={"productName": lot["product_name"]},
            created_by=created_by,
        )
        lot_label_id = insert_label_snapshot(
            cur,
            organization_id=event["organization_id"],
            label_type="LOT",
            external_ref_id=lot["lot_id"],
            title=f"Lot {lot['lot_id']}",
            payload={
                "lotId": lot["lot_id"],
                "productName": lot["product_name"],
                "gramsConsumed": lot["grams_consumed"],
                "nutrientsPer100g": lot["nutrients_per_100g"],
            },
            created_by=created_by,
        )

        insert_edge(
            cur,
            parent_label_id=sku_label_id,
            child_label_id=ingredient_label_id,
            edge_type="SKU_CONTAINS_INGREDIENT",
            created_by=created_by,
        )
        insert_edge(
            cur,
            parent_label_id=ingredient_label_id,
            child_label_id=product_label_id,
            edge_type="INGREDIENT_RESOLVED_TO_PRODUCT",
            created_by=created_by,
        )
        insert_edge(
            cur,
            parent_label_id=product_label_id,
            child_label_id=lot_label_id,
            edge_type="PRODUCT_CONSUMED_FROM_LOT",
            created_by=created_by,
        )

    cur.execute(
        """
        update "MealServiceEvent"
        set "finalLabelSnapshotId" = %s, "updatedAt" = now(), version = version + 1
        where id = %s
        """,
        (sku_label_id, event["event_id"]),
    )

    return {
        "eventId": event["event_id"],
        "priorLabelId": event["prior_label_id"],
        "newLabelId": sku_label_id,
        "consumedLots": len(consumed_lots),
    }


def main() -> int:
    args = parse_args()
    if not args.database_url:
        print("Missing DATABASE_URL. Pass --database-url or export DATABASE_URL.", file=sys.stderr)
        return 1

    conn = psycopg2.connect(args.database_url)
    conn.autocommit = False
    psycopg2.extras.register_default_jsonb(conn)

    summary: Dict[str, Any] = {
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "organizationSlug": args.organization_slug,
        "month": args.month,
        "dryRun": bool(args.dry_run),
        "events": [],
        "errors": [],
    }

    try:
        with conn.cursor() as cur:
            org_id = get_org_id(cur, args.organization_slug)
            summary["organizationId"] = org_id
            events = fetch_events(cur, organization_id=org_id, month=args.month, limit=args.limit)
            summary["eventCount"] = len(events)

            for event in events:
                try:
                    result = refresh_event(cur, event, created_by="agent")
                    summary["events"].append(result)
                except Exception as event_error:
                    summary["errors"].append(
                        {"eventId": event["event_id"], "message": str(event_error)}
                    )

            if args.dry_run:
                conn.rollback()
            else:
                conn.commit()

        summary["finishedAt"] = datetime.now(timezone.utc).isoformat()
        summary["refreshedEvents"] = len(summary["events"])
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
