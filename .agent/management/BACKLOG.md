# PickD — Backlog

> Pendientes por impacto. Completados en `BACKLOG-ARCHIVE.md`.
> Actualizado: 2026-08-27 (compactado — 37 items comprimidos; detalle en `BACKLOG-ARCHIVE.md`).
> **Convención (operador, 2026-06-10):** cada idea nueva se registra con **fecha y hora**
> del input del operador (hora NY). Ideas previas a la convención llevan solo fecha.
> **Orden de trabajo (operador, 2026-08-27):** los bugs van antes que los quick wins. **❓** marca lo que
> necesita una aclaración del operador (un caso de uso que el código no puede responder) antes de empezar.

---

## P1 — Alto (operación diaria)

### ~~101. Ship: la columna Shipped nunca vacía (últimas 10) y búsqueda de 5 en 5~~ <!-- id: idea-169 --> ✅ 2026-08-28 `8cdb2f4` `e7a31d9` (input: 2026-08-28 NY)
- **Reporte de Rafael:** "quitaste el filtro que dejaba visibles cierta cantidad de órdenes enviadas
  aunque no fueran del día, con la última completada seleccionada". El diff dijo que no: la
  columna era "solo hoy" desde `2dad26b` (14 jul) y ningún commit de Ship de esta sesión tocó la
  lista, la ventana ni la selección. Se construyó lo que quiere.
- **Hecho:** el hook trae las de hoy + las 10 enviadas más recientes (una consulta indexable,
  `limit 10`); la columna se agrupa por **día de envío** (`updated_at`); sin pendientes se abre la
  última enviada. Búsqueda: 5 más recientes + "Show 5 more" (`limit n*5+1`), y el número exacto
  se trae aparte para que una orden vieja nunca quede detrás de cinco nuevas (el tope de 500 que
  una vez escondió una orden registrada). Con "8" pasó de 500 filas a 6.
- **DB:** 1.776 filas / 3,7 MB; ambas consultas ~1,4 ms con seq scan — no hace falta índice hoy.
  `pg_trgm` está instalado por si la tabla crece (índice trigram sobre `order_number`).

### ~~100. Ship: el card reestructurado según el layout de Rafael (60 % y móvil)~~ <!-- id: idea-168 --> ✅ 2026-08-28 (input: 2026-08-28 NY)
- **Pedido:** con Shipped desmarcado el card ocupa el 60 %; "dame propuestas para aprovechar el
  espacio" → "no quiero redundancia; las fotos a otro lugar para que la dirección quepa en una
  línea; hazme una cuadrícula HTML para mover las cosas". Rafael armó dos layouts en el Layout Lab
  (800 px y 360 px) y pegó la estructura.
- **Hecho:** cabecera en una línea (números completos · logo · nota · fecha · tile de fotos · ⋯);
  dirección y ZIP en una línea; fila de carrier con la etiqueta inline y el aviso Daylight en la
  misma línea solo con Daylight elegido; load # debajo; fotos en columna a la derecha que crece
  (`PalletPhotoRail`); banner de litio solo FedEx; Picking Summary / Reopen / Restore / Continue /
  Delete / Split / Uncombine / Notas / manual hazmat / **Print pallet labels (primero) y packing
  slip** en el menú ⋯ (`OrderActionsMenu`); bloque Combined Order fuera (los números de la
  cabecera filtran).
- **Lab:** `scratchpad/ship-card-layout-lab.html` (artefacto "Ship Card Layout Lab") — átomos
  reales, drag libre, agrupar/separar, sin padding por defecto, copia la estructura.

### ~~99. Ship: la bici eléctrica resaltada y declarada aparte para Audit Source~~ <!-- id: idea-167 --> ✅ 2026-08-27 `79f8270` ("ok todo" a las cinco ❓ del PRD; input: 2026-08-27 NY)
- **Pedido (Rafael):** Audit Source (cotización → carrier → tracking) pide declarar la bici a batería
  como un cartón aparte, fuera del pallet aunque viaje dentro. "pickd podría mostrarnos la bicicleta
  que es eléctrica resaltada en azul o con una animación… y necesita ser declarada como tal en la
  vista Ship".
- **Hoy:** un banner ámbar ("Lithium battery label — N e-bikes") dice cuántas, no cuál; la estación la
  busca por nombre en Order Items. La detección existe (`isElectricBikeSku`: lista verificada + modelo
  `E`+dígito).
- **Propuesta:** línea azul + insignia E-BIKE + pulso hasta enviar; bajo los cuatro números, "1 e-bike
  to declare as a separate carton — modelo · peso · medidas" con copiar; totales intactos.
- **PRD:** `docs/prds/ship-ebike-declaration.md` — cinco ❓ con propuesta por defecto (Q1 qué pide
  Audit Source del cartón; Q2 si la cuenta de pallets cambia; Q3 azul/animación; Q4 también en FedEx;
  Q5 cómo se junta con idea-161). Un "ok" por fila basta.

### ~~98. Apartado "What's new" imprimible en PickD~~ <!-- id: idea-166 --> ✅ 2026-08-27 (input: 2026-08-27 NY)
- **Pedido:** un apartado de lo nuevo de PickD que se pueda imprimir, con lo hecho desde el último informe,
  guiado por el informe del 26 ago.
- **Hecho:** ruta `/whats-new` (`WhatsNewViewer`, mismo patrón que `/pickd-report`): lista las
  actualizaciones de `reports/warehouse-updates/` (el `prebuild` las copia a `public/` y escribe
  `index.json`), muestra la más reciente con ← → y botón Print (imprime el iframe; el HTML lleva CSS de
  impresión). Enlace en el menú de usuario → Operations & Logistics → "What's new". Primera entrada
  nueva: `2026-08-27.html` (lo hecho desde el informe del 26). Cada informe nuevo es un HTML más en esa
  carpeta.
- **Origen:** operador, sesión 2026-08-27.

### 91. Ship: pesos por línea visibles, y bici/parte desde el sello del ítem <!-- id: idea-159 --> — input: 2026-08-27 NY
- **Pedido:** "quiero ver los pesos en order items de ahora en adelante, para cada bicicleta, en todas las
  órdenes". Va junto con bug-021 (misma causa): la tabla de ítems de Ship muestra el peso de cada línea
  (unitario × cantidad) leído del `sku_metadata` sellado en el ítem, no de un mapa asíncrono.
