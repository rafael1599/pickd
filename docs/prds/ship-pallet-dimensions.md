# PRD: La pallet como bulto — medidas tomadas en Double Check, declaradas en Ship

**Estado:** MVP construido 2026-09-22 — las nueve ❓ cerradas por Rafael ese mismo día. **Sin
desplegar: la migración no está aplicada en prod.** · **Fecha:** 2026-09-22 · **Autor:** Rafael + PickD ·
**Backlog:** idea-220 (propuesto) · **Relacionado:** idea-167 (`ship-ebike-declaration.md`),
`dimensions_verified` / cola de Measure, `docs/warehouse-ui-rules.md` (pallet 60×62)

---

## 1) Contexto y problema

Audit Source pide, para una carga regular: tienda/cliente, calle, zip, **cantidad de pallets** y
**peso total**. Cuando la carga es LTL consolidada, el portal del transportista además quiere el
**tamaño del bulto**: una pallet armada no se cotiza por su contenido, se cotiza por lo que ocupa.

Hoy PickD no tiene ese dato en ninguna parte. El único bloque de medidas de Ship es
`E-BIKE — OWN CARTON`, y ese bloque es otra cosa: declara la bici a batería **fuera** del pallet y
la **resta** de Bikes y Weight (idea-167). Reconvertirlo borraría esa declaración.

La medida sólo la puede tomar quien tiene la pallet delante y la cinta en la mano: el operador de
Double Check, justo cuando acaba de envolverla y le saca la foto.

## 2) Objetivo

Que la estación lea en Ship el tamaño de cada pallet — tecleado en el piso o estimado — y lo copie
al portal de una vez, sin preguntarle a nadie y sin volver a la bodega.

**Métrica:** cero pallets salidas con tamaño desconocido en el portal; cero medidas tomadas dos veces.

## 3) Alcance

**Dentro:** tres campos por pallet junto al botón Photo en Double Check; persistencia hacia Ship;
un bloque hermano al de e-bike en la tarjeta de Ship con copia al portapapeles; fallback calculado
cuando no se teclea nada.

**Fuera (MVP):** clase NMFC / freight class;
convertir la foto en foto-por-pallet (ver hallazgo A2 y D9); persistir el reparto de pallets como
entidad real (ver D1); editar la medida desde Ship.

---

## 4) Auditoría — lo que hay hoy

**A1 · La pallet no es una entidad; es un índice de array.** `calculatePallets`
(`src/utils/pickingLogic.ts`) reparte las unidades en pallets de 8/10/12 por relleno codicioso y
numera `id: 1..n` por posición. Lo único que se persiste es el **número**: `picking_lists.pallets_qty`,
escrito una sola vez al completar (`PickingCartDrawer`). Ni los `palletOverrides` (el lápiz de
`Pallet 1/3`) sobreviven a un refresh — son `useState` en `DoubleCheckView`. Colgar dimensiones de
`pallet.id` es colgarlas de un ordinal que se renumera cuando cambia una línea.

**A2 · La foto ya finge ser por pallet y no lo es.** El botón «Take Photo» al final de cada bloque
llama al mismo `scanInputRef` compartido y hace append a `picking_lists.pallet_photos`, un array
plano a nivel de orden. El burst mode cuenta fotos contra `physicalPalletCount`, así que existe un
convenio posicional implícito (foto n ↔ pallet n) que **nada garantiza**: dos fotos del pallet 1
corren todo lo demás. `pallet_photo_url` en el modelo del pallet es lo correcto — pero hoy no hay
de dónde leerlo.

**A3 · El bloque de e-bike no se puede reconvertir.** `ElectricCartonDeclaration` existe porque
Audit Source quiere la eléctrica declarada **aparte** del pallet, y `hidePalletTotals` la saca de
los cuatro números. Lo que hace falta es un bloque **hermano**, con la misma gramática visual.

