-- FedEx Returns — Duplicate Detection Report
--
-- Read-only. Surfaces candidates for manual review. Run AFTER applying the
-- Opción A migration + backfill (otherwise the heuristics will trip on
-- legitimate placeholders).
--
-- Output: 5 sections. Copy each section to a sheet, mark a `keep_choice`
-- column per row, then send back. We then build a targeted cleanup script
-- from your decisions — no automated dedupe runs without review.
--
-- Usage (prod, read-only):
--   npx supabase db query --linked < scripts/fedex_returns_dup_detection.sql
--
-- Local:
--   docker exec -i supabase_db_pickd psql -U postgres -d postgres < scripts/fedex_returns_dup_detection.sql

\echo '============================================================'
\echo 'SECTION 1 — Returns with multiple linked items'
\echo '(more than one fedex_return_items per return → likely double "Return to Stock")'
\echo '============================================================'
SELECT
  fr.tracking_number,
  fr.status,
  fr.received_at::date AS received_date,
  COUNT(fri.id)        AS items_count,
  array_agg(fri.sku ORDER BY fri.created_at) AS skus,
  array_agg(COALESCE(fri.moved_to_location, fri.target_location, 'FDX') ORDER BY fri.created_at) AS locations
FROM public.fedex_returns fr
JOIN public.fedex_return_items fri ON fri.return_id = fr.id
GROUP BY fr.id, fr.tracking_number, fr.status, fr.received_at
HAVING COUNT(fri.id) > 1
ORDER BY received_date DESC;

\echo ''
\echo '============================================================'
\echo 'SECTION 2 — Inventory rows whose item_name references a tracking number'
\echo '(suggests a manual paste of the tracking as item_name during legacy intake)'
\echo '============================================================'
SELECT
  i.id,
  i.sku,
  i.warehouse,
  i.location,
  i.quantity,
  i.is_active,
  i.item_name,
  i.created_at::date AS created_date,
  fr.id              AS matching_return_id,
  fr.tracking_number AS matching_tracking
FROM public.inventory i
LEFT JOIN public.fedex_returns fr
  ON i.item_name ILIKE '%' || fr.tracking_number || '%'
  OR i.sku = fr.tracking_number
WHERE
  i.item_name ~ '\d{12,15}'
  OR EXISTS (SELECT 1 FROM public.fedex_returns fr2 WHERE i.sku = fr2.tracking_number)
ORDER BY i.created_at DESC;

\echo ''
\echo '============================================================'
\echo 'SECTION 3 — Inventory rows in FedEx-related locations not linked to a return'
\echo '(rows in FDX / FDX RETURNS / FDX 1 etc. with no fedex_return_items linkage)'
\echo '============================================================'
SELECT
  i.id,
  i.sku,
  i.warehouse,
  i.location,
  i.quantity,
  i.is_active,
  i.item_name,
  i.created_at::date AS created_date
FROM public.inventory i
WHERE i.location ILIKE 'FDX%'
  AND NOT EXISTS (
    SELECT 1 FROM public.fedex_return_items fri WHERE fri.sku = i.sku
  )
ORDER BY i.created_at DESC
LIMIT 200;

\echo ''
\echo '============================================================'
\echo 'SECTION 4 — Returns with a label photo AND a separately-uploaded SKU image'
\echo '(both are populated → photo dedup needed at cleanup)'
\echo '============================================================'
SELECT
  fr.tracking_number,
  fr.label_photo_url,
  fri.sku,
  sm.image_url AS sku_image_url
FROM public.fedex_returns fr
JOIN public.fedex_return_items fri ON fri.return_id = fr.id
JOIN public.sku_metadata sm ON sm.sku = fri.sku
WHERE fr.label_photo_url IS NOT NULL
  AND sm.image_url IS NOT NULL
  AND fri.sku <> fr.tracking_number  -- exclude placeholders (label is the only photo)
ORDER BY fr.received_at DESC;

\echo ''
\echo '============================================================'
\echo 'SECTION 5 — Same SKU referenced by multiple returns'
\echo '(may be legit: same model returned twice. Or a typo / mis-link)'
\echo '============================================================'
SELECT
  fri.sku,
  COUNT(DISTINCT fri.return_id) AS return_count,
  array_agg(DISTINCT fr.tracking_number ORDER BY fr.tracking_number) AS trackings
FROM public.fedex_return_items fri
JOIN public.fedex_returns fr ON fr.id = fri.return_id
GROUP BY fri.sku
HAVING COUNT(DISTINCT fri.return_id) > 1
ORDER BY return_count DESC, fri.sku;

\echo ''
\echo '============================================================'
\echo 'TOTALS'
\echo '============================================================'
SELECT
  (SELECT COUNT(*) FROM public.fedex_returns)              AS total_returns,
  (SELECT COUNT(*) FROM public.fedex_return_items)         AS total_items,
  (SELECT COUNT(*) FROM public.inventory WHERE location='FDX') AS fdx_inventory_rows;
