-- ============================================================
-- ORDEN DE PRUEBA: MIX DE BIKES + PARTS (stacking feature)
-- ============================================================
-- Crea una orden con bikes (que generan 2 pallets por default)
-- + partes mezcladas (algunas con stock, algunas sin stock, una inexistente)
-- para validar que todas las partes se apilan sobre el ultimo pallet de bikes
-- en lugar de crear pallets adicionales.
--
-- Comando:
--   docker exec -e PGPASSWORD=postgres -i supabase_db_pickd psql -U supabase_admin -d postgres < supabase/seed_bikes_parts_mix.sql
-- ============================================================

DO $$
BEGIN
  IF NOT (inet_server_addr() IS NULL OR inet_server_addr()::text IN ('127.0.0.1', '::1', '0.0.0.0')) THEN
    RAISE EXCEPTION 'ABORT: This script is for LOCAL development only.';
  END IF;
END $$;

-- Cleanup previa (idempotente)
DELETE FROM picking_lists WHERE order_number = 'TEST-BIKES-PARTS';
DELETE FROM sku_metadata WHERE sku = '03-9999ZZ';
-- (Watchdog no escribe is_bike; DoubleCheckView infiere bike por prefijo "03-")

-- Orden con status double_checking para ir directo a DoubleCheckView
-- Items esperados:
--   Bikes (is_bike=true):
--     - 03-3978BL x 15 → genera 2 pallets por si sola (8 + 7 @ limit 8)
--   Parts in-stock (is_bike=false):
--     - 32-0557 x 150 → D7
--     - 98-6860 x 100 → E23
--     - 31-214WH x 50 → E68
--   Parts con problema:
--     - 71-0625 x 5000 → insufficient_stock (solo ~2300 disponibles)
--     - 99-NONEXIST x 5 → sku_not_found
--
-- Sin stacking: ~2 pallets bikes + ~40 pallets de parts = ~42 pallets
-- Con stacking: 2 pallets totales. Pallet 2 contiene 7 bikes + 5305 unidades de partes.

INSERT INTO picking_lists (
  id, user_id, order_number, status, source, checked_by, items, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  'TEST-BIKES-PARTS',
  'double_checking',
  'manual',
  '00000000-0000-0000-0000-000000000001',
  '[
    {
      "sku": "03-3978BL",
      "location": "ROW 42",
      "item_name": "TEST BIKE BLUE",
      "warehouse": "LUDLOW",
      "pickingQty": 15,
      "sku_not_found": false,
      "insufficient_stock": false
    },
    {
      "sku": "03-9999ZZ",
      "location": null,
      "item_name": "TEST BIKE INEXISTENTE",
      "warehouse": "LUDLOW",
      "pickingQty": 2,
      "sku_not_found": true,
      "insufficient_stock": false
    },
    {
      "sku": "32-0557",
      "location": "D7",
      "item_name": "TEST PART 32-0557",
      "warehouse": "LUDLOW",
      "pickingQty": 150,
      "sku_not_found": false,
      "insufficient_stock": false
    },
    {
      "sku": "98-6860",
      "location": "E23",
      "item_name": "TEST PART 98-6860",
      "warehouse": "LUDLOW",
      "pickingQty": 100,
      "sku_not_found": false,
      "insufficient_stock": false
    },
    {
      "sku": "31-214WH",
      "location": "E68",
      "item_name": "TEST PART 31-214WH",
      "warehouse": "LUDLOW",
      "pickingQty": 50,
      "sku_not_found": false,
      "insufficient_stock": false
    },
    {
      "sku": "71-0625",
      "location": "E45",
      "item_name": "TEST PART 71-0625 (insufficient)",
      "warehouse": "LUDLOW",
      "pickingQty": 5000,
      "sku_not_found": false,
      "insufficient_stock": true
    },
    {
      "sku": "99-NONEXIST",
      "location": null,
      "item_name": "TEST PART INEXISTENTE",
      "warehouse": "LUDLOW",
      "pickingQty": 5,
      "sku_not_found": true,
      "insufficient_stock": false
    }
  ]'::jsonb,
  now(),
  now()
);

SELECT order_number, status, jsonb_array_length(items) AS item_count
FROM picking_lists
WHERE order_number = 'TEST-BIKES-PARTS';
