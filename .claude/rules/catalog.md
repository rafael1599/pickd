---
paths:
  - 'src/utils/skuNormalize.ts'
  - 'src/utils/bikeDetection.ts'
  - 'src/utils/skuDefaults.ts'
  - 'src/utils/size.ts'
  - 'src/utils/modelAbbreviations.ts'
  - 'src/features/inventory/**'
  - 'src/features/picking/utils/stockIssue.ts'
  - 'scripts/backfill-catalog-from-as400.mjs'
---

# Catálogo de SKUs: `sku_metadata`, forma canónica, `is_bike`, hermanos, color y talla

> Movido tal cual desde `CLAUDE.md` el 2 oct 2026 (pasaba el límite de 150k caracteres de
> instrucciones). Claude Code carga este archivo al trabajar con las rutas de arriba; los demás
> agentes lo encuentran por el índice de `CLAUDE.md`. Lo nuevo de esta área se escribe **aquí**.

**`sku_not_found` es derivada, no almacenada (`20260826180000`, bug-020).** Significa una sola cosa,
la misma que ya usan `process_picking_list` y `compensate_picking_list_changes`: _no hay fila en
`sku_metadata` con ese sku exacto_. La deriva `a_stamp_item_sku_metadata` en cada write de `items`
(**siempre sobrescribe** — es un hecho del catálogo, no un input; a diferencia de `is_bike` y `kind`,
que solo rellenan NULL) y `zz_touch_open_orders_for_sku` re-sella las órdenes no terminales cuando
un SKU entra al catálogo, así que registrar desde Double Check cura la orden sin que nadie la abra.
El cliente toma la bandera del row por realtime/polling (`mergeDerivedItemFlags`, solo esa bandera,
nunca `items` entero) y `DoubleCheckView` la pinta en vivo desde las filas que ya carga
`fetchDistributions` (`registeredStock`). Una grafía distinta (`010530` vs `01-0530`) sigue siendo
_not found_ a propósito: eso es idea-154. Consecuencia visible: un ítem añadido a mano con un SKU
sin registrar ahora sale `UNREG` en vez de decir `false` y hacer que `process_picking_list` busque
una fila que no existe. **El alta desde el formulario escribe inventario primero y metadata
después** (`ItemDetailView.executeSave`, modo `add`): el orden inverso, sin esperar, dejó 96 filas
de `sku_metadata` sin inventario, y con la bandera derivada una fantasma "registra" el SKU para
todas las órdenes abiertas.

**Huérfanas de `sku_metadata` (`20260826200000`):** una fila de catálogo sin fila de inventario. La
historia (`inventory_logs`, `daily_inventory_snapshots`, `asset_tags`, conteos, returns) es texto
denormalizado sin FK al catálogo, así que **borrar una fila de catálogo nunca toca la historia**; lo
que sí la rompería es borrar logs o renombrar sin reescribir el texto (como hizo `20260814020000`).
La regla vive en la vista **`v_sku_metadata_orphans`** (`has_history`, `in_open_order`,
`has_image`): con historial se queda (es la memoria de un nombre que tuvo stock — `Y22B010415 →
01-288`, `128338BK → 12-8338BK` — y idea-154 los fusiona a mano); sin nada, es ruido y se borra; una
foto se mueve al hermano canónico si no tiene y, si no hay hermano, la fila se queda
(`TEKTR0R-340`). El 26 ago se borraron 81 y quedaron 15. Ya nadie las fabrica: el alta escribe
inventario primero, y Ship/PartsWeightEditor hacen `update` de peso, nunca `upsert` (un upsert bajo
el sku de un ítem sin registrar era un INSERT). `zz_touch_open_orders_for_sku` también corre en
DELETE y en rename, así que quitar un nombre del catálogo devuelve a `UNREG` las órdenes abiertas
que lo nombran. Si `select count(*) from v_sku_metadata_orphans where not has_history` deja de ser
~1, algo volvió a abrir el grifo.

**Un color, una grafía (11 sep 2026).** `sku_metadata.color` alimenta un filtro de coincidencia
**exacta** en Scratch & Dent (`.eq('color', …)`) y un desplegable armado con los valores distintos.
Tenía **163 valores para 113 colores**: `Blue`/`BLUE` (90 filas), cuatro grafías de `gloss black` (71
filas, una con espacio al final). El trigger `normalize_sku_color` (`20260911152510`) guarda siempre
MAYÚSCULAS sin espacios de sobra, y vacío se guarda como NULL. **Si se quiere bonito, es Title Case al
pintarlo, no al guardarlo.**

