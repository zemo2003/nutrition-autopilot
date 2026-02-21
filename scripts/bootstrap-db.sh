#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f .env ]; then
  echo "Missing .env. Copy .env.example to .env and set DATABASE_URL first."
  exit 1
fi

set -a
source .env
set +a

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is empty in .env"
  exit 1
fi

npm run db:generate
npm run db:migrate
npm run db:seed

echo "Database bootstrapped successfully."
