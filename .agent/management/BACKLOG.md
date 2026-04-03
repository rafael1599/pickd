# PickD — Backlog de Mejoras

> Mejoras pendientes ordenadas por impacto en el usuario final.
> Actualizado: 2026-04-02
>
> **Formato:** cada item incluye `[fecha hora]` de creación para trazabilidad y `<!-- id: xxx -->` para tracking.
> **Single source of truth** — no editar BACKLOG.md en la raíz del proyecto (es un puntero a este archivo).

---

## Prioridad 1 — Impacto Alto (operación diaria / integridad de datos)

### ~~1. Combinar órdenes del mismo shop~~ — COMPLETADO `[2026-03-18]` `adff48e` <!-- id: task-007 -->
### ~~2. Agrupación visual de órdenes FedEx/General~~ — COMPLETADO `[2026-03-25]` `adff48e` <!-- id: idea-010b -->
### ~~3. Distribución física inteligente~~ — COMPLETADO `[2026-03-25]` `d46d137` <!-- id: idea-015 -->
### ~~4. Prevenir reserva duplicada en watcher~~ — COMPLETADO `[2026-03-26]` `221d057` <!-- id: idea-021 -->
### ~~5. Filtro de bike bins en Stock View~~ — COMPLETADO `[2026-03-26]` `91d0005` <!-- id: idea-022 -->
### ~~6. Fotos de items (SKU metadata) Fase 1+2~~ — COMPLETADO `[2026-03-26]` `a227d99` <!-- id: idea-023 -->
### ~~7. Warehouse Selection Refinement~~ — COMPLETADO <!-- id: task-005 -->
### ~~10. Preservar internal_note en moves~~ — COMPLETADO `[2026-03-25]` `5e84c88` <!-- id: idea-017 -->
### ~~11. Override cantidad por pallet~~ — COMPLETADO `[2026-03-24]` `bd17608` <!-- id: idea-018 -->
### ~~12. Peso de pallets en peso total del label~~ — COMPLETADO `[2026-03-24]` `5ace2da` <!-- id: idea-019 -->
### ~~13. Auto-parse de dirección completa~~ — COMPLETADO `[2026-03-24]` `30bfcb7` <!-- id: idea-020 -->

### 8. Sub-locations alfabéticas por ROW <!-- id: idea-024 -->

- **Creado:** `[2026-03-26 17:00]`
- **Estado:** Por hacer.
- **Problema:** Las ROWs son un espacio largo sin subdivisiones. Un picker que busca un SKU en "ROW 5" tiene que recorrer toda la fila. Con 30+ bikes por ROW, encontrar un item específico es lento e impreciso.
- **Solución:** Nueva columna `sublocation` (varchar, nullable) en la tabla `inventory`. Representa una sección alfabética dentro del ROW: A, B, C, etc.
  - `inventory.location = "ROW 5"` (no cambia)
  - `inventory.sublocation = "A"` (nuevo campo)
  - Display combinado en UI: `ROW 5A`
  - Items sin sublocation (`NULL`) siguen funcionando — backward compatible
- **Diseño técnico:**
  1. Migración: `ALTER TABLE inventory ADD COLUMN sublocation varchar(2)` — nullable, sin default
  2. Schema Zod: agregar `sublocation: z.string().max(2).optional()` a `inventory.schema.ts`
  3. Frontend display: concatenar `{location}{sublocation}` en InventoryCard, PickingSessionView, DoubleCheckView
  4. InventoryModal: nuevo campo input para sublocation (1-2 chars uppercase, validación client-side)
  5. AutocompleteInput: al seleccionar location "ROW 5", ofrecer sub-locations existentes (A, B, C...)
  6. Picking path: ordenar por location (ROW number) → sublocation (A, B, C) para ruta óptima
  7. `locationUtils.ts`: smart mapping `"5A"` → location=`"ROW 5"`, sublocation=`"A"`
  8. Realtime: `useInventoryRealtime.ts` ya escucha `inventory.*` — sublocation se propaga automáticamente
  9. Watcher: `_to_cart_items()` ya lee `location` de inventory — agregar `sublocation` al cart item
