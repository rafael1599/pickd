# El serial de PickD: `PD000123` para la caja sin serial ni SKU (idea-259 P1)

Estudio, 8 oct 2026. Nada construido, ninguna migración. Las ❓ (§9) llevan su respuesta por
defecto: un «ok todo» las cierra. Cifras de prod releídas el 8 oct (SELECT agregados dentro de una
transacción `read only`).

Rafael, 7 oct: «quiero poder asignar seriales nuevos e incruzables con los que maneja el warehouse
en pickd a las cajas que tengo que registrar y no tienen ni serial ni sku, solo nombre, y unificar
los registros de un nuevo item a comenzar desde una foto». Decidido el mismo día (backlog, idea-259)
y **no se reabre aquí**: formato `PD` + 6 cifras sin dígito de control; cajas iguales = **un SKU
con N unidades y un serial PD por caja**; sin SKU **el serial PD hace de SKU** (con N cajas, el de la
primera) hasta que el AS400 dé número y `rename_sku_everywhere` lo pase con su historia; entradas
Register + Batch (P2); al guardar la ficha no se cierra y pregunta si imprimir (`9e6e3470`); la caja
es bici nueva por defecto, con el switch BIKE/PART de siempre.

## 1. Contexto: lo que hay hoy

| Qué (prod, 8 oct)                                                                                                                                         | Cifra                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Filas en `sku_metadata` · sin `serial_number`                                                                                                             | **2.644 · 2.411** (el backlog decía 2.643 · 2.410 el 7)         |
| Seriales por primera letra                                                                                                                                | Y 75 · W 51 · M 47 · G 23 · `0` 16 · U 9 · P 3 · 9 sueltas      |
| Los 3 que empiezan por `P`                                                                                                                                | `Par…`, 5 caracteres (no son seriales `PD`)                     |
| Algo que empiece por `PD` en `sku_metadata.sku` / `.serial_number`, `sku_serials.serial`, `sd_units.serial_number`, `inventory.sku`, `inventory_logs.sku` | **0 en las seis**                                               |
| SKUs que empiezan por letra                                                                                                                               | 377; de ellos **290 `PKD-…`** (partes, `PKD-001STE`) y 1 `POT…` |
| Códigos cortos de `asset_tags`                                                                                                                            | `PK-0000BB` (9 caracteres, guion)                               |
| `sku_serials`                                                                                                                                             | 28 filas, 27 SKUs, `source` ∈ {`label_scan`, `manual`}          |
| `v_sd_as400_review`                                                                                                                                       | 7 CREATE · 16 UPDATE                                            |

`PD` + 6 cifras no choca con nada: `PKD-` lleva K y guion, `PK-` guion, y ningún fabricante de los
que hay empieza por `PD`.

**Lo que el código hace hoy con `PD000123`** (leído, archivo:línea):

| Pieza                                                                                                                       | Resultado con `PD000123`                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `canonical_sku` (`20260826220000_canonical_sku.sql:51-74`) y `normalizeSkuOnRegister` (`src/utils/skuNormalize.ts:175-182`) | No encaja en `DD-NNNN`: sale `upper(trim)` → `PD000123`. **Ojo:** `' PD 000123 '` sale `PD 000123` (el espacio de en medio se queda); `sku_key` lo pliega a `PD000123`.                                                       |
| `is_bike` por prefijo (`set_is_bike_on_insert`, `20260901204403…sql:86-87`; `BIKE_SKU_PREFIXES`, `bikeDetection.ts:12`)     | `PD` no está en `01/02/03/06/07` → sería **parte**. No pasa: el alta manda `is_bike` explícito (`registerItem.ts:321,326`) y el shell del catálogo lo reenvía (`inventory.service.ts:401-406`); el trigger sólo rellena NULL. |
| `serialLooksReal` / `serialKey` (`serialIdentity.ts:31-49`)                                                                 | Acepta (8 caracteres, 6 cifras); la llave no cambia (no hay `O` ni `I`).                                                                                                                                                      |
| Buscador de Stock, modo Auto (`stockSearch.ts:46-56`)                                                                       | Tiene letras → `all`; no le pone guion.                                                                                                                                                                                       |
| Watchdog (`watchdog-pickd/sku_enrichment.py:138-142`, colas en `:908-913` y `:934-939`)                                     | `is_lookupable` exige `^\d{2}-\d{4}[A-Z]{0,3}$`: **nunca pregunta por un `PD`**. No hay bucle, y tampoco llega a poner `as400_absent_at`.                                                                                     |

