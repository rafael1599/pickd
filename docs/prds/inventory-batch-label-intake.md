# PRD: Un lote de cajas, una foto por etiqueta, un solo envío a RETURN TO STOCK

**Estado:** Propuesto 2026-09-23 · **Autor:** PickD (`pickd-product-designer`) · **Backlog:** idea-224
· **Relacionado:** `CameraCaptureSheet` (23 sep), `LabelScanSheet`, `resolve_container_skus` /
`register_container`, `sku_serials`, `docs/label-recognition/08-lo-que-dejo-el-escaner-en-vivo.md`

---

## 1) Contexto y problema

Rafael registra bicis en **RETURN TO STOCK** de a una. Medido en prod: **33 altas entre el 21 y el
23 sep 2026**, todas suyas. En racha tarda **66–158 s por bici, mediana ~85 s**. **20 de los 24
SKUs se dieron de alta en el catálogo el mismo día**, así que esto no es "sumar stock": es **alta
de SKU nuevo**, que es la parte cara — modelo, talla, color, tipo, peso.

Las unidades las cuenta de a una: `05-1135GN` son **cuatro toques seguidos** (hoy 4 u en RETURN TO
STOCK), `05-3849BK` **cinco** (hoy 5 u). Y hay un **doble-submit registrado**: dos `ADD` del mismo
SKU con **2 segundos** de diferencia.

Lo que pidió, textual:

> «quiero registrar con múltiples fotos multiples bikes en la location return to stock, quiero otra
> opción debajo de add sku foto que me permita 1 tomar multiples fotos a multiples etiquetas, 2 que
> me deje corroborar una por una como lo hago actualmente para confirmar la info y al final
> mandarlas todas a la vez a return to stock».

**Lo que ya existe y hace casi todo esto, suelto:**

| Pieza                                                  | Qué hace hoy                                                                                   |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `src/components/ui/CameraCaptureSheet.tsx`             | Visor propio dentro de PickD; **disparar añade** y el carrete al lado. **Es el paso 1.**       |
| `src/features/inventory/components/LabelScanSheet.tsx` | La revisión verde/ámbar/rojo — encerrada en un sheet **de a una**, y con `<input capture>`.    |
| `recognizeLabelClient` + `buildSkuLabelDraft`          | Leen una etiqueta y devuelven cada campo `found` / `uncertain` / `missing`.                    |
| `resolve_container_skus(p_items, p_warehouse)`         | Corrobora contra el catálogo **sin escribir**: `is_new`, `existing_qty`, `merged_from`.        |
| `register_container`                                   | Escribe un lote entero en una ubicación, en una transacción — con una guarda que aquí estorba. |
| `sku_serials` + `recordSkuSerial`                      | El serial identifica la caja física. **16 filas** ya, todas `label_scan`.                      |

Falta **el lote**: la pila, el conteo por caja, y un solo envío. Hoy el recorrido es
cámara → formulario → guardar, **por bici**, y el formulario es una pantalla ajena a la caja que
tienes en la mano.

## 2) Objetivo

**Fotografiar N etiquetas de corrido, corroborar SKU por SKU, y mandar todo a una ubicación con un
botón.** Un solo viaje por caja; ningún formulario entre dos cajas.

**Métrica** (sale entera de `label_batch_runs`, §6):

| Cifra                                    |           Hoy |                         Objetivo |
| ---------------------------------------- | ------------: | -------------------------------: |
| Mediana de **segundos por unidad**       |        **85** |                         **≤ 30** |
| Tarjetas con el SKU **leído por cámara** |           s/d |                       **≥ 70 %** |
| Peor caso (0 % cámara, todo tecleado)    |            85 | **≤ 85** — empatar, nunca perder |
| `ADD` duplicados por doble-submit        | 1 en 33 altas |                            **0** |

El instrumento se construye **en P1, con la función**, no al final. Ésa es la enseñanza que dejó el
escáner en vivo: se retiró sin un solo registro de qué tan bien funcionaba.

## 3) Conceptos

