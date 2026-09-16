# R9 · Qué lee un modelo de visión en nuestras propias etiquetas

> **Procedencia:** banco corrido el 16 de septiembre de 2026 contra las 13 fotos de la verdad de
> terreno (`bench/gt.json`), con tres modelos de Gemini lanzados por `agy` (Antigravity CLI) desde
> esta máquina. Coste 0: van contra el plan de Antigravity, no por API de pago.
>
> **La foto 12 no se envió.** Lleva una etiqueta de FedEx con el nombre y la dirección de una
> persona, y sale de nuestra máquina hacia Google. Queda fuera del banco a propósito; si hace
> falta cubrirla, se recorta antes a la etiqueta de Jamis.

## 1. Qué mide esto, y qué no

Este banco **no** prueba el modelo que acabaría dentro del teléfono. Gemini corre en la nube de
Google; nosotros queremos algo local y gratis. Lo que mide es **el techo**: si un modelo de visión
bueno, sin límite de memoria ni de batería, se equivoca en un campo, ninguno de los modelos
pequeños que caben en un móvil lo va a hacer mejor. Y al revés: donde acierta entero, vale la pena
buscar un modelo pequeño que lo imite.

Se corrieron tres escalones a propósito, de más barato a más capaz, para ver si la calidad depende
del tamaño del modelo o del campo que se le pide.

## 2. Los campos que el código de barras ya da exactos

| Modelo                  | SKU          | UPC | GTIN | G.W.          | Serie         | Segundos por foto |
| ----------------------- | ------------ | --- | ---- | ------------- | ------------- | ----------------- |
| Gemini 3.8 Flash (Low)  | 9/12 · 1 mal | 8/9 | 3/3  | 10/11 · 1 mal | 10/11         | 10                |
| Gemini 3.8 Flash (High) | 12/12        | 9/9 | 3/3  | 10/11 · 1 mal | 10/11         | 81                |
| Gemini 3.1 Pro (High)   | 7/12 · 3 mal | 8/9 | 3/3  | 11/11         | 10/11 · 1 mal | 28                |

Cada celda es «aciertos / veces que ese campo estaba impreso en la foto».

El escalón de en medio, Flash (High), fue el **único que acertó los 12 SKU**, pero tardó 81 segundos
de media y se colgó cinco veces, que hubo que relanzar. Ese número de tiempo está inflado por los
cuelgues, así que no sirve para comparar velocidad; lo que sí dice es que ese escalón no es fiable
para trabajar a ritmo de almacén.

## 3. Los campos que ningún código de barras lleva

| Modelo                  | Modelo | Talla         | Color |
| ----------------------- | ------ | ------------- | ----- |
| Gemini 3.8 Flash (Low)  | 13/13  | 12/13 · 1 mal | 13/13 |
| Gemini 3.8 Flash (High) | 13/13  | 12/13 · 1 mal | 13/13 |
| Gemini 3.1 Pro (High)   | 13/13  | 12/13 · 1 mal | 13/13 |

**Aquí está el resultado que importa.** Modelo y color: perfectos en los tres escalones, incluso en
el más barato y rápido. La única diferencia en talla es la foto 3, donde el modelo leyó `700C x 48`
y nuestra tabla dice `48 cm`: el modelo leyó bien, la tabla es la que está normalizada.

Ningún código de barras de la caja lleva modelo, talla ni color. Hoy esos tres campos se teclean a
mano o se van a buscar al AS400. Son justo los que el modelo de visión resuelve sin fallar.

## 4. Todas las diferencias, una por una

| Modelo                  | Foto | Campo  | Dijo            | Era          |
| ----------------------- | ---- | ------ | --------------- | ------------ |
| Gemini 3.1 Pro (High)   | 3b   | sku    | `03-419BR`      | `03-4149BR`  |
| Gemini 3.1 Pro (High)   | 13   | serial | `M211014353`    | `M21I014353` |
| Gemini 3.1 Pro (High)   | 9    | sku    | `BUS0622611901` | `03-3925BK`  |
| Gemini 3.1 Pro (High)   | 3a   | sku    | `03-4149ER`     | `03-4149BR`  |
| Gemini 3.1 Pro (High)   | 3a   | size   | `700C x 48`     | `48 cm`      |
| Gemini 3.8 Flash (High) | 6    | gw_kg  | `20.20`         | `20.30`      |
| Gemini 3.8 Flash (High) | 3a   | size   | `700C x 48`     | `48 cm`      |
| Gemini 3.8 Flash (Low)  | 9    | sku    | `BUS0622611901` | `03-3925BK`  |
| Gemini 3.8 Flash (Low)  | 6    | gw_kg  | `20.20`         | `20.30`      |
| Gemini 3.8 Flash (Low)  | 3a   | size   | `700C x 48`     | `48 cm`      |

