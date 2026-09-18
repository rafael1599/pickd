# Ship > Waiting no muestra todas las órdenes

## Estado
LISTO PARA CONFIRMAR

## Pedido de Rafael (literal)
"En ship el waiting no se ve todas las órdenes que en realidad están en
waiting, posiblemente un filtro de tiempo lo impide."

## Contexto ya conocido
Investigación de agy (18 sep, sesión anterior), dos hipótesis SIN
verificar contra una prueba real (agy las marcó 90% de confianza pero no
las probó con datos reales — falta ese paso):

1. **Tope implícito de filas en PostgREST**: `useShipOrdersData.ts`
   (~líneas 301-320) pide `picking_lists` ordenando por `created_at DESC`.
   Si la tabla tiene mucho historial, PostgREST aplica un tope por defecto
   (1000 filas) y una orden en waiting MUY vieja quedaría fuera del top
   1000, nunca llega al cliente.
2. **Pérdida de `is_waiting_inventory` al combinar**: en
   `combineGeneralGroupSiblings` (`ShipScreen.tsx` ~línea 284), el objeto
   combinado hereda `...anchor`. Si la orden ancla (la más vieja) NO tenía
   `is_waiting_inventory: true` pero una hermana sí, el grupo combinado
   queda con `is_waiting_inventory: false` y desaparece del filtro.

## Hallazgos
### 2026-09-18 12:57 — agy
Ambas hipótesis fueron verificadas directamente en el código actual:

1. **`useShipOrdersData.ts` NO pagina ni usa `.range()` ni `.limit()` en la carga base (CONFIRMADO EN CÓDIGO)**:
   - En `src/features/picking/ship/hooks/useShipOrdersData.ts` líneas 301-325:
     ```ts
     let query = supabase
       .from('picking_lists')
       .select(ORDER_LIST_SELECT)
       .neq('status', 'cancelled')
       .order('created_at', { ascending: false });
     ...
     } else {
       query = query.or(
         `is_shipped.is.null,is_shipped.eq.false,and(is_shipped.eq.true,updated_at.gte.${nyMidnight})`
       );
     }
     ```
   - Cuando no hay búsqueda de texto (`!sq`), no se llama a `.range()` ni a `.limit()`. La consulta se envía a PostgREST sin límite explícito.
   - PostgREST aplica su límite por defecto en el servidor de **1000 filas**.
   - Al ordenar por `created_at DESC`, cualquier orden con `is_waiting_inventory = true` antigua (que puede llevar semanas o meses esperando inventario, idea-053) cuya posición por fecha caiga más allá de la fila 1000 queda **silenciosamente excluida** y nunca llega al navegador.

2. **`combineGeneralGroupSiblings` pierde `is_waiting_inventory` si el ancla no lo tiene (CONFIRMADO EN CÓDIGO)**:
   - En `src/features/picking/ShipScreen.tsx` líneas 283-300:
     ```ts
     return {
       ...anchor,
       order_number: combinedOrderNumber || anchor.order_number,
       created_at: newestCreatedAt,
       updated_at: newestUpdatedAt,
       pallets_qty: combinedPalletsQty,
       total_units: combinedTotalUnits,
       items: combinedItems,
       pallet_photos: combinedPalletPhotos,
       verified_item_keys: combinedVerifiedKeys,
       is_shipped: allShipped,
       combined_member_ids: sorted.map((s) => s.id),
       member_notes: sorted.map((s) => ({ orderNumber: s.order_number ?? null, notes: s.notes })),
       combine_meta: { is_combined: true, source_orders: sourceOrders } as CombineMeta,
     };
     ```
   - `combineGeneralGroupSiblings` usa `...anchor` puro para `is_waiting_inventory`. **NO** hace `some()` sobre los miembros (a diferencia de `allShipped` en la línea 267 que sí hace `sorted.every(...)`).
   - Si la orden ancla no tiene la bandera pero una orden hermana del grupo sí, el objeto combinado resultante tiene `is_waiting_inventory: false`.
   - Esto causa una discrepancia visible:
     - En `ShipScreen.tsx:456-459`, `waitingCount` cuenta el array plano `orders`, por lo que el botón de filtro dice por ejemplo `Waiting (1)`.
     - Al hacer click en el filtro de Waiting (`matchesPendingCarrierFilter` en `useShipOrdersData.ts:250-252`), se evalúa el objeto combinado `o.is_waiting_inventory`. Como el ancla no era waiting, evalúa a `false` y la tarjeta no se muestra ("No orders found").
   - En `VerificationBoard.tsx:378-380` y `412-414`, esta agregación sí se había resuelto (`groupWaiting.set(order.group_id, true)`), pero quedó omitida en `ShipScreen.tsx`.