**A4 · Los ejes de `sku_metadata` están cruzados a propósito.** `length/width/height` = longest /
thinnest / middle (CLAUDE.md, export a FSM). Una pallet medida con cinta es largo × ancho × alto en
el sentido del mundo. Si los campos nuevos heredan ese vocabulario, alguien cruza los ejes.

**A5 · Un default guardado como medida ya corrompió el catálogo una vez.** `ItemDetailView` dejó de
mandar dimensiones cuando siguen siendo las del tipo, porque prellenar y guardar declaraba cartones
que nadie midió, y el export los mandaba a FedEx como reales.

**A6 · Escribir en cada eco de realtime cuesta 120 PATCH en 62 s** (bug-026), y espejar una
hidratación de vuelta vació las marcas de una orden parkeada (`verified_item_keys`, 25 ago).

**A7 · Una combinada tiene un solo reparto de pallets.** El override vive en el **ancla** y los
hermanos completan en 0; las fotos se mergean con `mergeSiblingPalletPhotos`. Las medidas tienen que
seguir la misma regla o una tarjeta combinada dirá 3 pallets y 1 medida.

---

## 5) Variables de datos

### 5.1 Jerarquía

```
picking_lists (orden)            ← dueño del dato; una fila, o el ancla de un grupo
  └── pallet_dims: jsonb[]       ← NUEVO: una entrada por ordinal de pallet
        └── { pallet, length_in, width_in, height_in, units, measured_by, measured_at }
  └── items: jsonb[]             ← el reparto en pallets se CALCULA de aquí, no se guarda
```

El pallet sigue siendo derivado. `pallet_dims[n]` es un **side-car por ordinal**, no una entidad.

### 5.2 La entrada

| Campo         | Tipo           | Significado                                                            |
| ------------- | -------------- | ---------------------------------------------------------------------- |
| `pallet`      | int ≥ 1        | Ordinal dentro del carrito (= `pallet.id` de Double Check)             |
| `length_in`   | number \| null | Largo tecleado, pulgadas. `null` = nadie lo tecleó                     |
| `width_in`    | number \| null | Ancho tecleado                                                         |
| `height_in`   | number \| null | Alto tecleado                                                          |
| `units`       | int            | Unidades del pallet en el instante de teclear — **huella de vigencia** |
| `measured_by` | uuid           | Quién                                                                  |
| `measured_at` | timestamptz    | Cuándo                                                                 |

**`null` significa «no tecleado», nunca «cero».** Un 0 guardado es una medida, y una medida de 0
llega al portal.

### 5.3 Lo que NO se guarda

- **`dimension_source`** — se **deriva** de qué ejes son `null`. Una bandera guardada junto a los
  valores que la determinan es un segundo dueño del mismo hecho y se desincroniza: es la lección de
  `sku_not_found` (bug-020, pasó a derivada) y la de `completed_snapshot` (un snapshot que nadie
  refresca). Tres lecturas: `manual` (los tres tecleados), `partial` (uno o dos), `computed` (ninguno).
- **Las dimensiones calculadas** — se computan al leer, con una función pura. Cachear una derivación
  es fabricar el caso de que envejezca en silencio.
- **El peso por pallet** — se suma de las líneas del pallet al leer (§7.4). Guardarlo sería
  congelar una derivación que cambia con cada corrección de la orden.

### 5.4 Módulos

- `src/utils/palletDims.ts` — puro, con tests: `sanitizeInches`, `dimensionSource`,
  `estimatePalletDims`, `effectiveDims`, `isStale`, `formatPalletDims`.
- `src/components/orders/palletDeclaration.ts` — el texto del portapapeles, junto a
  `electricCartons.ts`, que es su hermano exacto.
- UI: `PalletDimsRow.tsx` (Double Check) y `PalletDeclaration.tsx` (Ship, espejo de
  `ElectricCartonDeclaration`).

---

## 6) Reglas de transición de estado

