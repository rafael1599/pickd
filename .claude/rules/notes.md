---
paths:
  - 'src/utils/systemNotes.ts'
  - 'src/utils/orderNoteSignals.ts'
  - 'src/utils/led/**'
  - 'src/components/ui/LedSign.tsx'
  - 'src/components/ui/ledRenderer.ts'
  - 'src/features/picking/hooks/usePickingNotes*.ts'
  - 'src/features/picking/components/OrderNotesInline.tsx'
  - 'src/features/picking/ship/utils/shipNotes.ts'
---

# Notas de orden (`picking_list_notes`) y el letrero LED

> Movido tal cual desde `CLAUDE.md` el 2 oct 2026 (pasaba el límite de 150k caracteres de
> instrucciones). Claude Code carga este archivo al trabajar con las rutas de arriba; los demás
> agentes lo encuentran por el índice de `CLAUDE.md`. Lo nuevo de esta área se escribe **aquí**.

### `picking_list_notes`: no toda nota la escribió una persona

Un cuarto de la tabla (95 de 389 filas al 20 ago 2026) nunca fue prosa: son datos estructurados
metidos en texto libre con un prefijo entre corchetes — `[Waiting]: …` (44), `[AUTO] Stale pick
location: …` (20), `[Parked]: 14D` (20), `[Resumed from waiting]` (11), más `[Cancelled from
waiting]` y `[Daylight]: …`. Cinco escritores habían inventado cinco formatos (`[AUTO]` se salta
los dos puntos que usan los demás) y cada lector se hacía su propio parser.

**`20260820190000` cerró eso.** `kind` (text) y `metadata` (jsonb) los rellena el trigger
`tr_picking_list_notes_set_kind` desde el mensaje, vía `classify_picking_note(text)`. Igual que
`tr_sku_metadata_set_is_bike`: **solo rellena lo que viene NULL, así que un valor explícito siempre
gana**. ~~`kind IS NULL` ⇒ lo escribió una persona~~ — **falso (11 sep 2026, idea-179):** 271 de las
343 notas con `kind` NULL las escribió PickD sin prefijo: las correcciones de Edit Order («Replaced
03-3768BL → … [REBOX → ROW 43]: Location») y las RPC de ciclo de vida («Order reopened for editing.
Reason: …»), más dos tags que el trigger no conoce (`[Add-On]`, `[Take Over SKU]`). El TS las reconoce
ya (`SYSTEM_NOTE_TEMPLATES`, kinds `correction` / `order_event` / `addon` / `take_over_sku`); la DB
todavía no — va con la migración de la fase 2 de idea-179, y rellenar `kind` en las filas viejas es un
cambio de datos que espera el ok de Rafael. Mientras tanto, «humana» es `isHumanNote()`, nunca
`kind IS NULL` en SQL.

- **El trigger clasifica, no los RPCs.** Las cuatro funciones SQL que escriben notas
  (`mark_picking_list_waiting`, `unmark_picking_list_waiting`, `add_parked_location_note` y las de
  quick-group) quedaron **sin tocar** a propósito: sus cuerpos no pueden divergir de la regla si no
  la contienen. Añadir un séptimo tag es una rama en `classify_picking_note` y una línea en
  `SYSTEM_NOTE_TAGS`, en ningún otro sitio.
- **El cliente inserta solo `message`.** Nunca nombra `kind` ni `metadata` en un write, y por eso el
  frontend puede desplegarse antes o después de la migración sin la ventana de 400 que describe el
  checklist post-merge de más abajo. Los reads usan `select('*')`, que tolera columnas ausentes.
- **Espejo en TS: `src/utils/systemNotes.ts`.** La DB es la autoridad; el TS existe para que la UI
  ramifique sin round-trip y para clasificar la nota optimista antes de que vuelva del servidor.
  **Mantener ambos en sync**, igual que `skuDefaults.ts` y `classify_picking_list_fedex`.
- **Los lectores preguntan `isSystemNote()` / `noteKind()` / `noteMetadata*()` — nunca hacen match
  de prefijos a mano.** `noteKind` lee la columna y cae al prefijo solo para filas anteriores a la
  migración. Si te encuentras escribiendo `.ilike('message', '[Algo]:%')` o `startsWith('[…')`, es
  el bug que esta sección existe para evitar.
