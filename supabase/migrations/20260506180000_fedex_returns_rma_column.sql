-- Add an RMA (Return Merchandise Authorization) column to fedex_returns.
-- Capture going forward; existing rows stay NULL.
ALTER TABLE public.fedex_returns
  ADD COLUMN IF NOT EXISTS rma text;

COMMENT ON COLUMN public.fedex_returns.rma IS
  'Optional RMA / authorization number issued by the manufacturer or vendor for the return. Captured at intake time and surfaced on the daily Activity Report.';

CREATE INDEX IF NOT EXISTS fedex_returns_rma_idx
  ON public.fedex_returns (rma)
  WHERE rma IS NOT NULL;
