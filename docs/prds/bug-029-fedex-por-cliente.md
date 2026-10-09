# Estudio: bug-029 — La regla de ≥ 5 bicis por cliente y dirección en lotes FedEx

**Fecha:** 8 de octubre de 2026  
**Repositorio:** `/Users/rafaellopez/dev/pickd-workspace/pickd` (`main` @ HEAD)  
**Modo:** Solo lectura estricto (análisis estático de código, migraciones y contratos; sin conexiones a BD ni uso de `PROD_DB_URL`).

---

## 0. Resumen y lo que NO se pudo verificar empíricamente

### Resumen ejecutivo

`bug-029` se originó con el caso `#881397` (9 sep 2026): una bicicleta de más de 50 lb nació fuera del lote FedEx por una regla de peso ya extinta (`classify_picking_list_fedex` descartaba > 50 lb; eliminada el 11 sep en `20260911154111`).  
Sin embargo, quedó vivo el defecto nuclear: **la suma de bicis cruzando clientes**.

- En la base de datos, la migración `20260926150613` ya restringe el cómputo de `auto_group_fedex_orders` a `customer_id` y `ship_to_address_id`.
- Pero en el cliente TypeScript (`useOrderGroups.ts:113-122`, regla 1 de `resolveMixedShippingType`), la función sigue sumando indiscriminadamente **todas las bicis de todos los miembros del lote**. En un lote FedEx de 5 órdenes de 1 bici de 5 clientes distintos, la suma da 5 bicis y fuerza a `regular` a todas las órdenes.
- Además, si una orden de un lote FedEx se reclasifica o se separa manualmente, no existe ningún mecanismo que recuerde el override manual; el siguiente INSERT de ese cliente vuelve a sobreescribirla a `regular`.

### Lo que NO se pudo verificar empíricamente sin tocar bases de datos

1. **Conteo real de lotes FedEx en producción hoy con órdenes convertidas erróneamente a Regular:**  
   No se ejecutaron consultas contra producción (`PROD_DB_URL` protegida).  
   _Consulta para verificar en prod:_
   ```sql
   SELECT og.id AS group_id, count(DISTINCT pl.customer_id) AS distinct_customers,
          count(*) AS order_count, sum((item->>'pickingQty')::numeric) AS total_bikes,
          array_agg(DISTINCT pl.shipping_type) AS shipping_types
   FROM order_groups og
   JOIN picking_lists pl ON pl.group_id = og.id
   CROSS JOIN jsonb_array_elements(pl.items) AS item
   LEFT JOIN sku_metadata sm ON sm.sku = item->>'sku'
   WHERE og.group_type = 'fedex' AND sm.is_bike = true AND pl.status NOT IN ('completed', 'cancelled')
   GROUP BY og.id
   HAVING count(DISTINCT pl.customer_id) > 1 AND 'regular' = ANY(array_agg(pl.shipping_type));
   ```
2. **Proceso local del daemon `watchdog-pickd`:** Corre como launchd en la MacBook externa de Bay 2; se auditó el contrato y las RPCs en este repo, pero no se ejecutó su código local.

---

## 1. Todos los caminos que hoy deciden FedEx vs Regular para un lote FedEx

Existen 7 caminos en el código de hoy que intervienen en clasificar o forzar FedEx/Regular sobre órdenes pertenecientes a un lote FedEx (o candidatas a entrar).

### Tabla comparativa de caminos