**Lo que choca con el brief** (encontrado al leer):

1. **`sku_serials` no es único por serial**, sólo por `(sku, serial)` (`20260921110000_sku_serials.sql:47-48`, a propósito por R15). «Incruzable» necesita un índice único parcial para `PD…`.
2. **`rename_sku_everywhere` no mueve `sku_serials`** (versión vigente `20261007155522…sql:284-480`: inventario, logs, snapshots, `asset_tags`, `sku_photos`, conteos, órdenes; `sku_serials` no). Hoy ya deja los 28 seriales escaneados colgados del nombre viejo en cualquier renombre; con el PD sería perder las cajas.
3. **`rename_sku_everywhere` es sólo `service_role`** (`20260826220000…sql:267-268`) y la app no la llama en ningún sitio. El renombre de la ficha (`ItemCardView.tsx:216,686`) cambia el `sku` de la fila de inventario y deja la vieja de huérfana con historia.
4. **Registrar más de una caja esconde el serial y no lo guarda** (`RegisterItemView.tsx:273` `multiUnit`, `:455` el `if (!multiUnit …)` antes de `recordSkuSerial`, `:597` `hideSerial`). N seriales por alta es un camino nuevo.
5. **El buscador por serial sólo mira `sku_metadata.serial_number`** (`20261007193244_sd_find_sold.sql:97-107`), no `sku_serials`: buscar `PD000002` no encontraría la caja 2.
6. **Imprimir N etiquetas del mismo SKU con seriales distintos se colapsa**: `useGenerateLabels` busca la entrada de cada tag por SKU (`useGenerateLabels.ts:132-135`, `entryBySku`), así que las N saldrían con el serial de la última.
7. **La etiqueta codifica el SKU, no el serial**: código de barras `code128Pattern(item.sku)` (`labelLayout.ts:588,747`) y QR `/s/<sku>` (`:397`). Tras el renombre el SKU cambia y el `PD` impreso no.
8. **`v_sd_as400_review` es sólo de S/D**: `unit_kind = 'sd'` y SKU `^01-` (`20261007171537…sql:67,75,95`), y su botón sólo sale con el filtro S/D puesto (`InventoryScreen.tsx:1289`). Un PD (bici nueva) nunca saldría.

## 2. Requisitos

1. Una caja sin SKU ni serial se registra desde la pantalla de registro de hoy con **un toque más**: `No SKU · PickD serial`.
2. PickD emite N seriales `PD` + 6 cifras **consecutivos** en una sola llamada, comprobando que ninguno exista ya en `sku_metadata` (sku y serial), `inventory.sku`, `sku_serials.serial` ni `sd_units.serial_number`.
3. El SKU es el primer serial; el alta es un SKU con N unidades; **cada caja tiene su fila en `sku_serials`** (`source = 'pickd'`).
4. Ningún `PD<cifra>` entra en la base si PickD no lo emitió: ni tecleado como SKU, ni como serial, ni desde el Sheet de S/D.
5. Al guardar, la hoja **Registered** imprime **N etiquetas, una por serial**, cada una con su serial en grande y su código de barras.
6. Buscar cualquier serial `PD` en Stock lleva a la fila de su caja, antes y después del renombre.
7. El SKU `PD…` con stock sale en **AS400 review** como CREATE hasta que alguien escribe el número del AS400; entonces se renombra con toda su historia y sus seriales.
8. Nada de pantallas nuevas: registro, hoja Registered, ficha y AS400 review son las de hoy.

## 3. Conceptos

- **Serial PD** — `PD` + 6 cifras de `pickd_serial_seq`. Es de **una caja**, nunca cambia, va en su etiqueta.
- **SKU PD** — el serial PD de la primera caja, usado de SKU mientras el AS400 no da número. Cambia una vez: al renombrar.
- **Serial quemado** — emitido y nunca guardado (el alta falló). No se reusa; deja un hueco, como `sd_number`.

