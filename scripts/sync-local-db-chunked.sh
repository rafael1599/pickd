#!/bin/bash
# sync-local-db-chunked.sh — Resumable, budget-capped sync: production → local.
#
# Usage:
#   bash scripts/sync-local-db-chunked.sh            # sync until done or budget spent
#   bash scripts/sync-local-db-chunked.sh --status   # show progress, transfer nothing
#   bash scripts/sync-local-db-chunked.sh --reset    # forget progress, start over
#
# Why this exists: the full dump moves ~110 MB in one shot, which on the Free
# Plan is 2% of the monthly egress allowance per run and gets throttled once
# the quota is spent. This pulls the same data in small pages, stops when it
# hits a self-imposed budget, and picks up exactly where it left off next time.
#
# Two safety properties the full script does not have:
#   - It never truncates up front. Each page is loaded in its own transaction
#     (delete-those-keys, then insert), so an interrupted run leaves every page
#     that already landed intact. The full script truncates everything first
#     and then loads, so a cut-off transfer wipes the database.
#   - It verifies each page arrived complete before loading it.
#
# Tune with environment variables:
#   BATCH_SIZE=250     rows per page
#   BUDGET_MB=40       stop after roughly this much transfer, this run
#   SLEEP_SECONDS=2    pause between pages
set -euo pipefail

BATCH_SIZE="${BATCH_SIZE:-250}"
BUDGET_MB="${BUDGET_MB:-40}"
SLEEP_SECONDS="${SLEEP_SECONDS:-2}"
MONTHS_OF_HISTORY=12

CONTAINER="supabase_db_pickd"
SU="supabase_admin"
STATE_FILE="$(dirname "$0")/.sync-progress"
WORKDIR="$(mktemp -d)"
# Staging path inside the container — \copy runs there, not on the host.
REMOTE_PAGE="/tmp/sync_page_$$.csv"
trap 'rm -rf "$WORKDIR"; docker exec "$CONTAINER" rm -f "$REMOTE_PAGE" >/dev/null 2>&1 || true' EXIT

# table:primary-key — order matters, parents before children.
TABLES=(
  "locations:id"
  "profiles:id"
  "customers:id"
  "sku_metadata:sku"
  "inventory:id"
  "picking_lists:id"
)

touch "$STATE_FILE"

state_get() { grep "^$1	" "$STATE_FILE" 2>/dev/null | cut -f2 || true; }
state_set() {
  local tmp="$WORKDIR/state"
  grep -v "^$1	" "$STATE_FILE" > "$tmp" 2>/dev/null || true
  printf '%s\t%s\n' "$1" "$2" >> "$tmp"
  mv "$tmp" "$STATE_FILE"
}

if [ "${1:-}" = "--reset" ]; then
  : > "$STATE_FILE"
  echo "✅ Progress cleared. Next run starts from the beginning."
  exit 0
fi

if [ "${1:-}" = "--status" ]; then
  echo "Progress (cursor = last primary key loaded):"
  for entry in "${TABLES[@]}"; do
    t="${entry%%:*}"
    cursor="$(state_get "$t")"
    local_rows=$(docker exec "$CONTAINER" psql -U postgres -d postgres -t -A \
      -c "SELECT count(*) FROM public.$t" 2>/dev/null || echo "?")
    printf '  %-16s local rows: %-8s cursor: %s\n' "$t" "$local_rows" "${cursor:-<not started>}"
  done
  exit 0
fi

PROD_URL=$(grep '^PROD_DB_URL=' .env | cut -d= -f2-)
[ -n "$PROD_URL" ] || { echo "❌ PROD_DB_URL not found in .env"; exit 1; }

docker exec "$CONTAINER" psql -U postgres -d postgres -c "SELECT 1" &>/dev/null \
  || { echo "❌ Local Supabase not running. Run: npx supabase start"; exit 1; }

BUDGET_BYTES=$((BUDGET_MB * 1024 * 1024))
SPENT=0

# Talk to production through the local container, surfacing the real error
# instead of dying silently under `set -e`.
remote_psql() {
  local out err status
  err="$WORKDIR/remote.err"
  set +e
  out=$(docker exec "$CONTAINER" psql "$PROD_URL" -v ON_ERROR_STOP=1 -t -A -c "$1" 2>"$err")
  status=$?
  set -e
  if [ $status -ne 0 ]; then
    echo "" >&2
    echo "❌ Production query failed:" >&2
    sed 's/^/   /' "$err" >&2
    if grep -qi "connection\|timeout\|could not\|authentication" "$err"; then
      echo "   Looks like a connection problem: egress quota exhausted (the Free" >&2
      echo "   Plan throttles past 5 GB), a stale PROD_DB_URL, or no route from" >&2
      echo "   the container to the database host." >&2
      echo "" >&2
    fi
    exit 1
  fi
  printf '%s' "$out"
}

echo "Checking connection to production…"
remote_psql "SELECT 1" >/dev/null
echo "✅ Production reachable"
echo ""

# picking_lists.items dominates the transfer, so it is trimmed to the two
# fields get_sku_movement_stats actually reads. Every other column comes over
# untouched, and the list is built from the local schema so the two stay aligned.
columns_for() {
  local table="$1"
  docker exec "$CONTAINER" psql -U postgres -d postgres -t -A -c "
    SELECT string_agg(
      CASE WHEN '$table' = 'picking_lists' AND column_name = 'items'
        THEN 'COALESCE((SELECT jsonb_agg(jsonb_build_object(''sku'', it->>''sku'', ''pickingQty'', it->>''pickingQty'')) FROM jsonb_array_elements(COALESCE(items, ''[]''::jsonb)) it), ''[]''::jsonb) AS items'
        ELSE quote_ident(column_name) END, ', ' ORDER BY ordinal_position)
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = '$table'
      AND is_generated = 'NEVER';"
}

