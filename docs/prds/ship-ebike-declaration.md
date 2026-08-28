# PRD: Bici eléctrica resaltada en Ship y declarada aparte en Audit Source

**Estado:** Construido 2026-08-27 (`79f8270`) — Rafael aprobó las cinco propuestas por defecto ("ok todo") · **Fecha:** 2026-08-27
· **Autor:** Rafael + PickD · **Backlog:** idea-167 · **Relacionado:** idea-161 (alertas en un botón
pulsante), `src/utils/electricBikes.ts`, `ElectricBikeWarning`

---

## 1) Contexto y problema

**Audit Source** es el sistema donde una carga regular se cotiza, se elige el carrier y se genera el
número de seguimiento. Para una orden regular pide: tienda/cliente, calle y número del destino,
zip, **cantidad de pallets** y **peso total**. Cuando la orden lleva una bici a batería, pide
además **declararla**, y la bici se declara como **un cartón aparte, fuera del pallet** — aunque
físicamente viaje dentro del pallet (o de varios).

Hoy Ship avisa con un banner ámbar ("Lithium battery label — N e-bikes", pensado para la etiqueta
de litio de FedEx) pero **no dice qué línea es**: la estación la busca por el nombre en Order
Items, y si el nombre no la delata (18 % de las líneas de orden no traen nombre) no la encuentra.
Una eléctrica sin declarar es una carga que el carrier rechaza o refactura; una declarada con el
peso equivocado es lo mismo más lento.

Rafael (27 ago 2026): "pickd podría mostrarnos la bicicleta que es eléctrica resaltada en azul o
con una animación que denote que esta bicicleta es eléctrica y necesita ser declarada como tal en
la vista Ship".

## 2) Objetivo

Que la estación vea **de un vistazo, en la vista Ship, qué línea es eléctrica y qué debe teclear
por ella en Audit Source**, sin salir de Ship y sin buscar por nombre.

**Métrica:** cero eléctricas sin declarar; cero búsquedas por nombre para encontrarlas.

## 3) Usuarios

La estación de envío, en órdenes **regulares** (camión). Las órdenes FedEx siguen con la etiqueta
de litio y su manual; ver ❓ Q4.

## 4) Alcance

**Dentro:** resaltar la(s) línea(s) eléctrica(s) en Order Items; un resumen bajo los cuatro
números con lo que se declara; usar la detección que ya existe.
**Fuera:** cambiar la cuenta de pallets o el peso total; tocar FedEx Ship Manager; el empaque
físico; una columna nueva en la base de datos (ver Riesgos).

## 5) Conceptos de dominio

- **Eléctrica** = `isElectricBikeSku(sku)`: la lista verificada en prod (`ELECTRIC_BIKE_SKUS`,
  20 ago 2026) **o** el modelo con `E` + dígito (`HUDSON E2 S/T`, `DEFCON E1`); nunca `EC3`
  (Earth Cruiser, a pedal) ni la herramienta `99-3604 … (E2)`, que es una parte.
- **Cartón aparte** = la eléctrica se declara como bulto propio en Audit Source aunque vaya dentro
  del pallet; lo que Audit Source pide de ese bulto es ❓ Q1.

## 6) Requerimientos funcionales

- **R1 — La línea se ve.** En Order Items, la línea eléctrica lleva borde izquierdo azul, la
  insignia **E-BIKE** junto al SKU y un pulso suave mientras la orden no está enviada
  (`prefers-reduced-motion` lo apaga). El resaltado no cambia el orden de las líneas.
- **R2 — Lo que se declara, listo para copiar.** Bajo los cuatro números, una línea por eléctrica:
  `1 e-bike to declare as a separate carton — HUDSON E2 S/T 14 · 80 lb · 55×30×8 in`, con botón
  de copiar. Peso y medidas salen del catálogo; si son el default de registro, `?` en ámbar como
  en la columna Lbs.
- **R3 — Los totales no se mueven.** Pallets y peso total siguen siendo los de toda la carga
  (❓ Q2).
- **R4 — Dónde aparece.** Órdenes regulares siempre; en FedEx el banner de litio se queda y el
  resaltado también (❓ Q4).
