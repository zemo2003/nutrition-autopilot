#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <github-remote-url>"
  echo "Example: $0 https://github.com/yourname/nutrition-autopilot.git"
  exit 1
fi

REMOTE_URL="$1"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE_URL"
else
  git remote add origin "$REMOTE_URL"
fi

git branch -M main
git push -u origin main

echo "Published to $REMOTE_URL"
