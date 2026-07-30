-- RPC: add_parked_location_note
-- Safely inserts a parked location note for a picking list.
-- Called when user assigns PICK UP carrier and selects parking location.

CREATE OR REPLACE FUNCTION public.add_parked_location_note(
  p_list_id UUID,
  p_location TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID;
  v_note_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  INSERT INTO public.picking_list_notes (list_id, user_id, message)
  VALUES (p_list_id, v_caller_id, '[Parked]: ' || p_location)
  RETURNING id INTO v_note_id;

  RETURN json_build_object('success', true, 'note_id', v_note_id);
END;
$$;

ALTER FUNCTION public.add_parked_location_note(UUID, TEXT) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.add_parked_location_note(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_parked_location_note(UUID, TEXT) TO service_role;