- **Origen:** operador, sesión 2026-08-27.

### ~~92. Ship: quitar "Verified" de la vista~~ <!-- id: idea-160 --> ✅ 2026-08-27 (pill "Verified" fuera; el contador de ítems verificados se queda — ok de Rafael)
- **Pedido:** "Quitemos verified de la vista ship".
- **❓ Aclarar:** en Ship hay dos cosas que dicen "verified": el pill de estado de `OrderStatusPill`
  (`completed → 'Verified'`, en cada tarjeta del feed) y el contador de ítems verificados
  (`verifiedKeys` en `ShipFeedCard`). ¿Se quitan las dos o solo el pill? En Ship todas las órdenes
  están completadas, así que el pill no distingue nada.
- **Origen:** operador, sesión 2026-08-27.

### ~~93. Ship: alertas (litio y otras) en un solo botón pulsante de una o dos palabras~~ <!-- id: idea-161 --> ✅ 2026-08-28 ("ok" a la propuesta: litio + zona PAV en la píldora; Daylight se queda en la fila del carrier; la sugerencia de combinar aparte; input: 2026-08-27 NY)
- **Ver idea-167:** el botón diría `E-BIKE ×N` y llevaría a la línea resaltada (PRD, Q5).
- **Pedido:** "Juntemos lithium battery y otras alertas a un botón pulsante que diga en una palabra,
  máximo 2, lo que contiene".
- **Hoy:** `ElectricBikeWarning` ("Lithium battery label — N e-bikes") dentro de `ShipOrderCard`,
  `CombineSuggestionBanner` (misma cliente con orden abierta) y `UnratedCartonsBanner` (cartones FedEx
  sin medida) — tres banners de tamaño completo.
- **❓ Aclarar:** (1) ¿el botón reemplaza a los tres o solo a los avisos de contenido (litio, cartones) y
  la sugerencia de combinar sigue aparte? (2) ¿tocar el botón despliega el detalle actual o va a la
  acción (imprimir etiqueta / medir cartón)? (3) Palabras propuestas: `LITHIUM`, `CARTONS`, `COMBINE`
  — confirmar.
- **Origen:** operador, sesión 2026-08-27.

### ~~94. Ship: selector de carrier con 3 opciones + "…" para el resto~~ <!-- id: idea-162 --> ✅ 2026-08-27 (R+L · FEDEX · RIST + el elegido; "…" despliega el resto)
- **Refinado (Rafael, 27 ago tarde, tres pasos: "3 + …" → "sin FedEx en el top" → "dinámico, una sola línea, responsive"):** la fila se llena con las compañías que caben en una línea sin cortarse (medición real, `ResizeObserver`), por uso (R+L, RIST, PICK UP, DAYLIGHT…); orden regular nunca muestra FedEx; orden FedEx solo FedEx; el elegido siempre visible. `carrierPicker.ts` (`carrierCandidates`, `fitCarriers`) + tests.
- **Pedido:** "Cuando se elige el carrier reducir las opciones a 3 más tres puntitos para expandir".
- **Propuesta con datos (90 d):** ver conteo de `transport_company` en la sesión 2026-08-27; los 3
  visibles serían los 3 más usados, el resto detrás de "…". Si el operador prefiere una terna fija
  (p. ej. FEDEX · R+L · PICK UP), es un cambio de una línea.
- **Origen:** operador, sesión 2026-08-27.

### ~~95. Ship: fotos — máximo 2 visibles + botón de acciones (agregar / ver todas)~~ <!-- id: idea-163 --> ✅ 2026-08-27 (`PalletPhotosBlock`: 2 miniaturas + tile `+N`/`⋯` con "Take photo" y "View all")
- **Pedido:** "Imágenes solo mostrar 2 máximo y un botón de acciones para agregar o ver todas las
  imágenes". Galería de `pallet_photos` en `ShipOrderCard`; `PhotoLightbox` ya existe para "ver todas".
- **Origen:** operador, sesión 2026-08-27.

### 96. Cart de órdenes completadas: mostrar el picking summary <!-- id: idea-164 --> — input: 2026-08-27 NY
- **Pedido:** "El cart en órdenes completadas debe mostrar picking summary".
- **❓ Aclarar:** ¿qué "cart"? Candidatos: el `PickingCartDrawer` al abrir una orden completada desde el
  Board (hoy entra en review de Double Check), o el icono de carrito en Ship (hoy `onShowPickingSummary`
  ya abre `PickingSummaryModal` desde el menú). ¿Y "mostrar" = abrir el summary directamente en vez
  de la vista de verificación?
- **Origen:** operador, sesión 2026-08-27.

### ~~97. Ship: clickear un SKU abre siempre el detalle del ítem~~ <!-- id: idea-165 --> ✅ 2026-08-27 (`useOpenSkuDetail`)
- **Pedido:** "En la vista ship, clickear un sku que siempre abra item detail". Hoy `OrderItemsTable`
  no tiene click. Con una sola fila de inventario abre `item-detail` directo; con varias, el mismo
  selector de ubicaciones que el long-press de Double Check (Editar por fila).
- **Origen:** operador, sesión 2026-08-27.

### 89. Pickd guarda Bill-to y Ship-to completos, y muestra el Ship-to por defecto <!-- id: idea-157 --> — input: 2026-08-26 21:30 NY
- **Problema:** hoy `customers.name` es el **Bill-to** y la dirección que se ve es el **Ship-to** — mezcla de dos entidades en una fila. Además el watcher sobreescribe la dirección "principal" del cliente con cada orden (`_save_shipping_address`), así que en un canal como `JAMIS CONSUMER ALL ACCESS` una orden vieja enseña la dirección de la orden más reciente. El nombre del Ship-to (`customer_addresses.label`) existe pero ninguna pantalla lo pinta. El watcher ya parsea la dirección Bill-to (`parse_customer_address`) y la tira.
- **Solución:** (1) `customers` = Bill-to con **su propia** dirección (el watcher la escribe desde `customer_address`, solo cuando está NULL; deja de pisarla con el Ship-to). (2) `customer_addresses` = Ship-tos, con `label` = nombre del Ship-to, `contact_name`, `residential` y la llave FedEx. (3) Cada orden apunta a su Ship-to vía `picking_lists.ship_to_address_id` (ya existe desde `20260826230000`) y **las pantallas muestran por defecto el Ship-to** (nombre + dirección de esa fila), con el Bill-to como línea secundaria ("Bill to: …"). Superficies: `ShipOrderCard`/`ShipScreen` (el form de dirección edita la fila enlazada, no el cliente), `OrderRowCard`, `DoubleCheckView`, `PublicOrderView`, `printOrderDetail`, `useShipOutSms` (el SMS lleva la dirección del Ship-to). (4) Backfill: el caché `.scanned_orders.json` trae ambos bloques, así que `scripts/backfill_account_numbers.py` puede sembrar la dirección Bill-to y el enlace por orden en la misma pasada.
- **Requiere:** decidir qué pasa con órdenes manuales (sin AS400): el operador elige/crea el Ship-to en el form; el Bill-to es el cliente elegido. Y coordinar con la fase 1b de idea-153 (fusión de duplicados), porque ambas tocan `customers`.
- **Origen:** operador, sesión 2026-08-26 ("que se guarde toda la info y tengamos tanto bill to como ship to, pero el que se muestra por default que sea ship to").

