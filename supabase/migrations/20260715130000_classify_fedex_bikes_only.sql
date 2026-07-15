-- Parts never make an order 'regular': a 50-part order still ships FedEx.
-- Only bike volume (>= 5 bikes per sku_metadata.is_bike) or a heavy item
-- (> 50 lbs) forces a truck. Mirrors src/utils/shippingClassification.ts.
CREATE OR REPLACE FUNCTION classify_picking_list_fedex(p_items jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bike_qty integer;
  v_has_heavy boolean;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN true; -- empty order → fedex by default (no items to weigh)
  END IF;

  -- Rule 1: any item > 50 lbs (join with sku_metadata)
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS item
    LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
    WHERE COALESCE(sm.weight_lbs, 0) > 50
  ) INTO v_has_heavy;

  IF v_has_heavy THEN RETURN false; END IF;

  -- Rule 2: >= 5 BIKES (sku_metadata.is_bike). Parts don't count.
  SELECT COALESCE(SUM((item->>'pickingQty')::numeric), 0)::integer
  INTO v_bike_qty
  FROM jsonb_array_elements(p_items) AS item
  JOIN sku_metadata sm ON sm.sku = item->>'sku'
  WHERE sm.is_bike = true;

  IF v_bike_qty >= 5 THEN RETURN false; END IF;

  RETURN true;
END;
$$;
