-- Fix bikes incorrectly set to 0.1 lbs
-- These were hit by the parts dimension migration or auto-assigned 0.1 by OrdersScreen

-- 1. E-bikes → 60 lbs
UPDATE sku_metadata SET weight_lbs = 60
WHERE is_bike = true AND weight_lbs = 0.1
  AND sku IN (
    '03-3606BL',  -- HUDSON E2 STEP-THRU
    '03-3607GY',  -- HUDSON E2 STEP-THRU
    '03-4608BL',  -- DEFCON E1
    '03-4611BK'   -- DEFCON E2
  );

-- 2. Special: 07-3686BK → 28.5 lbs
UPDATE sku_metadata SET weight_lbs = 28.5
WHERE sku = '07-3686BK' AND weight_lbs = 0.1;

-- 3. Kids bikes (07-prefix + TAXI) → 35 lbs
UPDATE sku_metadata SET weight_lbs = 35
WHERE is_bike = true AND weight_lbs = 0.1
  AND (sku LIKE '07-%' OR sku = '06-4284TL');

-- 4. All remaining bikes with 0.1 → 45 lbs (standard default)
UPDATE sku_metadata SET weight_lbs = 45
WHERE is_bike = true AND weight_lbs = 0.1;