## 4. Datos

**Nuevo**

- **`pickd_serial_seq`** — secuencia, empieza en 1.
- **Sin tabla `pickd_serials`** (❓1). `sku_serials` ya tiene todo lo que esa tabla tendría: serial, SKU,
  quién (`created_by`), cuándo (`first_seen_at`), dónde (`warehouse`), y `observed` para el nombre con el
  que se emitió. La foto es la portada del SKU. Un serial quemado es una fila `pickd` cuyo SKU no tiene
  catálogo: se ve con un `NOT EXISTS`, no hace falta una columna de estado.
- **Índice único parcial** `sku_serials_pd_serial_key ON sku_serials (serial) WHERE serial ~ '^PD[0-9]'`:
  un PD vive en un solo SKU, aunque el resto de la tabla siga midiendo colisiones (R15).
- **`issue_pickd_serials(p_count int, p_name text) RETURNS text[]`** — `SECURITY DEFINER`,
  `authenticated` + `service_role`, `1 ≤ p_count ≤ 60` (❓4). Toma `pg_advisory_xact_lock(hashtext('pickd_serial_seq'))`
  para que los N salgan **seguidos** aunque dos teléfonos pidan a la vez; para cada `nextval` arma
  `'PD' || lpad(n, 6, '0')` y lo salta si su llave (`[^A-Z0-9]` fuera) ya existe en cualquiera de los
  cinco sitios del requisito 2. Inserta las N filas en `sku_serials` (`sku` = el primero, `source =
'pickd'`, `observed = {name}`, `created_by = auth.uid()`) con `set_config('pickd.issuing_pd','on',true)`
  y devuelve el arreglo. Se llama al pulsar **REGISTER**, antes de escribir nada.
- **`pd_serial_guard()`** — una función, tres triggers `BEFORE INSERT OR UPDATE`. Llave = `upper` sin
  nada que no sea A-Z0-9 (así `PD 000123` y `pd-000123` también caen):
  - en **`sku_serials`** (`OF serial, source`): una llave `^PD[0-9]` sólo entra con `pickd.issuing_pd =
on` (dentro de `issue_pickd_serials`); un UPDATE que sólo cambia `sku` pasa (renombre).
  - en **`sku_metadata`** (`OF sku, serial_number`): una llave `^PD[0-9]` en `sku` o en `serial_number`
    exige su fila `pickd` en `sku_serials`. Cubre `inventory` (FK `inventory_sku_fkey`,
    `20260307221638_remote_schema.sql:1555`), el Sheet de S/D (`sd_sheet_apply_edit` escribe
    `serial_number`) y `sd_units` (sólo lo llena `archive_sd_unit` copiando el catálogo).
  - Error en inglés, el que ve el operario: `PD000099 was not issued by PickD`.
    Hoy hay 0 filas con `PD`, así que los triggers se instalan sin limpiar nada.
- **`rename_pickd_sku(p_pd text, p_new text) RETURNS jsonb`** — `SECURITY DEFINER`, `authenticated`. Sólo
  acepta `p_pd ~ '^PD[0-9]{6}$'` y un `canonical_sku(p_new)` con forma `^\d{2}-\d{4}[A-Z]{0,3}$`; llama a
  `rename_sku_everywhere(p_pd, canonical, 'pickd serial → AS400')`. Es la única puerta de un operario a
  esa función, y sólo para SKUs PD (❓5).
- **`v_sd_as400_review`**, una rama más: SKU `^PD[0-9]{6}$` con stock en LUDLOW, cualquier `unit_kind`
  → `action 'CREATE'`, `reason 'PICKD SERIAL'`, `serial_number` = nº de cajas. Mismo nombre y mismas
  columnas: la hoja y el PDF 6×4 no cambian de forma.

**Cambia**

- **`rename_sku_everywhere`**: `UPDATE sku_serials SET sku = p_new WHERE sku = p_old` (borrando antes un
  `(p_new, serial)` repetido). Arregla también los 28 seriales de hoy en cualquier renombre.
