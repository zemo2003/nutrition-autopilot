#!/usr/bin/env python3
"""
Recompute/freeze new label snapshots for served meals with enriched lineage payloads.

This script:
- regenerates SKU/INGREDIENT/PRODUCT/LOT snapshots for a target month
- includes per-serving/per-100g nutrient payloads and evidence summaries
- updates MealServiceEvent.finalLabelSnapshotId to the newest SKU snapshot
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
from typing import Any, Dict, Iterable, List, Optional, Tuple

import psycopg2
import psycopg2.extras

NUTRIENT_KEYS = [
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

MAJOR_ALLERGENS = {"milk", "egg", "fish", "shellfish", "tree_nuts", "peanuts", "wheat", "soy", "sesame"}
INFERRED_GRADES = {"INFERRED_FROM_INGREDIENT", "INFERRED_FROM_SIMILAR_PRODUCT"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh served-meal frozen labels from current nutrient rows")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"), help="Postgres connection string")
    parser.add_argument("--organization-slug", default="primary")
    parser.add_argument("--month", default=datetime.now(timezone.utc).strftime("%Y-%m"), help="YYYY-MM filter")
    parser.add_argument("--only-final-events", default="true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
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
        raise RuntimeError(f"Invalid month: {month}")
    year = int(month[0:4])
    mon = int(month[5:7])
    start = f"{year:04d}-{mon:02d}-01"
    if mon == 12:
        end = f"{year + 1:04d}-01-01"
    else:
        end = f"{year:04d}-{mon + 1:02d}-01"
    return start, end


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
    return str(row[0])


def fetch_events(
    cur: psycopg2.extensions.cursor,
    *,
    organization_id: str,
    month: str,
    only_final_events: bool,
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
    """
    params: List[Any] = [organization_id, start_date, end_date]
    if only_final_events:
        sql += ' and mse."finalLabelSnapshotId" is not null'
    sql += ' order by mse."servedAt" asc'
    if limit > 0:
        sql += f" limit {int(limit)}"

    cur.execute(sql, tuple(params))
    rows = cur.fetchall()
    out: List[Dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "event_id": str(r[0]),
                "organization_id": str(r[1]),
                "client_id": str(r[2]),
                "sku_id": str(r[3]),
                "meal_schedule_id": str(r[4]),
                "served_by_user_id": str(r[5]),
                "prior_label_id": r[6],
                "planned_servings": float(r[7]) if r[7] is not None else 1.0,
                "service_date": r[8],
                "meal_slot": str(r[9]),
                "sku_code": str(r[10]),
                "sku_name": str(r[11]),
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
    recipe_id = str(row[0])

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

    lines: List[Dict[str, Any]] = []
    for r in cur.fetchall():
        lines.append(
            {
                "recipe_line_id": str(r[0]),
                "line_order": int(r[1]),
                "target_g_per_serving": float(r[2]),
                "ingredient_id": str(r[3]),
                "ingredient_name": str(r[4]),
                "allergens": list(r[5] or []),
            }
        )
    return lines


def empty_nutrient_map() -> Dict[str, float]:
    return {key: 0.0 for key in NUTRIENT_KEYS}


def fetch_consumed_lots(cur: psycopg2.extensions.cursor, event_id: str) -> List[Dict[str, Any]]:
    cur.execute(
        """
        select
          lce.id,
          lce."recipeLineId",
          lce."inventoryLotId",
          lce."gramsConsumed",
          lot."lotCode",
          lot."sourceOrderRef",
          lot."receivedAt",
          lot."expiresAt",
          lot."productId",
          p.name as product_name,
          p.brand,
          p.upc,
          p.vendor,
          i.id as ingredient_id,
          i.name as ingredient_name,
          i."allergenTags",
          coalesce(
            jsonb_agg(
              jsonb_build_object(
                'key', nd.key,
                'valuePer100g', pnv."valuePer100g",
                'sourceType', pnv."sourceType",
                'sourceRef', pnv."sourceRef",
                'verificationStatus', pnv."verificationStatus",
                'evidenceGrade', pnv."evidenceGrade",
                'confidenceScore', pnv."confidenceScore",
                'historicalException', pnv."historicalException"
              )
            ) filter (where nd.key is not null),
            '[]'::jsonb
          ) as nutrient_rows
        from "LotConsumptionEvent" lce
        join "InventoryLot" lot on lot.id = lce."inventoryLotId"
        join "ProductCatalog" p on p.id = lot."productId"
        join "IngredientCatalog" i on i.id = p."ingredientId"
        left join "ProductNutrientValue" pnv on pnv."productId" = p.id
        left join "NutrientDefinition" nd on nd.id = pnv."nutrientDefinitionId"
        where lce."mealServiceEventId" = %s
        group by
          lce.id,
          lce."recipeLineId",
          lce."inventoryLotId",
          lce."gramsConsumed",
          lot."lotCode",
          lot."sourceOrderRef",
          lot."receivedAt",
          lot."expiresAt",
          lot."productId",
          p.name,
          p.brand,
          p.upc,
          p.vendor,
          i.id,
          i.name,
          i."allergenTags"
        order by lce.id asc
        """,
        (event_id,),
    )

    rows: List[Dict[str, Any]] = []
    for r in cur.fetchall():
        nutrient_rows = list(r[16] or [])
        nutrients_per_100g = empty_nutrient_map()
        normalized_rows: List[Dict[str, Any]] = []
        for nutrient in nutrient_rows:
            key = nutrient.get("key")
            if key not in NUTRIENT_KEYS:
                continue
            raw_value = nutrient.get("valuePer100g")
            value = float(raw_value) if raw_value is not None else None
            if value is not None:
                nutrients_per_100g[key] = value
            normalized_rows.append(
                {
                    "key": key,
                    "valuePer100g": value,
                    "sourceType": str(nutrient.get("sourceType") or "DERIVED"),
                    "sourceRef": str(nutrient.get("sourceRef") or ""),
                    "verificationStatus": str(nutrient.get("verificationStatus") or "NEEDS_REVIEW"),
                    "evidenceGrade": str(nutrient.get("evidenceGrade") or "HISTORICAL_EXCEPTION"),
                    "confidenceScore": float(nutrient.get("confidenceScore") or 0),
                    "historicalException": bool(nutrient.get("historicalException") or False),
                }
            )

        synthetic_lot = str(r[12] or "") == "SYSTEM_SYNTHETIC" or str(r[11] or "").startswith("SYNTH-")
        rows.append(
            {
                "consumption_id": str(r[0]),
                "recipe_line_id": str(r[1]),
                "lot_id": str(r[2]),
                "grams_consumed": float(r[3]),
                "lot_code": r[4],
                "source_order_ref": r[5],
                "received_at": r[6].isoformat() if r[6] is not None else None,
                "expires_at": r[7].isoformat() if r[7] is not None else None,
                "product_id": str(r[8]),
                "product_name": str(r[9]),
                "product_brand": r[10],
                "product_upc": r[11],
                "product_vendor": r[12],
                "ingredient_id": str(r[13]),
                "ingredient_name": str(r[14]),
                "ingredient_allergens": list(r[15] or []),
                "nutrient_rows": normalized_rows,
                "nutrients_per_100g": nutrients_per_100g,
                "synthetic_lot": synthetic_lot,
            }
        )
    return rows


def summarize_evidence(rows: Iterable[Dict[str, Any]], synthetic_lot: bool) -> Dict[str, Any]:
    grade_breakdown: Dict[str, int] = defaultdict(int)
    source_refs = set()
    reason_codes = set()

    verified = 0
    inferred = 0
    exception = 0
    unverified = 0
    total = 0

    for row in rows:
        total += 1
        grade = str(row.get("evidenceGrade") or "HISTORICAL_EXCEPTION")
        grade_breakdown[grade] += 1
        source_ref = str(row.get("sourceRef") or "")
        if source_ref:
            source_refs.add(source_ref)

        verification_status = str(row.get("verificationStatus") or "NEEDS_REVIEW")
        if verification_status == "VERIFIED":
            verified += 1
        else:
            unverified += 1
            reason_codes.add("UNVERIFIED_SOURCE")

        if grade in INFERRED_GRADES:
            inferred += 1
        if bool(row.get("historicalException")) or grade == "HISTORICAL_EXCEPTION":
            exception += 1
            reason_codes.add("HISTORICAL_EXCEPTION")

    if synthetic_lot:
        reason_codes.add("SYNTHETIC_LOT_USAGE")
        reason_codes.add("HISTORICAL_EXCEPTION")

    provisional = unverified > 0 or inferred > 0 or exception > 0 or synthetic_lot

    return {
        "verifiedCount": verified,
        "inferredCount": inferred,
        "exceptionCount": exception,
        "unverifiedCount": unverified,
        "totalNutrientRows": total,
        "provisional": provisional,
        "sourceRefs": sorted(source_refs),
        "gradeBreakdown": dict(grade_breakdown),
        "reasonCodes": sorted(reason_codes),
    }


def aggregate_nutrients(lots: List[Dict[str, Any]], servings: float) -> Tuple[Dict[str, float], Dict[str, float]]:
    totals = empty_nutrient_map()
    per_serving = empty_nutrient_map()
    safe_servings = servings if servings > 0 else 1.0

    for lot in lots:
        grams = float(lot["grams_consumed"])
        nutrient_map = lot["nutrients_per_100g"]
        for key in NUTRIENT_KEYS:
            totals[key] += (float(nutrient_map.get(key, 0) or 0) * grams) / 100.0

    for key in NUTRIENT_KEYS:
        per_serving[key] = totals[key] / safe_servings

    return totals, per_serving


def compute_sku_payload(
    *,
    lines: List[Dict[str, Any]],
    consumed_lots: List[Dict[str, Any]],
    servings: float,
) -> Dict[str, Any]:
    total_weight = sum(float(lot["grams_consumed"]) for lot in consumed_lots)
    _, per_serving = aggregate_nutrients(consumed_lots, servings)

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

    all_nutrient_rows = [nutrient for lot in consumed_lots for nutrient in lot["nutrient_rows"]]
    evidence = summarize_evidence(all_nutrient_rows, any(lot["synthetic_lot"] for lot in consumed_lots))

    return {
        "servingWeightG": total_weight / (servings if servings > 0 else 1.0),
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
        "evidenceSummary": {
            "verifiedCount": evidence["verifiedCount"],
            "inferredCount": evidence["inferredCount"],
            "exceptionCount": evidence["exceptionCount"],
            "unverifiedCount": evidence["unverifiedCount"],
            "totalNutrientRows": evidence["totalNutrientRows"],
            "sourceRefs": evidence["sourceRefs"],
            "gradeBreakdown": evidence["gradeBreakdown"],
            "provisional": evidence["provisional"],
        },
        "reasonCodes": evidence["reasonCodes"],
        "provisional": evidence["provisional"],
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


def group_by_key(rows: List[Dict[str, Any]], key: str) -> Dict[str, List[Dict[str, Any]]]:
    out: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in rows:
        out[str(row[key])].append(row)
    return out


def refresh_event(cur: psycopg2.extensions.cursor, event: Dict[str, Any], created_by: str) -> Dict[str, Any]:
    lines = fetch_recipe_lines(cur, event["sku_id"])
    if not lines:
        raise RuntimeError(f"No active recipe lines for sku_id={event['sku_id']}")

    consumed_lots = fetch_consumed_lots(cur, event["event_id"])
    if not consumed_lots:
        raise RuntimeError(f"No lot consumptions for meal_service_event={event['event_id']}")

    sku_payload = compute_sku_payload(lines=lines, consumed_lots=consumed_lots, servings=event["planned_servings"])

    sku_label_id = insert_label_snapshot(
        cur,
        organization_id=event["organization_id"],
        label_type="SKU",
        external_ref_id=event["sku_id"],
        title=f"{event['sku_code']} - {event['sku_name']}",
        payload=sku_payload,
        created_by=created_by,
    )

    by_ingredient = group_by_key(consumed_lots, "ingredient_id")
    for ingredient_id, ingredient_lots in by_ingredient.items():
        first_ing = ingredient_lots[0]
        nutrient_rows = [n for lot in ingredient_lots for n in lot["nutrient_rows"]]
        evidence = summarize_evidence(nutrient_rows, any(lot["synthetic_lot"] for lot in ingredient_lots))
        totals, per_serving = aggregate_nutrients(ingredient_lots, event["planned_servings"])

        allergen_tags = sorted({tag for lot in ingredient_lots for tag in lot["ingredient_allergens"]})

        ingredient_payload = {
            "ingredientId": ingredient_id,
            "ingredientName": first_ing["ingredient_name"],
            "consumedGrams": sum(float(lot["grams_consumed"]) for lot in ingredient_lots),
            "allergenEvidence": {
                "allergenTags": allergen_tags,
                "source": "IngredientCatalog",
            },
            "nutrientsTotal": totals,
            "nutrientsPerServing": per_serving,
            "evidenceSummary": {
                "verifiedCount": evidence["verifiedCount"],
                "inferredCount": evidence["inferredCount"],
                "exceptionCount": evidence["exceptionCount"],
                "unverifiedCount": evidence["unverifiedCount"],
                "totalNutrientRows": evidence["totalNutrientRows"],
                "sourceRefs": evidence["sourceRefs"],
                "gradeBreakdown": evidence["gradeBreakdown"],
                "provisional": evidence["provisional"],
            },
            "reasonCodes": evidence["reasonCodes"],
            "provisional": evidence["provisional"],
        }

        ingredient_label_id = insert_label_snapshot(
            cur,
            organization_id=event["organization_id"],
            label_type="INGREDIENT",
            external_ref_id=ingredient_id,
            title=str(first_ing["ingredient_name"]),
            payload=ingredient_payload,
            created_by=created_by,
        )

        insert_edge(
            cur,
            parent_label_id=sku_label_id,
            child_label_id=ingredient_label_id,
            edge_type="SKU_CONTAINS_INGREDIENT",
            created_by=created_by,
        )

        by_product = group_by_key(ingredient_lots, "product_id")
        for product_id, product_lots in by_product.items():
            first_product = product_lots[0]
            product_rows = first_product["nutrient_rows"]
            product_evidence = summarize_evidence(
                product_rows,
                any(lot["synthetic_lot"] for lot in product_lots),
            )

            product_payload = {
                "productId": product_id,
                "productName": first_product["product_name"],
                "brand": first_product["product_brand"],
                "upc": first_product["product_upc"],
                "vendor": first_product["product_vendor"],
                "nutrientsPer100g": first_product["nutrients_per_100g"],
                "sourceRefs": product_evidence["sourceRefs"],
                "gradeBreakdown": product_evidence["gradeBreakdown"],
                "verificationStatusSummary": {
                    "verified": len([x for x in product_rows if x["verificationStatus"] == "VERIFIED"]),
                    "needsReview": len([x for x in product_rows if x["verificationStatus"] == "NEEDS_REVIEW"]),
                    "rejected": len([x for x in product_rows if x["verificationStatus"] == "REJECTED"]),
                },
                "evidenceSummary": {
                    "verifiedCount": product_evidence["verifiedCount"],
                    "inferredCount": product_evidence["inferredCount"],
                    "exceptionCount": product_evidence["exceptionCount"],
                    "unverifiedCount": product_evidence["unverifiedCount"],
                    "totalNutrientRows": product_evidence["totalNutrientRows"],
                    "provisional": product_evidence["provisional"],
                },
                "reasonCodes": product_evidence["reasonCodes"],
                "provisional": product_evidence["provisional"],
            }

            product_label_id = insert_label_snapshot(
                cur,
                organization_id=event["organization_id"],
                label_type="PRODUCT",
                external_ref_id=product_id,
                title=str(first_product["product_name"]),
                payload=product_payload,
                created_by=created_by,
            )

            insert_edge(
                cur,
                parent_label_id=ingredient_label_id,
                child_label_id=product_label_id,
                edge_type="INGREDIENT_RESOLVED_TO_PRODUCT",
                created_by=created_by,
            )

            by_lot = group_by_key(product_lots, "lot_id")
            for lot_id, lot_entries in by_lot.items():
                first_lot = lot_entries[0]
                lot_evidence = summarize_evidence(first_lot["nutrient_rows"], bool(first_lot["synthetic_lot"]))
                lot_payload = {
                    "lotId": lot_id,
                    "lotCode": first_lot["lot_code"],
                    "productId": first_lot["product_id"],
                    "productName": first_lot["product_name"],
                    "sourceOrderRef": first_lot["source_order_ref"],
                    "receivedAt": first_lot["received_at"],
                    "expiresAt": first_lot["expires_at"],
                    "gramsConsumed": sum(float(l["grams_consumed"]) for l in lot_entries),
                    "nutrientsPer100g": first_lot["nutrients_per_100g"],
                    "verificationStatusSummary": {
                        "verified": len([x for x in first_lot["nutrient_rows"] if x["verificationStatus"] == "VERIFIED"]),
                        "needsReview": len(
                            [x for x in first_lot["nutrient_rows"] if x["verificationStatus"] == "NEEDS_REVIEW"]
                        ),
                        "rejected": len([x for x in first_lot["nutrient_rows"] if x["verificationStatus"] == "REJECTED"]),
                    },
                    "evidenceSummary": {
                        "verifiedCount": lot_evidence["verifiedCount"],
                        "inferredCount": lot_evidence["inferredCount"],
                        "exceptionCount": lot_evidence["exceptionCount"],
                        "unverifiedCount": lot_evidence["unverifiedCount"],
                        "totalNutrientRows": lot_evidence["totalNutrientRows"],
                        "provisional": lot_evidence["provisional"],
                    },
                    "reasonCodes": lot_evidence["reasonCodes"],
                    "sourceRefs": lot_evidence["sourceRefs"],
                    "syntheticLot": bool(first_lot["synthetic_lot"]),
                    "provisional": lot_evidence["provisional"],
                }

                lot_label_id = insert_label_snapshot(
                    cur,
                    organization_id=event["organization_id"],
                    label_type="LOT",
                    external_ref_id=lot_id,
                    title=f"Lot {first_lot['lot_code'] or lot_id}",
                    payload=lot_payload,
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
        "provisional": bool(sku_payload.get("provisional")),
        "reasonCodes": sku_payload.get("reasonCodes", []),
    }


def main() -> int:
    args = parse_args()
    if not args.database_url:
        print("Missing DATABASE_URL. Pass --database-url or export DATABASE_URL.", file=sys.stderr)
        return 1

    only_final_events = parse_bool(args.only_final_events, True)

    conn = psycopg2.connect(args.database_url)
    conn.autocommit = False
    psycopg2.extras.register_default_jsonb(conn)

    summary: Dict[str, Any] = {
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "organizationSlug": args.organization_slug,
        "month": args.month,
        "onlyFinalEvents": only_final_events,
        "dryRun": bool(args.dry_run),
        "events": [],
        "errors": [],
    }

    try:
        with conn.cursor() as cur:
            org_id = get_org_id(cur, args.organization_slug)
            summary["organizationId"] = org_id
            events = fetch_events(
                cur,
                organization_id=org_id,
                month=args.month,
                only_final_events=only_final_events,
                limit=args.limit,
            )
            summary["eventCount"] = len(events)

            for event in events:
                try:
                    result = refresh_event(cur, event, created_by="agent")
                    summary["events"].append(result)
                except Exception as event_error:
                    summary["errors"].append({"eventId": event["event_id"], "message": str(event_error)})

            if args.dry_run:
                conn.rollback()
            else:
                conn.commit()

        summary["finishedAt"] = datetime.now(timezone.utc).isoformat()
        summary["refreshedEvents"] = len(summary["events"])
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
