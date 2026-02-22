#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:4000}"
MODE="${MODE:-commit}"
WEEK_START="${WEEK_START:-2026-02-16}"
PURCHASE_DATE="${PURCHASE_DATE:-2026-02-15}"
CLIENT_REF="${CLIENT_REF:-ALEX-001}"
CLIENT_NAME="${CLIENT_NAME:-Alex}"

MEAL_FILE="${1:-/Users/daniel/Downloads/Alex_Week_Workbook_FullDetail.xlsx}"
LOT_FILE="${2:-/Users/daniel/Downloads/Walmart_Receipt_Complete_With_Item_Name.xlsx}"

if [ ! -f "$MEAL_FILE" ]; then
  echo "Meal file not found: $MEAL_FILE"
  exit 1
fi

args=(
  -sS
  -X POST
  "${API_BASE}/v1/pilot/backfill-week"
  -F "mode=${MODE}"
  -F "week_start_date=${WEEK_START}"
  -F "purchase_date=${PURCHASE_DATE}"
  -F "client_external_ref=${CLIENT_REF}"
  -F "client_name=${CLIENT_NAME}"
  -F "meal_file=@${MEAL_FILE}"
)

if [ -f "$LOT_FILE" ]; then
  args+=(-F "lot_file=@${LOT_FILE}")
fi

echo "Running pilot backfill..."
curl "${args[@]}" | tee /tmp/nutrition-autopilot-pilot-backfill.json
echo
echo "Saved response to /tmp/nutrition-autopilot-pilot-backfill.json"
