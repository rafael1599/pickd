-- idea-025: Reset parts SKUs that inherited bike dimension defaults
-- Only touches parts (non-bike SKUs) that have the exact bike defaults (54×8×30, 45 lbs).
-- Parts that were manually edited to different values are untouched.
-- Bike SKU pattern: 2 digits, hyphen, 4 digits, 2+ letters (e.g. 06-4572GY)

UPDATE sku_metadata
SET
  weight_lbs = 0.1,
  length_in  = 0,
  width_in   = 0,
  height_in  = 0
WHERE sku !~ '^\d{2}-\d{4}[A-Za-z]{2,}$'
  AND weight_lbs = 45
  AND length_in = 54;
