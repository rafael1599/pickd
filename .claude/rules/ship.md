---
paths:
  - 'src/features/picking/ship/**'
  - 'src/features/picking/ShipScreen.tsx'
  - 'src/features/picking/pallets/**'
  - 'src/components/orders/**'
  - 'src/utils/palletDims.ts'
  - 'src/utils/palletLayout.ts'
  - 'src/utils/combineOrders.ts'
  - 'docs/prds/shipments.md'
---

# Ship (la estación de envío), tarimas y `shipments`

> Movido tal cual desde `CLAUDE.md` el 2 oct 2026 (pasaba el límite de 150k caracteres de
> instrucciones). Claude Code carga este archivo al trabajar con las rutas de arriba; los demás
> agentes lo encuentran por el índice de `CLAUDE.md`. Lo nuevo de esta área se escribe **aquí**.

## Ship (la pantalla de la estación de envío)

**Existe por cuatro números: pallets, bikes, parts, weight.** Pallets y peso total se teclean en
**Audit Source** (Rafael, 27 ago 2026: el sistema donde una carga regular se cotiza, se elige el
carrier y se genera el tracking; pide tienda/cliente, calle y número, zip, pallets y peso total) o
el envío va por el sistema FedEx. Un total mal es un envío mal — el 27 ago la estación sumó cada
bici en la calculadora (bug-021/022). Todo lo demás del card sirve a esos números; ver
`docs/warehouse-user-flows.md` (Flow 3) para el proceso y `docs/weekly-report/LESSONS.md` para el
vocabulario ("the FedEx system", nunca "Ship Manager", en informes).

- **Cifras, no frases** (regla 7 de `ui-rules`): lo que la estación teclea se muestra como los
  cuatro números (cifra grande + etiqueta corta), nunca como párrafo. `useFitFontSize` escala las
  cifras al ancho y **nunca parten de línea**.
- **E-bike = cartón aparte** (idea-167, PRD `docs/prds/ship-ebike-declaration.md`): Audit Source
  la pide fuera del pallet aunque viaje dentro. Fila `1 CARTON · 1 HUDSON E2 · 80 LBS` (+ medidas
  enteras redondeadas arriba en FedEx) con copiar, y **la e-bike sale de Bikes y Weight** — con
  ambos, Audit Source la recibía dos veces. Detección: `utils/electricBikes.ts`. Si la orden es solo
  e-bikes, los cuatro números se esconden.
- **El card es el dibujo de Rafael** (28 ago, `docs/layout-lab/`): cabecera en una línea (números
  completos · logo · nota · fecha · tile de fotos · ⋯), dirección y ZIP en una línea, fila de
  carrier = etiqueta + los que caben (`carrierPicker.ts`: FedEx nunca en orden regular, FedEx sola
  en orden FedEx, el elegido siempre) + aviso Daylight solo con Daylight elegido + load #, los
  cuatro números, la fila e-bike, fotos en columna a la derecha que crece (`PalletPhotoRail`).
  **Todo botón vive en el menú ⋯** (`OrderActionsMenu`: Print pallet labels primero, packing slip,
  Picking Summary, Notes, Split/Uncombine, manual hazmat en FedEx, Reopen/Restore/Continue, Delete).
  Las alertas de contenido (litio en FedEx, zona PAV) son **una píldora pulsante** (`ShipAlertsButton`,
  idea-161); la sugerencia de combinar es una oferta y sigue aparte.
- **Lista:** la columna Shipped trae hoy + las 10 enviadas más recientes (`useShipOrdersData`,
  `RECENT_SHIPPED`), agrupadas por día de envío, y sin pendientes se abre la última enviada. Era
  "solo hoy" desde el 14 jul (`2dad26b`). **Búsqueda de 5 en 5** (`SEARCH_PAGE_SIZE`, "Show 5 more")
  y el número exacto se trae aparte: un tope ciego escondió una vez una orden registrada — no volver
  a poner uno sin ese guardia.
- **Las bicis de niño tienen regla de tarima (28 sep 2026)** — `planKidsPallets` / `estimateKidsPallet`
  en `utils/palletDims.ts`: capas de 5 de canto, **90" máximo** con la madera (tope de toda tarima),
  **nunca más de 2 echadas**, las cajas **grandes abajo**; una tarima si caben, si no las mínimas,
  **cortando donde termina un modelo** si se puede y si no a **altura pareja**. #881677 (10 Capri + 15
  Laser) sale 57"/71" contra 58"/70" medidos. El «+/–» y las bicis tecleadas por tarima mandan sobre
  el plan, y **PALLETS / WEIGHT de arriba son la tabla**.