- **Foto** = una etiqueta = **una caja**. No hay foto de pallet: el lector de varias etiquetas en
  una foto acierta 3 de 6 y no se usa aquí. Y una etiqueta se lee a 20–35 cm; eso es estar delante
  de la caja.
- **Tarjeta** = **un SKU dentro del lote**. Lleva sus fotos: **N fotos = N unidades**. Es lo que se
  corrobora "una por una".
- **Lote** = una ubicación + un interruptor + la pila de tarjetas. **Se envía entero o no se envía.**
- **Serial** = lo que distingue dos cajas del mismo SKU. Con serial, dos fotos son dos cajas o una
  caja fotografiada dos veces, y se puede saber cuál.

## 4) El gesto

1. **Stock → FAB ⋯ → `Add batch · Photos`**, justo debajo de `Add SKU · Foto`. Abre la ruta
   `/batch` y, encima, la cámara.
2. **Disparar una etiqueta por caja.** El visor no se cierra (`CameraCaptureSheet` ya hace esto);
   arriba, el número de fotos. Cada disparo entra en la cola de lectura **en segundo plano**: se
   sigue disparando mientras el teléfono lee.
3. **✕ cierra el visor** → la pila.
4. **Mientras se lee**, la tarjeta ya existe: miniatura, `READING`, y **la altura final desde el
   primer frame** (esqueleto del mismo alto). Nada salta bajo el pulgar cuando termina de leer.
5. **Cuando resuelve**, la tarjeta cae en uno de estos casos:
   - **SKU leído y en el catálogo** → verde. Modelo · talla · color **del catálogo** (no de la
     etiqueta), `IN STOCK n` con la ubicación donde hay más, 1 unidad.
   - **SKU leído y nuevo** → insignia `NEW`; modelo/talla/color de la etiqueta. Si falta **modelo o
     talla**, la tarjeta queda roja y **no se puede enviar** (❓ Q1).
   - **SKU leído con hermano de variante o grafía distinta** → `resolve_container_skus` lo canoniza
     y la tarjeta enseña el puente: `03-3768BLD → 03-3768BL`. Nada se decide en silencio.
   - **Campo ámbar** (la etiqueta dio dos lecturas) → chip con las opciones; un toque lo cierra.
     Es `chooseOption`, el mismo de hoy.
   - **Sin SKU** (etiqueta rota, borrosa, contra la pared) → tarjeta roja `NO SKU` con el teclado
     **en la misma tarjeta**: se teclea el SKU y, si el catálogo lo tiene, el resto se rellena solo.
     Queda marcada **`✎`** y se cuenta aparte. _Éste es el caso que hace que el peor caso empate con
     lo de hoy en vez de perder._
6. **El SKU ya está en la pila** — no nace otra tarjeta, se suma a la suya:
   - **seriales distintos y creíbles** → **+1 unidad**, la miniatura se suma al carril.
   - **el mismo serial** (comparado con `O→0`, `I→1`) → **+0 unidades**; la miniatura lleva `=`.
     Es la misma caja fotografiada dos veces.
   - **alguna de las dos sin serial legible** → **+1 unidad** y el contador se marca **`?` ámbar**:
     no se pudo probar. Cuenta, porque disparaste con una caja delante; avisa, porque no lo puede
     demostrar.
7. **Corregir a mano**: tocar una miniatura la borra (−1 unidad); tocar el contador lo teclea. Un
   contador tecleado queda `✎` y se cuenta aparte, igual que un SKU tecleado.
8. **Añadir sin foto**: `+ BY HAND` al final de la pila abre una tarjeta vacía con el teclado. La
   etiqueta que no se deja leer no atasca el lote.
9. **Arriba**: la **ubicación** (RETURN TO STOCK preseleccionada, y vuelve a ella en cada lote —
   una ubicación equivocada para 12 cajas es cara) y **un interruptor `BIKES`** para todo el lote.
   La tarjeta cuya etiqueta dice `PCS` mientras el interruptor dice BIKES enseña un chip ámbar
   `PART` — no es una pregunta por tarjeta, es el único caso en que la caja contradice al lote, y
   tocarlo la cambia sólo a ella. (Nada se esconde: la regla del mapa, "NOT ON THIS PLAN".)
