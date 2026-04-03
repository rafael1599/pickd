-- idea-012: Multi-address customers
-- Allows multiple shipping addresses per customer with deduplication via normalized_address

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE customer_addresses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  label text,

  street text NOT NULL,
  city text,
  state text,
  zip_code text,

  -- Normalized composite for robust dedup (case-insensitive, trimmed)
  normalized_address text GENERATED ALWAYS AS (
    lower(trim(street)) || '|' ||
    lower(trim(coalesce(city, ''))) || '|' ||
    lower(trim(coalesce(state, ''))) || '|' ||
    lower(trim(coalesce(zip_code, '')))
  ) STORED,

  is_default boolean DEFAULT false,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE(customer_id, normalized_address)
);

-- Fast lookup by customer
CREATE INDEX idx_customer_addresses_customer_id
ON customer_addresses(customer_id);

-- Fuzzy search on street
CREATE INDEX idx_customer_addresses_search
ON customer_addresses
USING gin (street gin_trgm_ops);

-- Only one default per customer
CREATE UNIQUE INDEX one_default_per_customer
ON customer_addresses(customer_id)
WHERE is_default = true;

-- Seed: copy existing customer addresses as their default
INSERT INTO customer_addresses (
  customer_id, street, city, state, zip_code, is_default
)
SELECT DISTINCT ON (id, street, city, state, zip_code)
  id,
  trim(street),
  city,
  state,
  zip_code,
  true
FROM customers
WHERE trim(coalesce(street, '')) != '';

-- RLS
ALTER TABLE customer_addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customer_addresses_access"
ON customer_addresses
FOR ALL
USING (true);
