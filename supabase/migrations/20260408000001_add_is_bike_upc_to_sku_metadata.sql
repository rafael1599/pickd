-- idea-042 + idea-038A: Add is_bike and upc columns to sku_metadata
-- Moves bike detection from fragile client-side regex to DB source of truth.
--
-- Cascade priority (trigger + backfill):
--   1. Regex (strict): ^\d{2}-\d{4}[A-Za-z]{2,}$  → TRUE
--   2. Known prefixes:  01-, 03-, 05-, 06-, 07-     → TRUE
--   3. Everything else                               → FALSE
--   Manual override: if is_bike is explicitly set, trigger does NOT overwrite.

-- ============================================================
-- 1. Add columns (additive, safe for shared DB)
-- ============================================================
ALTER TABLE public.sku_metadata ADD COLUMN IF NOT EXISTS is_bike BOOLEAN;
ALTER TABLE public.sku_metadata ADD COLUMN IF NOT EXISTS upc TEXT;

-- ============================================================
-- 2. Backfill existing rows with cascade priority
-- ============================================================
UPDATE public.sku_metadata
SET is_bike = CASE
    WHEN sku ~ '^\d{2}-\d{4}[A-Za-z]{2,}$' THEN TRUE   -- strict regex first
    WHEN sku ~ '^(01|03|05|06|07)-'          THEN TRUE   -- known bike prefixes
    ELSE FALSE
END
WHERE is_bike IS NULL;

-- ============================================================
-- 3. Trigger: auto-classify new SKUs on INSERT
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_sku_metadata_is_bike()
RETURNS TRIGGER AS $$
BEGIN
  NEW.is_bike := COALESCE(NEW.is_bike, CASE
    WHEN NEW.sku ~ '^\d{2}-\d{4}[A-Za-z]{2,}$' THEN TRUE
    WHEN NEW.sku ~ '^(01|03|05|06|07)-'          THEN TRUE
    ELSE FALSE
  END);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_sku_metadata_set_is_bike ON public.sku_metadata;
CREATE TRIGGER tr_sku_metadata_set_is_bike
  BEFORE INSERT ON public.sku_metadata
  FOR EACH ROW
  EXECUTE FUNCTION public.set_sku_metadata_is_bike();

-- ============================================================
-- 4. Update calculate_bike_distribution: regex → sku_metadata lookup
--    Volatility: IMMUTABLE → STABLE (now reads from table)
-- ============================================================
CREATE OR REPLACE FUNCTION public.calculate_bike_distribution(p_sku TEXT, p_qty INTEGER)
RETURNS JSONB
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_is_bike BOOLEAN;
  v_result JSONB := '[]'::JSONB;
  v_remaining INTEGER;
  v_towers INTEGER;
  v_full_lines INTEGER;
BEGIN
  -- Look up is_bike from sku_metadata (source of truth)
  SELECT is_bike INTO v_is_bike FROM public.sku_metadata WHERE sku = p_sku;

  IF v_is_bike IS NOT TRUE THEN
    RETURN NULL;
  END IF;

  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN '[]'::JSONB;
  END IF;

  v_remaining := p_qty;

  -- Towers of 30
  v_towers := floor(v_remaining / 30);
  IF v_towers > 0 THEN
    v_result := v_result || jsonb_build_array(
      jsonb_build_object('type', 'TOWER', 'count', v_towers, 'units_each', 30)
    );
    v_remaining := v_remaining - (v_towers * 30);
  END IF;

  -- Full lines of 5
  v_full_lines := floor(v_remaining / 5);
  IF v_full_lines > 0 THEN
    v_result := v_result || jsonb_build_array(
      jsonb_build_object('type', 'LINE', 'count', v_full_lines, 'units_each', 5)
    );
    v_remaining := v_remaining - (v_full_lines * 5);
  END IF;

  -- Remainder as a single line (1-4 units)
  IF v_remaining > 0 THEN
    v_result := v_result || jsonb_build_array(
      jsonb_build_object('type', 'LINE', 'count', 1, 'units_each', v_remaining)
    );
  END IF;

  RETURN v_result;
END;
$$;

-- ============================================================
-- 5. Permissions
-- ============================================================
GRANT SELECT ON public.sku_metadata TO anon, authenticated, service_role;
