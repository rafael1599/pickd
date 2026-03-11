#!/bin/bash
# sync-local-db.sh — Sync production data → local Supabase
# Usage: bash scripts/sync-local-db.sh
#
# Prerequisites:
#   - Docker running + `npx supabase start` (container: supabase_db_Roman-app)
#   - PROD_DB_URL in .env (production connection string)
#   - Network access from Docker to production DB
#   - Local schema must match prod (if not, run: npx supabase db pull && npx supabase db reset)
set -euo pipefail

CONTAINER="supabase_db_Roman-app"
SU="supabase_admin"
DUMP_PUBLIC="/tmp/prod_public.sql"
DUMP_AUTH="/tmp/prod_auth.sql"

# ── 1. Read PROD_DB_URL ──
PROD_URL=$(grep '^PROD_DB_URL=' .env | cut -d= -f2-)
if [ -z "$PROD_URL" ]; then
  echo "❌ PROD_DB_URL not found in .env"
  exit 1
fi

# ── 2. Verify local DB is running ──
if ! docker exec "$CONTAINER" psql -U postgres -d postgres -c "SELECT 1" &>/dev/null; then
  echo "❌ Local Supabase not running. Run: npx supabase start"
  exit 1
fi
echo "✅ Local DB running"

# ── 3. Dump from production (parallel) ──
echo "⬇️  Dumping production data..."
docker exec "$CONTAINER" pg_dump "$PROD_URL" \
  --data-only --schema=public --no-owner --no-privileges --disable-triggers \
  2>/dev/null > "$DUMP_PUBLIC" &
PID1=$!

docker exec "$CONTAINER" pg_dump "$PROD_URL" \
  --data-only --schema=auth --table=auth.users --no-owner --no-privileges --disable-triggers \
  2>/dev/null > "$DUMP_AUTH" &
PID2=$!

wait $PID1 $PID2
echo "   public: $(wc -l < "$DUMP_PUBLIC") lines | auth: $(wc -l < "$DUMP_AUTH") lines"

# Sanity check — if dumps are empty, prod is unreachable
if [ ! -s "$DUMP_PUBLIC" ]; then
  echo "❌ Public dump is empty — can't reach production DB. Check PROD_DB_URL and network."
  rm -f "$DUMP_PUBLIC" "$DUMP_AUTH"
  exit 1
fi

# ── 4. Truncate all public tables dynamically + auth.users ──
echo "🧹 Truncating local tables..."
docker exec -e PGPASSWORD=postgres -i "$CONTAINER" psql -U "$SU" -d postgres <<'EOSQL'
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('TRUNCATE public.%I CASCADE', tbl);
  END LOOP;
END $$;
ALTER TABLE auth.users DISABLE TRIGGER ALL;
DELETE FROM auth.users;
EOSQL

# ── 5. Import auth first (FKs depend on these IDs) ──
echo "⬆️  Importing auth.users..."
docker exec -e PGPASSWORD=postgres -i "$CONTAINER" psql -U "$SU" -d postgres < "$DUMP_AUTH" >/dev/null 2>&1

# ── 6. Import public data ──
echo "⬆️  Importing public data..."
docker exec -e PGPASSWORD=postgres -i "$CONTAINER" psql -U "$SU" -d postgres < "$DUMP_PUBLIC" >/dev/null 2>&1

docker exec -e PGPASSWORD=postgres -i "$CONTAINER" psql -U "$SU" -d postgres \
  -c "ALTER TABLE auth.users ENABLE TRIGGER ALL;" >/dev/null 2>&1

# ── 7. Verify — dynamically query all public tables ──
echo ""
echo "📊 Row counts:"
docker exec -i "$CONTAINER" psql -U postgres -d postgres -t <<'EOSQL'
SELECT rpad('auth.users', 28) || '│ ' || count(*) FROM auth.users
UNION ALL
SELECT rpad(t.tablename::text, 28) || '│ ' || cnt FROM (
  SELECT tablename, (xpath('/row/cnt/text()',
    query_to_xml(format('SELECT count(*) AS cnt FROM public.%I', tablename), false, true, ''))
  )[1]::text::bigint AS cnt
  FROM pg_tables WHERE schemaname = 'public'
) t WHERE t.cnt > 0
ORDER BY 1;
EOSQL

# ── 8. Cleanup ──
rm -f "$DUMP_PUBLIC" "$DUMP_AUTH"
echo ""
echo "✅ Sync complete!"
