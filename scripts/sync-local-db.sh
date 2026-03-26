#!/bin/bash
# sync-local-db.sh — Sync production data → local Supabase
# Usage: bash scripts/sync-local-db.sh
#
# Prerequisites:
#   - Docker running + `npx supabase start` (container: supabase_db_pickd)
#   - PROD_DB_URL in .env (production connection string)
#   - Network access from Docker to production DB
#   - Local schema must match prod (if not, run: npx supabase db pull && npx supabase db reset)
set -euo pipefail

CONTAINER="supabase_db_pickd"
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

# ── 6b. Fix auth for local login + create E2E test users ──
echo "🔑 Fixing auth for local login..."
docker exec -e PGPASSWORD=postgres -i "$CONTAINER" psql -U "$SU" -d postgres <<'EOSQL'
-- SAFETY: Abort if somehow connected to non-local DB
DO $$ BEGIN
  IF NOT (inet_server_addr() IS NULL OR inet_server_addr()::text IN ('127.0.0.1', '::1', '0.0.0.0')) THEN
    RAISE EXCEPTION 'ABORT: Password reset is for LOCAL only. Detected non-local server: %', inet_server_addr();
  END IF;
END $$;

-- Remove phone uniqueness constraint (causes issues with empty string duplicates)
ALTER TABLE auth.users DROP CONSTRAINT IF EXISTS users_phone_key;

-- Fix NULL string fields in auth.users (GoTrue crashes with "converting NULL to string")
UPDATE auth.users SET
    phone              = COALESCE(phone, ''),
    phone_change       = COALESCE(phone_change, ''),
    phone_change_token = COALESCE(phone_change_token, ''),
    confirmation_token = COALESCE(confirmation_token, ''),
    recovery_token     = COALESCE(recovery_token, ''),
    email_change       = COALESCE(email_change, ''),
    email_change_token_new     = COALESCE(email_change_token_new, ''),
    email_change_token_current = COALESCE(email_change_token_current, ''),
    reauthentication_token     = COALESCE(reauthentication_token, '');

-- Set all production users to a known local password (1111)
-- and ensure email_confirmed_at is set (required for login)
UPDATE auth.users SET
    encrypted_password = crypt('1111', gen_salt('bf')),
    email_confirmed_at = COALESCE(email_confirmed_at, now());

-- Create missing auth.identities for production users (required for login)
INSERT INTO auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, provider_id)
SELECT gen_random_uuid(), u.id,
       jsonb_build_object('sub', u.id, 'email', u.email),
       'email', now(), now(), now(), u.id::text
FROM auth.users u
WHERE NOT EXISTS (
    SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email'
);

-- Activate all profiles for local development
UPDATE public.profiles SET is_active = true;

-- ── E2E Test Users ──
-- These are the users expected by Playwright tests (defined in .env)
-- Credentials: admin@test.com/password123, staff@test.com/password123

-- Create auth.users for E2E (ON CONFLICT = upsert password)
INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user,
    confirmation_token, recovery_token, email_change_token_new, email_change_token_current,
    phone_change_token, reauthentication_token, email_change, phone, phone_change
) VALUES
('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'admin@test.com',
 crypt('password123', gen_salt('bf')), now(),
 '{"provider":"email","providers":["email"]}',
 '{"full_name":"Test Admin","is_active":true}',
 now(), now(), false, '', '', '', '', '', '', '', '', ''),
('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'staff@test.com',
 crypt('password123', gen_salt('bf')), now(),
 '{"provider":"email","providers":["email"]}',
 '{"full_name":"Test Staff","is_active":true}',
 now(), now(), false, '', '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    email_confirmed_at = EXCLUDED.email_confirmed_at;

-- Create identities for E2E users
INSERT INTO auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, provider_id)
VALUES
(gen_random_uuid(), '00000000-0000-0000-0000-000000000001',
 '{"sub":"00000000-0000-0000-0000-000000000001","email":"admin@test.com"}',
 'email', now(), now(), now(), '00000000-0000-0000-0000-000000000001'),
(gen_random_uuid(), '00000000-0000-0000-0000-000000000002',
 '{"sub":"00000000-0000-0000-0000-000000000002","email":"staff@test.com"}',
 'email', now(), now(), now(), '00000000-0000-0000-0000-000000000002')
ON CONFLICT DO NOTHING;

-- Create profiles for E2E users
INSERT INTO public.profiles (id, email, full_name, role, is_active) VALUES
('00000000-0000-0000-0000-000000000001', 'admin@test.com', 'Test Admin', 'admin', true),
('00000000-0000-0000-0000-000000000002', 'staff@test.com', 'Test Staff', 'staff', true)
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, is_active = EXCLUDED.is_active;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
EOSQL
echo "   Production users → password: 1111"
echo "   E2E admin@test.com → password: password123"
echo "   E2E staff@test.com → password: password123"

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