- **`search_inventory_with_metadata`**, rama `serial`: `OR EXISTS (SELECT 1 FROM sku_serials s WHERE
s.sku = i.sku AND regexp_replace(s.serial,'[-\s]','','g') ILIKE '%'||term||'%')`. Cualquier serial
  escaneado se vuelve buscable, no sólo los PD.
- **`skuSerials.service.ts:23`**: `source` admite `'pickd'` (sólo lectura desde la app; lo escribe la RPC).
- **`registerItem.ts`**: `RegisterIdentity.pickd: boolean`. Con `pickd`, `readiness` no pide SKU ni serial
  (pide nombre en MODEL), y `buildRegisterWrite` recibe los seriales emitidos: SKU = el primero,
  `serial_number` sólo si es S/D (❓6), `cartonSerial` = null (ya están en `sku_serials`).
- **`RegisterItemView.tsx`**: el botón del §5, la llamada a `issue_pickd_serials` antes de `onSave`, y
  `registered` guarda los seriales para la hoja.
- **`useGenerateLabels.ts:132-135`**: emparejar tag ↔ entrada **por posición** (las filas de
  `asset_tags` vuelven en el orden del insert), no por SKU. `asset_tags.serial_number` ya existe y
  guarda el serial de cada caja.
- **`LabelItem.box_serial`** + `computeLabelFace` (§6).
- **`ItemCardView.tsx:686`**: renombrar un SKU `PD…` llama a `rename_pickd_sku` en vez de reescribir la
  fila (si no, deja la ficha PD de huérfana con los logs).
- **`InventoryScreen.tsx:1289`**: el botón **AS400 review · N** sale también sin el filtro S/D cuando hay
  líneas `PICKD SERIAL`.

**RLS y grants.** `sku_serials` sigue como está (lectura/insert/update `authenticated`, sin DELETE): el
guardián, no la política, es quien decide sobre los `PD`. Las dos RPC nuevas: `REVOKE ALL … FROM
public; GRANT EXECUTE … TO authenticated, service_role`, con `auth.uid() IS NULL AND current_user NOT
IN ('postgres','service_role')` → `42501`, como `sd_as400_done`. La secuencia sólo la toca la RPC
(`SECURITY DEFINER`); `authenticated` no recibe `USAGE`.

## 5. Pantalla (430 px)

**Decir «no tiene nada».** La pantalla de registro ya tiene dos caminos a la casilla SKU: la foto que no
lee SKU (casilla roja) y `No label — type the SKU` (`RegisterItemView.tsx:539`). Los dos abren el
`FieldSheet` del SKU. Ahí, debajo del campo, **un botón**:

```
┌──────────────────────────────── 430 ┐
│ SKU                                 │
│ ┌─────────────────────────────────┐ │
│ │ 03-                             │ │
│ └─────────────────────────────────┘ │
│ [ No SKU · PickD serial          ]  │
│ [ Cancel ]            [ Done ]      │
└─────────────────────────────────────┘
```

Tocarlo cierra la hoja y deja la etiqueta de cartón así (el número aún no existe: se emite al
registrar, así un alta abandonada no quema nada):

```
┌──────────────────────────────── 430 ┐
│ ← New item                          │
│ ┌ SKU    PD······  PickD serial   ┐ │
│ │ MODEL  · type the name          │ │  ← rojo hasta tener nombre
│ │ SIZE   ·   COLOR  ·             │ │
│ │ [ BIKE ] [ PART ]   [ S/D ]     │ │
│ └─────────────────────────────────┘ │
│ ┌ WHERE ────────┐ ┌ HOW MANY ─────┐ │
│ │ ROW 30 · C    │ │      3        │ │
│ └───────────────┘ └───────────────┘ │
│ [   REGISTER · 3 PD serials   ]     │
└─────────────────────────────────────┘
```