10. **Seguir disparando**: el botón cámara de la barra inferior vuelve al paso 2. Es el mismo
    gesto de la entrada, no una acción sobre datos; sin él, cada caja nueva sería otro viaje por el
    menú — justo lo que `CameraCaptureSheet` existe para evitar.
11. **Cerrar: un botón.** `SEND · 12 U → RETURN TO STOCK`. Se apaga al pulsarlo **y** el envío lleva
    un `batch_id` generado en el cliente: un segundo POST con el mismo id devuelve el resultado del
    primero sin escribir nada. (Deshabilitar el botón no basta: la red reintenta sola.)
12. **Después**:
    - **Éxito** → toast con las cifras (`7 SKUS · 12 U · 4 NEW → RETURN TO STOCK`), la pila se
      vacía, Stock se invalida.
    - **Fallo** → **no se escribió nada** (una transacción). La pila **sigue en pantalla** con una
      barra roja que nombra el SKU que falló y un `RETRY` que reenvía el mismo `batch_id`.

**Ramas que el gesto cubre y no esconde:** pila vacía (sólo la cámara), lote sin ubicación
(imposible: hay una por defecto), SKU en otra ubicación (se ve `IN STOCK n` y **igual se suma aquí**
— decisión cerrada), SKU que el catálogo tiene como **parte** con el interruptor en BIKES (chip
`PART`, el catálogo gana salvo un toque), y borrador interrumpido (§❓ Q2).

## 5) Modos y herramientas — qué se ve y qué no

**No hay modos.** Hay **un interruptor** (BIKES), **una ubicación** y **un botón** (SEND). Todo lo
demás en pantalla es una cifra o una tarjeta.

**El idioma visual, el mismo que ya conoce de `LabelScanSheet`:**

| Señal            | Significa                                |
| ---------------- | ---------------------------------------- |
| **Verde**        | Leído y corroborado contra el catálogo   |
| **Ámbar**        | La etiqueta dio dos lecturas — elegí una |
| **Rojo**         | Falta y no se puede enviar así           |
| **`NEW`**        | El catálogo no lo tiene                  |
| **`IN STOCK n`** | El catálogo sí lo tiene, y cuánto hay    |
| **`=`**          | Esta foto es la caja anterior, otra vez  |
| **`?`**          | No se pudo probar si era otra caja       |
| **`✎`**          | Lo puso la mano, no la cámara            |

**Lo que el lote deliberadamente NO tiene:** medidas (no declara `dimensions_verified`), origen (es
siempre `ADD`), una pregunta de tipo por tarjeta, ni un paso de confirmación extra — **la pila es la
confirmación**: cada tarjeta ya se miró una por una.

## 6) Datos

### Lo que se reusa (nada de esto se reimplementa)

