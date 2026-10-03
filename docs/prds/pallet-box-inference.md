# PRD: El armado real de cada tarima, leído del frente

**Estado:** estudio, esperando «ok» · **Fecha:** 2026-10-02 · **Autor:** Rafael + PickD
· **Continúa:** `ship-pallet-truth.md` (un motor de tarimas), `docs/label-recognition/10-sombra-en-dcv.md`
(la sombra del lector) · **Relacionado:** `src/utils/palletLayout.ts`,
`src/features/picking/pallets/planPallets.ts`, `src/components/orders/pallet3d/`

Lo que sigue está comprobado en el código del 2 oct 2026 o medido en prod (`PROD_DB_URL`).

---

## 1) Contexto y problema

Rafael, 1 oct 2026: inferir **la posición de cada caja en una tarima** a partir de una o varias
fotos —qué etiquetas hay, en qué orden horizontal, en qué nivel— para que el motor que dibuja las
tarimas virtuales deje de adivinar y aprenda del piso.

**Lo que hay hoy:**

- **El motor** (`layoutPallet` / `placeBoxes`, `src/utils/palletLayout.ts`) arma una tarima con
  gravedad (skyline en el corte ancho × alto), frente parejo, ≤ 46" de ancho, ≤ 2 acostadas, ≤ 90".
  Lo usan Double Check, Ship, el carrito y el Picking Summary vía `planPallets`. Ship lo enseña en
  3D (`How to stack ▾`, `pallet3d/scene.ts`), con la etiqueta real de cada SKU (`order_label_reads`,
  `pallet3d/labelAtlas.ts`).
