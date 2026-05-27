-- Defense against the "ROW 23 ↔ ROW 1" data-drift bug.
--
-- Incident: 03-4227BL had inventory.location='ROW 23' but
-- inventory.location_id pointing at a locations row whose name='ROW 1'.
-- Root cause: an ad-hoc psql script ('sublocation audit', 2026-04-14) that
-- updated the text column without updating the FK. The codebase paths
-- (move_inventory_stock RPC, inventory.service.updateItem) always touch
-- both, so the bug was operator-introduced — but the schema accepted the
-- drift silently.
--
-- This migration adds three layers of defense, none of which break the
-- existing app behavior:
--
--   1. A BEFORE INSERT/UPDATE trigger that keeps location ↔ location_id
--      consistent automatically:
--      - If only one side is changed, the trigger resolves and sets the
--        other side (NOTICE-level message for visibility in psql).
--      - If both are changed and disagree, the trigger RAISES — the
--        caller must fix the conflict before persisting.
--   2. A view `v_inventory_location_drift` for ongoing monitoring.
--   3. A one-shot UPDATE to backfill any rows that are already drifted.

-- =========================================================================
-- Layer 1: sync trigger
-- =========================================================================

CREATE OR REPLACE FUNCTION public.sync_inventory_location_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fk_location text;
  v_resolved_id uuid;
BEGIN
  -- Both NULL: no constraint to enforce.
  IF NEW.location IS NULL AND NEW.location_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- INSERT case A: only text given → resolve FK.
    IF NEW.location IS NOT NULL AND NEW.location_id IS NULL THEN
      SELECT id INTO v_resolved_id
      FROM public.locations
      WHERE warehouse = NEW.warehouse
        AND location  = NEW.location
        AND is_active = true
      ORDER BY created_at LIMIT 1;
      NEW.location_id := v_resolved_id;  -- may stay NULL if no match
      RETURN NEW;
    END IF;

    -- INSERT case B: only FK given → set text.
    IF NEW.location_id IS NOT NULL AND NEW.location IS NULL THEN
      SELECT location INTO v_fk_location FROM public.locations WHERE id = NEW.location_id;
      NEW.location := v_fk_location;
      RETURN NEW;
    END IF;

    -- INSERT case C: both given → must agree.
    SELECT location INTO v_fk_location FROM public.locations WHERE id = NEW.location_id;
    IF v_fk_location IS DISTINCT FROM NEW.location THEN
      RAISE EXCEPTION 'inventory_location_drift: location=% does not match locations.id=% (resolved to %)',
        NEW.location, NEW.location_id, v_fk_location
        USING ERRCODE = '23514',
              HINT = 'Set only one of (location, location_id), or pass values that agree. Trigger sync_inventory_location_columns enforces this.';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: distinguish "field changed by caller" vs "field inherited from OLD"
  IF TG_OP = 'UPDATE' THEN
    DECLARE
      v_loc_changed boolean := NEW.location IS DISTINCT FROM OLD.location;
      v_fk_changed  boolean := NEW.location_id IS DISTINCT FROM OLD.location_id;
    BEGIN
      -- Neither changed: nothing to do.
      IF NOT v_loc_changed AND NOT v_fk_changed THEN
        RETURN NEW;
      END IF;

      -- Only text changed → re-resolve FK from the new text.
      IF v_loc_changed AND NOT v_fk_changed THEN
        IF NEW.location IS NULL THEN
          NEW.location_id := NULL;
        ELSE
          SELECT id INTO v_resolved_id
          FROM public.locations
          WHERE warehouse = NEW.warehouse
            AND location  = NEW.location
            AND is_active = true
          ORDER BY created_at LIMIT 1;
          NEW.location_id := v_resolved_id;
        END IF;
        RAISE NOTICE 'sync_inventory_location_columns: auto-resolved location_id for sku=% (% → %)',
          NEW.sku, OLD.location_id, NEW.location_id;
        RETURN NEW;
      END IF;

      -- Only FK changed → set text from the new FK.
      IF v_fk_changed AND NOT v_loc_changed THEN
        IF NEW.location_id IS NULL THEN
          NEW.location := NULL;
        ELSE
          SELECT location INTO v_fk_location FROM public.locations WHERE id = NEW.location_id;
          NEW.location := v_fk_location;
        END IF;
        RAISE NOTICE 'sync_inventory_location_columns: auto-set location text for sku=% (% → %)',
          NEW.sku, OLD.location, NEW.location;
        RETURN NEW;
      END IF;

      -- Both changed → must agree.
      SELECT location INTO v_fk_location FROM public.locations WHERE id = NEW.location_id;
      IF v_fk_location IS DISTINCT FROM NEW.location THEN
        RAISE EXCEPTION 'inventory_location_drift: location=% does not match locations.id=% (resolved to %)',
          NEW.location, NEW.location_id, v_fk_location
          USING ERRCODE = '23514',
                HINT = 'Update only one of (location, location_id), or pass values that agree.';
      END IF;
      RETURN NEW;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

-- Run AFTER trg_inventory_uppercase so we see the normalized text.
-- 'trg_zz_*' sorts last alphabetically among inventory triggers.
DROP TRIGGER IF EXISTS trg_zz_inventory_sync_location ON public.inventory;
CREATE TRIGGER trg_zz_inventory_sync_location
  BEFORE INSERT OR UPDATE ON public.inventory
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_inventory_location_columns();

-- =========================================================================
-- Layer 2: monitoring view
-- =========================================================================
CREATE OR REPLACE VIEW public.v_inventory_location_drift AS
SELECT
  i.id            AS inventory_id,
  i.sku,
  i.warehouse,
  i.location      AS raw_location,
  l.location      AS fk_location,
  i.location_id,
  i.quantity,
  i.is_active,
  i.updated_at
FROM public.inventory i
JOIN public.locations l ON l.id = i.location_id
WHERE i.location IS DISTINCT FROM l.location;

GRANT SELECT ON public.v_inventory_location_drift
  TO anon, authenticated, service_role;

COMMENT ON VIEW public.v_inventory_location_drift IS
  'Rows where inventory.location (text) and the FK-resolved location name disagree. Should be empty in steady state — populated indicates an ad-hoc script (or an older bug) wrote one side without the other. The sync trigger prevents new drift on INSERT/UPDATE.';

-- =========================================================================
-- Layer 3: one-time backfill of existing drift
-- =========================================================================
-- For each currently-drifted row, prefer the text column (which is the
-- source of truth used by InventoryScreen and pinned by the consolidation
-- fix in 20260520150000) and re-point location_id at the matching
-- locations row. If no match exists, leave location_id NULL.
UPDATE public.inventory i
SET location_id = (
  SELECT l.id FROM public.locations l
  WHERE l.warehouse = i.warehouse
    AND l.location  = i.location
    AND l.is_active = true
  ORDER BY l.created_at LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM public.locations l
  WHERE l.id = i.location_id
    AND l.location IS DISTINCT FROM i.location
);
