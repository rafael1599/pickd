-- Cycle Count tables — persistent sessions with audit trail
-- Replaces localStorage-based counting in StockCountScreen

-- ── Sessions ────────────────────────────────────────────────────────

CREATE TABLE cycle_count_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Who and when
  created_by uuid NOT NULL REFERENCES profiles(id),
  assigned_to uuid REFERENCES profiles(id),

  -- Scope
  warehouse text NOT NULL DEFAULT 'LUDLOW'
    CHECK (warehouse IN ('LUDLOW', 'ATS')),
  source text,       -- 'manual', 'jamis_sheet', 'scheduled', 'spot_check'
  label text,        -- "DIVIDE Jan-26", "ROW 12-15 Weekly"

  -- Status workflow
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_progress', 'pending_review', 'completed', 'cancelled')),

  -- Timestamps
  started_at timestamptz,
  completed_at timestamptz,
  reviewed_by uuid REFERENCES profiles(id),
  reviewed_at timestamptz,

  -- Summary (denormalized, maintained by trigger)
  total_skus integer DEFAULT 0,
  total_counted integer DEFAULT 0,
  total_discrepancies integer DEFAULT 0,

  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- Integrity constraints
  CHECK ((status != 'in_progress') OR started_at IS NOT NULL),
  CHECK ((status != 'completed') OR completed_at IS NOT NULL),
  CHECK (
    (reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

-- ── Items ───────────────────────────────────────────────────────────

CREATE TABLE cycle_count_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES cycle_count_sessions(id) ON DELETE CASCADE,

  -- What to count
  sku text NOT NULL,
  location text,
  warehouse text NOT NULL DEFAULT 'LUDLOW',

  -- System snapshot at count start
  expected_qty integer,

  -- Floor count
  counted_qty integer,
  counted_by uuid REFERENCES profiles(id),
  counted_at timestamptz,

  -- Discrepancy (auto-computed)
  variance integer GENERATED ALWAYS AS (
    CASE WHEN counted_qty IS NOT NULL
      THEN counted_qty - coalesce(expected_qty, 0)
      ELSE NULL
    END
  ) STORED,

  -- Status
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'counted', 'verified', 'adjusted', 'skipped')),

  -- Link to inventory_logs if adjustment was made
  adjustment_log_id uuid,

  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Unique: one entry per SKU+location per session (NULL-safe)
CREATE UNIQUE INDEX uniq_cc_items_session_sku_location
ON cycle_count_items (
  session_id,
  sku,
  coalesce(location, '__NO_LOCATION__')
);

-- ── Indexes ─────────────────────────────────────────────────────────

CREATE INDEX idx_cc_sessions_status ON cycle_count_sessions(status);
CREATE INDEX idx_cc_sessions_created_by ON cycle_count_sessions(created_by);
CREATE INDEX idx_cc_items_session ON cycle_count_items(session_id);
CREATE INDEX idx_cc_items_session_sku ON cycle_count_items(session_id, sku);
CREATE INDEX idx_cc_items_session_status ON cycle_count_items(session_id, status, created_at);

-- ── Triggers ────────────────────────────────────────────────────────

-- Auto-update updated_at on any row change
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cc_sessions_updated_at
BEFORE UPDATE ON cycle_count_sessions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_cc_items_updated_at
BEFORE UPDATE ON cycle_count_items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Auto-maintain denormalized summary on session
CREATE OR REPLACE FUNCTION update_cycle_count_summary()
RETURNS trigger AS $$
DECLARE
  target_session uuid;
BEGIN
  target_session := coalesce(NEW.session_id, OLD.session_id);

  UPDATE cycle_count_sessions
  SET
    total_skus = (
      SELECT count(*) FROM cycle_count_items WHERE session_id = target_session
    ),
    total_counted = (
      SELECT count(*) FROM cycle_count_items
      WHERE session_id = target_session AND counted_qty IS NOT NULL
    ),
    total_discrepancies = (
      SELECT count(*) FROM cycle_count_items
      WHERE session_id = target_session AND variance IS NOT NULL AND variance != 0
    ),
    updated_at = now()
  WHERE id = target_session;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_cc_summary
AFTER INSERT OR UPDATE OR DELETE ON cycle_count_items
FOR EACH ROW EXECUTE FUNCTION update_cycle_count_summary();

-- ── RLS ─────────────────────────────────────────────────────────────

ALTER TABLE cycle_count_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycle_count_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cc_sessions_access" ON cycle_count_sessions FOR ALL USING (true);
CREATE POLICY "cc_items_access" ON cycle_count_items FOR ALL USING (true);