| Pieza                                                                                                                      | Papel en el lote                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/components/ui/CameraCaptureSheet.tsx`                                                                                 | El paso 1, sin cambios (con `count` y sin `total`).                                                                   |
| `recognizeLabelClient` (`src/lib/recognition/`) + `buildSkuLabelDraft` (`src/features/inventory/utils/labelToSkuDraft.ts`) | La lectura y el `SkuLabelDraft` con sus estados.                                                                      |
| **`LabelDraftCard`** — se **extrae** de `LabelScanSheet.tsx`                                                               | La tarjeta. La usan el lote **y** el alta de a uno, que pasa a ser **una tarjeta sola**.                              |
| `resolve_container_skus(p_items, p_warehouse)`                                                                             | Corroborar contra el catálogo sin escribir: `is_new`, `existing_qty`, `existing_locations`, `merged_from`, `is_bike`. |
| `recordSkuSerial` / `normalizeSerial` (`src/features/inventory/api/skuSerials.service.ts`)                                 | El registro de cajas.                                                                                                 |
| `uploadPhoto` (`src/services/photoUpload.service.ts`)                                                                      | La foto del catálogo, **sólo si el SKU no tiene ninguna**.                                                            |
| `src/utils/size.ts`                                                                                                        | La talla. Única casa.                                                                                                 |
| `src/utils/skuDefaults.ts`, `normalizeSkuOnRegister`                                                                       | Defaults por tipo y grafía canónica del SKU.                                                                          |
| `idb-keyval` (ya es dependencia, la usa `src/lib/query-client.ts`)                                                         | Las fotos del borrador.                                                                                               |

**Una sola cámara en la app:** `LabelScanSheet` pierde su `<input capture>` y abre
`CameraCaptureSheet`. El camino viejo (la cámara del sistema) desaparece del código, no queda
"por si acaso".

### Lo nuevo

**`register_label_batch(p_location, p_items jsonb, p_user_id, p_performed_by, p_warehouse, p_batch_id uuid, p_default_is_bike boolean)`**
— es **el cuerpo de `register_container` sin la guarda**. `register_container` se reescribe como
_guarda de ubicación + `PERFORM register_label_batch(...)`_: contenedor = guarda + cuerpo, lote =
cuerpo. Una sola implementación del "escribir un lote en una ubicación".

Por tarjeta, **dentro de la misma transacción**:

1. Si es nueva: `INSERT INTO sku_metadata (sku, is_bike, weight_lbs) … ON CONFLICT DO NOTHING`.
   Va **primero** a propósito: `set_is_bike_on_insert` respeta el valor explícito y con él escribe
   los **defaults de caja del tipo correcto**. Sin esto, un `05-…` nace **parte** por prefijo (1 lb,
   0×0×0) y arreglarlo después con un UPDATE de dimensiones **sellaría `dimensions_verified`** —
   exactamente el cartón falso que el export de FedEx no debe ver.
2. `register_new_sku(sku, name, warehouse, location, model, size, color, NULL)` — nombre
   `MODEL SIZE COLOR`, upsert con COALESCE, y la fila de inventario en qty 0.
3. `adjust_inventory_quantity(sku, warehouse, location, +N, performed_by, user_id, 'admin', …)` —
   **un `ADD` por SKU**, no uno por unidad.
4. Peso: sólo si la etiqueta dio G.W. **y** `weight_verified = false`. Escribirlo lo sella como
   verificado (`set_dimensions_verified`), que es lo que se quiere: es un número del fabricante.
   Nunca pisa una pesada real.

> El orden metadata→inventario es seguro **aquí** porque es una transacción: no existe la ventana
> que dejó 96 filas de `sku_metadata` sin inventario desde el formulario (dos escrituras del cliente
> sin esperar). Es una de las razones de que el lote sea **una** RPC.

**`label_batch_runs`** (append-only, RLS admin) — la guarda del doble-submit **y** el instrumento de
medición, en la misma fila: `batch_id` (PK — la idempotencia), `location`, `warehouse`, `skus`,
`units`, `new_skus text[]`, `photos`, `cards_camera`, `cards_hand`, `amber_resolved`, `red_typed`,
`units_hand_set`, `seconds` (del primer disparo al SEND), `app_version`, `device`, `result jsonb`,
`created_by`, `created_at`. **El lote no inventa columnas en `inventory_logs`**: su identidad vive
aquí, y los `ADD` son `ADD` normales.

**`serialLooksReal(s)` + `serialKey(s)`** en `skuSerials.service.ts` — el filtro de cordura que el
conteo necesita. Lo piden los datos: `sku_serials` ya tiene **`SERIALLOE`** (que es el OCR del
rótulo «SERIAL NO.») y la confusión O/0 a la vista — `M25HO00435` y `M25H000432` conviven hoy.
`serialLooksReal` rechaza lo que contenga `SERIAL`, lo de menos de 6 caracteres y lo que no tenga al
menos 3 dígitos; `serialKey` pliega `O→0` e `I→1` **sólo para comparar dentro del mismo SKU y del
mismo lote**. **Lo que se guarda es la lectura tal cual**, nunca la plegada.

**`size.ts` — dos líneas que hay que arreglar antes de guardar la talla canónica** (P1):
`normalize()` hoy no pliega `×` a `X`, así que `formatSize('26X18') = '26"×18"'` **no vuelve a
parsearse**. Medido sobre las **861 filas** de prod con talla: guardar la forma canónica sin ese
arreglo **cambia la clave de agrupación del export de FedEx en 48 filas**. Con `×→X`, `700` sin C
reconocido como rueda, y la rueda comprobada **antes** que el par (`700X54` no es un cuadro de 700
pulgadas): **698 filas cambian de grafía, 0 dejan de ser idempotentes y 1 sola cambia de clave**
(§9 C10). `renderSizeForExport` **no se toca**: es la llave de agrupación del export.

### Lo que no se toca

`dimensions_verified` (el lote nunca lo declara), `received_year`, el `picking_order` 294 y el
`pick_priority = 'last'` de RETURN TO STOCK, `renderSizeForExport`, y el flujo de a uno — que gana
la misma tarjeta y pierde su cámara vieja, nada más.

## 7) Pantalla (430 px — el teléfono)

```
┌──────────────────────────────────────────────────────────┐ 430 px
│ ←  BATCH                                    BIKES ●───   │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ RETURN TO STOCK                                    ▾ │ │
│ └──────────────────────────────────────────────────────┘ │
│      7               12               4                  │
│    SKUS            UNITS             NEW                 │
├──────────────────────────────────────────────────────────┤
│ ┌─ verde ──────────────────────────────────────────────┐ │
│ │ 05-3849BK                                     3      │ │
│ │ STARLINER 7-SPD MENS · 17" · BLACK         UNITS     │ │
│ │ [▩][▩][▩]                          IN STOCK 5 · RTS  │ │
│ └──────────────────────────────────────────────────────┘ │
│ ┌─ ámbar ──────────────────────────────────────────────┐ │
│ │ 03-4686GY                         NEW         1      │ │
│ │ RENEGADE C3 · ( SIZE ? ) · ADOBE CLAY      UNITS     │ │
│ │ [▩]                                                  │ │
│ └──────────────────────────────────────────────────────┘ │
│ ┌─ roja ───────────────────────────────────────────────┐ │
│ │ [ SKU ____________ ]           NO SKU         1   ✎  │ │
│ │                                            UNITS     │ │
│ │ [▩]                                                  │ │
│ └──────────────────────────────────────────────────────┘ │
│ ┌─ gris ───────────────────────────────────────────────┐ │
│ │ ▒▒▒▒▒▒▒▒▒                                     ·      │ │
│ │ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒                         UNITS     │ │
│ │ [▩]                                       READING    │ │
│ └──────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ 07-3718BL                                     2   ?  │ │
│ │ XR24 · 24"×12" · COBALT BLUE               UNITS     │ │
│ │ [▩][▩ =]                             IN STOCK 2 · RTS│ │
│ └──────────────────────────────────────────────────────┘ │
│                  + BY HAND                               │
├──────────────────────────────────────────────────────────┤
│  [ ◎ ]   [      SEND · 12 U → RETURN TO STOCK        ]   │
└──────────────────────────────────────────────────────────┘
```

**Un ámbar abierto** crece **hacia abajo, en la tarjeta que tocaste**, y vuelve a cerrarse:

```
│ │ RENEGADE C3 · ( SIZE ? ) · ADOBE CLAY      UNITS     │ │
│ │   ( 700×54cm )   ( 54cm )   ( type )                 │ │
```

**Bloqueado** (una tarjeta nueva sin modelo) y **fallo**:

```
│  [ ◎ ]   [   1 CARD NEEDS A MODEL                    ]   │  ← apagado
│ ✕  NOTHING WAS WRITTEN · 03-4686GY              RETRY    │  ← rojo, la pila sigue
```

**Vacío:**

```
│                       0  PHOTOS                          │
│                 [   OPEN THE CAMERA   ]                  │
```

**Reglas de la pantalla en el teléfono:** la pila **no se reordena nunca** (orden de disparo) y una
tarjeta resuelta **se queda en su sitio** — sacarla movería todo bajo el pulgar y se llevaría la
única confirmación de que quedó bien (la misma regla que la cola de Measure). Altura de tarjeta
fija, **también mientras lee**. Barra inferior `fixed bottom-0` con `pb-28`, pila con `pb-32`, la
cámara en `z-[180]` (ya lo está). El alta de a uno queda como **una** tarjeta con el mismo
componente:

```
┌──────────────── ADD SKU · PHOTO ─────────────────────────┐
│ ┌─ la misma LabelDraftCard ────────────────────────────┐ │
│ └──────────────────────────────────────────────────────┘ │
│                        [   SAVE   ]                      │
└──────────────────────────────────────────────────────────┘
```

Si la tarjeta no le cuadra al verla, va al **layout lab** con sus átomos reales
(`docs/layout-lab/`) — es una pregunta de _dónde va cada cosa_, y ahí se contesta arrastrando.

## 8) Fases

**P1 — El lote** (lo que pidió): ruta `/batch` (lazy), entrada `Add batch · Photos` bajo
`Add SKU · Foto`, cámara única en toda la app, pila con lectura en segundo plano, conteo por serial
con `serialLooksReal`/`serialKey`, `+ BY HAND`, ubicación + interruptor, envío transaccional con
`batch_id`, `register_label_batch`, `label_batch_runs`, `LabelDraftCard` extraída y usada por el
alta de a uno, y el arreglo de `×` en `size.ts` con la talla canónica **en lo que el lote escribe**.
**Checkpoint:** capturas a 430 y 1400 px + **un lote real de 6 cajas** en RETURN TO STOCK, con su
fila de `label_batch_runs` (s/u, cámara vs mano) puesta al lado de los 85 s de hoy.

**P2 — La talla, en todo el catálogo**: trigger `normalize_sku_size` (autoridad en SQL, espejo en
`size.ts`, **la misma tabla de casos en los dos tests**, como `canonical_sku`) y la pasada de las
**698 filas**. **Checkpoint:** el preview con las 698 y la lista de la **única** fila que cambia de
clave de export, nombrada (§9 C10), antes de `--apply`.

**P3 — Lo que puede venir después** (escrito y esperando, no construido): el mismo lote descargando
un contenedor en ROW 28 (la guarda de `register_container` ya es opcional), un lote que **mueve** en
vez de sumar, y el UPC aprendido desde la etiqueta (`persistSkuUpcMapping`, ya vive en
`src/utils/skuUpc.ts`).

## 9) Casos de verificación

Cifras de prod al 23 sep 2026. Cada caso dice **qué log deja**.

| #   | Caso                                                                                                                             | Resultado esperado                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | 3 fotos de `05-3849BK` (STARLINER 7-SPD MENS 17" BLACK, hoy **5 u** en RETURN TO STOCK), 3 seriales distintos                    | **1 tarjeta, 3 u.** Tras SEND: `inventory` 5 → **8**. **Un** `inventory_logs` `ADD` (+3, prev 5, new 8, `performed_by` = el usuario). **3** filas nuevas en `sku_serials` (`source = 'label_scan'`). 1 fila en `label_batch_runs` (units 3, photos 3, cards_camera 1).                                                                                                                                                                                                               |
| C2  | 2 fotos de **la misma caja** de `07-3718BL` (XR24, hoy 2 u), serial idéntico                                                     | Contador **1**, la segunda miniatura con `=`. SEND: 2 → **3**, `ADD` +1. En `sku_serials`, `seen_count` pasa de 1 a 2 — **sin fila nueva**.                                                                                                                                                                                                                                                                                                                                          |
| C3  | 2 fotos de `05-1136RD`, cuya única fila de `sku_serials` hoy es **`SERIALLOE`** (el OCR del rótulo «SERIAL NO.»)                 | `serialLooksReal` rechaza las dos lecturas → **2 u con el contador en ámbar `?`**. **Nada** nuevo en `sku_serials`. `label_batch_runs.units_hand_set = 0` (no hizo falta la mano).                                                                                                                                                                                                                                                                                                   |
| C4  | 2 fotos de la misma caja de `03-4666BR`, leídas `M25H000432` y `M25HO00432` (el O/0 que ya convive en la tabla con `M25HO00435`) | `serialKey` las iguala → **1 unidad**, no 2. Se guarda la lectura tal cual; `seen_count` +1 sobre la fila existente.                                                                                                                                                                                                                                                                                                                                                                 |
| C5  | Foto de un SKU que el catálogo no tiene y cuyo **modelo** sale rojo                                                              | La tarjeta no se puede enviar; el botón dice **`1 CARD NEEDS A MODEL`** y está apagado. Se teclea el modelo → el botón vuelve. _(Es el bloqueo que evita otro `03-3771RD`, cuyo `model` en prod es la letra **`T`**.)_                                                                                                                                                                                                                                                               |
| C6  | Etiqueta ilegible entre 5 fotos                                                                                                  | Tarjeta roja `NO SKU`; se teclea `05-1135GN` y el catálogo rellena `B1 MENS 7-SPEED · 26"×18" · ARMED & READY`. Queda `✎`. `label_batch_runs.cards_hand = 1`, `cards_camera = 4`.                                                                                                                                                                                                                                                                                                    |
| C7  | **Pulsar SEND dos veces** (el caso real: dos `ADD` con 2 s de diferencia)                                                        | El segundo POST lleva el mismo `p_batch_id`; la RPC encuentra la fila en `label_batch_runs` y devuelve el mismo resultado **sin escribir**. `select count(*) from inventory_logs where sku=… and action_type='ADD'` → **1**, no 2.                                                                                                                                                                                                                                                   |
| C8  | Un lote de 7 tarjetas donde la 5.ª revienta (SKU imposible de registrar)                                                         | **0** filas en `inventory_logs`, **0** altas en `sku_metadata`, **0** en `label_batch_runs`. La pila sigue en pantalla; barra roja con el SKU; `RETRY` con el mismo `batch_id` escribe una sola vez.                                                                                                                                                                                                                                                                                 |
| C9  | Un lote de 12 cajas / 7 SKUs, cronometrado                                                                                       | `label_batch_runs.seconds / units` **≤ 30**. Se compara contra los 85 s de hoy en el checkpoint de P1 — y si `cards_camera / (cards_camera + cards_hand)` < 50 %, el lote se queda y **el lector se discute con esa cifra**.                                                                                                                                                                                                                                                         |
| C10 | **P2 — la pasada de tallas** sobre las **861** filas con `size`                                                                  | **698** cambian de grafía (`13X27` → `13"×27"`, `700c*19` → `700×19"`, `26"X18"` → `26"×18"`), **0** dejan de ser idempotentes, y **`renderSizeForExport` devuelve exactamente lo mismo en 860**. La **única** que cambia de clave es **`03-4686GY`** (RENEGADE C3, `'700 x 54 cm'` → `700×54cm`): pasa de `700''X54` a `700CX54''`, o sea deja de declararse como un cuadro de **700 pulgadas**. Está `dimensions_verified`, así que sale en el export: se nombra antes de aplicar. |