- **Qué se enciende (`OrderNotesInline`), desde el 11 sep 2026 (idea-179):** la nota AS400 de
  **cada miembro** y lo que escribieron personas. Lo que escribió PickD (tags y plantillas) vive en el
  historial, y la facturación («FREE FREIGHT», «NET 60», «FF N30 W/FLA») no se enciende. La lectura es
  `utils/orderNoteSignals.ts` (señales, no un tipo: #881400 «HOLD FOR ADDS PICK-UP ORDER» es pickup y
  hold; «SHIP W/ 881424» es un compañero que deja de frenar al combinarse; «SHIP WITH REN» es un
  HOLD · REN), con la tabla de casos de notas reales en su test; `meaningfulNote` (Double Check)
  delega en ella. Antes ganaba la humana más reciente y, como las plantillas de PickD tenían `kind`
  NULL, «Replaced …» tapó la nota AS400 en 54 órdenes.
- **Es un letrero LED con las dos notas más nuevas** (Rafael, 11 sep 2026: «las dos últimas notas»;
  `latestNoteEntries` — la AS400 vino con la orden, así que es la más vieja), cada una en el color de
  su señal más fuerte (PICK UP rojo > HOLD ámbar > SHIP WITH azul > DELIVERY cian > NOTE blanco). **Lo
  que frena un envío no depende de cuáles se ven:** el chip de `ShipFeedCard`, la confirmación del
  camión y Start Shipping leen `blockingLines` sobre **todas** (`ship/utils/shipNotes.ts`). Dos
  tamaños, elegidos por Rafael en un banco de pruebas: **large** en Ship, bajo los cuatro números
  (fuente 6×10 en 12 filas, un LED cada 4 px = 48 px de alto) y **small** en cada tarjeta del Live
  Board (5×7 en 9 filas, 3 px = 27 px). Por defecto **ROTATE**, el texto corre de derecha a izquierda
  para que una nota larga se lea entera; **mantener presionado** el de Ship pasa a HOLD / FLASH /
  ROLL UP / WIPE (los modos del protocolo de letreros Alpha) y el letrero dice el nombre; el modo es
  del dispositivo (`hooks/useLedMode.ts`), así que el board lo sigue. Tocar abre el historial. No
  reinventa lo difícil: las fuentes son las X11 misc-fixed de dominio público que usan los paneles
  de `hzeller/rpi-rgb-led-matrix` (`utils/led/ledFonts.ts`, generado de las BDF) y lo que se ve en
  cada instante es puro y con tests (`utils/led/ledText.ts`); `components/ui/LedSign.tsx` +
  `ledRenderer.ts` solo pintan — un atlas de letras y **un solo** requestAnimationFrame para toda la
  página, y un letrero fuera de la vista no dibuja (cada letrero son ~20 copias de imagen por
  cuadro, y solo cuando el texto avanza un LED). Con _reduced motion_, HOLD. **En COMPLETED del board
  se queda quieto** (Rafael, 11 sep 2026: «en completed orders no se mueve la nota, se mantiene
  firme; en el resto de actividades de la orden se muestra moviéndose»): las notas desde su inicio
  hasta la última palabra entera, dibujadas una vez (`still`, que no es un modo de los que se
  recorren). Ship corre siempre — ahí es donde se lee la nota entera. **La tarjeta combinada del board
  lleva `members`** (lo pone `mergeGroupOrders`), así que su letrero lee las notas de todos los
  miembros, no solo del ancla; la del grupo FedEx (`FedexGroupCard`) lleva el mismo letrero.
- **`usePickingNotes` es TanStack Query**, una entrada de caché por `list_id`, y el realtime es
  **una sola** suscripción montada en `LayoutMain` (`usePickingNotesRealtime`). La tabla entró en la publicación
  `supabase_realtime` el 26 sep 2026 (`20260926230132`, bug-033): hasta entonces ese canal no recibía
  nada y una nota sólo aparecía en otro teléfono al recargar. Antes abría un canal
  **por instancia** — y el hook se monta por card, así que un board lleno abría un canal por card,
  cada uno sin filtro server-side, recibiendo todos los inserts del sistema. No añadas
  `supabase.channel` para esta tabla.
- **`isFetched`, no `!isLoading`.** Quien no pueda actuar sobre "no hay notas" antes de saberlo (el
  dedup de `[AUTO]`, el aviso de Daylight) tiene que usar `isFetched`: `isLoading` también es
  `false` en el frame anterior a que arranque el fetch.
