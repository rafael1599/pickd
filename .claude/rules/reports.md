---
paths:
  - 'src/features/reports/**'
---

# Reportes: export de dimensiones a FedEx, Measure y Activity Report

> Movido tal cual desde `CLAUDE.md` el 2 oct 2026 (pasaba el límite de 150k caracteres de
> instrucciones). Claude Code carga este archivo al trabajar con las rutas de arriba; los demás
> agentes lo encuentran por el índice de `CLAUDE.md`. Lo nuevo de esta área se escribe **aquí**.

**Activity Report layout:** Editor panel on the left (desktop) with: selectable greeting toggle ("Hi Carine!"), Win of the Day, PickD Updates (collapsible dropdown, closed by default), On the Floor routine checklist (editable items via gear icon, persisted in localStorage), and Notes (multiline textarea, one per line). Preview on the right updates with green highlight flash on each edit. "Save & Copy Report" button at bottom saves + copies to clipboard in one action. Report section order: Win → PickD Updates → Done Today → On the Floor → In Progress → Coming Up Next → Inventory Accuracy → Waiting. Footer shows date only (no timestamp). `/pickd-report` public route shows the HTML daily report for the current date with date navigation.

## Export de dimensiones a FedEx Ship Manager

Botón en Settings → Exports (`FedexDimensionsExportCard`, gate por `isAdmin`). Genera la tabla
Dimensions que FSM v3313 importa en `Databases → File Maintenance → Import`, template
`DIMENTIONS1`, modo **Replace current data**. Lógica pura en
`src/features/reports/utils/fedexDimensions.ts` (con tests); la query y el log viven en
`useFedexDimensionsExport.ts`.

**Replace vacía la tabla antes de cargar**, y de ahí salen casi todas las decisiones:

- **Siempre el catálogo completo, nunca un delta** — lo que falte en el CSV queda borrado en FedEx.
- **La lectura pagina explícitamente** en vez de confiar en el tope de filas de PostgREST: una query
  truncada en silencio no falla, borra los cartones que faltaron.
- **Solo filas con `dimensions_verified`**, o se pisa una medida real con una que nadie tomó.
- **Bicis, y cuadros medidos** (Rafael, 10 sep 2026: "incluye los cuadros medidos en el export"): los
  cuadros son partes pero viajan en un cartón que FedEx tiene registrado, así que el export lee
  `is_bike` **o** `category = 'frame'` con `dimensions_verified`. Nunca "cualquier parte medida": 67
  partes llevan la caja de bici por defecto que el formulario viejo marcaba como verificada, y un
  espaciador de dirección saldría declarado como caja de bici.
- **Se registra cada corrida** en `fedex_dimension_exports` (append-only, sin políticas de UPDATE ni
  DELETE, RLS por `is_admin()`). Se guardan los conteos y no el archivo, porque el conteo es lo que
  después identifica un catálogo parcial.

**Los ejes NO son los mismos de los dos lados.** Pickd guarda length/width/height como
longest/thinnest/middle — las hojas de piso se escriben L × H × W, por eso `20260814120000` mete la
tercera lectura en `width_in`. FSM quiere Length, Width, Height como longest, middle, thinnest. O sea
**Width sale de `height_in` y Height de `width_in`**. Al revés el archivo importa limpio y cotiza mal
todos los envíos.

**Las tres reglas que no se ven en la salida:**

- **Un cartón por model+size, promedio por eje** (Rafael, 16 sep 2026: «cuando se trate de
  diferencias muy pequeñas hay que ir con el promedio», y no va a volver a medir lo confirmado). Los
  colores de una misma talla son la misma caja medida por personas distintas, así que cuando sus
  lecturas no coinciden se promedian. El máximo por eje, que es lo que hacía antes, componía un
  cartón que **no tiene ningún color** —el largo de una y el ancho de otra—, y eso cruzaba el umbral
  de 130 pulgadas de FedEx en cuatro SKUs que no son oversize. El promedio se sigue redondeando
  arriba, así que nunca se declara por debajo: un cartón más chico de lo real es lo que FedEx
  re-factura. Más de una pulgada de diferencia en un eje no es holgura al medir, son dos cajas: ese
  grupo sale entero a excepciones como `dimension_conflict`, igual que antes.
- **Los lados tienen que ordenar longest ≥ middle ≥ thinnest.** Es lo que atrapa un decimal perdido:
  `03-4046MN` tenía `width_in` en 875 por 8.75, y 875 son tres caracteres, así que el chequeo de
  ancho de campo lo deja pasar tal cual a FedEx. No usa umbrales, así que los cartones legítimamente
  chicos siguen entrando (un Hot Rod en 30/17/8, un framekit en 48/24/8).
