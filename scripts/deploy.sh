#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f ".env.production" ]]; then
  echo "Missing .env.production (copy from .env.production.example first)." >&2
  exit 1
fi

# Build and start (or update) the production stack.
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build

# Print a short status snapshot.
docker compose --env-file .env.production -f docker-compose.prod.yml ps

echo
echo "Deployment finished."
echo "App dashboard: https://$(grep '^DOMAIN=' .env.production | cut -d'=' -f2)"
