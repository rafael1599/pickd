# PRD: Scan serials — el serial de cada caja del almacén, con la pistola

**Estado:** Estudio, esperando «ok» (2 oct 2026) · **Autor:** PickD (`pickd-product-designer`) ·
**Backlog:** idea-244 · **Relacionado:** `sku_serials` (`20260921110000`), `skuSerials.service.ts`,
`serialIdentity.ts`, `lib/recognition/barcodeText.ts`, Cycle Count (`/stock-count`),
`docs/label-recognition/research/R15-identidad-de-caja.md`

---

## 1) Contexto y problema

Lo que pidió, textual (2 oct 2026):

> «con la pistola empezaremos a registrar los seriales, a mano nos tomaría una vida»
>
> «quiero ahorrarme el imprimir una etiqueta de pickd para cada sku del warehouse. supongo que la
> única manera es escribiendo a mano en el scanner (pickd abierto en el mismo), el sku y después
> comenzar a escanear todos los seriales»

La pistola es un **handheld con PickD abierto** y el lector integrado escribe como un teclado
(modelo sin decidir: láser 1D o imager 2D). Aprobó la **Opción 1** (elegir la ROW → tocar el SKU que
tiene delante → escanear sus seriales → tocar el siguiente), la **Opción 2** como respaldo en la
misma pantalla (escribir el SKU) y dejó la **Opción 3** como ❓ (que la caja traiga el SKU en barras
y la pistola lo ponga sola).

**Lo que hay hoy (medido en prod el 2 oct):**

| Hecho                                   | Cifra                                                                |
| --------------------------------------- | -------------------------------------------------------------------- |
| Filas en `sku_serials`                  | **22** (21 `label_scan`, 1 `manual`), de 21 SKUs, todas `LUDLOW`     |
| Colisiones (`sku_serial_collisions`)    | **0**                                                                |
| Bicis en ROWs                           | **8,696** u · **509** SKUs · **36** ROWs                             |
| Líneas de bici en ROW con **un** cuadro | **485** de 520 (29 con 2, 1 con 3, 3 con 4, 2 sin cuadro)            |
| Bicis con UPC guardado                  | **21** de 660 con stock                                              |
| `sku_serials` en realtime               | **no** está en la publicación `supabase_realtime`                    |
| ROW 38 (caso de prueba)                 | **36** SKUs · **97** u; `03-4212GY` 17 u en E, `03-4266BK` 15 u en D |

Dos filas de prod ya enseñan los dos errores que esta pantalla tiene que hacer imposibles:
`05-1136RD` guarda `SERIALLOE` (el rótulo leído como valor) y `01-0169CO` guarda **su propio SKU**
como serial (`manual`) — una etiqueta de PickD escaneada donde iba un serial.

**Código que ya hace lo más parecido, y se reusa:**

- `sku_serials` + `recordSkuSerial` — la tabla y la escritura (hoy select-then-insert, sin
  atomicidad: dos operarios a la vez dan `unique violation` → `skipped` en silencio).
- `normalizeSerial`, `serialLooksReal` (`serialIdentity.ts`) — qué es un serial creíble.
- `asStockNumber`, `toUpcA`, `parseJamisFactoryQr` (`lib/recognition/barcodeText.ts`) — qué es
  cada texto que llega de un código (SKU en barras, UPC con dígito verificador, QR de fábrica Jamis).
- `formatStockSearchInput(prev, next, 'sku')` (`stockSearch.ts`) — el guion del SKU al escribir.
- `get_audit_rows` (Cycle Count, `StockCountScreen.tsx`) — la lista de ROWs con su cuenta de SKUs.
- `feedbackService.success() / warning() / error()` (`services/feedback.service.ts`) — sonido y
  vibración ya pensados «for mobile/PDA devices».
- `mutationRegistry.ts` + `mutationPersistence.ts` — mutaciones que sobreviven offline y a un reload.
- `useOpenSkuDetail` — abrir el detalle de un SKU sin salir de la pantalla.