- **Criterios de aceptación:**
  - Se puede asignar sublocation A-Z a cualquier item en un ROW
  - Display muestra `ROW 5A` en todos los contextos (Stock View, Picking, Double Check, Labels)
  - Items sin sublocation muestran solo `ROW 5` — no se rompe nada existente
  - Picking path ordena por ROW → sublocation (A antes que B)
  - AutocompleteInput sugiere sub-locations existentes del ROW seleccionado
  - El watcher propaga sublocation al asignar locations

### 9. Multi-Address Customers <!-- id: idea-012 -->

- **Creado:** `[2026-03-26 17:00]` (promovido de P2)
- **Estado:** Por hacer.
- **Problema:** Cada customer tiene una sola dirección en la tabla `customers`. Si un cliente envía a Miami y después a NYC, hay que editar la dirección o crear un duplicado "Cliente (NYC)". No hay historial de direcciones anteriores.
- **Solución:** Nueva tabla `customer_addresses` con FK a `customers`. Cada customer puede tener N direcciones con un label descriptivo.
- **Diseño técnico:**
  1. Nueva tabla `customer_addresses`:
     - `id` (uuid PK), `customer_id` (FK → customers), `label` (text — "Main Warehouse", "Miami Office")
     - `street`, `city`, `state`, `zip_code` (text)
     - `is_default` (boolean — una sola default por customer)
     - `created_at` (timestamp)
  2. Migración de datos: copiar direcciones de `customers` → `customer_addresses` con `is_default = true`
  3. Nueva columna `shipping_address_id` en `picking_lists` (FK → `customer_addresses`)
  4. Columnas legacy en `customers` (street, city, state, zip_code) se mantienen temporalmente como fallback
- **Impacto en frontend:**
  - CustomerAutocomplete: al seleccionar customer con >1 dirección → selector de dirección
  - OrderSidebar: dropdown de direcciones del customer + botón "New address"
  - OrdersScreen save flow: guardar `shipping_address_id` en picking_list
  - Crear nueva dirección inline sin salir del flujo de orden
- **Impacto en watcher:**
  - `_resolve_customer()` usa la dirección `is_default` al crear órdenes desde PDF
  - No requiere cambios si el PDF no trae dirección (la default se usa)
- **Criterios de aceptación:**
  - Un customer puede tener múltiples direcciones con labels
  - Al seleccionar customer en una orden, se puede elegir qué dirección usar
  - Hay una dirección default (`is_default`)
  - Direcciones existentes se migran automáticamente como default
  - El watcher usa la dirección default al crear órdenes automáticamente
  - El label aparece en el dropdown para diferenciar direcciones

### 20. Picking session hardening — 6 cambios (inline correction + safety fixes) <!-- id: fix-002 -->

