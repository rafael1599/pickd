-- Nine inventory rows sat at quantity = 0 with is_active = true, which contradicts the
-- invariant adjust_inventory_quantity and undo_inventory_action maintain in both directions.
-- They reach the UI as stock that exists but has nothing in it.
--
-- Seven are deactivated here. Two are deliberately left alone: 792259770172 and
-- 792267104817 are FedEx tracking numbers, and the returns flow registers those as
-- zero-quantity placeholders on purpose, the same documented exception register_new_sku
-- relies on when onboarding a bike that has not arrived yet.
--
-- Case by case:
--   03-4704GY, 03-4707GY  Renegade S3 54 and 61, returned to the factory. No stock left.
--   03-4638RD, 03-4065BL  Empty item_name. Rows that were never filled in.
--   03-3718GY             Highpoint A2 19 2025 Monterey Grey, sold down to zero.
--   03-4664BR             item_name is literally "sanity test", left over in INCOMING.
--   01-$&;%               "Bike example" in FDX. Known junk record, registered without a type.

UPDATE inventory
SET is_active = false
WHERE quantity = 0
  AND is_active = true
  AND sku IN (
    '03-4704GY',
    '03-4707GY',
    '03-4638RD',
    '03-4065BL',
    '03-3718GY',
    '03-4664BR',
    '01-$&;%'
  );
