-- idea-153: one shared key between the AS400, watchdog-pickd, Pickd and FedEx Ship Manager.
-- Design and phases: docs/fedex-customer-id-integration.md. Additive only — staging and
-- production share this database.
--
-- The "Recipient ID" the ship station types into FedEx Ship Manager is the AS400 account
-- number without leading zeros followed by the two-digit ship-to suffix:
--   'Account Number: 0010495 00'  →  '1049500'
-- FSM already holds 951 recipients under that convention (verified on the FSM machine on
-- 2026-08-26: typing 1049500 fills TUCKER CYCLES). The watchdog parses that header line and
-- until now dropped it. These columns keep it — on the address, because the key identifies a
-- ship-to, not a customer: a dealer with two stores is xxxx00 and xxxx01.

-- customers: the bill-to account, and the "channel" flag ---------------------------------

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS as400_account text,
  ADD COLUMN IF NOT EXISTS ship_to_varies boolean NOT NULL DEFAULT false;

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_as400_account_check,
  ADD CONSTRAINT customers_as400_account_check
    CHECK (as400_account ~ '^[1-9][0-9]{0,6}$');

CREATE INDEX IF NOT EXISTS idx_customers_as400_account
  ON public.customers (as400_account)
  WHERE as400_account IS NOT NULL;

COMMENT ON COLUMN public.customers.as400_account IS
  'AS400 bill-to account without leading zeros (0010495 → 10495). Sealed by the watchdog from '
  'the order header, never overwritten once set. Not unique yet: customers has duplicate rows '
  'by name until they are merged (idea-153 phase 1b).';
COMMENT ON COLUMN public.customers.ship_to_varies IS
  'Channel whose ship-to changes on every order (consumer direct, Facebook, warranty, eBay, '
  'donations). Its addresses never get a fedex_recipient_id, and the ship station must untick '
  '"Save in/Update my address book" in FedEx Ship Manager.';

-- customer_addresses: the key lives on the ship-to ---------------------------------------

ALTER TABLE public.customer_addresses
  ADD COLUMN IF NOT EXISTS as400_ship_to text,
  ADD COLUMN IF NOT EXISTS fedex_recipient_id text,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS residential boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fedex_synced_at timestamptz;

ALTER TABLE public.customer_addresses
  DROP CONSTRAINT IF EXISTS customer_addresses_as400_ship_to_check,
  ADD CONSTRAINT customer_addresses_as400_ship_to_check
    CHECK (as400_ship_to ~ '^[0-9]{2}$'),
  DROP CONSTRAINT IF EXISTS customer_addresses_fedex_recipient_id_check,
  -- FSM's Recipient Code field is 25 characters and travels in a double-quoted CSV field.
  -- Legacy hand-typed codes ('SB 202', "RANDY'S") are imported as they are in phase 2, so
  -- the check is about shape, not charset.
  ADD CONSTRAINT customer_addresses_fedex_recipient_id_check
    CHECK (
      fedex_recipient_id = btrim(fedex_recipient_id)
      AND length(fedex_recipient_id) BETWEEN 1 AND 25
      AND position('"' IN fedex_recipient_id) = 0
    );

CREATE UNIQUE INDEX IF NOT EXISTS customer_addresses_fedex_recipient_id_key
  ON public.customer_addresses (fedex_recipient_id)
  WHERE fedex_recipient_id IS NOT NULL;

COMMENT ON COLUMN public.customer_addresses.as400_ship_to IS
  'Two-digit ship-to suffix from the AS400 header ("0010495 00" → "00").';
COMMENT ON COLUMN public.customer_addresses.fedex_recipient_id IS
  'The Recipient ID typed into FedEx Ship Manager. Digits = AS400 account + ship-to; PK… = '
  'minted by Pickd for a manual order; anything else = a legacy hand-typed FSM code. Filled by '
  'trigger from as400_ship_to when NULL; an explicit value always wins.';
COMMENT ON COLUMN public.customer_addresses.contact_name IS
  'FSM Contact (35 chars). The AS400 header has no contact; FSM has one for 86% of recipients.';
COMMENT ON COLUMN public.customer_addresses.residential IS
  'FSM Residential/Commercial indicator (R/C). FedEx rates residential deliveries differently.';
COMMENT ON COLUMN public.customer_addresses.fedex_synced_at IS
  'Last time FSM and Pickd agreed on this row (an export or an import). NULL = FSM does not '
  'have it as far as Pickd knows. Reset to NULL by trigger when the address changes.';

