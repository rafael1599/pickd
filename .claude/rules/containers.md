---
paths:
  - 'src/features/registrar-container/**'
  - 'src/features/inventory/Container*.tsx'
  - 'src/features/inventory/hooks/useContainers.ts'
  - 'src/features/inventory/utils/containerReport.ts'
  - 'src/utils/containerDistribution.ts'
---

# Containers: registrar no es llegar

> Movido tal cual desde `CLAUDE.md` el 2 oct 2026 (pasaba el límite de 150k caracteres de
> instrucciones). Claude Code carga este archivo al trabajar con las rutas de arriba; los demás
> agentes lo encuentran por el índice de `CLAUDE.md`. Lo nuevo de esta área se escribe **aquí**.

**Containers: registrar no es llegar (24 sep 2026).** Un container (`NNNNN`, p. ej. `6436N`) se
registra **por adelantado** en Register Container, antes de que llegue (Rafael: «registramos por
adelantado un container que sabemos que está por llegar»), y **llega el día en que se descarga**
con MOVE a los estantes. Register Container → botones **Coming** y **Past** (`/containers?tab=…`),
cada container abre su reporte (`/containers/:id`: container · SKU · LOC · DIST · TOTAL, imprimir,
Excel). Reemplazó a Strapped Pallets, que estaba atado a 6436N y comparaba contra el stock de hoy
—con el container repartido, ese stock ya incluye sus bicis y TOTAL las contaba dos veces—.

- **`container_intakes`** (`20260924173317`): una fila por llamada a `register_container`, que la
  sella en la misma transacción; los 18 anteriores se rellenaron desde `inventory_logs` con la
  **primera** carga de cada ubicación (todas las líneas de una llamada comparten `created_at`).
- **Lo que llegó** (`container_arrivals`) = el registro **+ los ajustes a mano** (+ y −) hechos
  después en la ubicación del container: el día de la recepción se corrige la lista a mano (7005N).
  No cuentan MOVE, lo que sale para una orden ni lo del sistema.
- **La llegada** (`container_arrived_at`, `20260924190538`) es el primer día NY en que sale por MOVE
  **al menos la mitad** de lo que trajo: la bici suelta que se movió de 7006N no es la descarga. Sin
  eso, el primer MOVE si en total salió la mitad (6430N, partes que salen de a poco), o la primera
  salida si está vacío. Sin llegada = **coming**.
- **Contra qué Ludlow:** si llegó, el último daily snapshot **tomado** antes de la llegada —se elige
  por `created_at` de sus filas, no por `snapshot_date`: el snapshot con fecha X se toma la madrugada
  de X+1 (~05:40–06:20 NY)—; si viene, el stock de ahora. Ludlow excluye containers, `UNKNOWN` y
  `counts_as_storage = false`. **El snapshot guarda `sublocation` desde el 24 sep**: LOC lleva la
  letra del cuadro desde entonces; los containers anteriores salen sin ella.
- **Una orden no saca unidades de un container** (Rafael, 24 sep: «las órdenes no deben tomar items
  de un container»). La app no lo planea (`isWarehouseContainer` en `planPickAcrossLocations`,
  `diagnoseStockIssue`, `pickBestStockRow`, desde `20260914202651`), y `adjust_inventory_quantity`
  se niega (23514, «Container … is not a shelf») a un DEDUCT con `list_id`/`order_number` sobre un
  container **con stock**: una ubicación escrita a mano llegaba hasta el descuento. MOVE y ajustes a
  mano siguen libres; una línea sobre un container vacío (#881309 → 9000N) no se frena.
- **9001N** (192 Hudson E1, registrado el 10 sep) tiene los mismos 6 SKUs y cantidades que 9000N
  (julio, ya repartido). Sale en Coming; si al llegar no trae eso, es un doble registro.