- **El rango de tallas solo si son de la misma forma.** `L14''-L16''` sobre L14, 15 y L16 esconde el
  15 plano que hay en medio; un grupo mezclado se lista entero (`L14''/15''/L16''`).

**Formato, estricto:** orden `Description, ID, Height, Length, Width`; cada campo entre comillas
dobles; **sin fila de encabezado**; CRLF; ASCII sin BOM; ningún `"` dentro de los datos (se usa `''`
para las pulgadas); Description ≤140, ID ≤30 alfanumérico en mayúscula, cada dimensión 1-3 dígitos.
Nombre: `DIMENSIONS_FEDEX_YYYYMMDD.csv`. El ID se genera al vuelo de forma determinista (no está
persistido — decisión abierta); si truncar a 30 provocara choque, desempata un hash FNV-1a de la
propia clave, no un contador, para que no se mueva cuando aparece otro registro.

**Redondeo de una lectura de cinta:** `.5` y por debajo baja a la pulgada entera menor, de `.6`
para arriba sube. Es lo que aplica la propia hoja de piso (55.5 → 55, 57.5 → 57, 53.5 → 53) y va en
la **columna**, no en el export: `buildFedexDimensions` siempre hace `ceil`, así que un cartón nunca
se declara más chico de lo que dice el dato guardado.

**Al 2026-08-21:** 703 filas leídas → 122 registros, 530 excepciones (529 sin medir, 1 sin modelo).
`20260821120000` corrigió 24 cartones re-medidos en piso y añadió SEQUEL S3 15''; casi todas las
correcciones bajan, que es la dirección que se paga en silencio (un `8.25` viejo en un solo color
declaraba cartón de 9 para toda la talla). Cuatro tallas se fusionaron con su vecina al caer en el
mismo cartón y RENEGADE S1 56 dejó de viajar en el de 58. Verificado en prod contra el propio
`buildFedexDimensions`. **Nadie lo ha importado todavía en FSM** — ese es el único criterio de
aceptación sin comprobar.

**Cuál medir primero: `/export/measure` (1 sep 2026).** El export ya dice _qué_ SKUs no tiene
FedEx —154 al escribir esto—; lo que no decía es _cuál_. Una bici pedida 90 veces desde enero se
cotiza mal cada semana; una pedida una vez es un viaje con la cinta métrica que no compra nada. El
botón del card de Export abre una cola con la forma de Double Check: tarjeta por caja, el número de
órdenes como cifra grande, la fila donde está el montón más grande, y los tres lados + SAVE en la
misma tarjeta. **El orden es órdenes en 12 meses, desempate por la más reciente** (Rafael, 1 sep
2026, eligiendo entre eso y un peso por recencia): la lista tiene que leerse igual que el número
impreso en cada tarjeta, o se le pide al operario que confíe en una fórmula que no puede comprobar
contra la fila que tiene delante. **Stock ≥ 3** y solo bicis non-S&D, como el export.

- `get_bike_demand_ranking(p_months, p_min_stock)` (`20260901182520`) hace **solo la agregación**:
  órdenes `completed` por `created_at` (no `updated_at`, que se mueve cada vez que alguien edita una
  orden; `source_order_date` sería más cierto pero es NULL en 1035 de 1748), renames plegados hacia
  adelante desde `inventory_logs.previous_sku` —lo mismo que `resolve_sku_chain` camina hacia atrás
  para un SKU, aquí hacia adelante para todos de una vez— y la fila con más stock como dirección.
  Devuelve **las 264 filas, medidas o no**: quién puede exportarse lo decide `fedexCartonGap`, que ya
  comparten el export y el aviso de Double Check, y repetir esa regla en SQL sería una tercera
  respuesta que se desincroniza. La cola vive en `features/reports/utils/measureQueue.ts` (puro, con
  tests) y la pinta `MeasureCartonsScreen`.
- **El peso se toma en el mismo viaje (1 sep 2026).** La tarjeta lleva una segunda fila con la
  báscula: un campo y un **chip de unidad LBS/KG** que cambia **toda la pantalla** y se recuerda
  (`localStorage`, `pickd.measure.weightUnit`) — la unidad es una propiedad de la báscula, no de la
  caja, y quien recorre 154 cajas no la elige 154 veces. En kg el campo enseña **a qué libras
  aterriza** antes de guardar, igual que los lados enseñan sus columnas. **Lo que se guarda siempre
  es `weight_lbs`**: es lo que suma Ship para el número que la estación teclea en Audit Source y por
  lo que rutea `classify_picking_list_fedex`; una columna de kg al lado sería un segundo número para
  un solo hecho. **Cada mitad va sola** (`planBoxSave`, puro y con tests): una báscula sin cinta
  métrica es un viaje que vale igual, y al revés. Lo que se rechaza son lados a medio teclear.
  Guardar solo el peso **no** baja el contador «to measure» —la caja sigue sin medir— y la tarjeta se
  queda abierta diciendo `45.2 lbs saved — the box still needs measuring`. El peso tiene su propia
  bandera, `weight_verified`, con las mismas reglas que `dimensions_verified` (ver abajo): 241 de las
  264 filas en cola llevan 45 lb, que es lo que escribe el trigger, no lo que dijo una báscula.
