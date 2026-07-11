-- ============================================================
-- CREAR ÓRDENES DE PRUEBA QUE INCLUYEN WAITING FOR INVENTORY
-- ============================================================

DO $$
BEGIN
  IF NOT (inet_server_addr() IS NULL OR inet_server_addr()::text IN ('127.0.0.1', '::1', '0.0.0.0')) THEN
    RAISE EXCEPTION 'ABORT: This script is for LOCAL development only.';
  END IF;
END $$;

-- Asegurar que existe al menos un cliente
INSERT INTO public.customers (id, name, street, city, state, zip_code)
VALUES ('c0000000-0000-0000-0000-000000000001', 'Bikes & Parts Depot', '123 Cycling Way', 'Miami', 'FL', '33101')
ON CONFLICT (id) DO NOTHING;

-- Limpieza
DELETE FROM picking_lists WHERE order_number IN ('WAITING-001', 'WAITING-002', 'NORMAL-001');

-- 1. Normal order
INSERT INTO picking_lists (
  id, user_id, order_number, status, source, customer_id, items, created_at, updated_at, is_waiting_inventory
) VALUES (
  '11111111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-000000000001',
  'NORMAL-001',
  'active',
  'manual',
  'c0000000-0000-0000-0000-000000000001',
  '[
    {
      "sku": "03-3978BL",
      "location": "ROW 42",
      "item_name": "NORMAL BIKE ITEM",
      "pickingQty": 2
    }
  ]'::jsonb,
  now(),
  now(),
  false
);

-- 2. Waiting Order 1
INSERT INTO picking_lists (
  id, user_id, order_number, status, source, customer_id, items, created_at, updated_at, is_waiting_inventory
) VALUES (
  '22222222-2222-2222-2222-222222222222',
  '00000000-0000-0000-0000-000000000001',
  'WAITING-001',
  'active',
  'manual',
  'c0000000-0000-0000-0000-000000000001',
  '[
    {
      "sku": "03-4614BK",
      "location": "ROW 43",
      "item_name": "WAITING BIKE ITEM A",
      "pickingQty": 1
    }
  ]'::jsonb,
  now() - interval '1 hour',
  now() - interval '1 hour',
  true
);

-- 3. Waiting Order 2
INSERT INTO picking_lists (
  id, user_id, order_number, status, source, customer_id, items, created_at, updated_at, is_waiting_inventory
) VALUES (
  '33333333-3333-3333-3333-333333333333',
  '00000000-0000-0000-0000-000000000001',
  'WAITING-002',
  'needs_correction',
  'manual',
  'c0000000-0000-0000-0000-000000000001',
  '[
    {
      "sku": "03-4614ZZ",
      "location": null,
      "item_name": "WAITING BIKE ITEM B",
      "pickingQty": 1
    }
  ]'::jsonb,
  now() - interval '2 hours',
  now() - interval '2 hours',
  true
);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
