---
paths:
  - 'src/features/scratch-and-dent/**'
  - 'src/features/labels/**'
  - 'src/features/inventory/**'
  - 'docs/sd-sheet/**'
  - 'supabase/functions/sd-sheet/**'
---

# Scratch & Dent, etiquetas de caja, el Sheet de S/D y los filtros de Stock

> Movido tal cual desde `CLAUDE.md` el 2 oct 2026 (pasaba el límite de 150k caracteres de
> instrucciones). Claude Code carga este archivo al trabajar con las rutas de arriba; los demás
> agentes lo encuentran por el índice de `CLAUDE.md`. Lo nuevo de esta área se escribe **aquí**.

**El nombre de una S/D termina en `S/D` (30 sep 2026; `SD` → `S/D` el 1 oct).** Rafael: «SD debe ir
al final en el nombre completo» y, al día siguiente, «de sd a S/D». `inventory.item_name` de toda S/D es
el nombre completo (modelo, talla, color, lo que haya) y **`S/D` al final** (`20261001192600`, que
reescribió las 252 que terminaban en `SD`); cualquier `S/D` o `SD` en otra posición se quita. Lo hace la base
(`20260930150819`): **marcar** un SKU como S/D (`is_scratch_dent` false → true, o un INSERT ya
marcado) pone el sufijo en todas sus filas y **desmarcarlo** lo quita
(`tr_sku_metadata_sd_item_name`), y `tr_inventory_sd_item_name` lo conserva cuando alguien reescribe
el nombre de una S/D. Hacía falta ese segundo trigger: `ItemDetailView` rehace el nombre desde
modelo/talla/color y escribe inventario y catálogo sin esperarse, y `createUnit` marca el catálogo
antes de crear la fila, así que con sólo el de marcar el sufijo se perdía en los tres caminos. La
regla es `sd_item_name()` / `strip_sd_item_name()` en SQL; no tiene espejo en TS. El Excel de S/D
(Stock → S/D → ⋯) enseña sólo ese nombre, sin columnas de modelo, talla ni color.

**Toda etiqueta de SKU es 6×4 horizontal con QR y código de barras, y una S/D lleva su número (30 sep
2026).** Rafael: «todos los labels se imprimirán en horizontal ahora, con su serial y qr». Ya no hay
vertical ni interruptores de QR/código de barras (la ventana de imprimir sólo pregunta cantidad y UPC);
el código de barras se queda aunque nadie lo escanee todavía, porque viene una pistola. El serial no
se imprime si es el mismo SKU (`serialRepeatsSku`). **Cada S/D recibe `#n` la primera vez que se
imprime**, en el orden del trabajo (`assign_sd_numbers`, `20260930162930`): el número se guarda en
`sku_metadata.sd_number` (único; `protect_sd_number` impide cambiarlo), cada reimpresión lo repite,
nunca se reutiliza —una S/D vendida o desmarcada lo conserva— y puede haber huecos (un PDF abierto y no
impreso ya lo gastó). La numeración empezó el 30 sep en #1, sin rellenar las anteriores. Toda unidad
sale en **dos juegos**: el de una S/D es **su etiqueta y después una hoja sólo con `#n`**, lo más
grande que quepa (`computeSdNumberFace`) —etiqueta, #n, etiqueta, #n—; lo demás, la etiqueta sola dos
veces. **Sin UPC y con una sola unidad no hay nada que preguntar y se imprime directo**; la opción de
UPC sólo aparece si el SKU tiene uno (`printNeedsOptions`). **Todo lo impreso va en MAYÚSCULAS** (Rafael, 1 oct 2026: nombre, color, talla, serial, UPC, made in, P/O), aunque el registro guarde otra cosa: se aplica en `computeLabelFace` antes de medir, así la letra se ajusta al ancho de la mayúscula; sólo las etiquetas de caja, no los reportes. Una S/D es una bici por SKU; si hubiera varias
unidades, todas llevan el mismo número. Se ve en grande en el detalle del ítem y como `SD #` en el
Excel de S/D. **Label Studio (`/labels`) se eliminó** el mismo día: nadie lo usaba; se imprime desde el
detalle del ítem y desde el menú de la tarjeta de Stock.

**El número nunca se recicla, y pasado el 99 sigue con letra (Rafael, 7 oct 2026,
`20261007144844`).** En la caja se imprime el código corto `sdCode` (`src/utils/sdCode.ts`, espejo
`public.sd_code()` en SQL y en `sd-sheet`): `1`…`99`, `1A`…`9Z`, `100`…`999`, `10A`…`99Z`, `1000`…
Mayúsculas y sin I, L, O, que en la caja se leen 1 y 0. La columna sigue entera (ordena y es única);
el código es sólo cómo se enseña, y el Excel y el Sheet dan el número tal cual hasta 99. **Renombrar
una S/D numerada conserva el número**: `rename_sku_everywhere` lo suelta del SKU viejo antes de copiar
la ficha (con el índice único, todo renombre de una S/D con número fallaba: #73 no se podía
corregir). `split_unit` copia también `as400_description` del modelo.