- La fila SERIAL desaparece: el serial es el PD de cada caja.
- **MODEL** abre el `FieldSheet` con hasta 5 coincidencias del catálogo debajo del campo (la misma
  búsqueda que `ModelSheet`, `ReturnParts.tsx:110-131`, sólo `unit_kind = 'new'`). Tocar una = **esa
  caja tiene SKU**: la casilla SKU pasa a ese número y se apaga el modo PD (❓3). Escribir y Done =
  nombre nuevo.
- Volver a tocar la casilla SKU y escribir un número apaga el modo PD.
- **HOW MANY** es el de siempre; el botón dice cuántos seriales va a emitir.

**Al pulsar REGISTER:** `issue_pickd_serials(3, 'XENITH T2 56 RED')` → `PD000001…003`; luego lo de hoy
(inventario, catálogo, foto). Si algo falla después de emitir, el toast de siempre y los tres quedan
quemados (§8).

**La hoja Registered** (la de `9e6e3470`, `RegisterItemView.tsx:806-845`) con los seriales:

```
┌──────────────────────────────── 430 ┐
│ REGISTERED                          │
│ PD000001              3 u → ROW 30  │
│ PD000001 · PD000002 · PD000003      │
│ Print 3 labels, one per box?        │
│ [ Done ]          [ Print 3 labels ]│
└─────────────────────────────────────┘
```

Sin ventana de opciones: un PD no tiene UPC y la cantidad es una por serial, así que
`printNeedsOptions` no tiene nada que preguntar. Imprime directo; `Print again` repite las N.

## 6. La etiqueta 6×4 de una caja PD

La misma etiqueta de SKU (`computeLabelFace`), con el serial de la caja en el lugar del SKU:

```
┌────────────────────────────────────────────── 6×4 ┐
│ XENITH T2 56cm                          ┌──────┐  │
│ RED                                     │  QR  │  │
│ ┌──────────────────────────────┐        │      │  │
│ │          PD000002            │        └──────┘  │
│ └──────────────────────────────┘                  │
│ ║║│║║│║│║║│║║│║║  (Code 128 de PD000002)          │
│ SKU PD000001                                      │
└───────────────────────────────────────────────────┘
```

| Qué           | Etiqueta de SKU (hoy)                   | Etiqueta de caja PD                                                               |
| ------------- | --------------------------------------- | --------------------------------------------------------------------------------- |
| Caja negra    | el SKU                                  | **el serial de la caja**                                                          |
| Code 128      | el SKU                                  | **el serial** (no cambia al renombrar; la Zebra lo busca por `sku_serials`)       |
| Línea pequeña | serial del catálogo si no repite el SKU | `SKU PD000001`, sólo si no es el mismo (`serialRepeatsSku`, `labelLayout.ts:290`) |
| QR            | `/s/<sku>`                              | igual                                                                             |
| Copias        | dos por unidad                          | dos por caja                                                                      |

La caja 1 sale idéntica a una etiqueta de SKU normal (serial = SKU). En mayúsculas, como todo lo
impreso. Sin `#n`: un PD no es S/D salvo que se marque (❓6).

## 7. Interacciones

- **Stock.** La tarjeta enseña el SKU `PD000001` con 3 u, como cualquier SKU. Buscar `PD000002` la
  encuentra por la rama nueva de `sku_serials`. `PD` en modo Auto ya busca en todo.
- **Double Check.** Las órdenes vienen de papeles del AS400, que no conoce un `PD`: **ninguna orden puede
  pedirlo** hasta el renombre, salvo que alguien lo añada a mano en Edit Order (entonces es un SKU más,
  se recoge como cualquiera). Tras el renombre la orden pide el número real.
- **Ship.** Sin cambios: `is_bike` y peso salen del catálogo (45 lb y caja de bici por defecto si es
  BIKE, porque el alta lo manda explícito).
- **Watchdog.** No pregunta por `PD` (`is_lookupable`), así que no hay bucle ni `as400_absent_at`. La
  línea CREATE de AS400 review es la que avisa.
- **AS400 review.** La línea PD: `PD000001 · XENITH T2 56 RED · 3 boxes · CREATE · PICKD SERIAL`. En vez
  de **Done** lleva un campo `AS400 #` y **Rename**: `rename_pickd_sku` → `rename_sku_everywhere` mueve
  inventario, logs, snapshots, `asset_tags`, fotos, conteos y ahora `sku_serials`; si el número ya existe
  en PickD **fusiona** (las 3 cajas se suman a su stock). La línea se va porque el SKU dejó de ser PD.
