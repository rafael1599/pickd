# Identidad del SKU: registro desde Double Check y unificación del guion

Análisis del 26 ago 2026, medido contra prod y contra el código de `pickd` y `watchdog-pickd`.
Dos síntomas que el operador reporta como distintos y son el mismo problema: **el SKU no tiene una
sola forma canónica y ninguna capa la impone al escribir**.

---

## 1. Registrar desde Double Check deja la tarjeta en rojo y ofrece duplicar

### Qué pasa, paso a paso

1. La tarjeta pinta `UNREG` / "not in stock" desde la **bandera guardada** en `picking_lists.items`
   (`sku_not_found`), no desde inventario vivo:
   `DoubleCheckView.tsx:2205` `skuNotFound = !!item.sku_not_found && !canonResolved`, badge en
   `:2418-2422`. `LOW STOCK` sí se recalcula en vivo (`liveInsufficient`, `:2220-2223`), pero solo
   para ítems que **no** son `sku_not_found`: `stockMap` los excluye en `:258-262`.
2. Registrar no toca esa bandera. `registerSku.onSave` (`:961-971`) hace `addItem` +
   `fetchDistributions`; el efecto "auto-resolve" que sí reescribe `items` en DB (`:1114-1193`)
   cura **solo** `location` (si es null) e `insufficient_stock` (`:1125-1149`). No existe ninguna
   rama, RPC ni trigger que ponga `sku_not_found = false` (las migraciones solo *leen* la bandera
   para saltarse movimientos de inventario). `useCanonicalSkuResolution` tampoco ayuda: descarta el
   match exacto (`useCanonicalSkuResolution.ts:98`), que es justo el caso tras registrar con la
   misma grafía. Resultado: la ubicación se cura (`displayLocation` lee `skuLocationsMap`, `:2225`) y
   el badge rojo se queda — el estado mixto que se ve en pantalla.
3. El modal ofrece "Bici o Parte" cuando `rows.length === 0` (`SkuLocationsModal.tsx:101`), y
   `arrangeSkuLocations` descarta cualquier fila con `quantity 0` que no sea la dirección del pick
   (`skuLocations.ts:504-508`). `buildNewSkuPrefill` siembra `quantity: 0, location: null`
   (`newSkuPrefill.ts:55-56`). Guardar con 0 = la fila existe pero el modal no la ve = vuelve a
   ofrecer registrar = duplicado.
4. **Filas fantasma.** `ItemDetailView.executeSave` en modo `add` hace el `upsert` de `sku_metadata`
   **antes y sin esperar** al `onSave` que crea el inventario (`ItemDetailView.tsx:643-676`), y el
   schema de entrada exige `location` (`inventory.schema.ts:76`), que el prefill deja en null. Si el
   inventario falla (toast "Error adding item"), el metadata ya quedó escrito. También crean metadata
   con el sku del ítem, tal cual, `ShipScreen.tsx:563-564` y `PartsWeightEditor.tsx:44-45` al poner
   peso. Prod: **96 filas de `sku_metadata` sin ninguna fila de inventario**, 69 de los últimos 90
   días, nacen horas después de la orden (tres en el mismo segundo, con `weight_lbs 0.1`), con la
   grafía sin guion del watchdog (`010491`, `650009`, `860021BK`).

### Dos maneras de manejarlo

**A. Derivar, no almacenar (cliente — el patrón que ya usa `liveInsufficient`).**
La bandera guardada es la sospecha del watchdog en el momento del intake; la verdad es "¿hay fila
de inventario para este SKU?".

- Incluir los `sku_not_found` en la consulta de `stockMap`/`skuInventoryMap` (quitar el filtro de
  `:258-262`) y calcular `skuNotFound = bandera && !hayFilaDeInventario`.
- En el efecto auto-resolve (`:1137-1149`) añadir la rama `if (item.sku_not_found &&
  skuInventoryMap[sku]) { sku_not_found = false; changed = true }` → se persiste con el `update`
  que ya existe (`:1172`).