### 6.1 La medida de una pallet

```
UNSET        ninguna entrada, o los tres ejes null
  → PARTIAL  el operador teclea uno o dos ejes  (los que faltan salen del fallback)
  → MANUAL   los tres tecleados
  → STALE    entry.units ≠ unidades actuales de ese ordinal
  → UNSET    el operador borra los tres campos (borrar es una decisión, se respeta)
```

`STALE` **no borra**: la medida se conserva y se pinta en ámbar con lo que cambió («medida con 12 u,
hoy son 10»). Borrar en silencio es lo que hace que nadie confíe en el número; lo que no cuadra se
lista, nunca se esconde.

Un ordinal que desaparece (la orden pasó de 3 pallets a 2) **conserva su entrada huérfana** y no se
dibuja; si vuelve a haber 3, reaparece marcada `STALE`. Nada se pierde por una edición temporal.

### 6.2 Escritura

- **onBlur por campo** (patrón `StatField` de Ship) **+ debounce 800 ms** como red.
- **Flush forzado** al pulsar Photo, al completar y al desmontar.
- **Sólo se escribe lo que cambió en este dispositivo** (`dirtyRef`, como `verified_item_keys`): una
  hidratación por realtime **nunca** se devuelve. A6.
- **Nunca por tecla.** La orden abierta en otra pantalla recibe cada write por realtime.
- **Read-only** (`isReadOnly`): campos deshabilitados, igual que el escáner.

### 6.3 A quién pertenece la escritura

La entrada se guarda en **la fila que Double Check tiene abierta** (`activeListId`) — la misma que
recibe el override de `pallets_qty`. En una combinada deliberada eso es el ancla; los hermanos no
escriben. Ship, en una tarjeta combinada, **concatena** las entradas de todos los miembros por
orden de ancla, igual que `mergeSiblingPalletPhotos`. A7.

### 6.4 Validación

- Sanitizado: sólo dígitos y un punto decimal. Vacío → `null`.
- **Rechazo duro 1–130 pulgadas** por eje. Atrapa el decimal perdido (`8.75` tecleado `875`, el caso
  real de `03-4046MN`) y el 130 es el umbral que FedEx ya cobra (idea-214).
- **Aviso ámbar, sin bloquear**, fuera de 36–100 en largo/ancho o por encima de 96 de alto (la puerta
  del tráiler). Un validador que frena el piso es un validador que se saltan.
- Se guarda lo tecleado (un decimal); el redondeo hacia arriba es del portapapeles, nunca del dato —
  misma regla que el export a FedEx.

---

## 7) La pallet calculada — geometría y peso (Rafael, 22 sep 2026)

**Va en el MVP.** El operador no parte de campos vacíos: parte de un número y lo corrige si está mal.

### 7.1 Los ejes, uno por uno

Una caja de bici en PickD es `length_in` / `width_in` / `height_in` = **el más largo / el más
delgado / el intermedio** (default de bici: `55 / 8.5 / 30.5`). En la pallet cada eje hace un
trabajo distinto, y esto es lo que hay que no cruzar:

| En la pallet   | Sale de                               | Porque                                                      |
| -------------- | ------------------------------------- | ----------------------------------------------------------- |
| **Largo**      | `max(length_in)`                      | Las cajas van acostadas a lo largo; manda la bici más larga |
| **Ancho**      | suma de `width_in` de un nivel        | Van de canto, una junto a otra: 4 ó 5 por nivel             |
| **Alto**       | suma de `height_in` de los niveles    | Un nivel sobre otro                                         |
| **Alto extra** | `width_in` de cada bici echada encima | Acostada, lo que suma es su lado delgado                    |

### 7.2 El armado

Dos niveles de canto y hasta dos bicis acostadas encima. Cuántas caben de canto lo decide el
tamaño del pallet:

```
porNivel = N <= 10 ? 4 : 5          // N = cajas de bici del pallet (por unidad, no por línea)
deCanto  = min(N, 2 * porNivel)
niveles  = ceil(deCanto / porNivel)  // 1 ó 2
echadas  = N - deCanto
```

Esto reproduce exactamente las capacidades que `calculatePallets` ya usa, y esa coincidencia no es
casual — **8 / 10 / 12 son esta geometría**:

| N   | porNivel | de canto | echadas |
| --- | -------- | -------- | ------- |
| 8   | 4        | 4 + 4    | 0       |
| 9   | 4        | 4 + 4    | 1       |
| 10  | 4        | 4 + 4    | 2       |
| 11  | 5        | 5 + 5    | 1       |
| 12  | 5        | 5 + 5    | 2       |

### 7.3 La fórmula

**El armado sigue el orden de recogida** (Rafael, 22 sep 2026): las cajas se colocan en el orden en
que salen en Double Check — que es `getOptimizedPickingPath`, el recorrido por `picking_order` — **de
derecha a izquierda**. Así que qué caja va en qué nivel no se adivina: se lee.

```
cajas   = pallet.items en su orden, expandidas por pickingQty, sin e-bikes
nivel1  = cajas[0 .. porNivel)
nivel2  = cajas[porNivel .. deCanto)
echadas = las últimas (N - deCanto) — "las dos últimas bicicletas recogidas"

largo  = max( max(length_in) , 48 )                      la bici más larga, o el deck
ancho  = max( Σ width_in de nivel1 , Σ width_in de nivel2 , 40 )
alto   = max(height_in de nivel1) + max(height_in de nivel2)   ← la más alta de cada nivel
       + Σ width_in de las echadas                             ← acostadas, suma su lado delgado
       + DECK_IN                                               ← 5" de tarima
peso   = Σ (weight_lbs × qty) de las líneas del pallet
       + DECK_LBS                                              ← 40 lb de tarima
```

La **dirección** (derecha → izquierda) no cambia ninguna suma; cambia dónde queda cada caja en el
piso, y es lo que haría reproducible un dibujo del pallet el día que lo haya.

`DECK_IN = 5`, `DECK_LBS = 40` y la tarima es de **48 × 40** (Rafael, 22 sep 2026). Las cajas van a
lo largo del lado de 48" (una bici de 55" vuela 7") y se acumulan de canto a lo ancho del lado de
40" (cinco de 8.5" vuelan 2.5"), así que **el bulto nunca es más chico que el deck**: cuatro cajas
suman 34" y aun así se declaran 40. El 40 lb **no es nuevo**: `ShipScreen`
ya lo suma al peso total desde antes (`palletCount * 40`, `ShipScreen.tsx:746`), y lo pone en
**cero en órdenes FedEx** — ahí no hay tarima, y por eso este bloque tampoco aplica a FedEx.

**Nunca un promedio.** Dentro de un nivel manda la caja más alta, y entre los dos niveles manda el
más ancho: es lo que el bulto mide de verdad. De los dos errores posibles sólo uno se paga — un
bulto declarado más chico de lo que es es lo que el carrier refactura —, la misma dirección que el
`ceil` del export a FSM.

**Multiconjunto por unidad:** una línea de 3 bicis iguales son 3 cajas. La selección de «los N
mayores» opera sobre las cajas expandidas por `pickingQty`, no sobre las líneas.

### 7.4 El peso por pallet suma lo mismo que el total

`Σ(weight_lbs × qty)` de sus líneas + 40 lb de tarima. Los pallets parten las mismas líneas que el
total y Ship ya suma los mismos 40 lb por pallet, así que **Σ(pallets) = Weight** por construcción:
no son dos números que mantener de acuerdo, es el mismo repartido. Tres salvedades:

- **La e-bike viaja dentro del pallet pero se le resta** (Rafael, 22 sep 2026: «se le resta el peso
  y las medidas a la pallet, que le pertenecen a la e-bike; van juntos con peso y medidas
  correctas»). Sale del peso **y** de la geometría — no cuenta como hueco en un nivel — y se declara
  como cartón aparte con lo suyo. Pallet declarado + cartón declarado = la carga real, sin contarla
  dos veces. Ship ya lo hace con el peso total: `if (isElectricItem(item)) return`.
- **La identidad se rompe si alguien teclea Bikes o Parts a mano.** `totalWeight` no suma las líneas:
  multiplica el conteo editable por el peso **promedio** (`bikesCount * avgBikeWeight`). El peso por
  pallet sí suma línea a línea. Mientras nadie edite los conteos son el mismo número; si se editan,
  el bloque **lo dice** en vez de esconderlo.
- Los contenedores de **partes** y **bicis pequeñas** no son pallets físicos: no llevan geometría ni
  tarima, y su peso sigue contando en el total como hoy.

### 7.5 Las bicis de niño son un bulto propio, y ése se mide con la cinta

Rafael, 22 sep 2026: «si lleva más de 2 kids bikes pedir medición manual porque el picker lo acomoda
como mejor le parece y puede cambiar las dimensiones… la última pallet, puede ser de la 2 en
adelante porque las kids bikes se recogen al final de ROW 42».

`calculatePalletsWithBikeAwareness` ya las saca a su propio contenedor (`containerKind:
'smallBikes'`) — en 3 meses **ninguna** acabó dentro de un pallet de bicis grandes. Así que el bulto
que el picker arma a ojo **es ése**, y no hace falta castigar al pallet de al lado:

- **Pasadas de dos, el contenedor se declara como bulto**: sus cajas y su peso son reales (la suma
  más la tarima), y el **tamaño sale `?`** porque no hay geometría que calcular en un montón armado
  a mano. Los campos quedan listos en Double Check y Ship dice `size ?` hasta que alguien mida.
  Parcial se sigue guardando, pero sin los tres ejes no hay bulto que declarar: aquí no hay con qué
  rellenar los huecos.
- **Los pallets de bicis grandes conservan su cifra calculada.** Lo que ensuciaba sus medidas era
  que las juveniles no tenían sitio; con sitio propio, vuelven a ser calculables.
- **Dos o menos no abren fila**: caben en un hueco del pallet de al lado sin mover nada.

**Por qué el bulto de juveniles tenía que declararse, y no sólo marcarse** (orden del 22 sep,
`load_number` 131623797): 22 bicis, 10 grandes y 12 juveniles. El bloque dibujaba **una** fila de 467
lb mientras los cuatro números decían **2 pallets / 937 lb** — las 12 juveniles, ~470 lb, no estaban
en ninguna parte. Con el bulto declarado:

```
PALLET 1       59×40×86      467 lbs   10 cajas
KIDS PALLET    ? measure it  470 lbs   12 cajas
                             ───────
                               937  =  el Weight de Ship, exacto
```

La identidad Σ(bultos) = Weight sólo cierra contando la tarima de las juveniles, que es justo lo que
la estación ya contaba al teclear 2. Era la prueba de que ese bulto es un pallet.

### 7.6 Con cajas sin medir

529 bicis non-S&D están sobre dimensiones por default: exigir `dimensions_verified` para estimar
dejaría casi toda orden sin número. Así que **se estima igual, con el default, y se dice de qué
está hecho**: la fila sale en ámbar con «3 de 10 cajas sin medir». Un número que el operador puede
corregir sirve; un `?` permanente, no. Lo que no pasa nunca es que una estimación se marque como
medida — eso es lo que `dimension_source` mantiene separado, y la lista de cajas sin medir es
además la cola de `/export/measure` que ya existe.

---

## 8) Ship: cómo se ve y qué se copia

Bloque hermano bajo los cuatro números, encima del de e-bike, misma gramática (cifra grande +
etiqueta corta, `useFitFontSize`, nunca parte de línea):