- **Creado:** `[2026-04-01 16:00]`
- **Estado:** COMPLETADO `[2026-04-02]` — safety fixes + Edit Order mode reemplaza inline correction.
- **Resuelve:** bug-011, siblings huérfanos en grupos, race condition loadSession, debounce timer leak.
- **Documentación:** `docs/picking-session-flow.md` — state machine, workflow lock, correction flow (actualizado con estado real).
- **Contexto:** 9 equipos de investigación (5 internos + 4 externos) analizaron el state machine, patrones de industria (ShipHero, Amazon, Dynamics 365), y patrones de React.
- **6 cambios — estado actual:**
  1. ~~**Debounce cleanup**~~ — COMPLETADO `[2026-04-01]` `395c49b` (develop)
     - `.cancel()` en `debounce.ts`, cleanup en usePickingSync cuando sessionMode cambia.
  2. ~~**Workflow Lock**~~ — COMPLETADO `[2026-04-01]` `9c8fb21` (develop)
     - `isInWorkflowRef` en PickingContext. Guard en loadSession. Set/unset en generatePickingPath y returnToBuilding.
  3. ~~**Release group siblings**~~ — COMPLETADO `[2026-04-01]` `9c8fb21` (develop)
     - returnToBuilding libera siblings igual que releaseCheck.
  4. ~~**Eliminar "Return to Building" desde Double Check**~~ — COMPLETADO `[2026-04-01]` `27d2b8b` (develop)
     - Back button ahora es "Release to Queue".
  5. ~~**Edit Order mode (reemplaza inline correction)**~~ — COMPLETADO `[2026-04-02]` (develop)
     - Inline correction rechazada `[2026-04-01]` → reemplazada por `CorrectionModeView.tsx` (657 líneas).
     - Vista full-screen: todos los items editables (Replace, Adjust Qty, Remove, Add Item).
     - Search server-side (bikes + parts en paralelo via `inventoryApi`).
     - `adjust_qty` limpia flag `insufficient_stock`. `swap` limpia ambos flags.
     - `handleCorrectItem` actualiza DB + state local (`setCartItems`) + log a `picking_list_notes`.
     - Fix takeover false positive: `usePickingSync` compara `checked_by` contra ref anterior.
     - DoubleCheckView muestra badge LOW STOCK + stock real de DB para items con insufficient_stock.
     - 22 tests unitarios en `correctionActions.test.ts`.
  6. ~~**Documentación**~~ — COMPLETADO `[2026-04-01]` `8c2fece` (develop) — actualizado con estado real.
- **Pendiente para merge a main:**
  - Pasos 1-6 completados y probados en develop.
  - bug-012 (click en orden de verificación no navega) no se resolvió en este batch.
- **Nota sobre flags de error:** `sku_not_found` lo setea el watchdog (PDFs) o manualmente en la DB. `insufficient_stock` lo setean el watchdog y `processPickingList()` al hacer Start Picking. El frontend los lee en DoubleCheckView para renderizar items rojos y mostrar controles de corrección. No se recalculan al entrar a double check. Orden de prueba: `TEST-001` (double_checking) con flags explícitos para testing.
- **Criterios de aceptación (actualizados):**
  - ~~Workflow lock previene que loadSession sobrescriba sesión activa~~ ✓
  - ~~Siblings de grupo se liberan correctamente al regresar~~ ✓
  - ~~Debounce timers se cancelan al cambiar sessionMode~~ ✓
  - ~~Botón "back" en double check libera la orden a la cola~~ ✓
  - ~~Checker puede corregir/editar items via Edit Order mode~~ ✓
  - ~~Correcciones se loguean en picking_list_notes~~ ✓
  - ~~Checker puede agregar items extra a la orden~~ ✓
  - ~~Badge LOW STOCK visible en DoubleCheckView con stock real de DB~~ ✓
- **Descartado:** Cambiar status a `ready_to_double_check` en returnToBuilding (causa doble reserva de stock). Migrar a Zustand (refactor demasiado grande, workflow lock resuelve el mismo problema). Inline correction como primera opción (UI confusa, rechazada en testing).

### 19. Rediseño de auto-cancel → sistema de expiración con reactivación <!-- id: idea-031 -->

- **Creado:** `[2026-04-01 11:30]`
- **Estado:** Por hacer.
- **Problema:** El auto-cancel actual cancela órdenes a los 15 min de inactividad o 24 hrs, sin notificación. Esto causa que órdenes legítimas (picker fue a almorzar, orden del viernes que se recoge el lunes) desaparezcan y pierdan su progreso. Las órdenes normalmente se completan en menos de 3 días.
- **Comportamiento deseado:**
  1. **Eliminar timer de 15 min de inactividad** — no cancelar por inactividad corta
  2. **Expiración a 3 días desde creación** — libera inventario reservado pero la orden NO desaparece
  3. **Nuevo estado `expired`** — orden visible en la lista del picker con indicador visual de expirada
  4. **Reactivación con un tap** — picker toca la orden expirada → sistema re-reserva inventario automáticamente
  5. **Validación de stock al reactivar** — si algún item ya no tiene stock, avisar cuáles no están disponibles antes de reactivar
  6. **Mismas reglas** para órdenes manuales y del watcher