**Una talla, una grafía (23 sep 2026, idea-224).** `sku_metadata.size` tenía **95 grafías para 65
tallas** (`17` ×87 y `17"` ×25; `54` y `54cm`; `26"*18"`, `26"X18"`, `26"x18"`). El export de FedEx
ya las agrupaba bien —`renderSizeForExport` las pliega—; lo sucio era lo guardado, que es lo que ve un
desplegable o un filtro exacto. La regla sigue viviendo **sólo** en `src/utils/size.ts`: lo que se
guarda es `displaySize` (alias `canonicalSize`) y su espejo SQL es `canonical_size(raw, is_bike,
category)`, aplicado por el trigger `tr_sku_metadata_size_canonical` (`20260923182401`, con la misma
tabla de casos en un `ASSERT`; su nombre lo hace correr **después** de `tr_sku_metadata_set_is_bike`).
Grafía decidida por Rafael: `17"`, `54cm`, `L16"`, `26"×18"` y la rueda **sin la C**, `700×54cm`
—el cuadro lleva su unidad, y en el export `700X54`: antes salía `700CX54''`, 54 cm declarados en
pulgadas—. **Sólo bicis y cuadros** (`carriesFrameSize`): en una parte `size` guarda un año (`06`) y
se deja tal cual. Dos trampas que el arreglo cerró: `normalize()` no plegaba `×`, así que guardar la
forma canónica la volvía imparseable, y la rueda tiene que comprobarse **antes** que el par (`700X54`
también encaja en él). **La pasada sobre lo ya guardado** (`20260923192209`, 684 filas) dejó la columna
en 68 grafías y 0 por unificar; se revisó por grupos antes (todo lo que pasó a `cm` es de ruta, los
`12`/`10` en pulgadas son bicis infantiles, ninguna clave del export cambió). `03-3802BL` y
`03-4246GY` se llaman `L44` y guardan `44`: **así está bien** (Rafael, 23 sep 2026, «44 está bien, sin
la L») — no es un pendiente. Sí lo es `99-4807CL`: un cuadro marcado `is_bike = true` sin
`category = 'frame'`.

**Rellenar el catálogo desde AS400 (11 sep 2026).** `scripts/backfill-catalog-from-as400.mjs`
(preview por defecto, `--apply` para escribir) llena `model` y `size` desde `as400_description`.
Rellena huecos vacíos, y pisa en **tres casos acotados**: un `color` que sea un cubo genérico
(`BLUE` → `INK`; `THUNDER GREY` nunca), un `model` de ≤2 letras (5 en todo el catálogo) y un `model`
que sea prefijo estricto por palabras del de AS400 (`QUEST` → `QUEST SPORT`). Sigue fuera, en
idea-177, el `model` con la talla dentro — 202 filas. Importa **el parser de la app**
(`parseBikeName`) en vez de copiarlo: node lo corre con `--experimental-strip-types`, así que no hay
espejo que mantener. Y su **fallback es la señal de no escribir**: sin un año `20xx` con talla delante
devuelve el string entero como `model`, lo cual es detectable — así se niega sola ante
`TRAIL X1 2009 14` (año y talla al revés) en vez de inventar. El `Model Year` de AS400 **no es el año
de la bici** (dice 2025 en una descripción de 2009): el año sale de la descripción.

**Un modelo abreviado se guarda con su nombre completo delante (15 sep 2026).** El AS400 escribe
`EC3`, `BC7`, `BCCB`; la caja dice EARTH CRUISER 3, BOSS CRUISER 7, BOSS CRUISER CB. `model` guarda
**`EARTH CRUISER 3 EC3`** (Rafael: «las abreviaturas a la derecha del modelo completo»), así el
buscador —que compara `model` por subcadena— encuentra la fila con `ec3` y con `earth cruiser 3`, y la
etiqueta imprime el nombre completo delante del `item_name`, que sigue siendo el del AS400. La tabla
vive **sólo** en `src/utils/modelAbbreviations.ts` (`expandModelAbbreviation`, idempotente) y la usan
la etiqueta, el alta desde Double Check (`newSkuPrefill`) y `backfill-catalog-from-as400.mjs`. Una
abreviatura nueva es una línea ahí y una corrida del script.

