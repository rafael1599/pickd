-- idea-105 Phase 1: persist verified item keys cross-user.
--
-- Verifier progress today lives in the browser's localStorage at key
-- `double_check_progress_${listId}`. That means a Park Order on picker A's
-- device is invisible to picker B who later takes the order — picker B
-- starts from zero verified items.
--
-- Adds a column on picking_lists that stores the set of verified
-- pallet-item-location keys as a JSONB array. The client persists with
-- a debounced UPDATE on every toggle and hydrates from DB on load,
-- falling back to localStorage when the column is empty (legacy orders
-- or fast offline cache).
--
-- Future phases (idea-105 phase 2/3) layer on top: DEDUCT on toggle,
-- realtime broadcast for cross-order visibility, ItemDetail breakdown.

ALTER TABLE public.picking_lists
  ADD COLUMN IF NOT EXISTS verified_item_keys jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.picking_lists.verified_item_keys IS
  'idea-105 Phase 1: array of pallet-item-location keys verified during double-check. Persisted via debounced UPDATE; survives Park Order so the next picker sees prior progress.';
