-- Development-only user seeds
-- Created automatically by `supabase start`

-- Test user 1: admin@test.com
INSERT INTO auth.users (
  id,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin
) VALUES
  (
    '11111111-1111-1111-1111-111111111111'::uuid,
    'admin@test.com',
    crypt('password123', gen_salt('bf')),
    NOW(),
    NOW(),
    NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"email":"admin@test.com","email_verified":true,"phone_verified":false}'::jsonb,
    FALSE
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) VALUES
  (
    '11111111-1111-1111-1111-111111111111'::uuid,
    '11111111-1111-1111-1111-111111111111'::uuid,
    '{"email":"admin@test.com","email_verified":true,"phone_verified":false,"sub":"11111111-1111-1111-1111-111111111111"}'::jsonb,
    'email',
    NOW(),
    NOW(),
    NOW()
  )
ON CONFLICT (id) DO NOTHING;

-- Test user 2: rafaelus1599@gmail.com
INSERT INTO auth.users (
  id,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin
) VALUES
  (
    '22222222-2222-2222-2222-222222222222'::uuid,
    'rafaelus1599@gmail.com',
    crypt('111111', gen_salt('bf')),
    NOW(),
    NOW(),
    NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"email":"rafaelus1599@gmail.com","email_verified":true,"phone_verified":false}'::jsonb,
    FALSE
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) VALUES
  (
    '22222222-2222-2222-2222-222222222222'::uuid,
    '22222222-2222-2222-2222-222222222222'::uuid,
    '{"email":"rafaelus1599@gmail.com","email_verified":true,"phone_verified":false,"sub":"22222222-2222-2222-2222-222222222222"}'::jsonb,
    'email',
    NOW(),
    NOW(),
    NOW()
  )
ON CONFLICT (id) DO NOTHING;