- **Medido no es que FedEx lo sepa.** Una tarjeta guardada se queda en su sitio en verde —sacarla
  movería todo bajo el pulgar y se llevaría la única confirmación de que los tres números
  entraron— y la barra inferior recuerda que hay que correr el export. Una fila **sin `model`** se
  guarda en ámbar diciendo `still held back: no model on the record`, porque medirla no la vuelve
  exportable (2 SKUs en prod, pero es la clase lo que importa).

**«Lo midieron» lo dice quien mide, no el valor que cambió (`20260901204403`, 1 sep 2026).**
`set_dimensions_verified` deducía la medición de que un número cambiara (`IS DISTINCT FROM`), que
acierta casi siempre y falla justo en el caso para el que existe la bandera: medir un cartón y que
salga **exactamente el default** (55 × 8.5 × 30.5, o el legacy 54 × 8 × 30 que llevan 474 SKUs —
números redondos, la cinta cae ahí) escribía un UPDATE sin cambios, dejaba la bandera en `false` y
`dimensions_measured_at` en NULL, y la caja volvía a la cola y se quedaba fuera del archivo de FedEx.
El operario hizo el trabajo y PickD tiró el dato. Comprobado en prod antes de tocarlo: reguardar los
propios números de una fila la dejaba en `false`; cambiar un dígito la ponía en `true`.

- **Tres reglas, en orden:** (1) cambió un valor → verificado, como siempre; (2) **el que escribe
  mandó `verified = true`** → verificado y estampado; (3) **nunca se baja** — `ItemDetailView`
  reescribe la fila entera en cada guardado y sin esto un `false` viejo pisaría una medición real.
  Quien no manda la bandera no cambia en nada: `ItemDetailView` no la manda.
- **El único que la manda es `useUpdateCartonDimensions`**, porque sus tres llamadores (el aviso de
  Double Check, la fila de excepciones del export y la cola de Measure) son formularios que solo
  existen cuando alguien acaba de poner la cinta o la báscula. `dimensions_measured_at` sigue siendo
  del trigger: el reloj tiene un dueño.
- **`weight_verified`** (misma migración) hace por el peso lo que la otra por las medidas — antes no
  había ninguna, así que 45 lb de verdad y 45 lb de «nadie la pesó» eran el mismo dato, y ese número
  es el que Ship suma para lo que la estación teclea en Audit Source. En INSERT se sella igual que las
  medidas (`set_is_bike_on_insert`), con el mismo contrato con el formulario: **el alta manda
  `weight_lbs: undefined` si sigue siendo el default del tipo** (`ItemDetailView`, modo `add`), o
  registrar un SKU archivaría 45 lb como lectura real. **Backfill:** 53 filas cuyo peso no era el
  default del tipo quedaron en `true` — la misma comparación por valor, corrida una vez, para no
  pedir que vuelvan a pesar lo que ya tiene lectura. Un peso real que cayera justo en el default se
  queda sin marcar y se vuelve a pesar, que es la dirección segura.
- **El export no cambió:** 144 registros / 460 excepciones antes y después (la última corrida
  registrada, 31 ago, fueron 141/463 — subió por tres cajas medidas desde entonces).
- **Cambiar un default por otro no es medir (`20260923182403`, 23 sep 2026).** Un SKU `05-` nace parte
  por prefijo (1 lb, 0×0×0); al corregir el tipo a bici, `ItemDetailView` reescribe la fila con 45 lb y
  55×8.5×30.5 y el trigger sellaba las dos banderas porque «un valor cambió» — reproducido en prod. La
  guarda del formulario sólo corre en `mode === 'add'`, así que el agujero estaba en el segundo
  guardado. Ahora, si OLD y NEW son ambos una caja por defecto (o un peso por defecto, 45/1), la bandera
  no se mueve; un `true` explícito sigue sellando. Se destildaron los **10** cartones así sellados que
  salían en el export (quedan 55 filas con caja por defecto marcada que no llegan a él, sin tocar). El
  destildado usa `set_config('pickd.demote_dimensions','true',true)`, que la misma migración apaga.

**Clientes ↔ FSM (idea-153, 24 ago 2026):** el Recipient ID numérico de FSM es la cuenta AS400 +
sufijo ship-to (`0010495 00` → `1049500`); Pickd todavía no la persiste. Análisis en
`docs/fedex-recipients-analysis.md`, diseño y fases en `docs/fedex-customer-id-integration.md`.
