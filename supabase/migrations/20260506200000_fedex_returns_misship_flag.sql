-- Add an is_misship flag to fedex_returns. Some returns come back not via
-- a manufacturer RMA but because of a mis-ship (item went to wrong customer
-- or address). The two are mutually independent at the data layer — both
-- can be set, neither, or just one — but operationally the UI treats them
-- as complementary categorizations of the same return.
ALTER TABLE public.fedex_returns
  ADD COLUMN IF NOT EXISTS is_misship boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.fedex_returns.is_misship IS
  'True when the return was triggered by a mis-ship (wrong recipient/address) rather than an RMA. Captured at intake or via the edit flow on the card.';

CREATE INDEX IF NOT EXISTS fedex_returns_misship_idx
  ON public.fedex_returns (is_misship)
  WHERE is_misship = true;
