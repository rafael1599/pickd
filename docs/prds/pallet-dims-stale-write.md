# PRD: Escrituras rancias en tarimas (`pallet_dims`) — Guardar medidas sin pisar lo armado a mano

**Estado:** estudio, esperando «ok» · **Fecha:** 2026-10-08 · **Autor:** Diseñador técnico PickD  
**Incidente de referencia:** Orden #881856 (prod, 8 oct 2026)  
**Entregable único:** Este estudio técnico (`docs/prds/pallet-dims-stale-write.md`). Sin cambios de código, sin commits ni escrituras a bases de datos.  
**Archivos base auditados:**

- `src/features/picking/hooks/usePalletDims.ts`
- `src/features/picking/ShipScreen.tsx`
- `src/features/picking/components/DoubleCheckView.tsx`
- `src/features/picking/components/PalletBuilderModal.tsx`
- `src/components/orders/ShipOrderCard.tsx`
- `src/components/orders/PalletDeclaration.tsx`
- `src/features/picking/ship/api/shipOrderDetail.ts`
- `src/features/picking/ship/hooks/useShipOrdersData.ts`
- `src/utils/palletDims.ts`
- `supabase/migrations/20260927011500_explicit_shipments.sql`
- `supabase/migrations/20260929132003_combine_never_joins_fedex_batch.sql`

---

## 1. El incidente real (#881856, 8 oct 2026)

### Cronología comprobada en producción

1. **17:46:** La estación Ship carga la orden #881856. La tarima 1 tiene 9 bicicletas en `items`.
2. **19:46:** En el piso, Double Check View (DCV) agrega 3 unidades de `03-3989GY` a la tarima 1 (total: 12 bicicletas). Se persiste en base de datos (`shipments.pallet_dims`):
   ```json
   {
     "pallet": 1,
     "items": [
       { "sku": "03-3982BL", "location": "ROW 33 · A", "qty": 9 },
       { "sku": "03-3989GY", "location": "ROW 33 · B", "qty": 3 }
     ],
     "units": 12,
     "edited_at": "2026-10-08T19:46:00Z"
   }
   ```
3. **19:57:** En la estación de envío, Ship sigue abierto con la copia en memoria de las 17:46 (tarima 1 con 9 bicicletas). El operador mide físicamente la tarima 1 con cinta métrica (46" de ancho × 82" de alto) y teclea los valores en la tabla de Ship.
4. **Al guardar (`flush`):** Ship ejecuta una relectura de DB, pero fusiona de vuelta **la entrada completa local de su estado viejo**:
   - `items` con 9 bicicletas (de las 17:46) pisa a `items` con 12 bicicletas (de las 19:46).
   - `units: 9` pisa a `units: 12`.
   - `edited_at: "17:46"` pisa a `edited_at: "19:46"`.
   - Se agregan `width_in: 46`, `height_in: 82`, `measured_at: "19:57"`.
5. **Consecuencia visible:** Las 3 unidades de `03-3989GY` desaparecen de la tarima 1. El motor de reparto (`planPallets`) ve 3 bicicletas sueltas que ya no caben en la tarima 1 y recalcula la carga en **4 tarimas** en vez de las 3 físicas reales.
6. **Incidente secundario verificado esa misma tarde:** Un teléfono en DCV «seguía viendo» la tarima 3 vieja tras una escritura directa en la base de datos, porque DCV carece totalmente de suscripción a `shipments`.

---

## 2. Auditoría de caminos que escriben `pallet_dims`

Clasificación estricta: **[VERIFICADO]** indica código comprobado línea por línea en el repositorio. **[INFERIDO]** indica deducción contextual de flujo donde aplica.

### 2.1. Caminos desde Double Check View (DCV)

1. **Medidas físicas por eje (`length_in`, `width_in`, `height_in`)**
   - **Archivo y línea:** `DoubleCheckView.tsx:3722` llama a `setPalletDimAxis(pallet.id, axis, value, boxes)`.
   - **Hook receptor:** `usePalletDims.ts:247` (`setAxis`).
   - **Campos que toca:** `[axis]` (`length_in` / `width_in` / `height_in`), `units`, `measured_at`.
   - **Copia origen:** Estado local React (`prev.entries` en `usePalletDims.ts:250`).
   - **Persistencia:** Dispara debounce de 800 ms (`FLUSH_DELAY_MS`) hacia `flush()`.
   - **[VERIFICADO]**