**Lo que R15 ya midió y cambia el riesgo de todo esto:** en el banco de 27 etiquetas, **23 (85 %)
no traen el serial en barras 1D** y **20 (74 %) no traen QR**. Si la pistola es 1D, puede que la
mayoría de las cajas no tengan nada que leer. Por eso la Fase 0 es mirar, no construir.

## 2) Objetivo

Que una persona con la pistola registre el serial de **cada caja de una ROW sin escribir nada más que
un toque por SKU**, y que PickD diga de cada SKU y de cada ROW **cajas vistas / unidades en sistema**.

**Métrica:** ROW 38 (97 u) completa en **≤ 15 min** por una persona, **≤ 1 toque por SKU** (36), y
**0** filas nuevas en `sku_serials` que fallen `serialLooksReal` o tengan forma de SKU.

## 3) Conceptos

- **Caja vista (serial):** una fila viva de `sku_serials` (no anulada) cuyo **último avistamiento**
  fue en esa ROW dentro de la **ventana** (❓ Q6, 30 días). Es prueba física: alguien tuvo la caja
  delante.
- **El SKU en mano:** el SKU al que se asignan las lecturas nuevas. Lo pone un toque en la lista, un
  SKU escrito, o un código de SKU leído. Una lectura de un serial **ya conocido** no lo necesita: ya
  sabe de quién es.
- **Cuadra / no cuadra:** `vistas / unidades` por SKU y por ROW. `17 / 17` verde, `14 / 16` faltan
  2, `18 / 17` ámbar (sobra una). Nunca mueve stock: sólo lo enseña.

## 4) El gesto

**Entrada:** Menú → **Scan serials** (al lado de Stock Count) → lista de ROWs → tocar **ROW 38**.
URL `/scan-serials?row=ROW%2038&sku=03-4212GY` — un enlace abre la ROW y el SKU en mano.

1. **Elegir la ROW** (una vez). La lista enseña `vistas / unidades` de cada SKU de la ROW.
2. **Tocar el SKU** que tiene delante → queda en mano: su fila se abre con la cifra grande.
3. **Disparar** a cada caja. Cada lectura pasa por **un solo clasificador** (§6.3) y cae en una de
   estas ramas:

| La pistola lee                                            | Ejemplo                           | Qué pasa                                                                                                                | Sonido           | Escribe                       |
| --------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------- |
| Serial nuevo                                              | `W25011013`                       | `+1` en el SKU en mano                                                                                                  | `success`        | fila nueva, `gun_scan`        |
| Serial ya visto en este SKU                               | el mismo otra vez                 | pill **AGAIN**, la cifra no cambia                                                                                      | `warning`        | `seen_count+1`, `last_seen_*` |
| Serial conocido de **otro** SKU                           | `W25011014` (es `03-4686GY`)      | pill roja **03-4686GY**, no suma al SKU en mano; suma al suyo si está en la ROW, si no aparece en **NOT IN PICKD HERE** | `error`          | `last_seen_*` del suyo        |
| No parece serial                                          | `SERIALLOE`, `A129`, `1234`       | pill ámbar **?** con lo leído                                                                                           | `error`          | nada                          |
| Un SKU (Code 128 de PickD, barras del AS400, `03-4212GY`) | `01-0169CO`                       | **cambia el SKU en mano**                                                                                               | `success` corto  | nada                          |
| QR de PickD                                               | `…/s/03-4230BL`                   | cambia el SKU en mano                                                                                                   | `success` corto  | nada                          |
| QR de fábrica Jamis                                       | `0023JC-…,WRDH01637,1,SET,A129,…` | serial = `WRDH01637`, como fila 1                                                                                       | igual que fila 1 | `observed` = QR crudo         |
| UPC con dígito verificador                                | `845436092959`                    | si un SKU lo tiene, cambia el SKU en mano; si no, pill ámbar **UPC**                                                    | `warning`        | nada                          |

4. **Sin SKU en mano** (al abrir la ROW, o en la segunda pasada): un serial **conocido** suma a su
   SKU solo; uno **desconocido** queda en espera con pill ámbar **Pick SKU** y el siguiente toque a
   un SKU lo guarda ahí. Así la auditoría de la semana que viene es **disparar y nada más**.