## 10) ❓ Preguntas — cada una con su respuesta por defecto (un "ok todo" las cierra)

**Q1 — ¿Un SKU nuevo sin modelo o sin talla bloquea la tarjeta?**
**Default: sí, esa tarjeta — nunca el lote.** El botón dice cuántas faltan y se apaga; la tarjeta se
puede **sacar** del lote con un toque si no se resuelve ahí. Es el único momento en que hay una caja
delante: después nadie vuelve a mirar, y el catálogo se queda con un `model` de una letra (ya hay
cinco así) o con la talla metida en el color (`03-4686GY` tiene hoy
`ADOBE CLAY / BRONZE DUSK 700C ×54CM` en `color`).

**Q2 — ¿El lote sobrevive a cerrar la app?**
**Default: sí, en el dispositivo.** Un borrador único: las tarjetas en `localStorage`, las fotos en
`idb-keyval` (ya es dependencia). Se descarta al enviar o con `DISCARD`. Un teléfono que se bloquea
a mitad de 12 fotos no puede costar el viaje entero.

**Q3 — ¿Cómo cuenta las unidades cuando el serial no se deja leer?**
**Default: cuenta, y lo dice.** Cada foto es una unidad salvo que un serial demuestre que es
repetida; sin serial creíble, suma y el contador se marca `?` ámbar. La alternativa (no sumar) pierde
cajas en silencio, que es peor que un `?` que se corrige tocando.