### `sku_metadata.is_bike`: quién lo decide, y por qué la ubicación no sirve de regla

`is_bike` nunca está en NULL, lo que lo hace parecer confiable. Se rellena solo, y hay **tres reglas distintas** en el sistema para la misma pregunta:

1. **La regla viva** — trigger `tr_sku_metadata_set_is_bike` en `sku_metadata`, función `set_is_bike_on_insert`: `LEFT(sku,2) IN ('01','02','03','06','07')`. Solo aplica cuando `is_bike IS NULL`, así que **un valor explícito siempre gana**.
2. **El fallback del front** — `isBikeSku` en `src/utils/bikeDetection.ts`: `BIKE_SKU_PREFIXES` son los mismos cinco del trigger (`01`,`02`,`03`,`06`,`07`), más un peso mínimo para lo que no está en el catálogo. Hasta `a552b28` era `inferBikeSkusByPrefix`, sólo `03-`, y discrepaba con la DB en 343 de 2.227 SKUs.
3. **`set_sku_metadata_is_bike`** — función más elaborada (incluye prefijo `05`, exige guion). **No está enganchada a ninguna tabla**: código muerto que discrepa con las otras dos en 215 SKUs.

Además hay **86 SKUs cuyo `is_bike` contradice la regla viva** — corregidos a mano en algún momento. Unificar las tres reglas es la deuda más barata de pagar aquí.

**⚠️ La ubicación NO determina si algo es bike.** Suena razonable ("si no está en un ROW no es bike") y es falso en las dos direcciones — verificado contra prod:

- **Bikes legítimas fuera de un ROW numerado:** `ROW X EP` (03-4085BK ×41), `ROW 42 BURIED` (03-3931BK ×39) y las bicis completas de las jaulas `CAGE*` (casi todas Scratch & Dent, en `CAGE 7` y `CAGE 8`). Reclasificarlas por ubicación rompería el cálculo de pallets, labels y la clasificación FedEx. **Los cuadros y framekits de las jaulas no son bikes** (Rafael, 10 sep 2026: "los frames son partes"): los 12 — Portal C2 `03-3666BL`…`03-3669BL`, los `09-48xx` y `00-0000` — pasaron a `is_bike = false` en `20260910155112`; el prefijo `03-` los había hecho bici al registrarlos. Llevan `category = 'frame'` (`20260910210219`), que es lo que mantiene en el export de FedEx a los medidos; un cuadro nuevo la necesita a mano.
- **⚠️ Un `item_name` que nombra un modelo de bici NO significa que el ítem sea una bici.** En este almacén las partes se nombran por la bici a la que pertenecen. `E47` tenía 5 SKUs marcados bike llamados "LASER 1.6 2017", "TAXI 2020 GLOSS BLACK", "CUSTOM COMMUTER 2020 BLUE" — y son **pedales**. Ninguna señal del registro los contradecía: `weight_lbs 45` / `length_in 55` son los defaults de registro, no medidas. Corregido en `20260731170000` (`is_bike = false` + prefijo `PEDAL ` en el nombre, para que no vuelva a pasar). **Esta confusión es exactamente lo que motiva pedir el tipo obligatoriamente al registrar.**
- **`01-` y `02-` son prefijos de bike legítimos:** 139 y 20 SKUs, de los cuales 107 y 13 estuvieron en un ROW. Sacarlos del trigger misclasificaría ~120 bikes.
- **Los tracking numbers de FedEx siguen el tipo de su retorno** (15 sep 2026): hasta ese día eran `is_bike = true` a la fuerza («returns are always bikes»), y un retorno de 12 horquillas (792490352439 → 12-8352KW) no se podía procesar. Ahora `fedex_returns.item_type` (`bike`/`part`, cambiable en cualquier paso con `ReturnTypeToggle`) decide el `is_bike` del placeholder por el trigger `tr_fedex_returns_sync_placeholder_type`, Return to Stock busca bicis y partes, y `process_fedex_return_item(…, p_quantity)` mueve las unidades que llegaron (migración `20260915194427`).