5. **Deshacer:** tocar un serial de la lista de esta sesión lo **tacha** (anulado) y la cifra baja;
   tocarlo otra vez lo recupera. Sin modal: es un toque reversible.
6. **Siguiente SKU:** tocar otro. No hay botón «terminar»: salir de la pantalla es terminar.

**Ramas de la lista:**

- **SKU de la ROW con 0 unidades vistas:** `0 / 17`, gris.
- **Más vistas que unidades:** `18 / 17` ámbar. Se guardan igual — una caja es una caja.
- **SKU que no está en esta ROW según PickD** (leído o escrito): aparece abajo, en
  **NOT IN PICKD HERE**, con `vistas / 0`. Un placeholder de `UNKNOWN` cae aquí. No se esconde ni se
  mete en la lista.
- **SKU que no existe en el catálogo:** pill ámbar **UNREG** con lo leído; nada se escribe
  (registrar es otra pantalla).

## 5) Modos y herramientas

Un solo modo. Lo que **sí** se ve: la ROW, sus SKUs (foto, SKU, nombre corto, cuadro, `vistas /
unidades`), el SKU en mano con su cifra grande y los seriales de esta sesión, y **un botón**: ⌨
(escribir un SKU o un serial a mano). Lo que **no**: cantidades editables, mover stock, notas,
filtros. Nada de esto cambia `inventory`.

**Lenguaje visual:** verde = cuadra; ámbar = sobra o falta un dato (`?`, `UPC`, `UNREG`, `Pick SKU`,
`18 / 17`); rojo = es de otro SKU; gris = aún nada. Un punto gris junto a un serial = **no guardado
todavía** (offline). Una sola pill a la vez, la de la última lectura; se va con la siguiente.

**Cómo llega la pistola (sin campo enfocado).** La pantalla escucha `keydown` en `window`, junta los
caracteres y corta en **Enter, Tab o 80 ms sin teclas**. Nada está enfocado, así que no sale el
teclado en pantalla y `useTypeToSearch` no participa (es otra ruta; Stock no está montado). El botón
⌨ abre un campo normal; lo que se escriba ahí y termine en Enter pasa por **el mismo clasificador**
con `source = 'manual'` (y el guion de `formatStockSearchInput` en modo `sku`). Si el dispositivo
sólo entrega teclas a un campo enfocado, el respaldo es un campo enfocado con `inputmode="none"`
(foco sin teclado) — se decide en la Fase 0.

## 6) Datos

### 6.1 Se reusa sin tocar

`inventory` (unidades por ROW y cuadro, leídas, **nunca escritas**), `sku_metadata` (foto, nombre,
`upc`, `is_bike`), `get_audit_rows` (la lista de ROWs), `normalizeSerial` / `serialLooksReal`,
`asStockNumber` / `toUpcA` / `parseJamisFactoryQr`, `feedbackService`, `mutationRegistry`.
`sku_metadata.serial_number` **no se toca**: es el serial de la S/D única.

### 6.2 Nuevo (aditivo)

Migración sobre `sku_serials`:

| Columna                                   | Para qué                                                             |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `last_seen_location text`                 | la ROW donde se vio por última vez → la cifra por ROW                |
| `last_seen_sublocation text`              | el cuadro, **sólo** si la línea del SKU en esa ROW tiene uno (❓ Q4) |
| `last_seen_by uuid`                       | quién la tuvo delante la última vez                                  |
| `voided_at timestamptz`, `voided_by uuid` | deshacer sin borrar (la tabla no tiene DELETE a propósito)           |

- `source` admite **`gun_scan`** (y `RecordSerialInput.source` lo suma).
- `sku_serial_coverage` y `sku_serial_collisions` filtran `voided_at is null`;
  `listSerialsForSku` / `findSkuBySerial` también.
