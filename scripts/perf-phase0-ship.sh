#!/bin/bash
set -euo pipefail

CONTAINER="supabase_db_pickd"
DB_USER="postgres"
DB_NAME="postgres"
SQL_FILE="scripts/perf-phase0-ship.sql"
REPORT_DIR="reports/performance"
STAMP=$(date "+%Y%m%d-%H%M%S")
REPORT_FILE="${REPORT_DIR}/ship-phase0-${STAMP}.txt"
LATEST_FILE="${REPORT_DIR}/ship-phase0-latest.txt"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required."
  exit 1
fi

if ! docker inspect "${CONTAINER}" >/dev/null 2>&1; then
  echo "ERROR: local Supabase DB container '${CONTAINER}' was not found."
  echo "Run: npx supabase start"
  exit 1
fi

if ! docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -Atc \
  "select case when inet_server_addr() is null or inet_server_addr()::text in ('127.0.0.1','::1','0.0.0.0') then 'local' else 'non-local' end" \
  | grep -q '^local$'; then
  echo "ERROR: safety check failed; refusing to run against a non-local database."
  exit 1
fi

mkdir -p "${REPORT_DIR}"

echo "Running PickD Phase 0 Ship baseline against local Supabase..."
docker exec -i "${CONTAINER}" psql \
  -X \
  -v ON_ERROR_STOP=1 \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  < "${SQL_FILE}" \
  | tee "${REPORT_FILE}"

cp "${REPORT_FILE}" "${LATEST_FILE}"

echo ""
echo "Report saved to: ${REPORT_FILE}"
echo "Latest report:   ${LATEST_FILE}"