- **R5 — Con idea-161.** El botón pulsante de alertas muestra `E-BIKE ×N`; tocarlo lleva a la
  primera línea resaltada (❓ Q5).

## 7) ❓ Preguntas abiertas — cada una con lo que se hará si la respuesta es "ok"

| #   | Pregunta                                                                                                                | Propuesta por defecto                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Q1  | ¿Qué pide Audit Source del cartón aparte: solo "lleva batería de litio", o también peso y medidas?                      | Mostrar peso y medidas del catálogo; lo que sobre no estorba.                                |
| Q2  | ¿La cuenta de pallets cambia (1 pallet + 1 cartón) o se declara el cartón además del pallet, con el peso total intacto? | Totales intactos; el cartón se declara además.                                               |
| Q3  | ¿Azul o animación?                                                                                                      | Las dos, suaves: borde azul + insignia siempre; pulso solo hasta que la orden se envía.      |
| Q4  | ¿También en órdenes FedEx?                                                                                              | Sí (no estorba); el banner de litio se queda.                                                |
| Q5  | ¿Se funde con el botón pulsante de idea-161?                                                                            | El resaltado por línea es idea-167; el botón (idea-161) dice `E-BIKE ×N` y lleva a la línea. |

## 8) Criterios de aceptación

1. Orden regular con una Hudson E2: la línea sale azul con **E-BIKE**, y bajo los números se lee
   `1 e-bike to declare as a separate carton — …` con copiar.
2. Orden sin eléctricas: nada cambia.
3. Orden con `99-3604 TOOL HYENA DIAGNOSTIC (E2)`: nada se resalta.
4. Con "reducir movimiento" activado no hay pulso; el azul y la insignia siguen.
5. Pallets y peso total iguales antes y después (según Q2).

## 10) Refinamiento de Rafael (27 ago, tarde) — cifras, no frases

"El operario no quiere un texto largo, solo cosas puntuales": la declaración se muestra **con el
mismo formato que los cuatro números grandes** (pallets, bikes, parts, weight), una fila por
e-bike: **1** CARTON · **1** HUDSON E1 · **78.6** LBS. En órdenes **regulares no hacen falta
medidas**; en **FedEx sí**, en la misma fila: **57×37×10** IN (pulgadas enteras redondeadas hacia
arriba, las mismas que ya tiene FSM por el export de Dimensions). El botón de copiar entrega
exactamente `1 carton, 1 HUDSON E2, 78.6 lbs` (+ `, 57×37×10 in` en FedEx). La frase explicativa
desapareció; queda la etiqueta "E-bike — own carton". R2 queda reemplazado por esto.

## 11) Corrección de Rafael (27 ago, noche) — Q2 estaba mal

Con la orden real 303 / 301 en pantalla: **9 bikes / 480 lb** en el pallet **y además** 1 cartón
/ 80 lb de la Hudson E2 — "estamos inflando los números, tanto en cantidad de bikes como en
peso": Audit Source recibiría la bici dos veces. La propuesta por defecto de Q2 ("totales
intactos") queda **anulada**: los cuatro números son **el pallet**, y lo que se declara como
cartón aparte **sale de ellos**. Bikes y Weight cuentan todo menos las e-bikes (1 · **8** · 0 ·
**400**); la fila de e-bike las lleva (1 · 1 HUDSON E2 · 80). Pallets y Parts no cambian.
R3 y el criterio de aceptación 5 quedan reemplazados por esto.

## 9) Riesgos y supuestos

- La detección vive en una lista + un patrón de nombre; una eléctrica nueva con otro esquema de
  nombre pasa desapercibida hasta que alguien la agrega a la lista. Si eso ocurre una vez, la
  respuesta es una bandera `is_electric` en `sku_metadata` que se pide al registrar (misma lógica
  que Bici/Parte) — fuera de este PRD a propósito.
- Supone que el peso del catálogo es real para las eléctricas; dos de dieciocho estaban en 45 lb
  (default) el 20 ago. El `?` ámbar de R2 es lo que lo delata.