Usar "no está en un ROW" como **detector** de sospechosos es útil; usarlo como **regla de clasificación** corrompe datos.

**Registros basura conocidos, sin resolver:** `01-$&;%` ("Bike example", qty 0, en FDX), `00-0000` ("Faultline A1 Frame" — un cuadro, no una bike, en CAGE), `01-0513/0518/0525/0526/0528` (antes `01-513`…; sin `item_name`, `length_in = 5`, qty 1 en SD — marcados bike, sin nombre no se puede decidir qué son). `03-3666Bl` con la L minúscula lo corrigió la pasada canónica (`03-3666BL`). Todos entraron por el mismo agujero: registro sin elegir el tipo.

**Defaults de peso y dimensiones** (`20260731190000`): los pone el **trigger** `tr_sku_metadata_set_is_bike` según el tipo resuelto — bike 45 lbs / 55×8.5×30.5", part **1 lb** / 0×0×0. Solo rellena lo que viene NULL, así que un valor explícito siempre gana (verificado: un SKU con prefijo `03-` registrado explícitamente como part sale con 1 lb).

- **Espejo en TS:** `src/utils/skuDefaults.ts`. La DB es la autoridad; el TS existe para prellenar formularios sin round-trip. **Mantener ambos en sync**, igual que `classify_picking_list_fedex`.
- **Por qué existía el problema:** la columna tenía `DEFAULT 45` — el peso de una bici en caja — así que 1.376 de 1.387 parts pesaban 45 lbs y los totales del Ship screen sumaban una bici por cada pedal. Además había **tres respuestas distintas** para "cuánto pesa una parte": 0 en `ItemDetailView`, 0.1 en `ShipScreen`, 45 en `inventory.service` y la columna. Ahora hay una.
- **`length_in` y `width_in` tenían `DEFAULT 5` y `6`** (ni bici ni nada), lo que además hacía inalcanzable la lógica de dimensiones del trigger. Los tres defaults de columna fueron eliminados para que el NULL llegue al trigger.
- **`inventory.service.ts` ya no manda dimensiones** al crear el shell de un SKU no registrado: mandaba las de bici y pisaba el default que la DB habría acertado.
- Sin efecto en shipping: `classify_picking_list_fedex` no mira el peso desde el 11 sep 2026 (`20260911154111`), sólo cuenta bicis.
- **Pendiente:** 144 SKUs (55 parts, 89 bikes) conservan las dimensiones basura `5×6`. El backfill de peso no las tocó porque algunas podrían estar medidas.

**`dimensions_verified`** (`20260820170000`): distingue una caja medida de una que rellenó el trigger. Existe porque **hay cuatro defaults, no uno** — `55×8.5×30.5` (el del trigger vivo, 144 SKUs), `54×8×30` (uno legacy, 474), `5×6` (los de columna ya muertos, 63) y `0×0×0` (el de parts, en 3 bikes) — y comparar por valor falla en la dirección cara: una caja que mide justo `54×8×30` es indistinguible de una que nadie tocó.

- Lo pone solo: trigger `tr_sku_metadata_dimensions_verified` (BEFORE UPDATE) lo marca `true` cuando **cambia el valor** de una dimensión, y `set_is_bike_on_insert` hace lo mismo en INSERT cuando el caller mandó las tres. Nunca lo pone en `false`.
- **El formulario de alta no manda las dimensiones si siguen siendo las del tipo** (`ItemDetailView.executeSave`, modo `add`, desde el 25 ago 2026): mandarlas hacía que cada SKU registrado a mano saliera `verified` en `55×8.5×30.5` sin que nadie midiera (los del 21 ago están así), y el export a FedEx los declara como cartón real. En NULL el trigger rellena los mismos números y la bandera se queda en `false`.
- **Por qué no un centinela** (guardar `55.0001` para reconocer el default): `ItemDetailView.executeSave` reescribe la fila entera de metadata en cada guardado, incluidas dimensiones que nadie tocó, y el form carga el valor guardado. O el operador ve `55.0001` en el campo, o se redondea al mostrar y el siguiente guardado por cualquier motivo — un cambio de cantidad, una nota — escribe `55` de vuelta y asciende en silencio un SKU sin medir. `PublicTagView` y `StockCountScreen` además interpolan el número crudo.
- **Al 2026-08-21:** 175 verificados, 529 bikes non-S&D sobre defaults.