**Una S/D, un SKU: el alta no deja meter otra bici bajo un número que ya es una S/D en un estante
(1 oct 2026).** El 29 sep una Xenith se registró con `01-0357` —el número de su caja—, que ya era
la Hudson S/D: dos bicis detrás de **una** fila de catálogo, una foto, un serial y un modelo para
las dos, y cada foto pisaba la otra. `useScratchDentHolder` (`ItemDetailView/itemCardShared.ts`)
bloquea Register y dice qué bici tiene el número (nombre · serial · fila); una S/D ya vendida, sin
stock, no bloquea. Es sólo del formulario: el lote por fotos y las RPC no lo comprueban.

**Reusar el SKU de una S/D vendida archiva la vieja (7 oct 2026, idea-257 P1, `20261007155522`,
`docs/prds/sd-units-reuse.md`).** Rafael: «mantener el historial y a la vez reutilizar SKUs de bicis ya
vendidas… así evito tener que ponerle 01-8496NV a los 01-8496». Una S/D viva sigue siendo su fila de
catálogo; cuando una bici nueva llega al SKU de una vendida, la vendida pasa a **`sd_units`** (llave para
la gente: su `#`; `catalog` = la fila tal cual era, portada, cómo y cuándo salió) y sus logs y fotos
extra quedan marcados con `sd_unit_id`: la ficha viva no los enseña y un renombre no los mueve. La
regla es **`sd_sold_unit(sku)`** (nada en un estante, y es S/D o un `01-` con salida registrada) y la
acción **`archive_sd_unit`**, que deja la fila limpia (sin serial, foto, AS400 —el watchdog lo vuelve a
leer—, medidas de bici por defecto, `sd_number` NULL: la primera impresión da un `#` nuevo). Pasa sólo en
dos puertas: **Register** (línea ámbar `▲ SOLD …`, no rellena con la bici vieja, y al REGISTER copia la
portada con el modo `archive` de `upload-photo` y archiva; si la copia falla no registra) y
**`rename_sku_everywhere`** sobre un SKU vendido (archiva y copia la ficha entera, sin fusionar). Nada
automático al llegar a 0 y ningún botón «Reuse». La ficha enseña **BEFORE** (`SdUnitHistory`). Lo que
falta (separar con el serial como SKU, AS400 review, buscar lo archivado) son P2–P4 del estudio.

**Mark as S/D en un SKU con varias unidades separa una con su serial como SKU (7 oct 2026, idea-257
P2, `20261007163942`).** La ficha pide el serial (`sd-serial`) y `split_unit` (`kind = 'sd'`) saca una
unidad: SKU = el serial, `base_sku` = el modelo, el resto sigue nuevo — la forma de #74
(`Y21K012242` → `03-3606BL`). Sin serial, **`SD<código>`** (`SD85`) con el `#` dado en ese momento.
Si el SKU elegido es una S/D vendida, la archiva primero y reusa su fila. **Ya no nace ningún `-SD1`**;
lo de abajo es historia y las dos que existen se quedan hasta que el AS400 les dé su `01-`. Con una sola
unidad, Mark as S/D sigue marcando el SKU entero.

**Una S/D con el SKU de bicis nuevas se separa a `SKU-SD1` (6 oct 2026).** Rafael: «se les debería
agregar -SD al final para que se diferencien temporalmente del stock regular como las photo bikes».
#78 (`03-3769BL`, 65 nuevas en ROW 41) y #76 (`03-4040BK`, 14 nuevas en ROW 24) tenían **todo el SKU**
marcado como S/D: una orden de esas bicis podía mandar a la de ROW 12 y el SHIP CHECK lo avisaba en
rojo. Ahora son `03-3769BL-SD1` y `03-4040BK-SD1`: `split_unit` (el mismo de las PH, `unit_kind =
'sd'`, `base_sku` = el modelo) movió la unidad de ROW 12 · H, y el número S/D, el serial, el «For sale»
y las fotos pasaron a la ficha nueva —el número con la reparación declarada
`pickd.sd_number_repair = on`—. El modelo volvió a `new`, sin « S/D» en el nombre. Las etiquetas S/D
impresas llevan el SKU viejo: hay que reimprimirlas. Si el AS400 les da su `01-NNNN`, se renombran a ese.

**Las S/D numeradas viven en ROW 12, una pallet por decena (1 oct 2026):** A = #1–9, B = #10–19,
C = #20–29, D = #30–39, E = #40–49, F = #50–59 (59 bicis, movidas con MOVE el mismo día, sin nota:
Rafael no quiere notas en los movimientos). El 2 oct siguieron G = #60–69 y H = #70–79 (#70 el primero).