### 90. Watcher: vista "What's new" con novedades, lo que viene y acciones de mantenimiento con botón <!-- id: idea-158 --> — input: 2026-08-26 21:30 NY
- **Problema:** las novedades del watcher solo se ven en el `git log`, lo que está por venir vive en el backlog de Pickd, y una tarea puntual como el backfill de cuentas AS400 exige abrir una terminal en la MacBook de Bay 2 y teclear `python3 scripts/backfill_account_numbers.py --apply`. El operador quiere leerlo y ejecutarlo desde la misma UI donde ya está el botón "⟳ Update app".
- **Solución:** nueva pestaña/vista en `app.py` (inglés, como el resto): (1) **What's new** — las últimas entradas de un `NEWS.md` versionado en el repo (una línea por cambio que el operador nota, con fecha; se escribe en el mismo commit que el cambio, como los manuales de Pickd), no el git log crudo. (2) **Coming up** — un `ROADMAP.md` corto, o las entradas del backlog de Pickd etiquetadas `watcher`. (3) **Maintenance** — acciones con **botón + explicación de una frase + resultado en pantalla**: "Run backfill — fills the AS400 account and ship-to for orders already captured, so their FedEx ID shows in PickD. Safe to repeat." El script se refactoriza en una función importable que devuelve el resumen; el botón hace primero el *dry-run*, muestra los conteos, y un segundo botón "Apply" escribe. Endpoint `POST /api/maintenance/<action>` protegido por el mismo check de Origin que el resto. El primer botón es el backfill de idea-153; los siguientes (fusión de duplicados, re-captura de una orden) usan el mismo molde.
- **Requiere:** nada de Pickd. Solo el repo `watchdog-pickd`.
- **Origen:** operador, sesión 2026-08-26 ("una nueva vista en watcher que me permita ver las últimas novedades, lo que está por venir y notas o botones como ejecutar backfill para 'explicación X'").
- **Estado 2026-08-27:** bloque *Maintenance* entregado en watchdog `8fdd480` (⋯ → Maintenance: card por acción, explicación, Preview/Apply, resultado en pantalla; `maintenance.py` con registro `ACTIONS`). Faltan *What's new* (`NEWS.md`) y *Coming up*.

### ~~89. LOW STOCK se resuelve solo en Double Check, con el caso exacto y acciones por línea~~ <!-- id: idea-156 --> ✅ 2026-08-26 (input: 2026-08-26 NY)
- **Pedido (Rafael):** que el sistema no espere a Edit Order: al detectar LOW STOCK que intente
  resolverlo y, si no puede, diga exactamente qué encontró (casos distintos) y ofrezca eliminar /
  cambiar / etc. en la misma vista, solo para ese ítem.
- **Hecho:** `diagnoseStockIssue` (puro, 9 tests) → `auto_swap` / `unregistered` / `no_stock` /
  `reserved` / `partial`; `StockIssuePanel` bajo la tarjeta con la frase y las acciones del caso
  (Take N · Use X · Register · Replace → Edit Order en el buscador de esa línea · Remove), todas con
  razón; auto-swap de hermanos al abrir la orden con toast y Undo. Ver CLAUDE.md → picking workflow.
- **Origen:** sesión 2026-08-26 (captura de la orden 881288 en Edit Order).

### 88. Assist mode en Double Check View — dos personas en una orden con varios pallets <!-- id: idea-155 --> — input: 2026-08-26 NY
- **Idea (Rafael):** solo cuando la orden tiene más de un pallet, que una segunda persona pueda
  entrar a la misma orden y verificar un pallet mientras la primera verifica otro — trabajar juntos
  en una sola orden en vez de esperar a que termine.
- **Hoy:** una orden tiene un solo verificador (`checked_by`); si otro usuario la abre,
  `usePickingSync` dispara la alerta de takeover y el primero pierde la sesión. El progreso
  (`verified_item_keys`) se persiste solo con los cambios del propio dispositivo (`dirtyListIdRef`),
  así que dos dispositivos se pisarían. Los pallets ya están agrupados en la vista (`pallets` en
  `DoubleCheckView`).
- **Boceto:** un "assistant" se une a la orden sin desplazar al verificador (rol aparte de
  `checked_by`); cada uno toma un pallet; los checks se fusionan por **unión** de llaves, nunca por
  reemplazo, y la tarjeta muestra quién verificó qué; el botón de cierre lo tiene solo el
  verificador principal. Gate: `pallets.length > 1`.
- **Origen:** sesión 2026-08-26.

### ~~87. Identidad única del SKU: guion + cero, impuestos al escribir~~ <!-- id: idea-154 --> ✅ 2026-08-26 (canónico = AS400; migración `20260826220000`, watchdog `918160d`)
- **Problema:** el mismo SKU vive con tres grafías (`01 0530` en AS400, `01-0530` en el catálogo
  heredado, `01-530`/`010530` a mano o del watchdog) y nadie la impone al escribir: de 14 vías que
  crean SKUs solo Label Studio pone el guion (`normalizeSkuOnRegister`), la DB acepta cualquier string
  (sin trigger que asigne `NEW.sku`, sin CHECK, sin índice único normalizado). Prod: 99 SKUs sin
  guion (12 creados en los últimos 30 d), 10 familias duplicadas por clave normalizada
  (`12-8338BK`/`128338BK`), 97 cortos sin el cero y **26 parejas del mismo part con stock partido**
  (`66-0110BK` 514 / `66-110BK` 195). 67/67 ítems `SKU not found` en 90 d llegaron sin guion.