| #   | Componente / Función                               | Archivo : Línea                                                                                                                                                                                                                                                                                                            | Ámbito de evaluación                          | ¿Suma cruzando clientes?               | Efecto sobre la orden                                                                                                                                                               |
| --- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `resolveMixedShippingType` (Regla 1)               | [`src/features/picking/hooks/useOrderGroups.ts:113-122`](file:///Users/rafaellopez/dev/pickd-workspace/pickd/src/features/picking/hooks/useOrderGroups.ts#L113-L122)                                                                                                                                                       | Todo el `group_id`                            | **SÍ (CRUZA)**                         | Si la suma de bicis del grupo es ≥ 5, hace `UPDATE picking_lists SET shipping_type = 'regular' WHERE group_id = groupId`. Pasa a camión a todos los clientes del lote.              |
| 2   | `resolveMixedShippingType` (Regla 2)               | [`src/features/picking/hooks/useOrderGroups.ts:127-143`](file:///Users/rafaellopez/dev/pickd-workspace/pickd/src/features/picking/hooks/useOrderGroups.ts#L127-L143)                                                                                                                                                       | Todo el `group_id`                            | No suma, pero evalúa mezcla de tipos   | Si hay órdenes `fedex` y `regular`: si es un solo cliente convierte todo a `regular`; si hay > 1 cliente retorna `needs-prompt` (abre `ShippingResolutionModal`).                   |
| 3   | `autoClassifyShippingType`                         | [`src/utils/shippingClassification.ts:72-96`](file:///Users/rafaellopez/dev/pickd-workspace/pickd/src/utils/shippingClassification.ts#L72-L96)                                                                                                                                                                             | Orden individual o partida por `source_order` | **NO**                                 | Cuenta bicis de la orden (o de cada `source_order`). ≥ 5 bicis → `'regular'`; < 5 → `'fedex'`.                                                                                      |
| 4   | `isFedexOrder`                                     | [`src/utils/shippingClassification.ts:128-140`](file:///Users/rafaellopez/dev/pickd-workspace/pickd/src/utils/shippingClassification.ts#L128-L140)                                                                                                                                                                         | Orden individual                              | **NO directamente, pero hereda grupo** | Si `order_group.group_type === 'fedex'` (línea 136), retorna `true` ignorando si la orden tiene `shipping_type = 'regular'`.                                                        |
| 5   | `VerificationBoard` (Asignación de carril)         | [`src/features/picking/components/VerificationBoard.tsx:426-428`](file:///Users/rafaellopez/dev/pickd-workspace/pickd/src/features/picking/components/VerificationBoard.tsx#L426-L428) y [`L464-466`](file:///Users/rafaellopez/dev/pickd-workspace/pickd/src/features/picking/components/VerificationBoard.tsx#L464-L466) | Todo el `group_id` activo                     | **SÍ (PROPAGA)**                       | Si cualquier miembro del lote clasifica como `fedex`, `groupShippingType.set(group_id, 'fedex')`, arrastrando a todas las órdenes del lote al carril FedEx.                         |
| 6   | `auto_group_fedex_orders` (Trigger DB)             | [`supabase/migrations/20260926150613_auto_group_fedex_customer_scope.sql:71-108`](file:///Users/rafaellopez/dev/pickd-workspace/pickd/supabase/migrations/20260926150613_auto_group_fedex_customer_scope.sql#L71-L108)                                                                                                     | `customer_id` + `ship_to_address_id`          | **NO**                                 | Cuenta bicis del mismo cliente y dirección. Si suma ≥ 5: `NEW.shipping_type = 'regular'`, y actualiza las abiertas de ese cliente a `regular`, sacándolas del lote si no está held. |
| 7   | `classify_picking_list_fedex` (Función SQL)        | [`supabase/migrations/20260911154111_fedex_carries_any_weight.sql:21-55`](file:///Users/rafaellopez/dev/pickd-workspace/pickd/supabase/migrations/20260911154111_fedex_carries_any_weight.sql#L21-L55)                                                                                                                     | Items de una orden                            | **NO**                                 | Cuenta bicis de `p_items`. Si ≥ 5 bicis → `false` (regular); si < 5 → `true` (fedex).                                                                                               |
| 8   | `reevaluate_shipping_type_on_ungroup` (Trigger DB) | [`supabase/migrations/20260917161607_ungroup_never_reroutes_a_finished_order.sql:64-88`](file:///Users/rafaellopez/dev/pickd-workspace/pickd/supabase/migrations/20260917161607_ungroup_never_reroutes_a_finished_order.sql#L64-L88)                                                                                       | Miembros remanentes de `OLD.group_id`         | **SÍ (CRUZA)**                         | Si una orden sale de un grupo y el remanente del grupo suma < 5 bicis, actualiza a todos los miembros restantes a `fedex` y `order_groups.group_type = 'fedex'`.                    |

### Detalle de los caminos críticos que cruzan clientes

#### A. El culpable en el cliente: `resolveMixedShippingType` (`useOrderGroups.ts:113-122`)

```ts
// Rule 1: >= 5 combined bikes → force regular.
let totalBikes = 0;
for (const o of groupOrders) totalBikes += bikesIn(o);
if (totalBikes >= 5) {
  await supabase.from('picking_lists').update({ shipping_type: 'regular' }).eq('group_id', groupId);
  return 'auto-converted';
}
```

Invocado cada vez que se combinan órdenes o se interactúa con el grupo:

- `VerificationBoard.tsx:318` (tras combine manual)
- `VerificationBoard.tsx:700` (tras aceptar sugerencia de combine)
- `PickingCartDrawer.tsx:1444` (tras combine Add-On en el carrito)
- `QuickGroupModal.tsx:85` (tras agrupar completadas)

Al llamarse sobre un grupo FedEx (que por definición agrupa múltiples clientes con paquetes pequeños), suma las bicis de todos los clientes. En cuanto el lote acumula 5 bicicletas (ej. 5 clientes con 1 bici), **la regla 1 las convierte a todas a `shipping_type = 'regular'`**.

#### B. El culpable en el tablero: `VerificationBoard.tsx:426-428`

```ts
if (orderShippingTypes.get(order.id) === 'fedex') {
  groupShippingType.set(order.group_id, 'fedex');
}
```

En el Live Board, si una orden de un lote es FedEx, le contagia la propiedad `groupShippingType = 'fedex'` a todo el grupo. Como `isFedexOrder` prioriza `order_group.group_type === 'fedex'` sobre `shipping_type = 'regular'` (en `shippingClassification.ts:136`), una orden que la base ya marcó como `regular` se dibuja en el tablero como FedEx si permanece dentro del lote.

---

## 2. «Mismo cliente y dirección»: Qué llave usar de verdad

### ¿Qué hace la base de datos hoy? (`20260926150613`)

En la migración `20260926150613_auto_group_fedex_customer_scope.sql:83-84`:

```sql
WHERE pl.customer_id = NEW.customer_id
  AND pl.ship_to_address_id IS NOT DISTINCT FROM NEW.ship_to_address_id
```

La regla vigente utiliza estrictamente el par `(customer_id, ship_to_address_id)`:

1. `customer_id` vincula a la cuenta en la tabla `customers`.
2. `ship_to_address_id` vincula a la fila exacta en `customer_addresses` (tabla introducida en `20260403220000_customer_addresses.sql` y ampliada en `20260826230000_fedex_recipient_key.sql`).
3. El 98% de las órdenes (272 de 277 medidas en 30 días) traen `ship_to_address_id` seteado directamente por el watchdog desde el encabezado AS400.
4. El operador `IS NOT DISTINCT FROM` garantiza que si ambas órdenes tienen `ship_to_address_id IS NULL`, se consideran la misma dirección (la predeterminada del cliente); si una tiene ID y la otra NULL, son consideradas distintas.

### ¿Por qué no usar el nombre de cliente o la cadena de texto de la calle?

1. **Nombre de cliente (`customers.name`):**  
   En `picking_lists` **no existe columna de nombre de cliente**. Solo existe `customer_id`. Los nombres viajan por join a `customers(name)`. Además, en `customers` pueden existir nombres con variaciones menores ("BIKE SHOP LLC" vs "BIKE SHOP"). La fuente de verdad del cliente en el modelo de PickD es `customer_id`.
2. **Dirección física en texto:**  
   La tabla `customer_addresses` tiene una columna generada:  
   `normalized_address = lower(trim(street)) || '|' || lower(trim(city)) || '|' ...` con constraint `UNIQUE(customer_id, normalized_address)`.  
   Esto significa que **para un mismo `customer_id`, cada dirección física única tiene un único `ship_to_address_id`**. No pueden existir dos filas de dirección idénticas para el mismo cliente.

### Definición canónica única (para cliente y base)

> **Llave canónica de cliente y dirección:**  
> **`pl.customer_id = target.customer_id AND pl.ship_to_address_id IS NOT DISTINCT FROM target.ship_to_address_id`**  
> _(con `customer_id IS NOT NULL`)._

Tanto en SQL como en TypeScript (`useOrderGroups`, `combineConflicts`, `VerificationBoard`), el ámbito debe evaluarse por esta tupla exacta.

---

## 3. «Se separa en un grupo diferente al FedEx»: Mecánica operativa y resolución de conflictos

### A. La frontera estricta: Lote de picking (`order_groups`) vs Envío físico (`shipments`)

Desde el 27 de septiembre de 2026 (`20260927011500_explicit_shipments.sql`, regla documentada en `rules/ship.md:200-212`):

- **`shipments` manda sobre el envío físico:** Cada orden que entra nace con su propio `shipment_id` (`ensure_order_shipment`). Un lote FedEx reúne órdenes de clientes distintos; **ninguna orden de un lote FedEx comparte `shipment_id`**.
- **`order_groups` (`group_id`) es solo el lote de trabajo:** Sirve para que el picker/verificador abra un solo carrito en Double Check y recoja varios paquetes chicos de una sola pasada.
- **Separar del lote FedEx significa modificar `group_id`**, nunca tocar `shipment_id`.

### B. El candado operativo: `group_is_held`

La función canónica `group_is_held(group_id)` (`20260909233836`) retorna `TRUE` si algún miembro del grupo:

- Tiene `checked_by IS NOT NULL`
- Está en estado `double_checking`
- O tiene marcas activas (`verified_item_keys` no vacío).

**Regla obligatoria:**  
Si un grupo está en las manos de alguien (`group_is_held = true`):

1. El `shipping_type = 'regular'` **se aplica de inmediato** en la fila (para que el sistema y el embarque sepan que el pedido va por camión).
2. La separación del `group_id` **se posterga** (se mantiene el `group_id` actual) para no partir la tarjeta ni el carrito del verificador en plena faena.
3. Solo cuando el grupo deja de estar en reposo o se desocupa, se efectúa la separación.

### C. Conflicto con las reglas vigentes: ¿Forman grupo `general` y se combinan en un solo `shipment`, o solo salen a Regular?

Rafael indicó el 8 de octubre:

> _«...se convierte en Regular y se separa en un grupo diferente al fedex automáticamente si es que tiene mismo nombre y dirección... Y siempre se puede manualmente convertir a fedex y separar su combinación también.»_

Aquí surge un conflicto directo con la regla de negocio del 9 y 26 de septiembre:

- **Regla del 9 y 26 de septiembre (`picking.md:264-265`, `ship.md:208-212`):**  
  _«Decidir que dos órdenes son un envío es una decisión de negocio y la toma una persona con Combine... El envío cambia sólo cuando una persona combina o separa con combine_into_shipment / split_from_shipment»._  
  La combinación física de dos envíos requiere validar conflictos de dirección, transportista y número de carga (`load_number`), y además vacía las medidas de tarima (`pallet_dims = '[]'`). Si la base combinara envíos automáticamente vía trigger, podría fallar con excepciones (`P0004`, `P0005`) o alterar tarimas sin supervisión.
- **La frase de Rafael ("se separa en un grupo diferente al fedex... y separar su combinación también"):**  
  Sugiere que las ≥ 2 órdenes del cliente no deben quedar como órdenes sueltas, sino juntas en su propio lote de trabajo regular.

#### ❓ Pregunta para Rafael (con default operativo)

> **Decisión requerida sobre la separación automática de ≥ 2 órdenes del mismo cliente y dirección:**
>
> - **Opción 1 (Recomendada - Default): Lote de picking compartido (`general`), pero envíos físicos independientes.**  
>   Las órdenes salen del lote FedEx y se agrupan entre sí en un nuevo `order_groups` (`group_type = 'general'`). Comparten carrito de picking y una sola tarjeta en el board, pero sus `shipment_id` permanecen independientes. En Ship se cotizan o miden por separado hasta que el operador decida fusionar el envío con "Combine with #...". Si el operador decide separarlas, sólo deshace el grupo de picking sin reescribir envíos.
> - **Opción 2: Combinación completa automática (`general` + `combine_into_shipment`).**  
>   El sistema las agrupa en un grupo `general` y además fusiona sus envíos en un solo `shipment_id` con `combine_into_shipment`.  
>   _Riesgo:_ Si difiere el BOL o instrucciones, el trigger fallaría o forzaría un BOL arbitrario. Rompe la regla de que la combinación física siempre la decide un humano.
> - **Opción 3: Salen como órdenes sueltas independientes (`group_id = NULL`), ambas Regular.**  
>   No forman ningún grupo automático. El Live Board muestra la pastilla sugerida "Combine with #..." para que el operador decida con un toque si las junta.

### D. Caso de UNA sola orden con ≥ 5 bicis

Si un cliente tiene **una sola orden** que por sí misma tiene ≥ 5 bicis (o entra una orden de 5 bicis):

- Pasa a `shipping_type = 'regular'`.
- Sale del lote FedEx: `group_id = NULL`.
- No se crea ningún grupo nuevo (un grupo requiere ≥ 2 órdenes). Queda como orden individual Regular.

---

## 4. El override manual: Cómo proteger la decisión de volver a FedEx

### El fallo actual en el código

Hoy, si una orden fue reclasificada automáticamente a `regular` y el operador la convierte manualmente a FedEx usando `ShippingTypeToggle.tsx:64-78`:

1. El toggle ejecuta:  
   `UPDATE picking_lists SET shipping_type = 'fedex' WHERE id = listId;`
2. Si el operador luego separa la orden vía `useOrderSplit.ts:281-285`:  
   Se asegura `shipping_type = 'fedex'` y `transport_company = 'FEDEX'`.
3. **El fallo ocurre al llegar el siguiente evento:**  
   Cuando entra una nueva orden del mismo cliente (o un re-escaneo del AS400), se dispara el trigger `auto_group_fedex_orders` (`20260926150613:102-108`):
   ```sql
   UPDATE picking_lists
   SET shipping_type = 'regular', ...
   WHERE customer_id = NEW.customer_id
     AND ship_to_address_id IS NOT DISTINCT FROM NEW.ship_to_address_id
     AND (shipping_type = 'fedex' OR (shipping_type IS NULL AND classify_picking_list_fedex(...)));
   ```
   Como la orden forzada a mano tiene `shipping_type = 'fedex'`, la cláusula `shipping_type = 'fedex'` **hace match y la vuelve a sobreescribir a `regular` de inmediato**. El override manual se borra sin avisar.

### Diseño para recordar la decisión manual

Para que la regla automática respete la decisión del usuario, la base de datos debe distinguir entre una clasificación automática y un candado manual.

**Solución limpia y aditiva:**  
Agregar a `picking_lists` la columna:

```sql
ALTER TABLE public.picking_lists
  ADD COLUMN IF NOT EXISTS shipping_type_manual boolean NOT NULL DEFAULT false;
```

- Cuando `ShippingTypeToggle` o el modal de split establecen el tipo de envío, actualizan:
  `{ shipping_type: next, shipping_type_manual: true }`.
- En `auto_group_fedex_orders`, la condición del `UPDATE` inverso se protege:
  ```sql
  WHERE customer_id = NEW.customer_id
    AND ship_to_address_id IS NOT DISTINCT FROM NEW.ship_to_address_id
    AND shipping_type_manual IS NOT TRUE  -- <-- CANDADO DE PROTECCIÓN
    AND (shipping_type = 'fedex' OR shipping_type IS NULL);
  ```
- Si `NEW` entra con `shipping_type_manual IS TRUE`, la regla no la toca.

---

## 5. Diseño propuesto

### A. Un solo lugar para la regla

La regla de negocio reside exclusivamente en la base de datos PostgreSQL:

1. `auto_group_fedex_orders()` es el único que decide la auto-agrupación y la reclasificación por cliente y dirección.
2. Se **elimina** de `useOrderGroups.ts` (`resolveMixedShippingType`) la Regla 1 que sumaba a todos los miembros del grupo.
3. El cliente (Live Board, Carrito, Ship) lee `shipping_type` persistido directamente de la fila y respeta la asignación de la base de datos.

### B. Migración aditiva propuesta

1. Columna `shipping_type_manual boolean NOT NULL DEFAULT false` en `picking_lists`.
2. Actualización de `auto_group_fedex_orders()`:
   - Suma bicis exclusivamente para `pl.customer_id = NEW.customer_id AND pl.ship_to_address_id IS NOT DISTINCT FROM NEW.ship_to_address_id AND pl.status NOT IN ('completed', 'cancelled')`.
   - Si `(v_new_bikes + v_total_bikes) >= 5`:
     - `NEW.shipping_type := 'regular'; v_is_fedex := false;`
     - Actualiza las órdenes abiertas del cliente (donde `shipping_type_manual IS NOT TRUE`):
       - `shipping_type = 'regular'`
     - Manejo de grupo para el cliente (según Default de ❓):
       - Si el grupo actual no está held (`NOT group_is_held(group_id)`):
         - Si son ≥ 2 órdenes en total para este cliente: crea un `order_groups` de tipo `'general'` y asigna esas órdenes a ese nuevo grupo (separándolas del lote FedEx).
         - Si es 1 sola orden: `group_id = NULL`.
       - Si está held (`group_is_held(group_id) = true`): conserva `group_id` temporalmente hasta que se libere el candado.
3. Actualización de `reevaluate_shipping_type_on_ungroup()`:
   - Al salir una orden de un grupo `fedex`, no revalida el remanente sumando entre clientes distintos.

### C. Cambios en el frontend (TypeScript)

1. **`src/features/picking/hooks/useOrderGroups.ts` (`resolveMixedShippingType`):**
   - Eliminar las líneas 113-122 (la suma ciega de todas las bicis del grupo).
   - Si el grupo es de tipo `fedex`, retornar `'none'` de inmediato: los lotes FedEx son multi-cliente y la base de datos ya maneja sus clasificaciones.
2. **`src/features/picking/components/ShippingTypeToggle.tsx`:**
   - En la mutación (línea 66), incluir `shipping_type_manual: true`.
3. **`src/features/picking/components/VerificationBoard.tsx`:**
   - En las líneas 426-428, evitar que un grupo de tipo `fedex` contagie `groupShippingType = 'fedex'` a miembros que tienen `shipping_type = 'regular'`.

---

## 6. Casos de prueba con cifras exactas

### Caso (a): 5 clientes × 1 bici en un lote FedEx

- **Estado inicial:** Un lote FedEx contiene 4 órdenes de 1 bici cada una, de 4 clientes distintos (A, B, C, D).
- **Evento:** Entra la orden 5 del cliente E con 1 bici.
- **Resultado esperado:**
  - Cliente E suma 1 bici (< 5).
  - La suma del lote es 5 bicis, pero ningún cliente individual alcanza el umbral.
  - La orden E entra al lote FedEx (`shipping_type = 'fedex'`, `group_id = lote`).
  - **Nadie cambia a Regular.** Todos siguen en FedEx.

### Caso (b): Cliente X con 3 + 2 bicis en 2 órdenes, misma dirección, en el lote

- **Estado inicial:** El lote FedEx contiene 3 órdenes de 1 bici de clientes A, B, C, más la orden #1 del cliente X con 3 bicis (dirección 100 Main St).
- **Evento:** Entra la orden #2 del cliente X con 2 bicis para la misma dirección (100 Main St).
- **Resultado esperado:**
  - Cliente X suma 3 + 2 = 5 bicis (≥ 5).
  - Ambas órdenes de X pasan a `shipping_type = 'regular'`.
  - Las 2 órdenes de X se separan del lote FedEx:
    - Según Opción 1 (Default): Pasan a un nuevo grupo de picking `general` propio (ej. `group_id = G_X`), con sus envíos independientes.
  - Las órdenes de A, B, C permanecen en el lote FedEx con `shipping_type = 'fedex'`.

### Caso (c): Cliente X con 3 + 2 bicis en 2 órdenes, pero DIFERENTE dirección

- **Estado inicial:** Orden #1 de X con 3 bicis para Bodega Norte (`ship_to_address_id = ADDR_1`).
- **Evento:** Entra la orden #2 de X con 2 bicis para Bodega Sur (`ship_to_address_id = ADDR_2`).
- **Resultado esperado:**
  - Bodega Norte tiene 3 bicis (< 5). Bodega Sur tiene 2 bicis (< 5).
  - Como `pl.ship_to_address_id IS NOT DISTINCT FROM NEW.ship_to_address_id` no coincide, **no se suman**.
  - Ambas órdenes permanecen en `fedex` dentro del lote FedEx. **Nadie cambia a Regular.**

### Caso (d): Cliente X forzado a FedEx a mano

- **Estado inicial:** Cliente X tiene una orden #1 de 3 bicis marcada manualmente como FedEx (`shipping_type = 'fedex'`, `shipping_type_manual = true`).
- **Evento:** Entra una orden #2 de X con 3 bicis (total = 6 bicis).
- **Resultado esperado:**
  - La orden #2 se evalúa: al sumar 6 bicis, la orden #2 pasa a `regular`.
  - Pero la orden #1 tiene `shipping_type_manual = true`: el trigger respeta el candado y **NO la sobreescribe**. La orden #1 sigue siendo FedEx.

### Caso (e): Lote con alguien verificando (`group_is_held`)

- **Estado inicial:** Lote FedEx en proceso de verificación por Jed (`checked_by = Jed`, o `verified_item_keys` contiene marcas). El lote incluye la orden #1 de X (3 bicis).
- **Evento:** Entra la orden #2 de X (2 bicis, misma dirección).
- **Resultado esperado:**
  - Cliente X suma 5 bicis.
  - La orden #1 y la orden #2 de X reciben de inmediato `shipping_type = 'regular'`.
  - Como `group_is_held` es `TRUE`, la orden #1 **conserva su `group_id` temporalmente** para no interrumpir el carrito de Jed.
  - Cuando Jed completa el lote o libera la sesión, se disuelve el enlace.

---

## 7. Tamaño y Riesgos

### Tamaño: **M** (Mediano, 1 sesión de trabajo)

- **Migración SQL (~80 líneas):** Adición de `shipping_type_manual`, actualización de `auto_group_fedex_orders` y `reevaluate_shipping_type_on_ungroup`.
- **Frontend (~30 líneas modificadas):** Limpieza de `resolveMixedShippingType` en `useOrderGroups.ts`, ajuste en `ShippingTypeToggle.tsx`, `useOrderSplit.ts` y `VerificationBoard.tsx`.
- **Tests:** Actualización de casos en `shippingClassification.test.ts` y script SQL de validación con rollback.

### Riesgos y mitigaciones

1. **Error Postgres 27000 (`tuple to be updated was already modified`):**  
   Si el trigger BEFORE INSERT intenta actualizar múltiples filas de `picking_lists` a la vez mientras otro trigger BEFORE (`reevaluate_shipping_type_on_ungroup`) está escuchando, Postgres lanza el error 27000.  
   _Mitigación:_ Toda reasignación de `group_id` en triggers debe ejecutarse estrictamente fila por fila con un cursor `FOR ... IN SELECT ... LOOP`, tal como se implementó en `cancel_combined_order` y `combine_into_shipment`.
2. **Desincronización de Shipments si se eligiera Opción 2 de ❓:**  
   Si se fusionaran envíos automáticamente sin confirmación de dirección ni BOL, reventarían constraints UNIQUE en `shipments.load_number`.  
   _Mitigación:_ Adoptar el Default de la Opción 1: solo crear lote de picking `general`, dejando la combinación de envíos intacta.

---

## Decisiones (Rafael, 8 oct 2026, noche)

1. **Separar = grupo `general` + un solo envío** (Opción 2 de §3.C, no el default): las ≥ 2 órdenes del
   mismo `customer_id` y `ship_to_address_id` que pasan a Regular salen del lote FedEx, forman su
   propio grupo `general` y sus envíos se fusionan con `combine_into_shipment`.
2. **Candado manual** (`shipping_type_manual`, §4): el toggle FedEx/Regular y el modal de separar lo
   marcan; la regla automática no vuelve a tocar esas órdenes.