# Generated columns (e.g. inventory.location_sort_key) are computed by Postgres
# and reject any value on insert, so they are left out of both sides.
plain_columns_for() {
  docker exec "$CONTAINER" psql -U postgres -d postgres -t -A -c "
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = '$1'
      AND is_generated = 'NEVER';"
}

where_for() {
  # Only picking_lists is filtered; the rest come over whole.
  if [ "$1" = "picking_lists" ]; then
    echo "status = 'completed' AND updated_at >= now() - interval '$MONTHS_OF_HISTORY months'"
  else
    echo "true"
  fi
}

echo "Budget for this run: ${BUDGET_MB} MB · ${BATCH_SIZE} rows per page"
echo ""

for entry in "${TABLES[@]}"; do
  table="${entry%%:*}"
  pk="${entry##*:}"
  select_cols="$(columns_for "$table")"
  insert_cols="$(plain_columns_for "$table")"
  filter="$(where_for "$table")"

  while :; do
    if [ "$SPENT" -ge "$BUDGET_BYTES" ]; then
      echo ""
      echo "⏸  Budget reached ($(( SPENT / 1024 / 1024 )) MB). Run again to continue."
      echo "   Nothing was lost — progress is saved in $STATE_FILE"
      exit 0
    fi

    cursor="$(state_get "$table")"
    if [ -n "$cursor" ]; then
      cursor_clause="AND $pk > '$cursor'"
    else
      cursor_clause=""
    fi

    # One cheap round-trip to learn where this page ends, so the cursor never
    # depends on parsing CSV (quoted commas would break that).
    # Last key of this page. Ordering descending instead of max() because uuid
    # has comparison operators but no max() aggregate.
    next_cursor=$(remote_psql "
      SELECT $pk::text FROM (
        SELECT $pk FROM public.$table WHERE $filter $cursor_clause
        ORDER BY $pk LIMIT $BATCH_SIZE
      ) s ORDER BY $pk DESC LIMIT 1;" | tr -d '[:space:]')

    if [ -z "$next_cursor" ]; then
      echo "  $table — complete"
      break
    fi

    page="$WORKDIR/page.csv"
    set +e
    docker exec "$CONTAINER" psql "$PROD_URL" -v ON_ERROR_STOP=1 -t -A -c "
      COPY (
        SELECT $select_cols FROM public.$table
        WHERE $filter $cursor_clause AND $pk <= '$next_cursor'
        ORDER BY $pk
      ) TO STDOUT WITH (FORMAT csv);" > "$page" 2>"$WORKDIR/copy.err"
    copy_status=$?
    set -e
    if [ $copy_status -ne 0 ]; then
      echo ""
      echo "❌ Transfer of $table failed mid-page:"
      sed 's/^/   /' "$WORKDIR/copy.err"
      echo "   Progress up to '$cursor' is saved — rerun to resume."
      exit 1
    fi

    bytes=$(wc -c < "$page" | tr -d ' ')
    if [ "$bytes" -eq 0 ]; then
      echo "  $table — page came back empty, stopping here (retry later)"
      break
    fi
    SPENT=$((SPENT + bytes))

    # \copy is client-side and the client is the psql inside the container, so
    # the page has to live in the container's filesystem, not the host's.
    docker cp "$page" "$CONTAINER:$REMOTE_PAGE" >/dev/null

    # Load atomically: replace exactly these keys, leave the rest alone.
    # The cursor only advances if this succeeds — otherwise the page would be
    # skipped forever and the data silently lost.
    set +e
    docker exec -e PGPASSWORD=postgres -i "$CONTAINER" psql -U "$SU" -d postgres \
      -v ON_ERROR_STOP=1 --single-transaction -q > "$WORKDIR/load.log" 2>&1 <<EOSQL
SET session_replication_role = replica;
CREATE TEMP TABLE _page (LIKE public.$table INCLUDING DEFAULTS) ON COMMIT DROP;
\copy _page ($insert_cols) FROM '$REMOTE_PAGE' WITH (FORMAT csv)
DELETE FROM public.$table WHERE $pk IN (SELECT $pk FROM _page);
INSERT INTO public.$table ($insert_cols) SELECT $insert_cols FROM _page;
EOSQL
    load_status=$?
    set -e
    docker exec "$CONTAINER" rm -f "$REMOTE_PAGE" >/dev/null 2>&1 || true
    if [ $load_status -ne 0 ]; then
      echo ""
      echo "❌ Loading $table into the local database failed:"
      sed 's/^/   /' "$WORKDIR/load.log"
      echo "   The cursor was NOT advanced, so rerunning retries this same page."
      exit 1
    fi

    state_set "$table" "$next_cursor"
    rows=$(wc -l < "$page" | tr -d ' ')
    printf '  %-16s +%-5s rows  %6s KB  (run total: %s MB)\n' \
      "$table" "$rows" "$((bytes / 1024))" "$((SPENT / 1024 / 1024))"

    sleep "$SLEEP_SECONDS"
  done
done

echo ""
echo "✅ All tables complete. Transferred $(( SPENT / 1024 / 1024 )) MB this run."
docker exec "$CONTAINER" psql -U postgres -d postgres -c "
SELECT 'inventory' t, count(*) FROM inventory
UNION ALL SELECT 'locations', count(*) FROM locations
UNION ALL SELECT 'sku_metadata', count(*) FROM sku_metadata
UNION ALL SELECT 'picking_lists', count(*) FROM picking_lists
UNION ALL SELECT 'customers', count(*) FROM customers
UNION ALL SELECT 'profiles', count(*) FROM profiles;"
echo ""
echo "Note: auth.users is not synced here — use sync-local-db.sh if you need local login."
