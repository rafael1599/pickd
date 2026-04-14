-- TEMPORARY: Set all ROW items to sublocation 'F' for visual testing
-- REVERT after confirming UI looks good
UPDATE inventory
SET sublocation = 'F'
WHERE location ILIKE 'ROW%'
  AND is_active = true
  AND quantity > 0;