```
PALLET — SIZE
1   PALLET      58×42×83  IN      12  UNITS      642  LBS     [copiar]
2   PALLET      58×34×74  IN      10  UNITS      534  LBS     [copiar]
```

- **Si todas las pallets miden igual** (el caso normal), una sola fila: `3 PALLETS · 58×42×83 IN each`.
- **Sin medida ni estimación**: `?` ámbar, como la columna Lbs.
- **Medida `computed`**: la cifra en el azul normal con el punto de la estimación; `manual` en verde.
  `STALE`, ámbar.
- Si `pallets_qty` (editable en Ship) no coincide con el número de entradas, el bloque muestra lo que
  tiene y lo dice. **Nunca inventa una fila.**

**Portapapeles** (❓ Q3), siguiendo `electricCartonClipboard`:

```
3 pallets, 58x42x83 in, 642 lbs each, 1926 lbs total
```

ASCII `x` en el portapapeles (`×` sólo en pantalla): el portal es un campo de texto ajeno y el
export a FSM ya enseñó lo que cuesta un carácter no-ASCII. Enteros redondeados hacia arriba — un
bulto nunca se declara más chico de lo que es.

---

## 9) Decisiones de arquitectura (MVP)

| #       | Decisión                                                                                                                                                                    | Por qué                                                                                                                                                                                                                                                                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1**  | **Columna `pallet_dims jsonb` en `picking_lists`, no tabla nueva**                                                                                                          | Una tabla `picking_list_pallets` sería la respuesta correcta si la pallet fuera una entidad; hoy es un ordinal calculado (A1) y la tabla sólo disfrazaría eso con una PK. Además Ship ya trae la fila: cero joins, cero canales de realtime nuevos (CLAUDE.md lo prohíbe para notas por el mismo motivo). La tabla llega cuando se persista el reparto. |
| **D2**  | **Supabase, no IndexedDB ni localStorage**                                                                                                                                  | Se teclea en el teléfono del piso y se lee en la estación de envío: son dos dispositivos. Un estado local nunca llega. localStorage queda para la unidad de la báscula y cosas del aparato.                                                                                                                                                             |
| **D3**  | **`dimension_source` derivado, no almacenado**                                                                                                                              | bug-020: una bandera junto a los datos que la determinan se desincroniza.                                                                                                                                                                                                                                                                               |
| **D4**  | **Los ejes se llaman por lo que son** (`length/width/height` = largo/ancho/alto del bulto en el piso) y **no** siguen el convenio longest/thinnest/middle de `sku_metadata` | A4. Se documenta en el propio módulo.                                                                                                                                                                                                                                                                                                                   |
| **D5**  | **La cifra calculada va como `placeholder`, nunca como `value`**                                                                                                            | A5: prellenar-y-guardar declaró a FedEx cartones que nadie midió. El operador ve el número estimado en gris y lo corrige tecleando encima; si no teclea, el campo queda `null` y la estimación se recalcula sola cuando cambia la orden. Guardarla congelaría una derivación.                                                                           |
| **D6**  | **Parcial es válido y se guarda**                                                                                                                                           | El operador que sólo mide el alto hizo trabajo real. Los ejes que faltan salen del fallback y la fila lo dice. Pedir los tres para guardar uno es tirar el dato (la lección de la cola de Measure: «cada mitad va sola»).                                                                                                                               |
| **D7**  | **Sólo los pallets físicos tienen campos**                                                                                                                                  | Los contenedores `isParts` / `smallBikes` no cuentan como pallet (`physicalPalletCount`) y no son un bulto de LTL. ❓ Q4.                                                                                                                                                                                                                               |
| **D8**  | **Peso por pallet en el MVP, derivado** (revierte la decisión de la mañana del 22 sep)                                                                                      | Los pallets parten las mismas líneas que el total, así que Σ(pallets) = Weight **por construcción**: no son dos números que mantener de acuerdo, es el mismo repartido. Se calcula, nunca se teclea.                                                                                                                                                    |
| **D9**  | **La foto no cambia en el MVP**                                                                                                                                             | Engancharla al ordinal es correcto (A2) y es barato — el botón ya sabe su pallet — pero cambia el burst mode y el gate de completado. Fase 1.5, sola, para poder revertirla sola.                                                                                                                                                                       |
| **D10** | **El bloque de e-bike se queda intacto**                                                                                                                                    | A3.                                                                                                                                                                                                                                                                                                                                                     |

