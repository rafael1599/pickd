-- bug-028 (Rafael, 8 oct 2026): REBOX son cajas dañadas que hay que cambiar antes de enviar;
-- nunca se recomienda antes que otra dirección con stock. Mismo mecanismo que RETURN TO STOCK
-- (20260918031208): el motor (`tierOf`, utils/pickLocation.ts) recorre `last` al final.
UPDATE public.locations
SET pick_priority = 'last'
WHERE location = 'REBOX'
  AND pick_priority IS DISTINCT FROM 'last';
