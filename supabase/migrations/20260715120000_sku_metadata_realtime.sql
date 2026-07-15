-- sku_metadata was never added to the realtime publication, so the client's
-- postgres_changes subscription on it (useInventoryRealtime.ts) never fired.
-- Result: marking an item as bike/part/S&D persisted in the DB but every
-- device's react-query cache kept the stale value until a full reload —
-- the edit looked like it "didn't save".
--
-- Adding the table to the publication makes metadata edits propagate live,
-- which also unblocks the S&D catalog invalidation wired to the same handler.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'sku_metadata'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sku_metadata;
  END IF;
END $$;