2. **Armar tarima a mano (+ Add pallet / editar con lápiz en modal)**
   - **Archivo y línea:** `DoubleCheckView.tsx:1133` llama a `setPalletItems(w.pallet, w.items)` tras `applyPalletSelection`.
   - **Hook receptor:** `usePalletDims.ts:329` (`setItems`).
   - **Campos que toca:** `items`, `units` (`sum(qty)`), `edited_at`.
   - **Copia origen:** Estado local React.
   - **Persistencia:** Debounce de 800 ms hacia `flush()`.
   - **[VERIFICADO]**

3. **«Back to auto» en PalletBuilderModal**
   - **Archivo y línea:** `DoubleCheckView.tsx:1139` llama a `setPalletItems(ordinal, null)`.
   - **Hook receptor:** `usePalletDims.ts:329` (`setItems`).
   - **Campos que toca:** `items: null`, `units: 0`, `edited_at`.
   - **Copia origen:** Estado local React.
   - **Persistencia:** Debounce de 800 ms hacia `flush()`.
   - **[VERIFICADO]**

4. **Resetear bicis tecleadas a automático**
   - **Archivo y línea:** `DoubleCheckView.tsx:1086` llama a `setPalletBikes(editingPalletId, null, 0)`.
   - **Hook receptor:** `usePalletDims.ts:314` (`setBikes`).
   - **Campos que toca:** `bikes: null`, `edited_at`. Si `builtToRelease` activa, `items: null` en tarimas afectadas.
   - **Copia origen:** Estado local React.
   - **Persistencia:** Debounce de 800 ms hacia `flush()`.
   - **[VERIFICADO]**

5. **Propuesta de selección de bicis (proposeSelection)**
   - **Archivo y línea:** `DoubleCheckView.tsx:1233` llama a `setPalletItems(w.pallet, w.items)`.
   - **Hook receptor:** `usePalletDims.ts:329` (`setItems`).
   - **Campos que toca:** `items`, `units`, `edited_at`.
   - **Copia origen:** Estado local React.
   - **Persistencia:** Debounce de 800 ms hacia `flush()`.
   - **[VERIFICADO]**

6. **Split de tarimas de niño (+ / -)**
   - **Archivo y línea:** `DoubleCheckView.tsx:3060, 3072` llama a `setPalletKidsSplit(pallet.kidsOf!, split ± 1, 0)`.
   - **Hook receptor:** `usePalletDims.ts:308` (`setSplit`).
   - **Campos que toca:** `split`, `edited_at`.
   - **Copia origen:** Estado local React.
   - **Persistencia:** Debounce de 800 ms hacia `flush()`.
   - **[VERIFICADO]**

7. **Foto del frente (inferencia de cajas y auto-apply)**
   - **Archivo y línea:** `DoubleCheckView.tsx:1262` (`onFrontRead`), 1352, 1371, 1397 llaman a `writeFront` -> `DoubleCheckView.tsx:1233` (`setPalletItems`).
   - **Hook receptor:** `usePalletDims.ts:329` (`setItems`).
   - **Campos que toca:** `items`, `units`, `edited_at`.
   - **Copia origen:** `currentUnitsRef.current` (estado derivado local del cliente).
   - **Persistencia:** Debounce de 800 ms hacia `flush()`.
   - **[VERIFICADO]**

8. **Botón «Take Photo» en DCV (flush inmediato)**
   - **Archivo y línea:** `DoubleCheckView.tsx:3732` ejecuta `void flushPalletDims()` explícito antes de abrir la cámara.
   - **Hook receptor:** `usePalletDims.ts:181` (`flush`).
   - **Campos que toca:** Vuelca todas las tarimas marcadas en `dirtyRef.current`.
   - **Copia origen:** Relectura fresca de DB combinada con `entriesRef.current` (estado local).
   - **[VERIFICADO]**

