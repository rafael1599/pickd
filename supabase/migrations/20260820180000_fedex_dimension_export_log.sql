-- A line per FedEx Dimensions export, so an import that went wrong can be traced
-- to the file that caused it.
--
-- Ship Manager imports the CSV in "Replace current data" mode, which wipes the
-- Dimensions table before loading. When a rate looks wrong weeks later, the
-- question is always which export was live at the time and how much of the
-- catalog it actually carried -- a file with 124 records and one with 40 are
-- both "successful" imports. Record count and exception count together answer
-- that without keeping the files themselves.
--
-- Append-only by design: no UPDATE or DELETE policy exists, so a row cannot be
-- edited after the fact. Admins read the whole log; the export button is already
-- admin-gated, but RLS is what actually enforces it.
--
-- Depends on: is_admin() in 20260307221638_remote_schema.sql:504

BEGIN;

CREATE TABLE IF NOT EXISTS public.fedex_dimension_exports (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  exported_at     timestamptz NOT NULL DEFAULT now(),
  exported_by     uuid        REFERENCES public.profiles(id),
  filename        text        NOT NULL,
  record_count    integer     NOT NULL,
  exception_count integer     NOT NULL
);

COMMENT ON TABLE public.fedex_dimension_exports IS
  'One row per FedEx Ship Manager Dimensions export. Append-only: no update or delete policy exists. Counts are kept rather than the file, because they are what identifies a partial catalog after the fact.';

COMMENT ON COLUMN public.fedex_dimension_exports.record_count IS
  'Rows in the CSV. FSM should report Processed = this number, Errors = 0.';

COMMENT ON COLUMN public.fedex_dimension_exports.exception_count IS
  'SKUs left out: unverified dimensions, no model, or dimensions that failed the format or side-ordering checks.';

CREATE INDEX IF NOT EXISTS fedex_dimension_exports_exported_at_idx
  ON public.fedex_dimension_exports (exported_at DESC);

ALTER TABLE public.fedex_dimension_exports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fedex_dimension_exports_select_admin" ON public.fedex_dimension_exports;
CREATE POLICY "fedex_dimension_exports_select_admin"
  ON public.fedex_dimension_exports FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- The row records who exported, so it may only be written as yourself.
DROP POLICY IF EXISTS "fedex_dimension_exports_insert_admin" ON public.fedex_dimension_exports;
CREATE POLICY "fedex_dimension_exports_insert_admin"
  ON public.fedex_dimension_exports FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin() AND exported_by = auth.uid());

COMMIT;
