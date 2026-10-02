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

**Una S/D, un SKU: el alta no deja meter otra bici bajo un número que ya es una S/D en un estante
(1 oct 2026).** El 29 sep una Xenith se registró con `01-0357` —el número de su caja—, que ya era
la Hudson S/D: dos bicis detrás de **una** fila de catálogo, una foto, un serial y un modelo para
las dos, y cada foto pisaba la otra. `useScratchDentHolder` (`ItemDetailView/itemCardShared.ts`)
bloquea Register y dice qué bici tiene el número (nombre · serial · fila); una S/D ya vendida, sin
stock, no bloquea. Es sólo del formulario: el lote por fotos y las RPC no lo comprueban.

**Las S/D numeradas viven en ROW 12, una pallet por decena (1 oct 2026):** A = #1–9, B = #10–19,
C = #20–29, D = #30–39, E = #40–49, F = #50–59 (59 bicis, movidas con MOVE el mismo día, sin nota:
Rafael no quiere notas en los movimientos).

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
