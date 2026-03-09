-- ============================================================
-- INSPECCIÓN DE ESQUEMA EN PRODUCCIÓN
-- Pegar en: Supabase Studio → SQL Editor
-- ============================================================


-- 1. TODAS LAS COLUMNAS DEL SCHEMA PUBLIC (ordenadas por tabla)
-- ------------------------------------------------------------
SELECT
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;


-- ============================================================
-- 2. DIAGNÓSTICO ESPECÍFICO: columnas problemáticas conocidas
-- ============================================================
SELECT
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('inventory', 'daily_inventory_snapshots')
  AND column_name IN ('sku_note', 'item_name', 'internal_note')
ORDER BY table_name, column_name;


-- ============================================================
-- 3. TODAS LAS TABLAS EXISTENTES
-- ============================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;


-- ============================================================
-- 4. TODAS LAS FUNCIONES RPC
-- ============================================================
SELECT
    p.proname                          AS function_name,
    pg_get_function_arguments(p.oid)   AS arguments,
    pg_get_function_result(p.oid)      AS return_type
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
ORDER BY p.proname;


-- ============================================================
-- 5. BODY de las funciones críticas que usan las columnas
-- ============================================================
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname IN (
    'adjust_inventory_quantity',
    'upsert_inventory_log',
    'move_inventory_stock',
    'process_picking_list',
    'get_snapshot',
    'create_daily_snapshot'
)
AND pronamespace = 'public'::regnamespace;
