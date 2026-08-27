# Una sola llave: AS400 → watcher → Pickd → FedEx Ship Manager

Diseño y plan por fases para que los cuatro sistemas hablen del mismo cliente con el mismo
identificador. Nace del análisis de [`fedex-recipients-analysis.md`](./fedex-recipients-analysis.md)
(24 ago 2026). Estado de cada fase al final del documento.

## El objetivo, en términos del que despacha

1. En Pickd, la orden muestra un **ID de FedEx** con un botón de copiar.
2. En FedEx Ship Manager (FSM), pega el ID en el campo **Recipient ID** y el destinatario se
   rellena solo: empresa, contacto, dirección, teléfono, residencial o no.
3. Si FSM no conoce ese ID, teclea los datos que Pickd tiene en pantalla **una sola vez**; FSM
   los guarda al procesar el envío (la casilla _Save in/Update my address book_ viene marcada
   por defecto cuando hay Recipient ID) y a la siguiente ya está.
4. Aparte, Pickd exporta periódicamente los destinatarios nuevos a FSM en modo _Append_, para que
   el caso 3 sea raro.

Nada de esto requiere software nuevo en la máquina de FedEx. El watcher en esa máquina queda para
la fase de tracking, que es otra cosa.

## Lo que se verificó antes de diseñar

**En FSM (guía de usuario v2350, cap. 1, 11 y 12; v3313 es la instalada y hay que confirmar):**

- El Recipient ID es "un identificador único, **como un apodo o número de cliente**", de hasta
  **25 caracteres**. Al seleccionarlo "la información del destinatario y las preferencias se
  rellenan automáticamente".
- Con un Recipient ID nuevo, "_Save in/Update my address book_ se marca automáticamente" y "al
  procesar el envío, el destinatario nuevo se guarda en el Address Book". La misma casilla,
  marcada, **actualiza** un destinatario existente con lo que se haya cambiado en pantalla.
