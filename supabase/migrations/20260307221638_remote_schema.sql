


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', 'public, auth, extensions', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE SCHEMA IF NOT EXISTS "public";
CREATE SCHEMA IF NOT EXISTS "auth";
CREATE SCHEMA IF NOT EXISTS "extensions";


-- CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



-- CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






-- CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






-- CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."adjust_inventory_quantity"("p_sku" "text", "p_warehouse" "text", "p_location" "text", "p_delta" integer, "p_performed_by" "text", "p_user_id" "uuid", "p_user_role" "text" DEFAULT 'staff'::"text", "p_list_id" "uuid" DEFAULT NULL::"uuid", "p_order_number" "text" DEFAULT NULL::"text", "p_merge_note" "text" DEFAULT NULL::"text", "p_skip_log" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_item_id INTEGER;
  v_location_id UUID;
  v_location_name TEXT;
  v_prev_qty INTEGER;
  v_new_qty INTEGER;
  v_actual_delta INTEGER;
  v_snapshot JSONB;
BEGIN
  v_location_id := public.resolve_location(p_warehouse, p_location, p_user_role);
  SELECT location INTO v_location_name FROM locations WHERE id = v_location_id;
  
  IF v_location_id IS NOT NULL AND v_location_name IS NULL THEN
      v_location_name := UPPER(TRIM(p_location));
  END IF;

  v_actual_delta := p_delta;

  SELECT id, quantity, row_to_json(inventory.*)::jsonb INTO v_item_id, v_prev_qty, v_snapshot
  FROM inventory
  WHERE sku = p_sku 
    AND warehouse = p_warehouse 
    AND UPPER(TRIM(COALESCE(location, ''))) = UPPER(TRIM(COALESCE(v_location_name, '')))
  FOR UPDATE;

  IF v_item_id IS NULL THEN
    v_prev_qty := 0;
    IF p_delta < 0 THEN
      v_actual_delta := 0;
      v_new_qty := 0;
    ELSE
      v_new_qty := p_delta;
    END IF;
    
    INSERT INTO inventory (sku, warehouse, location, location_id, quantity, is_active, item_name)
    VALUES (p_sku, p_warehouse, v_location_name, v_location_id, v_new_qty, (v_new_qty > 0), p_merge_note)
    RETURNING id INTO v_item_id;
  ELSE
    v_new_qty := v_prev_qty + p_delta;
    IF v_new_qty < 0 THEN 
      v_new_qty := 0;
      v_actual_delta := -v_prev_qty;
    END IF;

    UPDATE inventory SET 
      quantity = v_new_qty,
      location_id = v_location_id,
      location = v_location_name,
      is_active = CASE WHEN v_new_qty > 0 THEN true ELSE is_active END,
      updated_at = NOW(),
      item_name = CASE 
        WHEN p_merge_note IS NOT NULL AND LENGTH(TRIM(p_merge_note)) > 0 THEN 
            CASE 
                WHEN item_name IS NULL OR LENGTH(TRIM(item_name)) = 0 THEN p_merge_note
                WHEN item_name != p_merge_note AND item_name NOT LIKE '%' || p_merge_note || '%' THEN item_name || ' | ' || p_merge_note
                ELSE item_name
            END
        ELSE item_name
      END
    WHERE id = v_item_id;
  END IF;

  IF NOT p_skip_log AND v_actual_delta != 0 THEN
    PERFORM public.upsert_inventory_log(
      p_sku, p_warehouse, v_location_name, p_warehouse, v_location_name,
      v_actual_delta, v_prev_qty, v_new_qty, (CASE WHEN v_actual_delta > 0 THEN 'ADD' ELSE 'DEDUCT' END),
      v_item_id, v_location_id, v_location_id, p_performed_by, p_user_id, p_list_id, p_order_number, v_snapshot
    );
  END IF;

  RETURN (SELECT row_to_json(i)::jsonb FROM inventory i WHERE id = v_item_id);
END;
$$;


ALTER FUNCTION "public"."adjust_inventory_quantity"("p_sku" "text", "p_warehouse" "text", "p_location" "text", "p_delta" integer, "p_performed_by" "text", "p_user_id" "uuid", "p_user_role" "text", "p_list_id" "uuid", "p_order_number" "text", "p_merge_note" "text", "p_skip_log" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_cancel_stale_orders"() RETURNS TABLE("id" "uuid", "order_number" "text", "status" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_stale_building RECORD;
    v_expired_verification RECORD;
    v_item JSONB;
    v_sku TEXT;
    v_warehouse TEXT;
    v_location TEXT;
    v_qty INTEGER;
BEGIN
    -- 1. Handle existing logic: 'building' orders (No inventory to release)
    -- Just cancel them if inactive for > 15 mins
    RETURN QUERY
    WITH cancelled_building AS (
        UPDATE picking_lists pl
        SET status = 'cancelled', updated_at = NOW()
        FROM user_presence up
        WHERE pl.user_id = up.user_id
          AND pl.status = 'building'
          AND pl.last_activity_at < NOW() - INTERVAL '15 minutes'
          AND (up.last_seen_at IS NULL OR up.last_seen_at < NOW() - INTERVAL '2 minutes')
        RETURNING pl.id, pl.order_number, 'cancelled_building'::text as status
    )
    SELECT * FROM cancelled_building;

    -- 2. Handle NEW logic: 'ready_to_double_check'/'double_checking' orders > 24 hours
    -- THESE HAVE DEDUCTED INVENTORY. Must release via adjust_inventory_quantity.
    
    FOR v_expired_verification IN 
        SELECT * FROM picking_lists 
        WHERE status IN ('ready_to_double_check', 'double_checking') 
        AND updated_at < NOW() - INTERVAL '24 hours'
        FOR UPDATE -- Lock rows
    LOOP
        -- Restore Inventory
        IF v_expired_verification.items IS NOT NULL THEN
            FOR v_item IN SELECT * FROM jsonb_array_elements(v_expired_verification.items)
            LOOP
                v_sku := v_item->>'sku';
                v_warehouse := v_item->>'warehouse';
                v_location := v_item->>'location';
                v_qty := (v_item->>'pickingQty')::integer; 
                
                -- Fallback to 'qty' if pickingQty is missing, but prioritize pickingQty as that's what was deducted
                IF v_qty IS NULL THEN
                    v_qty := (v_item->>'qty')::integer;
                END IF;
                
                IF v_qty IS NOT NULL AND v_qty > 0 THEN
                    -- Add back (p_delta is positive)
                    -- We catch potential errors here to ensure one bad item doesn't crash the whole batch, 
                    -- though ideally we want it to fail if it can't restore. 
                    BEGIN
                        PERFORM public.adjust_inventory_quantity(
                            v_sku, 
                            v_warehouse, 
                            v_location, 
                            v_qty, 
                            'System Auto-Cancel', 
                            NULL, -- user_id
                            'system', -- role
                            v_expired_verification.id, 
                            v_expired_verification.order_number,
                            'Auto-cancel verification timeout'
                        );
                    EXCEPTION WHEN OTHERS THEN
                        -- Log error but continue cancelling? Or abort? 
                        -- For now, let's propagate error to be safe, so we don't have cancelled orders with missing inventory.
                        RAISE NOTICE 'Error restoring inventory for order % SKU %: %', v_expired_verification.order_number, v_sku, SQLERRM;
                        RAISE; 
                    END;
                END IF;
            END LOOP;
        END IF;

        -- Mark as Cancelled
        UPDATE picking_lists 
        SET status = 'cancelled', 
            updated_at = NOW(),
            notes = COALESCE(notes, '') || ' [System: Auto-cancelled due to 24h verification timeout]'
        WHERE picking_lists.id = v_expired_verification.id;
        
        -- Return this row
        id := v_expired_verification.id;
        order_number := v_expired_verification.order_number;
        status := 'cancelled_verification_timeout';
        RETURN NEXT;
    END LOOP;

    RETURN;
END;
$$;


ALTER FUNCTION "public"."auto_cancel_stale_orders"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_daily_snapshot"("p_snapshot_date" "date" DEFAULT CURRENT_DATE) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Delete existing snapshot for this date
  DELETE FROM daily_inventory_snapshots 
  WHERE snapshot_date = p_snapshot_date;
  
  -- Insert snapshot: ONLY ACTIVE items with STOCK > 0
  INSERT INTO daily_inventory_snapshots 
    (snapshot_date, warehouse, location, sku, quantity, location_id, sku_note)
  SELECT 
    p_snapshot_date,
    warehouse,
    location,
    sku,
    quantity,
    location_id,
    sku_note
  FROM inventory
  WHERE is_active = TRUE AND quantity > 0;
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'success', true,
    'snapshot_date', p_snapshot_date,
    'items_saved', v_count,
    'created_at', NOW()
  );
END;
$$;


ALTER FUNCTION "public"."create_daily_snapshot"("p_snapshot_date" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_daily_snapshot"("p_snapshot_date" "date") IS 'Creates a snapshot of current inventory for the specified date. Idempotent (overwrites existing snapshot).';



CREATE OR REPLACE FUNCTION "public"."current_user_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT COALESCE(
    nullif(current_setting('request.jwt.claims', true), '')::json->>'sub',
    NULL
  )::uuid;
$$;


ALTER FUNCTION "public"."current_user_id"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."current_user_id"() IS 'Cached user ID - evaluates once per query, not per row';



CREATE OR REPLACE FUNCTION "public"."delete_inventory_item"("p_item_id" integer, "p_performed_by" "text", "p_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_item RECORD;
  v_snapshot JSONB;
BEGIN
  SELECT * INTO v_item FROM inventory WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  v_snapshot := row_to_json(v_item)::jsonb;

  UPDATE inventory SET 
    quantity = 0,
    is_active = false,
    updated_at = NOW()
  WHERE id = p_item_id;

  PERFORM public.upsert_inventory_log(
    v_item.sku, v_item.warehouse, v_item.location, v_item.warehouse, v_item.location,
    -v_item.quantity, v_item.quantity, 0, 'DELETE',
    p_item_id, v_item.location_id, v_item.location_id, p_performed_by, p_user_id, NULL, NULL, v_snapshot
  );

  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."delete_inventory_item"("p_item_id" integer, "p_performed_by" "text", "p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."delete_inventory_item"("p_item_id" integer, "p_performed_by" "text", "p_user_id" "uuid") IS 'Performs a soft deactivation of an inventory slot. Sets quantity to 0 and is_active to false.';



CREATE OR REPLACE FUNCTION "public"."enforce_uppercase_location"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.location IS NOT NULL THEN
    NEW.location := UPPER(TRIM(NEW.location));
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_uppercase_location"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_uppercase_log_locations"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.from_location IS NOT NULL THEN
    NEW.from_location := UPPER(TRIM(NEW.from_location));
  END IF;
  IF NEW.to_location IS NOT NULL THEN
    NEW.to_location := UPPER(TRIM(NEW.to_location));
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_uppercase_log_locations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_snapshot"("p_target_date" "date") RETURNS TABLE("warehouse" "text", "location" "text", "sku" "text", "quantity" integer, "location_id" "uuid", "item_name" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.warehouse,
    s.location,
    s.sku,
    s.quantity,
    s.location_id,
    s.item_name
  FROM daily_inventory_snapshots s
  WHERE s.snapshot_date = p_target_date
  ORDER BY s.warehouse, s.location, s.sku;
END;
$$;


ALTER FUNCTION "public"."get_snapshot"("p_target_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_snapshot_summary"("p_target_date" "date" DEFAULT CURRENT_DATE) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_total_skus INTEGER;
  v_total_units BIGINT;
  v_warehouses jsonb;
BEGIN
  -- Count total SKUs and units
  SELECT 
    COUNT(DISTINCT sku),
    SUM(quantity)
  INTO v_total_skus, v_total_units
  FROM daily_inventory_snapshots
  WHERE snapshot_date = p_target_date;
  
  -- Group by warehouse
  SELECT jsonb_agg(
    jsonb_build_object(
      'warehouse', warehouse,
      'total_skus', total_skus,
      'total_units', total_units
    )
  )
  INTO v_warehouses
  FROM (
    SELECT 
      warehouse,
      COUNT(DISTINCT sku) as total_skus,
      SUM(quantity) as total_units
    FROM daily_inventory_snapshots
    WHERE snapshot_date = p_target_date
    GROUP BY warehouse
    ORDER BY warehouse
  ) w;
  
  RETURN jsonb_build_object(
    'snapshot_date', p_target_date,
    'total_skus', COALESCE(v_total_skus, 0),
    'total_units', COALESCE(v_total_units, 0),
    'warehouses', COALESCE(v_warehouses, '[]'::jsonb)
  );
END;
$$;


ALTER FUNCTION "public"."get_snapshot_summary"("p_target_date" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_snapshot_summary"("p_target_date" "date") IS 'Returns snapshot summary statistics. Used for daily email notifications.';



CREATE OR REPLACE FUNCTION "public"."get_stock_at_timestamp"("target_timestamp" timestamp with time zone) RETURNS TABLE("warehouse" "text", "location" "text", "sku" "text", "quantity" bigint)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        to_warehouse as warehouse,
        to_location as location,
        l.sku,
        SUM(l.quantity_change)::BIGINT as quantity
    FROM inventory_logs l
    WHERE 
        l.created_at <= target_timestamp
        AND l.is_reversed = FALSE  -- ✅ CRITICAL FIX: Filter out undone actions
    GROUP BY l.sku, to_warehouse, to_location
    ORDER BY warehouse, location, l.sku;
END;
$$;


ALTER FUNCTION "public"."get_stock_at_timestamp"("target_timestamp" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_stock_at_timestamp"("target_timestamp" timestamp with time zone) IS 'Returns inventory snapshot at a specific timestamp. Excludes reversed (undone) logs to ensure accurate historical data.';



CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id, 
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Staff Member'), 
    'staff' -- Default role
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = public.current_user_id() 
    AND role = 'admin'
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_admin"() IS 'Cached admin check - evaluates once per query';



CREATE OR REPLACE FUNCTION "public"."is_manager"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = public.current_user_id() 
    AND role IN ('admin', 'manager')
  );
$$;


ALTER FUNCTION "public"."is_manager"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_manager"() IS 'Cached manager/admin check - evaluates once per query';



CREATE OR REPLACE FUNCTION "public"."is_user_online"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_presence
    WHERE user_id = p_user_id
    AND last_seen_at > NOW() - INTERVAL '2 minutes'
  );
END;
$$;


ALTER FUNCTION "public"."is_user_online"("p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_user_online"("p_user_id" "uuid") IS 'Returns TRUE if user sent a heartbeat within the last 2 minutes, FALSE otherwise.';



CREATE OR REPLACE FUNCTION "public"."move_inventory_stock"("p_sku" "text", "p_from_warehouse" "text", "p_from_location" "text", "p_to_warehouse" "text", "p_to_location" "text", "p_qty" integer, "p_performed_by" "text", "p_user_id" "uuid" DEFAULT NULL::"uuid", "p_user_role" "text" DEFAULT 'staff'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_src_id BIGINT; v_src_prev_qty INTEGER; v_src_new_qty INTEGER; v_src_note TEXT;
  v_from_loc_id UUID; v_from_loc_name TEXT; v_to_loc_id UUID; v_snapshot JSONB;
BEGIN
  p_from_location := NULLIF(TRIM(UPPER(p_from_location)), '');
  p_to_location := NULLIF(TRIM(UPPER(p_to_location)), '');

  SELECT id, quantity, item_name INTO v_src_id, v_src_prev_qty, v_src_note
  FROM public.inventory WHERE sku = p_sku AND warehouse = p_from_warehouse 
  AND ((p_from_location IS NULL AND (location IS NULL OR location = '')) OR (location = p_from_location))
  AND is_active = TRUE FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Source item not found or inactive'; END IF;

  v_from_loc_id := public.resolve_location(p_from_warehouse, p_from_location);
  SELECT location INTO v_from_loc_name FROM public.locations WHERE id = v_from_loc_id;
  v_to_loc_id := public.resolve_location(p_to_warehouse, p_to_location);

  PERFORM public.adjust_inventory_quantity(p_sku, p_from_warehouse, p_from_location, -p_qty, p_performed_by, p_user_id, p_user_role, NULL, NULL, NULL, TRUE);
  v_src_new_qty := v_src_prev_qty - p_qty;
  PERFORM public.adjust_inventory_quantity(p_sku, p_to_warehouse, p_to_location, p_qty, p_performed_by, p_user_id, p_user_role, NULL, NULL, v_src_note, TRUE);

  SELECT jsonb_build_object('id', v_src_id, 'sku', p_sku, 'quantity', v_src_new_qty, 'location', p_from_location, 'warehouse', p_from_warehouse) INTO v_snapshot;

  PERFORM public.upsert_inventory_log(
    p_sku::TEXT, p_from_warehouse::TEXT, v_from_loc_name::TEXT, p_to_warehouse::TEXT, p_to_location::TEXT,
    (-p_qty)::INTEGER, v_src_prev_qty::INTEGER, v_src_new_qty::INTEGER, 'MOVE'::TEXT,
    v_src_id::BIGINT, v_from_loc_id::UUID, v_to_loc_id::UUID, p_performed_by::TEXT, p_user_id::UUID, NULL::UUID, NULL::TEXT, v_snapshot::JSONB
  );

  RETURN jsonb_build_object('success', true, 'moved_qty', p_qty, 'id', v_src_id);
END; $$;


ALTER FUNCTION "public"."move_inventory_stock"("p_sku" "text", "p_from_warehouse" "text", "p_from_location" "text", "p_to_warehouse" "text", "p_to_location" "text", "p_qty" integer, "p_performed_by" "text", "p_user_id" "uuid", "p_user_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_picking_list"("p_list_id" "uuid", "p_performed_by" "text", "p_user_id" "uuid" DEFAULT NULL::"uuid", "p_pallets_qty" integer DEFAULT NULL::integer, "p_total_units" integer DEFAULT NULL::integer, "p_user_role" "text" DEFAULT 'staff'::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_list RECORD;
  v_item JSONB;
  v_sku TEXT;
  v_warehouse TEXT;
  v_location TEXT;
  v_qty INTEGER;
  v_order_number TEXT;
  v_sku_not_found BOOLEAN;
BEGIN
  SELECT * INTO v_list FROM picking_lists WHERE id = p_list_id FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Picking list % not found', p_list_id;
  END IF;

  IF v_list.status = 'completed' THEN
    RETURN TRUE; 
  END IF;

  v_order_number := v_list.order_number;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_list.items)
  LOOP
    v_sku := v_item->>'sku';
    v_warehouse := v_item->>'warehouse';
    v_location := v_item->>'location';
    v_qty := (v_item->>'pickingQty')::integer;
    v_sku_not_found := (v_item->>'sku_not_found')::boolean;

    IF v_qty IS NULL OR v_qty <= 0 OR v_sku_not_found = true THEN 
      CONTINUE; 
    END IF;

    PERFORM public.adjust_inventory_quantity(
      v_sku, v_warehouse, v_location, -v_qty,
      p_performed_by, p_user_id, p_user_role, p_list_id, v_order_number,
      NULL -- p_merge_note
    );
  END LOOP;

  UPDATE picking_lists SET
    status = 'completed',
    pallets_qty = COALESCE(p_pallets_qty, pallets_qty),
    total_units = COALESCE(p_total_units, total_units),
    updated_at = NOW(),
    checked_by = p_user_id
  WHERE id = p_list_id;

  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."process_picking_list"("p_list_id" "uuid", "p_performed_by" "text", "p_user_id" "uuid", "p_pallets_qty" integer, "p_total_units" integer, "p_user_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_location"("p_warehouse" "text", "p_location_name" "text", "p_user_role" "text" DEFAULT 'staff'::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $_$
DECLARE
  v_location_id UUID;
  v_resolved_name TEXT;
BEGIN
  IF p_location_name IS NULL OR TRIM(p_location_name) = '' THEN RETURN NULL; END IF;

  -- UPPERCASE Normalization + TRIM
  v_resolved_name := UPPER(TRIM(p_location_name));

  -- Backward compatibility/Consistency with "Row X" logic if needed, 
  -- but user specifically asked for UPPERCASE.
  -- If it's just a number, we still prefix with ROW for legacy reasons?
  -- Let's keep the legacy ROW prefix logic but UPPERCASE it.
  IF v_resolved_name ~ '^[0-9]+$' THEN
    v_resolved_name := 'ROW ' || v_resolved_name;
  END IF;

  SELECT id INTO v_location_id FROM locations
  WHERE warehouse = p_warehouse AND UPPER(location) = v_resolved_name;

  IF v_location_id IS NOT NULL THEN RETURN v_location_id; END IF;

  -- Create on the fly (UPPERCASE)
  INSERT INTO locations (warehouse, location, zone, is_active)
  VALUES (p_warehouse, v_resolved_name, 'UNASSIGNED', true)
  RETURNING id INTO v_location_id;

  RETURN v_location_id;
END;
$_$;


ALTER FUNCTION "public"."resolve_location"("p_warehouse" "text", "p_location_name" "text", "p_user_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_inventory_location_name"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- If location name changed
    IF OLD.location <> NEW.location THEN
        UPDATE inventory
        SET location = NEW.location
        WHERE location_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_inventory_location_name"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_inventory_seq_on_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Si el INSERT trae un ID explícito, ajustamos la secuencia para que el próximo sea ID+1
    IF NEW.id IS NOT NULL THEN
        -- Safely get last_value, handling case where it might not be initialized
        PERFORM setval('public.inventory_id_seq', GREATEST(NEW.id, COALESCE((SELECT last_value FROM public.inventory_id_seq), 1)));
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_inventory_seq_on_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."undo_inventory_action"("target_log_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_log inventory_logs%ROWTYPE;
  v_item_id BIGINT;
  v_move_qty INT;
BEGIN
  SELECT * INTO v_log FROM inventory_logs WHERE id = target_log_id FOR UPDATE;

  IF v_log IS NULL THEN RETURN jsonb_build_object('success', false, 'message', 'Log not found'); END IF;
  IF v_log.is_reversed THEN RETURN jsonb_build_object('success', false, 'message', 'Action already reversed'); END IF;

  v_item_id := COALESCE(
      v_log.item_id, 
      (v_log.snapshot_before->>'id')::bigint,
      (v_log.snapshot_before->>'ID')::bigint
  );

  IF v_item_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Could not identify ID to reverse');
  END IF;

  -- SHARED RESTORE LOGIC (Using snapshot if available)
  IF v_log.snapshot_before IS NOT NULL THEN
      UPDATE inventory SET 
          sku = COALESCE(v_log.snapshot_before->>'sku', v_log.sku),
          quantity = (v_log.snapshot_before->>'quantity')::int,
          location = (v_log.snapshot_before->>'location'),
          location_id = NULLIF(v_log.snapshot_before->>'location_id', '')::uuid,
          warehouse = (v_log.snapshot_before->>'warehouse'),
          item_name = (v_log.snapshot_before->>'item_name'),
          is_active = (v_log.snapshot_before->>'is_active')::boolean -- Restore exact active state
      WHERE id = v_item_id;

      IF NOT FOUND THEN
          INSERT INTO inventory (id, sku, quantity, location, location_id, warehouse, is_active, item_name)
          VALUES (
              v_item_id,
              COALESCE(v_log.snapshot_before->>'sku', v_log.sku),
              (v_log.snapshot_before->>'quantity')::int,
              v_log.snapshot_before->>'location',
              NULLIF(v_log.snapshot_before->>'location_id', '')::uuid,
              v_log.snapshot_before->>'warehouse',
              (v_log.snapshot_before->>'is_active')::boolean,
              (v_log.snapshot_before->>'item_name')
          );
      END IF;
      
      -- If it was a MOVE, we also need to deduct from the target
      IF v_log.action_type = 'MOVE' THEN
          v_move_qty := ABS(v_log.quantity_change);
          UPDATE inventory 
          SET quantity = GREATEST(0, quantity - v_move_qty)
          WHERE sku = v_log.sku 
            AND warehouse = v_log.to_warehouse 
            AND UPPER(location) = UPPER(v_log.to_location);
      END IF;

  ELSE
      -- Fallback logic for logs without snapshots
      IF v_log.action_type = 'MOVE' THEN
          v_move_qty := ABS(v_log.quantity_change);
          
          -- Restore source
          UPDATE inventory 
          SET quantity = quantity + v_move_qty,
              is_active = true
          WHERE id = v_item_id;

          -- Deduct target
          UPDATE inventory 
          SET quantity = GREATEST(0, quantity - v_move_qty)
          WHERE sku = v_log.sku 
            AND warehouse = v_log.to_warehouse 
            AND UPPER(location) = UPPER(v_log.to_location);
            
      ELSE
          UPDATE inventory 
          SET quantity = quantity - v_log.quantity_change,
              is_active = CASE WHEN (quantity - v_log.quantity_change) > 0 THEN true ELSE is_active END
          WHERE id = v_item_id;
      END IF;
  END IF;

  UPDATE inventory_logs SET is_reversed = TRUE WHERE id = target_log_id;
  RETURN jsonb_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$;


ALTER FUNCTION "public"."undo_inventory_action"("target_log_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_picking_list_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.last_activity_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_picking_list_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_user_presence"("p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO user_presence (user_id, last_seen_at)
  VALUES (p_user_id, NOW())
  ON CONFLICT (user_id)
  DO UPDATE SET last_seen_at = NOW();
END;
$$;


ALTER FUNCTION "public"."update_user_presence"("p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_user_presence"("p_user_id" "uuid") IS 'Called by client every 30 seconds to update presence. SECURITY DEFINER allows authenticated users to update their own presence.';



CREATE OR REPLACE FUNCTION "public"."update_warehouse_zones_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_warehouse_zones_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_inventory_log"("p_sku" "text", "p_from_warehouse" "text", "p_from_location" "text", "p_to_warehouse" "text", "p_to_location" "text", "p_quantity_change" integer, "p_prev_quantity" integer, "p_new_quantity" integer, "p_action_type" "text", "p_item_id" bigint, "p_location_id" "uuid", "p_to_location_id" "uuid", "p_performed_by" "text", "p_user_id" "uuid", "p_list_id" "uuid" DEFAULT NULL::"uuid", "p_order_number" "text" DEFAULT NULL::"text", "p_snapshot_before" "jsonb" DEFAULT NULL::"jsonb", "p_is_reversed" boolean DEFAULT false) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_log_id UUID;
BEGIN
  INSERT INTO public.inventory_logs (
    sku, from_warehouse, from_location, to_warehouse, to_location,
    quantity_change, prev_quantity, new_quantity, action_type,
    item_id, location_id, to_location_id, snapshot_before,
    performed_by, user_id, list_id, order_number, is_reversed
  ) VALUES (
    p_sku, p_from_warehouse, p_from_location, p_to_warehouse, p_to_location,
    p_quantity_change, p_prev_quantity, p_new_quantity, p_action_type,
    p_item_id, p_location_id, p_to_location_id, p_snapshot_before,
    p_performed_by, p_user_id, p_list_id, p_order_number, p_is_reversed
  ) RETURNING id INTO v_log_id;
  RETURN v_log_id;
END; $$;


ALTER FUNCTION "public"."upsert_inventory_log"("p_sku" "text", "p_from_warehouse" "text", "p_from_location" "text", "p_to_warehouse" "text", "p_to_location" "text", "p_quantity_change" integer, "p_prev_quantity" integer, "p_new_quantity" integer, "p_action_type" "text", "p_item_id" bigint, "p_location_id" "uuid", "p_to_location_id" "uuid", "p_performed_by" "text", "p_user_id" "uuid", "p_list_id" "uuid", "p_order_number" "text", "p_snapshot_before" "jsonb", "p_is_reversed" boolean) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."app_users" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "full_name" "text" NOT NULL,
    "age" integer,
    "email" "text" NOT NULL,
    "role" "text" DEFAULT 'staff'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."app_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "street" "text",
    "city" "text",
    "state" "text",
    "zip_code" "text",
    "email" "text",
    "phone" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_inventory_snapshots" (
    "id" bigint NOT NULL,
    "snapshot_date" "date" NOT NULL,
    "warehouse" "text" NOT NULL,
    "location" "text" NOT NULL,
    "sku" "text" NOT NULL,
    "quantity" integer NOT NULL,
    "location_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "item_name" "text",
    CONSTRAINT "snapshot_quantity_check" CHECK (("quantity" >= 0))
);


ALTER TABLE "public"."daily_inventory_snapshots" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."daily_inventory_snapshots_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."daily_inventory_snapshots_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."daily_inventory_snapshots_id_seq" OWNED BY "public"."daily_inventory_snapshots"."id";



CREATE TABLE IF NOT EXISTS "public"."inventory" (
    "id" bigint NOT NULL,
    "sku" "text" NOT NULL,
    "location" "text",
    "quantity" integer DEFAULT 0,
    "item_name" "text",
    "warehouse" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "capacity" integer DEFAULT 550,
    "location_id" "uuid",
    "is_active" boolean DEFAULT true,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "internal_note" "text",
    "distribution" "jsonb" DEFAULT '[]'::"jsonb",
    CONSTRAINT "distribution_is_array" CHECK (("jsonb_typeof"("distribution") = 'array'::"text")),
    CONSTRAINT "inventory_quantity_check" CHECK (("quantity" >= 0))
);

ALTER TABLE ONLY "public"."inventory" REPLICA IDENTITY FULL;


ALTER TABLE "public"."inventory" OWNER TO "postgres";


COMMENT ON COLUMN "public"."inventory"."internal_note" IS 'Free-text hint for locating items within a location (e.g., "Behind the pole", "Bottom shelf")';



COMMENT ON COLUMN "public"."inventory"."distribution" IS 'Physical grouping breakdown: [{type, count, units_each, label?}]. Sum of (count * units_each) should not exceed quantity.';



ALTER TABLE "public"."inventory" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."inventory_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."inventory_logs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "sku" "text" NOT NULL,
    "from_warehouse" "text",
    "from_location" "text",
    "to_warehouse" "text",
    "to_location" "text",
    "quantity_change" integer NOT NULL,
    "action_type" "text" NOT NULL,
    "performed_by" "text" DEFAULT 'Warehouse Team'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "prev_quantity" integer,
    "new_quantity" integer,
    "is_reversed" boolean DEFAULT false,
    "item_id" bigint,
    "previous_sku" "text",
    "list_id" "uuid",
    "order_number" "text",
    "location_id" "uuid",
    "previous_quantity" integer,
    "snapshot_before" "jsonb",
    "to_location_id" "uuid",
    "user_id" "uuid"
);


ALTER TABLE "public"."inventory_logs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."inventory_logs"."quantity_change" IS 'La cantidad exacta que se sumó o restó';



CREATE TABLE IF NOT EXISTS "public"."locations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "warehouse" character varying(50) NOT NULL,
    "location" character varying(100) NOT NULL,
    "max_capacity" integer DEFAULT 550,
    "picking_order" integer,
    "zone" character varying(20),
    "is_shipping_area" boolean DEFAULT false,
    "notes" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "length_ft" numeric(10,2),
    "bike_line" integer,
    "total_bikes" integer,
    CONSTRAINT "locations_zone_check" CHECK ((("zone")::"text" = ANY (ARRAY[('HOT'::character varying)::"text", ('WARM'::character varying)::"text", ('COLD'::character varying)::"text", ('UNASSIGNED'::character varying)::"text"])))
);


ALTER TABLE "public"."locations" OWNER TO "postgres";


COMMENT ON TABLE "public"."locations" IS 'Configuración detallada de cada ubicación en los almacenes';



COMMENT ON COLUMN "public"."locations"."warehouse" IS 'Nombre del almacén (LUDLOW, ATS, etc.)';



COMMENT ON COLUMN "public"."locations"."location" IS 'Código de ubicación (Row 1, A6, etc.)';



COMMENT ON COLUMN "public"."locations"."max_capacity" IS 'Capacidad máxima en unidades (default: 550)';



COMMENT ON COLUMN "public"."locations"."picking_order" IS 'Orden de picking sugerido (menor = primero)';



COMMENT ON COLUMN "public"."locations"."zone" IS 'Zona de temperatura/velocidad (HOT/WARM/COLD)';



COMMENT ON COLUMN "public"."locations"."is_shipping_area" IS 'Indica si es área de envío/staging';



COMMENT ON COLUMN "public"."locations"."notes" IS 'Notas adicionales sobre la ubicación';



COMMENT ON COLUMN "public"."locations"."is_active" IS 'Indica si la ubicación está activa';



COMMENT ON COLUMN "public"."locations"."length_ft" IS 'Length of the row in feet.';



COMMENT ON COLUMN "public"."locations"."bike_line" IS 'Number of bikes in the line.';



COMMENT ON COLUMN "public"."locations"."total_bikes" IS 'Total bike capacity for the location.';



CREATE TABLE IF NOT EXISTS "public"."optimization_reports" (
    "id" integer NOT NULL,
    "report_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "report_type" character varying(50) DEFAULT 'weekly_rebalance'::character varying,
    "suggestions" "jsonb" NOT NULL,
    "applied_count" integer DEFAULT 0,
    "total_suggestions" integer NOT NULL,
    "generated_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."optimization_reports" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."optimization_reports_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."optimization_reports_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."optimization_reports_id_seq" OWNED BY "public"."optimization_reports"."id";



CREATE TABLE IF NOT EXISTS "public"."pdf_import_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pdf_hash" "text" NOT NULL,
    "order_number" "text",
    "file_name" "text" NOT NULL,
    "items_count" integer DEFAULT 0,
    "picking_list_id" "uuid",
    "status" "text" DEFAULT 'processed'::"text",
    "error_message" "text",
    "processed_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pdf_import_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."picking_list_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "list_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "message" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."picking_list_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."picking_lists" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "items" "jsonb" DEFAULT '[]'::"jsonb",
    "status" "text" DEFAULT 'active'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "order_number" "text",
    "checked_by" "uuid",
    "correction_notes" "text",
    "pallets_qty" integer DEFAULT 0,
    "priority" "text" DEFAULT 'normal'::"text",
    "notes" "text",
    "load_number" "text",
    "total_units" integer DEFAULT 0,
    "customer_id" "uuid",
    "last_activity_at" timestamp with time zone DEFAULT "now"(),
    "source" "text" DEFAULT 'manual'::"text",
    "is_addon" boolean DEFAULT false,
    CONSTRAINT "picking_lists_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'ready_to_double_check'::"text", 'double_checking'::"text", 'needs_correction'::"text", 'completed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."picking_lists" OWNER TO "postgres";


COMMENT ON COLUMN "public"."picking_lists"."last_activity_at" IS 'Automatically updated timestamp tracking the last activity on this picking list. Used for detecting stale/abandoned orders.';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "role" "text" DEFAULT 'staff'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_active" boolean DEFAULT true,
    "email" "text",
    "last_seen_at" timestamp with time zone,
    "created_by" "uuid",
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'staff'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sku_metadata" (
    "sku" "text" NOT NULL,
    "length_in" numeric DEFAULT 5,
    "width_in" numeric DEFAULT 6,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "height_in" numeric
);


ALTER TABLE "public"."sku_metadata" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_presence" (
    "user_id" "uuid" NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_presence" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_presence" IS 'Tracks user online/offline status via heartbeat mechanism. Used to determine if stale orders should be auto-cancelled.';



ALTER TABLE ONLY "public"."daily_inventory_snapshots" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."daily_inventory_snapshots_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."optimization_reports" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."optimization_reports_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."app_users"
    ADD CONSTRAINT "app_users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."app_users"
    ADD CONSTRAINT "app_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_inventory_snapshots"
    ADD CONSTRAINT "daily_inventory_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_inventory_snapshots"
    ADD CONSTRAINT "daily_inventory_snapshots_snapshot_date_warehouse_location__key" UNIQUE ("snapshot_date", "warehouse", "location", "sku");



ALTER TABLE ONLY "public"."inventory_logs"
    ADD CONSTRAINT "inventory_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory"
    ADD CONSTRAINT "inventory_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_warehouse_location_key" UNIQUE ("warehouse", "location");



ALTER TABLE ONLY "public"."optimization_reports"
    ADD CONSTRAINT "optimization_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."optimization_reports"
    ADD CONSTRAINT "optimization_reports_report_date_report_type_key" UNIQUE ("report_date", "report_type");



ALTER TABLE ONLY "public"."pdf_import_log"
    ADD CONSTRAINT "pdf_import_log_pdf_hash_key" UNIQUE ("pdf_hash");



ALTER TABLE ONLY "public"."pdf_import_log"
    ADD CONSTRAINT "pdf_import_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."picking_list_notes"
    ADD CONSTRAINT "picking_list_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."picking_lists"
    ADD CONSTRAINT "picking_lists_load_number_key" UNIQUE ("load_number");



ALTER TABLE ONLY "public"."picking_lists"
    ADD CONSTRAINT "picking_lists_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sku_metadata"
    ADD CONSTRAINT "sku_metadata_pkey" PRIMARY KEY ("sku");



ALTER TABLE ONLY "public"."inventory"
    ADD CONSTRAINT "unique_warehouse_sku_location" UNIQUE ("warehouse", "sku", "location");



ALTER TABLE ONLY "public"."user_presence"
    ADD CONSTRAINT "user_presence_pkey" PRIMARY KEY ("user_id");



CREATE INDEX "idx_inventory_distribution" ON "public"."inventory" USING "gin" ("distribution") WHERE ("distribution" <> '[]'::"jsonb");



CREATE INDEX "idx_inventory_location_id" ON "public"."inventory" USING "btree" ("location_id");



CREATE INDEX "idx_inventory_logs_action_created" ON "public"."inventory_logs" USING "btree" ("action_type", "created_at" DESC) WHERE ("action_type" IS NOT NULL);



COMMENT ON INDEX "public"."idx_inventory_logs_action_created" IS 'Speeds up history filtering by action type';



CREATE INDEX "idx_inventory_logs_date_only" ON "public"."inventory_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_inventory_logs_item_id" ON "public"."inventory_logs" USING "btree" ("item_id");



CREATE INDEX "idx_inventory_logs_list_id" ON "public"."inventory_logs" USING "btree" ("list_id") WHERE ("list_id" IS NOT NULL);



COMMENT ON INDEX "public"."idx_inventory_logs_list_id" IS 'Fixes unindexed FK - prevents full table scan on picking_lists joins';



CREATE INDEX "idx_inventory_logs_order_number" ON "public"."inventory_logs" USING "btree" ("order_number");



CREATE INDEX "idx_inventory_logs_sku" ON "public"."inventory_logs" USING "btree" ("sku");



CREATE INDEX "idx_inventory_logs_user_id" ON "public"."inventory_logs" USING "btree" ("user_id");



CREATE INDEX "idx_inventory_sku_only" ON "public"."inventory" USING "btree" ("sku");



CREATE INDEX "idx_locations_active" ON "public"."locations" USING "btree" ("is_active");



CREATE INDEX "idx_locations_warehouse" ON "public"."locations" USING "btree" ("warehouse");



CREATE INDEX "idx_locations_warehouse_location" ON "public"."locations" USING "btree" ("warehouse", "location");



CREATE INDEX "idx_locations_zone" ON "public"."locations" USING "btree" ("zone");



CREATE INDEX "idx_pdf_import_log_hash" ON "public"."pdf_import_log" USING "btree" ("pdf_hash");



CREATE INDEX "idx_pdf_import_log_order" ON "public"."pdf_import_log" USING "btree" ("order_number");



CREATE INDEX "idx_picking_list_notes_list_id" ON "public"."picking_list_notes" USING "btree" ("list_id");



CREATE INDEX "idx_picking_list_notes_user_id" ON "public"."picking_list_notes" USING "btree" ("user_id");



CREATE INDEX "idx_picking_lists_checked_by" ON "public"."picking_lists" USING "btree" ("checked_by");



CREATE INDEX "idx_picking_lists_last_activity" ON "public"."picking_lists" USING "btree" ("last_activity_at") WHERE ("status" = ANY (ARRAY['building'::"text", 'active'::"text", 'needs_correction'::"text", 'ready_to_double_check'::"text", 'double_checking'::"text"]));



CREATE INDEX "idx_picking_lists_status" ON "public"."picking_lists" USING "btree" ("status");



COMMENT ON INDEX "public"."idx_picking_lists_status" IS 'Optimizes active picking list queries';



CREATE INDEX "idx_picking_lists_user_id" ON "public"."picking_lists" USING "btree" ("user_id");



CREATE INDEX "idx_profiles_created_by" ON "public"."profiles" USING "btree" ("created_by") WHERE ("created_by" IS NOT NULL);



COMMENT ON INDEX "public"."idx_profiles_created_by" IS 'Fixes unindexed FK - improves profile hierarchy queries';



CREATE INDEX "idx_report_date" ON "public"."optimization_reports" USING "btree" ("report_date" DESC);



CREATE INDEX "idx_snapshots_date" ON "public"."daily_inventory_snapshots" USING "btree" ("snapshot_date");



CREATE INDEX "idx_snapshots_sku" ON "public"."daily_inventory_snapshots" USING "btree" ("sku");



CREATE INDEX "idx_snapshots_warehouse_location" ON "public"."daily_inventory_snapshots" USING "btree" ("warehouse", "location");



CREATE INDEX "idx_user_presence_last_seen" ON "public"."user_presence" USING "btree" ("last_seen_at");



CREATE OR REPLACE TRIGGER "tr_inventory_updated_at" BEFORE UPDATE ON "public"."inventory" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "tr_sync_inventory_sequence" AFTER INSERT ON "public"."inventory" FOR EACH ROW EXECUTE FUNCTION "public"."sync_inventory_seq_on_insert"();



CREATE OR REPLACE TRIGGER "trg_inventory_logs_uppercase" BEFORE INSERT OR UPDATE ON "public"."inventory_logs" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_uppercase_log_locations"();



CREATE OR REPLACE TRIGGER "trg_inventory_uppercase" BEFORE INSERT OR UPDATE ON "public"."inventory" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_uppercase_location"();



CREATE OR REPLACE TRIGGER "trg_locations_uppercase" BEFORE INSERT OR UPDATE ON "public"."locations" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_uppercase_location"();



CREATE OR REPLACE TRIGGER "trigger_sync_inventory_location_name" AFTER UPDATE OF "location" ON "public"."locations" FOR EACH ROW EXECUTE FUNCTION "public"."sync_inventory_location_name"();



CREATE OR REPLACE TRIGGER "update_activity_timestamp" BEFORE UPDATE ON "public"."picking_lists" FOR EACH ROW EXECUTE FUNCTION "public"."update_picking_list_activity"();



CREATE OR REPLACE TRIGGER "update_locations_updated_at" BEFORE UPDATE ON "public"."locations" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."daily_inventory_snapshots"
    ADD CONSTRAINT "daily_inventory_snapshots_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."inventory"
    ADD CONSTRAINT "inventory_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."inventory_logs"
    ADD CONSTRAINT "inventory_logs_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "public"."picking_lists"("id");



ALTER TABLE ONLY "public"."inventory_logs"
    ADD CONSTRAINT "inventory_logs_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."inventory_logs"
    ADD CONSTRAINT "inventory_logs_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id");



-- ALTER TABLE ONLY "public"."inventory_logs"
--     ADD CONSTRAINT "inventory_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."inventory"
    ADD CONSTRAINT "inventory_sku_fkey" FOREIGN KEY ("sku") REFERENCES "public"."sku_metadata"("sku");



ALTER TABLE ONLY "public"."pdf_import_log"
    ADD CONSTRAINT "pdf_import_log_picking_list_id_fkey" FOREIGN KEY ("picking_list_id") REFERENCES "public"."picking_lists"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."picking_list_notes"
    ADD CONSTRAINT "picking_list_notes_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "public"."picking_lists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."picking_list_notes"
    ADD CONSTRAINT "picking_list_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."picking_lists"
    ADD CONSTRAINT "picking_lists_checked_by_fkey" FOREIGN KEY ("checked_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."picking_lists"
    ADD CONSTRAINT "picking_lists_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."picking_lists"
    ADD CONSTRAINT "picking_lists_presence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_presence"("user_id");



COMMENT ON CONSTRAINT "picking_lists_presence_user_id_fkey" ON "public"."picking_lists" IS 'Enables PostgREST to discover the relationship for real-time order presence tracking.';



ALTER TABLE ONLY "public"."picking_lists"
    ADD CONSTRAINT "picking_lists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



-- ALTER TABLE ONLY "public"."profiles"
--     ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_presence"
    ADD CONSTRAINT "user_presence_profiles_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



-- ALTER TABLE ONLY "public"."user_presence"
--     ADD CONSTRAINT "user_presence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Admin manage sku_metadata" ON "public"."sku_metadata" USING ("public"."is_admin"());



CREATE POLICY "Admins only access app_users" ON "public"."app_users" USING ("public"."is_admin"());



CREATE POLICY "Collaborative Delete" ON "public"."picking_lists" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Collaborative Insert" ON "public"."picking_lists" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Collaborative Select" ON "public"."picking_lists" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Collaborative Update" ON "public"."picking_lists" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Inventory Admin Access" ON "public"."inventory" USING ("public"."is_admin"());



CREATE POLICY "Inventory Staff Delete" ON "public"."inventory" FOR DELETE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Inventory Staff Insert" ON "public"."inventory" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Inventory Staff Update" ON "public"."inventory" FOR UPDATE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Inventory viewable by authenticated users" ON "public"."inventory" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Locations Admin Access" ON "public"."locations" USING ("public"."is_admin"());



CREATE POLICY "Locations Staff Read" ON "public"."locations" FOR SELECT USING (true);



CREATE POLICY "Locations viewable by authenticated users" ON "public"."locations" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Logs are viewable by authenticated users" ON "public"."inventory_logs" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Logs can be inserted by authenticated users" ON "public"."inventory_logs" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Logs can be managed by admins" ON "public"."inventory_logs" USING ("public"."is_admin"());



CREATE POLICY "Metadata viewable by authenticated users" ON "public"."sku_metadata" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Profiles are viewable by authenticated users" ON "public"."profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Profiles viewable by authenticated users" ON "public"."profiles" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Public full access reports" ON "public"."optimization_reports" USING (true);



CREATE POLICY "Reports manageable by admins" ON "public"."optimization_reports" USING ("public"."is_admin"());



CREATE POLICY "Reports viewable by authenticated users" ON "public"."optimization_reports" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Snapshots deletable by service role" ON "public"."daily_inventory_snapshots" FOR DELETE USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Snapshots insertable by service role" ON "public"."daily_inventory_snapshots" FOR INSERT WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Snapshots viewable by authenticated users" ON "public"."daily_inventory_snapshots" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Users can add notes to relevant lists" ON "public"."picking_list_notes" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."picking_lists"
  WHERE (("picking_lists"."id" = "picking_list_notes"."list_id") AND (("picking_lists"."user_id" = "auth"."uid"()) OR ("picking_lists"."checked_by" = "auth"."uid"()))))));



CREATE POLICY "Users can update own presence" ON "public"."user_presence" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view all presence data" ON "public"."user_presence" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can view notes for accessible lists" ON "public"."picking_list_notes" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."picking_lists"
  WHERE ("picking_lists"."id" = "picking_list_notes"."list_id"))));



ALTER TABLE "public"."app_users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_inventory_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "inventory_delete_admin" ON "public"."inventory" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "inventory_insert_authenticated" ON "public"."inventory" FOR INSERT WITH CHECK (("public"."current_user_id"() IS NOT NULL));



ALTER TABLE "public"."inventory_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "inventory_logs_delete_admin" ON "public"."inventory_logs" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "inventory_logs_insert_authenticated" ON "public"."inventory_logs" FOR INSERT WITH CHECK (("public"."current_user_id"() IS NOT NULL));



CREATE POLICY "inventory_logs_select_authenticated" ON "public"."inventory_logs" FOR SELECT USING (("public"."current_user_id"() IS NOT NULL));



CREATE POLICY "inventory_select_authenticated" ON "public"."inventory" FOR SELECT USING (("public"."current_user_id"() IS NOT NULL));



CREATE POLICY "inventory_update_authenticated" ON "public"."inventory" FOR UPDATE USING (("public"."current_user_id"() IS NOT NULL)) WITH CHECK (("public"."current_user_id"() IS NOT NULL));



ALTER TABLE "public"."locations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "locations_modify_authenticated" ON "public"."locations" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "locations_select_authenticated" ON "public"."locations" FOR SELECT USING (("public"."current_user_id"() IS NOT NULL));



ALTER TABLE "public"."optimization_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."picking_list_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."picking_lists" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_admin_all" ON "public"."profiles" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "profiles_insert_own" ON "public"."profiles" FOR INSERT WITH CHECK (("id" = "public"."current_user_id"()));



CREATE POLICY "profiles_select_own" ON "public"."profiles" FOR SELECT USING (("id" = "public"."current_user_id"()));



CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE USING (("id" = "public"."current_user_id"())) WITH CHECK (("id" = "public"."current_user_id"()));



ALTER TABLE "public"."sku_metadata" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sku_metadata_select_authenticated" ON "public"."sku_metadata" FOR SELECT USING (("public"."current_user_id"() IS NOT NULL));



CREATE POLICY "sku_metadata_upsert_authenticated" ON "public"."sku_metadata" USING (("public"."current_user_id"() IS NOT NULL)) WITH CHECK (("public"."current_user_id"() IS NOT NULL));



ALTER TABLE "public"."user_presence" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."inventory";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."inventory_logs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."picking_lists";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

















































































































































































GRANT ALL ON FUNCTION "public"."adjust_inventory_quantity"("p_sku" "text", "p_warehouse" "text", "p_location" "text", "p_delta" integer, "p_performed_by" "text", "p_user_id" "uuid", "p_user_role" "text", "p_list_id" "uuid", "p_order_number" "text", "p_merge_note" "text", "p_skip_log" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."adjust_inventory_quantity"("p_sku" "text", "p_warehouse" "text", "p_location" "text", "p_delta" integer, "p_performed_by" "text", "p_user_id" "uuid", "p_user_role" "text", "p_list_id" "uuid", "p_order_number" "text", "p_merge_note" "text", "p_skip_log" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."adjust_inventory_quantity"("p_sku" "text", "p_warehouse" "text", "p_location" "text", "p_delta" integer, "p_performed_by" "text", "p_user_id" "uuid", "p_user_role" "text", "p_list_id" "uuid", "p_order_number" "text", "p_merge_note" "text", "p_skip_log" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_cancel_stale_orders"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_cancel_stale_orders"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_cancel_stale_orders"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_daily_snapshot"("p_snapshot_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."create_daily_snapshot"("p_snapshot_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_daily_snapshot"("p_snapshot_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."current_user_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_inventory_item"("p_item_id" integer, "p_performed_by" "text", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_inventory_item"("p_item_id" integer, "p_performed_by" "text", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_inventory_item"("p_item_id" integer, "p_performed_by" "text", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_uppercase_location"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_uppercase_location"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_uppercase_location"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_uppercase_log_locations"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_uppercase_log_locations"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_uppercase_log_locations"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_snapshot"("p_target_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."get_snapshot"("p_target_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_snapshot"("p_target_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_snapshot_summary"("p_target_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."get_snapshot_summary"("p_target_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_snapshot_summary"("p_target_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_stock_at_timestamp"("target_timestamp" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_stock_at_timestamp"("target_timestamp" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_stock_at_timestamp"("target_timestamp" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_manager"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_manager"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_manager"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_user_online"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_user_online"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_user_online"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."move_inventory_stock"("p_sku" "text", "p_from_warehouse" "text", "p_from_location" "text", "p_to_warehouse" "text", "p_to_location" "text", "p_qty" integer, "p_performed_by" "text", "p_user_id" "uuid", "p_user_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."move_inventory_stock"("p_sku" "text", "p_from_warehouse" "text", "p_from_location" "text", "p_to_warehouse" "text", "p_to_location" "text", "p_qty" integer, "p_performed_by" "text", "p_user_id" "uuid", "p_user_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."move_inventory_stock"("p_sku" "text", "p_from_warehouse" "text", "p_from_location" "text", "p_to_warehouse" "text", "p_to_location" "text", "p_qty" integer, "p_performed_by" "text", "p_user_id" "uuid", "p_user_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."process_picking_list"("p_list_id" "uuid", "p_performed_by" "text", "p_user_id" "uuid", "p_pallets_qty" integer, "p_total_units" integer, "p_user_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."process_picking_list"("p_list_id" "uuid", "p_performed_by" "text", "p_user_id" "uuid", "p_pallets_qty" integer, "p_total_units" integer, "p_user_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_picking_list"("p_list_id" "uuid", "p_performed_by" "text", "p_user_id" "uuid", "p_pallets_qty" integer, "p_total_units" integer, "p_user_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."resolve_location"("p_warehouse" "text", "p_location_name" "text", "p_user_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_location"("p_warehouse" "text", "p_location_name" "text", "p_user_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_location"("p_warehouse" "text", "p_location_name" "text", "p_user_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_inventory_location_name"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_inventory_location_name"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_inventory_location_name"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_inventory_seq_on_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_inventory_seq_on_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_inventory_seq_on_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."undo_inventory_action"("target_log_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."undo_inventory_action"("target_log_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."undo_inventory_action"("target_log_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_picking_list_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_picking_list_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_picking_list_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_user_presence"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."update_user_presence"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_user_presence"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_warehouse_zones_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_warehouse_zones_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_warehouse_zones_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_inventory_log"("p_sku" "text", "p_from_warehouse" "text", "p_from_location" "text", "p_to_warehouse" "text", "p_to_location" "text", "p_quantity_change" integer, "p_prev_quantity" integer, "p_new_quantity" integer, "p_action_type" "text", "p_item_id" bigint, "p_location_id" "uuid", "p_to_location_id" "uuid", "p_performed_by" "text", "p_user_id" "uuid", "p_list_id" "uuid", "p_order_number" "text", "p_snapshot_before" "jsonb", "p_is_reversed" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_inventory_log"("p_sku" "text", "p_from_warehouse" "text", "p_from_location" "text", "p_to_warehouse" "text", "p_to_location" "text", "p_quantity_change" integer, "p_prev_quantity" integer, "p_new_quantity" integer, "p_action_type" "text", "p_item_id" bigint, "p_location_id" "uuid", "p_to_location_id" "uuid", "p_performed_by" "text", "p_user_id" "uuid", "p_list_id" "uuid", "p_order_number" "text", "p_snapshot_before" "jsonb", "p_is_reversed" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_inventory_log"("p_sku" "text", "p_from_warehouse" "text", "p_from_location" "text", "p_to_warehouse" "text", "p_to_location" "text", "p_quantity_change" integer, "p_prev_quantity" integer, "p_new_quantity" integer, "p_action_type" "text", "p_item_id" bigint, "p_location_id" "uuid", "p_to_location_id" "uuid", "p_performed_by" "text", "p_user_id" "uuid", "p_list_id" "uuid", "p_order_number" "text", "p_snapshot_before" "jsonb", "p_is_reversed" boolean) TO "service_role";
























GRANT ALL ON TABLE "public"."app_users" TO "anon";
GRANT ALL ON TABLE "public"."app_users" TO "authenticated";
GRANT ALL ON TABLE "public"."app_users" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



GRANT ALL ON TABLE "public"."daily_inventory_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."daily_inventory_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_inventory_snapshots" TO "service_role";



GRANT ALL ON SEQUENCE "public"."daily_inventory_snapshots_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."daily_inventory_snapshots_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."daily_inventory_snapshots_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."inventory" TO "anon";
GRANT ALL ON TABLE "public"."inventory" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory" TO "service_role";



GRANT ALL ON SEQUENCE "public"."inventory_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."inventory_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."inventory_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."inventory_logs" TO "anon";
GRANT ALL ON TABLE "public"."inventory_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_logs" TO "service_role";



GRANT ALL ON TABLE "public"."locations" TO "anon";
GRANT ALL ON TABLE "public"."locations" TO "authenticated";
GRANT ALL ON TABLE "public"."locations" TO "service_role";



GRANT ALL ON TABLE "public"."optimization_reports" TO "anon";
GRANT ALL ON TABLE "public"."optimization_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."optimization_reports" TO "service_role";



GRANT ALL ON SEQUENCE "public"."optimization_reports_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."optimization_reports_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."optimization_reports_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."pdf_import_log" TO "anon";
GRANT ALL ON TABLE "public"."pdf_import_log" TO "authenticated";
GRANT ALL ON TABLE "public"."pdf_import_log" TO "service_role";



GRANT ALL ON TABLE "public"."picking_list_notes" TO "anon";
GRANT ALL ON TABLE "public"."picking_list_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."picking_list_notes" TO "service_role";



GRANT ALL ON TABLE "public"."picking_lists" TO "anon";
GRANT ALL ON TABLE "public"."picking_lists" TO "authenticated";
GRANT ALL ON TABLE "public"."picking_lists" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."sku_metadata" TO "anon";
GRANT ALL ON TABLE "public"."sku_metadata" TO "authenticated";
GRANT ALL ON TABLE "public"."sku_metadata" TO "service_role";



GRANT ALL ON TABLE "public"."user_presence" TO "anon";
GRANT ALL ON TABLE "public"."user_presence" TO "authenticated";
GRANT ALL ON TABLE "public"."user_presence" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

create extension if not exists "pg_net" with schema "public";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