- Vista nueva **`sku_serial_seen_by_location`**: `(location, sku, seen)` contando filas vivas con
  `last_seen_at` dentro de la ventana. Las unidades las pone la app (es donde vive la cantidad, igual
  que ya dice el comentario de `sku_serial_coverage`).
- `sku_serials` entra en la publicación **`supabase_realtime`** (varios operarios, §6.4).
- La fila `01-0169CO` / `01-0169CO` / `manual` se **anula** (`voided_at`) en la misma migración:
  es un SKU, no un serial.

### 6.3 RPC, no insert directo

**`record_serial_scan(p_reading, p_sku, p_location, p_sublocation, p_source, p_client_id)`** →
`{ status: 'new' | 'again' | 'other_sku' | 'revived', sku, id }`. Por qué RPC: la decisión «¿es de
otro SKU?» y el upsert tienen que ser **una sola transacción** (`INSERT … ON CONFLICT (sku, serial)
DO UPDATE`); el select-then-insert de hoy pierde lecturas en silencio con dos personas a la vez.
`p_client_id` hace idempotente el reintento de una mutación offline. Rechaza en servidor lo mismo
que el cliente (`serialLooksReal`, forma de SKU) — dos espejos, misma tabla de casos en un test.

**`void_serial_scan(p_id, p_void boolean)`** → tacha o recupera. Volver a escanear un serial anulado
lo **revive** (`status = 'revived'`, cuenta como `+1`).

**El clasificador** es una función pura nueva, `classifyGunReading(text)` en
`inventory/utils/` → `pickd-qr | sku | factory-qr | upc | serial | not-serial`, construida **sólo**
con los helpers existentes (`asStockNumber`, `toUpcA`, `parseJamisFactoryQr`, `serialLooksReal`).
Es el único sitio que decide qué es una lectura.

**Optimista con rollback**, como toda mutación del proyecto: la app ya tiene cargados los seriales
de los SKUs de la ROW, así que decide `new` / `again` al instante y suma; si el servidor responde
`other_sku` o error, la cifra vuelve atrás y la pill cambia a la verdad.

### 6.4 Offline y varios operarios

- **Offline:** cada lectura es una mutación persistida (`setMutationDefaults(['serials','record'])`
  en `mutationRegistry`), así que sobrevive a un reload y se reanuda sola. El serial lleva punto gris
  hasta que se guarda. Un `other_sku` que sólo se descubre al volver la red cambia la fila a rojo.
- **Dos personas en la misma ROW:** realtime suma las lecturas del otro a la cifra en ≤ 2 s. La
  misma caja escaneada por los dos → el segundo oye **AGAIN**. No hay bloqueo de ROW ni de SKU.

## 7) Pantalla

El handheld es más estrecho que su teléfono: se dibuja a **430 px** y se revisa a **360 px**.

**Lista de ROWs** (la cifra grande es lo único que importa):

```
┌──────────────────────────────────────┐
│ ←  SCAN SERIALS          0 / 8,696   │
├──────────────────────────────────────┤
│ ROW 38                      0 /  97  │
│ ROW 41                      0 / 579  │
│ ROW 42                      0 / 955  │
│ ROW 43                    0 / 1,369  │
│ …                                    │
└──────────────────────────────────────┘
```

**La ROW, con un SKU en mano** (la fila del SKU se abre; las demás no se mueven de sitio):

```
┌──────────────────────────────────────┐
│ ← ROW 38                 14 / 97  ⌨  │
├──────────────────────────────────────┤
│ [img] 03-3058CL  EXPLORER A2 15  C  0/3│
│ [img] 03-4266BK  RENEGADE A1 48  D 15/15✓│
│┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓│
│┃[img] 03-4212GY RENEGADE C4 58   E  ┃│
│┃              14 / 17               ┃│
│┃          ( AGAIN )                 ┃│
│┃  M25H000437  ·                     ┃│  ← el último arriba; · = sin guardar
│┃  M25H000436                        ┃│
│┃  ~~W25011013~~                     ┃│  ← tachado = anulado (toque)
│┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛│
│ [img] 03-4230BL  RENEGADE C1 58  D 1/3│
│ …                                    │
│ NOT IN PICKD HERE                    │
│ [img] 03-4053PD  EXPLORER A1 17   1/0│
└──────────────────────────────────────┘
```