- **Si toda la carga cabe en una tarima, va en una** (Rafael, 29 sep 2026: «al combinar 2 órdenes de
  2 bicicletas cada una el resultado debe ser una orden combinada que sólo tiene 1 pallet»): con una
  sola tarima grande, las de niño van con ella —sean cuantas sean— si el armado con gravedad cabe;
  #881678/#881780 (1 HELIX + 3 LASER) salía en dos. El «+/–» del piso sigue mandando.
- **La orden abierta en Ship no se cierra porque cambie** (29 sep 2026): el realtime sacaba de la
  lista y deseleccionaba una enviada de otro día en cuanto algo escribía su envío (guardar una
  tarima), y parecía que la página se recargaba. Sólo una cancelada o borrada se cierra.
- **Un solo motor de tarimas para todo (28 sep 2026, Rafael: «tiene que ser unificado incluido dcv…
  pensamiento sistémico»)**: `planPallets(líneas, sets, { floor: pallet_dims, metaFor })` es lo único
  que decide tarimas — Double Check, Ship, el carrito (`countCartPallets`, `pallets_qty`), el Picking
  Summary y el recálculo de envíos. Lo que dijo el piso vive **sólo** en `pallet_dims` del envío:
  `bikes` por tarima (el lápiz de DCV y la cifra de Ship), `split` de niño («+/–» en los dos lados) e
  **`items`, la tarima que el picker arma a mano** («+ Add pallet» en DCV, `PalletBuilderModal`): se
  aparta primero con su ordinal y el resto se reparte alrededor. Las tarimas físicas se numeran
  primero y los contenedores al final; las dos pantallas enseñan la **posición** («3/5»). Las líneas
  entran **en orden de recogida** en las dos (`getOptimizedPickingPath`): otro orden son otras bicis
  en cada tarima. `redistributeWithOverrides` y el `useState` de DCV ya no deciden nada.