---

## 10) Preguntas abiertas (❓ + default propuesto)

- **Q1 — ¿El portal quiere una línea por pallet o el bulto consolidado?** _Default:_ una línea por
  pallet, colapsada a una sola cuando todas miden igual.
- **Q2 — ~~¿Cuál es la regla de estimación?~~** Cerrada por Rafael el 22 sep 2026 → §7.
- **Q3 — ¿Formato exacto del portapapeles?** _Default:_ `3 pallets, 58x42x83 in, 642 lbs each, 1926 lbs total`.
- **Q4 — ¿La caja de partes se mide?** _Default:_ no en el MVP; si va sola por FedEx ya tiene su
  propio flujo de cartón.
- **Q6 — ~~¿La tarima entra?~~** Cerrada (Rafael, 22 sep): **+5" de alto y +40 lb**, por pallet.
- **Q7 — ~~¿La e-bike?~~** Cerrada (Rafael, 22 sep): viaja dentro, se le resta peso y medidas al
  pallet y se declara aparte con lo suyo.
- **Q8 — ~~¿El ancho sale de las cajas más anchas?~~** Cerrada (Rafael, 22 sep): **sale del orden de
  recogida**, el mismo de Double Check, armando de derecha a izquierda. No hace falta heurística.
- **Q9 — ~~¿De qué tamaño es la tarima?~~** Cerrada (Rafael, 22 sep): **48 × 40**. De ahí salen las
  dos cotas: `largo = max(bici más larga, 48)` y `ancho = max(Σ anchos del nivel, 40)`.
- **Q5 — ¿Se congela lo declarado al enviar?** _Default:_ no en el MVP. Si mañana hay que reclamar
  una refacturación, lo que se declaró es un hecho histórico y querrá su snapshot al marcar Ship.

---

## 11) Qué se construyó (2026-09-22)

| Pieza                                                     | Archivo                                                |
| --------------------------------------------------------- | ------------------------------------------------------ |
| Geometría y estado de la medida, puro                     | `src/utils/palletDims.ts` (+ 32 tests)                 |
| Persistencia con rastreo de «sólo lo de este dispositivo» | `src/features/picking/hooks/usePalletDims.ts`          |
| Los tres campos junto a la foto                           | `src/features/picking/components/PalletDimsRow.tsx`    |
| La declaración de Ship, pura                              | `src/components/orders/declaredPallets.ts` (+ 8 tests) |
| El bloque `PALLET — SIZE`                                 | `src/components/orders/PalletDeclaration.tsx`          |
| La columna                                                | `supabase/migrations/20260922170643_pallet_dims.sql`   |

**Orden de despliegue, y no es opcional:** la migración va **antes** del push. El frontend nombra
`pallet_dims` en un `select()` explícito, y PostgREST devuelve **400 y rompe la consulta entera** si
la columna no existe — no falla sólo esa columna, se cae el listado de Ship.

**Lo que Ship rehace y lo que no.** El reparto en pallets se recalcula con las mismas funciones
puras y las mismas líneas en el mismo orden; sólo viene guardado lo que alguien tecleó. El único
caso en que los dos lados pueden diferir es el **lápiz** de Double Check (`palletOverrides`), que
nunca se persistió: si alguien reparte a mano 12 unidades en 3 pallets, Ship recalcula 1. Es el
argumento de D1 puesto a trabajar — el día que el reparto se persista, esto desaparece.