- **Diseño técnico:**
  1. **DB:** Agregar `expired` al enum de estados de picking_list (después de `active`, antes de `cancelled`)
  2. **RPC `auto_cancel_stale_orders()`:** Reescribir — en vez de cancelar a 15min/24hrs, solo expira órdenes con `created_at < now() - interval '3 days'` y status `active`. Cambiar status a `expired` y llamar a la lógica de liberación de inventario
  3. **Cron:** Mantener frecuencia de 1 min (ya corre, bajo impacto) o reducir a cada 15 min
  4. **Frontend — OrdersScreen:** Mostrar órdenes `expired` con badge visual (ej. reloj naranja). Al tap, mostrar modal "Esta orden expiró. ¿Reactivar?" con lista de items y disponibilidad actual
  5. **Nueva RPC `reactivate_picking_list(p_list_id)`:** Verifica stock de cada item → reserva los que haya → cambia status a `active` → retorna lista de items sin stock (si los hay)
  6. **Notificación:** Toast al picker cuando una orden expira (vía Realtime subscription en `picking_lists`)
- **Impacto en estados del picking workflow:**
  ```
  idle → active → expired (nuevo, después de 3 días)
                     ↓ tap reactivar
                   active (re-reserva inventario)
  active → ready_to_double_check → double_checking → completed | needs_correction
  active → cancelled (solo manual)
  ```
- **Criterios de aceptación:**
  - Órdenes activas NO se cancelan por inactividad
  - Después de 3 días sin completar, la orden pasa a `expired` y libera inventario
  - Orden expirada sigue visible con indicador visual claro
  - Picker puede reactivar con un tap si hay stock
  - Al reactivar, si un item ya no tiene stock, se muestra cuál y se permite reactivar parcialmente o cancelar
  - Órdenes del watcher siguen las mismas reglas

### 14. Separar peso de dimensiones + defaults para partes <!-- id: idea-025 -->

- **Creado:** `[2026-03-27 15:30]`
- **Estado:** Por hacer.
- **Problema:** Partes heredan defaults de bikes (54×8×30×45 lbs) que no aplican. Peso y dimensiones están acoplados en la UI como un solo campo editable.
- **Solución:**
  1. **Migración:** Poner `length_in=0, width_in=0, height_in=0, weight_lbs=0.1` en todos los SKUs cuya location NO sea `ROW %` / `PALLETIZED` / `UNASSIGNED`.
  2. **Form defaults dinámicos:** Detectar si el item es parte o bike por location. Bikes: 54×8×30×45. Partes: 0×0×0×0.1.
  3. **UI separada:** Peso en su propia sección/badge. Dimensiones separadas. Si todas las dimensiones son 0, mostrar botón "Add dimensions" en lugar de campos vacíos.
  4. **Defaults del form deben venir de `sku_metadata`** del item, no hardcoded. Solo usar defaults genéricos si no existe metadata.
- **Criterios de aceptación:**
  - Partes existentes tienen 0×0×0×0.1 después de la migración
  - Agregar una parte nueva usa defaults 0×0×0×0.1
  - Agregar una bike nueva usa defaults 54×8×30×45
  - Items con dimensiones 0×0×0 muestran botón "Add dimensions" en vez de campos vacíos
  - Peso se edita independiente de dimensiones

### 15. Distribution type "Other" → texto libre <!-- id: idea-026 -->

- **Creado:** `[2026-03-27 15:30]`
- **Estado:** Por hacer.
- **Problema:** Cuando se elige OTHER en distribución, se muestra como "unit/units" genérico. No hay forma de describir qué tipo de contenedor es.
- **Solución:** Cuando type = OTHER, mostrar text input (prefilled "Other") donde el usuario escribe el nombre del contenedor. Se guarda en el JSONB de distribution igual que TOWER/LINE/PALLET — es un type más, no un campo extra. Aparece en DistributionPreview y DoubleCheckView.
- **Criterios de aceptación:**
  - Seleccionar OTHER muestra input de texto prefilled con "Other"
  - El usuario puede cambiar a "Box", "Crate", o lo que quiera
  - El label custom se muestra en preview ("2 boxes of 5") y double-check
  - Se persiste en distribution JSONB como type del row