- **Tarimas parejas; la de 12, último recurso (5 oct 2026).** Rafael: «la preferencia debería ser
  distribuir en partes similares y dejar las de 12 grandes como último recurso». `calculatePallets`
  usa las mismas `ceil(total / 12)` tarimas pero las llena parejas (22 → 11 + 11, no 12 + 10). Con las
  de niño **solas en su tarima** al lado de las grandes, esa tarima recibe grandes **abajo** hasta
  emparejar mientras el armado quepa (#881828: 12 + 7 → 10 y 9); con **pocas** de niño encima de una
  grande, lo parejo es el total de la fila (#881764: 8 y 8). **El número tecleado manda siempre:** si
  las grandes no alcanzan a absorber lo que sobra, va a la de niño — antes volvía a la misma tarima y
  teclear 10 no cambiaba nada.
  Y **una cifra que contradice lo armado a mano suelta las tarimas armadas** de la carga
  (`builtToRelease`, `usePalletDims`): #881828, a mano 12 y 7, un 9 tecleado no movió nada (Rafael: «si
  funciona el lápiz pero cuando cambio directamente la cantidad desde el campo no se agrega»). La cifra es
  lo más nuevo; si coincide con lo que la tarima ya lleva a mano, no suelta nada.
- **Cambiar la cifra de bicis abre el lápiz con la propuesta marcada (5 oct 2026).** Rafael: «si de 8
  quiero pasar a 10 se me deben aparecer las 2 extras seleccionadas como en el menú de editar…
  intentando hacer coincidir las imágenes con lo que se recogió». En Double Check y en Ship la cifra ya no
  se guarda sola: `proposeSelection` (`pallets/palletProposal.ts`) marca qué entra o sale —primero lo que
  vio la última foto del frente de esa tarima (`In photo`; sólo en Double Check, donde está la foto),
  después las vecinas en el orden de recogida (`Suggested`: las primeras de la que sigue, luego las últimas
  de la anterior), y para quitar, la última cargada que la foto no vio (`Suggested off`)— y lo que se
  guarda es la tarima armada. Vaciar la casilla (o 0) sigue devolviéndola al cálculo.
- **La medida calculada es un armado, y Ship lo enseña (29 sep 2026, opción B de Rafael).**
  `layoutPallet` / `estimateLayout` (`utils/palletLayout.ts`) es **el único** cálculo de medidas de una
  tarima —la cifra en gris de Double Check, la tabla de Ship y el anfitrión de las de niño en
  `planPallets`—, **con gravedad** (skyline en el corte ancho × alto): las más altas primero, cada
  caja cae hasta lo más alto bajo su ancho y va donde quede más baja, así las cortas hacen **columna**
  junto a las altas en vez de flotar sobre un nivel plano (Rafael, 29 sep 2026: «no podemos jugar con
  la física»); el ancho de la carga = las 4 cajas más anchas hasta 10, 5 desde 11 (Rafael: 5 de canto
  «sólo cuando nos ahorramos una tarima extra por hacer una de 12») o 5 si es sólo de niño —y una
  5.ª en un nivel sí va de pie **si cabe dentro de ese ancho**: la regla es de ancho, no de cuenta
  (#880778: la 9.ª cabía en un hueco de 8" sobre una e-bike de 12")—, nunca más
  de 46" (`LEVEL_WIDTH_MAX_IN` = la madera de 40" + **3" por cada lado**, con el conjunto **centrado**
  entre izquierda y derecha — Rafael, 29 sep 2026: «no debe haber regla que restrinja el sobresalir 3"
  por cada lado»; una acostada va centrada sobre lo armado); hasta 2 acostadas, **encima y bien apoyadas** (nunca
  ladeadas), y el motor prueba **cuáles** acostar y se queda con la tarima más baja —acostada, una
  caja suma su grueso: el TAXI TRIKE de 14" de #881761 va de pie y se acuesta una CITIZEN—; **ninguna
  caja de pie se ladea** (Rafael, 1 oct 2026: «van ajustadas unas contra otras con el strap negro»):
  sin apoyo bajo el centro la sostienen sus vecinas —hasta ese día se inclinaba hasta 7° y sumaba
  alto—, y el film no suma (menos de un milímetro, 3 oct); ≤ 90". **El frente queda parejo** (Rafael: «la parte
  de adelante de una pallet debe quedar pareja… los otros lados no importan»): todas las puntas en el
  mismo plano (`placeBoxes`, `+z`, donde van las etiquetas). El 29 sep, contra 19 tarimas medidas con cinta, el error medio
  bajó de 4.5" a 3.0". **Desde el 3 oct ese número es un test** (`palletLayout.bench.test.ts`, 27
  tarimas de `shipments.pallet_dims`): **8,00"** con el reparto del motor, y 5,63" en las 4 cuya
  carga es un hecho (armadas a mano o envío de una tarima). La diferencia es casi toda de reparto
  —qué bicis le tocan a cada tarima—, que es lo que idea-245 viene a medir con los frentes; quitar el
  ladeo no movió ninguna de las 27.
  **`How to stack ▾`**, plegado al final de la tabla de tarimas de Ship, **la arma en 3D** (Rafael,
  29 sep 2026: «como si fuese videojuego», y **sin three.js**): WebGL2 puro en
  `components/orders/pallet3d/` (`scene.ts` el motor —un cubo instanciado y todo el aspecto en el
  shader—, `PalletBuilder3D.tsx` el HUD), medidas reales en pulgadas desde `placeBoxes`, la siguiente
  caja como fantasma, caída con rebote y zumbido, ◀ ▶ / Build, medidor hacia los 90", tocar una caja
  la nombra, cotas al terminar y la medida de cinta al lado. Se descarga aparte (`React.lazy`, ~28 KB)
  sólo al abrirlo, y la comprobación de WebGL2 vive en `pallet3d/support.ts` para no arrastrar el motor
  al trozo de Ship; sin WebGL2 cae a la lista en texto. **Double Check no lo lleva** a propósito.
  **Cada caja lleva su etiqueta real** (Rafael, 29 sep 2026: «la misma etiqueta que se extrae de las
  fotos se le puede poner en su lugar a cada bicicleta»): `order_label_reads(list_ids)`
  (`20260930022628`, security definer, porque `dcv_shadow_runs` sólo la lee un admin) devuelve por SKU
  la lectura de más confianza —foto y recuadro, **nunca el texto leído**, que puede traer guías de
  FedEx—; `pallet3d/labelAtlas.ts` baja la foto **pública** de 1200 px (`photos/gallery/<photo_id>.webp`,
  mismo id y misma proporción que la original de 3840) y **endereza la etiqueta con sus 4 esquinas**
  (30 sep 2026, `20260930124634`: la sombra guarda `boxes[].corners` en orden de lectura y el atlas
  usa `warpQuad`, la homografía del localizador) —sin cartón ni inclinación—; las lecturas anteriores
  no tienen esquinas y se recortan escalando el recuadro (el mismo día se rellenaron 120 de las 126
  cajas del 28–29 sep corriendo el motor actual sobre sus originales, sólo donde leía el mismo SKU;
  las 6 que faltan son fallos reales del localizador, uno por causa). Pone el lado largo como en la punta de una
  caja acostada (las verticales se giran 90°) y arma una textura
  2048 × 1024 con el logo JAMIS BIKES. **Dónde va, como en el cartón** (Rafael, 29 sep 2026): la
  etiqueta y un logo JAMIS BIKES chico al **frente** —las puntas—, derecha en una caja de pie y a lo
  largo en una acostada; los **costados**, sólo el logo grande. Se pide con `cache: 'no-store'` (skill `image-cors-cache-bust`). Un SKU sin lectura
  lleva una etiqueta **dibujada** con el catálogo, y el HUD dice «Not read · drawn». `estimatePallet` /
  `estimateKidsPallet` siguen existiendo sólo para `planKidsPallets` y sus tests.