- **Decisión (Rafael, 26 ago):** la de AS400, `DD-NNNN[CC(C)]` — AS400 muestra `01-0288` y no
  encuentra `01-288`. Hecho: `canonical_sku()` + 4 triggers + RPCs; 108 renames (22 fusiones, 2
  sumas en el mismo bin) con auditoría en `sku_canonical_renames`; `sku_key` único; espejos TS y
  Python con la misma tabla de casos; watchdog escribe canónico en líneas no encontradas.
- **Pendiente (piso, no código):** conteo físico de las 22 fusiones —
  `select * from sku_canonical_renames where merged` — y, si alguna resulta ser otra parte,
  registrarla con nombre propio. Ver CLAUDE.md → "Forma canónica del SKU".

- **Documentación completa:** [`docs/sku-identity-analysis.md`](../../docs/sku-identity-analysis.md).
- **Origen:** sesión 2026-08-26.

### 86. Una sola llave AS400 → watcher → Pickd → FedEx (Recipient ID) <!-- id: idea-153 --> — input: 2026-08-24 17:29 NY
- **Problema:** el jefe pide exportar clientes de Pickd a FedEx Ship Manager. El análisis del export de recipients de FSM (5.206 filas) muestra que el 85 % de los 614 clientes de Pickd ya está en FSM y que el delta inverso son ~86 registros; el valor real es compartir la llave. **El Recipient ID numérico de FSM ya es la cuenta AS400 + sufijo ship-to** (`0010495 00` → `1049500`, verificado con TUCKER CYCLES y BOULEVARD BIKES), y Pickd es el único que la tira: el watcher parsea `Account Number` y no lo persiste.
- **Solución:** persistir la cuenta y el sufijo (`customers.as400_account`, `customer_addresses.as400_ship_to` + `fedex_recipient_id` único, `picking_lists.as400_account_number` + `ship_to_address_id`), chip con ID copiable y estado en Ship/DoubleCheck, import del export de FSM (`fedex_recipients`: teléfonos para ~500 clientes), export incremental Pickd → FSM en *Append* (mismo patrón que Dimensions), y tracking de vuelta (`shipments`) vía export de FSM o watcher en la máquina de FedEx. Canales con destinatario variable (`JAMIS CONSUMER ALL ACCESS` ×25 direcciones, Facebook, garantías) se marcan `ship_to_varies` y no reciben ID. Fase 1b fusiona los `customers` duplicados por nombre (15× consumer, 13× Sports Basement) que ShipScreen crea al cambiar la dirección.
- **Documentación completa:** [`docs/fedex-customer-id-integration.md`](../../docs/fedex-customer-id-integration.md) — esquema, watcher, UI, fases 0–5 con criterio de hecho y tabla de seguimiento. Análisis de origen: [`docs/fedex-recipients-analysis.md`](../../docs/fedex-recipients-analysis.md).
- **Requiere:** fase 0 en la máquina de FedEx (comportamiento de *Append* con ID existente, template `RECIPIENTS1`, menú Integration) antes de escribir código.
- **Origen:** sesión 2026-08-24.

### 85. Register Container v2 — sesión de receiving activa <!-- id: idea-152 --> — input: 2026-07-03 NY
- **Problema:** el flujo actual (`upload → preview → done`) no soporta descarga física real. No hay checklist para tachar SKUs conforme se sacan del truck, no se pueden agregar SKUs que no venían en el manifest, solo muestra 1 location (`existing_locations[0]` en `RegistrarContainerScreen.tsx:28, 375, 417`), sin time-in/time-out, sin notas ni fotos, no se puede pausar y volver si se cierra el navegador.
- **Solución:** insertar step `receiving` entre `preview` y `done` con 2 tablas nuevas (`container_receiving_sessions` + `container_receiving_items`), 5 RPCs, y `ReceivingSessionView.tsx` estilo DoubleCheckView pero más rápido. El registro de inventario ocurre solo al finalizar sobre items confirmados. Popover multi-loc reemplaza el `+N more` texto muerto tanto en receiving como en done.
- **Documentación completa:** [`docs/register-container-receiving-session.md`](../../docs/register-container-receiving-session.md) — tablas, RPCs, hooks, layout, verification E2E.
- **Origen:** sesión 2026-07-03.

### ~~53. SKU normalization at intake — close idea-092 path 1~~ — COMPLETADO `2026-06-10` watchdog #35 <!-- id: idea-101 -->

### ~~55. New orders never auto-route to Ready to Double-Check~~ <!-- id: idea-103 --> ✅ 2026-08-27 (no reproduce)
- **Resolución 2026-08-27:** la query del plan (`status = 'ready_to_double_check' AND created_at = updated_at`,
  30 días) devuelve **0** órdenes; las 236 creadas en ese periodo están completadas o canceladas y ninguna
  nació en ese estado. Sin caso reproducible no hay fix; se reabre con número de orden si vuelve a verse.
- **Contexto:** Reportado en sesión 2026-05-01: una orden recién creada apareció directamente en la zona "Ready to Double-Check" del Verification Board en lugar de en su lane FedEx/Regular.
- **Hipótesis (sin diagnóstico aún):** alguna creación de orden setea `status='ready_to_double_check'` en vez de `active`. Posibles caminos:
  - Watchdog intake con default status incorrecto.
  - Reabrir una orden completada deja status en `ready_to_double_check` por accidente.
  - Auto-flag idle (idea-099 commit `37c2060`) que cambia status sin querer.
- **Plan al implementar:** primero diagnosticar — query a `picking_lists` filtrando `status='ready_to_double_check' AND created_at = updated_at` (proxy de "recién creada y nunca tocada") los últimos 7 días. Identificar patrón antes de proponer fix. Probable: guard en intake (CHECK constraint o trigger BEFORE INSERT que rechace `ready_to_double_check` para rows nuevos).
- **Datos pendientes para diagnóstico:** order_number observado + día/hora + si fue de watchdog o creación manual / reopen.
- **Origen:** sesión 2026-05-01.