- Orden de la lista: **por cuadro (A → K) y luego SKU** — el orden en que se camina la ROW. Un SKU
  completo se queda en su sitio con ✓: nada salta bajo el dedo.
- La fila en mano se fija arriba al tocarla (scroll suave), con la cifra a ~48 px.
- **⌨** abre un campo en la cabecera: `03-4212GY` con guion automático, Enter = SKU en mano.
- **A 360 px:** el nombre corto se corta con «…», nunca el SKU, el cuadro ni la cifra. `pb-32`
  al final de la lista (BottomNavigation); texto con color explícito en toda superficie clara.

## 8) Fases

- **P0 — mirar antes de construir (sin código, 15 min).** Rafael abre **Stock** en el handheld (el
  buscador ya recibe la pistola) y dispara a **20 cajas de ROW 38**: el serial, el QR, cada barra.
  Captura del buscador por lectura. Responde Q1, Q2 y si la pistola manda Enter. Si menos de la
  mitad de las cajas tiene un serial legible, este estudio se replantea antes de P1.
- **P1 — lo que pidió.** `/scan-serials`, Menú → Scan serials; lista de ROWs; lista de la ROW;
  SKU en mano por toque, por ⌨ y por código de SKU/QR de PickD; el bucle con sus ramas; deshacer;
  offline; realtime; migración + `record_serial_scan` / `void_serial_scan`; `classifyGunReading`
  con tests de la tabla de §4. Checkpoint: ROW 38 escaneada por Rafael + capturas 430 / 360 / 1400.
- **P2 — la cuenta física (escrita, esperando).** `vistas / unidades` en la cabecera de cada ROW de
  Stock y en el detalle del SKU (con sus seriales); tocar una fila que no cuadra abre el detalle
  existente (`useOpenSkuDetail`) para corregir con lo que ya existe.
- **P3 — si Q2 dice que sí.** La caja trae el SKU en barras → la pistola lo pone sola y el toque
  desaparece (el clasificador ya lo entiende en P1; P3 es quitar la lista de en medio). Un UPC leído
  con SKU en mano y `upc` vacío podría llenarlo — ❓ entonces, no ahora.

## 9) Casos de verificación

Todos en **ROW 38**, prod, como Rafael. Ningún caso escribe en `inventory` ni en `inventory_logs`:
el rastro es la fila de `sku_serials`.

1. **Abrir.** Menú → Scan serials: cabecera `0 / 8,696`, ROW 38 `0 / 97` con 36 SKUs; `03-4212GY`
   en E `0 / 17`, `03-4266BK` en D `0 / 15`.
2. **Una ROW, un SKU.** Tocar `03-4212GY`, disparar a sus 17 cajas → `17 / 17` ✓, 17 `success`.
   Deja **17 filas** `source='gun_scan'`, `last_seen_location='ROW 38'`,
   `last_seen_sublocation='E'`, `seen_count=1`, `created_by` = Rafael. ROW 38 lee `17 / 97`.
3. **La misma caja otra vez.** Pill **AGAIN**, `warning`, sigue `17 / 17`; esa fila pasa a
   `seen_count=2` y `last_seen_at` nuevo. Cero filas nuevas.
4. **La caja de al lado.** Con `03-4212GY` en mano se escanea una caja de `03-4266BK` cuyo serial ya
   está guardado como `03-4266BK` → pill roja **03-4266BK**, `03-4212GY` sigue en 17, `03-4266BK`
   sube 1. Ninguna fila con `sku='03-4212GY'` y ese serial; `sku_serial_collisions` sigue vacía.
5. **El rótulo.** Una lectura `SERIALLOE` → pill ámbar **? SERIALLOE**, `error`, cero filas (es el
   valor que hoy tiene `05-1136RD`).
