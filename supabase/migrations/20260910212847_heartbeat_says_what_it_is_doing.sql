-- Por qué el watchdog no está haciendo nada, sin ir a la máquina.
--
-- El motivo por el que la cola de catálogo se aparta vive en `logs/app-stderr.log`
-- de Bay 2. Para leerlo hay que teclear en esa Mac — y teclear ES el operador
-- volviendo: `system_idle_seconds()` se resetea y la cola se aparta por esa misma
-- razón. El diagnóstico apaga lo que quiere medir (Rafael, 10 sep 2026).
--
-- El heartbeat ya viaja cada minuto y ya sirvió para descubrir que Bay 2 llevaba
-- 18 h sin actualizarse. Que lleve también en qué está: dos columnas, ninguna
-- escritura nueva — se rellenan en el upsert que ya existe.
--
-- `last_gap_reason` es literalmente lo que el bucle diría en el log:
-- 'the operator is back', 'an update is waiting', 'the SKU queue is empty',
-- 'budget spent', o 'working'. `last_gap_at` es cuándo lo dijo, para distinguir
-- "se apartó hace un minuto" de "lleva así desde ayer".

ALTER TABLE public.as400_watcher_heartbeat
  ADD COLUMN IF NOT EXISTS last_gap_reason text,
  ADD COLUMN IF NOT EXISTS last_gap_at timestamptz,
  ADD COLUMN IF NOT EXISTS skus_read_total integer;

COMMENT ON COLUMN public.as400_watcher_heartbeat.last_gap_reason IS
  'Por qué el paso de catálogo no corrió la última vez (o "working"). Lo mismo que el log de Bay 2, pero legible desde aquí.';
COMMENT ON COLUMN public.as400_watcher_heartbeat.last_gap_at IS
  'Cuándo se decidió eso. Distingue "acaba de apartarse" de "lleva así desde ayer".';
COMMENT ON COLUMN public.as400_watcher_heartbeat.skus_read_total IS
  'SKUs leídos por este proceso desde que arrancó. Se reinicia con cada deploy — para el total real, sku_metadata.as400_read_at.';
