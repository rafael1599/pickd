-- Set kids bike weight to 35 lbs
UPDATE sku_metadata SET weight_lbs = 35
WHERE UPPER(sku) IN (
  '07-3663BL',  -- JUV STARLITE 2025 BLUE LAGOON
  '07-3664BL',  -- (pending in sku_metadata)
  '06-4284TL',  -- TAXI 16 BAMBOO BEACH TEAL
  '07-3692BL',  -- JUV LASER 1.6 2025 DEEP BLUE
  '07-3626BL',  -- JUV LASER 2.0 2025 COSMO BLUE
  '07-3606GP'   -- P
);