**Q4 — ¿Qué puede pisar el lote en el catálogo de un SKU que ya existe?**
**Default: nada, sólo huecos.** Modelo, talla y color sólo si están vacíos; **peso** sólo si
`weight_verified = false`; **foto** sólo si el SKU no tiene ninguna; `is_bike` **sólo en los nuevos**
(en los existentes lo decidió una persona, y el chip `PART` ofrece cambiarlo con un toque). Lo que la
etiqueta dice distinto se enseña en la tarjeta y no se escribe.

**Q5 — ¿Dónde vive la regla de la talla canónica?**
**Default: en SQL como autoridad (trigger `normalize_sku_size`) con espejo en `size.ts` y la misma
tabla de casos en los dos tests**, como `canonical_sku`. Escriben la talla el formulario, el lote, el
intake de contenedor y el backfill del AS400: una regla sólo en el cliente vuelve a llenarse de
grafías por el primer script que pase.

**Q6 — ¿Se registra cada lote en una tabla propia (`label_batch_runs`)?**
**Default: sí, y desde P1.** Es la guarda del doble-submit y la única forma de saber si el lector
sirve (cámara vs mano, s/u, ámbares resueltos). El escáner en vivo se retiró **sin un solo registro**
de cómo funcionaba porque su tabla se creó el último día.

