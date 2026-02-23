#!/usr/bin/env python3
"""
Correct historical MealServiceEvent.servedAt timestamps to align with
MealSchedule.serviceDate + mealSlot canonical time.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

import psycopg2

MEAL_SLOT_UTC_TIME: Dict[str, Tuple[int, int]] = {
    "BREAKFAST": (12, 30),
    "LUNCH": (17, 30),
    "PRE_TRAINING": (19, 0),
    "POST_TRAINING": (21, 0),
    "DINNER": (23, 0),
    "PRE_BED": (23, 30),
    "SNACK": (15, 0),
}

DEFAULT_UTC_TIME: Tuple[int, int] = (18, 0)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Correct servedAt timestamps from serviceDate + mealSlot")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"), help="Postgres connection string")
    parser.add_argument("--organization-slug", default="primary")
    parser.add_argument("--month", default=datetime.now(timezone.utc).strftime("%Y-%m"), help="YYYY-MM")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    return parser.parse_args()


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


def get_org_id(cur: psycopg2.extensions.cursor, slug: str) -> str:
    cur.execute('select id from "Organization" where slug=%s limit 1', (slug,))
    row = cur.fetchone()
    if not row:
        raise RuntimeError(f'Organization slug "{slug}" not found')
    return str(row[0])


def canonical_served_at(service_date: datetime, meal_slot: str) -> datetime:
    hour, minute = MEAL_SLOT_UTC_TIME.get(str(meal_slot or "").upper(), DEFAULT_UTC_TIME)
    return datetime(
        service_date.year,
        service_date.month,
        service_date.day,
        hour,
        minute,
        0,
        0,
        tzinfo=timezone.utc,
    )


def main() -> int:
    args = parse_args()
    if not args.database_url:
        print(json.dumps({"ok": False, "error": "DATABASE_URL is required"}))
        return 1

    start_date, end_date = month_bounds(args.month)
    summary: Dict[str, Any] = {
        "ok": True,
        "month": args.month,
        "organizationSlug": args.organization_slug,
        "dryRun": bool(args.dry_run),
        "checked": 0,
        "updated": 0,
        "unchanged": 0,
        "changes": [],
    }

    conn = psycopg2.connect(args.database_url)
    conn.autocommit = False

    try:
        with conn.cursor() as cur:
            org_id = get_org_id(cur, args.organization_slug)
            summary["organizationId"] = org_id

            sql = """
                select
                  mse.id,
                  mse."servedAt",
                  ms."serviceDate",
                  ms."mealSlot"
                from "MealServiceEvent" mse
                join "MealSchedule" ms on ms.id = mse."mealScheduleId"
                where mse."organizationId" = %s
                  and ms."serviceDate" >= %s::date
                  and ms."serviceDate" < %s::date
                order by ms."serviceDate" asc, ms."mealSlot" asc, mse."createdAt" asc
            """
            params: List[Any] = [org_id, start_date, end_date]
            if args.limit and args.limit > 0:
                sql += f" limit {int(args.limit)}"

            cur.execute(sql, tuple(params))
            rows = cur.fetchall()
            summary["checked"] = len(rows)

            for row in rows:
                event_id = str(row[0])
                served_at = row[1]
                service_date = row[2]
                meal_slot = str(row[3] or "")

                if served_at is None or service_date is None:
                    summary["unchanged"] += 1
                    continue

                if served_at.tzinfo is None:
                    served_at = served_at.replace(tzinfo=timezone.utc)
                else:
                    served_at = served_at.astimezone(timezone.utc)

                if service_date.tzinfo is None:
                    service_date = service_date.replace(tzinfo=timezone.utc)
                else:
                    service_date = service_date.astimezone(timezone.utc)

                target = canonical_served_at(service_date, meal_slot)
                delta_seconds = abs((served_at - target).total_seconds())
                if delta_seconds <= 60:
                    summary["unchanged"] += 1
                    continue

                summary["updated"] += 1
                if len(summary["changes"]) < 30:
                    summary["changes"].append(
                        {
                            "eventId": event_id,
                            "mealSlot": meal_slot,
                            "servedAtBefore": served_at.isoformat(),
                            "servedAtAfter": target.isoformat(),
                        }
                    )

                if not args.dry_run:
                    cur.execute(
                        """
                        update "MealServiceEvent"
                        set "servedAt" = %s,
                            version = version + 1
                        where id = %s
                        """,
                        (target, event_id),
                    )

            if args.dry_run:
                conn.rollback()
            else:
                conn.commit()

    except Exception as exc:
        conn.rollback()
        summary = {"ok": False, "error": str(exc)}
        print(json.dumps(summary))
        return 1
    finally:
        conn.close()

    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
