-- ============================================================================
-- The AS400 catalogue name, raw, so each half of the rule stays where it lives
--
-- The watchdog reads STOCK INQUIRY (menu option 02) in the gaps between orders
-- and comes back with a bike's full catalogue name — `CODA S2 L16 2026 GLOSS
-- BLACK`, and NOT truncated at 30 characters the way the order page truncates
-- it (Rafael, 2026-09-02). It cannot put that into `model` / `size` / `color`:
-- splitting a name is `parseBikeName`, which lives in TypeScript here, and the
-- standing decision (2026-09-02) is not to mirror it in the watchdog's Python.
-- One fact, one source.
--
-- So the halves split along the same line as the rule: the watchdog writes what
-- it READ, and Pickd does the parsing where the parser already is.
--
-- This is deliberately NOT a staging table for human approval. Rafael ruled on
-- 2026-09-02 that the watchdog writes straight into sku_metadata, onto empty
-- gaps only. `as400_description` is an empty gap; `model` is the FedEx
-- Dimensions grouping key and is not one, which is why it is not written from
-- there. Every write to `model` or `size` still owes R12 its export simulation
-- (docs/sku-catalog-enrichment.md §17.2) — and that simulation lives here, on
-- the side that has buildFedexDimensions to run it against.
--
-- The column also ends the queue's loop: without it the watchdog would re-read
-- the same model-less SKU every gap forever, because the model stays empty
-- until Pickd splits it. A row that has been read has this filled, and the
-- queue skips it (Q7: once read, never re-read).
-- ============================================================================

ALTER TABLE public.sku_metadata
    ADD COLUMN IF NOT EXISTS as400_description text,
    ADD COLUMN IF NOT EXISTS as400_read_at timestamptz;

COMMENT ON COLUMN public.sku_metadata.as400_description IS
    'Catalogue name exactly as AS400 STOCK INQUIRY shows it, untouched and '
    'unsplit. Written by the watchdog; split into model/size/color by Pickd '
    'with parseBikeName. Not truncated at 30 like the order page.';

COMMENT ON COLUMN public.sku_metadata.as400_read_at IS
    'When the watchdog last read this SKU off AS400. Its presence is what keeps '
    'the enrichment queue from asking again (docs/sku-catalog-enrichment.md Q7).';
