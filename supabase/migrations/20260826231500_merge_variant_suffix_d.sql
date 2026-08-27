-- ============================================================================
-- The box says BL: merge the AS400 "D" finish-letter siblings into the
-- 2-letter name (idea-154, follow-up)
--
-- Rafael, 2026-08-26: the bikes AS400 prints with a third letter — '03 3768
-- BLD', '03 3769 BLD' — are the ones PickD (and the carton) know as BL. So
-- the catalog keeps ONE name per family, the 2-letter one, and the third
-- letter becomes what the watcher already treats it as: a variant suffix on
-- the paper that never names a different bike.
--
-- Three families had both names alive; the stock sat under a different one
-- in each (the sibling rule resolved them by stock since this morning, but
-- receiving could still land new units under either name):
--   03-3768BLD (0)   → 03-3768BL (144)
--   03-3769BLD (75)  → 03-3769BL (0)     rows move, name changes
--   03-3779RDD (0)   → 03-3779RD (113)   same "D" pattern, same decision
-- The three 3-letter SKUs with no twin (01-8791SPT, 06-4294MVC, 06-4627LDV)
-- are not a "D" suffix and are left alone.
--
-- rename_sku_everywhere does the merge (rows, history, every order line,
-- audit row in sku_canonical_renames). Activity and compensation triggers
-- off for the pass, as in 20260826220000: a respelled line in an active
-- order must not read as "replaced item" and move stock.
-- ============================================================================

ALTER TABLE public.picking_lists DISABLE TRIGGER update_activity_timestamp;
ALTER TABLE public.picking_lists DISABLE TRIGGER compensate_picking_list_changes_trigger;

DO $$
DECLARE
  pair text[];
  v    jsonb;
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ARRAY['03-3768BLD', '03-3768BL'],
    ARRAY['03-3769BLD', '03-3769BL'],
    ARRAY['03-3779RDD', '03-3779RD']
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM public.sku_metadata WHERE sku = pair[1]) THEN
      v := public.rename_sku_everywhere(pair[1], pair[2], 'Box says the 2-letter name (Rafael, 2026-08-26)');
      RAISE NOTICE 'merged % into %: %', pair[1], pair[2], v;
    ELSE
      RAISE NOTICE '% already gone, nothing to merge', pair[1];
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.picking_lists ENABLE TRIGGER update_activity_timestamp;
ALTER TABLE public.picking_lists ENABLE TRIGGER compensate_picking_list_changes_trigger;