### ~~48. Auto-mover órdenes idle a Waiting (en vez de borrarlas)~~ — COMPLETADO `2026-04-30` `1645bff` `37c2060` `5c6fe9d` <!-- id: idea-099 -->

### ~~47. Reactivación de SKU al cambiar qty~~ — COMPLETADO `2026-04-30` — (sin código) <!-- id: idea-098 -->

### ~~46. Auto-resolver SKU format mismatches en intake / pick-time~~ — COMPLETADO `2026-06-10` migración `20260430160000` + watchdog #35 <!-- id: idea-092 -->

### ~~45. FedEx Returns en el Activity Report~~ — COMPLETADO `2026-05-06` `9051a9d` `069ae0d` <!-- id: idea-091 -->

### 43. Orders view — UX/UI rework <!-- id: idea-065 -->
- **Problema:** La vista `/orders` tiene varios pain points:
  1. El **encabezado de PickD desaparece** en esta ruta. Debería estar siempre presente.
  2. **LivePrintPreview** tintea toda la card según el carrier — colores saturados rompen la estética.
  3. La asignación visual del carrier al label no es clara — sin logo identificable.
  4. Densidad y jerarquía visual no son lo suficientemente minimalistas comparado con el resto del sistema.
- **Solución propuesta:**
  - Mantener el header global de PickD visible en `/orders` (revisar `AppShell` / layout wrapper).
  - **Invertir el uso del color del carrier:** color vivo va al **fondo del preview card** con overlay glass oscuro (`bg-card/80 backdrop-blur-xl`).
  - **Logo del carrier** debajo del label impreso (FedEx / UPS / USPS / Regular), tamaño discreto, grayscale si el fondo ya expresa el carrier.
  - Pasar a estilo más minimalista: menos chrome, más whitespace.
- **Requiere:** Inventariar componentes ocultando el header; definir paleta por carrier; resolver assets de logos; evaluar impacto en PDF de labels (`jsPDF`).

### 22. Alerta de orden duplicada por cliente + reabrir <!-- id: idea-039 --> (deprioritized)
- **Problema:** Cuando llega una orden nueva para un cliente cuya orden anterior ya fue completada, el picker no se entera y la procesa por separado.
- **Solución:** Detectar si existe otra orden completada del mismo `customer_name`. Mostrar alerta con opción de reabrir y mergear.
- **Estado:** Deprioritizado 2026-04-13. No es urgente — se maneja manualmente por ahora.

### 31. Inventory Accuracy Fase 2 — Validación de cantidad <!-- id: idea-048 -->
- **Contexto:** Fase 1 implementada: MOVEs y ADDs cuentan como verificación implícita de cobertura (SKU fue tocado físicamente en 60d). Cobertura subió de ~0.5% a ~20%.
- **Problema Fase 2:** La cobertura no garantiza que la cantidad actual sea correcta. Un SKU movido hace 30 días puede tener una cantidad incorrecta si hubo errores no trackeados después.
- **Solución:** Reconstruir la cadena: qty al momento del MOVE/ADD + ADDs posteriores - DEDUCTs posteriores = qty esperada. Comparar con qty actual en DB. Si coincide → "quantity verified". Si no → flag para reconteo.
- **Consideraciones:** Solo el destino del MOVE es confiable. ADDs son verdad absoluta para la cantidad agregada. DEDUCTs de picking son trackeados pero pueden tener correcciones. Evaluar si hacer esto como query on-demand o como background job.
- **Requiere:** Análisis profundo + posible RPC en DB para eficiencia.

### 30. Cache de datos de orden al cambiar entre órdenes <!-- id: idea-047 -->
- **Problema:** Al cambiar entre órdenes en OrdersScreen, el frontend recalcula todo (items, distribución, labels, conteos) cada vez. Causa lag perceptible y mala UX, especialmente en mobile.
- **Solución:** Calcular la información de cada orden una sola vez y mantenerla estática en cache. Suscribirse a cambios vía Realtime (o invalidación de query) para que solo se recalcule cuando hay un cambio real en la orden o configuración del sistema.
- **Consideraciones antes de implementar:** Investigar edge cases — ¿qué pasa si otro usuario modifica la orden mientras está cacheada? ¿Se necesita una columna `updated_at` más granular o un hash de versión? ¿Impacto en optimistic updates existentes? Evaluar si TanStack Query `staleTime` + `structuralSharing` ya cubre parte del problema o si se necesita un cache layer adicional.
- **Requiere:** Análisis profundo antes de implementar.

### 60. Optimistic updates — Top 3 y 5 pendientes <!-- id: idea-112 -->
- **Contexto:** Auditoría 2026-05-21 identificó 5 mutations donde el optimistic update está mal usado o ausente. Top 1 (pick/unpick), #2 (ShippingTypeToggle), #4 (addNote) resueltos. Quedan #3 y #5.
- **#3 — `usePickingActions.markAsReady` batch (`src/features/picking/hooks/usePickingActions.ts:157-168`)** [~1.5h, ROI 🔥🔥]
  - Hoy: 2-3 `.update()` calls secuenciales sin onMutate. Si una falla, el estado local no rollback.
  - Fix: una sola mutation `useMarkAsReady` que ejecute las updates, capture snapshot de los affected lists, y rollback en bloque si una de las queries fail. Transactionar server-side via RPC `mark_picking_list_ready_with_release(p_list_id, p_user_id)` es la opción más limpia (también lo deja idempotente).
- **#5 — Photo upload de pallets (`PickingCartDrawer.tsx:624`, `DoubleCheckView.tsx:250`)** [~1.5h, ROI 🔥]
  - Hoy: sube foto + `.update({ pallet_photos })` sin optimistic.
  - Fix: `useMutation` que en `onMutate` agrega un blob URL local al array `pallet_photos` (preview instantáneo). `mutationFn` sube a storage + persiste. `onSuccess` reemplaza el blob URL por la URL final. `onError` lo quita. Cleanup del blob URL en ambos casos.
- **Template:** `usePickItemMutation.ts` (Top 1) + `ShippingTypeToggle.tsx` `useMutation` block (Top 2) + `usePickingNotes.addNote` (Top 4) cubren el patrón. Reusar.
- **Origen:** auditoría 2026-05-21.

---

## Reportado 2026-06-09 — batch operador (corto plazo)

> 12 ítems reportados por el operador. Refinados con sus respuestas el 2026-06-09. Repo indicado donde no sea pickd.