- **Los seriales PD tras el renombre** se quedan: son de las cajas y siguen en sus etiquetas, ahora bajo
  `03-4999RD`. La Zebra que lee `PD000002` sigue llevando a la caja.
- **Sheet de S/D.** Sólo si la caja PD es S/D (❓6): sale con su `#` tras la primera impresión, como
  toda S/D. Escribir un `PD…` en la columna Serial que PickD no emitió lo frena el guardián.

## 8. Riesgos y casos raros

- **Dos teléfonos a la vez.** El candado de la RPC hace que cada llamada reciba un tramo seguido
  (A: `PD000004–005`, B: `PD000006–008`); `nextval` ya garantiza que nunca se repitan, el índice único
  parcial lo garantiza otra vez en la tabla.
- **Imprimir y no guardar.** No puede pasar: se imprime desde la hoja Registered, que sólo existe
  después de guardar.
- **Emitir y no guardar** (sin red entre la RPC y el alta). Los N quedan **quemados**: filas `pickd` en
  `sku_serials` cuyo SKU no tiene catálogo. No se reusan. Se cuentan con
  `SELECT … FROM sku_serials s WHERE source='pickd' AND NOT EXISTS (SELECT 1 FROM sku_metadata m WHERE m.sku = s.sku)`.
- **Borrar el alta.** La fila de inventario se va; la de catálogo y los seriales se quedan (el catálogo
  como huérfana con historia, `v_sku_metadata_orphans`). El serial **se quema**, nunca vuelve.
- **Una caja PD a la que luego se le encuentra serial de fábrica.** El PD se queda (está pegado en la
  caja); el de fábrica entra como otra fila de `sku_serials` del mismo SKU con `observed.pd =
'PD000002'` (❓7). Ninguno de los dos se borra.
- **Registrar un PD para algo que ya tenía SKU.** La lista de coincidencias del MODEL lo frena en el
  momento; si pasa igual, el renombre a ese SKU lo fusiona.
- **QR tras el renombre.** El QR impreso apunta a `/s/PD000001`, que ya no existe como SKU. No verifiqué
  qué enseña `/s/:sku` con un SKU renombrado (`App.tsx:359`); el código de barras sí sigue funcionando.
- **Una etiqueta vieja que la cámara lee como `PD…`** (P2, el lote): el guardián rechaza un serial no
  emitido, así que una lectura mala no puede crear un PD.

## 9. ❓ Preguntas (con respuesta por defecto)

1. **¿Tabla propia `pickd_serials` o basta `sku_serials` con `source = 'pickd'`?** Default: **basta
   `sku_serials`** + la secuencia + el índice parcial. Quién, cuándo y dónde ya están; lo quemado se ve
   por consulta. Una tabla aparte sería otra fuente para el mismo serial.
2. **¿Qué va en grande en las cajas 2…N?** Default: **el serial de la caja**, con su código de barras, y
   `SKU PD000001` en pequeño. La caja 1 sale como una etiqueta normal.
3. **El nombre, ¿con sugerencias del catálogo?** Default: **sí, hasta 5**; tocar una usa ese SKU y no
   emite PD.
4. **Tope de cajas por alta.** Default: **60** (dos pallets); más, el botón se desactiva con `max 60`.
   Un error de tecleo de 300 quemaría 300 números.
5. **¿Quién pasa el PD al número del AS400?** Default: **el operario, desde AS400 review** (campo + Rename),
   y el renombre en la ficha de un PD va por la misma RPC. No queda en manos de Claude.
6. **Una caja PD que es S/D.** Default: **se permite, con 1 caja**; el PD es su SKU y su serial
   (`serial_number`), recibe `#` en la primera impresión y sale en el Sheet y en AS400 review.
7. **Serial de fábrica que aparece después.** Default: **se suma** como otra fila de `sku_serials` del
   mismo SKU; el PD se queda.
8. **¿Arranca en `PD000001`?** Default: **sí**.

