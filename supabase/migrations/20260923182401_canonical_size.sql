-- ============================================================================
-- La talla, canónica al guardar (idea-224, P1/P2)
--
-- Decisiones de Rafael (cerradas):
--   - Lo guardado es la forma humana: 17", 54cm, L16", 26"×18".
--   - La rueda 700 se guarda SIN LA C: 700×54cm, 700×19", y bare 700C -> 700.
--   - La regla sólo aplica a bicis (is_bike = true) y cuadros sueltos (category = 'frame').
--     Las partes conservan su texto exacto porque 'size' guarda años ('06', '08').
--
-- Espejo SQL de displaySize (src/utils/size.ts):
--   - canonical_size(p_raw text, p_is_bike boolean, p_category text) IMMUTABLE
--   - Trigger tr_sku_metadata_size_canonical en sku_metadata:
--     Postgres corre triggers BEFORE en orden alfabético.
--     tr_sku_metadata_set_is_bike (INSERT) corre primero resolviendo is_bike;
--     tr_sku_metadata_size_canonical corre después con is_bike ya resuelto.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.canonical_size(
  p_raw text,
  p_is_bike boolean,
  p_category text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $function$
DECLARE
  v text;
  m text[];
  num numeric;
  unit text;
  low_step text;
BEGIN
  IF p_raw IS NULL OR btrim(p_raw) = '' THEN
    RETURN NULL;
  END IF;

  -- Guard: las tallas de cuadro sólo aplican a bicis y cuadros sueltos
  IF NOT (p_is_bike IS TRUE OR lower(btrim(coalesce(p_category, ''))) = 'frame') THEN
    RETURN btrim(p_raw);
  END IF;

  v := upper(btrim(p_raw));
  v := regexp_replace(v, '["‘’“”'']', '', 'g');
  v := regexp_replace(v, '\s+', '', 'g');
  v := regexp_replace(v, '[*×]', 'X', 'g');
  v := regexp_replace(v, 'CM$', '', 'g');

  IF v = '' THEN
    RETURN NULL;
  END IF;

  -- 1. Rueda 700 con cuadro (se comprueba antes que el par porque 700X54 también encajaría en par)
  m := regexp_match(v, '^700C?X([0-9]+(?:\.[0-9]+)?)$');
  IF m IS NOT NULL THEN
    num := (m[1])::numeric;
    unit := CASE WHEN num <= 29 THEN '"' WHEN num >= 44 THEN 'cm' ELSE '' END;
    RETURN '700×' || m[1] || unit;
  END IF;

  -- 2. Rueda 700 bare
  IF v = '700C' OR v = '700' THEN
    RETURN '700';
  END IF;

  -- 3. Par compuesto: ambas son pulgadas
  m := regexp_match(v, '^([0-9]+(?:\.[0-9]+)?)X([0-9]+(?:\.[0-9]+)?)$');
  IF m IS NOT NULL THEN
    RETURN m[1] || '"×' || m[2] || '"';
  END IF;

  -- 4. Cuadro simple con prefijo opcional L de cuadro bajo
  m := regexp_match(v, '^(L?)([0-9]+(?:\.[0-9]+)?)$');
  IF m IS NOT NULL THEN
    low_step := m[1];
    num := (m[2])::numeric;
    IF num <= 29 THEN
      RETURN low_step || m[2] || '"';
    ELSIF num >= 44 THEN
      RETURN low_step || m[2] || 'cm';
    ELSE
      RETURN btrim(p_raw);
    END IF;
  END IF;

  -- 5. Texto libre / no-medida: se conserva tal cual
  RETURN btrim(p_raw);
END;
$function$;

COMMENT ON FUNCTION public.canonical_size(text, boolean, text) IS
  'Talla canónica de cuadro (forma humana: 17", 54cm, L16", 26"×18", rueda 700×54cm sin C). Espejo de displaySize en src/utils/size.ts.';

CREATE OR REPLACE FUNCTION public.normalize_sku_size()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.size := public.canonical_size(NEW.size, NEW.is_bike, NEW.category);
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.normalize_sku_size() IS
  'Trigger function que asegura que sku_metadata.size se guarde siempre en su forma canónica.';

DROP TRIGGER IF EXISTS tr_sku_metadata_size_canonical ON public.sku_metadata;
CREATE TRIGGER tr_sku_metadata_size_canonical
  BEFORE INSERT OR UPDATE OF size, is_bike, category ON public.sku_metadata
  FOR EACH ROW EXECUTE FUNCTION public.normalize_sku_size();

-- ── Validación: tabla de casos idéntica al test TS ──────────────────────────
DO $$
DECLARE
  r record;
  got text;
  bad text := '';
  v_prod_spellings text[] := ARRAY[
    '-', '05', '06', '08', '09', '10', '10"', '10"x20"', '10X20', '11',
    '12', '12X27', '13', '13X27', '14', '14"', '15', '15.5', '15.5"', '15"',
    '15X27', '16', '16"', '17', '17"', '17X29', '18', '18"', '19', '19"',
    '19X29', '20', '20"x10"', '21', '21"', '21X29', '23', '23"', '24', '24"',
    '24"x12"', '26', '26"', '26"*18"', '26”x13”', '26"x17"', '26"x18"', '26"X18"',
    '26*21', '26X18', '27.5"x12"', '27.5"x16"', '27.5"X16"', '27.5X14', '27.5X19',
    '29', '29"x17 "', '29"x17"', '31.8', '44', '48', '48cm', '51', '51cm',
    '54', '54cm', '56', '56 cm', '56cm', '58', '58 cm', '58cm', '58CM',
    '61', '61 cm', '61cm', '61CM', '7.25"', '7.5"', '7.75"', '7"',
    '700 x 54 cm', '700C x 54cm', '700c x 61cm', '700c*19', '700CX16',
    '700Cx54cm', '700Cx58cm', '8"', '8”*16”', 'Adult ', 'L', 'MD/17', 'S', 'X'
  ];
  s text;
  c1 text;
  c2 text;
BEGIN
  -- 1. Casos dirigidos
  FOR r IN
    SELECT * FROM (VALUES
      ('17', true, NULL, '17"'),
      ('15.5', true, NULL, '15.5"'),
      ('29', true, NULL, '29"'),
      ('48', true, NULL, '48cm'),
      ('54', true, NULL, '54cm'),
      ('61', true, NULL, '61cm'),
      ('35', true, NULL, '35'),
      ('15"', true, NULL, '15"'),
      ('54cm', true, NULL, '54cm'),
      ('56 cm', true, NULL, '56cm'),
      ('61CM', true, NULL, '61cm'),
      ('L16', true, NULL, 'L16"'),
      ('L48', true, NULL, 'L48cm'),
      ('15X27', true, NULL, '15"×27"'),
      ('27.5X14', true, NULL, '27.5"×14"'),
      ('26"X18"', true, NULL, '26"×18"'),
      ('26*18', true, NULL, '26"×18"'),
      ('26"×18"', true, NULL, '26"×18"'),
      ('700C', true, NULL, '700'),
      ('700', true, NULL, '700'),
      ('700Cx58cm', true, NULL, '700×58cm'),
      ('700CX16', true, NULL, '700×16"'),
      ('700x54cm', true, NULL, '700×54cm'),
      ('700X19', true, NULL, '700×19"'),
      ('700 x 54 cm', true, NULL, '700×54cm'),
      ('700c*19', true, NULL, '700×19"'),
      ('L', true, NULL, 'L'),
      ('Adult', true, NULL, 'Adult'),
      ('MD/17', true, NULL, 'MD/17'),
      (NULL, true, NULL, NULL),
      ('   ', true, NULL, NULL),
      -- Part guard
      ('06', false, NULL, '06'),
      ('08', false, 'hanger', '08'),
      ('16', false, NULL, '16'),
      ('54', false, 'frame', '54cm'),
      ('54', NULL, 'Frame', '54cm'),
      ('17', NULL, NULL, '17')
    ) AS v(raw, is_bike, category, expected)
  LOOP
    got := public.canonical_size(r.raw, r.is_bike, r.category);
    IF got IS DISTINCT FROM r.expected THEN
      bad := bad || format(E'\n  (%L, %s, %L) → %s (expected %s)',
        r.raw, coalesce(r.is_bike::text, 'NULL'), r.category,
        coalesce(got, 'NULL'), coalesce(r.expected, 'NULL'));
    END IF;
  END LOOP;

  -- 2. Idempotencia sobre las 95 grafías de prod
  FOREACH s IN ARRAY v_prod_spellings
  LOOP
    c1 := public.canonical_size(s, true, NULL);
    c2 := public.canonical_size(c1, true, NULL);
    IF c1 IS DISTINCT FROM c2 THEN
      bad := bad || format(E'\n  idempotence failed on %L: once=%L twice=%L', s, c1, c2);
    END IF;
  END LOOP;

  IF bad <> '' THEN
    RAISE EXCEPTION 'canonical_size validation failed:%', bad;
  END IF;
END;
$$;