### ~~62. Botón "Stock" desde DoubleCheckView no oculta la vista~~ — COMPLETADO `2026-06-11` `6180bd6` (#120) <!-- id: idea-129 -->

### ~~78. Sublocation igual al número de ubicación~~ — COMPLETADO `2026-06-11` #119 <!-- id: idea-145 -->

### ~~63. Verification Board → reabrir orden: misma sin fricción, distinta con confirmar~~ — COMPLETADO `2026-06-11` `a62996f` (#123) <!-- id: idea-130 -->

### ~~79. Double-check: colapsar detalle de items marcados~~ — COMPLETADO `2026-06-11` #122 <!-- id: idea-146 -->

### ~~80. Watchdog: SKU con sufijo truncado (03-3769BLD → 03-3769BL)~~ — COMPLETADO `2026-06-11` watchdog #40 <!-- id: idea-147 -->

### ~~81. Watchdog: VOID que cae en 'ADDITIONAL MESSAGE INFORMATION'~~ — COMPLETADO `2026-06-11` watchdog #41 #42 <!-- id: idea-148 -->

### ~~82. Register Container acepta PDF (no solo XLSX)~~ — COMPLETADO `2026-06-11` #130 <!-- id: idea-149 -->

### ~~83. Double-check: auto-hide del header + filtro de notas ruido~~ — COMPLETADO `2026-06-11` #132 <!-- id: idea-150 -->

### ~~84. Drag-to-group siempre con confirmación + waiting fuera del auto-combine~~ — COMPLETADO `2026-06-11` #134 · watchdog #43 #46 · `32948b0` (`20260612150000`) <!-- id: idea-151 -->

### ~~64. Búsqueda de consolidation~~ — COMPLETADO `2026-06-11` `8fe9646` (#107) <!-- id: idea-131 -->

### ~~65. Overlays/menus con blur + scroll-lock~~ — COMPLETADO `2026-06-09` `090f999` (#107) <!-- id: idea-132 -->

### ~~67. Formatear Order Date de AS400 (060826 → 06/08/2026)~~ — COMPLETADO `2026-06-10` #113 · watchdog #32 (`20260610120000`) <!-- id: idea-134 -->

### ~~75. Watcher: "2 pallets · 20 units" en vez de item count~~ — COMPLETADO `2026-06-10` watchdog #34 <!-- id: idea-142 -->

### ~~76. Watcher: dot AS400 gris aunque todo funcione~~ — COMPLETADO `2026-06-10` watchdog #36 <!-- id: idea-143 -->

### ~~77. Watcher: carriles FedEx (izq) / Truck (der) con colores de fondo~~ — COMPLETADO `2026-06-10` watchdog #37 <!-- id: idea-144 -->

### ~~74. Batch de mejoras double-check + watcher (lista del operador 2026-06-10)~~ — COMPLETADO `2026-06-10` #113 · watchdog #32 #33 <!-- id: idea-141 -->

### ~~68. Al reiniciar la MacBook: Safari (UI) derecha + AS400 izquierda, 50/50~~ — COMPLETADO `2026-06-10` — (confirmado por el operador) <!-- id: idea-135 -->

### ~~70. Número de cantidad de distribución: grande, al costado (fuera del gráfico)~~ — COMPLETADO `2026-06-10` `0abcd45` (#115) <!-- id: idea-137 -->

### ~~71. Notas del watcher en rojo~~ — COMPLETADO `2026-06-09` `3da86ea` (#110) <!-- id: idea-138 -->

### 73. Columna dedicada `watcher_notes` (separar notas del watcher de sistema/manual) <!-- id: idea-140 --> ⏸ en pausa (operador 2026-06-10: "deja las notas como están por ahora")
- **Problema:** `picking_lists.notes` es un cajón mezclado (watcher Order Comments + appends de sistema/cancel). La UI roja (idea-138) hoy muestra todo. Para mostrar **solo** las del watcher hace falta separar el origen.
- **Plan:**
  1. **Migración (aditiva):** `ALTER TABLE picking_lists ADD COLUMN watcher_notes text;` + actualizar los 4 lugares (migración, Zod, types x2, selects).
  2. **watchdog (`supabase_client.create_order`):** escribir los Order Comments en `watcher_notes` (dejar de meterlos en `notes`, que queda para sistema/cancel). Repo `watchdog-pickd`.
  3. **pickd:** cambiar el display rojo (DoubleCheckView + PickingSummaryModal) para leer `watcher_notes` en vez de `notes`.
  4. **Backfill:** `UPDATE picking_lists SET watcher_notes = notes WHERE source='pdf_import' AND notes !~* 'cancelled|\[system'` (ajustar patrón) — para que las pasadas también queden limpias.
  5. Aplicar migración a prod tras el merge (checklist de migraciones del CLAUDE.md).
- **Origen:** sesión 2026-06-09 (follow-up de idea-138).

### ~~72. DoubleCheckView: últimos 3 dígitos de cada orden mergeada, separados por "/"~~ — COMPLETADO `2026-06-09` `6366544` (#109) <!-- id: idea-139 -->

---

## P2 — Medio (conveniencia)

- [x] ~~**Orders PDF preview full-width mobile**~~ ✅ 2026-05-27 `5584273` `aea31b5` <!-- id: idea-113 -->

- [x] ~~**SMS Ship-Out — quitar dirección + ocultar Parts/Bikes con qty=0**~~ ✅ 2026-05-27 `aea31b5` <!-- id: idea-114 -->

- [x] ~~**Consolidation — ocultar toggle "Bikes only" de la UI (mantener default ON)**~~ ✅ 2026-05-27 `aea31b5` <!-- id: idea-115 -->

- [x] ~~**ConsolidationMoveModal — sublocation seleccionable (chips A-F) en vez de input libre**~~ ✅ 2026-05-27 `aea31b5` <!-- id: idea-116 -->

- [x] ~~**Consolidation — filtro "Hide rows" por tab (persistido en localStorage)**~~ ✅ 2026-05-27 `600f2ea` `a2a68f1` <!-- id: idea-117 -->