-- picking_lists: what the header said, and which ship-to this order goes to --------------

ALTER TABLE public.picking_lists
  ADD COLUMN IF NOT EXISTS as400_account_number text,
  ADD COLUMN IF NOT EXISTS ship_to_address_id uuid
    REFERENCES public.customer_addresses (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_picking_lists_ship_to_address_id
  ON public.picking_lists (ship_to_address_id)
  WHERE ship_to_address_id IS NOT NULL;

COMMENT ON COLUMN public.picking_lists.as400_account_number IS
  'Raw "Account Number" from the AS400 header ("0010495 00"), kept for audit.';
COMMENT ON COLUMN public.picking_lists.ship_to_address_id IS
  'The customer_addresses row this order ships to. Until now the order only had customer_id '
  'and the address was "the customer default", which is the wrong store half the time for a '
  'dealer with two.';

-- The rule, in one place ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fedex_recipient_id_for(p_account text, p_ship_to text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_account ~ '^[0-9]+$'
     AND p_ship_to ~ '^[0-9]{2}$'
     AND ltrim(p_account, '0') <> ''
    THEN ltrim(p_account, '0') || p_ship_to
  END
$$;

COMMENT ON FUNCTION public.fedex_recipient_id_for(text, text) IS
  'FedEx Recipient ID for an AS400 account + ship-to: account without leading zeros followed '
  'by the two-digit suffix ("0010495", "00" → "1049500"). NULL when either part is not digits.';

CREATE OR REPLACE FUNCTION public.set_customer_address_fedex_recipient_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_account text;
  v_varies boolean;
BEGIN
  -- Only fill what comes NULL: an explicit value always wins (same contract as
  -- tr_sku_metadata_set_is_bike and tr_picking_list_notes_set_kind).
  IF NEW.fedex_recipient_id IS NULL AND NEW.as400_ship_to IS NOT NULL THEN
    SELECT c.as400_account, c.ship_to_varies
      INTO v_account, v_varies
      FROM public.customers c
     WHERE c.id = NEW.customer_id;
    IF v_account IS NOT NULL AND NOT COALESCE(v_varies, false) THEN
      NEW.fedex_recipient_id := public.fedex_recipient_id_for(v_account, NEW.as400_ship_to);
    END IF;
  END IF;

  -- An address that changed after it was last synced needs syncing again. An explicit
  -- fedex_synced_at written in the same statement (the FSM import of phase 2) still wins.
  IF TG_OP = 'UPDATE'
     AND NEW.fedex_synced_at IS NOT DISTINCT FROM OLD.fedex_synced_at
     AND (
       NEW.street IS DISTINCT FROM OLD.street
       OR NEW.city IS DISTINCT FROM OLD.city
       OR NEW.state IS DISTINCT FROM OLD.state
       OR NEW.zip_code IS DISTINCT FROM OLD.zip_code
       OR NEW.label IS DISTINCT FROM OLD.label
       OR NEW.contact_name IS DISTINCT FROM OLD.contact_name
       OR NEW.residential IS DISTINCT FROM OLD.residential
     ) THEN
    NEW.fedex_synced_at := NULL;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS tr_customer_addresses_fedex_recipient_id ON public.customer_addresses;
CREATE TRIGGER tr_customer_addresses_fedex_recipient_id
  BEFORE INSERT OR UPDATE ON public.customer_addresses
  FOR EACH ROW
  EXECUTE FUNCTION public.set_customer_address_fedex_recipient_id();

-- Known channels (provisional list, operator to confirm — reversible from the customer) ---
-- JAMIS CONSUMER ALL ACCESS ships to 25 different addresses across 72 orders; the others are
-- the same shape. Verified on FSM: DEALER WARRANTY 2009 (2004500) is saved there as a private
-- house in Beaufort SC — the last consumer overwrote the channel's record.

UPDATE public.customers
   SET ship_to_varies = true
 WHERE upper(btrim(name)) IN (
         'JAMIS CONSUMER ALL ACCESS',
         'FACEBOOK SALES',
         'EBAY PART SALES',
         'CARINE JOANNOU PERSONAL'
       )
    OR upper(name) LIKE 'DEALER WARRANTY%'
    OR upper(name) LIKE 'JAMIS WARRANTY%'
    OR upper(name) LIKE 'DONATIONS%';
