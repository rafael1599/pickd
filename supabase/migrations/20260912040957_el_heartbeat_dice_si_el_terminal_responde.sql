-- El heartbeat no decía si el AS400 responde.
--
-- 12 sep 2026, 00:20 NY. Bay 2 perdió el terminal tras un `mismatch` y desde
-- fuera no había forma de distinguirlo de un fin de semana tranquilo: el
-- heartbeat late igual, `last_gap_at` sólo se mueve cuando corre un hueco, y
-- un escáner atascado reintentando `bootstrap_session` no corre ninguno. El
-- faro de salud que pinta el punto de la interfaz de Bay 2 (`as400_health()`)
-- vive en memoria del proceso, así que sólo lo ve quien está delante del Mac —
-- que es precisamente quien no está cuando esto pasa.
--
-- Una columna. `ok`, `err: stock_inquiry`, `unknown`. Con eso, «el terminal
-- está aparcado en una pantalla que no reconoce» se ve desde cualquier sitio, y
-- el lunes por la mañana se sabe antes de caminar hasta la bahía.

ALTER TABLE public.as400_watcher_heartbeat
  ADD COLUMN IF NOT EXISTS as400_state text;

COMMENT ON COLUMN public.as400_watcher_heartbeat.as400_state IS
  'Lo ultimo que contesto el terminal: ok / err[: pantalla donde quedo aparcado] / unknown (sin senal o rancia). Lo escribe door.py desde auto_scanner.as400_health().';