- [ ] **Consolidation — filtros adicionales recomendados** — Follow-up de idea-117 (MVP). Filtros opcionales que el operador puede activar/desactivar por tab (mismo patrón localStorage):
  - **Hide full rows** — esconde rows con `free_units = 0` (útil en Where to put + Send to slow para reducir ruido de destinos sin capacidad).
  - **Hide empty rows** — esconde rows con `current_units = 0` (útil en Clear a row).
  - **Only ROW prefix** — excluye M-slots / FDX RETURNS / shipping areas / otros non-ROW (hardcodearlo en `suggest_locations_for_sku` RPC sería más limpio, ver idea-118).
  - **Velocity match only** — en Where to put?, esconde destinos cuya `zone` no matchea el `sku_velocity_tier` del SKU activo.
  **Decisión 2026-05-28:** los 4 filtros propuestos quedaron DESCARTADOS — ninguno aporta en este warehouse. Only-ROW ya está hardcoded en el RPC (idea-118); Velocity-match quedó obsoleto tras el rework a picking_order (el ranking ya encode la velocidad); Hide-empty es contraproducente (rows vacías son buenos destinos); Hide-full (idea-124, revertido) no sirve porque con todo en movimiento `free_units = 0` casi nunca ocurre. El lever real de reducción de ruido es el **Hide rows manual** (idea-117) que ya existe + el "show top 12". No se necesitan más filtros automáticos. <!-- id: idea-120 -->

- [x] ~~**"Where to put?" logic al marcar SKU en Send to slow / Bring to active**~~ ✅ 2026-05-28 `a04f57c` <!-- id: idea-122 -->

- [x] ~~**Where to put? — rediseño completo (autocomplete + solo ROW + panel velocidad)**~~ ✅ 2026-05-28 `5584273` · migración `20260528083212` <!-- id: idea-118 -->

- [x] ~~**Consolidation — filtro qty-bucket (Singles / Lines / 1 Tower / 1 Tower+)**~~ ✅ 2026-06-01 `1081286` <!-- id: idea-125 -->

- [x] ~~**Consolidation — persistir avance al salir (filtros, búsqueda, selección)**~~ ✅ 2026-06-01 `c023d21` <!-- id: idea-127 -->

- [x] ~~**Stock view — visualización Jenga de la distribución encima de cada card**~~ ✅ 2026-06-01 `f98f70c` `78285d1` <!-- id: idea-126 -->

- [x] ~~**Combined orders — suprimir warnings cruzados con órdenes del mismo grupo**~~ ✅ 2026-05-27 `502871f` <!-- id: idea-119 -->

---

## P1 — Refinados pendientes

### ~~40. Notas de proyecto siempre visibles (quitar line-clamp)~~ — COMPLETADO `2026-04-27` `feaf688` (PR #43) <!-- id: idea-062 -->

---

## Inventory Audit — pendientes de revisión

- [ ] **ROW 10 — 6 SKUs sin sublocation confirmada** — `03-3718GY` (1), `03-3719GY` (1), `03-3817GY` (1), `03-3846BR` (5), `03-4201GN` (3), `03-4208GY` (1). Verificar físicamente si siguen en ROW 10 o deben moverse/desactivarse. <!-- audit-2026-04-15 -->

---

## Bugs pendientes

### ~~4. Ship: al combinar una orden con una bici en una orden completada, la bici cuenta como parte y pide peso~~ <!-- id: bug-021 --> ✅ 2026-08-27 `9886206` (input: 2026-08-27 NY)
- **Síntoma (operador):** "al agregar una nueva orden con una bicicleta a una orden completada en ship me
  pide peso para la supuesta nueva parte agregada, aunque sea una bicicleta que ya tenía peso
  registrado; me muestra 2 pallets, 8 bicicletas, una parte y un total de peso que no tiene sentido".
  Caso: 881303 (`03-3845BR`, bici registrada desde febrero, 45 lb) combinada con la completada 881301
  el 27 ago 18:35 → 881301 quedó con `total_units = 9` (8 bicis + "1 parte") y 470 lb.
- **Causa:** en `ShipScreen` bici/parte y peso salen de `skuMeta`, un mapa que se consulta
  **asíncronamente** al cambiar la orden; hasta que llega, `isBikeSku(sku, undefined)` devuelve `false`
  (sin metadata no hay regla de prefijo), así que la bici recién combinada cuenta como parte, entra en
  `partsWithWeights` (el editor de pesos la pide) y el autosave congela `bikes + parts`. El ítem ya trae
  `sku_metadata` sellado por `a_stamp_item_sku_metadata` (`is_bike`, `weight_lbs`) y la vista lo ignora.
  Los "2 pallets" son la suma de `pallets_qty` de las dos órdenes (1 + la estimación del intake de la
  nueva), no un error de cálculo.
- **Fix:** leer bici/parte y peso del sello del ítem primero (síncrono, por línea) y del mapa vivo solo
  como refresco; mostrar el peso de cada línea en la tabla (idea-159).
- **Origen:** operador, sesión 2026-08-27.

### ~~5. Ship: una orden combinada en la columna Shipped se muestra como su orden ancla sola~~ <!-- id: bug-022 --> ✅ 2026-08-27 `70871f5` (verificado en prod: 303 / 301 → 9 unidades, 9 bicis, 480 lb)
- **Síntoma:** al abrir `#881303 / 881301` desde **Shipped today**, la vista dice `ORDER #881301 · 9 UNITS`
  pero Order Items lista 7 líneas / 8 unidades, cuenta 8 bicis / 0 partes y 435 lb: la Riptide de 881303
  (`03-3845BR`) no aparece en ningún lado, mientras el `9` sale de `total_units` de la fila cruda.
  Visto al capturar pantallas para el What's new del 27 ago, no reportado por el operador.
- **Causa:** al seleccionar, el efecto de detalles reemplaza la pseudo-orden combinada por la fila cruda
  del ancla (`fetchOrderDetails` → `setSelectedOrder(details)`), y el "self-heal" que la vuelve a
  combinar busca en `filteredOrders`, que es **solo la columna To Ship**. Pendiente de envío se curaba;
  enviada, nunca. El handler de realtime ya resolvía bien (`fetchOrderGroupSiblings` +
  `combineGeneralGroupSiblings`) — dos caminos, una sola regla.
- **Fix:** `resolveSelectedOrder(details)` en `ShipScreen`, usado por el efecto de detalles y por
  realtime; el self-heal mira `orders` entero. Verificar en prod: `#881303 / 881301` → 9 unidades,
  8 líneas, 9 bicis, 480 lb.
