# PRD: Recoger una tarima a la vez, con su foto al cerrarla

**Estado:** estudio, esperando «ok» · **Fecha:** 2026-10-06 · **Backlog:** idea-247 (ampliada)
· **Continúa:** `pallet-box-inference.md` (idea-245: marcas, frentes, `palletTimeline`)
· **Relacionado:** `src/features/picking/components/PickingCartDrawer.tsx`,
`DoubleCheckView.tsx`, `pallets/planPallets.ts`, `src/components/ui/CameraCaptureSheet.tsx`

Lo que sigue está comprobado en el código del 6 oct 2026 o medido en prod (`PROD_DB_URL`).

---

## 1) Contexto y problema

Rafael, 3 oct: «un picker no puede recoger más de 1 pallet por viaje; podemos aprovechar eso». Y el
6 oct, cerrando la forma: **«después de que termina de recoger una pallet le salta el botón de tomar
foto de inmediato fastidiando y haciéndose más grande para que el picker le haga caso, no
obligatorio. pero cuando se tome la o las fotos ya abre automáticamente la siguiente pallet.»**

**Lo que hay hoy:**

- **El picker** trabaja en `DoubleCheckView` dentro de `PickingCartDrawer`: ve **todas** las tarimas
  abiertas a la vez (`Pallet 1/2 · 7 / 10`), marca líneas y pulsa **Ready to DC**. Cada marca deja
  una fila en `pallet_events` (`phase = 'pick'`, `cart_pallet` = la tarima **del plan**; la columna
  `pallet` va vacía: 47 de 47 marcas de picker sin ella).
- **La foto la toma quien verifica**, después, en Double Check: el pie cambia a **Take Photo** y
  sin foto no hay **Slide to Complete**. La foto va a `shipments.pallet_photos` (arreglo de URLs,
  `append_pallet_photo`) **sin decir de qué tarima es**. La sombra la lee en un Worker (5–35 s) y,
  si ubica ≥ 4 etiquetas, `frontApply` **deduce** la tarima; si quien verifica ya cambió de orden,
  la lectura se tira (`forList === activeListIdRef.current`).