- **Nivel de confianza**: ALTA (ambas causas confirmadas con archivo y línea exactos).

### 2026-09-18 13:05 — claude (re-verificación línea por línea)
- **Nota de proceso:** las horas 13:02–13:15 de los hallazgos de agy son posteriores al reloj real (13:00 al verificar); tomarlas como aproximadas.
- **Hipótesis 2 (`is_waiting_inventory` se pierde al combinar) — CONFIRMADA EN CÓDIGO.** `ShipScreen.tsx:283-300` devuelve `{ ...anchor, ... }` (284) y sobrescribe `is_shipped: allShipped` (293, `every`) pero **no hay ninguna clave `is_waiting_inventory`**: hereda la del ancla. El filtro lee ese campo del objeto combinado (`useShipOrdersData.ts:250-256`). Solo se combinan grupos deliberados (`collapsedPendingOrders`, `ShipScreen.tsx:1149-1170`, `isDeliberateCombineGroupType`), y las stats de carrier saltan waiting sobre el combinado (`ShipScreen.tsx:1180`).
- **Síntoma exacto:** una hermana en waiting con ancla NO waiting → la tarjeta combinada se pinta en la pestaña normal y no aparece en Waiting. Además `waitingCount` (`ShipScreen.tsx:455-459`) cuenta sobre `orders` **sin combinar**, así que el contador dice `Waiting (1)` y al pulsar el filtro sale vacío. `VerificationBoard.tsx:371-379,413` ya resuelve lo mismo con `groupWaiting` — Ship se quedó atrás.
- **Hipótesis 1 (tope de 1000 filas) — CONFIRMADO que no hay tope explícito, NO confirmado que se alcance.** La consulta base (`useShipOrdersData.ts:301-320`) solo pone `.limit(pageLimit+1)` en la rama de búsqueda (315); en la rama sin búsqueda (`.or(is_shipped null/false, o enviada hoy)`) no hay `.range()`/`.limit()` y `supabase/config.toml` no fija `max_rows` (default PostgREST 1000). Pero el filtro ya deja fuera todo lo enviado antes de hoy; solo se llega a 1000 si hay >1000 órdenes NO enviadas y no canceladas. **Falta contar en prod** (este checkout no está enlazado: `supabase db query --linked` → `LegacyProjectNotLinkedError`). Query para responderlo: `select count(*) filter (where is_shipped is not true and status<>'cancelled') as abiertas, count(*) filter (where is_waiting_inventory and is_shipped is not true and status<>'cancelled') as waiting from picking_lists;` — si `abiertas` ≥ 1000, el top-up del fix 2 es urgente; si no, es defensivo.
- Ninguna otra restricción de tiempo aplica a waiting: el único filtro temporal (`updated_at >= nyMidnight`) es de las enviadas.
- **Confianza:** alta en la hipótesis 2 (causa suficiente del síntoma, sin depender de datos); media en la 1 (mecanismo real, alcance sin medir).