**Detector, no regla:** "está fuera de un ROW" sirve para _encontrar_ sospechosos — así apareció E47 —, pero nunca para clasificar. `01-` y `02-` son prefijos de bike legítimos (139 y 20 SKUs, con 107 y 13 que vivieron en un ROW), así que sacarlos del trigger para atrapar cinco pedales misclasificaría ~120 bikes reales. La decisión la tiene que tomar una persona en el registro, no un patrón.

### Forma canónica del SKU: `DD-NNNN[CCC]`, impuesta al escribir (`20260826220000`, idea-154)

**Decisión de Rafael (26 ago 2026): la grafía canónica es la de AS400** — departamento de 2
dígitos, guion, número de **4 dígitos con ceros**, 0-3 letras de color en mayúscula. AS400 no tiene
otra: `01-0288` es "S/D EXPLORER A1…" allí y `01-288` no encuentra nada. Lo que no encaje en esa
forma (`PKD-…`, UPC de 12 dígitos, seriales `Y22B010415`, tracking, `23-00146A` con número de 5
dígitos) se guarda `upper(trim)` y no se toca.

**Una sola regla, tres espejos:** `canonical_sku(text)` en SQL es la autoridad —la aplican los
triggers `a_canonical_sku` en `sku_metadata`, `inventory`, `inventory_logs` y `cycle_count_items`
(solo en INSERT o cuando cambia `sku`: editar cantidad nunca mueve una fila de nombre), y la usan
`register_new_sku`, `lookup_canonical_sku`, `search_inventory_with_metadata` (un término completo
en cualquier grafía encuentra la fila; `03-37` sigue siendo búsqueda por prefijo) y
`_container_base_sku` (Excel pierde el cero de `0077`) — que **sólo reacomoda lo que tiene forma de SKU
de JAMIS** (empieza por dígito, acaba en hasta tres letras) y pasa lo demás por `canonical_sku`
(`20260924125837`): antes rehacía cualquier SKU con 3–6 dígitos, y el número de proveedor `TM-993` de
dos cuadros Endura salía como `99-0003TM` (24 sep 2026); 320 SKUs del catálogo se reacomodaban así
(`PKD-001STE` → `00-0001PK`). `normalizeSkuOnRegister` (TS) y
`parser.canonical_sku` (watchdog) son espejos; **la misma tabla de casos** vive en
`skuNormalize.test.ts`, `tests/test_canonical_sku.py` y en el validador de la migración — cambiar
uno es cambiar los tres. En la app se aplica **al guardar**, no por tecla (rellenar `01-5` a
`01-0005` mientras alguien escribe no es ayuda).