- **El motor** (`planPallets`) llena las tarimas en el orden del recorrido; desde el 5 oct, parejas
  (la de 12 como último recurso) y con grandes debajo de la de niño (#881828: 10 y 9).

**Medido (5–6 oct):**

- 280 órdenes con bicis en 30 días; **21 (7,5 %) llevan ≥ 2 tarimas**. En 17, dos tarimas comparten
  una fila; en 11, un SKU queda partido — casi siempre la **fila frontera**. (Ship guardó
  `pallets_qty ≥ 2` en 39 órdenes completadas: 2,6 tarimas y 5,4 fotos de media; 4 con tarima armada
  a mano, 7 con bicis tecleadas.) **La diferencia es la combinación:** el 21 cuenta cada orden sola; las
  39 caen en 37 envíos y 19 de ellos son combinados, donde dos órdenes chicas suman ≥ 2 tarimas. Así que
  las cargas de varias tarimas son más que el 7,5 %, y el flujo pesa más en las combinadas.
- Lecturas de la sombra desde el 1 oct: **36**, de ellas **18 con ≥ 4 etiquetas** ubicadas;
  **3** quedaron como frente.
- **#881828 (5 oct), la orden entera en el tiempo:** Roman marca la tarima 1 de 15:21:51 a 15:37:44
  (**16 min**, 8 líneas), las dos grandes de ROW 42/43 a 15:40 y la de niño de 15:41:27 a 15:44:23
  (**3 min**); a 15:44:42 **Select all** marca 17 de golpe. Rafael verifica a 15:55 y saca los tres
  frentes a **16:01:11–16:01:17**: **23 min** después de cerrar la tarima 1, y es entonces cuando la
  sombra lee `03-4547MN ×2` donde la orden pedía `03-4537GY` (WRONG PICK). De 16:09 a 16:13 la
  estación (Warehouse Team) rehace a mano las dos tarimas: las grandes `03-3928BL` y `03-3936MN`
  van **debajo de la de niño**.

**El dolor:** la tarima de cada bici se **deduce** después, con fotos tomadas lejos del momento y
por otra persona. El paso del picker por la tarima es el hecho, y hoy no se guarda.

## 2) Objetivo

Que el picker arme **una tarima por viaje**, que cada marca diga **en qué tarima subió** la bici y
que cada tarima quede con **su foto, tomada al cerrarla**.

**Métricas** (sobre órdenes de ≥ 2 tarimas, desde el despliegue, `pallet_events`):

| Cifra                                                         | Hoy                   | Meta   |
| ------------------------------------------------------------- | --------------------- | ------ |
| Tarimas con foto del picker                                   | 0 %                   | ≥ 80 % |
| Segundos de cierre → foto (mediana)                           | — (23 min en #881828) | ≤ 30 s |
| Fotos de tarima que la sombra lee como frente (≥ 4 etiquetas) | 3 de 36 lecturas      | ≥ 50 % |
| Envíos con una bici movida de tarima tras Ready to DC         | #881828: 4 ediciones  | ≤ 20 % |
| Minutos por tarima (primera marca → cierre)                   | 16 y 3 (#881828)      | medir  |
| Viajes abiertos sin foto (`› 2`)                              | —                     | medir  |

## 3) Conceptos

- **Viaje** — la tarima **en curso**: la única abierta en el carrito del picker. Una marca hecha
  durante el viaje dice _esta bici subió a esta tarima_ (`pallet_events.pallet`). Es un hecho, no
  un plan.
- **Tarima cerrada** — la que quedó atrás: el picker abrió la siguiente (con foto o con `›`). Lo
  que se marcó en ella queda **fijo** (`pallet_dims[].items`, la misma escritura que el lápiz), y el
  motor reparte el resto alrededor.
- **Foto de tarima** — foto tomada con una tarima nombrada (la del viaje, o la que se toque). Su
  tarima **se guarda**, no se deduce. La sombra la lee igual; si además es frente, da el orden y
  los niveles.
- **Tarima tomada** — la que un picker tiene en su viaje. Con dos pickers en la misma orden
  (Assist), la tomada por uno está **bloqueada** para el otro, que toma la siguiente libre. La suelta
  la foto, `›`, Ready to DC, la X o 10 min sin tocarla.

## 4) El gesto

### El picker (antes de Ready to DC)

1. **Abre la orden.** Se abre la **tarima 1** (la primera del recorrido): borde sólido, sus líneas
   como hoy. Las demás, **plegadas** a una línea cada una: `PALLET 2/3 · 9` con borde punteado
   (plan). La de partes (contenedor, no tarima) se ve como hoy y se marca cuando sea: no es viaje.
2. **Marca líneas** en cualquier orden dentro de la tarima. Cada marca escribe `pallet = 1`.
3. **La fila frontera.** Una línea partida entre dos tarimas dice cuánto es de ésta y cuánto va en
   la siguiente: `03-4811RD ×1 · +1 P2`. Nada que decidir.
4. **Tarima completa** = toda línea marcada, o con un problema de stock abierto
   (`StockIssuePanel`: no se puede recoger). Entonces **salta la barra de foto** encima del pie:
   `📷 PALLET 1` en ámbar, pulsando. **Insiste creciendo** (§5): 3 tamaños, sin sonido ni vibración.
   A su derecha, chico y gris, **`› 2`**: abrir la siguiente sin foto.
5. **Toca la barra** → (si quedan líneas sin marcar, primero la pregunta de abajo) → la cámara de siempre (`CameraCaptureSheet`), titulada `PALLET 1`. Dispara
   una o varias; el visor se queda abierto.
   - **Cierra la cámara con ≥ 1 foto** → la tarima 1 **se cierra** (plegada, verde sólido,
     `✓ 10 · 📷 2`) y **la 2 se abre sola**, con scroll a su primera línea.
   - **Cierra sin foto** → nada cambia; la barra sigue donde estaba.
6. **No quiere foto** → toca `› 2`: la 1 se cierra igual, pero su línea plegada lleva `📷 ?` en
   ámbar; tocarlo abre la cámara para la 1 **sin** cambiar el viaje. Nada bloquea nada.
7. **La última tarima** (o la única): la barra salta igual, sobre **Ready to DC**. Tras la foto no
   hay siguiente: queda Ready to DC. Pulsar Ready to DC sin foto **se puede**.
8. **Una tarima que no se completa**: la cabecera de la tarima en curso lleva siempre un `📷`
   chico. Tocarlo con líneas sin marcar abre la pregunta de abajo; sin ninguna, es el paso 5.

### Bicis sin marcar al tomar la foto

Rafael, 6 oct: «si el picker deja desmarcadas bicicletas de esa pallet que está recogiendo, cuando
presione el botón de tomar foto se le pregunte si esas quiere que vayan a otra pallet».

1. **Cuándo:** el picker toca `📷` (la cabecera, o la barra cuando la tarima llegó a «completa» con
   líneas con problema de stock) o `›`, y en la tarima en curso queda **≥ 1 bici sin marcar**
   (las partes no cuentan). Sin bicis sin marcar no hay pregunta.
2. **Qué ve** (hoja del Modal Manager): la cifra de **bicis** sin marcar, `4 UNCHECKED`, y una fila por línea —SKU, `×n`,
   ROW, y el chip de su problema si lo tiene (`LOW STOCK`, `UNREG`)—. Dos botones:
   - **`→ P2 · 4`** (principal): esas bicis **salen de esta tarima**. El destino que dice el botón
     no se elige: es **el que da el motor** con esta tarima cerrada (`planPallets` corrido con lo
     marcado fijo); si las reparte en dos, dice `→ P2 · P3`. Cambiarlo después es el lápiz.
   - **`Keep on P1`**: se quedan aquí para después. La foto se toma y **el viaje no avanza**.
3. **Cómo se escribe `→`:** la tarima en curso se cierra con **sólo lo marcado**, con la misma
   escritura que el lápiz (`applyPalletSelection(P1, marcadas)` → `pallet_dims[0].items`); lo sin
   marcar vuelve al reparto y el motor lo pone en la siguiente. Después, la cámara; al cerrarla con
   foto se abre la siguiente (paso 5). Con `›`, se abre sin cámara.
4. **Una línea con problema de stock** va con las demás: no está en esta tarima. En la siguiente
   sigue con su chip y su `StockIssuePanel`; si se resuelve (Take N, Replace), se recoge allí.
5. **La última tarima** (o la única): no hay «otra». Los botones son **`Keep on P2`** (principal) y
   **`+ P3 · 2`**: una tarima **nueva** con esas bicis (cerrar con lo marcado deja un resto y el motor
   abre un ordinal más). Cambia PALLETS en Ship; por eso no es el principal.
6. **Log:** un `answer` (`payload: { q: 'unchecked', choice: 'next' | 'keep' | 'new', units }`); con
   `next` / `new`, el `edit` de `pallet_dims` que ya escribe `usePalletDims`.

**Ramas de una marca:**

| Dónde está la línea que marca                                | Qué pasa                                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| En la tarima en curso                                        | Se marca. `pallet` = la en curso.                                                                                        |
| En una tarima plegada (futura): toca su línea → se despliega | Se ve punteada (plan). **Marcar una línea suya la sube a la tarima en curso**: pasa a ella con `from P2`. Sin confirmar. |
| En una tarima cerrada                                        | Desplegada en verde sólido. Desmarcar una línea **la saca** de esa tarima (vuelve al reparto); marcar no cambia nada.    |
| Parte (contenedor)                                           | Se marca como hoy; no cuenta para completar el viaje.                                                                    |
| Sin ubicación / con problema de stock                        | No se puede marcar (como hoy); no impide completar la tarima.                                                            |
| En una tarima **tomada por otro picker** (Assist)            | Se despliega para verla; **no se marca** (el toque menea el candado `🔒 Ana`).                                           |

### Orden de una sola tarima (92,5 %)

Lo mismo con un solo viaje: la barra salta al marcar la última línea, encima de Ready to DC. Lo
único que cambia es que **la foto la saca el picker** delante de la tarima recién armada, en vez de
quien verifica media hora después.

### Quien verifica (después de Ready to DC)

1. **Las marcas ya no significan nada** (regla del 3 oct): no hay viaje; todas las tarimas abiertas,
   como hoy.
2. **Cada tarima enseña sus fotos** bajo su cabecera (miniaturas, tocar = ampliar). Una tarima sin
   foto lleva un `📷 ?` ámbar: tocarlo fotografía **esa** tarima. Las fotos sin tarima (las viejas, o
   las del botón general) siguen arriba, como hoy.
3. **Slide to Complete** aparece directo si el picker ya sacó foto (cuenta para el «≥ 1 foto»).
   Sin ninguna, el pie sigue siendo **Take Photo** (sin tarima: se deduce como hoy).
4. **Ya no deduce la tarima** de una foto con tarima: la tarjeta del frente (`FrontProposalCard`)
   sólo dice lo que la foto añade — orden, `from P1`, `WRONG PICK?`, `NOT IN ORDER`.

### Lo que cambia a mitad de viaje

| Qué pasa                                                    | Tarima en curso                                                                             | Tarimas cerradas                                                                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Combinada** (`shipments`, `verified_item_keys` del grupo) | Un carrito, un viaje: las tarimas son del envío. Cada evento lleva su `list_id`.            | Igual.                                                                                                                           |
| **Grupo FedEx**                                             | Igual (una tarima por viaje es física). La foto va a la orden abierta, como hoy.            | Igual.                                                                                                                           |
| **Edit Order añade una línea**                              | El motor reparte el resto alrededor de las cerradas: cae en la en curso o en una futura.    | **No cambian** (fijas): una bici nueva nunca cae en una tarima ya envuelta.                                                      |
| **Edit Order quita una línea / baja cantidad**              | Desaparece.                                                                                 | La orden manda: sale de la tarima fija (`carve` toma lo que hay).                                                                |
| **Línea re-dirigida en vivo** (`useStaleLocationCheck`)     | Una sin marcar cambia de ROW y puede cambiar de tarima; se ve. **Una marcada no se mueve.** | Están marcadas: no se re-dirigen (regla del 3 oct).                                                                              |
| **Cifra o lápiz en Double Check** mueve bicis entre tarimas | — (ya no hay viaje)                                                                         | Una cerrada es «armada a mano»: su cifra abre el lápiz (`42d82b61`); la edición es más nueva y manda. La marca sigue a su línea. |
| **Park (X) y retomar, u otro teléfono**                     | La X la suelta; al volver, la retoma si nadie la tomó (el viaje sale de `pallet_events`).   | Igual.                                                                                                                           |

### Dos pickers en la misma orden (Assist, idea-155)

Rafael, 6 oct: «se trabajaría para que los 2 no puedan recoger la misma tarima al mismo tiempo
bloqueando la que ya se está escogiendo por el primer picker».

1. **El primero** abre la orden como hoy (`checked_by` es suyo) y **toma** la tarima 1.
2. **El segundo** abre la misma orden. Hoy entra en vista; si la orden tiene **≥ 2 tarimas** y alguna
   está **libre** (ni cerrada ni tomada), el aviso de vista lleva un botón más: **`Assist · P2`**. Un
   toque y toma la primera libre del recorrido. Sin libre, no hay botón (vista, como hoy).
3. **Qué ve cada uno:** su tarima en curso abierta; la del otro plegada con candado y su avance,
   `PALLET 1/2 🔒 Roman · 6 / 10`; las cerradas en verde. La del otro se despliega para mirar, sus
   líneas no se marcan, y no aparece en «subir una bici de otra tarima».
4. **Cuándo se suelta:** al abrir su siguiente (foto o `›`), con Ready to DC, con la X, y por
   **inactividad**: 10 min sin una marca, una foto ni una respuesta en esa tarima. Una suelta por
   inactividad se ve `PALLET 1/2 · 6 / 10` sin candado, con lo marcado conservado: cualquiera la
   continúa. Medido: en #881828 el hueco más largo entre dos marcas de la tarima 1 fue de **3 min
   47 s** (15:26:55 → 15:30:42).
5. **Al abrir su siguiente**, cada picker toma la **primera libre** del recorrido, nunca una tomada.
   Si no queda ninguna libre, su viaje termina: ve todo y su pie dice Ready to DC sólo cuando todo
   esté marcado, como hoy.
   (Ana es un nombre de ejemplo para el segundo picker.)
6. **La fila frontera compartida** (`03-4811RD`, ×1 en P1 y ×1 en P2): cada uno marca la de su
   tarima, y el `+1 P2 · Ana` dice quién se lleva la otra. Nadie puede pasarse la de la tarima tomada.
7. **«→» hacia una tarima tomada:** la pregunta de las bicis sin marcar puede mandarlas a la tarima
   del otro; el botón lo dice (`→ P2 · Ana · 2`) y a ella le aparecen sin marcar con `from P1`.
8. **Ready to DC** lo pulsa cualquiera de los dos cuando **todo** está marcado; suelta las dos.

**Lo que no cierra este estudio:** las marcas de dos teléfonos se escriben hoy en un solo
`verified_item_keys` del grupo, cada teléfono con su Set; dos escritores a la vez pueden pisarse
(es el bloqueo conocido de idea-155). El candado de tarima lo hace improbable —cada uno marca líneas
distintas— pero no imposible: un flush es el Set entero. Assist va en su propia fase (P4) y empieza
por eso.

### Tarima de niño y las grandes que van debajo

La de niño es la última (ROW 42). Si el motor le pone grandes debajo (regla del 5 oct, #881828:
`03-3928BL` ROW 42 y `03-3936MN` ROW 43), en el viaje **salen primero** las grandes —van abajo— y
después las de niño; es el orden que ya da `planPallets` (las grandes de la tarima y luego
`kidsItems`). Si el picker sube esas grandes a la tarima anterior antes de cerrarla, son de esa
(marcarlas en el viaje de la 1 las pone en la 1). Varias de niño (`split` > 1): un viaje cada una.

## 5) Modos y herramientas

| Estado                      | Qué se ve                                          | Lenguaje visual                                 |
| --------------------------- | -------------------------------------------------- | ----------------------------------------------- |
| Tarima **en curso**         | Sus líneas; cabecera `PALLET 2/3 · 4 / 9 📷`       | Borde **sólido** del color de la app            |
| Tarima **futura**           | Una línea `PALLET 3/3 · 9`; desplegada, sus líneas | Borde **punteado** (plan)                       |
| Tarima **cerrada**          | Una línea `PALLET 1/3 ✓ 10 · 📷 2`                 | **Verde sólido**; `📷 ?` ámbar si no tiene foto |
| **Barra de foto**           | `📷 PALLET 1` + `› 2`                              | Ámbar, pulsa; crece                             |
| **Pregunta sin marcar**     | `4 UNCHECKED` + líneas; `→ P2 · 4` / `Keep on P1`  | Hoja; principal sólido, `Keep` gris             |
| Tarima **de otro** (Assist) | Una línea `PALLET 1/2 🔒 Roman · 6 / 10`           | Gris con candado; sin marcar                    |
| Después de Ready to DC      | Todas abiertas como hoy, fotos bajo cada cabecera  | Sin viaje                                       |

**Cómo insiste la barra** (default, ❓ 1): aparece a la altura del pie (**56 px**), a los **8 s**
sin tocarla crece a **88 px**, a los **16 s** a **128 px** (tope; en el teléfono apaisado, 430 px de
alto, es el 30 %) con la cifra y el icono más grandes; cada salto, un meneo corto. Sigue pulsando sin
crecer más. **Sin sonido y sin vibración** (no es una alarma). Deja de insistir sólo con la foto,
con `› 2` o con Ready to DC. Nunca tapa la tarima en curso: empuja la lista hacia arriba.

**Botones:** uno (la barra) y su salida (`› 2`). La salida se justifica en una frase: «no
obligatorio» necesita un camino que no sea esperar, y uno implícito (marcar una línea de la
siguiente) dependería del orden de los toques en la fila frontera (caso 3, §9).

## 6) Datos

### Reutilizado, sin tocar

- `planPallets` (manda lo armado a mano, reparte el resto), `applyPalletSelection` /
  `pallet_dims[].items` (cerrar = la misma escritura que el lápiz), `palletTimeline` y su
  `fixedPallets` (ya convierte unidades con tarima en `items`).
- `CameraCaptureSheet` (dispara y añade), `uploadPalletPhotoFile` + `append_pallet_photo` (la foto
  sigue yendo a `shipments.pallet_photos`, que leen Ship, el resumen y el PDF).
- `runDcvShadow`, `frontRead`, `frontApply`, `pallet_fronts`.
- `recordPalletEvents` y su cola sin señal (`pickd.pallet_events_queue`).
- `verified_item_keys` y la barra de avance: **sin cambios** (siguen sin hora y por grupo).

### Nuevo (aditivo)

- **`pallet_events.pallet` en las marcas de picker** — la tarima del viaje. La columna existe; hoy
  va vacía en toda marca. `cart_pallet` sigue siendo la del plan: la diferencia entre las dos es
  `from P2`.
- **`pallet_events.kind`**: cuatro valores más en el `CHECK` (migración aditiva):
  - `photo` — `pallet`, `phase`, `taken_at` (cámara), `payload: { photo_id, url }`. **Es la tarima
    de la foto.** La foto con su tarima = el último `photo` de esa URL; el orden = `taken_at`.
  - `photo_removed` — `payload: { photo_id }` (al borrar la miniatura).
  - `trip` — `payload: { from, to, via: 'photo' | 'skip' | 'open' | 'assist' }`, con `user_id`. El
    viaje en curso de **cada usuario** es el `to` de su último `trip`; sin ninguno, la primera
    tarima libre. Sirve también para las cifras de §2.
  - `release` — `payload: { pallet, via: 'park' | 'ready' }` (la X y Ready to DC). La inactividad
    **no se escribe**: se lee (última marca, foto o respuesta del dueño en esa tarima + 10 min).
- **`answer` con `q: 'unchecked'`** (el `kind` ya existe): la respuesta a la pregunta de las bicis
  sin marcar.
- **El candado vive en `pallet_events`, no en `pallet_dims`.** `pallet_dims` son hechos del piso que
  lee el motor y se reescriben como jsonb entero (dos teléfonos a la vez se pisarían); quién tiene
  una tarima es presencia, y su historia sirve para las cifras. **Tomar es atómico:** RPC nueva
  `claim_pallet(p_list_id, p_pallet)` — bloquea la fila del envío (`FOR UPDATE`), mira el último
  `trip`/`release` de esa tarima y la actividad del dueño, y o inserta el `trip` y devuelve
  `{ ok: true }`, o devuelve `{ ok: false, holder, next_free }`. El cliente nunca decide solo que
  una tarima está libre.
- **`pallet_fronts.front_case = 'trip'`** — frente de una foto con tarima dada: no hay caso A–D (el `CHECK` hoy sólo admite A–D: se amplía).
- **Nada nuevo en `shipments`**: `pallet_photos` sigue siendo un arreglo de URLs.

### La regla del motor que hace falta (una)

**Lo marcado en la tarima en curso no se mueve** cuando el plan cambia a mitad de viaje (Edit
Order, re-dirección, cifra). `planPallets` recibe las marcas del viaje como `items` de su ordinal
**en memoria** (no se escriben hasta cerrar) y llena el resto de esa tarima con el reparto normal.
Sin esto, un re-plan cambia el prefijo de la llave (`1-sku-loc` → `2-sku-loc`) y la marca «se
pierde» en pantalla.

## 7) Pantalla

### a) Carrito con la tarima en curso (430 px)

```
┌──────────────────────────────────────────────┐
│ ✕  #881790                         ⋯          │
├──────────────────────────────────────────────┤
│ ┌ PALLET 1/2 ──────────── 6 / 9 ── 📷 ┐       │  sólido = en curso
│ │ ✓ 03-4664BR  ×3          ROW 9      │       │
│ │ ✓ 03-4806BK  ×2          ROW 7      │       │
│ │ ○ 03-4667BR  ×3          ROW 5      │       │
│ │ ○ 03-4811RD  ×1  +1 P2   ROW 4      │       │  fila frontera
│ └─────────────────────────────────────┘       │
│ ┌ PALLET 2/2 · 8 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ▾ ┐      │  punteado = plan
│                                               │
├──────────────────────────────────────────────┤
│ [ ✓ All ]          [ ✓ Complete Now ]         │  pie de hoy
└──────────────────────────────────────────────┘
```

### b) Tarima completa: la barra insiste (0 s → 8 s → 16 s)

```
 0 s                         8 s                         16 s (tope)
┌────────────────────────┐  ┌────────────────────────┐  ┌────────────────────────┐
│ PALLET 1/2 ✓ 9 / 9     │  │ PALLET 1/2 ✓ 9 / 9     │  │ PALLET 1/2 ✓ 9 / 9     │
│ ✓ ✓ ✓ ✓                │  │ ✓ ✓ ✓ ✓                │  │ ┌────────────────────┐ │
│ PALLET 2/2 · 8 ─ ─ ▾   │  │ ┌────────────────────┐ │  │ │                    │ │
│┌──────────────────┐┌─┐ │  │ │   📷  PALLET 1     │ │  │ │    📷              │ │
││ 📷 PALLET 1      ││›2│ │  │ │                    │ │  │ │    PALLET 1        │ │
│└──────────────────┘└─┘ │  │ └────────────────────┘ │  │ │                 ›2 │ │
│[ Clear ][ Ready to DC ]│  │                     ›2 │  │ └────────────────────┘ │
└────────────────────────┘  └────────────────────────┘  └────────────────────────┘
   56 px, pulsa              88 px, meneo                128 px, meneo, pulsa
```

(En una orden de 2+ tarimas el pie de la tarima 1 es el de «parcial» —`All` / `Complete Now`—;
**Ready to DC** sólo aparece con todo marcado, como hoy.)

### c) Cámara cerrada con 2 fotos → se abre la siguiente

```
┌──────────────────────────────────────────────┐
│ ┏ PALLET 1/2 ✓ 9 · 📷 2 ━━━━━━━━━━━━━━━━ ▸ ┓ │  verde sólido, plegada
│ ┌ PALLET 2/2 ──────────── 0 / 8 ── 📷 ┐       │  se abre sola, scroll aquí
│ │ ○ 03-4811RD  ×1          ROW 4      │       │
│ │ ○ 03-4809RD  ×2          ROW 3      │       │
│ │ ○ 03-4666BR  ×3          ROW 3      │       │
│ │ ○ 03-3769BL  ×2          ROW 41     │       │
│ └─────────────────────────────────────┘       │
└──────────────────────────────────────────────┘
 Sin foto (› 2):  ┏ PALLET 1/2 ✓ 9 · 📷 ? ┓   ← ? ámbar; tocarlo = cámara de la 1
```

### d) Double Check (quien verifica) con fotos por tarima

```
┌──────────────────────────────────────────────┐
│ ─── PALLET 1/2 ──── 0 / 9 ✎ ───               │
│ [img][img]                                    │  fotos del picker, 64 px
│   03-4664BR ×3 · ROW 9 …                      │
│ ─── PALLET 2/2 ──── 0 / 8 ✎ ───               │
│ [📷 ?]                                         │  ámbar: sin foto, tocar = esta
│   03-4811RD ×1 · ROW 4 …                      │
├──────────────────────────────────────────────┤
│ [ All ]        [ SLIDE TO COMPLETE  ››› ]     │  hay foto: directo
└──────────────────────────────────────────────┘
```

### e) Bicis sin marcar al tocar la foto (hoja, 430 px)

```
┌──────────────────────────────────────────────┐
│ PALLET 1/2                                    │
│ 4 UNCHECKED                                   │  bicis, grande
│  03-4667BR  ×3            ROW 5               │
│  03-4811RD  ×1            ROW 4   LOW STOCK   │  chip ámbar del problema
│                                               │
│ ┌──────────────────────────────────────────┐ │
│ │              →  P2 · 4                    │ │  principal: salen, destino del motor
│ └──────────────────────────────────────────┘ │
│ [            Keep on P1                    ] │  gris: se quedan, el viaje no avanza
└──────────────────────────────────────────────┘
 Última tarima:   [  Keep on P2  ]  principal
                  [  + P3 · 2    ]  gris: tarima nueva
 Hacia una tomada (Assist):  →  P2 · Ana · 4
```

### f) El segundo picker (Assist)

```
┌──────────────────────────────────────────────┐
│ ✕  #881828                         ⋯          │
├──────────────────────────────────────────────┤
│ ┌ PALLET 1/2 🔒 Roman ─── 6 / 10 ─ ─ ─ ─ ▾ ┐ │  gris, candado: mirar sí, marcar no
│ ┌ PALLET 2/2 ──────────── 0 / 9 ── 📷 ┐       │  la suya, sólida
│ │ ○ 03-3928BL  ×1          ROW 42     │       │  grandes primero (abajo)
│ │ ○ 03-3936MN  ×1          ROW 43     │       │
│ │ ○ 07-3689WH  ×1          ROW 42     │       │
│ │ …                                   │       │
│ └─────────────────────────────────────┘       │
└──────────────────────────────────────────────┘
 Al abrir la orden en vista:  [ Take Over ]  [ Assist · P2 ]
 Suelta por inactividad (10 min): PALLET 1/2 · 6 / 10   (sin candado, cualquiera la sigue)
```

**Teléfono:** a 430 px de ancho la barra ocupa el ancho del pie; en apaisado (430 de alto) el tope
de 128 px deja visibles la cabecera de la tarima y dos líneas. El `›2` nunca baja de 44 × 44 px.
**1400 px:** el carrito es el mismo panel; la barra crece igual dentro de él, nada más.

## 8) Fases

**P1 — El viaje y la foto (lo pedido).** Para todos, sin flag («no quiero complicar… para todos»).

- `DoubleCheckView`: tarima en curso / futura / cerrada, plegado, `+1 P2`, `from P2`, `📷` de la
  cabecera, barra que crece, `› n`.
- `PickingCartDrawer`: marcas con `pallet` = viaje; eventos `photo`, `trip`; al abrir la siguiente,
  `fixedPallets` del viaje → `applyPalletSelection` (sólo si hay siguiente: la última y la única no
  se fijan, son «el resto»).
- `planPallets`: lo marcado en el viaje, fijo en memoria (§6).
- Quien verifica: fotos bajo cada tarima, `📷 ?` por tarima.
- **Checkpoint:** capturas a 430 y 1400 de los cuatro estados de §7 sobre una copia local de
  #881790 y de #881828; las filas de `pallet_events` de una orden real de 2 tarimas.

**P2 — La sombra con la tarima dada.**

- La foto con tarima entra a `frontApply` con su tarima (`front_case = 'trip'`): sin `PALLET ?` y sin
  ✓ / ✗ por lo marcado que no se ve (la marca del viaje ya es el hecho; ver no es quitar).
- Una lectura que termina con la orden cerrada no se tira: `dcv_shadow_runs` ya guarda las cajas, y
  al abrir la orden se aplican los frentes con tarima pendientes.
- **Checkpoint:** de las fotos de picker de una semana, cuántas son frente y cuántas `from P n`.

La pregunta de las bicis sin marcar (§4) va en **P1**: es parte de cerrar una tarima.

**P3 — Ship y el resumen enseñan la tarima de cada foto.**

- `PalletPhotoRail` y el Picking Summary con `P1` / `P2` sobre cada miniatura; el PDF diario igual.
- **Checkpoint:** captura de Ship de un envío de 3 tarimas.

**P4 — Dos pickers en la misma orden (Assist, idea-155).**

- Primero, lo que idea-155 ya tenía abierto: dos teléfonos escribiendo `verified_item_keys` del
  grupo (§4, «lo que no cierra»).
- `claim_pallet` (RPC), `trip` por usuario, `release`, vencimiento por inactividad; `Assist · P n`
  en el aviso de vista; candado en la tarima del otro; `→ P2 · Ana` en la pregunta.
- **Checkpoint:** dos teléfonos sobre una copia local de #881828, uno en cada tarima; capturas a 430
  de los dos; las filas `trip` / `release` de cada uno.

## 9) Casos de verificación

1. **Dos tarimas, la frontera en ROW 4 (P1).** #881790, 17 bicis. Tarima 1: `03-4664BR ×3` ROW 9,
   `03-4806BK ×2` ROW 7, `03-4667BR ×3` ROW 5, `03-4811RD ×1` ROW 4 (9). Tarima 2: `03-4811RD ×1`
   ROW 4, `03-4809RD ×2` y `03-4666BR ×3` ROW 3, `03-3769BL ×2` ROW 41 (8). La línea de ROW 4 de la
   1 dice `×1 · +1 P2`. Al marcar la cuarta: barra a 56 px; 88 a los 8 s; 128 a los 16 s. **Log:**
   4 `check` `phase=pick` con `pallet=1` (y `cart_pallet=1`); tras la foto, 1 `photo` (`pallet=1`,
   `taken_at`), 1 `trip {from:1,to:2,via:'photo'}`; `pallet_dims[0].items` = esas 4 líneas, 9
   unidades. La tarima 2 abierta, 0 / 8.
2. **Sin foto.** Igual que 1, pero `› 2`. **Log:** `trip {via:'skip'}`, sin `photo`; la 1 plegada
   con `📷 ?`. Tocarlo y sacar una foto deja `photo pallet=1` **y el viaje sigue en la 2** (ningún
   `trip` nuevo).
3. **Las dos de ROW 4 en la tarima 1.** En el viaje de la 1, el picker despliega la 2 y marca su
   `03-4811RD` antes o después de marcar la de la 1: en los dos órdenes acaba **×2 en la 1** con
   `from P2` (el `› 2` explícito es lo que hace que el orden de los toques no importe). **Log:** ese
   `check` con `pallet=1`, `cart_pallet=2`. Al cerrar: 1 = 10 unidades, 2 = 7.
4. **La de niño y las grandes debajo (P1).** #881828 (19 bicis) con la regla del 5 oct: tarima 1 =
   8 líneas, 10 bicis, ROW 28 → ROW 1; tarima 2 = `03-3928BL` ROW 42 y `03-3936MN` ROW 43
   **primero**, luego las 7 `07-37xx` de ROW 42. Al cerrar la 1 (en el piso fue 15:37:44) sale la
   barra; con la foto, la tarima 2 se abre con las grandes arriba de la lista. **Medido:** la foto
   que encontró `03-4547MN ×2` se tomó a 16:01:11; con el viaje se habría tomado ~15:38, con el
   picker a una fila de ROW 2–3.
5. **Select all en el viaje.** En #881828, `All` en la tarima 1 marca sus 8 líneas (`payload.bulk`,
   `pallet=1`) y la completa; **no** toca la 2. Hoy marcó 17 de las dos tarimas a la vez.
6. **Combinada (P1).** #881798 + #881807 (envío `c8c5aa41`, 22 bicis, 3 tarimas): un carrito, tres
   viajes; `03-4536BL` ROW 28 es de #881807 y su `check` lleva ese `list_id` con `pallet=1`. Las
   tres fotos van a `shipments.pallet_photos` de `c8c5aa41` (+3); 3 eventos `photo` con `pallet`
   1, 2, 3. `03-4537GY ×2` ROW 2 (partida P2/P3) dice `×1 · +1 P3` en la 2.
7. **Edit Order con la 1 cerrada.** #881790, en el viaje de la 2: Add `03-4806BK ×1` ROW 7. La
   tarima 1 **sigue en 9** (fija); la línea nueva aparece sin marcar en la 2 (9). Sin la fijación
   el motor la pondría en la 1 (ROW 7 es de su tramo): ése es el error que el caso prueba.
8. **Re-dirección en vivo.** En el viaje de la 2 de #881790, alguien mueve `03-3769BL` de ROW 41 a
   ROW 12: la línea, sin marcar, cambia a ROW 12 en la tarima 2 a los ~800 ms. Una línea ya marcada
   del viaje no cambia ni de ROW ni de tarima.
9. **Cifra en Double Check.** Tras Ready to DC de #881790, quien verifica toca la cifra de la 1
   (fija): abre el lápiz; quitar `03-4811RD` la pasa a la 2 (10). **Log:** 1 `edit` `pallet=1`,
   `field=items` con `from`/`to`.
10. **Una sola tarima.** Una orden de 4 bicis: al marcar la cuarta, la barra encima de Ready to DC;
    foto → no hay siguiente, queda Ready to DC; `pallet_dims` sin `items` (la única no se fija).
    Quien verifica ve **Slide to Complete** directo.
11. **Park y otro teléfono.** Con la 1 cerrada, X; otro picker abre la orden: está en la 2 (sale
    del último `trip`), la 1 plegada verde.
12. **Sombra con tarima dada (P2).** Una foto de la tarima 2 que ve `03-4811RD` marcado en la 1:
    `front_case='trip'`, `pallet_inferred=2`, la línea pasa a la 2 con `from P1` (la foto manda). Lo
    marcado en la 2 que no se ve se queda, sin ✓ / ✗.
13. **Bicis sin marcar → la siguiente (P1).** #881790, viaje de la 1: marcadas `03-4664BR ×3`,
    `03-4806BK ×2`, `03-4811RD ×1`; sin marcar `03-4667BR ×3` ROW 5. Toca `📷` de la cabecera → hoja
    `3 UNCHECKED` (una línea), botón `→ P2 · 3`. Lo toca → cámara → foto → se abre la 2. **Log:**
    `answer {q:'unchecked', choice:'next', units:3}`; `edit pallet=1 field=items` con 3 líneas, **6**
    unidades; `photo pallet=1`; `trip {from:1,to:2,via:'photo'}`. La 2 queda en **11** (0 / 11) con
    `03-4667BR ×3` dentro.
14. **Keep (P1).** Igual que 13, pero `Keep on P1`: foto con `pallet=1`, **ningún** `trip` ni
    `edit`; la 1 sigue en curso, 6 / 9, con su barra si después se completa.
15. **Con problema de stock (P1).** #881790, `03-4811RD` de la 1 con `LOW STOCK` y todo lo demás
    marcado: la 1 cuenta como completa, salta la barra; al tocarla, hoja `1 UNCHECKED` con el chip
    `LOW STOCK`. `→ P2 · 1` → en la 2 `03-4811RD` pasa a ×2, con su `StockIssuePanel`; la 1 se cierra con
    8 unidades.
16. **La última (P1).** #881790, viaje de la 2 con `03-3769BL ×2` ROW 41 sin marcar: botones
    `Keep on P2` / `+ P3 · 2`. `+ P3` → `pallet_dims[1].items` con 6 unidades y una tarima 3 de 2;
    Ship pasa de PALLETS **2** a **3**. **Log:** `answer {choice:'new', units:2}` + el `edit`.
17. **Assist: el candado (P4).** #881828. Roman abre a las t0 y toma la 1 (`trip {to:1,via:'open'}`).
    Ana abre a t0 + 2 min: vista con `Assist · P2`; lo toca → `claim_pallet(…, 2)` → `{ok:true}`,
    `trip {to:2,via:'assist'}` con su `user_id`. Ana despliega la 1: `🔒 Roman · 6 / 10`, tocar una
    línea no marca. Los dos tocan Assist sobre la 2 en el mismo segundo: uno recibe `ok:true` y el
    otro `{ok:false, holder:'Ana', next_free:null}` y se queda en vista.
18. **Assist: inactividad (P4).** Roman deja de tocar la 1 con 6 / 10. A los 10 min de su última
    marca la 1 sale sin candado; Ana, al cerrar la 2, toma la 1 (primera libre) y sigue en 6 / 10.
    **Log:** ningún `release` (el vencimiento se lee), un `trip {from:2,to:1}` de Ana.
19. **Assist: la frontera (P4).** #881790 con Roman en la 1 y Ana en la 2: cada uno marca su
    `03-4811RD ×1` en ROW 4; Roman no puede subir la de la 2 (tomada). Su hoja de sin marcar, si
    deja `03-4667BR ×3`, dice `→ P2 · Ana · 3`; a Ana le aparece sin marcar con `from P1`.

## 10) ❓ Preguntas

1. ❓ **¿Cuánto insiste la barra?** _Default:_ 56 → 88 → 128 px a los 0, 8 y 16 s, pulsando y con un
   meneo en cada salto; sin sonido ni vibración; tope 128 px; deja de insistir con la foto, `›` o
   Ready to DC.
2. ❓ **¿Cómo se pasa sin foto?** _Default:_ `› 2` chico al lado de la barra; la tarima queda con
   `📷 ?` ámbar para fotografiarla después; Ready to DC nunca se bloquea.
3. ❓ **¿Se puede subir una bici de otra tarima a la en curso?** _Default:_ sí, desplegando la otra y
   marcando su línea; pasa a la en curso con `from P2`, sin confirmar.
4. ❓ **¿Una tarima cerrada queda fija?** _Default:_ sí, al abrir la siguiente se guarda lo marcado
   como armada a mano (lo que Edit Order añada no cae en ella); la última y la única no se fijan.
5. ❓ **¿`All` / `Complete Now` en el viaje?** _Default:_ sólo marcan la tarima en curso (y la
   completan: salta la barra).
6. ❓ **¿Grupos FedEx también?** _Default:_ sí, el mismo viaje y la misma barra para todos.
7. ❓ **Bicis sin marcar al tomar la foto: ¿qué opciones?** _Default:_ dos — `→ P n` (principal; el
   destino lo da el motor, no se elige; puede ser la tarima de otro picker y lo dice) y `Keep on P n`
   (se quedan, el viaje no avanza). Las de problema de stock van con las demás, con su chip.
8. ❓ **En la última tarima, ¿qué es lo principal?** _Default:_ `Keep on P n`; `+ P n+1` (tarima
   nueva, cambia PALLETS en Ship) es el gris.
9. ❓ **Assist: ¿cuándo vence una tarima tomada sin actividad?** _Default:_ 10 min sin marca, foto ni
   respuesta del dueño en esa tarima (el hueco más largo medido en #881828: 3 min 47 s); lo marcado
   se conserva y cualquiera la continúa.

## 11) Riesgos

- **No es obligatoria, así que puede no tomarse.** La barra insiste y quien verifica tiene `📷 ?`
  por tarima; la cifra «tarimas con foto del picker» lo dice a la semana. Si queda bajo el 50 %, se
  reabre la ❓ 1, nunca para hacerla obligatoria sin su ok.
- **Marcar no es subir.** Si el picker marca antes de subir (o marca por marcar), el viaje miente
  igual que hoy. La foto de la tarima es la defensa: es más nueva y, para lo que ve, manda.
- **El lector lee ~la mitad.** La foto no prueba el contenido; el viaje sí. Por eso lo no visto se
  queda en su tarima (P2), y lo leído de otra sólo se muda con lectura exacta.
- **Re-plan a mitad de viaje.** Sin la regla de §6 una marca puede «saltar» de tarima en pantalla.
  Test: el caso 7 y el 8 con marcas puestas.
- **Dos pickers: el candado protege la tarima, no el guardado de las marcas.** `claim_pallet` hace
  imposible tomar la misma tarima; pero `verified_item_keys` sigue siendo un Set del grupo que cada
  teléfono escribe entero, y dos flush a la vez pueden pisarse. Por eso P4 empieza por eso.
- **Un picker que se va sin la X** deja su tarima con candado 10 min. Es el precio de no robar una
  tarima a quien sólo está lejos de la pantalla; la cifra se revisa con los primeros días de Assist.
- **`→ P n` manda bicis a donde diga el motor.** Con 3+ tarimas puede repartirlas en dos (`→ P2 ·
P3`); el botón lo dice antes de tocarlo, y el lápiz lo cambia después.
- **Foto sin señal.** El evento `photo` espera en la cola, pero la subida a R2 falla como hoy; la
  miniatura queda con spinner y quien verifica ve `📷 ?`. No se pierde la tarima de la foto: el
  evento lleva el `photo_id`.
- **La fila frontera sigue partida en el plan.** El viaje no la evita: la nombra (`+1 P2`) y
  deja subirla entera (caso 3).

## 12) Lo que cambia (sin implementar)

**Código**

- `src/features/picking/components/DoubleCheckView.tsx` — estados de tarima en curso / futura /
  cerrada, `+1 P n`, `from P n`, barra de foto (componente nuevo `PalletPhotoNudge.tsx` en
  `components/`), `📷` por tarima, fotos bajo cada cabecera después de Ready to DC.
- `src/features/picking/components/PickingCartDrawer.tsx` — viaje en curso (del último `trip`),
  `pallet` en cada marca, `All` del viaje, fijar al abrir la siguiente, la pregunta de las bicis sin
  marcar antes de la cámara o de `›`; (P4) `Assist · P n` junto a Take Over y el viaje por usuario.
- `src/features/picking/components/UncheckedBikesSheet.tsx` (nuevo, por el Modal Manager) — la hoja
  `n UNCHECKED` con `→ P n` / `Keep` / `+ P n+1`; el destino sale de `planPallets` con lo marcado
  fijo.
- `src/features/picking/utils/palletEvents.ts` + `api/palletEvents.ts` — `photo`,
  `photo_removed`, `trip`, `release`, `answer {q:'unchecked'}`; `pallet` en las marcas.
- `src/features/picking/pallets/tripState.ts` (nuevo, puro, con tests) — de los eventos al viaje:
  en curso **por usuario**, cerradas, tomadas (con dueño y vencimiento), foto de cada tarima.
- `src/features/picking/api/claimPallet.ts` (nuevo, P4) — llama a `claim_pallet`.
- `src/features/picking/pallets/planPallets.ts` — opción con lo marcado del viaje fijo en memoria.
- `src/features/picking/pallets/frontApply.ts` — tarima dada (`'trip'`) (P2).
- `src/components/ui/CameraCaptureSheet.tsx` — un título opcional (`PALLET 1`) y saber cuántas
  fotos se tomaron al cerrar.
- `src/components/orders/PalletPhotoRail.tsx` — `P n` sobre cada foto (P3).

**Datos** (aditivo)

- Migración: `pallet_events_kind_check` + `photo`, `photo_removed`, `trip`, `release`.
- RPC nueva `claim_pallet(p_list_id, p_pallet)` (P4): `FOR UPDATE` sobre el envío, inserta el
  `trip` o devuelve `{ ok: false, holder, next_free }`.
- `pallet_events.pallet` empieza a llenarse en las marcas de picker (columna existente).
- `pallet_fronts_front_case_check` + `trip` (hoy sólo admite A–D).
- Ninguna columna ni tabla nueva; `shipments.pallet_photos` sin cambios.