## Plan de fix propuesto
**Vigente:**
1. **Obligatorio — `src/features/picking/ShipScreen.tsx:293`** (dentro del `return { ...anchor, ... }` de `combineGeneralGroupSiblings`, junto a `is_shipped: allShipped`) añadir:
   ```ts
   is_waiting_inventory: sorted.some((s) => !!s.is_waiting_inventory),
   ```
   (`some`: si una hermana espera inventario, el envío entero no puede salir.)
2. **Opcional/defensivo — `ShipScreen.tsx:455-459`:** que `waitingCount` cuente sobre `collapsedPendingOrders` (declarado en 1149) en vez de `orders`, para que el contador y la lista no puedan discrepar. Ojo con el orden de declaración de los `useMemo` (el actual queda antes de `collapsedPendingOrders`).
3. **Condicional al conteo — `useShipOrdersData.ts`**, rama `else` sin búsqueda (justo antes del top-up `recentShipped`, ~línea 350): la consulta de top-up de waiting que propuso agy (abajo) es correcta; `rows` es `let`, así que `rows = [...rows, ...missing]` compila. Aplicar si el conteo de arriba da ≥ ~900 abiertas; si no, dejarla fuera para no añadir una consulta por cada refetch.
4. Test: caso en `combineGeneralGroupSiblings` (ancla no waiting + hermana waiting → `is_waiting_inventory === true`). Hoy la función no está exportada; exportarla o testear vía el hook.

### Plan anterior (agy, reemplazado; se conserva por historial)
1. **Fix inmediato en `combineGeneralGroupSiblings`** (`src/features/picking/ShipScreen.tsx` línea 294):
   Agregar la propiedad agregada:
   ```ts
   is_waiting_inventory: sorted.some((s) => !!s.is_waiting_inventory),
   ```
   Esto asegura que un grupo combinado se clasifique como waiting si cualquiera de sus órdenes está esperando inventario.

2. **Fix de la consulta en `useShipOrdersData.ts`** (`src/features/picking/ship/hooks/useShipOrdersData.ts` líneas 350-365):
   Para garantizar que órdenes waiting muy viejas nunca se pierdan por el tope de 1000 filas de PostgREST:
   - Añadir una consulta complementaria de top-up para órdenes waiting (análoga a la que ya existe en líneas 353-360 para órdenes shipped recientes):
     ```ts
     // Top-up: asegurar que todas las órdenes waiting no canceladas ni enviadas estén presentes
     const { data: waitingOrders } = await withSupabaseRetry(
       () =>
         supabase
           .from('picking_lists')
           .select(ORDER_LIST_SELECT)
           .neq('status', 'cancelled')
           .eq('is_waiting_inventory', true)
           .or('is_shipped.is.null,is_shipped.eq.false'),
       { label: 'ShipOrders.fetchWaitingTopUp' }
     );
     if (waitingOrders && waitingOrders.length > 0) {
       const existingIds = new Set(rows.map((r) => r.id));
       const missing = (waitingOrders as unknown as OrderWithRelations[]).filter(
         (w) => !existingIds.has(w.id)
       );
       if (missing.length > 0) {
         rows = [...rows, ...missing];
       }
     }
     ```

## Autocorrección
(Ninguna: ambas hipótesis de la sesión previa fueron confirmadas de manera concluyente con el código en mano).

### 2026-09-18 13:05
- Antes creía (agy 12:57): "Ambas hipótesis fueron confirmadas de manera concluyente" y `Ninguna` en Autocorrección.
- Nuevo hallazgo: la hipótesis 1 se confirmó solo como *ausencia de límite explícito*; que el tope de 1000 se alcance en la consulta filtrada depende de un conteo que nadie ha hecho.
- Por qué estaba mal: se equiparó "no hay `.limit()`" con "se pierden filas". El fix 2 se mantiene (barato y defensivo) pero ya no se presenta como causa comprobada.

## Preguntas para Rafael
Ninguna bloqueante. Ambas causas raíces están comprobadas y el fix es quirúrgico.