**La pasada de datos** renombró 108 nombres (72 cortos `31-75`, 33 sin guion `700106BK`, 3
raros), 22 de ellos fusionados en un nombre que ya existía y 2 sumados en el mismo bin
(`36-305`+`36-0305` en D26, `66-377SL`+`66-0377SL` en E47), reescribiendo `inventory`,
`inventory_logs` (×2), `daily_inventory_snapshots`, `asset_tags`, `cycle_count_items`,
`fedex_return_items` y `picking_lists.items` de **todas** las órdenes (el papel de AS400 decía 4
dígitos de todas formas) con los triggers de actividad y compensación apagados. Stock y snapshots
idénticos antes y después; cada rename/fusión quedó en **`sku_canonical_renames`** (append-only,
lectura admin) con un log `EDIT` por fila (`performed_by = 'system: canonical-sku'`,
`previous_sku` = nombre viejo). **Las 22 fusiones son la lista para el conteo físico**: en varias
los dos nombres tenían descripciones distintas (`31-0075` "WHITE CABLE" / `31-75` "BRAKE CABLE
INNER/OUTER FRONT") y ninguno aparece en ningún PDF; si en piso resultan ser partes distintas, el
que no es AS400 se registra con un nombre propio.

**`sku_key` único cierra la puerta:** un INSERT con una segunda grafía se rechaza; un `upsert ON
CONFLICT (sku)` cae en la fila existente porque el trigger canoniza antes de comprobar el conflicto.
**No añadir más lectores tolerantes** (`inventorySkuCandidates`, `lookup_canonical_sku` y el search
ya existen y son suficientes): si un SKU no se encuentra, la respuesta es la grafía, no otra capa.
Para fusionar nombres a mano (p. ej. una familia `BL`/`BLD` cuando la caja lo diga) existe
`rename_sku_everywhere(old, new)` — `service_role` solamente, escribe la auditoría — nunca el
rename del formulario, que deja al nombre viejo como huérfana con historial.

### Hermanos de variante: `03-3768BL` y `03-3768BLD` son la misma bici

Un SKU de bici puede llevar **una letra extra de acabado** detrás del color de dos letras (`03 3768
BLD` en el PDF de AS400). No es otro modelo: `03-3768BL`/`03-3768BLD` y `03-3769BL`/`03-3769BLD`
tienen el mismo modelo, talla y color, y las cajas son las mismas. El catálogo mantiene **los dos
nombres vivos** porque el operador renombra la fila de inventario entre ellos (tres veces en 2026, la
última el 25 ago) y la fila vieja de `sku_metadata` no se puede borrar (FK desde filas con qty 0).
Así que "qué nombre tiene el stock" es un hecho de este mes, no del SKU.

**Regla (26 ago 2026): entre hermanos de variante gana el que tiene stock, en las dos direcciones.**
Vive en dos sitios que hay que mantener alineados:

- **Watchdog, al resolver la línea** (`_to_cart_items` → `_pick_by_stock`, `supabase_client.py`):
  candidatos = grafía del PDF, canónico de dos letras y el resto de la familia; elige el que cubre
  la cantidad, si no el que más tiene, si no la grafía del PDF (queda marcado bajo el nombre que
  dijo el papel). Antes elegía **el primero que existiera en el catálogo**, que era el muerto: la
  orden 881288 nació `LOW STOCK` con 145 unidades en ROW 43.
- **App, tier 1 de Edit Order** (`CorrectionModeView` → `pickVariantSiblingRow`;
  `variantSiblingBase`/`isVariantSibling` en `src/utils/skuNormalize.ts`): un ítem sin stock cuyo
  hermano cubre la cantidad se intercambia solo, con Undo, igual que un sustituto de mano.

`SKU_SUBSTITUTES` **quedó vacío** y es solo para productos distintos de verdad (otro año de modelo):
tenía `03-3768BL → BLD` y amaneció al revés tras el rename. Una entrada ahí además hacía que el tier
2 saltara el ítem, así que un mapa caducado dejaba la bandera **sin ninguna sugerencia**; hay un test
que prohíbe listar hermanos en él. La familia es estricta: misma base `dd-dddd` + color de dos letras
y **una** letra más. `BK`/`BL` no son hermanos (eso es `AS400_SKU_ALIASES`), ni un part number con
sufijo. **La caja dice `BL` (Rafael, 26 ago tarde):** la tercera letra que imprime AS400 (`BLD`,
`RDD`) es un sufijo de acabado, no otra bici. `20260826231500` fusionó las tres familias que tenían
los dos nombres (`03-3768BLD→BL`, `03-3769BLD→BL`, `03-3779RDD→RD`) y el watchdog (`7d3ac91`)
escribe las líneas no encontradas con el color de **dos letras** (`03-3768BL`, `01-0530`) — lo que
registra el formulario y lo que la orden encuentra por igualdad exacta; `raw_sku` conserva lo que
dijo el papel. Los tres SKUs de tres letras sin gemelo (`01-8791SPT`, `06-4294MVC`, `06-4627LDV`) no
son sufijo D y se quedan. La regla de hermanos por stock sigue como red por si reaparece un par.

**Un color por tipo de unidad, uno solo para toda la app (6 oct 2026, idea-251).** S/D **naranja**, PH
**celeste**, devolución **morado** (es FedEx, como el envío); la nueva no lleva marca. Vive **sólo** en
`src/utils/unitKind.ts` (`unitKindStyle`, `unitKindOf`) y se pinta con `UnitKindChip`: nadie escribe a
mano el color de un tipo. El chip siempre dice el tipo con letras (S/D · PH · RET), nunca sólo color. El
ámbar queda fuera a propósito: ya es la casilla del ROW y «sin guardar». Estudio:
`docs/prds/unit-kind-colors.md`.