## 10. Casos de verificación

Primero en local; después la migración dentro de una transacción con rollback contra prod. Nada se
escribe en prod hasta el «ok».

1. **3 cajas «Xenith T2 56 Red»** (MODEL `Xenith T2`, SIZE `56`, COLOR `Red`), BIKE, ROW 30 · C. `issue_pickd_serials(3, …)` → `{PD000001, PD000002,
PD000003}`. Inventario: 1 fila `PD000001`, qty 3, ROW 30, `sublocation {C}`. Catálogo: `PD000001`,
   `is_bike true`, 45 lb, model `XENITH T2`, `serial_number NULL`. `sku_serials`: 3 filas `source pickd`,
   `sku PD000001`. Hoja: `PD000001 · 3 u → ROW 30`. Imprimir: 3 `asset_tags` con `serial_number`
   `PD000001/2/3`, 6 páginas; la 2.ª etiqueta dice `PD000002` en la caja negra, barras `PD000002`,
   `SKU PD000001`.
2. **Dos teléfonos a la vez** (2 y 3 cajas) tras el caso 1 → uno recibe `PD000004–005`, el otro
   `PD000006–008`; nunca intercalados.
3. **Teclear `PD000099` como SKU** → la pantalla no deja (`PD serials come from PickD`); por API, el
   upsert del catálogo falla con `PD000099 was not issued by PickD`. `pd-000099` y `PD 000099`, igual.
4. **Buscar `PD000002`** en Stock → la tarjeta `PD000001` (3 u, ROW 30).
5. **Emitir y cortar la red** antes del alta (2 cajas) → `PD000009–010` quemados; la siguiente alta
   empieza en `PD000011`; la consulta de quemados da 2.
6. **AS400 review** tras el caso 1 → 7 CREATE + 16 UPDATE de hoy + `PD000001 · CREATE · PICKD SERIAL · 3`.
   `AS400 # 03-4999RD` + Rename → inventario `03-4999RD` qty 3; los 3 `sku_serials` con `sku 03-4999RD`;
   `sku_canonical_renames` una fila `merged false`; la línea sale. Buscar `PD000003` → `03-4999RD`.
7. **Renombrar a un SKU que ya existe** (`03-4710BL` con stock) → `merged true`, las 3 se suman, los 3
   seriales pasan a `03-4710BL`.
8. **Escribir `PD000050` en la columna Serial del Sheet de S/D** → `sd_sheet_apply_edit` no escribe
   (guardián). ❓ sin verificar si el intento fallido queda en `sd_sheet_edits` o se va con el rollback.
9. **Nombre que ya existe**: escribir `xenith` en MODEL con el modo PD → las coincidencias del catálogo;
   tocar `03-3982BL` → SKU `03-3982BL`, modo PD apagado, REGISTER sin «PD serials».
10. **Instalar el guardián en prod** → 0 filas con `PD` en los cinco sitios (verificado 8 oct), ningún
    error.

## 11. Fases

- **P1 — lo de este estudio, cerrado en sí mismo.** Secuencia, índice, `issue_pickd_serials`,
  `pd_serial_guard`, `rename_pickd_sku`, la rama PD de `v_sd_as400_review`, `sku_serials` en
  `rename_sku_everywhere` y en el buscador; en la app el botón `No SKU · PickD serial`, las
  sugerencias de MODEL, N etiquetas en la hoja Registered (`useGenerateLabels` por posición,
  `box_serial` en la etiqueta), el Rename de la línea PD y el del ⋯ de la ficha. Checkpoint: casos 1–9 en
  local, capturas a 430 y 1400.

**Después (sin diseñar aquí):**

- **P2** (idea-252): Stock → ⋯ queda con **Register** (abre la cámara) + **Batch**; la foto sin SKU ni
  serial (caminos 4 y 7) termina en «nombre + serial de PickD» con la foto de portada; el lote por fotos
  emite PD para las tarjetas sin SKU.
- Reimprimir **una** caja concreta desde la ficha (hoy se reimprime el SKU).
- Que `/s/<sku>` resuelva un SKU renombrado o un serial.
