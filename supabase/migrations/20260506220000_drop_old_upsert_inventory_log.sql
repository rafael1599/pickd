-- Hotfix for prod 'function is not unique' error on adjust_inventory_quantity.
--
-- Background: 20260506190000 added p_note + p_previous_sku to
-- upsert_inventory_log via CREATE OR REPLACE. Because the new params have
-- defaults, CREATE OR REPLACE created a SECOND function instead of replacing
-- the first — Postgres treats different arg-lists as different functions.
--
-- With both signatures present, any caller passing the original 18 args (no
-- p_note, no p_previous_sku) hits 'function public.upsert_inventory_log(...)
-- is not unique' because both overloads match equally well after defaults.
--
-- This migration drops the legacy 18-arg signature. The 20-arg version stays
-- and is the only one Postgres can resolve. Existing callers that pass 18
-- args still work because the last 2 params have defaults.

DROP FUNCTION IF EXISTS public.upsert_inventory_log(
  text, text, text, text, text, integer, integer, integer, text,
  bigint, uuid, uuid, text, uuid, uuid, text, jsonb, boolean
);
