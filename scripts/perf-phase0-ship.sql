\pset pager off
\timing on

\echo '=================================================================='
\echo 'PickD Phase 0 — Ship / picking_lists performance baseline'
\echo '=================================================================='
SELECT now() AS captured_at,
       current_database() AS database_name,
       current_setting('server_version') AS postgres_version;

\echo ''
\echo '--- 1. Dataset volume and relation sizes -------------------------'
SELECT
  count(*) AS total_rows,
  count(*) FILTER (WHERE status = 'cancelled') AS cancelled_rows,
  count(*) FILTER (WHERE NOT COALESCE(is_shipped, false) AND status <> 'cancelled') AS to_ship_rows,
  count(*) FILTER (
    WHERE COALESCE(is_shipped, false)
      AND updated_at >= date_trunc('day', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York'
  ) AS shipped_today_rows,
  count(*) FILTER (WHERE is_waiting_inventory) AS waiting_rows,
  min(created_at) AS oldest_created_at,
  max(created_at) AS newest_created_at
FROM public.picking_lists;

SELECT
  pg_size_pretty(pg_relation_size('public.picking_lists')) AS table_size,
  pg_size_pretty(pg_indexes_size('public.picking_lists')) AS indexes_size,
  pg_size_pretty(pg_total_relation_size('public.picking_lists')) AS total_size;

\echo ''
\echo '--- 2. Row width and heavy-column payload estimates ---------------'
SELECT
  count(*) AS rows_sampled,
  round(avg(pg_column_size(pl))) AS avg_full_row_bytes,
  max(pg_column_size(pl)) AS max_full_row_bytes,
  round(avg(pg_column_size(items)) FILTER (WHERE items IS NOT NULL)) AS avg_items_bytes,
  max(pg_column_size(items)) AS max_items_bytes,
  round(avg(pg_column_size(pallet_photos)) FILTER (WHERE pallet_photos IS NOT NULL)) AS avg_photos_bytes,
  max(pg_column_size(pallet_photos)) AS max_photos_bytes,
  round(avg(pg_column_size(combine_meta)) FILTER (WHERE combine_meta IS NOT NULL)) AS avg_combine_meta_bytes,
  max(pg_column_size(combine_meta)) AS max_combine_meta_bytes
FROM public.picking_lists pl;

SELECT
  pg_size_pretty(sum(pg_column_size(pl))::bigint) AS estimated_all_rows_payload,
  pg_size_pretty(sum(pg_column_size(pl)) FILTER (
    WHERE NOT COALESCE(is_shipped, false) AND status <> 'cancelled'
  )::bigint) AS estimated_to_ship_payload,
  pg_size_pretty(sum(pg_column_size(pl)) FILTER (
    WHERE COALESCE(is_shipped, false)
      AND updated_at >= date_trunc('day', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York'
  )::bigint) AS estimated_shipped_today_payload
FROM public.picking_lists pl;

\echo ''
\echo '--- 3. Column-level size contribution -----------------------------'
WITH column_sizes AS (
  SELECT 'items' AS column_name, sum(pg_column_size(items))::bigint AS bytes FROM public.picking_lists
  UNION ALL SELECT 'pallet_photos', sum(pg_column_size(pallet_photos))::bigint FROM public.picking_lists
  UNION ALL SELECT 'combine_meta', sum(pg_column_size(combine_meta))::bigint FROM public.picking_lists
  UNION ALL SELECT 'notes', sum(pg_column_size(notes))::bigint FROM public.picking_lists
  UNION ALL SELECT 'correction_notes', sum(pg_column_size(correction_notes))::bigint FROM public.picking_lists
)
SELECT column_name, pg_size_pretty(COALESCE(bytes, 0)) AS total_size
FROM column_sizes
ORDER BY bytes DESC NULLS LAST;

\echo ''
\echo '--- 4. Existing indexes and usage --------------------------------'
SELECT
  i.indexrelname AS index_name,
  pg_size_pretty(pg_relation_size(i.indexrelid)) AS index_size,
  i.idx_scan,
  i.idx_tup_read,
  i.idx_tup_fetch,
  pg_get_indexdef(i.indexrelid) AS definition
FROM pg_stat_user_indexes i
WHERE i.schemaname = 'public'
  AND i.relname = 'picking_lists'
ORDER BY i.idx_scan DESC, i.indexrelname;

\echo ''
\echo '--- 5. Table activity / dead tuples -------------------------------'
SELECT
  seq_scan,
  seq_tup_read,
  idx_scan,
  n_live_tup,
  n_dead_tup,
  n_tup_ins,
  n_tup_upd,
  n_tup_del,
  n_tup_hot_upd,
  last_analyze,
  last_autoanalyze,
  last_vacuum,
  last_autovacuum
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND relname = 'picking_lists';

\echo ''
\echo '--- 6. Current Ship full-list query plan --------------------------'
EXPLAIN (ANALYZE, BUFFERS, WAL, VERBOSE, FORMAT TEXT)
SELECT
  pl.*,
  row_to_json(c.*) AS customer,
  row_to_json(u.*) AS picker,
  row_to_json(ch.*) AS checker,
  row_to_json(up.*) AS presence,
  row_to_json(og.*) AS order_group
FROM public.picking_lists pl
LEFT JOIN LATERAL (
  SELECT id, name, street, city, state, zip_code
  FROM public.customers c
  WHERE c.id = pl.customer_id
) c ON true
LEFT JOIN LATERAL (
  SELECT full_name
  FROM public.profiles u
  WHERE u.id = pl.user_id
) u ON true
LEFT JOIN LATERAL (
  SELECT full_name
  FROM public.profiles ch
  WHERE ch.id = pl.checked_by
) ch ON true
LEFT JOIN LATERAL (
  SELECT last_seen_at
  FROM public.user_presence up
  WHERE up.user_id = pl.user_id
  LIMIT 1
) up ON true
LEFT JOIN LATERAL (
  SELECT group_type
  FROM public.order_groups og
  WHERE og.id = pl.group_id
) og ON true
ORDER BY pl.created_at DESC;

\echo ''
\echo '--- 7. Candidate operational-list query plan ----------------------'
EXPLAIN (ANALYZE, BUFFERS, WAL, VERBOSE, FORMAT TEXT)
SELECT
  pl.id,
  pl.order_number,
  pl.customer_id,
  pl.user_id,
  pl.checked_by,
  pl.status,
  pl.is_shipped,
  pl.is_waiting_inventory,
  pl.created_at,
  pl.updated_at,
  pl.transport_company,
  pl.shipping_type,
  pl.group_id,
  pl.pallets_qty,
  pl.total_units,
  c.name AS customer_name,
  og.group_type
FROM public.picking_lists pl
LEFT JOIN public.customers c ON c.id = pl.customer_id
LEFT JOIN public.order_groups og ON og.id = pl.group_id
WHERE pl.status <> 'cancelled'
  AND (
    NOT COALESCE(pl.is_shipped, false)
    OR (
      COALESCE(pl.is_shipped, false)
      AND pl.updated_at >= date_trunc('day', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York'
    )
  )
ORDER BY pl.created_at DESC;

\echo ''
\echo '--- 8. Detail-by-id query plan ------------------------------------'
EXPLAIN (ANALYZE, BUFFERS, WAL, VERBOSE, FORMAT TEXT)
SELECT
  pl.*,
  row_to_json(c.*) AS customer,
  row_to_json(u.*) AS picker,
  row_to_json(ch.*) AS checker,
  row_to_json(up.*) AS presence,
  row_to_json(og.*) AS order_group
FROM public.picking_lists pl
LEFT JOIN LATERAL (
  SELECT id, name, street, city, state, zip_code
  FROM public.customers c
  WHERE c.id = pl.customer_id
) c ON true
LEFT JOIN LATERAL (
  SELECT full_name
  FROM public.profiles u
  WHERE u.id = pl.user_id
) u ON true
LEFT JOIN LATERAL (
  SELECT full_name
  FROM public.profiles ch
  WHERE ch.id = pl.checked_by
) ch ON true
LEFT JOIN LATERAL (
  SELECT last_seen_at
  FROM public.user_presence up
  WHERE up.user_id = pl.user_id
  LIMIT 1
) up ON true
LEFT JOIN LATERAL (
  SELECT group_type
  FROM public.order_groups og
  WHERE og.id = pl.group_id
) og ON true
WHERE pl.id = (SELECT id FROM public.picking_lists ORDER BY created_at DESC LIMIT 1);

\echo ''
\echo '--- 9. pg_stat_statements: picking_lists hot queries --------------'
SELECT
  calls,
  round(total_exec_time::numeric, 2) AS total_exec_ms,
  round(mean_exec_time::numeric, 2) AS mean_exec_ms,
  rows,
  shared_blks_hit,
  shared_blks_read,
  temp_blks_written,
  left(regexp_replace(query, '\\s+', ' ', 'g'), 240) AS query
FROM extensions.pg_stat_statements
WHERE query ILIKE '%picking_lists%'
ORDER BY total_exec_time DESC
LIMIT 25;

\echo ''
\echo '--- 10. Realtime publication coverage -----------------------------'
SELECT
  pubname,
  schemaname,
  tablename
FROM pg_publication_tables
WHERE schemaname = 'public'
  AND tablename = 'picking_lists';

\echo ''
\echo '--- 11. RLS policies on picking_lists -----------------------------'
SELECT
  policyname,
  cmd,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'picking_lists'
ORDER BY policyname;

\echo ''
\echo '=================================================================='
\echo 'End baseline'
\echo '=================================================================='
