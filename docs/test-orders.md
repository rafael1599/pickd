# Test Orders — Mimicking Watchdog

How to insert test orders into the local DB exactly like the watchdog Python daemon does.

## Prerequisites

- Local Supabase running (`supabase start`)
- Docker running (psql access via `docker exec`)

## Quick Insert

```bash
docker exec -i supabase_db_pickd psql -U postgres -d postgres <<'SQL'
INSERT INTO picking_lists (user_id, order_number, status, source, is_addon, customer_id, items)
VALUES (
  '033eb08f-8381-4169-a010-5cbf72939356',  -- Demo admin user
  'TEST-001',
  'ready_to_double_check',                  -- Watchdog skips 'active', goes straight here
  'pdf_import',
  false,
  'd00f0011-0410-48c3-94d1-04506c3e36f2',  -- ISLAND BIKE SHOP
  '[
    {"sku":"03-4614BK","pickingQty":2,"item_name":"FAULTLINE A1 V2 15 2026 GLOSS BLACK","warehouse":"LUDLOW","location":"ROW 43","sku_not_found":false,"insufficient_stock":false},
    {"sku":"03-3764BK","pickingQty":1,"item_name":"HELIX A2 16 2025 GLOSS BLACK","warehouse":"LUDLOW","location":"ROW 9","sku_not_found":false,"insufficient_stock":false}
  ]'::jsonb
);
SQL
```

## Item Shape (JSONB)

Each item in the `items` array:

```json
{
  "sku": "03-4614BK",
  "pickingQty": 2,
  "item_name": "FAULTLINE A1 V2 15 2026 GLOSS BLACK",
  "warehouse": "LUDLOW",
  "location": "ROW 43",
  "sku_not_found": false,
  "insufficient_stock": false
}
```

Optional fields (watchdog sets these but not required for testing):
- `description` — same as item_name usually
- `raw_sku` — original SKU from PDF before normalization
- `unit_price` — decimal
- `location_hint` — e.g. "Pallet Row A"
- `distribution` — e.g. `[{"type":"PALLET","units_each":1}]`
- `available_qty` — integer
- `source` — "pdf_import"

## Available Test Users

| Name | UUID | Role |
|------|------|------|
| Demo | `033eb08f-8381-4169-a010-5cbf72939356` | admin |
| Rafael Lopez | `2ac0450c-d80a-47ac-8e50-d9d0ee586321` | admin |
| Brian Hsieh | `afdeab8d-4db6-4ade-889b-c313020f6fec` | staff |

## Available Test Customers

| Name | UUID |
|------|------|
| ISLAND BIKE SHOP | `d00f0011-0410-48c3-94d1-04506c3e36f2` |
| RIVERSIDE ADVENTURE COMPANY | `a869e751-9428-402b-b094-5d62e7355ae2` |
| Biketek | `83451f7f-b4d1-472d-ab9a-101a9c75b331` |
| TEST COSTUMER 1 | `ce49466c-ad9b-43d2-9cd8-0746e5c8cbc9` |
| brigham young university Idaho | `2ddcf7bd-2542-4747-9e55-b0c1b7b472d0` |

## Available Test SKUs

| SKU | Name | Location |
|-----|------|----------|
| `03-4614BK` | FAULTLINE A1 V2 15 2026 GLOSS BLACK | ROW 43 |
| `03-4614RD` | FAULTLINE A1 V2 15 2026 RUBY RED | ROW 10 |
| `03-3764BK` | HELIX A2 16 2025 GLOSS BLACK | ROW 9 |
| `03-3684BL` | PRIMO A3 20 2025 OCEAN BLUE | ROW 15 |
| `03-3994BR` | DUAL SPORT 29 2025 BRONZE | ROW 22 |
| `06-4572GY` | EC1 18 2026 COOL GRAY (e-bike) | ROW 2 |

## Auto-Classification Rules

The Verification Board classifies orders automatically:

1. Any item weight > 50 lbs → **Regular**
2. Total pickingQty sum ≥ 5 → **Regular**
3. Otherwise → **FedEx**

## Recipes

### FedEx order (≤4 items)
```sql
-- 2 items total → FedEx
'[{"sku":"03-4614BK","pickingQty":1,...},{"sku":"03-3764BK","pickingQty":1,...}]'
```

### Regular order (≥5 items)
```sql
-- 6 items total → Regular
'[{"sku":"03-4614BK","pickingQty":3,...},{"sku":"03-3764BK","pickingQty":2,...},{"sku":"03-3684BL","pickingQty":1,...}]'
```

### Needs correction (Priority zone)
```sql
-- Use status 'needs_correction' instead of 'ready_to_double_check'
INSERT INTO picking_lists (..., status, ...) VALUES (..., 'needs_correction', ...);
```

### Waiting for inventory
```sql
-- Set is_waiting_inventory + waiting_reason
INSERT INTO picking_lists (..., status, is_waiting_inventory, waiting_reason, waiting_since, ...)
VALUES (..., 'needs_correction', true, 'Bike not yet received', NOW(), ...);
```

## Cleanup

```bash
# Delete all test orders
docker exec -i supabase_db_pickd psql -U postgres -d postgres -c \
  "DELETE FROM picking_list_notes WHERE list_id IN (SELECT id FROM picking_lists WHERE order_number LIKE 'TEST-%');
   DELETE FROM picking_lists WHERE order_number LIKE 'TEST-%';"
```

## Key Differences: Watchdog vs Manual Insert

| Aspect | Watchdog | Manual Insert |
|--------|----------|---------------|
| Status | `ready_to_double_check` | Same — watchdog skips `active` |
| Source | `pdf_import` | Same |
| user_id | `PDF_IMPORT_USER_ID` env var | Any admin UUID |
| Customer | Resolved/created by name | Use existing UUID |
| Stock check | Computes `insufficient_stock` from live inventory | Set manually (false for testing) |
| Location | Assigned by priority (PALLET > LINE > TOWER) | Set manually |
| Combine | Auto-merges same customer within 24h | Not applicable |
