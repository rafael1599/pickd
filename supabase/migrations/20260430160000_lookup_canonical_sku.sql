-- idea-092: SKU format mismatch auto-resolver
--
-- Tiny lookup RPC for the pick-time fallback. Given a raw SKU (e.g.
-- "034666BR" coming from a PDF parsed without dashes), return the
-- canonical SKU(s) whose normalized form matches.
--
-- Returns up to 2 rows so the caller can detect ambiguity:
--   0 rows  → no match, leave alone.
--   1 row   → unique canonical → safe to suggest.
--   2 rows  → ambiguous → don't auto-suggest, ask the user.
--
-- Normalization rule mirrors search_inventory_with_metadata:
-- regexp_replace(sku, '[-\s]', '', 'g'), case-insensitive.

CREATE OR REPLACE FUNCTION public.lookup_canonical_sku(p_raw text)
RETURNS TABLE (sku text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH norm AS (
    SELECT regexp_replace(LOWER(TRIM(p_raw)), '[-\s]', '', 'g') AS n
  )
  SELECT sm.sku
  FROM public.sku_metadata sm
  CROSS JOIN norm
  WHERE norm.n <> ''
    AND regexp_replace(LOWER(sm.sku), '[-\s]', '', 'g') = norm.n
    AND sm.sku <> p_raw -- exclude exact-match (the bad sku itself if it happens to live in sku_metadata)
  LIMIT 2;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_canonical_sku(text)
  TO anon, authenticated, service_role;
