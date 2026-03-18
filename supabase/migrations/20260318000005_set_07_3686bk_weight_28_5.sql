-- Set weight for 07-3686BK to 28.5 lbs
UPDATE sku_metadata SET weight_lbs = 28.5 WHERE UPPER(sku) = '07-3686BK';