**El Google Sheet de S/D es un espejo de PickD y escribe de vuelta seis columnas (1–2 oct 2026,
`docs/sd-sheet/README.md`).** La pestaña S&D bikes se compara cada minuto con la edge function
`sd-sheet` (las S/D en stock, por `SD #`) y se reescribe si difiere, así que lo que se borre u ordene
a mano vuelve solo. De vuelta entran Category, Condition, Condition description, Serial, Internal
note y PDF link, **una celda a la vez**, y toda regla vive en `sd_sheet_apply_edit` y no en el
script, porque quien edita el Sheet puede leer su script y sus claves: compare-and-set contra el
valor que PickD tiene para ese SKU (una hoja ordenada no escribe en otra bici), un blanco nunca
escribe (`-` en las listas vacía el campo), 30 intentos por minuto y 300 por hora, y cada intento
queda en `sd_sheet_edits`. `sd_sheet_revert(desde[, true])` deshace y `app_flags.sd_sheet_write` lo
apaga. Las listas son copia de `SdDetailsCard.tsx` en `sd_sheet_options()`: si cambian allá,
cambiarlas acá.

**Si una S/D se puede vender lo dice `sd_for_sale`, y es sólo un aviso (2 oct 2026,
`20261002155859`).** Rafael: «la marca de non sellable o going to S/D … para saber si no es vendible, o
no es vendible todavía hasta que se marque como sellable». Tres valores, que el Excel de S/D (columna
**For sale**, justo después de Name), el Sheet espejo (editable, con desplegable) y la tarjeta de S/D
del detalle (tres botones arriba) enseñan como **`Yes` / `Not yet` / `No`**: `yes` se vende, `not_yet`
espera revisión, `no` no se va a vender. **No bloquea nada** —ni órdenes ni movimientos—. Columna
propia a propósito: `condition` es el estado físico (una bici puede estar «New · unbuilt» y no estar a
la venta) y `sd_category` el tipo de S/D. Una S/D **nace en `not_yet`** (`tr_sku_metadata_sd_for_sale_default`,
al marcarla o al insertarla ya marcada), así que ninguna se vende antes de que alguien la revise; de las
195 que ya existían, 181 quedaron en `yes` y 14 en `no`. **En `no` desde el primer día** (Rafael): las 7 Xenith S/D
(«no se van a vender, aún están en duda») y Aurora Elite #60, 01-0135, Sputnik #40, las tres Dakar
(01-0176, #24, #14) y Eclipse Carbon #13. COMET no es una S/D en PickD (sólo potencias `98-857x`). Las
etiquetas viven en cuatro sitios: `sd_for_sale_label()` / `sd_sheet_options()` en SQL,
`SD_FOR_SALE_OPTIONS` (`SdDetailsCard.tsx`) y `FOR_SALE_LABEL` en el Excel y en `sd-sheet`; cambiar uno
es cambiar los cuatro. **Pendiente (2 oct 2026):** pegar el `apps-script.gs` nuevo en el Sheet para que
For sale tenga desplegable; sin eso la columna sale y se escribe a mano igual. La clave `SD_SHEET_TOKEN`
no está en el Llavero de la Mac, así que el GET de `sd-sheet` con la columna nueva no se probó desde aquí
(sólo que arranca: 401 sin clave) — lo confirma la primera sincronización del Sheet.

**La vista Stock filtra como Amazon/eBay (1 oct 2026).** Botón **Filters** + un chip por selección
(`StockFilterBar`) y el panel `StockFilterSheet` (Modal Manager `stock-filters`): Model (línea →
modelo), Size, Color con muestra, Model year (el año del nombre), Location (bay → fila), Type,
Condition, unidades en el sitio y Photo. La lógica es pura en `inventory/utils/stockFacets.ts`:
**OR dentro de una faceta, AND entre facetas, y los números son disyuntivos** —cada faceta se cuenta
con todas las demás aplicadas menos ella—. Sin búsqueda filtran **el catálogo entero de bicis**
(`useBikeCatalog`, bajo `INVENTORY_ROOT_KEY` para que realtime y las mutaciones lo parcheen), no la
primera página de 50; con búsqueda filtran sus resultados. El estado vive en la URL (`?size=17"`).
Parts y FedEx Returns no los llevan. Los bays son una suposición sin confirmar: ROW 1–17 Bay 2,
18–40 Bay 3, 41+ Bay 1 (`locationArea`).

**El buscador de Stock busca por SKU por defecto y cambia solo con las letras (2 oct 2026,
`20261002174633`).** Rafael: «por defecto se busque por sku, pero cuando se detecte que se están
escribiendo letras se cambie a la búsqueda por nombre, modelo, row… si es sku que se ponga
automáticamente el guion». Un chip dentro de la barra (`StockSearchModePicker`) dice cómo se está
buscando y deja fijar uno: **Auto** (default), SKU, Name, Location, Serial. En Auto, un término con
forma de SKU a medio escribir (`03`, `03-47`, `034710BL`) va **sólo** a la columna SKU y lleva guion
tras los dos primeros dígitos; con letras, o 7+ dígitos (UPC), busca en todo como siempre (`ANY`). El
guion sólo se pone cuando el texto crece, así que borrar no pelea. La regla vive en
`inventory/utils/stockSearch.ts` y llega a la RPC como `p_field` (`all` | `sku` | `name` | `location`
| `serial`; `all` es el default y da exactamente lo de antes). Location compara sin espacios
(`ROW12` = `ROW 12`). No hay espejo en otro sitio.
