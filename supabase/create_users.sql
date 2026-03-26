-- ============================================================
-- CREAR/REPARAR USUARIOS PARA DESARROLLO LOCAL + E2E TESTS
-- ============================================================
-- SOLO PARA USO LOCAL. Este script modifica passwords y crea test users.
-- NUNCA ejecutar contra producción.
--
-- Ejecutar después de: npx supabase db reset, o bash scripts/sync-local-db.sh
--
-- Comando:
--   docker exec -e PGPASSWORD=postgres -i supabase_db_pickd psql -U supabase_admin -d postgres < supabase/create_users.sql
--
-- O pegar en SQL Editor de Supabase Studio (http://localhost:54323)
--
-- Passwords:
--   Usuarios de producción (sincronizados desde profiles): 1111
--   E2E admin@test.com: password123
--   E2E staff@test.com: password123
-- ============================================================

-- SAFETY: Abort if running against production (non-localhost)
DO $$
BEGIN
  IF NOT (inet_server_addr() IS NULL OR inet_server_addr()::text IN ('127.0.0.1', '::1', '0.0.0.0')) THEN
    RAISE EXCEPTION 'ABORT: This script is for LOCAL development only. Detected non-local server: %', inet_server_addr();
  END IF;
END $$;

-- 1. Eliminar constraint problemático de phone (causa duplicados con '')
ALTER TABLE auth.users DROP CONSTRAINT IF EXISTS users_phone_key;

-- 2. Registrar todos los perfiles existentes en el motor de Auth
--    (para cuando hay datos de producción en public.profiles)
DO $$
DECLARE
    p RECORD;
BEGIN
    FOR p IN SELECT * FROM public.profiles WHERE email IS NOT NULL LOOP
        IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p.id) THEN
            -- CRÍTICO: Todos los campos string deben ser '' (no NULL)
            -- GoTrue crashea con "converting NULL to string"
            INSERT INTO auth.users (
                id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user,
                confirmation_token, recovery_token, email_change_token_new, email_change_token_current,
                phone_change_token, reauthentication_token, email_change, phone, phone_change
            ) VALUES (
                p.id,
                '00000000-0000-0000-0000-000000000000',
                'authenticated', 'authenticated',
                p.email,
                crypt('1111', gen_salt('bf')),
                now(),
                '{"provider":"email","providers":["email"]}',
                jsonb_build_object('full_name', COALESCE(p.full_name, 'Staff'), 'is_active', true),
                now(), now(), false,
                '', '', '', '', '', '', '', '', ''
            );

            INSERT INTO auth.identities (
                id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, provider_id
            ) VALUES (
                gen_random_uuid(), p.id,
                jsonb_build_object('sub', p.id, 'email', p.email),
                'email', now(), now(), now(), p.id
            );
        END IF;
    END LOOP;

    -- Activar todos los perfiles para desarrollo local
    UPDATE public.profiles SET is_active = true;
END $$;

-- 3. Reparar NULLs en auth.users existentes (importados de prod o creados manualmente)
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

-- 4. Crear/actualizar usuarios E2E (Playwright tests)
--    Credenciales definidas en .env:
--      VITE_TEST_ADMIN_EMAIL=admin@test.com / VITE_TEST_ADMIN_PASSWORD=password123
--      VITE_TEST_STAFF_EMAIL=staff@test.com / VITE_TEST_STAFF_PASSWORD=password123

-- auth.users primero (FK: profiles.id -> auth.users.id)
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

-- identities (necesarias para que login funcione)
INSERT INTO auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, provider_id)
VALUES
(gen_random_uuid(), '00000000-0000-0000-0000-000000000001',
 '{"sub":"00000000-0000-0000-0000-000000000001","email":"admin@test.com"}',
 'email', now(), now(), now(), '00000000-0000-0000-0000-000000000001'),
(gen_random_uuid(), '00000000-0000-0000-0000-000000000002',
 '{"sub":"00000000-0000-0000-0000-000000000002","email":"staff@test.com"}',
 'email', now(), now(), now(), '00000000-0000-0000-0000-000000000002')
ON CONFLICT DO NOTHING;

-- profiles (después de auth.users por FK)
INSERT INTO public.profiles (id, email, full_name, role, is_active) VALUES
('00000000-0000-0000-0000-000000000001', 'admin@test.com', 'Test Admin', 'admin', true),
('00000000-0000-0000-0000-000000000002', 'staff@test.com', 'Test Staff', 'staff', true)
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, is_active = EXCLUDED.is_active;

-- 5. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
