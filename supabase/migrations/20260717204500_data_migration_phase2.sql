-- Migración Fase 2: Modelos rezagados (Nuevos Colores/Tallas)
BEGIN;

UPDATE sku_metadata SET model = 'Renegade s1 udh framekit', size = '700c x 61cm' WHERE sku = '09-4830CL';
UPDATE sku_metadata SET model = 'Allegro A3', size = '23', color = 'Cayenne' WHERE sku = '03-4813RD';
UPDATE sku_metadata SET model = 'TAXI 26 S/O', size = '18', color = 'CAROLINA BLUE LDV' WHERE sku = '06-4627LDV';
UPDATE sku_metadata SET model = 'HUDSON', size = '17', color = 'CHARCOAL' WHERE sku = '03-3027CL';
UPDATE sku_metadata SET model = 'Allegro A3', size = '19', color = 'Cayenne' WHERE sku = '03-4809RD';
UPDATE sku_metadata SET model = 'VENTURA A1', size = '48', color = 'MIDNIGHT BL' WHERE sku = '033780BL';
UPDATE sku_metadata SET model = 'Allegro A3', size = '15', color = 'Cayenne' WHERE sku = '03-4805RD';
UPDATE sku_metadata SET model = 'RENEGADE S1 UDH FRAMEKIT', size = '58', color = 'CHARCOAL' WHERE sku = '09-4829CL';
UPDATE sku_metadata SET model = 'RENEGADE S1 UDH FRAMEKIT', size = '56', color = 'CHARCOAL' WHERE sku = '09-4828CL';
UPDATE sku_metadata SET model = 'Allegro A3', size = '17', color = 'Cayenne' WHERE sku = '03-4807RD';
UPDATE sku_metadata SET model = 'EXPLORER A2', size = '15', color = 'CHARCOAL' WHERE sku = '03-3058CL';
UPDATE sku_metadata SET model = 'RENEGADE S1 UDH FRAMEKIT', size = '54', color = 'CHARCOAL' WHERE sku = '09-4827CL';
UPDATE sku_metadata SET model = 'EXPLORER A2', size = '19', color = 'CHARCOAL' WHERE sku = '03-3062CL';
UPDATE sku_metadata SET model = 'Allegro A3', size = '21', color = 'Cayenne' WHERE sku = '03-4811RD';
UPDATE sku_metadata SET model = 'EXPLORER A2', size = '17', color = 'CHARCOAL' WHERE sku = '03-3060CL';

COMMIT;