Las tres filas de `talla` no son fallos: el modelo leyó lo que está impreso (`700C x 48`) y nuestra
tabla es la que guarda la forma normalizada (`48 cm`). Las demás sí lo son.

Cuatro cosas que aprender de esa lista:

1. **`BUS0622611901` en la foto 9 no es una alucinación: está impreso en la caja.** Dos modelos
   distintos devolvieron exactamente la misma cadena. El error no fue leer, fue **decidir de qué
   campo era**: metieron un código de pedido en el sitio del SKU. Es un fallo de asignación, no de
   lectura, y es justo lo que el árbitro determinista ataja: `BUS0622611901` no tiene la forma
   `DD-NNNN[CC]` y se rechaza sin preguntarle a nadie.
2. **`03-419BR` (foto 3b) es un dígito perdido de `03-4149BR`.** También lo caza la forma. Es el
   mismo error de familia que ya vimos con OCR clásico (`03-4143BR`).
3. **`03-4149ER` (foto 3a) es el caso peligroso.** Una `B` leída como `E` en la misma caja, y esta
   vez **la forma es perfectamente válida**: dos dígitos, guion, cuatro dígitos, dos letras. La
   forma no lo salva; sólo lo cazan el código de barras de esa misma etiqueta (Code 39, que dice
   `BR`) o el catálogo, donde `03-4149ER` no existe. Por eso el SKU no se acepta del texto **nunca**,
   ni siquiera cuando parece impecable.
4. **`M211014353` vs `M21I014353` (foto 13) sí pasaría entero.** Es la confusión `I`/`1` en un
   número de serie, y un serial no tiene forma que validar ni dígito de control. En PickD la serie
   no decide identidad; si algún día decidiera, habría que confirmarla a mano.

## 5. Qué se decide con esto

Esto confirma, con nuestras propias cajas, la cadena que propuso la investigación
(`02-investigacion.md` §3): **barras primero para lo que tiene dígito de control, visión sólo para
lo que no lo tiene, y un árbitro determinista en medio.**

- **SKU y UPC → de la barra, siempre.** El modelo de visión se equivoca justo aquí, y se equivoca
  produciendo valores con pinta correcta, que es la peor forma de equivocarse.
- **Modelo, talla y color → de la visión.** Cero errores en los tres escalones. Es el trabajo que
  hoy se hace a mano.
- **Peso G.W. → de la visión, con revisión.** El único fallo (`20.20` en vez de `20.30`) salió en
  la foto donde el número está borroso, y sólo en los escalones baratos.
- **El escalón barato basta para el trabajo que importa.** Flash (Low) acertó modelo, talla y color
  igual que Pro (High), en unos **10 segundos por foto contra casi 30**. La capacidad extra del
  modelo grande se gasta en campos que, de todos modos, le vamos a quitar.
- **Y ojo: el modelo más caro fue el PEOR en SKU.** Pro (High) puso tres SKU equivocados; Flash (Low)
  puso uno y dejó dos en blanco. El grande se esfuerza más en rellenar el hueco, y rellenarlo mal
  es peor que dejarlo vacío. Al reconocedor hay que pedirle que responda `null` sin vergüenza.

## 6. Cómo repetirlo

El arnés está en `bench/`, junto al de los códigos de barras:

```
LABEL_PHOTOS_DIR=/ruta/a/las/fotos ./run_vlm_agy.sh raw/
python3 score_vlm.py raw/
```

`run_vlm_agy.sh` llama al CLI de Antigravity (`agy`), que ya está autenticado en esta máquina, así
que no hay clave de API ni coste por foto. Excluye sola la foto de FedEx. `score_vlm.py` escupe las
tres tablas de arriba tal cual.

Dos avisos de la corrida, por si se repite: el escalón Flash (High) se colgó cinco veces y hubo que
relanzarlo, y `agy` en modo desatendido no puede pedir permisos, así que sin
`--dangerously-skip-permissions` las lecturas que intentan abrir una terminal salen vacías.
