#!/usr/bin/env python3
"""
One-time historical cleanup for floor-imputed nutrient rows.

- Targets only products consumed in served events for a target month
- Exports matching rows to JSON artifact for auditability
- Clears floor-imputed values so the rebuild agent can replace them with provenance-backed values
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

import psycopg2
import psycopg2.extras


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Cleanup floor-imputed nutrient rows for historical rebuild")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"), help="Postgres connection string")
    parser.add_argument("--organization-slug", default="primary")
    parser.add_argument("--month", required=True, help="YYYY-MM")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--artifact-path", default="")
    return parser.parse_args()


def month_bounds(month: str) -> Tuple[str, str]:
    if len(month) != 7 or month[4] != "-":
        raise RuntimeError("month must be YYYY-MM")
    year = int(month[0:4])
    mon = int(month[5:7])
    start = f"{year:04d}-{mon:02d}-01"
    if mon == 12:
        end = f"{year + 1:04d}-01-01"
    else:
        end = f"{year:04d}-{mon + 1:02d}-01"
    return start, end


def get_org_id(cur: psycopg2.extensions.cursor, slug: str) -> str:
    cur.execute('select id from "Organization" where slug = %s limit 1', (slug,))
    row = cur.fetchone()
    if not row:
        raise RuntimeError(f'Organization slug "{slug}" not found')
    return str(row[0])


def default_artifact_path(month: str) -> pathlib.Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    directory = pathlib.Path("scripts") / "artifacts"
    directory.mkdir(parents=True, exist_ok=True)
    return directory / f"floor_cleanup_{month}_{stamp}.json"


def main() -> int:
    args = parse_args()
    if not args.database_url:
        print("Missing DATABASE_URL. Pass --database-url or export DATABASE_URL.", file=sys.stderr)
        return 1

    start_date, end_date = month_bounds(args.month)
    artifact_path = pathlib.Path(args.artifact_path) if args.artifact_path else default_artifact_path(args.month)

    summary: Dict[str, Any] = {
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "organizationSlug": args.organization_slug,
        "month": args.month,
        "dryRun": bool(args.dry_run),
        "artifactPath": str(artifact_path),
        "targetProducts": 0,
        "floorRows": 0,
        "updatedRows": 0,
        "errors": [],
    }

    conn = psycopg2.connect(args.database_url)
    conn.autocommit = True
    psycopg2.extras.register_default_jsonb(conn)

    try:
        with conn.cursor() as cur:
            org_id = get_org_id(cur, args.organization_slug)
            summary["organizationId"] = org_id

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
                select product_id from served_products
                """,
                (org_id, start_date, end_date),
            )
            product_ids = [str(row[0]) for row in cur.fetchall()]
            summary["targetProducts"] = len(product_ids)

            if not product_ids:
                conn.rollback()
                summary["finishedAt"] = datetime.now(timezone.utc).isoformat()
                print(json.dumps(summary, indent=2))
                return 0

            cur.execute(
                """
                select
                  pnv.id,
                  pnv."productId",
                  nd.key,
                  pnv."valuePer100g",
                  pnv."sourceType"::text,
                  pnv."sourceRef",
                  pnv."verificationStatus"::text,
                  pnv."evidenceGrade"::text,
                  pnv."confidenceScore",
                  pnv."historicalException",
                  pnv."retrievedAt",
                  pnv."retrievalRunId",
                  pnv."updatedAt"
                from "ProductNutrientValue" pnv
                join "NutrientDefinition" nd on nd.id = pnv."nutrientDefinitionId"
                where pnv."productId" = any(%s)
                  and pnv."sourceRef" = 'agent:trace-floor-imputation'
                order by pnv."productId", nd.key
                """,
                (product_ids,),
            )

            rows: List[Dict[str, Any]] = []
            row_ids: List[str] = []
            for record in cur.fetchall():
                row_ids.append(str(record[0]))
                rows.append(
                    {
                        "id": str(record[0]),
                        "productId": str(record[1]),
                        "nutrientKey": str(record[2]),
                        "valuePer100g": float(record[3]) if record[3] is not None else None,
                        "sourceType": str(record[4]),
                        "sourceRef": str(record[5]),
                        "verificationStatus": str(record[6]),
                        "evidenceGrade": str(record[7]),
                        "confidenceScore": float(record[8]) if record[8] is not None else None,
                        "historicalException": bool(record[9]),
                        "retrievedAt": record[10].isoformat() if record[10] else None,
                        "retrievalRunId": str(record[11]) if record[11] else None,
                        "updatedAt": record[12].isoformat() if record[12] else None,
                    }
                )

            summary["floorRows"] = len(rows)

            artifact_payload = {
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "organizationId": org_id,
                "month": args.month,
                "rows": rows,
            }
            artifact_path.parent.mkdir(parents=True, exist_ok=True)
            artifact_path.write_text(json.dumps(artifact_payload, indent=2), encoding="utf-8")

            if row_ids and not args.dry_run:
                conn.autocommit = False
                cur.execute(
                    """
                    update "ProductNutrientValue"
                    set
                      "valuePer100g" = null,
                      "sourceRef" = 'historical-cleanup:pending-rebuild',
                      "sourceType" = 'DERIVED',
                      "evidenceGrade" = 'HISTORICAL_EXCEPTION',
                      "confidenceScore" = 0,
                      "historicalException" = true,
                      "retrievedAt" = null,
                      "retrievalRunId" = null,
                      "verificationStatus" = 'NEEDS_REVIEW',
                      "updatedAt" = now(),
                      version = version + 1
                    where id = any(%s)
                    """,
                    (row_ids,),
                )
                summary["updatedRows"] = cur.rowcount
                conn.commit()
                conn.autocommit = True

        summary["finishedAt"] = datetime.now(timezone.utc).isoformat()
        print(json.dumps(summary, indent=2))
        return 0
    except Exception as exc:  # pragma: no cover - operational script
        try:
            conn.rollback()
        except Exception:
            pass
        summary["errors"].append(str(exc))
        summary["finishedAt"] = datetime.now(timezone.utc).isoformat()
        print(json.dumps(summary, indent=2))
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