- Company y Contact name: 35 caracteres cada uno, al menos uno obligatorio. Address 1 y 2: 35.
- Import (`Databases → File Maintenance → Import`) tiene **tres modos**: _Append_ ("se añade,
  nada se elimina"), _Replace_ ("todo lo actual se elimina") y _Merge_ ("si un registro del
  archivo difiere del existente, el importado lo sobreescribe; si no existe, se añade"). Lo que
  hace _Append_ con un ID que ya existe no está documentado: se prueba en la fase 0.
- La información de envíos **se puede exportar, no importar** ("Shipment Information — Export
  only"), con filtro de fechas. Y el **Integration Assistant** (menú _Integration_) exporta "en el
  momento que elijas, por ejemplo el tracking number" a un archivo de texto o vía ODBC, e importa
  desde una fuente indexada por "un identificador alfanumérico único, como un número de orden".

**En el AS400 (fixtures de `watchdog-pickd/tests`):**

```
 Order Number: 880036                       Account Number: 0010495 00
 Bill TUCKER CYCLES                    Ship TUCKER CYCLES
      3544 ST JOHNS AVE                     3544 ST JOHNS AVE
      JACKSONVILLE    FL  32205             JACKSONVILLE    FL  32205
```

El header trae cuenta (7 dígitos + 2), Bill-to y Ship-to. **No trae teléfono ni contacto.**

**El cruce que confirma la llave** — cuentas de los fixtures buscadas en el export de FSM:

| AS400                             | ID derivado | en FSM                                                               |
| --------------------------------- | ----------- | -------------------------------------------------------------------- |
| `0010495 00` TUCKER CYCLES        | `1049500`   | ✔ TUCKER CYCLES, 3544 ST JOHNS AVE, JACKSONVILLE 32205               |
| `0000991 00`                      | `99100`     | ✔ BOULEVARD BIKES LLC, CHICAGO 60647                                 |
| `0020045 00` DEALER WARRANTY 2009 | `2004500`   | ✔ … pero es una **dirección particular en Beaufort SC**, sin empresa |
| `0003574 00`                      | `357400`    | ✗ (tendrá un ID de texto)                                            |
| `0099999 00` EBAY PART SALES      | `9999900`   | ✗                                                                    |

La tercera fila es el aviso: un canal (garantías, consumidor directo, eBay) despacha a una
persona distinta cada vez, y como la casilla de guardar viene marcada, la última persona queda
grabada bajo el ID del canal. Hay 524 destinatarios residenciales en FSM por ese camino.

**En Pickd (prod, 24 ago 2026):**

- `picking_lists.source`: **1.548 `pdf_import` (AS400) frente a 199 `manual`**; en 90 días, 806
  frente a 22. La llave llega sola en el 97 % de las órdenes recientes.
- `customers.name` es el **Bill-to**; `customer_addresses` guarda el **Ship-to**, con `label` =
  nombre del ship-to (105 de 598 difieren del cliente: drop-ships y `ATTN:`).
- `customers` tiene **filas duplicadas por nombre**: `JAMIS CONSUMER ALL ACCESS` ×15,
  `SPORTS BASEMENT` ×13, `LIVE WELL 30` ×8, `50 SOUTH SURF SHOP` ×5… `ShipScreen` crea una fila
  nueva cuando el nombre coincide pero la dirección no (`ShipScreen.tsx:1598-1620`). Sin una
  identidad distinta del nombre, no había otra forma.
- Canales con ship-to variable: `JAMIS CONSUMER ALL ACCESS` (25 direcciones, 72 órdenes),
  `FACEBOOK SALES` (5/12), `DEALER WARRANTY`, `EBAY PART SALES`, `DONATIONS`. Y multi-tienda
  legítimos: `DVC MANAGEMENT LLC` (resorts Disney), `SPORTS BASEMENT`, `REAL BICYCLES`.

## La llave

```
fedex_recipient_id = cuenta AS400 sin ceros a la izquierda ‖ sufijo ship-to
0010495 00  →  1049500
0007099 01  →  709901
```

Es la convención que FSM ya usa en sus 951 IDs numéricos, así que esos clientes funcionan el
primer día sin importar nada. Cabe en los 25 caracteres, es solo dígitos y quien despacha ya lo
tiene en la hoja.

**La llave identifica un _ship-to_, no un cliente.** Un dealer con dos tiendas tiene `xxxx00` y
`xxxx01`. Por eso vive en `customer_addresses`, no en `customers`. Si el dealer se muda, el slot
es el mismo y la dirección cambia: se actualiza la fila y se vuelve a sincronizar.

Tres clases de destinatario, y cada una se trata distinto:

| clase                               | cómo se reconoce                                                                             | ID                                                                    | en FSM                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Dealer / ship-to estable**        | orden AS400 con cuenta + sufijo                                                              | automático                                                            | pegar el ID; si es nuevo, teclear una vez y dejar marcado _Save in/Update_ |
| **Canal / destinatario de una vez** | `customers.ship_to_varies = true` (consumidor directo, Facebook, garantía, eBay, donaciones) | **ninguno**                                                           | teclear los datos y **desmarcar** _Save in/Update my address book_         |
| **Orden manual sin AS400**          | `source = 'manual'`, sin cuenta                                                              | `PK` + 5 dígitos, **a petición** del operador ("Asignar ID de FedEx") | como dealer                                                                |

El prefijo `PK` garantiza que un ID inventado por Pickd nunca choca con una cuenta del ERP. Los
IDs de texto que ya existen en FSM (`SB 202`, `OC BICYCLE CENTER`) **no se renombran**: se
mapean a la dirección de Pickd cuando el cruce es inequívoco (fase 2) y se siguen usando; los
destinatarios nuevos salen siempre numéricos.

## Cambios de esquema

Todos aditivos (staging y prod comparten DB). Cada columna nueva pasa por los cuatro sitios:
migración, Zod, `types.ts` ×2, selects explícitos.

### `customers`

| columna          | tipo                              | para qué                                                                                                                                       |
| ---------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `as400_account`  | `text`, CHECK `^\d{1,7}$`, índice | la cuenta Bill-to sin ceros (`10495`). **No única todavía**: hay filas duplicadas por nombre; se vuelve única después de fusionarlas (fase 1b) |
| `ship_to_varies` | `boolean NOT NULL DEFAULT false`  | canal cuyo destinatario cambia por orden; bloquea la asignación de ID y cambia el aviso en pantalla                                            |

`phone` y `email` ya existen y están vacíos: se rellenan desde FSM en la fase 2. No hace falta
columna nueva para eso.

### `customer_addresses`

| columna              | tipo                                                                         | para qué                                                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `as400_ship_to`      | `text`, CHECK `^\d{2}$`                                                      | el sufijo (`00`, `01`)                                                                                                                                                      |
| `fedex_recipient_id` | `text`, CHECK `^[A-Z0-9 .'&-]{1,25}$`, **UNIQUE parcial** (`WHERE NOT NULL`) | la llave. Dígitos = AS400; `PK…` = Pickd; otra cosa = ID de texto heredado de FSM                                                                                           |
| `contact_name`       | `text`                                                                       | FSM exige Company **o** Contact; el AS400 no lo trae, FSM sí (86 %)                                                                                                         |
| `residential`        | `boolean NOT NULL DEFAULT false`                                             | FSM cotiza distinto; se hereda del import y del canal                                                                                                                       |
| `fedex_synced_at`    | `timestamptz`                                                                | última vez que FSM y Pickd coincidieron en esta fila (export o import). `NULL` = "FSM no lo tiene, que Pickd sepa"; `updated_at > fedex_synced_at` = "cambió, toca _Merge_" |

La regla de conflicto del watcher cambia: hoy hace upsert por `(customer_id,
normalized_address)`. Con la llave, **si existe una fila con el mismo `fedex_recipient_id` y otra
dirección, es el mismo slot que se mudó**: se actualiza la dirección de esa fila y se pone
`fedex_synced_at = NULL`. Para cuentas `ship_to_varies` se mantiene el upsert por dirección y no
se asigna ID.

### `picking_lists`

| columna                | tipo                                     | para qué                                                                                                                                                                                     |
| ---------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `as400_account_number` | `text`                                   | el valor crudo del header (`0010495 00`), para auditoría; el watcher ya lo tiene en la mano                                                                                                  |
| `ship_to_address_id`   | `uuid REFERENCES customer_addresses(id)` | **a qué ship-to va esta orden**. Hoy la orden solo tiene `customer_id` y la dirección es "la default del cliente", que para un dealer con dos tiendas es la equivocada la mitad de las veces |

### Tablas nuevas

- **`fedex_recipients`** (fase 2): espejo del export de FSM — `recipient_id PK`, `company`,
  `contact`, `address1`, `address2`, `city`, `state`, `zip`, `country`, `phone`, `residential`,
  `email`, `imported_at`, `customer_address_id` (nullable, el enlace resuelto). RLS `is_admin()`.
  Contiene datos personales: **no** sale al repo, se sube desde la app.
- **`fedex_recipient_exports`** (fase 3): log append-only, calcado de `fedex_dimension_exports`
  (`exported_by`, `filename`, `record_count`, `mode`, `exported_at`).
- **`shipments`** (fase 4): `picking_list_id`, `tracking_number UNIQUE`, `carrier`, `service`,
  `shipped_at`, `weight_lbs`, `net_charge`, `source` (`fsm_export` | `fsm_watcher` | `manual`).
  Una orden puede tener varios bultos. Un trigger pone `picking_lists.is_shipped = true` al
  primer shipment.

## Cambios en el watcher

`watchdog-pickd` ya parsea todo lo que hace falta; lo que cambia es que deje de tirarlo.

1. `parse_account_number` devuelve `"0010495 00"`; se divide en cuenta (`int(...)` → `10495`) y
   sufijo (`00`). Se escribe `picking_lists.as400_account_number` (crudo).
2. `_resolve_customer` busca **primero por `as400_account`**, y solo si no hay cuenta cae al
   nombre + calle de hoy. Al encontrar por nombre y venir cuenta, la sella (`as400_account` se
   rellena si está NULL, nunca se pisa).
3. `_save_shipping_address` escribe `as400_ship_to`, `fedex_recipient_id` y devuelve el `id` de
   la dirección para `picking_lists.ship_to_address_id`. Aplica la regla de conflicto de arriba y
   respeta `ship_to_varies`.
4. **Backfill sin volver a capturar:** `.scanned_orders.json` en la MacBook de Bay 2 guarda el
   `raw_text` completo de cada orden capturada. Un script una sola vez re-parsea el header de
   cada entrada y actualiza por `order_number`. Las órdenes anteriores al scanner no se recuperan
   por ahí: para ellas el enlace viene del import de FSM (fase 2) o de una captura manual.
5. De regalo, ya que se toca: `parse_ship_via` existe y `transport_company` nunca se escribe.

El watcher despliega con `scripts/update.sh`, que corre `migrations.py`. **La migración de
columnas va en `supabase/migrations/` de Pickd**, no ahí: `migrations.py` existe porque PostgREST
descarta en silencio las columnas que no existen, así que el orden de despliegue es migración en
prod → watcher → frontend, y el watcher tiene que tolerar la columna ausente entre medias.

## Cambios en Pickd

- **`FedexRecipientChip`**: el ID con botón de copiar y un estado. El `CopyButton` de
  `ShipOrderCard.tsx:147` se promueve a componente compartido. Cuatro estados, cada uno con la
  instrucción exacta para FSM:
  - `1049500 · en FedEx` (`fedex_synced_at` no nulo) → "pega el ID".
  - `1049500 · nuevo en FedEx` → "pega el ID, teclea los datos de abajo, deja marcado _Save
    in/Update my address book_".
  - `Destinatario de una vez` (`ship_to_varies`) → "teclea los datos y **desmarca** _Save
    in/Update my address book_".
  - `Sin ID` (manual) → botón "Asignar ID de FedEx" que emite `PK00017`.
- Se muestra donde se despacha y se verifica: `ShipOrderCard` / `ShipScreen`, `DoubleCheckView`
  (cabecera), `OrderRowCard`, `printOrderDetail`. En `PublicOrderView` no: es externo.
- Los campos que FSM pide se ven completos y cada uno con su copiar (empresa, contacto, dirección
  1/2, ciudad, estado, zip, teléfono, residencial). FSM no acepta pegar un bloque: son campos
  separados.
- `ShipScreen` deja de crear un cliente nuevo cuando cambia la dirección de uno que tiene
  `as400_account`: crea o elige una **dirección** del mismo cliente (`customer_addresses`) y la
  enlaza en `ship_to_address_id`. `parseUSAddress` y `fetchCustomerAddresses` ya existen y no
  tienen quien los llame.
- Admin: pantalla de cliente con `as400_account`, `ship_to_varies`, sus direcciones y sus IDs.

## Fases

### Fase 0 — Verificar en la máquina de FedEx (medio día, sin código)

Todo lo de arriba descansa en cómo se comporta el FSM instalado (v3313), no el de la guía.
Checklist, con backup previo (`Databases → File Maintenance → Backup`):

1. Teclear `1049500` en Recipient ID: ¿rellena TUCKER CYCLES? Repetir con `99100`.
2. `Databases → Templates`: abrir el template de **export** de Recipient y anotar el orden de
   campos (resuelve las columnas 3, 4, 5, 7, 40 y 42 del análisis). Crear el template de
   **import** `RECIPIENTS1` con el orden que Pickd va a emitir: `Recipient ID, Company, Contact
name, Address 1, Address 2, City, State, Postal code, Country code, Phone, Residential`.
3. Import de prueba con un archivo de 2 filas: un ID nuevo y uno existente con otro teléfono.
   Primero _Append_: ¿duplica, salta o sobreescribe el existente? Luego _Merge_. Restaurar el
   backup.
4. ¿Existe el menú _Integration_ y el Integration Assistant? ¿Qué campos _Reference_ muestra la
   pantalla de envío y cuáles salen en la etiqueta? Exportar un día de envíos con un template de
   _Shipment Information_ y guardar el archivo: es la muestra para la fase 4.
5. Versión de FSM, sistema operativo, si hay Python, y si la máquina llega a Supabase.

**Hecho cuando:** los cinco puntos están anotados en este documento y las columnas del análisis
tienen nombre.

**Resultados (operador, 26 ago 2026):**

1. ✔ **Confirmado en la máquina:** `1049500` en Recipient ID rellena TUCKER CYCLES. La llave
   funciona en el FSM instalado, no solo en el archivo.
2. ✔ **Fotos del template `RECIEVERS1`** (tipo Export, base Recipient): los 56 campos con sus
   largos, en el orden del archivo. Todas las columnas del análisis tienen nombre. Falta crear el
   template de **Import** (`RECIPIENTS1`) con el orden que emitirá Pickd; se hace en la fase 3.
3. ⏸ **Aplazado a propósito** — el operador prefiere no tocar el import hasta que sea
   imprescindible. Consecuencia: la fase 3 se diseña para **no depender** de lo que haga _Append_
   con un ID existente (ver fase 3). La prueba pasa a ser el primer paso de la fase 3, con backup,
   y solo si algún día hace falta el modo _Merge_.
4. ◐ **El Integration Assistant existe** (3312.0003) y **ya hay un perfil**:
   `REVISED_DATA_IMPORT_7_16`, modificado el 16 abr 2021, estado _Complete_. Alguien montó una
   integración de import hace cinco años. Pendiente: capturas de las pestañas _Import_ y _Export_
   de ese perfil (origen ODBC o archivo, ruta, mapeo de campos, campo índice), los campos
   _Reference_ de la pantalla de envío y un export de envíos.
   Además, el diálogo de templates tiene **"Export at close"** (_Export at Express close / Ground
   close / SmartPost close_, _Export by close date_): un template de export de la base _Shipment_
   con eso marcado escribe el archivo del día **solo, al cierre**, sin Integration Assistant. Cambia
   la fase 4.
5. ◐ FSM **33.13.1003.0**, FSM Host Object 13.01.0001. Pendiente: Windows, Python, red hacia
   `supabase.co`.

Con el punto 1, las fases 1, 1b y 2 quedan desbloqueadas. Los puntos 2 y 4–5 solo condicionan
las fases 3 y 4.

### Fase 1 — La llave entra en Pickd (2–3 días)

- Migración con las columnas de `customers`, `customer_addresses` y `picking_lists`, más el
  índice único parcial. Aplicar en prod **antes** de desplegar el watcher.
- Watcher: puntos 1–3 y 5 de arriba, con tests sobre los fixtures existentes.
- Backfill desde `.scanned_orders.json` (punto 4). Después, consulta de control: cuántas
  `customer_addresses` tienen `fedex_recipient_id`, cuántos `customers` tienen cuenta.
- Marcar `ship_to_varies` en los canales conocidos y en toda cuenta cuyo sufijo `00` haya visto
  ≥ 3 direcciones distintas; revisar la lista a mano antes de aplicarla.
- `FedexRecipientChip` con los cuatro estados, en `ShipOrderCard` y `DoubleCheckView`.

**Hecho cuando:** una orden AS400 nueva aparece en Pickd con su ID, y pegado en FSM rellena al
destinatario (los 951 numéricos ya existentes).

### Fase 1b — Fusionar clientes duplicados (1 día, migración de datos)

Con `as400_account` sellado, las 15 filas de `JAMIS CONSUMER ALL ACCESS` y las 13 de `SPORTS
BASEMENT` son visibles como lo que son. Migración que, por cuenta, conserva la fila más antigua,
reapunta `picking_lists.customer_id` y `customer_addresses.customer_id`, y borra el resto; luego
el índice único sobre `as400_account`. **Es una migración de datos sobre órdenes históricas: se
ensaya dentro de una transacción con rollback contra prod antes de aplicarla**, como manda la
convención del proyecto.

**Hecho cuando:** ninguna cuenta tiene más de una fila en `customers`.

### Fase 1c — Ship-to por defecto en Pickd (idea-157) y vista "What's new" en el watcher (idea-158)

Pedidas por el operador el 26 ago, van con la fase 1b porque tocan lo mismo: `customers` pasa a
ser el Bill-to con su propia dirección, `customer_addresses` los Ship-tos con nombre, y cada
orden enseña por defecto **su** Ship-to (nombre + dirección de la fila enlazada por
`ship_to_address_id`) con el Bill-to como línea secundaria. En el watcher, el backfill y las
acciones que vengan se ejecutan desde un botón con su explicación, no desde la terminal.
Detalle en el backlog.

### Fase 2 — FSM entra en Pickd (2 días)

- Tabla `fedex_recipients` y pantalla admin "Importar libreta de FedEx": sube el export de FSM
  (56 columnas por posición, se rechaza si el conteo no cuadra), lo vuelca entero.
- Resolución de enlaces: ID numérico → `(cuenta, sufijo)` → `customer_addresses`; si el ID es
  texto pero **Recipient Loc ID** trae un número de 6–7 dígitos (94 filas, 25 con código de
  texto), se usa ese; ID de texto sin Loc ID → nombre + zip, **solo si es inequívoco** (371 de los 519 emparejados apuntan a más de un
  recipient: esos se quedan sin enlace y se listan). Al enlazar: `fedex_recipient_id`,
  `fedex_synced_at`, `contact_name`, `residential`.
- Backfill de `customers.phone` solo con teléfonos reales (ni `0000000000` ni el de Jamis) y
  de dirección **solo donde Pickd no tiene ninguna** — el AS400 manda sobre la dirección, FSM
  sobre el teléfono.
- Informe de la corrida como el de excepciones de Dimensions: enlazados, ambiguos, sin pareja.

**Hecho cuando:** el chip dice "en FedEx" para los clientes que lo están, y Pickd tiene teléfono
para ~500 clientes.

### Fase 3 — Pickd exporta a FSM (2 días)

- Crear en FSM el template de **Import** `RECIPIENTS1` (base Recipient, Delimited, `"` y `,`,
  sin encabezados) con este orden: `Recipient Code, Company, Contact, Address 1, Address 2, City,
State/Province, Zip/Postal Code, Country Code, Phone Number, Residential/Commercial Ind`.
- Tarjeta en `/export` junto a Dimensions: "Destinatarios FedEx — nuevos". Builder puro
  `fedexRecipients.ts` con tests (mismos helpers: comillas, CRLF, ASCII). Anchos de FSM, medidos
  en el template: **Code ≤ 25, Company / Contact / Address / City ≤ 35, Phone = 10 dígitos sin
  formato, State 2, Country 2, Residential `C`/`R`**. 71 calles de Pickd pasan de 35 (`mg brands
llc 102 sea island parkway ste 1`): el builder parte en Address 1 / Address 2 por palabra, y si
  aun así no cabe, es excepción, no truncado. Excluye `ship_to_varies` y filas sin dirección
  completa.
- **Solo _Append_ y solo IDs que FSM no tiene**: `fedex_synced_at IS NULL` **y** ausentes de
  `fedex_recipients` (el espejo de la fase 2). Así el archivo nunca lleva un ID repetido y da
  igual qué haga _Append_ con uno existente — la pregunta que el operador prefirió no probar deja
  de importar. _Append_ "añade y no elimina nada" por documentación, así que repetir una corrida
  es seguro.
- **No hay modo _Merge_.** Cuando un ship-to cambia de dirección, el chip lo dice ("dirección
  distinta a la de FedEx: corrígela en pantalla y deja marcado _Save in/Update my address book_")
  y FSM se actualiza solo al procesar el envío. Es el mecanismo que FSM ya tiene, y evita importar
  encima de registros vivos.
- Log en `fedex_recipient_exports` y RPC que sella `fedex_synced_at` en las filas exportadas.
- Precondición de la primera corrida real: la prueba de dos filas del punto 3 de la fase 0, con
  backup, para ver el archivo entrar por `RECIPIENTS1` antes de mandar 86.
- Tercer manual: `fedex-recipients-import`, con la figura del diálogo de import y la regla de
  "nunca _Replace_ aquí" dicha una sola vez.
- Primera corrida: los ~58 clientes y ~28 ship-tos que faltan en FSM.

**Hecho cuando:** un cliente nuevo en el AS400 el lunes está en FSM el viernes sin que nadie lo
teclee.

### Fase 4 — Tracking de vuelta a Pickd (3–4 días)

Depende de lo que diga la fase 0 (punto 4). Dos caminos, del más simple al más automático:

- **A. Sin software en la máquina de FedEx.** Regla de procedimiento: en FSM, el campo
  _Reference_ lleva el número de orden. Un template de export de la base _Shipment_ con **"Export
  at Ground close" y "Export at Express close"** marcados escribe el archivo del día solo, al
  cerrar; alguien lo sube en Pickd (diario o semanal), que crea `shipments` emparejando por
  referencia y marca `is_shipped`. Lo que no empareja se lista.
- **B. Watcher en la máquina de FedEx.** El mismo archivo de A, pero lo recoge un daemon del
  corte de `watchdog-pickd` (Python, `service_role`) y lo escribe en `shipments` sin que nadie lo
  suba. Si hace falta por envío y no por cierre, Integration Assistant con perfil de export "cada
  vez que se completa un envío".

**Hecho cuando:** la orden en Pickd muestra tracking y fecha de envío sin que nadie los copie.

### Fase 5 — Al revés: teclear la orden en FSM y que se rellene (opcional)

Integration Assistant con perfil de **import** indexado por número de orden, leyendo un archivo
que Pickd publica (edge function: órdenes listas para despachar → destinatario, peso, medidas,
referencia) y que el watcher de la fase 4B baja a la ruta que FSM lee. Sustituye al Recipient ID
como gesto diario: se teclea la orden y sale todo. Se evalúa después de ver la fase 4 funcionando.

## Decisiones que hay que tomar (no las toma el código)

1. **IDs `PK` para órdenes manuales:** ¿sí, a petición? Son 22 órdenes en 90 días; la
   alternativa es que esos clientes se tecleen en FSM sin ID, como hoy.
2. **Lista de canales `ship_to_varies`:** propuesta inicial `JAMIS CONSUMER ALL ACCESS`,
   `FACEBOOK SALES`, `DEALER WARRANTY 2009`, `JAMIS WARRANTY`, `EBAY PART SALES`, `DONATIONS`,
   `CARINE JOANNOU PERSONAL`. Confirmar con quien despacha.
3. **Fusión de duplicados (1b):** conserva la fila más antigua. ¿Alguien depende del `id` de
   las otras (enlaces públicos, reportes)?
4. **Los 371 ambiguos de FSM:** se dejan sin enlace y se resuelven uno a uno desde el chip
   ("¿cuál de estos tres es?") o se ignoran hasta que la primera orden AS400 los selle. Propuesta:
   lo segundo; el AS400 los va sellando solo.
5. **Fase 4A o 4B:** depende de si la máquina de FedEx puede correr un daemon y llegar a
   Supabase.

## Seguimiento

| fase | entregable                                                                                             | criterio de hecho                                                           | estado                                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | checklist FSM anotado aquí                                                                             | 5 puntos respondidos                                                        | **1 ✔, 2 ✔ (26 ago)**; 4 y 5 a medias (faltan perfil de integración, Reference, SO/red); 3 aplazado                                                                                                                 |
| 1    | migración + watcher + backfill + chip                                                                  | orden AS400 nueva trae ID y FSM lo reconoce                                 | **desplegada el 26 ago** — migración en prod, chip en `main` (`590bb85`), watcher en `origin/main` (`30d8a9e`). Falta en la MacBook de Bay 2: ⏳ Update app y `scripts/backfill_account_numbers.py --apply` una vez |
| 1b   | migración de fusión                                                                                    | una fila por cuenta                                                         | pendiente — después del backfill, cuando `as400_account` esté sellado                                                                                                                                               |
| 1c   | Ship-to por defecto en Pickd (idea-157); vista What's new + botón de backfill en el watcher (idea-158) | la tarjeta enseña el Ship-to de esa orden; el backfill se corre desde la UI | pendiente — sesión del 27 ago                                                                                                                                                                                       |
| 2    | `fedex_recipients` + import + enlaces + teléfonos                                                      | chip "en FedEx" correcto; ~500 teléfonos                                    | pendiente                                                                                                                                                                                                           |
| 3    | template `RECIPIENTS1` + export Append (solo nuevos) + log + manual                                    | cliente nuevo en FSM sin teclear                                            | **desbloqueada** (va después de 2)                                                                                                                                                                                  |
| 4    | `shipments` + import de envíos (A) o watcher (B)                                                       | tracking visible en la orden                                                | espera capturas (fase 0.4–0.5)                                                                                                                                                                                      |
| 5    | import por orden en FSM                                                                                | teclear orden rellena envío                                                 | sin decidir                                                                                                                                                                                                         |

Registrado en el backlog como `idea-153`.