### 16. Labels — "Units" → "Bikes" + partes separadas <!-- id: idea-027 -->

- **Creado:** `[2026-03-27 15:30]`
- **Estado:** Por hacer.
- **Problema:** LivePrintPreview y PalletLabelsPrinter muestran "UNITS: N" sin distinguir bikes de partes.
- **Solución:** Clasificar items de la orden por location (misma lógica del parts bins filter: `ROW %` / `PALLETIZED` / `UNASSIGNED` = bikes, resto = partes).
  - Orden mixta: `BIKES: 15` + `PARTS: 3` (dos líneas)
  - Solo bikes: `BIKES: 15`
  - Solo partes: `UNITS: N`
  - Aplica en LivePrintPreview y PalletLabelsPrinter PDF.
- **Criterios de aceptación:**
  - Órdenes mixtas muestran BIKES y PARTS como conteos separados
  - Órdenes solo-bikes muestran `BIKES: N`
  - Órdenes solo-partes muestran `UNITS: N`
  - PDF 6×4 muestra lo mismo que preview

### 17. Peso por parte en Orders <!-- id: idea-028 -->

- **Creado:** `[2026-03-27 15:30]`
- **Estado:** Por hacer.
- **Problema:** Partes tienen peso default 0.1 lbs. El usuario no tiene dónde corregir el peso real de cada parte dentro del flujo de órdenes. Hoy hay una alerta confusa para bikes que pide el peso inline.
- **Solución:**
  1. **Nueva sección "Parts Weight"** debajo del label preview. Aparece solo cuando hay partes con peso sospechoso (0.1 lbs o peso inusualmente alto para una parte).
  2. Mini-tabla editable con SKU, QTY, WT/UNIT (input), TOTAL.
  3. Texto de ayuda: "Enter weight per unit, not per box or set of multiple units."
  4. El peso se guarda en `sku_metadata.weight_lbs` permanentemente (futuras órdenes usan el peso corregido).
  5. El peso total de partes se suma al peso total del label en tiempo real.
  6. **Alerta de bikes:** Reemplazar el input inline de la alerta actual con un botón que haga scroll hasta la sección de pesos.
- **Criterios de aceptación:**
  - Sección visible solo cuando hay partes con peso sospechoso (0.1 o anomalías)
  - Editar peso actualiza `sku_metadata` permanentemente
  - Peso total del label se recalcula en tiempo real al editar
  - Texto de ayuda visible sobre "per unit"
  - Alerta de bikes ahora tiene botón de scroll en vez de input inline

### 18. Badge de peso y dimensiones en Stock View <!-- id: idea-029 -->

- **Creado:** `[2026-03-27 15:30]`
- **Estado:** Por hacer.
- **Problema:** Badge de dimensiones se muestra con defaults incorrectos. Peso no se muestra. Solo visible en desktop.
- **Solución:**
  - Badge de dimensiones: solo cuando `length_in > 0 || width_in > 0 || height_in > 0`
  - Badge de peso: siempre visible, separado del de dimensiones
  - Ambos badges visibles en mobile y desktop
- **Criterios de aceptación:**
  - Partes con 0×0×0 no muestran badge de dimensiones
  - Bikes con dimensiones reales muestran badge de dimensiones
  - Todos los items muestran badge de peso
  - Visible en mobile y desktop

### 21. Eliminar Building Order → absorber en Picking View <!-- id: idea-032 -->

