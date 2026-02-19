#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f ".env.production" ]]; then
  echo "Missing .env.production" >&2
  exit 1
fi

mkdir -p backups
TS="$(date +%Y%m%d-%H%M%S)"

# Load env vars from file
set -a
source .env.production
set +a

# DB backup
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U postgres second_brain > "backups/postgres-${TS}.sql"

# Knowledge storage backup
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T app \
  sh -lc "tar -czf - -C /app/storage/SecondBrain ." > "backups/storage-${TS}.tgz"

echo "Backups generated:"
ls -lh backups | tail -n 5
