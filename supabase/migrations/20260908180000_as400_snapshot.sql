-- ============================================================================
-- The whole STOCK INQUIRY screen, kept, so the discrepancies can be found
--
-- The watchdog was parsing five fields off that screen and keeping one. The
-- other four — AS400's own on-hand per warehouse, its weight, its B/P
-- classification and the model year — were read and thrown away, and they are
-- exactly what answers "where do Pickd and AS400 disagree, and about what".
--
-- Rafael, 2026-09-08: "quiero comenzar a comparar las cantidades, nombres y
-- otros datos de los SKU que tenemos con los que tiene el AS400 (…) para
-- decidir en qué nos centramos primero".
--
-- A jsonb snapshot rather than a column per field, on purpose: which field
-- matters is the question, not the answer. Guessing now would mean a migration
-- every time the answer moved. When one of them earns a column — the on-hand
-- probably will — it gets promoted with the evidence already in hand.
--
-- `as400_read_at` timestamps it, and that matters more here than for the name:
-- a name does not go stale and a quantity does. A comparison is only ever as
-- true as the moment it was read.
-- ============================================================================

ALTER TABLE public.sku_metadata
    ADD COLUMN IF NOT EXISTS as400_snapshot jsonb;

COMMENT ON COLUMN public.sku_metadata.as400_snapshot IS
    'Everything AS400 STOCK INQUIRY showed for this SKU when the watchdog last '
    'read it: description, kind (B/P), model_year, weight_lbs, on_hand per '
    'warehouse. Point-in-time — see as400_read_at. Written by the watchdog, '
    'never by a person.';

-- The comparison always asks the same first question: which rows have been read
-- at all? Partial, because most of the catalogue has not.
CREATE INDEX IF NOT EXISTS sku_metadata_as400_read_at_idx
    ON public.sku_metadata (as400_read_at)
    WHERE as400_read_at IS NOT NULL;