- **Origen:** sesión 2026-08-27, revisión de capturas.

### ~~1. Texto de nota de picking se concatena dentro de `sku_metadata.model`~~ <!-- id: bug-018 --> ✅ 2026-08-26 (input: 2026-08-20 NY)
- **Síntoma:** 14 filas de `sku_metadata` tienen el nombre del modelo con una nota pegada al final:
  `ALLEGRO A1 23 THUNDER GREY | Auto-cancel verification timeout | auto-restore on cancel`.
  12 son bikes, 2 estaban dentro del set del export a FedEx — esa frase habría viajado como
  descripción de un registro de FSM.
- **Origen:** sesión 2026-08-20, al construir el export de dimensiones FedEx.
- **Causa y fix (26 ago):** `adjust_inventory_quantity` escribía `p_merge_note` (`auto-restore on
  cancel`, `Reopen delta #1`…) **dentro de `item_name`** — como nombre al crear la fila, concatenado
  con ` | ` al actualizarla — y de ahí lo copiaba todo lo que deriva `model` del nombre. Migración
  `20260826233000`: la nota va a `internal_note` (una vez por nota distinta), una fila nueva se nombra
  como las otras filas del SKU, y se limpiaron las 2 filas + 1 `model` que quedaban.

### ~~2. LOW STOCK con stock en piso: el mismo SKU bajo dos nombres (`03-3768BL`/`BLD`)~~ <!-- id: bug-019 --> ✅ 2026-08-26
- **Síntoma:** orden 881288 (26 ago) entra con `03-3768BLD` y `03-3769BL` marcados LOW STOCK y sin
  ubicación, con 145 bicis en ROW 43 (`03-3768BL`) y 76 en ROW 41 (`03-3769BLD`). Recurrente desde
  junio: 880985, 881139, 881156, 881164, 881263, 881274 — 24 notas `Replaced` entre hermanos en dos
  semanas, incluido un `Undo auto-resolve`.
- **Causa:** la misma bici existe bajo dos SKUs que difieren en una letra de acabado; el stock cambia
  de nombre con cada rename del operador (25 ago: `BLD → BL`) y la fila vieja de `sku_metadata` se
  queda. El watchdog elegía el primer nombre que existiera en el catálogo (el muerto) y
  `SKU_SUBSTITUTES` en la app apuntaba a mano en la dirección que ya no era.
- **Fix:** regla "gana el hermano con stock" en watchdog (`_pick_by_stock`) y en tier 1 de Edit Order
  (`pickVariantSiblingRow`); `SKU_SUBSTITUTES` vacío y con test que prohíbe hermanos. Ver CLAUDE.md
  → "Hermanos de variante". **Pendiente: desplegar el watchdog en la MacBook de Bay 2.**

### ~~3. Registrar un SKU desde Double Check lo deja en `UNREG` y ofrece duplicarlo~~ <!-- id: bug-020 --> ✅ 2026-08-26
- **Síntoma:** tras long-press → "Bici o Parte" → guardar, la tarjeta sigue en rojo (`UNREG`, LOC
  `-`) y otro long-press vuelve a ofrecer registrarlo.
- **Causa:** `sku_not_found` era una bandera escrita una vez en el intake y nadie la recalculaba
  (el auto-resolve de DoubleCheckView cura `location` e `insufficient_stock`, nunca esta); el modal
  ofrecía registrar cuando no había filas **con stock**, y el prefill siembra `quantity: 0`; además
  `executeSave` en `add` escribía `sku_metadata` antes y sin esperar al inventario → 96 filas
  fantasma sin inventario en prod.
- **Fix:** migración `20260826180000`: el trigger `a_stamp_item_sku_metadata` deriva
  `sku_not_found` (= no hay `sku_metadata` con ese sku exacto) en cada write de `items`, y
  `zz_touch_open_orders_for_sku` re-sella las órdenes abiertas cuando un SKU entra al catálogo;
  el cliente toma la bandera del row (`mergeDerivedItemFlags` en `usePickingSync`) y la tarjeta la
  cura en vivo (`registeredStock`); el modal solo ofrece registrar si no existe **ninguna** fila y
  lista las de 0 con Editar; el alta hace inventario primero y metadata después.
- **Limpieza (`20260826200000`):** vista `v_sku_metadata_orphans`; 81 huérfanas sin historial
  borradas, 2 fotos movidas al hermano canónico (`650009 → 65-0009`, `860023BK → 86-0023BK`), 15
  se quedan (14 con historial de renames + `TEKTR0R-340` con foto). Ship/PartsWeightEditor pasan
  de `upsert` a `update` de peso; el trigger de re-sellado cubre DELETE y rename.

---

## Descartado

| Item | Razón |
|------|-------|
| Sesión inactividad 5min | Cada picker usa su propio dispositivo |
| Barcode/QR (idea-001) | PDFs parseados automáticamente |
| Analytics Dashboard (idea-003) | Sin volumen suficiente |
| Smart Rebalancing auto (idea-004) | Sugerencias manuales ya existen |
| Persistent Preferences (idea-005) | Solo LUDLOW, theme en localStorage |
| Optimistic UI Fixes (task-006) | Mitigado por staleTime + refetchOnWindowFocus |
| Offline Sync (bug-001) | Sin reportes de fallos reales |
| History en perfil (idea-035) | Cubierto por filtros en HistoryScreen y OrdersScreen |
| Resumen diario soft per-user (ID original idea-041, conflicto con `/activity-report`) | Brainstorm orphan, sin commits. El team detail de `/activity-report` cubre el caso. |
| Auto-cancel → expiración (idea-031) | Nada expira; liberación manual. La rama verification 24h fue eliminada en idea-053. |
| Automatic Inventory Email (idea-007) | 2026-04-22 — `send-daily-report` nunca se usó en operación; eliminada del runtime para cerrar endpoint sin auth. Snapshot R2 sigue activo vía `daily-snapshot`. `0d85fc2`. |
| Separar (un-merge) órdenes combinadas (idea-128) | descartado por el operador 2026-06-09 ("olvida 128") |
| Bug de dirección (imagen de Roman) (idea-133) | retirado 2026-06-10 (operador: quitar del backlog) |
| Auto-captura/envío de órdenes — refinar (idea-136) | retirado 2026-06-10 (operador: quitar del backlog) |