6. **La etiqueta de PickD.** El Code 128 de `01-0169CO` → `01-0169CO` en mano, abajo en
   **NOT IN PICKD HERE** `0 / 0` (PickD lo tiene en ROW 12 · H, 1 u). Cero filas. La fila de prod
   `01-0169CO`/`01-0169CO`/`manual` queda con `voided_at` tras la migración de P1.
7. **QR de PickD.** `https://pickd.pages.dev/s/03-4230BL` → `03-4230BL` en mano (ROW 38 · D, 3 u).
   Su serial ya guardado `W23060012` (de una foto) → **AGAIN**, y como ahora se vio en ROW 38 la
   fila lee `1 / 3`: `last_seen_location` pasa de vacío a `ROW 38`.
8. **QR de fábrica.** `0023JC-7RA1-G541,WRDH01637,1,SET,A129,A23JC-744,0003` con un SKU en mano →
   fila con `serial='WRDH01637'` y `observed` = el QR completo.
9. **Deshacer.** Tocar `M25H000437` en la lista → tachado, `16 / 17`, `voided_at` y `voided_by`
   puestos. Tocar otra vez → `17 / 17`, `voided_at` vacío. Re-escanear un anulado → `revived`, +1.
10. **Offline.** Modo avión, 3 lecturas en `03-4266BK` → `3 / 15` con tres puntos grises; recargar
    la página → siguen los tres; volver la red → se guardan, los puntos se van, 3 filas (ni una
    duplicada por el reintento: `p_client_id`).
11. **Dos personas.** Rafael y otra persona en ROW 38 · `03-4266BK`: las 5 lecturas del otro llegan
    a la cifra de Rafael en ≤ 2 s; la misma caja por los dos → el segundo oye **AGAIN**, 1 fila con
    `seen_count=2`.
12. **Escribir el SKU.** ⌨, teclear `034266BK` → el campo muestra `03-4266BK`; Enter → en mano.
13. **La segunda pasada.** Abrir ROW 38 sin tocar nada y disparar a una caja ya guardada de
    `03-4212GY` → suma a `03-4212GY` sola, sin toque. Un serial desconocido → **Pick SKU** ámbar;
    tocar `03-4212GY` → se guarda ahí.
14. **El placeholder de UNKNOWN.** Escribir `03-4053PD` (EXPLORER A1 17 2026 PALLADIUM; su única
    línea es `UNKNOWN`, 0 u) y escanear 1 caja → **NOT IN PICKD HERE** `1 / 0` ámbar. `inventory` de
    `03-4053PD` sin cambios.
15. **Sobra una.** Una 18.ª caja nueva en `03-4212GY` → `18 / 17` ámbar, la fila se guarda.

## 10) ❓ Preguntas — cada una con su respuesta por defecto (un «ok todo» las cierra)

1. **❓ Q1 — ¿Pistola 1D o 2D?** _Default:_ **2D (imager)**. R15: 85 % de las cajas no traen el
   serial en barras 1D; el QR de fábrica (tipo A) sólo lo lee un 2D, igual que nuestro QR `/s/<sku>`.
2. **❓ Q2 — (Opción 3) ¿Qué códigos trae una caja JAMIS?** Mira una caja y dime: ¿hay una barra con
   el item number (`03-4212GY`)? ¿el serial en barras? ¿QR? _Default:_ P1 no depende de esto — el
   clasificador ya convierte una barra de SKU en «SKU en mano» si existe; si existe en la mayoría,
   P3 quita el toque.
3. **❓ Q3 — ¿Desde dónde se abre?** _Default:_ **Menú → Scan serials**, junto a Stock Count, más el
   enlace con la ROW. No va un botón en la cabecera de cada ROW de Stock: ese toque ya abre el
   editor de ubicación (admin).
4. **❓ Q4 — ¿Se registra el cuadro?** _Default:_ **sólo cuando la línea del SKU tiene un cuadro**
   (485 de 520 líneas) se guarda solo; con 2–4 cuadros se guarda la ROW sin cuadro y **no se
   pregunta**. Preguntar un cuadro por caja es un toque por caja.