**Sin comprobar:** el aspecto a 430 px, que es el criterio de aceptación de Rafael para todo cambio
de Ship.

## 12) Comprobado contra prod antes de desplegar (2026-09-22)

Rafael pidió una migración que aplicara la regla a las órdenes de los últimos 3 meses «para verlo
con órdenes pasadas». **No hizo falta ninguna**: la medida no se guarda, se calcula al leer, así que
toda orden pasada la muestra en cuanto el código sale. Y escribirla habría sido peor que inútil —
tres ejes rellenos se leen como `manual`, o sea «alguien midió esto», que es la clase de mentira que
costó `dimensions_verified`.

Lo que sí se hizo es correr la lógica real contra prod, sin escribir nada (848 órdenes completadas
en 3 meses, 316 regulares, **346 pallets declarados**):

- **Los tamaños se agrupan en seis valores.** `55×40×66` (156), `55×40×36` (75), `55×40×83` (53),
  `55×43×83` (32), `55×40×75` (21), `55×43×75` (9). Es lo que se espera de un almacén que manda la
  misma caja: si salieran 200 tamaños distintos, la regla estaría mal.
- **`pallets_qty` guardado vs recalculado: 172 cuadran, 12 no** (de 184 sueltas; las 92 en grupo no
  son comparables fila a fila porque el conteo vive en el ancla). **Las 12 difieren siempre en la
  misma dirección**: el guardado es mayor — `qty=3 calc=1` sobre 4 cajas, `qty=2 calc=1` sobre 1.
  Ese número lo teclea la estación en Ship, así que es una persona diciendo «armamos 3» contra una
  aritmética que dice 1, y manda la persona.
  → De ahí sale `palletsQty` en `PalletDeclaration`: cuando no coinciden, la cabecera lo dice en
  ámbar (`· Pallets says 3`). La tarjeta no puede decir dos cosas distintas sin avisar, y el bloque
  nunca inventa una fila para cuadrar.
- **147 de 276 órdenes llevan alguna caja sin medir**, que es el `N of M boxes unmeasured` en ámbar.
  Era lo previsto (529 bicis sobre los defaults del trigger) y es justo lo que la cola de
  `/export/measure` va bajando.

## 13) Lo que sigue abierto: `pallets_qty` no cuenta el bulto de las juveniles

`calculatePalletsWithBikeAwareness` saca las bicis de niño a su propio contenedor
(`containerKind: 'smallBikes'`, `isParts: true`), y `isParts` es lo que decide que algo **no cuenta
como pallet físico**. Medido en prod, en 3 meses: **cero** bicis de niño acabaron dentro de un pallet
físico, y **18 órdenes regulares no tienen ninguno** — #881418 son 22 bicis de niño y
`physicalPalletCount` es 0, así que `pallets_qty` sale 0 y el bloque nuevo no dibuja nada.

Eso **no lo introduce esta función, la destapa**: explica también las diferencias de §12, donde el
guardado era mayor que el recalculado (#881543 y #881647 están en las dos listas — la estación
tecleaba el pallet que PickD no contaba).

**Resuelto a medias el 22 sep:** el bloque de Ship ya declara ese bulto (§7.5), así que una carga de
puras juveniles enseña su pallet en vez de nada. Lo que **no** ha cambiado es `pallets_qty`, que
sigue saliendo de `physicalPalletCount` y sigue sin contarlo: en esas 18 órdenes los cuatro números
dirán 0 pallets mientras el bloque enseña 1, y la cabecera lo marcará en ámbar («Pallets says 0»).

Contarlo es una decisión aparte porque cambia el número que la estación teclea en Audit Source **y**
el peso total (`palletCount * 40`), que hoy la estación ya corrige a mano tecleando el conteo real.
**Sin decidir; pendiente de Rafael.**
