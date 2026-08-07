-- Migration: Allow MAIN_4ROW block_id in warehouse_no_movers and warehouse_block_settings tables

ALTER TABLE public.warehouse_no_movers DROP CONSTRAINT IF EXISTS warehouse_no_movers_block_id_check;
ALTER TABLE public.warehouse_no_movers ADD CONSTRAINT warehouse_no_movers_block_id_check CHECK (block_id IN ('MAIN_4ROW', 'A', 'B'));

ALTER TABLE public.warehouse_block_settings DROP CONSTRAINT IF EXISTS warehouse_block_settings_block_id_check;
ALTER TABLE public.warehouse_block_settings ADD CONSTRAINT warehouse_block_settings_block_id_check CHECK (block_id IN ('MAIN_4ROW', 'A', 'B'));