## 11) Riesgos

- **La cámara puede no ser el cuello de botella otra vez.** No hay medición de cuántas de estas
  etiquetas dan SKU. Por eso el peor caso está diseñado (`NO SKU` se teclea en la misma tarjeta,
  `+ BY HAND`) y por eso `cards_camera` vs `cards_hand` se registra desde el primer lote: **el lote
  vale aunque el lector no** — agrupar y enviar una vez ya ahorra los formularios. Si la proporción
  es mala, se retira el lector, no el lote.
- **`ADD` siempre.** Decisión cerrada: si la caja bajó de un estante, queda contada dos veces. Lo que
  el diseño puede hacer es **ponerlo delante de los ojos antes de enviar** — `IN STOCK n` con su
  ubicación en cada tarjeta — no impedirlo.
- **Un serial mal leído junta o parte cajas.** El filtro de cordura reduce, no elimina; la defensa
  final es que el contador se teclea y la miniatura se borra, y que `✎` deja marcado que fue la mano.
- **Sin la guarda de ubicación**, `register_label_batch` puede correr dos veces sobre una ubicación
  con stock. Es deliberado (RETURN TO STOCK tiene **25 filas / 42 u** ahora mismo) y por eso la
  guarda es el `batch_id`, no la ubicación.
- **La pasada de tallas toca 698 filas de un catálogo que alimenta el export de FedEx.** La prueba
  es la comparación fila a fila de `renderSizeForExport` antes y después (860 idénticas, 1 nombrada)
  y la cuenta de registros/excepciones de la siguiente corrida, que queda en `fedex_dimension_exports`.
- **12 fotos son memoria.** Las lecturas corren en segundo plano y en un teléfono real compiten por
  CPU; el diseño lo asume (la tarjeta existe antes de leerse) pero si la lectura se atasca, la salida
  es la misma que la etiqueta rota: teclear y seguir.
