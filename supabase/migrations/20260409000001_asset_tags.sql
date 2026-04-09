-- Asset Tags: physical unit tracking with QR codes for bikes
-- 1 row = 1 physical unit. Short codes are server-generated (sequence + base36).

-- Sequence for unique, ordered short_codes
CREATE SEQUENCE IF NOT EXISTS asset_tag_seq START 1;

-- Generate short_code: PK- + base36(sequence), padded to 6 chars
CREATE OR REPLACE FUNCTION generate_short_code()
RETURNS text AS $$
DECLARE
  v_num bigint := nextval('asset_tag_seq');
  v_code text := '';
  v_chars text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
BEGIN
  WHILE v_num > 0 OR length(v_code) < 6 LOOP
    v_code := substr(v_chars, (v_num % 36)::int + 1, 1) || v_code;
    v_num := v_num / 36;
  END LOOP;
  RETURN 'PK-' || v_code;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS asset_tags (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  short_code  text NOT NULL UNIQUE DEFAULT generate_short_code(),
  sku         text NOT NULL,
  warehouse   text NOT NULL DEFAULT 'LUDLOW',
  location    text,
  status      text NOT NULL DEFAULT 'printed',
  order_id    uuid,
  printed_at  timestamptz,
  created_by  uuid REFERENCES profiles(id),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),

  CONSTRAINT asset_tags_valid_status CHECK (
    status IN ('printed', 'in_stock', 'allocated', 'picked', 'shipped', 'lost')
  )
);

CREATE INDEX IF NOT EXISTS idx_asset_tags_sku_status ON asset_tags (sku, status);
CREATE INDEX IF NOT EXISTS idx_asset_tags_short_code ON asset_tags (short_code);

-- Reuse existing set_updated_at() trigger function (from cycle_count_tables migration)
CREATE TRIGGER trg_asset_tags_updated_at
BEFORE UPDATE ON asset_tags
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE asset_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage asset_tags"
  ON asset_tags FOR ALL TO authenticated USING (true) WITH CHECK (true);