- **Qué bicis lleva cada tarima se cambia con un lápiz (29 sep 2026, idea-239).** Rafael: «una lista
  simple de SKUs… para ver los que están seleccionados para esa pallet, pudiendo deseleccionarlos y
  seleccionar otros de la misma orden». El lápiz de cada fila de la tabla de Ship y el «+ Add pallet» /
  editar de Double Check abren **el mismo modal** (`PalletBuilderModal`, Modal Manager
  `pallet-builder`): las cajas de la orden, una por fila, marcadas las de esa tarima, las demás con la
  tarima donde están («on #3»). Guardar la deja **armada a mano** (`pallet_dims[].items`) y lo
  desmarcado vuelve al reparto; traer una caja de **otra tarima armada a mano** se la quita a esa
  (`applyPalletSelection`, `pallets/palletUnits.ts`, puro y con tests), o la contarían dos. Las bicis
  tecleadas por tarima siguen mandando: si la #1 dice 8 y le quitas una, el motor le pone otra.
- **Las etiquetas que imprime Ship llevan el logo del carrier (29 sep 2026).** En blanco y negro
  (`public/logos/transport/bw/`, `TRANSPORT_LOGOS_BW`: el color saturado y lo oscuro a negro, el
  blanco se queda —así se leen las letras blancas de R+L y RIST—; ABF sale de su SVG; si cambia un
  logo de color, regenerar el suyo) arriba a la derecha de la de datos y de cada «PALLET i of N», y
  el texto que le queda al lado se estrecha para no pisarlo. **Y una última etiqueta girada 90° a la
  derecha** (Rafael: «order number grande ocupando todo el alto del label, el bike shop más pequeño,
  x pallets, logo grande de carrier»); sin logo (PICK UP) va el nombre. El logo lo carga y lo gira
  `labelLogo.ts` en un canvas —el `addImage` girado de jsPDF mueve la imagen—; `generateShipLabel.ts`
  sólo coloca. Los tests de la girada no usan `expectNoTextOverlap`: el grabador mide todo texto como
  horizontal.
- **Una columna de copiar (29 sep 2026):** Order # (la combinada copia todos sus números), cliente,
  **teléfono**, **contacto**, calle y ZIP, cada uno en su fila con el copiar a la izquierda; al pasar
  sobre un copiar se ilumina en verde tenue lo que copia (`COPY_TARGET` + `group/copy`, en
  `components/ui/CopyButton.tsx`). El teléfono (`customers.phone`) y el contacto
  (`customer_addresses.contact_name`, el `Bike Buyer` del AS400 = el `CONTACT` del pack slip) los
  escribe el watcher, sólo para los clientes de las órdenes del día. **Los carriers van compactos**
  —los que caben en una línea y el elegido—: «⋯» abre los demás y tocar fuera de ellos los pliega
  solo (Rafael, 29 sep 2026, noche, deshaciendo el «todos de entrada» de esa mañana).
- **Cómo carga (idea-234, desplegada el 29 sep):** la lista pide `ORDER_LIST_LIGHT` (sin fotos,
  medidas ni personas) y la orden abierta el detalle de `ship/api/shipOrderDetail.ts`
  (`SHIP_ORDER_DETAIL_SELECT`, en caché de TanStack y precargado para la siguiente). Un campo nuevo
  que la tarjeta pinte **va en los dos** o sale vacío hasta abrir el detalle. `SHIPMENT_EMBED` vive
  solo en `ship/api/shipmentEmbed.ts`: lista y detalle se importan entre sí, y una constante suya
  que el otro evalúa al cargar revienta **sólo en el build de producción** («Cannot access … before
  initialization») con `tsc` y los tests en verde — probar Ship con `vite build` + `vite preview`.
- **Revisar en teléfono apaisado (~430 px)** antes de dar por hecho un cambio de Ship: es donde
  Rafael lo mira, y cada cosa que se parte, corta o trunca ahí es la siguiente corrección.

### `shipments`: el envío, en vez de la orden ancla (26 sep 2026, `docs/prds/shipments.md`)

Toda orden tiene un envío (`picking_lists.shipment_id`): los hechos del envío físico —tarimas y lo
que dijo el piso, fotos, carrier, load #, dirección, enviado— viven en `shipments`, una fila por
envío; `group_id` se queda sólo como lote de trabajo (209 de 218 grupos FedEx mezclan clientes, así
que el envío no podía ser `order_groups`). **Desde el 27 sep 2026 `shipments` manda**
(`20260927011500`): pantallas y RPC leen y escriben ahí; las columnas de envío de `picking_lists`
(`pallets_qty`, `pallet_dims`, `pallet_photos`, carrier, load #, `is_shipped`) quedan como historia.

- **El envío cambia sólo cuando una persona combina o separa** (Rafael, 26 sep: «un envío es lo que sale
  junto físicamente»), con `combine_into_shipment` / `split_from_shipment`, en cualquier estado,
  completadas incluidas. Cancelar, limpiar un grupo, soltar el lote FedEx o completar un Add-On **no**
  tocan el envío. Deducirlo del `group_id` fue el error de la fase 3: ese campo cambia por las dos cosas
  y desde la base se ven iguales.
- **Combinar y separar recalculan** tarimas (`planPallets`) y peso (`totalWeight`) en el cliente, dejan
  las medidas vacías (estimación gris), juntan las fotos al combinar y las dejan en la que sigue al
  separar. Direcciones o load # distintos → `CombineConflictModal`. Separar es **de una en una**
  («Uncombine Group» se retiró) y, si la regla de 5 bicis mandaría una orden a FedEx, un modal pide
  **Regular / FedEx**. Una enviada se desmarca antes.
- **Todo combinar y separar pasa por esas dos RPC**, venga de donde venga: Ship, el board (sugerencia y
  menú) y el carrito (Add-On, Ungroup). Separar es un solo módulo, `hooks/useOrderSplit.ts`
  (desmarcar si está enviada → modal Regular/FedEx → `split_from_shipment`). Un grupo **`fedex`** es sólo
  lote de trabajo: juntarlo o soltarlo toca `group_id` y nunca el envío. Y **al revés tampoco sirve de destino**
  (`20260929132003`): combinar abiertas con una que está en un lote FedEx crea un grupo `general` y las
  saca del lote, porque el board sólo junta y cuenta como una los grupos deliberados (`combinedCardKey`). Tras retirar el espejo, un
  `createGroup('general')` o `removeFromGroup` sueltos dejaban el envío atrás (27 sep, arreglado el mismo día).
- **Juntar hermanas es una sola función**, `combineOrdersCore` (`src/utils/combineOrders.ts`), para Ship,
  el board y la página pública: ancla = la más vieja por `created_at`, hechos del envío desde `shipment`,
  unidades sumadas. Lo que es sólo del board (estado agregado, llaves, `members`) vive en `mergeGroupOrders`.
- **Quien escribe un hecho del envío escribe `shipments`**: las seis funciones de la base que lo hacían
  en `picking_lists` ya lo hacen ahí (`process_picking_list`, `recomplete_picking_list`,
  `append/remove_pallet_photo`, `cancel_completed_order`, `quick_group_completed_orders`). El watchdog
  sólo llega al envío de una orden **suelta** (`sync_single_order_shipment`).
- **Las fotos de un lote FedEx van a todas sus órdenes** (Rafael, 27 sep 2026): el carrito referencia la
  misma foto en el envío de cada orden del grupo; que salgan bicis de otro cliente está bien mientras se
  vea la suya. No es un bug y no se «limpia».
- **Un trigger da envío a cada orden nueva** (`ensure_order_shipment`); FedEx nace sin load #; un lote
  FedEx nunca comparte envío. **Un envío no se borra**: uno sin órdenes se deja como historia.
- **No hay builds viejos**: `reset_epoch` en `version.json` (`vite.config.ts`) y `AppResetGuard` obligan
  una vez a «Update to continue», que borra los datos locales de PickD y conserva la sesión. Subir el
  número es la herramienta para el próximo cambio que no admita clientes viejos.