- Modal: el gate de registro pasa a ser "no hay **ninguna** fila para el SKU" (rows sin filtrar por
  cantidad). Una fila a 0 se lista como "registrada · 0 en stock" con el botón Editar de siempre: el
  segundo toque es "ponle cantidad", no "créala otra vez".
- Coste: ~40 líneas en 3 archivos, sin migración. Límite: la bandera en DB sigue mintiendo hasta que
  este dispositivo reescriba `items`; otro dispositivo, el Live Board o la verification queue la
  ven vieja.

**B. La DB sella la verdad (trigger — el patrón de `a_stamp_item_sku_metadata`,
`classify_picking_note`, `set_is_bike_on_insert`).**
`sku_not_found` pasa a ser **derivada** en cada write de `items`.

- `stamp_item_sku_metadata` (`20260820150000`) ya recorre cada elemento y le sella
  `is_bike`/`weight_lbs`; añadir `sku_not_found := NOT EXISTS (sku_metadata vía
  lookup_canonical_sku)`.
- Trigger AFTER INSERT en `sku_metadata` (y en `inventory`) que "toque" las órdenes no terminales
  que contienen ese SKU (`UPDATE picking_lists SET items = items WHERE status NOT IN (...) AND
  items @> ...`) → el sello se recalcula y realtime avisa.
- Cliente: `usePickingSync` ignora `payload.new.items` hoy (`:413-470`); tiene que releer `items`
  de la lista abierta cuando cambien. Es lo mismo que necesita el flujo multi-usuario (Take Over).
- Coste: 1 migración (~80 líneas) + 1 cambio en `usePickingSync`. Vale para todos los consumidores,
  incluida la app del watchdog (`app.py` pinta badges por `sku_not_found`). Y cura de paso el caso
  "orden esperando contenedor": cuando `register_container` crea el SKU, las órdenes en waiting se
  curan solas — hoy nadie las recalcula.
- Riesgo: un insert de inventario escribe en `picking_lists`; respetar el orden de triggers BEFORE
  (`a_` prefix) y acotar el toque a órdenes no terminales que contengan el SKU (un contenedor de
  200 SKUs = a lo sumo 200 updates baratos).

