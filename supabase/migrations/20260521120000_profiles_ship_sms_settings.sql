-- Per-user "Ship-out SMS" settings.
--
-- After the DoubleCheckView slide-to-complete, Pickd offers to open the
-- system Messages app with a prefilled "READY TO SHIP" body addressed to
-- a recipient list (the existing group MMS thread on the operator's
-- phone). The toggle and the recipient list are user-scoped — Rafael
-- can have his shipping group set, another packer can have a different
-- one (or have the feature off entirely).
--
-- Schema choice: two new columns on `profiles` rather than a side table,
-- because each profile has at most one recipient list and we always
-- read them together with the rest of the profile row.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS shipping_sms_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shipping_sms_recipients text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.profiles.shipping_sms_enabled IS
  'When true, the DoubleCheckView slider surfaces a "Send Ship-Out SMS" CTA after a successful complete.';

COMMENT ON COLUMN public.profiles.shipping_sms_recipients IS
  'E.164-ish phone numbers (e.g. +19144268047) the SMS is addressed to. Order matters — Messages matches the recipient set to find the existing group thread.';
