-- ============================================================
-- CREAR ÓRDENES DE PRUEBA PARA TESTING LOCAL
-- ============================================================
-- Crea órdenes con items problemáticos para testear la UI de corrección
-- en DoubleCheckView (items rojos, botón Fix, inline correction).
--
-- Ejecutar después de: create_users.sql (necesita auth users)
--
-- Comando:
--   docker exec -e PGPASSWORD=postgres -i supabase_db_pickd psql -U supabase_admin -d postgres < supabase/seed_test_orders.sql
--
-- Requiere: usuario admin@test.com (id: 00000000-0000-0000-0000-000000000001)
-- ============================================================

-- SAFETY: Abort if running against production
DO $$
BEGIN
  IF NOT (inet_server_addr() IS NULL OR inet_server_addr()::text IN ('127.0.0.1', '::1', '0.0.0.0')) THEN
    RAISE EXCEPTION 'ABORT: This script is for LOCAL development only.';
  END IF;
END $$;

-- TEST-001: Orden con items problemáticos para testear correction UI
-- Status: double_checking (checker puede ver items rojos y probar corrección)
-- Items:
--   1. 03-4614BK — OK (existe en inventario, hay stock)
--   2. 03-4614ZZ — sku_not_found (SKU inventado, no existe en sku_metadata)
--   3. 03-9999XX — sku_not_found (SKU completamente inexistente)
--   4. 03-3764BK — insufficient_stock (pide 50 unidades, no hay suficiente)

INSERT INTO picking_lists (
  id, user_id, order_number, status, source, checked_by, items, created_at, updated_at
) VALUES (
  '754367e9-9534-42c6-96a3-4e981d6e6eaf',
  '00000000-0000-0000-0000-000000000001',
  'TEST-001',
  'double_checking',
  'manual',
  '00000000-0000-0000-0000-000000000001',
  '[
    {
      "sku": "03-4614BK",
      "location": "ROW 43",
      "item_name": "FAULTLINE A1 V2 15 2026 GLOSS BLACK",
      "warehouse": "LUDLOW",
      "pickingQty": 1,
      "sku_not_found": false,
      "insufficient_stock": false
    },
    {
      "sku": "03-4614ZZ",
      "location": null,
      "item_name": "FAULTLINE A1 V2 15 2026 PHANTOM PURPLE",
      "warehouse": "LUDLOW",
      "pickingQty": 1,
      "sku_not_found": true,
      "insufficient_stock": false
    },
    {
      "sku": "03-9999XX",
      "location": null,
      "item_name": "NONEXISTENT BIKE MODEL",
      "warehouse": "LUDLOW",
      "pickingQty": 3,
      "sku_not_found": true,
      "insufficient_stock": false
    },
    {
      "sku": "03-3764BK",
      "location": "ROW 9",
      "item_name": "HELIX A2 16 2025 GLOSS BLACK",
      "warehouse": "LUDLOW",
      "pickingQty": 50,
      "sku_not_found": false,
      "insufficient_stock": true
    }
  ]'::jsonb,
  now(),
  now()
) ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  items = EXCLUDED.items,
  checked_by = EXCLUDED.checked_by,
  updated_at = now();

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