**Recomendación:** B para la bandera (es la filosofía documentada — "todo consumidor lee la misma
verdad sin buscarla" — y esta bandera es hoy la única "verdad" que nunca se refresca) **más** el
gate del modal de A, que es UI y no le corresponde a la DB. Si se quiere el mínimo hoy: A completa,
y B junto con la migración del guion, porque comparten `lookup_canonical_sku`.

En cualquiera de los dos: el alta desde picking deja de hacer el `upsert` de metadata suelto.
`register_new_sku` ya existe, es atómico y dedup por clave normalizada
(`20260501120000`, `20260717200000`); debería ser el único camino de alta, o como mínimo
`executeSave` espera al `onSave` antes de escribir metadata. Eso mata las fantasmas.

---

## 2. El guion (y el cero): por qué no se ha unificado

### Cómo se escribe hoy

Catorce vías escriben un SKU nuevo; **una** normaliza el guion.

| Vía | Dónde | Normaliza | Puede crear sin guion / minúsculas |
|---|---|---|---|
| Label Studio inline create | `InlineSkuCreate.tsx:48` | trim + upper + guion (`normalizeSkuOnRegister`) | no — **único caller** |
| ItemDetailView `add` → `sku_metadata` | `ItemDetailView.tsx:643` → `inventoryApi.ts:130` | ninguna (`SKUMetadataSchema.sku = z.string().min(1)`) | sí, incluso minúsculas (input crudo `:1102`) |
| ItemDetailView `add` → `inventory` | `:665` → `inventory.service.ts:244` | trim + quita espacios (`inventory.schema.ts:71-76`) | sí |
| Shell de SKU desconocido | `inventory.service.ts:371` | ninguna | sí |
| Prefill desde picking | `SkuLocationsModal.tsx:113` → `newSkuPrefill.ts:57,63` | **verbatim** | sí — `010530` del watchdog entra tal cual |
| FedEx returns / Return-to-Stock | `useFedExReturns.ts:94,345`, `ReturnToStockSheet.tsx:199-229` | upper + trim | sí (sin guion) |
| Ship screen / Parts weight | `ShipScreen.tsx:563`, `PartsWeightEditor.tsx:44` | ninguna | sí — `upsert` inserta si falta |
| Scratch & Dent manual | `ScratchAndDentEditorSheet.tsx:191`, `SDQuickIntakeModal.tsx:137` | trim | sí (el autogenerado `01-NNNN` sí lleva guion) |
| Register Container | `parseShipmentXlsx.ts:19-26`, `_container_base_sku` (`20260601120000:36-45`) | upper + guion + dept a 2 dígitos (trunca color a 2 letras) | no |
| `register_new_sku` RPC | `20260717200000:35,66-78` | `upper(trim)`; redirige a una fila con guion **solo si ya existe** | sí, para un SKU nuevo |
| Triggers en `sku_metadata`/`inventory` | `20260821160000:59`, `20260408000001:34` | ninguna — leen `NEW.sku`, nunca lo asignan | — |
| CHECK de formato / índice único normalizado | — | **no existen** | `033768BL` y `03-3768BL` coexisten |
| Watchdog | `parser.py:24`, `supabase_client.py:823` | upper + quita todo lo no alfanumérico → **siempre sin guion** | el ítem no encontrado entra en `items` como `010530` |

Todas las capas *de lectura* son tolerantes (`inventorySkuCandidates`, `lookup_canonical_sku`,
`search_inventory_with_metadata` con `regexp_replace(sku,'[-\s]','')`, el trgm normalizado). Cada
intento anterior añadió otra lectura tolerante en vez de una escritura canónica, y por eso "no se
ha logrado unificar": la regla vive en TS, en un sitio, opcional, y la DB acepta cualquier string.

### Qué hay en prod (2.285 SKUs)

| Forma | n | con stock | creados últimos 30 d |
|---|---|---|---|
| `dd-dddd` (parts, 4 dígitos) | 929 | 851 | 15 |
| `dd-dddd` + color (bikes) | 733 | 523 | 17 |
| otros (`PKD-…`, seriales `Y22B010415`, tracking) | 377 | 355 | 13 |
| **sin guion, numérico** (`860017`, `128353`) | 70 | 14 | **10** |
| **sin guion + color** (`700106BK`, `128338BK`) | 29 | 3 | **2** |
| **corto** `dd-ddd` (`31-75`, `01-530`) | 48 | 44 | 8 |
| **corto + color** (`31-214WH`, `86-004BK`) | 49 | 46 | 3 |
| UPC 12 dígitos | 40 | 39 | 4 |
| con espacio (`S/D 03-3826GY`), corchete (`01-093]`), espacio final (`03-3709BL `), minúsculas (`brakes`, `No-sku`) | 7 | 4 | 1 |

- **10 familias duplicadas por clave normalizada**: `12-8338BK`(22)/`128338BK`(0),
  `65-0009`(45)/`650009`(0), `86-0007BK`(45)/`860007BK`(0), `86-0023BK`, `86-0024BK`, `65-0022`…
  El con guion tiene el stock; el sin guion es fantasma.
- **El cero inicial es la otra mitad.** AS400 imprime siempre 4 dígitos (`01 0497`, `31 0075`,
  verificado en `raw_sku`); el catálogo heredado está así (1.662 SKUs); pero a mano se escribe
  corto. **26 parejas** son el mismo part con stock partido: `66-0110BK` 514 / `66-110BK` 195,
  `31-0075` 900 / `31-75` 1.350, `23-0404` 60 / `23-404` 840, `12-0850` 99 / `12-850` 22.
- Las correcciones manuales van en las dos direcciones: 19 ago `128338BK → 12-8338BK` (pone
  guion), 18 ago `01-0429 → 01-429`, `01-0077 → 01-077` (quita cero), 20 ago se registra
  `86-004BK` existiendo `86-0007BK`. No es una convención: es cómo teclea cada uno.
- Coste operativo: de 52 reemplazos de SKU en 90 días, 10 son solo de grafía (3 guion, 7 cero). De
  67 ítems `SKU not found` en 90 días, **los 67 sin guion**, 12 con hermano con guion **y stock**
  (`12-8338BK:22`, `65-0009:45`, `70-0105SK:95`, `63-3110:33`, `12-8324:14`…); el resto se
  registró después con la grafía sin guion y engrosa las 96 fantasma.

### Plan para cerrarlo de una vez (cuatro piezas, en orden)

1. **Decidir la forma canónica** — la decisión que ha faltado. Propuesta: `DD-NNNN[CC(C)]`, la de
   AS400: dept 2 dígitos, número **4 dígitos con ceros**, color 2-3 letras, mayúsculas. Lo que no
   encaje (UPC, `PKD-`, seriales, tracking) se guarda `upper(trim)` sin tocar. Implica `01-429 →
   01-0429` y `86-004BK → 86-0004BK`, lo contrario de los renames del 18 ago. La alternativa (corto,
   sin ceros) no la deriva ninguna máquina del PDF sin una regla "quitar ceros" que ya rompe
   `23-00146A`, y contradice el 70 % del catálogo. Si el piso quiere *ver* `01-429`, es un asunto de
   display, no de almacenamiento.
2. **`canonical_sku(text)` en SQL + trigger BEFORE INSERT/UPDATE en `sku_metadata` e `inventory`**
   que asigne `NEW.sku := canonical_sku(NEW.sku)` — patrón `set_is_bike_on_insert`: la DB es la
   autoridad y ningún cliente puede saltársela (ni ShipScreen, ni el prefill, ni un script). Espejo
   TS `normalizeSkuOnRegister` ampliado con la regla de ceros y test de paridad contra una tabla de
   casos fija (como `skuDefaults.ts` ↔ trigger). Migración aditiva: no toca datos. El watchdog no
   cambia: su `sku_map` matchea por clave normalizada; añadirle la clave sin ceros
   (`regexp_replace(k,'^(\d{2})0+','\1')`) atrapa `01-530` mientras dure la transición.
3. **Columna generada `sku_key`** (`regexp_replace(upper(sku),'[^A-Z0-9]','','g')`) con **índice
   único** en `sku_metadata`: imposible volver a crear `128338BK` junto a `12-8338BK`.
   `lookup_canonical_sku` y el search pasan a usarla. Requiere fusionar antes las 10 familias
   exactas (las sin guion están a 0: se borran o se renombran; ninguna tiene stock).
4. **Migración de datos**, como `20260814020000` (ATS): renombrar las 99 sin guion y las 97 cortas
   a canónico; reescribir el texto denormalizado en `inventory`, `inventory_logs` (×2),
   `daily_inventory_snapshots`, `asset_tags` **y `picking_lists.items`** (jsonb) de órdenes no
   terminales; borrar las 96 fantasma sin inventario. Las 26 parejas con stock en ambas requieren
   confirmación física antes de fusionar (`23-0404` "stem cromo 60 w/o logo" vs `23-404` "STEM W/O
   LOGO 22.3MM BLACK": probablemente el mismo part, pero es decisión de piso, no de SQL). Se
   prepara con la lista para confirmar fila a fila.

### Hallazgo lateral (bug-018)

`inventory.service.ts:270-277` concatena `existente | entrante` en `item_name` cuando se añade
stock a una fila `(sku, warehouse, location)` con un nombre distinto. El cancel-restore llama a
`addItem` con la nota como `item_name` — de ahí `ALLEGRO A1 23 THUNDER GREY | Auto-cancel
verification timeout | auto-restore on cancel`, que luego se copia a `model`. Es el origen que
bug-018 dejó como "sospechoso".