9. **Completar la orden (Slide to Complete / Re-Complete)**
   - **Archivo y línea:** `DoubleCheckView.tsx:2608` (`handleConfirm` -> `onDeduct`) y `supabase/migrations/20260927011500_explicit_shipments.sql:518` (`process_picking_list`).
   - **Comportamiento verificado:** La RPC `process_picking_list` en PostgreSQL **NO toca** `pallet_dims` (líneas 615–626 actualizan únicamente `pallets_qty`, `total_units`, inventario y `status`).
   - **Escritura real:** La escritura de `pallet_dims` al completar ocurre exclusivamente por el cleanup del `useEffect` al desmontar `DoubleCheckView` (`usePalletDims.ts:337`: `useEffect(() => () => void flush(), [flush])`). Si había cambios en debounce pendientes en el cliente, se escriben en ese instante.
   - **[VERIFICADO]**

---

### 2.2. Caminos desde Ship (la estación de envío)

1. **Medidas físicas por eje (`length_in`, `width_in`, `height_in`)**
   - **Archivo y línea:** `ShipScreen.tsx:3401` -> `ShipOrderCard.tsx:1359` -> `PalletDeclaration.tsx:479` (`onChange`) -> llama a `setPalletDimAxis(d.pallet, axis, value, d.boxes)`.
   - **Hook receptor:** `usePalletDims.ts:247` (`setAxis`).
   - **Campos que toca:** `[axis]`, `units` (toma el valor `d.boxes` de la UI visible), `measured_at`.
   - **Copia origen:** Estado local React en `usePalletDims`.
   - **Persistencia:** Debounce de 800 ms hacia `flush()`.
   - **[VERIFICADO]** _(Este es exactamente el camino ejecutado a las 19:57 en #881856)._

2. **Partes por tarima (`parts`)**
   - **Archivo y línea:** `ShipScreen.tsx:3402` -> `PalletDeclaration.tsx` -> llama a `setPalletDimParts(pallet, value, units)`.
   - **Hook receptor:** `usePalletDims.ts:302` (`setParts`).
   - **Campos que toca:** `parts`, `edited_at`.
   - **Copia origen:** Estado local React.
   - **Persistencia:** Debounce de 800 ms hacia `flush()`.
   - **[VERIFICADO]**

3. **Cifra de bicis tecleada por tarima (`bikes`)**
   - **Archivo y línea:** `ShipScreen.tsx:3409` llama a `setPalletBikes(pallet, null, boxes)` si se vacía la casilla, o abre el editor modal con propuesta si tiene cifra.
   - **Hook receptor:** `usePalletDims.ts:314` (`setBikes`).
   - **Campos que toca:** `bikes`, `edited_at`. Suelta `items` si activa `builtToRelease`.
   - **Copia origen:** Estado local React.
   - **Persistencia:** Debounce de 800 ms hacia `flush()`.
   - **[VERIFICADO]**

4. **Split de tarimas de niño (+ / -)**
   - **Archivo y línea:** `ShipScreen.tsx:3412` -> `PalletDeclaration.tsx` -> llama a `setPalletKidsSplit`.
   - **Hook receptor:** `usePalletDims.ts:308` (`setSplit`).
   - **Campos que toca:** `split`, `edited_at`.
   - **Copia origen:** Estado local React.
   - **Persistencia:** Debounce de 800 ms hacia `flush()`.
   - **[VERIFICADO]**

5. **Lápiz de tarima en tabla de Ship (PalletBuilderModal)**
   - **Archivo y línea:** `ShipScreen.tsx:1003` llama a `setPalletItems(w.pallet, w.items)`.
   - **Hook receptor:** `usePalletDims.ts:329` (`setItems`).
   - **Campos que toca:** `items`, `units`, `edited_at`.
   - **Copia origen:** Estado local React.
   - **Persistencia:** Debounce de 800 ms hacia `flush()`.
   - **[VERIFICADO]**

6. **«Back to auto» en PalletBuilderModal desde Ship**
   - **Archivo y línea:** `ShipScreen.tsx:1006` llama a `setPalletItems(ordinal, null)`.
   - **Hook receptor:** `usePalletDims.ts:329` (`setItems`).
   - **Campos que toca:** `items: null`, `units: 0`, `edited_at`.
   - **Copia origen:** Estado local React.
   - **Persistencia:** Debounce de 800 ms hacia `flush()`.
   - **[VERIFICADO]**

---

### 2.3. Caminos desde Base de Datos (Migraciones, RPCs y Triggers)

1. **Combinar órdenes (`combine_into_shipment`)**
   - **Archivo y línea:** `supabase/migrations/20260927011500_explicit_shipments.sql:244, 260` (reafirmado en `20260929132003_combine_never_joins_fedex_batch.sql:172, 188`).
   - **Acción:** `pallet_dims = '[]'::jsonb`. Reinicia a vacío tanto el envío destino como los envíos fuente que quedan vacíos.
   - **[VERIFICADO]**

2. **Separar órdenes (`split_from_shipment`)**
   - **Archivo y línea:** `supabase/migrations/20260927011500_explicit_shipments.sql:410`.
   - **Acción:** `pallet_dims = '[]'::jsonb`. Reinicia a vacío el envío remanente. (La orden separada recibe un envío nuevo vía trigger con `'[]'::jsonb`).
   - **[VERIFICADO]**

3. **Creación de orden (`ensure_order_shipment`)**
   - **Archivo y línea:** `supabase/migrations/20260926174211_shipments.sql:48, 208`.
   - **Acción:** Crea la fila en `shipments` con `pallet_dims` por defecto `'[]'::jsonb`.
   - **[VERIFICADO]**

4. **Triggers históricos de Fase 3 (retirados)**
   - `sync_picking_list_to_shipment` y `trg_shipments_mirror_update` fueron eliminados explícitamente el 27 sep 2026 (`20260927011500_explicit_shipments.sql:15–19`). **No ejecutan**.
   - **[VERIFICADO]**

---

### 2.4. Resumen de copias y el error del merge en `usePalletDims.flush()`

En todos los casos de escritura interactiva (DCV y Ship), la llamada pasa por `flush()` (`usePalletDims.ts:181–244`):

1. `flush()` ejecuta una lectura fresca de DB:
   ```ts
   // usePalletDims.ts:193-197
   const query = isShip
     ? supabase.from('shipments').select('pallet_dims').eq('id', id).single()
     : supabase.from('picking_lists').select('pallet_dims').eq('id', id).single();
   const { data } = await query;
   const fromDb = parseEntries(data?.pallet_dims);
   ```
2. Sin embargo, en la línea 205 fusiona:
   ```ts
   // usePalletDims.ts:205
   mine.map((local) => ({ ...fromDb.find((e) => e.pallet === local.pallet), ...local }));
   ```
3. **El fallo matemático:** `local` es un objeto `PalletDimsEntry` completo proveniente de `entriesRef.current` (cargado al abrir la pantalla). Contiene `pallet`, `items`, `units`, `bikes`, `parts`, `split`, `edited_at`, `width_in`, etc.
4. El operador de propagación JavaScript (`{ ...fromDbEntry, ...local }`) hace que **todas las propiedades presentes en `local` sobreescriban a `fromDbEntry`**.
5. Si Ship cargó a las 17:46, `local` tiene `items` con 9 bicis. Aunque `fromDbEntry` tenga 12 bicis (19:46), `...local` machaca `fromDbEntry.items` y restablece las 9 bicis viejas.
6. El comentario del código en líneas 198–201:
   > _«Para un ordinal tocado aquí gana lo local campo a campo: si otro aparato escribió algo que este nunca leyó [...] sobrevive en vez de desaparecer bajo una copia vieja.»_  
   > **Es falso en la implementación:** No fusiona campo a campo; fusiona objeto a objeto para todo el ordinal marcado en `dirtyRef`.

---

## 3. Por qué la copia no se actualizó

### Causa 1: `usePalletDims` no tiene suscripción Realtime propia

- `src/features/picking/hooks/usePalletDims.ts` **no contiene ningún canal de Supabase Realtime** (`supabase.channel(...)`).
- Su único acceso de lectura ocurre en un `useEffect` (`usePalletDims.ts:151–180`) cuya clave de dependencias es estrictamente:
  ```ts
  // usePalletDims.ts:179
  [targetId, isShipment];
  ```
- Si la pantalla permanece abierta durante horas con la misma orden o envío en pantalla, `targetId` no cambia. Por tanto, el hook **jamás vuelve a consultar la base de datos**.

### Causa 2: Desconexión entre TanStack Query / `selectedOrder` y el estado de `usePalletDims`

- En `ShipScreen.tsx:1376–1390`, sí existe un listener Realtime para `table: 'shipments'`:
  ```ts
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'shipments' }, ...)
  ```
- Cuando DCV actualizó la tarima a las 19:46:
  1. El evento Realtime llegó a ShipScreen.
  2. ShipScreen llamó a `refreshOrderRow(orderId)` (`ShipScreen.tsx:1396`).
  3. Invalidó la query de TanStack Query `['ship-order', orderId]` (`shipOrderDetail.ts:62`).
  4. Ejecutó `fetchOrderDetails` y actualizó el estado `selectedOrder` en React (`ShipScreen.tsx:1435`).
  5. `selectedOrder.shipment.pallet_dims` quedó **fresco con 12 bicis** en el componente padre.
- **La trampa:** ShipScreen instancia el hook así:
  ```ts
  // ShipScreen.tsx:778
  usePalletDims(selectedOrder?.id ?? null, selectedOrder?.shipment_id);
  ```
- `selectedOrder.shipment_id` es el mismo UUID de hace dos horas. Las dependencias `[targetId, isShipment]` de `usePalletDims` no cambiaron en absoluto.
- `usePalletDims` mantiene su propio estado aislado `useState<DimsState>({ ... })`. No recibe las dimensiones como prop ni escucha la caché de TanStack Query.
- En consecuencia: mientras `selectedOrder` en el card tenía los datos frescos en segundo plano, la tabla de tarimas (`shipPlan`, línea 823) y los inputs de medida siguieron usando `palletDimEntries` del estado congelado a las 17:46.

### Causa 3: Double Check View (DCV) es 100 % ciego a `shipments`

- En todo el repositorio, **solo `ShipScreen.tsx:1377` escucha `table: 'shipments'`**.
- DCV (`DoubleCheckView.tsx`, `usePickingSync.ts`, `useDoubleCheckList.ts`) solo escucha eventos en `picking_lists` e `inventory`.
- Desde la migración del 27 sep 2026 (`20260927011500_explicit_shipments.sql`), las tarimas y medidas se escriben **únicamente en `shipments`**.
- Por eso, cuando alguien escribe medidas o tarimas desde Ship o directamente en SQL, **el teléfono con DCV no recibe ni una sola señal de red**. La tarima 3 (o cualquier otra) se queda congelada indefinidamente hasta que el usuario cierra y reabre la orden.

---

## 4. Propuestas de solución técnica

### Principio rector

**Escribir sólo el campo que cambió a nivel de base de datos.** Medir una tarima con cinta métrica es un acto que afecta exclusivamente a `length_in`, `width_in`, `height_in` y `measured_at`. Bajo ninguna circunstancia una medición física debe enviar ni tocar `items` (las bicicletas armadas a mano), `bikes`, `parts` o `split`.

---

### Opción 1 (Recomendada): RPC atómico de parche de campos (`patch_shipment_pallet`) + Realtime en `usePalletDims`

#### Mecanismo

1. **En Base de Datos:** Se introduce la función RPC `public.patch_shipment_pallet(p_shipment_id, p_pallet, p_patch)`.
   - Bloquea la fila del envío con `FOR UPDATE` dentro de la transacción.
   - Localiza el ordinal `p_pallet` en `shipments.pallet_dims`.
   - Aplica una fusión superficial de JSONB: `elem || p_patch`. Los campos no incluidos en `p_patch` permanecen intactos.
   - Si se envía `{"width_in": 46, "height_in": 82}`, Postgres actualiza esos dos campos sobre el registro vivo actual (el que tiene 12 bicis). `items` nunca se toca.
2. **En Frontend (`usePalletDims.ts`):**
   - El hook rastrea un mapa de campos sucios: `dirtyFieldsRef: Map<number, Partial<PalletDimsEntry>>`.
   - `setAxis` solo agrega `{ [axis]: value, measured_at: now() }` al parche de esa tarima. No incluye `items` ni `bikes`.
   - `setItems` solo agrega `{ items, units, edited_at: now() }`.
   - Al ejecutar `flush()`, invoca el RPC enviando exclusivamente el objeto parcial `p_patch`.
   - Se agrega una suscripción Realtime a `table: 'shipments'`, filtrada por `id = eq.${targetId}` dentro de `usePalletDims`. Cuando llega un update externo y no hay campos locales sucios, actualiza `state.entries` al instante.

#### Migración SQL (100 % aditiva, no destructiva)

```sql
-- Función aditiva: no altera tablas ni rompe clientes existentes.
CREATE OR REPLACE FUNCTION public.patch_shipment_pallet(
  p_shipment_id uuid,
  p_pallet      integer,
  p_patch       jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_current      jsonb;
  v_elem         jsonb;
  v_merged_entry jsonb;
  v_result       jsonb := '[]'::jsonb;
  v_found        boolean := false;
  v_items_units  integer;
BEGIN
  IF p_shipment_id IS NULL OR p_pallet IS NULL OR p_patch IS NULL THEN
    RAISE EXCEPTION 'Parámetros inválidos para patch_shipment_pallet';
  END IF;

  -- 1. Bloqueo transaccional de la fila del envío
  SELECT pallet_dims INTO v_current
  FROM public.shipments
  WHERE id = p_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shipment % no encontrado', p_shipment_id;
  END IF;

  IF v_current IS NULL OR jsonb_typeof(v_current) <> 'array' THEN
    v_current := '[]'::jsonb;
  END IF;

  -- 2. Recorrer tarimas existentes y fusionar campos sobre el ordinal objetivo
  FOR v_elem IN SELECT * FROM jsonb_array_elements(v_current)
  LOOP
    IF (v_elem->>'pallet')::integer = p_pallet THEN
      -- Fusión superficial: preserva campos existentes no presentes en p_patch
      v_merged_entry := v_elem || p_patch;
      v_merged_entry := jsonb_set(v_merged_entry, '{pallet}', to_jsonb(p_pallet));

      -- Guardia de vigencia: si la tarima tiene items armados a mano, units
      -- se mantiene fiel a la suma de items, evitando que una medida con copia
      -- rancia degrade la cuenta real de unidades de la tarima.
      IF v_merged_entry ? 'items' AND jsonb_typeof(v_merged_entry->'items') = 'array'
         AND jsonb_array_length(v_merged_entry->'items') > 0 THEN
        SELECT COALESCE(SUM((it->>'qty')::integer), 0)
          INTO v_items_units
          FROM jsonb_array_elements(v_merged_entry->'items') it;
        v_merged_entry := jsonb_set(v_merged_entry, '{units}', to_jsonb(v_items_units));
      END IF;

      v_result := v_result || jsonb_build_array(v_merged_entry);
      v_found := true;
    ELSE
      v_result := v_result || jsonb_build_array(v_elem);
    END IF;
  END LOOP;

  -- 3. Si el ordinal no existía, se añade al final
  IF NOT v_found THEN
    v_merged_entry := p_patch || jsonb_build_object('pallet', p_pallet);
    v_result := v_result || jsonb_build_array(v_merged_entry);
  END IF;

  -- 4. Actualizar el envío
  UPDATE public.shipments
  SET pallet_dims = v_result,
      updated_at = now()
  WHERE id = p_shipment_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.patch_shipment_pallet(uuid, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patch_shipment_pallet(uuid, integer, jsonb) TO authenticated, service_role;
```

#### Costo y viabilidad

- **Costo backend:** 1 migración SQL aditiva (~50 líneas). Cero cambios en esquema o columnas.
- **Costo frontend:** ~40 líneas en `usePalletDims.ts` (manejo de `dirtyFields` + llamada RPC + listener realtime).
- **Riesgo:** Nulo para otros flujos. Clientes viejos pueden seguir usando `.update({ pallet_dims })` sin conflicto mientras se actualizan.

---

### Opción 2: Optimistic Concurrency Control (OCC) con `updated_at` / versión

#### Mecanismo

1. El cliente lee `shipments.updated_at` al cargar la pantalla.
2. Al persistir, el cliente ejecuta:
   ```sql
   UPDATE shipments
   SET pallet_dims = $1, updated_at = now()
   WHERE id = $2 AND updated_at = $last_seen_updated_at;
   ```
3. Si el `UPDATE` retorna 0 filas afectadas, significa que otro dispositivo modificó el envío mientras la pantalla estaba abierta.
4. El cliente captura el conflicto, aborta la escritura, consulta nuevamente el registro fresco de la base de datos, ejecuta un algoritmo de reconciliación en JavaScript en el navegador del cliente y vuelve a intentar guardar.

#### Comparación de costo y problemas con Opción 2

- **Falsos positivos de conflicto:** Si el picker agrega bicis en DCV a las 19:46 y Ship mide a las 19:57, OCC detecta conflicto porque `updated_at` cambió, bloqueando al operador de Ship con un error de concurrencia o forzando un retry loop, a pesar de que los campos que tocaban no tenían relación física.
- **Fragilidad en el cliente:** La lógica de reintento y resolución de conflictos vive en el navegador móvil. En condiciones de red inestable o almacén, los retries con backoff fallan o saturan el cliente.
- **Costo:** Medio-Alto. Requiere lógica compleja de retry en React y manejo de UI en caso de conflicto no resoluble.

---

### Conclusión y recomendación

**Se recomienda la Opción 1.** Es minimalista, garantiza que el incidente de #881856 sea físicamente imposible (un parche de medidas nunca contiene la clave `items`), y no genera falsos conflictos entre operarios con roles distintos en el almacén.

---

## 5. Casos de verificación numerados

### Caso 1 (Incidente exacto #881856): Medición en Ship con copia vieja de contenido

- **Datos iniciales en DB (`shipments.pallet_dims`):**
  ```json
  [
    {
      "pallet": 1,
      "items": [
        { "sku": "03-3982BL", "qty": 9 },
        { "sku": "03-3989GY", "qty": 3 }
      ],
      "units": 12,
      "edited_at": "2026-10-08T19:46:00Z"
    }
  ]
  ```
- **Estado de Ship:** Pantalla abierta desde las 17:46 con copia rancia (tarima 1 con 9 unidades de `03-3982BL`).
- **Acción:** Operador teclea ancho = 46, alto = 82 en la fila de la tarima 1.
- **Llamada de red:** `patch_shipment_pallet(shipment_id, 1, {"width_in": 46, "height_in": 82, "measured_at": "2026-10-08T19:57:00Z"})`.
- **Resultado esperado en DB:**
  - `pallet_dims[0].width_in = 46`
  - `pallet_dims[0].height_in = 82`
  - `pallet_dims[0].measured_at = "2026-10-08T19:57:00Z"`
  - `pallet_dims[0].items` **se mantiene intacto con las 12 bicis** (incluyendo las 3 × `03-3989GY`).
  - `pallet_dims[0].units = 12`.
  - `pallet_dims[0].edited_at = "2026-10-08T19:46:00Z"`.
- **Resultado en UI:** Ship no crea una 4.ª tarima fantasma; muestra las 3 tarimas reales con las medidas 46 × 82 asignadas a la tarima 1.

### Caso 2: DCV agrega bicis a mano mientras Ship está midiendo

- **Datos iniciales en DB:** Tarima 1 con medidas 46 × 82 pero sin `items` manuales.
- **Acción en DCV:** Picker abre `PalletBuilderModal` en la tarima 1 y asigna 10 bicis a mano. Llama a `patch_shipment_pallet(shipment_id, 1, {"items": [...10 bicis...], "units": 10, "edited_at": "..."})`.
- **Resultado esperado:**
  - En DB: La tarima 1 conserva `width_in: 46`, `height_in: 82` y adquiere los `items` asignados.
  - En Ship: Vía Realtime en `usePalletDims`, la tabla de Ship refleja los 10 items asignados a la tarima 1 sin borrar las medidas 46 × 82 que tenía en pantalla.

### Caso 3: Cifra de bicis tecleada y liberación de tarimas armadas (`builtToRelease`)

- **Datos iniciales en DB:** Tarima 1 armada a mano con 12 bicis (`items`).
- **Acción:** En Ship o DCV, el operador teclea la cifra `10` en la casilla de bicis.
- **Comportamiento:** `builtToRelease` detecta discrepancia (10 ≠ 12) y suelta la tarima armada.
- **Llamada de red:** `patch_shipment_pallet(shipment_id, 1, {"bikes": 10, "items": null, "edited_at": "..."})`.
- **Resultado esperado en DB:** `bikes = 10`, `items = null`. Las medidas existentes (`width_in`, `height_in`, `length_in`, `measured_at`) permanecen sin alteración.

### Caso 4: Recombinación o separación de envíos

- **Datos iniciales:** Envío con tarimas medidas y armadas a mano.
- **Acción:** El operador ejecuta combinar o separar órdenes vía `combine_into_shipment` o `split_from_shipment`.
- **Resultado esperado:**
  - En DB: Las RPCs reinician `pallet_dims = '[]'::jsonb`.
  - En UI: Tanto DCV como Ship reciben el evento Realtime, vacían las entradas locales y recalculan automáticamente con el motor unificado `planPallets`.

### Caso 5: Borrado voluntario de un eje de medida

- **Datos iniciales:** Tarima 1 con ancho 46 y alto 82.
- **Acción:** El operador borra el campo alto (deja el input en blanco).
- **Llamada de red:** `patch_shipment_pallet(shipment_id, 1, {"height_in": null})`.
- **Resultado esperado en DB:** `height_in` pasa a ser `null`, mientras que `width_in = 46` y los `items` se conservan intactos.

---

## 6. Análisis de riesgos

### 6.1. Operación offline / Pérdida momentánea de red en el almacén

- **Escenario:** Un teléfono pierde cobertura Wi-Fi en el pasillo norte mientras el picker edita la tarima 2.
- **Con el código actual:** Al volver la red, el teléfono enviaba el array completo con su foto vieja de hace 20 minutos, pisando cualquier cambio que Ship haya hecho entretanto en la tarima 1.
- **Con el parche atómico:** Al recuperar conexión, el debounce / retry envía únicamente el parche de la tarima 2 (`p_pallet: 2`). No toca las tarimas 1 ni 3.
- **Mitigación adicional:** El RPC comprueba que el envío siga existiendo y pertenezca a una orden no cancelada antes de aplicar la modificación.

### 6.2. Dos dispositivos editando la misma tarima simultáneamente

- **Edición de campos distintos (Operario A mide L/W/H; Operario B asigna bicis):**
  - Conflicto eliminado al 100 %. Como `p_patch` de A solo contiene dimensiones y `p_patch` de B solo contiene `items`, Postgres aplica ambos parches secuencialmente con `FOR UPDATE`. Ambos ganan sus respectivos campos.
- **Edición del mismo campo (Ambos teclean una altura distinta a la vez):**
  - Aplica Last-Write-Wins (LWW) en el orden en que Postgres procesa las transacciones. Prevalece la última llamada recibida por el servidor.

### 6.3. Discrepancia entre `units` e `items`

- **El problema de fondo:** `units` es un escalar que registra cuántas cajas tenía la tarima en el momento exacto de medir (su huella de vigencia). Si una pantalla desfasada mide una tarima que cree que tiene 9 cajas cuando en DB ya tiene 12, mandar `units: 9` en el parche degradaría la huella.
- **Protección implementada en el RPC (Sección 4):**
  Si la tarima en base de datos ya cuenta con `items` armados a mano, el RPC calcula y fuerza `units = sum(items.qty)`. De esta forma, una medida enviada desde una pantalla con cuenta desfasada jamás falsea la cuenta real de unidades de la tarima armada.

---

## 7. ❓ Preguntas abiertas para Rafael

- ❓ **1: Cálculo de `units` al medir cuando hay `items` a mano**  
  Al teclear dimensiones en Ship o DCV (`setAxis`), si la tarima ya fue armada a mano con `items` en la base de datos: ¿debe la base de datos forzar `units` igual a la suma real de los `items`, ignorando la cifra que mande la pantalla desfasada?  
  _(Respuesta por defecto: **Sí**. La suma de los `items` armados a mano en la base de datos es la verdad física de la tarima; una medida de cinta métrica no debe alterar la cuenta de unidades de lo armado)._

- ❓ **2: Ubicación de la suscripción Realtime**  
  ¿La suscripción Realtime a `table: 'shipments'` debe vivir centralizada dentro del propio hook `usePalletDims.ts`, o debe gestionarse en cada pantalla consumidora (`ShipScreen`, `DoubleCheckView`, `PickingSummaryModal`)?  
  _(Respuesta por defecto: **Dentro de `usePalletDims.ts`**. Así cualquier pantalla presente o futura que use el hook queda automáticamente sincronizada en tiempo real sin duplicar listeners)._

- ❓ **3: Borrado de campos vacíos**  
  Cuando un operario borra una medida y deja la casilla en blanco: ¿se envía `null` en el parche (`{"height_in": null}`) para mantener la regla de derivación donde `null` significa "no medido", o se prefiere un botón explícito de reinicio?  
  _(Respuesta por defecto: **Enviar `null` en el parche**. Un input vacío debe persistir `null` inmediatamente sin requerir botones extra, respetando el minimalismo de la interfaz)._
