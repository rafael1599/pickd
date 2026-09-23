# Lo que deja el escáner en vivo, al retirarlo

> 23 sep 2026. Rafael: «descartemos el live view por completo, documentemos de manera muy picky las
> enseñanzas que nos dejó». Se retira `src/features/recognition/liveSession/` entero — 3.568 líneas,
> 10 módulos, 9 archivos de test, cuatro rutas y dos entradas de menú — nacido el 21 sep
> (`e2960cf`) y muerto el 23. Este documento es lo que se queda cuando el código se va.
>
> El estudio que lo propuso sigue en `research/R14-sesion-en-vivo-caja-por-caja.md` y
> `research/R15-identidad-de-caja.md`; esto no los repite. Aquí va lo que **costó** aprender.

---

## 1. La cifra que lo decide, medida hoy en prod

La sesión en vivo identificaba una caja Tipo B leyendo su **UPC** y resolviéndolo contra el
catálogo. Esa cadena depende entera de una columna:

| Población                                    | SKUs | Con UPC | Cobertura |
| -------------------------------------------- | ---: | ------: | --------: |
| Catálogo completo                            | 2542 |      24 |     0,9 % |
| Bicis                                        |  914 |      22 |     2,4 % |
| **Bicis despachadas en los últimos 90 días** |  406 |  **15** | **3,7 %** |

El 21 sep eran 11 sobre 2525 y el aprendizaje automático sumó **once en dos días**. A ese ritmo,
cubrir las 406 que de verdad se despachan es cosa de meses — y ninguna de esas once la aprendió la
cámara: las tecleó alguien imprimiendo etiquetas.

**La enseñanza:** el cuello de botella nunca fue el reconocimiento. Era un dato que el almacén no
tiene y que no se consigue escaneando, sino cargando el Item Master del AS400 (INV01) o un EDI —
backlog #136. Se construyó el lector antes de comprobar que había algo que leer. La pregunta
«¿cuántas cajas de las que voy a ver puedo identificar hoy?» costaba una consulta y se hizo tarde.

---

## 2. Las reglas de identidad, que valen para cualquier lector que venga después

Éstas no dependen de la cámara. Son las que hay que copiar al siguiente intento.

### 2.1. Una identidad se compara con la llave del catálogo, nunca con el texto

`persistSkuUpcMapping` buscaba la fila con `.eq('sku', …)`. `03-4005-MN` y `03-4005MN` son la misma
bici —la CITIZEN 1 Sugar Mint— y la comparación cruda las declaró distintas: la función devolvía
`skipped` con el aviso «SKU sin fila en `sku_metadata`», **indistinguible de un SKU que de verdad no
existe**. De ahí salió la afirmación «ese SKU no existe» que Rafael frenó el 21 sep. La fila estaba,
con `sku_key = '034005MN'`.

La respuesta no era una regla nueva: `sku_key` es columna generada con índice único desde
`20260826220000`. **Cuando el esquema ya contesta la pregunta, inventar una segunda respuesta en el
cliente es fabricar una discrepancia.**

Corolario del mismo día: un mensaje de error que mezcla «no lo encontré» con «no existe» convierte un
bug de consulta en una afirmación sobre el inventario. Son dos frases distintas y tienen que serlo.

### 2.2. Un número de 12, 13 o 14 dígitos no es un SKU

Parece obvio y no lo era: el lector tomaba cualquier cadena de barras como identidad y un UPC
acababa tratado como SKU inexistente → **caja ajena** → alarma roja sobre una caja que estaba
perfectamente en su orden.

### 2.3. «No identificada» y «caja ajena» son dos poblaciones, no una

La clasificación terminó siendo seis: **A** bici válida del grupo, **B** ajena, **C** partes,
`COMPLETED_IN_GROUP`, `UNIDENTIFIED` y `CONFLICT`. La regla que las sostiene:

> **Nunca se dispara la alarma de caja ajena sin un SKU confirmado.**

Un código leído que no resuelve es `UNIDENTIFIED`, y se calla. Una alarma roja falsa cuesta más que
no decir nada: manda a una persona a buscar un problema que no existe, y a la tercera vez deja de
mirarlas.

### 2.4. Dos canales que concuerdan, o nada

Cuando las barras daban un UPC desconocido, se leía el SKU impreso por OCR. **Ese SKU no asciende a
identidad por sí solo**: sólo cuenta si coincide con algo que la orden ya espera. Tomar el único
candidato que hay porque es el único que hay es inventar — el OCR confunde 8 con B, y el resultado
es una caja en verde de un modelo que sigue en el piso.

Cuando los dos canales difieren, eso es `CONFLICT` y lo resuelve una persona. No se promedia, no se
elige el «más confiable».

### 2.5. Aprender un dato sólo rellena un hueco vacío

`persistSkuUpcMapping` escribe el UPC **sólo si la fila no tenía ninguno**, y repite la condición en
el servidor (`.is('upc', null)`) por si otra sesión escribió en medio. Un UPC distinto ya guardado se
reporta como conflicto y no se pisa; un SKU que no está en el catálogo no se da de alta.

**Esta pieza sobrevive** (§5): es la única del escáner que produce valor permanente, y el valor lo
produce cuando alguien **teclea** el UPC al imprimir una etiqueta, no cuando una cámara lo lee.

### 2.6. Se concilia contra el grupo, no contra la orden

El 45,5 % de los despachos históricos son combinados. Conciliar la caja contra la orden que está en
pantalla —y no contra su `order_group`— convierte a la mitad de las cajas legítimas en ajenas.

---

## 3. Las reglas de operación, que son las que más caro salen de aprender

### 3.1. El peor caso tiene que empatar con la tablilla, nunca perder