- **Una regla del motor contradice al piso.** Una caja de pie con el centro fuera de su apoyo se
  **ladea hasta 7°** y eso suma alto (`drop()`, `MAX_TILT_RAD`, líneas 79 y 138–165). Rafael, 1 oct:
  las cajas de pie **no se ladean** — van apretadas unas contra otras con el strap negro. El error
  medio de alto contra las 19 tarimas medidas (3,0", commit `e219a4c9`) se midió **con** el ladeo.
- **La sombra ya ve las etiquetas.** Cada foto de pallet de Double Check se lee en un Worker y deja
  una fila en `dcv_shadow_runs` con `boxes[]`: SKU resuelto y, desde el 30 sep, las **4 esquinas**
  de cada etiqueta en píxeles del original (`20260930124634`). El picker no ve nada.
- **Lo que el picker arma a mano ya tiene hogar:** `shipments.pallet_dims[].items` (el lápiz de
  Ship y «+ Add pallet» de Double Check, `PalletBuilderModal`, `applyPalletSelection` en
  `pallets/palletUnits.ts`). `planPallets` la aparta primero. Lo que no tiene hogar es **el orden
  dentro de la tarima**.

**Medido (5 días al 1 oct):** 28 envíos, 98 fotos de sombra: 3,5 fotos por envío, 3,5 cajas leídas
por foto, 2,1 con esquinas. **Sólo 32 de 98 fotos tienen ≥ 4 etiquetas ubicadas**: hoy son
acercamientos para leer, no frentes. **Ninguna foto dice de qué tarima es.**

**El número de tarima del carrito no es la tarima del piso.** Envío `318b00fb` (#881761 + #881774,
29 sep): las llaves del carrito ponen `03-4618GN` en la tarima 1 y `03-4085BK`, `03-4611BK` en la 3;
la tarima 4 que el picker armó a mano (`pallet_dims[3].items`) lleva las tres. El prefijo
`pallet-` de `verified_item_keys` es el plan, no el hecho.

**Así que ninguna señal es ley para todos los casos** (Rafael, 2 oct 2026: «sería según casos, no
como ley para todo»). El orden de recogida acierta cuando el picker arma una tarima tras otra y
falla cuando arma a mano o con dos tarimas a la vez, que es justo lo que pasó en `318b00fb`. La
inferencia no tiene una señal ganadora fija: **manda el hecho más reciente sobre cada caja**
(Rafael, 2 oct 2026: «debe haber un orden de tiempo»), cada caja dice qué la puso y cuándo (§6.3), y
cuando la foto no sabe de qué tarima es, pregunta. Los casos que eso abre están en §6.6.

**Y hoy no se guarda cuándo se marcó nada.** `verified_item_keys` es un Set guardado como arreglo:
sin hora, fusionado entre dispositivos (pierde el orden), y **Ready to DC lo vacía**. Las 31 llaves
de #881774 salen ordenadas por tarima y por ruta — el orden del plan, no el de las manos.

## 2) Objetivo

Que lo que dibuja PickD de una tarima sea **lo que se armó**, y que lo que se armó sirva de vara
para el motor.

**Métrica:**

- **Alto:** error medio |motor − cinta| sobre las tarimas medidas: hoy 3,0"; sin ladeo, medido en
  F0; tras calibrar (F2), **≤ 2,0"**.
- **Armado:** en las tarimas confirmadas, la proporción de cajas que el motor pone en **el mismo
  nivel** que el piso, y de pares vecinos en **el mismo orden**. Se mide desde la primera confirmada;
  el objetivo se fija con 30 tarimas delante (F2).
- **Inferencia:** de las propuestas que el picker confirma, **≥ 90 %** de las cajas con la tarima
  correcta sin que él toque nada.

## 3) Conceptos

- **Marca** — un evento: _esta línea, en esta tarima del carrito, la marcó (o desmarcó) esta
  persona, en este dispositivo, a esta hora_. Se agrega, nunca se reescribe. Es lo que
  `verified_item_keys` no recuerda.
- **Frente** — la foto de la cara de las puntas de una tarima ya armada: la cara pareja donde van
  las etiquetas (`placeBoxes`, `+z`). Una foto **es un frente** cuando la sombra ubica en ella
  **≥ 4 etiquetas con esquinas**; si no, es un acercamiento y sólo sirve para leer.
- **Armado** (`stack`) — la lista ordenada de las cajas de una tarima: nivel (de abajo arriba),
  posición en el nivel (de izquierda a derecha, mirando el frente), de pie o acostada. **Propuesto**
  (lo infirió PickD) o **confirmado** (lo dijo el picker); sólo el confirmado es verdad.

## 4) El gesto

### En Double Check (el picker)

1. **Marca líneas como hoy.** Nada cambia en pantalla; cada marca y desmarca se anota con su hora
   (F0).
2. **Arma la tarima y le saca una foto al frente**, con la misma cámara de siempre. Encima de las
   fotos, una cifra: **`FRONTS 1/4`** (frentes vistos / tarimas del envío), ámbar mientras falte
   alguno. No hay botón nuevo.
3. **La sombra lee la foto** (~2–4 s, en su Worker). Con el resultado:
   - **< 4 etiquetas con esquinas** → acercamiento. No se propone nada. Fin.
   - **≥ 4** → es un frente. PickD decide **de qué tarima** es (§6.3.5) cruzando lo leído con lo vigente
     en cada tarima; si no lo sabe, `PALLET ?`. Lo que la foto ve pisa lo anterior, y lo actualiza
     todo (§6.5), porque es más nuevo.
4. **La propuesta aparece bajo esa tarima** como lista, en el orden inferido: nivel 1 de izquierda
   a derecha, luego el 2… Cada fila: posición · SKU · `▮` de pie / `▬` acostada. Borde punteado
   (propuesta).
5. **Las ramas de cada caja:**
   - **Leída y es de esta tarima** → fila normal.
   - **Marcada para esta tarima y no leída** (tapada por el strap, por otra caja, o con la etiqueta
     en la otra punta) → al final, en ámbar: `03-4618GN  ?`. Dos toques: **✓** está (va sin
     posición: el motor la acomoda en el hueco) · **✗** no está (vuelve al reparto, como desmarcarla
     en `PalletBuilderModal`).
   - **Leída pero el plan la tiene en otra tarima** → fila normal con `from #3`: la foto manda,
     igual que traer una caja de otra tarima en el modal.
   - **Leída y no es de la orden** (una caja de otro envío al fondo de la foto) → no entra; una
     línea gris `NOT IN ORDER 1`, nunca se esconde.
6. **Un botón: `CONFIRM`.** Guarda la tarima como armada a mano (`items`, lo mismo que guarda el
   modal) y su armado (`stack`). El borde pasa a sólido verde.
7. **¿La tarima equivocada?** El encabezado de la propuesta lleva el chip de la tarima
   (`PALLET 2`); tocarlo deja elegir otra. **¿Sobra o falta una caja?** El lápiz de siempre abre
   `PalletBuilderModal`. No se inventa otro editor.
8. **Otro frente de la misma tarima** (dos fotos porque no cupo) → se unen: lo leído en ambas, sin
   duplicar la misma caja (mismo SKU en la misma posición).
9. **No confirmar no bloquea nada.** Complete funciona igual; sin confirmar, la tarima sigue siendo
   la del motor y la propuesta queda como propuesta.

Bicis de niño y e-bikes: la misma regla y el mismo aviso. (Decisión de Rafael, 1 oct.)

### En Ship (la estación) — F3

`How to stack ▾` arma en 3D **lo confirmado**: cada caja en su nivel y su orden; las aceptadas con
✓ sin posición, en el hueco que les dé la gravedad, más tenues. Sin armado confirmado, el 3D es el
de hoy.

## 5) Modos y herramientas

| Dónde        | Qué se ve                                                      | Qué no                                         |
| ------------ | -------------------------------------------------------------- | ---------------------------------------------- |
| Double Check | `FRONTS n/N`; la propuesta por tarima como **lista**           | **3D** (Double Check no lo lleva, a propósito) |
| Ship         | el 3D del armado confirmado; «Not read · drawn» como hasta hoy | la propuesta sin confirmar                     |
| Base         | marcas, frentes, armados confirmados                           | **ningún texto leído** (guías de FedEx)        |

Lenguaje visual: propuesta = **borde punteado**, confirmado = **sólido verde** (la regla del mapa:
lo real y lo planeado se distinguen sin etiqueta). Lo que falta = ámbar `?`. Cifras, no frases.

## 6) Datos

### 6.1 Reutilizado, sin tocar

- `dcv_shadow_runs.boxes[]` (`resolved_sku`, `corners`, `bbox`) y `photo_id` — la única entrada de
  la inferencia. **El lector está congelado** (`labelLocator.ts`, hasta el lote de 120): esto sólo
  consume lo que ya guarda y no cambia la huella del motor (`engineConfig.test.ts`).
- `shipments.pallet_dims[].items` + `applyPalletSelection` + `PalletBuilderModal` — confirmar es el
  mismo guardado que el lápiz.
- `planPallets` (que ya aparta lo armado a mano), `layoutPallet`, `placeBoxes`, `pallet3d/`.
- `sku_metadata` `width_in` / `height_in` — la punta de una caja es delgado × medio (los ejes de
  PickD: longest / thinnest / middle).

### 6.2 Nuevo (aditivo)

- **`pallet_events`** (append-only, F0): la línea de tiempo del envío (§6.3.4, §6.7). `id`,
  `shipment_id`, `list_id`, `group_id`, `kind` (`check` / `uncheck` / `edit` / `answer` /
  `front` / `front_removed`), `phase` (`pick` antes de Ready to DC, `check` después), `sku`, `location`, `cart_pallet` (el número que lleva la llave),
  `pallet`, `payload` (jsonb: lo que guardó la edición — `items`, `bikes`, `split` —, o el id del
  frente), `at` (servidor), `taken_at` (sólo frentes: cámara), `user_id`, `device`. El estado
  vigente de cada tarima es **una función pura** sobre esta tabla (`palletTimeline`), con tests
  para cada fila de §6.6. Las marcas se escriben desde el mismo sitio que mueve
  `checkedItems` (`PickingCartDrawer`), **en el mismo flush con debounce** que
  `verified_item_keys`: cada evento lleva su propia hora, así que el debounce no cuesta orden.
  `verified_item_keys` se queda como está (lo leen la barra de avance, el board y el candado).
- **`pallet_fronts`** (F1): una fila por foto que es frente — `photo_id` (único), `run_id`,
  `shipment_id`, `pallet_inferred`, `observed` (jsonb: por caja `sku`, `x_in`, `y_in`, `upright`),
  `fit_rms_in` (cuánto se separan las etiquetas del plano), `status`
  (`proposed`/`confirmed`/`rejected`), `pallet_confirmed`, `confirmed_by`, `confirmed_at`. Es **la
  evidencia**: propuesta vs confirmado = cuánto acierta la inferencia.
- **`pallet_dims[].stack`** (F1, dentro del jsonb que ya existe): el armado confirmado, ordenado:
  `[{ sku, level, pos, upright, placed: 'photo'|'engine' }]`. Un hecho del envío vive en el envío;
  `pallet_fronts` no lo duplica, lo prueba.

### 6.3 La inferencia (pura, con tests, `pallets/frontRead.ts`)

1. **La cara.** Las etiquetas son de tamaño fijo y están en el plano del frente (frente parejo):
   las esquinas de **todas** las etiquetas de la foto contra su rectángulo en pulgadas dan **una**
   homografía px → pulgadas del frente (mínimos cuadrados). Una etiqueta que se aleja del plano más
   de 1" (`fit_rms_in`) se descarta como posición, no como lectura. Mismo álgebra que `warpQuad` del
   atlas.
2. **De pie o acostada:** el eje largo de la etiqueta en la cara — vertical = de pie, horizontal =
   acostada.
3. **Nivel y orden:** las alturas `y_in` se agrupan en niveles con la altura de la punta de cada
   caja (`height_in` de pie, `width_in` acostada); dentro del nivel, `x_in` da el orden.
4. **Manda el hecho más reciente sobre cada caja (Rafael, 2 oct 2026: «debe haber un orden de
   tiempo»).** No hay una señal que gane siempre: hay una **línea de tiempo** por envío y, para
   cada caja, vale lo último que alguien _vio o dijo_ de ella. Si el picker edita con el lápiz y
   después saca un frente que dice otra cosa, **la foto actualiza** la tarima, el orden y todo lo
   que cuelga de ellos (§6.5); si edita después de la foto, manda la edición.

   | Evento                                                      | Hora que cuenta                       | Qué es                      |
   | ----------------------------------------------------------- | ------------------------------------- | --------------------------- |
   | **Frente** (la foto)                                        | cuando se **tomó**, no cuando se leyó | hecho, sólo de lo que se ve |
   | **Edición** (lápiz, «+ Add pallet», bicis tecleadas, «+/–») | al guardar                            | hecho que dijo el piso      |
   | **Respuesta** (✓ / ✗, chip `PALLET n`, `CONFIRM`)           | al tocar                              | hecho que dijo el piso      |
   | **Marca / desmarca del picker** (antes de Ready to DC)      | al tocar                              | hecho del orden de carga    |
   | **Plan** (`planPallets`, prefijo del carrito)               | —                                     | nunca es un hecho           |

   Tres reglas que impiden que el tiempo haga daño:
   - **Ver no es quitar.** Un frente pone en su tarima las cajas que ve; las que no ve **no** se
     sacan de ninguna (pueden estar tapadas). Una caja sólo deja una tarima porque un hecho más
     nuevo la pone en otra, o porque alguien dice ✗.
   - **Una foto sin tarima segura no es un hecho todavía.** Si el frente cae en caso C o D (abajo),
     espera la respuesta del picker; al contestar, cuenta con la hora en que se tomó la foto. Si
     entre tanto hubo una edición más nueva de esas cajas, la edición se queda y la foto se ofrece
     como diferencia, no se aplica sola.
   - **Las aproximaciones rellenan, no pisan.** Las marcas y el plan sólo deciden cajas de las que
     nadie ha visto ni dicho nada.

   La foto se lee 2–4 s (o más, en cola) después de tomarse: si en ese hueco el picker edita, la
   edición es **más nueva** y gana. Por eso la hora del frente es la de la cámara.

5. **De qué tarima es la foto.** Antes de ser un hecho, el frente tiene que saber a qué tarima
   pertenece:
   - **Caso A — coinciden.** Los SKUs leídos caen en una sola tarima según lo vigente (hechos
     anteriores, o marcas si no hay) → la foto se aplica; chip `PALLET 2` sin color.
   - **Caso B — la foto mueve cajas.** La mayoría de lo leído está en una tarima y el resto en
     otras → es esa tarima, y las demás cajas se mudan (`from #3`). Es `318b00fb`: la tarima 4 a mano
     y `06-4572GY`, que las llaves ponen en la 3, vista en el frente de la 1.
   - **Caso C — empate entre dos tarimas** → `PALLET ?` en ámbar; el picker elige.
   - **Caso D — nada en común** con ninguna tarima del envío → `PALLET ?`; si el picker elige
     «nueva», nace una tarima (§6.6, caso 9).

   Cada fila lleva, en gris y chico, qué la puso y cuándo (`photo 14:32` · `hand 14:30` · `picked`
   · `plan`): el picker ve por qué, y F2 mide qué acierta.

6. **Lo que falta.** Marcado o puesto a mano en esta tarima y no visto en su último frente → `?`
   («se infiere que es la que falta», decisión de Rafael), **sólo si** lo vigente acertó en las
   cajas que sí se ven (≥ 3 de 4, o todas si hay menos). Si falló, `n UNSEEN` y el picker las añade
   con el lápiz.
7. **La marca es el orden de carga, y sólo la del picker (Rafael, 3 oct 2026).** «Se marca cuando
   se recoge y sube sobre la tarima»: el picker va con la tarima por el almacén siguiendo Double
   Check, a veces recoge primero de un sitio que la ruta no dice, y **lo marca primero: ese orden
   manda**. Así que el orden de las marcas es el orden en que las cajas subieron —lo primero, abajo
   y al fondo del armado—, no una aproximación. Lo que sigue siendo aproximado es **la tarima**: el
   bloque de marcas entre un frente y otro (y nunca el prefijo del carrito, §1).
   **Después de Ready to DC las marcas no significan nada**: quien hace el double check marca para
   guiarse, sin efecto más que visual. `palletTimeline` sólo lee marcas con `phase = 'pick'`; las de
   `phase = 'check'` se guardan (sirven para saber quién verificó qué) pero no mueven ninguna caja.
   **Pero el orden de carga no siempre es el armado final** (Rafael, 3 oct 2026): a veces, para que
   la tarima sea estable, después de recoger se reordena — las cajas **más grandes a los extremos**
   para que una o dos vayan **acostadas encima** sin caerse. No es la mayoría, pero pasa, y por eso
   el frente importa: es más nuevo que las marcas y, para lo que ve, manda (§6.3.4). Sin frente, el
   orden de las marcas es la mejor propuesta, no un hecho del armado.
   Antes de F1 se mide igual cuántas veces el bloque da la tarima que confirmó luego una edición o un
   frente; si saliera < 70 %, el bloque sólo desempataría la tarima (el orden dentro de ella se
   queda).

8. **Cómo se leen las marcas** (Rafael, 3 oct 2026, aceptó estos defaults; los aplica
   `palletTimeline`, F0 sólo las guarda):
   - **Una línea con varias bicis** (3× LASER) se marca con un toque: cuenta como «subieron
     juntas, en ese momento». No se pide un toque por bici.
   - **Marcar, desmarcar, volver a marcar:** vale la última marca. Una marca deshecha en
     **menos de 5 s** es un dedo equivocado y no cuenta.
   - **Clear y volver a marcar:** lo masivo (`payload.bulk`, Select all / Clear) no dice nada del
     orden; las marcas una por una que vengan después sí.
   - **Una línea marcada que cambia de SKU:** el hermano de variante (BL/BLD, el cambio automático)
     **hereda** la hora de la marca, es la misma caja; un Replace por otra bici no hereda y hay que
     volver a marcarla.
   - **Return to picker** borra lo de enviada (`sent_to_dc_at`, `sent_to_dc_by`): el picker vuelve
     a pulsar Ready to DC y sus marcas vuelven a ser `phase = 'pick'`.
   - **Ya resueltos en el código (3 oct):** el doble toque rápido se decide contra el conjunto vivo
     (antes dos toques guardaban dos marcas con la pantalla desmarcada); un toque antes de saber si
     la orden se envió espera en vez de adivinar la fase; sin señal, los eventos esperan en el
     teléfono (`pickd.pallet_events_queue`) y salen al volver con su `client_at`.
   - **Sin cambio:** el mismo SKU y estante en dos órdenes de una combinada comparte llave (un
     toque marca las dos tarjetas, como antes); una línea sin ubicación se empareja por SKU; dos
     teléfonos o una toma a mitad se ordenan por hora y cada evento dice quién; parkear y retomar
     no repite nada; el número de tarima de la llave es el plan.

### 6.5 Qué se actualiza cuando una tarima cambia

Un hecho nuevo que mueve una caja vuelve a correr **el mismo motor** (`planPallets`, una regla = un
motor) con lo vigente como `items` fijos, y desde ahí todo lo que ya deriva de él:

- `pallet_dims[].items` y `stack` de **las dos** tarimas, la que gana y la que pierde la caja.
- Las bicis tecleadas por tarima (`bikes`) de las dos: se reescriben con lo que hay. Si no, el motor
  rellenaría la que perdió la caja con otra, que es justo lo que la foto desmiente.
- `split` de niño si la caja movida es de niño.
- `pallets_qty` (una tarima que se queda vacía desaparece; un frente sin tarima la crea) y el peso
  por tarima y total: **PALLETS / WEIGHT de Ship**, lo que se teclea en Audit Source.
- La medida de cinta de una tarima cuyo contenido cambió **se conserva pero se marca vieja**
  (`measured_at` < el último hecho): la cifra gris del motor vuelve a mandar hasta que alguien mida.
- La numeración «3/5» se recalcula con la regla de siempre (físicas primero).
- El 3D de Ship (F3) y la lista de Double Check.
- **Sin alarmas ni reimpresión** (Rafael, 3 oct 2026): un cambio después de imprimir las etiquetas
  de tarima se aplica y ya; Ship enseña los números nuevos como cualquier otro cambio. Una orden ya
  **enviada** no se reescribe (es historia). Que cada etiqueta de tarima lleve su peso y medidas es
  otra idea, en el backlog como opcional.

### 6.6 Casos que pueden pasar (cada uno con su respuesta)

| #   | Qué pasa                                                                                            | Respuesta                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | Edita con el lápiz, luego foto que dice otra cosa                                                   | Gana la foto para lo que ve; se actualiza todo (§6.5). (Rafael, 2 oct.)                                         |
| 2   | Foto, luego edita                                                                                   | Gana la edición.                                                                                                |
| 3   | Edita mientras la foto se está leyendo                                                              | La edición es más nueva (hora de cámara) y gana; la foto queda como diferencia.                                 |
| 4   | Dos frentes de la misma tarima, la rearmó entre medio                                               | Gana el nuevo para lo que ve; lo del viejo que el nuevo no ve queda, con `?` si toca.                           |
| 5   | La misma caja vista en dos frentes de tarimas distintas                                             | Si la orden tiene 2 unidades, una en cada una. Si tiene 1: el frente más nuevo, y aviso ámbar.                  |
| 6   | Varias unidades del mismo SKU                                                                       | Se asignan **por cantidad**, no por identidad: la etiqueta es igual en todas.                                   |
| 7   | La foto lee un SKU que no es de la orden                                                            | `NOT IN ORDER`; nunca mueve nada.                                                                               |
| 8   | La foto lee un SKU con lectura dudosa (no exacta ni resuelta)                                       | No es un hecho: se muestra como propuesta y el picker la acepta o no.                                           |
| 9   | Un frente que no casa con ninguna tarima                                                            | `PALLET ?` con la opción «new pallet»; elegirla suma una tarima (§6.5).                                         |
| 10  | Una tarima se queda vacía por mudanzas                                                              | Desaparece y se renumera; Ship lo muestra en sus números.                                                       |
| 11  | Desmarca una línea que una foto vio                                                                 | La desmarca es más nueva: la caja sale de la tarima. Si una foto posterior la vuelve a ver, vuelve.             |
| 12  | Edit Order quita la línea o baja la cantidad después de la foto                                     | La orden manda sobre todo: la caja deja de existir y su evidencia se ignora.                                    |
| 13  | Combine / separar envío después de los frentes                                                      | Los hechos son por caja y orden, así que viajan con ella; el motor rearma lo que no tiene hecho.                |
| 14  | Se borra la foto (`remove_pallet_photo`)                                                            | Su evidencia se retira y la línea de tiempo se recalcula sin ella.                                              |
| 15  | La sombra falla o se agota con esa foto                                                             | No hay hecho; nada cambia; la foto no cuenta en `FRONTS n/N`.                                                   |
| 16  | Dos pickers en el mismo envío, uno edita y otro fotografía                                          | Mismo orden de tiempo; cada fila dice quién. Relojes distintos: §6.7.                                           |
| 17  | Foto de una tarima de **otro envío** (el pallet de al lado)                                         | Casi todo `NOT IN ORDER` → no es un frente de este envío; no cuenta.                                            |
| 18  | Cambia algo después de imprimir etiquetas o de marcar enviado                                       | Se aplica sin alarma; lo enviado no se reescribe (§6.5).                                                        |
| 19  | La tarima tenía medida de cinta y cambia su contenido                                               | Medida marcada vieja; vuelve la cifra gris.                                                                     |
| 20  | Reabrir una orden completada (Reopen) con frentes ya confirmados                                    | Los hechos se quedan; la edición de la reapertura es un hecho más, con su hora.                                 |
| 21  | Recoge en un orden y luego reordena para estabilizar (grandes a los extremos, 1–2 acostadas encima) | El frente es más nuevo que las marcas: manda el frente para lo que ve; lo que no ve conserva su lugar de carga. |

### 6.7 La hora

Hoy **ningún** evento de tarima la tiene: `pallet_dims` guarda `measured_at` (la cinta) y nada más;
`items` y `bikes` no dicen cuándo ni quién (prod, 10 días: 77 envíos, 2 con tarima armada a mano y 7
con bicis tecleadas). Así que F0 registra **también las ediciones**, no sólo las marcas. La hora es
la del servidor al recibir el evento; la foto lleva además la de la cámara (`taken_at`), que es la
que ordena, y si las dos se separan más de 2 min (reloj del teléfono mal), manda la del servidor
menos el tiempo de lectura.

### 6.8 Quitar el ladeo (F0)

`drop()` deja de girar: `tilt = 0` siempre; `MAX_TILT_RAD`, `pivot` y el `tilt` de `Placement` /
`PlacedBox` se van, y `scene.ts` deja de girar cajas. La caja cae a lo más alto bajo su ancho, como
ya hace. **Y no se suma margen por el film ni la cinta**: es de menos de un milímetro (Rafael,
3 oct 2026). Los tests de «lo ladeado suma alto» se reescriben a «de pie no se ladea». **El banco de
las tarimas medidas** pasa a ser un test versionado (`palletLayout.bench.test.ts`, alto del motor vs
la cinta por tarima, error medio impreso): hoy esa cifra vive sólo en un mensaje de commit. En prod
hay **25** tarimas con alto tecleado en `shipments` (10 con las tres medidas); el banco las lleva
todas, junto a las 19 del commit si no están entre ellas, y dice cuántas son.

## 7) Pantalla

Double Check, la sección de tarimas, a 430 px:

```
┌──────────────────────────────────────────────┐
│ PALLETS 4      FRONTS 2/4 ●        [📷]      │  ● ámbar mientras falte
├──────────────────────────────────────────────┤
│ ┌ PALLET 4 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ✎ ┐   │  punteado = propuesta
│   1·1  07-3746PU    ▮                         │
│   1·2  07-3744BL    ▮                         │
│   1·3  07-3745WH    ▮                         │
│   1·4  07-3745WH    ▮                         │
│   2·1  03-4611BK    ▮   from #3               │
│   03-4618GN   ?            [✓]  [✗]           │  ámbar
│   NOT IN ORDER 1                              │  gris
│ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ [ CONFIRM ] ─ ┘    │
│ ┏ PALLET 1 ━━━━━━━━━━━━━━━━━━━━━━━━━ ✓ ✎ ┓   │  sólido verde = confirmado
│   8 ▮ · 0 ▬                                   │  plegada: sólo la cifra
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛   │
│   PALLET 2   — no front —                     │  sin propuesta: como hoy
└──────────────────────────────────────────────┘
```

- Una tarima confirmada se pliega a una línea (`8 ▮ · 0 ▬`); tocarla la abre.
- La posición `1·3` es nivel·lugar; el SKU nunca se parte de línea (como las cifras de Ship).
- A 1400 px, la misma lista en la columna de la tarima; nada más.

## 8) Fases

**F0 — Que el piso empiece a dejar rastro, y el motor deje de ladear.** **Hecho el 3 oct 2026**: `pallet_events` en prod (`20261003202358`), ladeo fuera, banco en `palletLayout.bench.test.ts` (8,00" en 27 tarimas; 5,63" en las 4 de carga conocida; el ladeo no movía ninguna). (Lo pedido; acumula datos
desde el día uno.)

- `pallet_events`: las marcas (en el flush del carrito) **y las ediciones** (`PalletBuilderModal`,
  bicis tecleadas, «+/–»), con hora y quién. Todavía nada las lee para decidir.
- Quitar el ladeo (§6.8) y el banco versionado.
- **Checkpoint:** filas de marcas de las órdenes del primer día contra sus llaves; error medio del
  banco con y sin ladeo, tarima por tarima; captura del 3D de `318b00fb` sin cajas giradas.

**F1 — El frente, y la propuesta en Double Check.**

- `pallet_fronts`, `frontRead.ts`, la lista de §7, `CONFIRM` → `items` + `stack`.
- Pedir el frente: la cifra `FRONTS n/N` y una línea en el manual del picker; nada bloquea.
- **Checkpoint:** capturas a 430 y 1400 sobre una orden real de ≥ 3 tarimas; cuántas propuestas
  acertaron la tarima sin tocar nada.

**F2 — Calibrar el motor con lo confirmado.**

- Vista `v_pallet_engine_vs_floor`: por tarima confirmada, el armado del motor con la misma carga
  contra el `stack` — mismo nivel, mismo orden de vecinos, alto contra la cinta.
- Con ≥ 30 tarimas confirmadas, un informe de qué regla falla más (orden de las altas, 4/5 por
  nivel, cuáles acostar). Candidata conocida: **las grandes a los extremos cuando una o dos van
  acostadas encima** (Rafael, 3 oct 2026) — el motor hoy pone las más altas primero y acuesta encima
  «bien apoyadas», pero no mueve las grandes a las puntas; los frentes dirán cuánto pasa. **Ninguna regla del motor cambia sin tu ok sobre esos números.**

**F3 — El 3D de Ship arma lo que se armó.**

- `placeBoxes` acepta un `stack`: coloca lo confirmado en su nivel y orden, y por gravedad lo
  aceptado sin posición.

## 9) Casos de verificación

1. **Marcas (F0).** La primera orden de ≥ 2 tarimas completada tras el despliegue: una fila
   `check` por llave de `verified_item_keys`, con `at` creciente en el orden en que se tocaron.
   Desmarcar y volver a marcar una línea deja **3** filas (check, uncheck, check). **Ready to DC**
   vacía las llaves y **no** borra ninguna marca.
2. **Dos teléfonos (F0).** Dos pickers en el mismo grupo: cada fila lleva su `device` y su hora;
   ordenar por `at` intercala las dos manos. Hoy esa información se pierde en la fusión del Set.
3. **Sin ladeo (F0).** Envío `318b00fb`, tarima 4 (`07-3744BL` ×3, `07-3745WH` ×3, `07-3746PU`,
   `03-4618GN`, `03-4085BK`, `03-4611BK`), cinta **71"** (44 × 57): el motor sin ladeo da un alto
   que el banco imprime; ninguna `PlacedBox` lleva giro. Las otras tres: cinta 81 / 84 / 84.
4. **La acostada (F0/F1).** Envío `0966851b` (#881741), tarima 3: 4 CITIZEN de pie + 1 acostada,
   **44"** con la cinta (tarimas 1 y 2: 84 y 83). En el banco sigue dando 44 ± 1. En un frente, la
   etiqueta de la acostada se lee horizontal → `▬`.
5. **Frente vs acercamiento (F1).** De las 15 fotos de `318b00fb` (20:43:05–20:44:49, 29 sep),
   sólo **3** tienen ≥ 4 etiquetas con esquinas: 20:43:39 (`03-3987GY`, `03-3989GY`, `03-3986TL`,
   `03-3733GY`), 20:44:05 (`03-4370BL`, `03-4703GY`, `03-4704GY`, `06-4572GY`) y 20:44:30
   (`07-3746PU`, `07-3744BL`, `07-3745WH` ×2). Esas tres dan propuesta; las otras 12, nada.
6. **Una caja que la foto pone en otra tarima (F1).** En el frente de 20:44:05, `03-4370BL`,
   `03-4703GY`, `03-4704GY` están en la tarima 1 armada a mano; `06-4572GY` no (las llaves la
   ponen en la 3). La propuesta de la tarima 1 la lista con `from #3`; si el picker confirma, sale
   de la 3 (`applyPalletSelection`) y nadie la cuenta dos veces.
7. **La que no se ve (F1).** En el frente de 20:44:30 (tarima 4), lo marcado y no leído
   (`03-4618GN`, `03-4085BK`, `03-4611BK`, y las `07-` que falten hasta 7) sale en ámbar `?`.
   **✓** la deja en `items` con `placed: 'engine'`; **✗** la devuelve al reparto.
8. **Sin texto en la base (F1).** `pallet_fronts.observed` sólo trae `sku`, posiciones y `upright`;
   un test como el de `dcvShadow.test.ts` falla si aparece cualquier otro campo de texto.
9. **Según el caso (F1).** `318b00fb`, frente de 20:44:30: los `07-` leídos caen en la tarima 4
   armada a mano → **caso B**, `PALLET 4` sin ámbar aunque el prefijo diga 1 y 3; cada fila lleva
   `hand`. Frente de 20:44:05: tres SKUs en la tarima 1 a mano y `06-4572GY` con prefijo 3 → caso B
   para la tarima, `from #3` para esa caja. Una tarima sin armado a mano cuyo bloque de marcas
   apunta a la 2 y la foto lee cajas de la 3 → **caso C**, `PALLET ?`, sin faltantes propuestos.
10. **Editar y después fotografiar (F1).** El picker pone `03-4611BK` en la tarima 2 con el lápiz
    a las 14:30; a las 14:32 un frente de la tarima 3 la ve → sale de la 2 y entra en la 3, las
    bicis tecleadas de las dos se reescriben, PALLETS/WEIGHT de Ship se recalculan y la fila dice
    `photo 14:32`. Al revés (foto 14:30, lápiz 14:32) se queda en la 2.
11. **Lo que no se ve no se quita (F1).** Un frente nuevo de una tarima rearmada no ve
    `03-4618GN`: sigue en la tarima y sale `?`; sólo ✗ o un frente de otra tarima la mueve.
12. **La señal de las marcas se mide antes de usarla (F0→F1).** Con las marcas guardadas, sobre las tarimas con
    `items`: proporción en que el bloque de marcas da la tarima de `items`. La cifra decide si la
    señal de las marcas decide o sólo desempata (§6.3.7).
13. **El banco con lo confirmado (F2).** Con ≥ 30 tarimas confirmadas, la vista da por tarima: nivel
    igual (n/N), orden igual (n/N), alto motor − cinta. El informe parte de esas cifras.

## 10) ❓ Preguntas

1. **La medida de la etiqueta sale de las fotos que ya hay, no de la cinta** (Rafael, 3 oct 2026:
   «tienes miles de fotos en la db»). En un frente, dos cajas de pie vecinas tienen sus etiquetas
   separadas por el grueso de sus cajas, que el catálogo sabe (`width_in`, sólo las
   `dimensions_verified`); con muchas parejas, el ancho de la etiqueta en pulgadas es una regresión
   sobre «separación en anchos de etiqueta» contra «medio grueso + medio grueso». La proporción
   alto/ancho ya la dan las esquinas. Se hace al empezar F1 sobre las lecturas con esquinas
   (28 sep en adelante y las 120 rellenadas), por separado para la etiqueta vieja y la nueva; si las
   dos poblaciones no se separan solas, se pide una medida con cinta.
2. ❓ **¿Cámara aparte para el frente?** _Default:_ no — la misma cámara; PickD distingue frente
   (≥ 4 etiquetas) de acercamiento y deduce la tarima por las marcas. Si falla, el chip
   `PALLET n` se toca y se cambia.
3. ❓ **¿Puede el picker reordenar las cajas en la lista?** _Default:_ no. El orden lo dice la foto;
   si está mal, se repite el frente. El picker sólo contesta qué está (✓ / ✗) y qué tarima es.
4. ❓ **¿Confirmar es obligatorio para completar?** _Default:_ no, nunca bloquea. Sin confirmar, la
   tarima es la del motor.
5. ❓ **¿Se enciende para todos?** _Default:_ `app_flags.pallet_fronts`, primero tú y un picker
   (`only_users`), luego todos — como la sombra. Las marcas de F0 van para todos desde el día uno.
6. ❓ **¿Y si sin ladeo el error medio sube?** _Default:_ se queda sin ladeo (tu regla, 1 oct) y la
   diferencia va a F2 como lo primero que calibrar con lo confirmado; no vuelve el giro.

## 11) Riesgos

- **Pocas fotos son frentes (32 de 98).** Sin frente no hay propuesta; la cifra `FRONTS n/N` es lo
  que lo pide sin bloquear. Si en dos semanas sigue bajo el 50 %, se reabre la ❓ 2.
- **El lector está congelado.** Una etiqueta que el localizador no ubica hoy sigue sin ubicarse; el
  `?` es la defensa: lo que no se vio lo decide el picker, nunca se da por puesto en silencio.
- **El strap cruza las etiquetas** (la banda oscura que las parte): menos esquinas por foto. Mismo
  `?`.
- **Foto torcida o de lado.** La homografía corrige la perspectiva, pero «vertical» se mide en la
  cara: si la foto está muy girada, el nivel 1 (casi todo de pie) define la horizontal.
- **La tarima del bloque de marcas es aproximada** (el orden no: §6.3.7): un picker que arma dos
  tarimas a la vez, o que arma a mano, mezcla los bloques. Por eso la tarima sólo rellena cajas de
  las que nadie vio ni dijo nada, y nunca propone faltantes en una tarima donde ya falló (§6.3).
- **El tiempo puede pisar una buena edición con una foto mal asignada.** Por eso una foto sólo es
  un hecho con tarima segura (casos A y B); en C y D espera al picker, y si mientras tanto hubo una
  edición más nueva, se ofrece como diferencia (§6.3.4).
- **Un confirmado convierte la tarima en «armada a mano»**, y `planPallets` la respeta para siempre
  (aparta sus `items`). Es lo correcto —es lo que salió—, pero si alguien confirma por confirmar, el
  error queda fijo. Por eso `pallet_fronts` guarda la propuesta junto a lo confirmado: se ve quién
  cambió qué.
- **Guías de FedEx.** Nada de texto leído entra a la base; el test del caso 8 lo garantiza.