- **Creado:** `[2026-04-02]`
- **Estado:** ⚠️ EN PROCESO `[2026-04-03]` — análisis completado, implementación en 4 fases.
- **Problema:** El flujo actual tiene un paso intermedio innecesario: `idle → building → active`. Edit Order mode (implementado 2026-04-02) ya cubre todas las funciones de building (agregar/editar/eliminar items con search server-side y logging).
- **Hallazgo clave:** `building` NUNCA se escribe a la DB. Es 100% frontend (localStorage + React state). La DB solo conoce `active` y posteriores. El RPC `auto_cancel_stale_orders` y un índice referencian `building` pero es código muerto (CHECK constraint lo prohíbe).
- **Plan de implementación en 4 fases:**
  - [ ] **Fase 1 — Habilitar +/- en picking mode.** PickingSessionView muestra qty read-only en picking; cambiar para que picking también tenga controles +/-. No elimina nada, solo desbloquea. Archivos: `PickingSessionView.tsx`.
  - [ ] **Fase 2 — Transición idle → active directa.** SessionInitializationModal se mantiene (popup con order # y customer). Al hacer START, `generatePickingPath` se llama directo → `active` en DB → `picking` en UI. `addToCart` en idle ya no transiciona a building. Archivos: `PickingContext.tsx`, `usePickingCart.ts`, `usePickingSync.ts`.
  - [ ] **Fase 3 — Reemplazar returnToBuilding con Edit Order.** Eliminar `returnToBuilding()`. Habilitar Edit Order desde picking mode (hoy solo desde double_checking). Archivos: `PickingContext.tsx`, `PickingSessionView.tsx`, `PickingCartDrawer.tsx`.
  - [ ] **Fase 4 — Limpieza.** Eliminar `OrderBuilderMode.tsx`. Quitar `building` de types. Limpiar localStorage, InventoryCard, RPC dead code, tests. Archivos: 10+ archivos, 1 migración SQL.
- **Dependencias:** Ninguna — Edit Order mode ya está implementado y testeado (22 tests). idea-031 (auto-cancel) es independiente.
- **Criterios de aceptación:**
  - El picker puede crear una orden sin pasar por Building Order
  - Controles +/- disponibles en picking mode
  - Edit Order accesible desde picking Y double_checking
  - SessionInitializationModal se mantiene (order #, customer)
  - Stock se reserva correctamente via generatePickingPath
  - Órdenes del watcher siguen funcionando (ya crean en `active`)
  - Órdenes agrupadas se combinan correctamente
  - No hay regresiones en double check ni loadSession
  - `OrderBuilderMode.tsx` eliminado, `returnToBuilding()` eliminado

---

## Prioridad 2 — Impacto Medio (mejoras de conveniencia)

- [ ] **Orders Screen — mobile UX overhaul** — `[2026-04-02]` <!-- id: idea-033 -->
      **Problema:** En mobile la vista Orders tiene elementos innecesarios que ocupan espacio y ocultan lo importante. Los resultados de búsqueda no se ven, la info del cliente ocupa toda la pantalla sin poder colapsarla, y hay botones que solo tienen sentido en desktop.
      **Cambios:**
      1. **Ocultar en mobile (`md:hidden`):** botones de navegación entre órdenes (prev/next) y botón Print Labels — solo se usan desde la computadora
      2. **Búsqueda:** los resultados de búsqueda deben ser visibles en mobile. Actualmente el filtro actualiza la lista del dropdown pero el dropdown no se abre automáticamente al buscar. Opción: abrir el dropdown al escribir, o mostrar resultados inline debajo del search
      3. **Customer info colapsable:** envolver los campos del cliente (dirección, ciudad, estado, zip, load, pallets) en un acordeón. Título: nombre del customer si existe, sino `#order_number`. Por defecto contraído en mobile. Al expandir muestra todos los campos editables
      4. **Order number siempre visible** como header/título principal (no dentro del acordeón)
      **Archivos:** `OrdersScreen.tsx` (header, dropdown, search), `OrderSidebar.tsx` (customer fields → acordeón)
- [ ] **Orders — PDF preview full-width en mobile** — `[2026-04-02]` <!-- id: idea-034 -->
      El preview del PDF (LivePrintPreview / PalletLabelsPrinter) en la vista Orders en mobile se muestra con márgenes laterales que desperdician espacio en pantallas pequeñas. Debería ocupar `w-full` o al menos `w-[96%]` del ancho disponible en mobile. Desktop no cambia.
      **Archivos:** `OrdersScreen.tsx` (contenedor del preview), `LivePrintPreview.tsx` o `PalletLabelsPrinter.tsx` (dimensiones del canvas).
- [ ] **Order List View**: When reviewing orders, show the picking list first with an option to print. <!-- id: idea-006 -->
- [ ] **Automatic Inventory Email**: Send full inventory table to Jamis's email. Plain list only, NO links. Edge function `send-daily-report` ya existe — falta query + formato + cron. <!-- id: idea-007 -->
- [ ] **Fotos Fase 3 — Bulk Upload**: Multi-file picker con batching concurrency (3-5), progress bar, mapeo SKU↔archivo por nombre o CSV. Reusar `uploadPhoto()` existente. <!-- id: idea-023-p3 -->
- [ ] **Migrar cron jobs a pg_cron** — `[2026-04-01]` <!-- id: idea-030 -->
      Mover `daily-snapshot` y `auto-cancel-orders` de GitHub Actions / Edge Function cron a **pg_cron** (ya instalado en Supabase). Elimina dependencia de GitHub Actions, corre directo en Postgres, más confiable. Evaluar también **Database Webhooks** para eventos como qty=0 o picking list completada, y **Queues** si el volumen de órdenes crece.
- [ ] **History en perfil de usuario** — `[2026-04-02]` <!-- id: idea-035 -->
      **Problema:** La funcionalidad de History fue marcada como deprecated pero nunca se reemplazó. El usuario no tiene forma de ver el historial de órdenes completadas/canceladas desde su perfil.
      **Solución:** Implementar vista de History dentro del menú de perfil de usuario. Mostrar lista de picking lists completadas y canceladas del usuario con fecha, order number, customer, y status. Permitir ver detalle de cada orden histórica.
      **Archivos:** Perfil de usuario (menú), nueva vista o componente de History.
- [x] ~~**Order Merging**: Combine 2 separate orders into one picking session.~~ — Cubierto por task-007 + idea-010b. `adff48e` <!-- id: idea-010 -->

---

## 🐛 Bug Tracker

### Bugs confirmados en producción (actualizado 2026-04-02)

- [x] **[bug-002]** Undo borra en vez de mover — Fix: `[2026-03-23]` `8092bbe` — *snapshot usaba qty post-move*
- [x] **[bug-003]** Watcher envía items con qty=0 — Fix: `[2026-03-23]` `87ea90b` — *no filtraba locations con qty=0*
- [x] **[bug-004]** Órdenes duplicadas al retroceder — Fix: `[2026-03-23]` `10ef3f8` — *nulleaba activeListId, INSERT en vez de UPDATE*
- [x] **[bug-005]** Items qty=0 en double-check — Fix: `[2026-03-23]` `87ea90b` — *misma raíz que bug-003*
- [x] **[bug-006]** Orden completada reaparece — Fix: `[2026-03-23]` `10ef3f8` — *misma raíz que bug-004*
- [x] **[bug-007]** Verification list >24h — Fix: `[2026-03-25]` `3e10c0c` — *filtro de 24h en query*

- [x] **[bug-011]** Orden desaparece de la UI al editar desde double check con múltiples órdenes — Fix: `[2026-04-02]` fix-002 — *workflow lock + release siblings + eliminar Return to Building desde double check*

- [x] **[bug-008]** Botón Save no se habilita en detalle de item — Fix: `[2026-04-02]` `09b906b` — *zodResolver isValid siempre false porque campos usan setValue/watch en vez de register(); reemplazado con validación manual*

- [x] **[bug-010]** Buscador de New Item no encuentra SKUs — Fix: `[2026-04-02]` — *buscador funcionaba pero modal mobile usaba `bg-black/95` (texto invisible en dark mode); rediseñado como dropdown inline via portal (escapa overflow:hidden) con scroll automático y animación suave*

- [x] **[bug-012]** Click en orden de verificación / botón Orders en perfil — Verificado `[2026-04-02]` — *funciona correctamente, no se reproduce*

- [ ] **[bug-013] Teclado aparece al abrir orden desde Verification Queue** — `[2026-04-02]` — Por confirmar
      Al tocar una orden en la Verification Queue, el teclado mobile se abre sin razón. Causa: `handleOrderSelect` llama `setViewMode('picking')` → InventoryScreen pasa `autoFocus={true}` a SearchInput → useEffect hace `.focus()` programático en input detrás del modal (CSS pointer-events no bloquea `.focus()` de JS).
      **Fix aplicado:** `51e55a5` — SearchInput verifica con `document.elementFromPoint()` que el input no esté cubierto por un overlay antes de hacer `.focus()`.
      **Estado:** Fix en develop, pendiente confirmar en dispositivo mobile.

- [ ] **[bug-009] Address parser falla con calles numéricas + direccionales** — `[2026-03-27]`
      `parseUSAddress` no parsea "5305 S 1200 W\nMILLERSBURG, IN 46543". El parser busca un suffix (St, Ave, Blvd) para separar calle de ciudad. "S 1200 W" no tiene suffix reconocido → todo queda como street, city vacío. Formato común en ciudades del Midwest con calles numéricas y direccionales.
      **Fix:** Agregar fallback: si no se encuentra suffix pero hay newline, usar newline como separador street/city.
      **Archivos:** `src/utils/parseUSAddress.ts` — `findLastSuffix()`, Strategy 3/4.

---

## ✅ Completado

**33 items completados** (2026-03-10 → 2026-04-02). Detalle en `BACKLOG-ARCHIVE.md`.

### ~~29. Security hardening: RLS + anon RPC lockdown~~ — COMPLETADO `[2026-03-29]` <!-- id: sec-fix-001 -->

- Habilitado RLS en `customers`, `order_groups`, `pdf_import_log` (3 tablas expuestas sin proteccion)
- Revocado EXECUTE de `anon` y `PUBLIC` en TODAS las funciones del schema public
- Re-otorgado solo a `authenticated` y `service_role`
- Corregida policy abierta en `optimization_reports` (permitia acceso total a anon)
- **Resultado verificado en prod:** `anon` no puede ejecutar RPCs ni leer customers (186 registros con email/phone estaban expuestos)
- **Migracion:** `20260329200000_security_hardening.sql`

### ~~30. Egress bandwidth reduction ~99%~~ — COMPLETADO `[2026-03-29]` `655d7a2` <!-- id: perf-001 -->

- Paginacion server-side: 30 items iniciales + 20 por load-more (antes 10,000)
- Columnas selectivas en vez de `select(*)`
- Busqueda server-side separada del cache principal
- `refetchOnWindowFocus: false` + invalidacion selectiva por queryKey
- **Resultado:** egress PostgREST reducido de ~20MB a ~15KB por carga inicial

### Descartado

| Item                                                       | Razón                                                                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Sesión de warehouse: inactividad 5min + selector de perfil | No aplica — cada picker usa su propio dispositivo. `[2026-03-18]`                                           |
| Barcode/QR Integration (idea-001)                          | PDFs ya llegan parseados automáticamente, scanning no agrega valor operacional. `[2026-03-26]`              |
| Advanced Analytics Dashboard (idea-003)                    | Sin volumen suficiente para justificar dashboards complejos. `[2026-03-26]`                                 |
| Smart Rebalancing automático (idea-004)                    | Ya existen sugerencias manuales en useOptimizationReports — ejecución auto es riesgosa. `[2026-03-26]`      |
| Persistent Preferences (idea-005)                          | Solo LUDLOW activo, theme ya persiste en localStorage. `[2026-03-26]`                                       |
| Optimistic UI Fixes (task-006)                             | Analizado: flash issue mitigado por staleTime:Infinity + refetchOnWindowFocus:false. `[2026-03-26]`         |
| Offline Sync Edge Cases (bug-001)                          | Arquitectura ya maneja offline (TanStack persist + realtime). Sin reportes de fallos reales. `[2026-03-26]` |

### Verificado en código

**16 behaviors verificados.** Snapshot en `BACKLOG-ARCHIVE.md` (2026-03-27).

---