Las bicis sólo se podían confirmar por cámara. Etiqueta rota, caja apilada con la etiqueta contra la
pared, u OCR que no acierta con esa tipografía, **y la orden no se termina**: el operador vuelve a la
tablilla con todo el barrido perdido. La salida manual (`450ca3e`) no es una concesión: es lo que
hace que el peor caso de PickD sea _igual de rápido_ que el papel en vez de más lento, y lo que saca
la calidad del reconocimiento del camino crítico.

### 3.2. Y entonces hay que contar cuántas puso la cámara y cuántas la mano

Una caja confirmada a mano queda `isManual`, `sourceBarcode: 'MANUAL'`, y se cuenta aparte
(`reparto_camara_vs_mano`). **Esa proporción es la medición que decide si el reconocimiento sirve**, y
se pierde en el instante en que las dos se ven igual en la pantalla y en los datos.

### 3.3. Confirmar cajas no es decir que la orden salió del estante

`completeVerifiedOrder` pasó a llamarse `markOrderVerified` porque completaba la orden al guardar.
Escribe `checked_by` y `verified_item_keys`, y nada más. Completar es una decisión de Double Check o
de Ship. Confundir «ya verifiqué las cajas que vi» con «esta orden ya salió del estante» descuenta
inventario que sigue en la fila.

### 3.4. Escribir el progreso no es que el progreso se vea

`markOrderVerified` escribía `verified_item_keys` con la orden todavía en `ready_to_double_check`, y
`verificationProgress()` los ignora a propósito en ese estado; hubo que hacer la misma transición a
`double_checking` que hace `lockForCheck`. Y aun así **la barra del board se quedaba en 0**: sus
claves son `…-sku-location` y la sesión en vivo no rastrea ubicación. Un dato escrito en el formato
equivocado es un dato que no existe para quien lo lee.

### 3.5. Guardar dos veces lo mismo son dos filas

Copiar el resultado tres veces insertaba tres corridas en `live_check_test_runs`. Se arregló con un
`testRunSavedRef` por sesión, disparado por lo primero que ocurra entre copiar y salir de la
pantalla. Toda escritura colgada de un botón que se puede pulsar dos veces necesita esa guarda.

---

## 4. La óptica: lo único que no se puede negociar con software

`opticalGeometry.ts` convertía distancia y FOV en píxeles por módulo de barra, y ahí hay tres
números que valen para cualquier intento futuro:

| Magnitud                             | Umbral        | De dónde sale                     |
| ------------------------------------ | ------------- | --------------------------------- |
| Nyquist mínimo para decodificar 1D   | ≥ 1,45 px/mod | R11 bloque 2                      |
| Zona robusta recomendada             | ≥ 1,80 px/mod | R11 bloque 2                      |
| Altura de glifo legible por PP-OCRv6 | ≥ 16 px       | R11 / banco                       |
| FOV horizontal del 1× del S25 Ultra  | 68°           | perfil del equipo                 |
| Distancia mínima de enfoque          | 150 mm        | por debajo, LapVar < 30 (borrosa) |

Con eso se calcula la **distancia máxima** a la que una barra todavía se decodifica en vez de
adivinarla — y la ventana que salía era **20–35 cm**. Ésa es la enseñanza incómoda: para leer la
etiqueta de una caja hay que estar a un palmo de ella. **Un pallet no se lee de lejos**, y eso
condena por igual a la foto única del pallet (§lo de `07-por-que-faltan-etiquetas.md`) y al barrido
en vivo desde el pasillo.

El consenso temporal —**2 cuadros dentro de 600 ms**— era para lo otro: un reflejo o un cuadro
movido produce una lectura fantasma, y una sola lectura no basta para confirmar una caja.

---

## 5. Lo que se queda en el repo

- **`persistSkuUpcMapping`** se muda a `src/utils/skuUpc.ts` con sus tests. La usan el generador de
  etiquetas (`LabelGeneratorScreen`, `useGenerateLabels`): el UPC que el operador teclea al imprimir
  se aprende en `sku_metadata` en vez de morir en `asset_tags`. **Es el único trozo del escáner que
  sigue produciendo valor**, y no necesita cámara.
- **`research/R11`, `R14`, `R15`** — los estudios se quedan. Son el razonamiento, no el código.
- **`live_check_test_runs` ya no existe**: la tiró `20260923164517`, aplicada en prod el mismo día.
  Se fue con cero filas, sus dos políticas y sus tres índices — comprobado antes: ninguna FK la
  apuntaba, ninguna función la nombraba, no estaba en realtime. Las dos migraciones que la crearon
  (`20260923002234`, `20260923042157`) se quedan en el historial, que es lo que lo hace historial.

## 6. La enseñanza que engloba a todas

**Se construyó el instrumento de medición al final.** `live_check_test_runs` —dispositivo, commit,
duración, cajas confirmadas, reparto cámara vs mano— se creó el 23 de septiembre a las 00:22, dos
días después del escáner y horas antes de retirarlo. Al escribir esto tiene **cero filas**: la
feature se fue sin que exista un solo registro de qué tan bien funcionaba.

No se retira porque midiera mal. Se retira **sin haber medido**, y eso es lo que no puede volver a
pasar: de las dos cosas que se construyeron —el lector y la forma de saber si el lector sirve— la
segunda era la barata, y fue la última.

## 7. Si alguien lo retoma

La condición de entrada no es técnica. **Es la cobertura de UPC.** Mientras 15 de 406 bicis
despachadas tengan UPC, ningún lector de barras puede identificar una caja Tipo B, por bueno que
sea. Primero el Item Master del AS400 o el EDI (#136); después, `git log -- src/features/recognition/liveSession`
devuelve los diez módulos completos con sus tests.
