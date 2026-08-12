#!/usr/bin/env bash
# sync-prod-to-local.sh — Safe prod DB sync to local Docker postgres
#
# Designed for projects using Supabase prod + local docker postgres for dev.
# Default safety: excludes data of tables that cause runtime conflicts when
# replicated (e.g. WhatsApp Baileys auth states — duplicating creds locally
# kicks prod bot off WhatsApp via "stream replaced" error).
#
# Usage:
#   ./sync-prod-to-local.sh [flags]
#
# Flags:
#   --env-file FILE        Source file with DATABASE_URL (default: .env.staging)
#   --container NAME       Local docker postgres container (default: auto-detect)
#   --db NAME              Local DB name (default: drivly)
#   --exclude-data TABLES  Comma-separated table list, data-only excluded but
#                          schema preserved (default: whatsapp_auth_states,whatsapp_handoffs)
#   --keep-dump            Don't delete the dump SQL file after restore
#   --no-verify            Skip post-restore count verification
#   --help                 Show this help
#
# Project config override:
#   The skill's projects/<project>.md may specify project-specific defaults.
#   Set PROJECT_NAME env var to look up project config (e.g. "drivly").
#
# Safety notes (from 2026-05-15 incident — bot prod kicked):
#   - whatsapp_auth_states data MUST be excluded by default. Restoring creds
#     into local triggers Baileys session connect with the SAME phone JID,
#     and WhatsApp boots the prod client immediately.
#   - Set ENABLE_WHATSAPP_SESSIONS=false in local .env before starting API,
#     even with the table excluded — defense-in-depth.

set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────────────────────

PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"
ENV_FILE="${ENV_FILE:-$PROJECT_ROOT/.env.staging}"
LOCAL_CONTAINER="${LOCAL_CONTAINER:-}"
LOCAL_DB="${LOCAL_DB:-drivly}"
EXCLUDE_DATA="${EXCLUDE_DATA:-whatsapp_auth_states,whatsapp_handoffs}"
KEEP_DUMP=0
VERIFY=1

# ── Parse args ───────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case $1 in
    --env-file)      ENV_FILE="$2"; shift 2 ;;
    --container)     LOCAL_CONTAINER="$2"; shift 2 ;;
    --db)            LOCAL_DB="$2"; shift 2 ;;
    --exclude-data)  EXCLUDE_DATA="$2"; shift 2 ;;
    --keep-dump)     KEEP_DUMP=1; shift ;;
    --no-verify)     VERIFY=0; shift ;;
    --help|-h)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      echo "FATAL: unknown arg: $1" >&2
      echo "Run with --help for usage." >&2
      exit 1 ;;
  esac
done

# ── Validation ───────────────────────────────────────────────────────────────

[[ -f "$ENV_FILE" ]] || { echo "FATAL: env file $ENV_FILE not found" >&2; exit 1; }

PROD_DB_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'")
[[ -n "$PROD_DB_URL" ]] || { echo "FATAL: no DATABASE_URL in $ENV_FILE" >&2; exit 1; }

# Mask password for log output
URL_MASKED="$(echo "$PROD_DB_URL" | sed -E 's|(:)[^@]+(@)|\1***\2|')"

if [[ -z "$LOCAL_CONTAINER" ]]; then
  LOCAL_CONTAINER=$(docker ps --filter 'name=postgres' --format '{{.Names}}' | head -1)
fi
[[ -n "$LOCAL_CONTAINER" ]] || { echo "FATAL: no local docker postgres container found" >&2; exit 1; }

if ! docker exec "$LOCAL_CONTAINER" pg_isready -U postgres > /dev/null 2>&1; then
  echo "FATAL: $LOCAL_CONTAINER is not ready (pg_isready failed)" >&2
  exit 1
fi

echo "═══ Sync prod → local ═══"
echo "  Source:    $URL_MASKED"
echo "  Target:    $LOCAL_CONTAINER:$LOCAL_DB"
echo "  Exclude:   ${EXCLUDE_DATA:-<none>}"
echo ""