5. **❓ Q5 — Seriales que no cuadran con el stock (más que unidades, o un SKU en `UNKNOWN`).**
   _Default:_ **sólo se enseña** (`18 / 17`, `1 / 0` en NOT IN PICKD HERE); no se mueve ni se suma
   stock. Corregir es el detalle del SKU de siempre (P2 lo abre desde aquí).
6. **❓ Q6 — ¿Cuánto vale un avistamiento para la cifra?** _Default:_ **30 días**: una caja vista
   hace más no cuenta en `vistas / unidades` (la que se vendió no tiene quien la «des-vea»: el
   picking no lee seriales).

## 11) Riesgos

- **Que no haya nada que leer.** R15: 23 de 27 etiquetas sin serial en barras, 20 sin QR. Con una 1D
  puede que la mayoría de las cajas no den lectura. → P0 lo mide en 20 cajas antes de una línea de
  código; para las cajas sin código, ⌨ permite teclear el serial (`manual`), lento a propósito.
- **QR clonados.** R15: en lotes de muestra la fábrica repite el mismo QR en todas las cajas
  (`UCC sample`). Cinco cajas leen **AGAIN** cuatro veces y la cifra se queda corta. → La cifra no
  miente para cuadrar: el hueco queda visible, y `seen_count` alto en una misma sesión es la marca
  del clon (se puede listar después).
- **Caja de otro SKU con serial desconocido.** Si nunca se vio, nadie sabe que no es del SKU en mano:
  se guarda en el equivocado y aparece como `18 / 17`. → El ámbar lo delata; se tacha con un toque.
  La pantalla no puede saber más que la caja.
- **Una caja vendida sigue «vista»** hasta que pasa la ventana (Q6): el picking no lee seriales.
  → La ventana lo acota; leer el serial al pickear es otra conversación.
- **La pistola sin Enter, o que sólo escribe en un campo enfocado.** → Corte por 80 ms de silencio, y
  el respaldo `inputmode="none"`; P0 lo comprueba en el aparato.
- **Ritmo:** a ~5 s por caja, 8,696 cajas son **~12 h** de pistola. → La ROW es la unidad de trabajo
  (ROW 38 ≈ 8 min) y la cifra de la cabecera dice cuánto falta.

---

## Decisión · 2 oct 2026 — el serial viene en un sticker aparte, y el UPC elige el SKU

Rafael, con foto de cuatro cajas `03-3990-TL` (CITIZEN 2 STEP-THRU, Tipo B): «el código de barras
cuando no está en la etiqueta, está separado como un sticker».

- **El serial sí está en barras 1D**, en un sticker propio encima de la etiqueta (texto `Y22B00…`
  debajo de las barras); el `SERIAL NO.` de la etiqueta va vacío. R15 fotografió la etiqueta, no la
  caja, así que su «23 de 27 sin serial en barras» no mide la caja. **Q1 pierde peso**: una 1D lee el
  sticker. **P0 sigue**, pero ahora cuenta cajas con sticker, no etiquetas con barras.
- **La etiqueta trae UPC (`845436087993`) y GTIN (`00845436087993`, el mismo con dos ceros) en
  barras; el SKU sólo impreso.** En prod `03-3990TL` no tiene `upc` (20 de 520 bicis lo tienen).
- **Decisión (reemplaza la Opción 3 como ❓ Q2): el modo aprende el UPC.** Con un SKU en mano, un UPC
  que ningún SKU tiene se guarda en `sku_metadata.upc` de ese SKU (una vez, con aviso «UPC learned»);
  desde ahí ese UPC fija el SKU solo. Primera caja de cada SKU: un toque + UPC + sticker; las demás:
  UPC + sticker, cero toques, en cualquier orden. Un UPC que ya tiene **otro** SKU no se pisa: pill
  roja, como un serial ajeno. `toUpcA` ya pliega el GTIN-14 al UPC-A.
- **Clasificar no cambia:** 12/14 dígitos = UPC/GTIN; con letras y `serialLooksReal` = serial.
