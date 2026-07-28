#!/bin/bash
# sync-local-db-lite.sh — Low-egress partial sync: production data → local Supabase
#
# Usage: bash scripts/sync-local-db-lite.sh
#
# Why this exists: sync-local-db.sh dumps the whole public schema (~110 MB),
# and on the Free Plan that burns the 5 GB monthly egress allowance in about
# 45 runs. This script pulls only what warehouse/inventory work needs and
# slims down the one table that dominates the dump.
#
# Note: pg_dump's -Fc compression does NOT reduce egress — rows travel
# uncompressed over COPY and are compressed only when written to disk. The
# only real lever is transferring fewer rows and fewer columns.
#
# What it does differently:
#   - Only the tables listed in SMALL_TABLES, plus a reduced picking_lists.
#   - picking_lists keeps completed orders from the last 12 months, and each
#     item is stripped to { sku, pickingQty } — the only fields
#     get_sku_movement_stats reads.
#   - Truncates ONLY the tables it is about to reload, so a partial transfer
#     can't wipe unrelated data (the full script truncates everything first).
#
# Prerequisites: Docker running, `npx supabase start`, PROD_DB_URL in .env.
set -euo pipefail

CONTAINER="supabase_db_pickd"
SU="supabase_admin"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# Tables small enough to copy wholesale.
SMALL_TABLES=(locations sku_metadata inventory profiles customers)

MONTHS_OF_HISTORY=12

PROD_URL=$(grep '^PROD_DB_URL=' .env | cut -d= -f2-)
if [ -z "$PROD_URL" ]; then
  echo "❌ PROD_DB_URL not found in .env"
  exit 1
fi

if ! docker exec "$CONTAINER" psql -U postgres -d postgres -c "SELECT 1" &>/dev/null; then
  echo "❌ Local Supabase not running. Run: npx supabase start"
  exit 1
fi
echo "✅ Local DB running"

# ── 1. Small tables ──────────────────────────────────────────────────────────
echo "⬇️  Dumping small tables: ${SMALL_TABLES[*]}"
TABLE_ARGS=()
for t in "${SMALL_TABLES[@]}"; do TABLE_ARGS+=(--table="public.$t"); done

docker exec "$CONTAINER" pg_dump "$PROD_URL" \
  --data-only --no-owner --no-privileges --disable-triggers \
  "${TABLE_ARGS[@]}" 2>/dev/null > "$WORKDIR/small.sql"

if [ ! -s "$WORKDIR/small.sql" ]; then
  echo "❌ Dump is empty — production unreachable, or egress quota exceeded."
  echo "   Nothing was truncated locally. Check the Supabase usage page."
  exit 1
fi

# A truncated transfer is worse than a failed one: it passes an "is it empty?"
# check and silently loads partial data. COPY blocks must end with \.
if [ "$(grep -c '^\\\.$' "$WORKDIR/small.sql")" -lt "${#SMALL_TABLES[@]}" ]; then
  echo "❌ Dump looks truncated (fewer COPY terminators than tables)."
  echo "   Nothing was truncated locally. Likely an egress cut-off — retry later."
  exit 1
fi
echo "   $(wc -c < "$WORKDIR/small.sql" | tr -d ' ') bytes"

# ── 2. Reduced picking_lists ─────────────────────────────────────────────────
# Only what get_sku_movement_stats needs: completed orders, recent enough to
# matter, and items stripped to the two fields the aggregate reads.
echo "⬇️  Dumping reduced picking_lists (completed, last ${MONTHS_OF_HISTORY} months)…"
docker exec "$CONTAINER" psql "$PROD_URL" -v ON_ERROR_STOP=1 --csv -t -c "
  COPY (
    SELECT pl.id,
           pl.status,
           pl.updated_at,
           COALESCE(
             (SELECT jsonb_agg(jsonb_build_object('sku', it->>'sku', 'pickingQty', it->>'pickingQty'))
              FROM jsonb_array_elements(COALESCE(pl.items, '[]'::jsonb)) it),
             '[]'::jsonb
           ) AS items
    FROM public.picking_lists pl
    WHERE pl.status = 'completed'
      AND pl.updated_at >= now() - interval '${MONTHS_OF_HISTORY} months'
  ) TO STDOUT WITH (FORMAT csv)
" > "$WORKDIR/picking.csv" 2>/dev/null

echo "   $(wc -l < "$WORKDIR/picking.csv" | tr -d ' ') orders, $(wc -c < "$WORKDIR/picking.csv" | tr -d ' ') bytes"

# ── 3. Load ──────────────────────────────────────────────────────────────────
echo "🧹 Truncating only the tables being reloaded…"
TRUNCATE_LIST=$(printf "public.%s," "${SMALL_TABLES[@]}" | sed 's/,$//')
docker exec -e PGPASSWORD=postgres -i "$CONTAINER" psql -U "$SU" -d postgres -v ON_ERROR_STOP=1 <<EOSQL
TRUNCATE ${TRUNCATE_LIST}, public.picking_lists CASCADE;
EOSQL

echo "⬆️  Importing…"
docker exec -e PGPASSWORD=postgres -i "$CONTAINER" psql -U "$SU" -d postgres < "$WORKDIR/small.sql" >/dev/null

docker exec -e PGPASSWORD=postgres -i "$CONTAINER" psql -U "$SU" -d postgres -v ON_ERROR_STOP=1 \
  -c "\\copy public.picking_lists (id, status, updated_at, items) FROM STDIN WITH (FORMAT csv)" \
  < "$WORKDIR/picking.csv" >/dev/null

# ── 4. Report ────────────────────────────────────────────────────────────────
docker exec "$CONTAINER" psql -U postgres -d postgres -c "
SELECT 'inventory' t, count(*) FROM inventory
UNION ALL SELECT 'locations', count(*) FROM locations
UNION ALL SELECT 'sku_metadata', count(*) FROM sku_metadata
UNION ALL SELECT 'picking_lists', count(*) FROM picking_lists;"

echo "✅ Done. Auth users are NOT synced by this script — use sync-local-db.sh if you need to log in locally."