# ── Build pg_dump exclude flags ──────────────────────────────────────────────

DUMP_EXTRA=""
if [[ -n "$EXCLUDE_DATA" ]]; then
  IFS=',' read -ra EXCLUDES <<< "$EXCLUDE_DATA"
  for tbl in "${EXCLUDES[@]}"; do
    tbl="$(echo "$tbl" | xargs)"
    [[ -n "$tbl" ]] && DUMP_EXTRA="$DUMP_EXTRA --exclude-table-data=public.$tbl"
  done
fi

# ── Dump ─────────────────────────────────────────────────────────────────────

DUMP_FILE="$PROJECT_ROOT/.prod-dump-$(date +%Y%m%d-%H%M%S).sql"
DUMP_ERR="$DUMP_FILE.err"

echo "→ pg_dump prod public schema…"
# Use docker exec to access pg_dump (Windows hosts often lack PostgreSQL CLI tools)
docker exec "$LOCAL_CONTAINER" bash -c "
  pg_dump '$PROD_DB_URL' \
    --schema=public --no-owner --no-acl \
    --clean --if-exists \
    --format=plain \
    $DUMP_EXTRA
" > "$DUMP_FILE" 2> "$DUMP_ERR"

DUMP_LINES=$(wc -l < "$DUMP_FILE")
if [[ "$DUMP_LINES" -lt 100 ]]; then
  echo "FATAL: dump suspiciously small ($DUMP_LINES lines)" >&2
  echo "stderr:" >&2
  tail -20 "$DUMP_ERR" >&2
  exit 1
fi
echo "  ✓ $DUMP_LINES lines, $(du -h "$DUMP_FILE" | cut -f1)"

# ── Restore ──────────────────────────────────────────────────────────────────

echo ""
echo "→ Restoring to local…"
cat "$DUMP_FILE" | docker exec -i "$LOCAL_CONTAINER" psql -U postgres -d "$LOCAL_DB" \
  > /tmp/sync-restore-out.log 2>&1 || {
    echo "FATAL: restore failed. Last lines:" >&2
    tail -10 /tmp/sync-restore-out.log >&2
    exit 1
  }

# Count psql notices/warnings as informational
WARN_COUNT=$(grep -cE 'NOTICE:|WARNING:' /tmp/sync-restore-out.log || true)
echo "  ✓ Restore complete ($WARN_COUNT notices/warnings)"

# ── Verify ───────────────────────────────────────────────────────────────────

if [[ "$VERIFY" -eq 1 ]]; then
  echo ""
  echo "→ Verification (key tables):"
  docker exec "$LOCAL_CONTAINER" psql -U postgres -d "$LOCAL_DB" -At <<'EOSQL' || echo "  ⚠ verify query failed"
SELECT 'tenants' || ': ' || COUNT(*) FROM tenants;
SELECT 'fixed_routes (active)' || ': ' || COUNT(*) FROM fixed_routes WHERE is_active = true;
SELECT 'town_brackets' || ': ' || COUNT(*) FROM town_brackets;
SELECT 'whatsapp_auth_states (rows)' || ': ' || COUNT(*) FROM whatsapp_auth_states;
EOSQL
fi

# ── Cleanup ──────────────────────────────────────────────────────────────────

if [[ "$KEEP_DUMP" -eq 0 ]]; then
  rm -f "$DUMP_FILE" "$DUMP_ERR" /tmp/sync-restore-out.log
fi

echo ""
echo "✓ Sync complete."
echo ""
echo "Next steps:"
echo "  1. Verify ENABLE_WHATSAPP_SESSIONS=false in $PROJECT_ROOT/.env"
echo "  2. Start API: pnpm --filter @drivly/api dev (or pnpm dev for full stack)"
echo "  3. Test endpoints — pricing engine + admin calculator work with prod-equivalent data"
echo ""
echo "Excluded tables retain schema but have zero rows:"
echo "  $EXCLUDE_DATA"
