-- quick_group_completed_orders creates groups for completed PICK UP orders
-- parked at the same location. These were tagged 'general', indistinguishable
-- from a deliberate same-customer combine — give them their own 'pickup'
-- group_type so client logic (and any future reporting) can tell them apart.

CREATE OR REPLACE FUNCTION public.quick_group_completed_orders(
  p_list_ids UUID[],
  p_location TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id UUID;
  v_caller_id UUID;
  v_count INT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF array_length(p_list_ids, 1) < 2 THEN
    RAISE EXCEPTION 'quick_group_completed_orders: at least 2 orders required';
  END IF;

  -- Verify all orders are completed and owned by same customer
  SELECT COUNT(*) INTO v_count
  FROM public.picking_lists
  WHERE id = ANY(p_list_ids)
    AND status = 'completed'
    AND is_shipped = false;

  IF v_count <> array_length(p_list_ids, 1) THEN
    RAISE EXCEPTION 'quick_group_completed_orders: all orders must be completed and not shipped';
  END IF;

  -- Create group
  INSERT INTO public.order_groups (group_type)
  VALUES ('pickup')
  RETURNING id INTO v_group_id;

  -- Assign all orders to group
  UPDATE public.picking_lists
  SET group_id = v_group_id, updated_at = now()
  WHERE id = ANY(p_list_ids);

  -- Add parked location notes for each order
  INSERT INTO public.picking_list_notes (list_id, user_id, message)
  SELECT id, v_caller_id, '[Parked]: ' || p_location
  FROM public.picking_lists
  WHERE id = ANY(p_list_ids);

  RETURN json_build_object(
    'success', true,
    'group_id', v_group_id,
    'orders_grouped', array_length(p_list_ids, 1)
  );
END;
$$;

ALTER FUNCTION public.quick_group_completed_orders(UUID[], TEXT) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.quick_group_completed_orders(UUID[], TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.quick_group_completed_orders(UUID[], TEXT) TO service_role;
