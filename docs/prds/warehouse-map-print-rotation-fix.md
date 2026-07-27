# PRD: WarehouseMap — Rotación de labels y layout de impresión A4

## 1. Contexto y problema

La pantalla **Warehouse Top View** (`/warehouse-map`) muestra la grilla de overstock
(rows 31, 32, 33 × sublocations A–J) con un botón para rotar el mapa en
incrementos de 90°.

**Dos problemas reportados:**

### 1a. Labels de ROW invertidos al rotar 180°

Cuando el usuario rota la grilla 180°, la función
[counterRotateTextStyle](file:///Users/rafaellopez/Documents/Projects/pickd-workspace/pickd/src/features/warehouse-management/utils/counterRotateText.ts#L16-L24)
aplica `transform: rotate(-180deg)` al texto para que siga leyéndose horizontal.
El contenido de cada celda (SKUs, unidades) se lee correctamente porque es texto
genérico. Sin embargo, los **headers de fila** ("31", "32", "33") y los **headers
de columna** ("A"–"J") quedan **semánticamente desordenados**: la grilla se pintó
con `ROWS` de izquierda a derecha (31→32→33) y `LETTERS` de arriba a abajo
(A→J), pero al rotar 180° el ojo del usuario lee de derecha a izquierda y de
abajo a arriba. El resultado es que "31" aparece donde visualmente debería estar
"33" y viceversa — los números se leen bien individualmente (no están al revés)
pero están **en la posición equivocada** relativa a la orientación visual del
mapa.

> **Raíz del problema**: la contra-rotación solo corrige la orientación del
> glifo, no el _orden_ de renderizado de los headers. El CSS `transform: rotate`
> en el contenedor rota la grilla completa como un bloque, por lo que la
> secuencia DOM `[31, 32, 33]` queda invertida visualmente a `[33, 32, 31]`.

### 1b. Impresión no cabe en una hoja A4

No existe regla `@page` ni estilos de tamaño de impresión. Al imprimir:

- El mapa puede exceder los márgenes de una hoja A4 (landscape o portrait).
- Las celdas de tipo "lines" se renderizan con cada SKU en su propia línea
  vertical, ocupando mucha altura — cuando la grilla tiene 6 líneas por celda,
  la tabla se desborda fácilmente.
- No hay protección contra que un SKU se corte entre el final de una página y
  el inicio de la siguiente.

## 2. Objetivo

Entregar dos mejoras puntuales en la pantalla `/warehouse-map`:

1. **Labels correctos en toda rotación**: los headers de ROW y sublocation
   siempre reflejan la posición real del contenido, independientemente del
   ángulo de rotación.
2. **Una sola hoja A4**: al imprimir, la grilla entera cabe en una sola hoja
   A4 landscape sin cortar ningún SKU a la mitad. Para lograrlo las celdas de
   tipo "lines" cambian a un layout horizontal inline (SKUs separados por
   comas) en vez de stack vertical, y la tipografía se escala al máximo posible
   que permita caber.

## 3. Público objetivo y usuarios

| Rol                   | Uso                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Warehouse manager** | Imprime el mapa para pegarlo en la pared del almacén como referencia de put-away. Necesita una hoja única, legible a distancia razonable.             |
| **Picker / mover**    | Consulta el mapa en pantalla (rotado según orientación física del pasillo) para ubicar stock. Los labels deben coincidir con lo que ve en el estante. |

## 4. Alcance

### In scope

| #   | Item                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------- |
| 1   | Invertir el orden de renderizado de `ROWS` y `LETTERS` cuando la rotación visual lo requiere (180° y 270°). |
| 2   | Regla `@page` con A4 landscape + márgenes mínimos.                                                          |
| 3   | Layout inline (horizontal, comas) para celdas "lines" en `@media print`.                                    |
| 4   | Escalar la fuente de impresión al tamaño máximo que quepa sin desbordarse.                                  |
| 5   | Garantizar `break-inside: avoid` en cada celda para que ningún SKU se parta entre páginas.                  |
| 6   | Mantener `print:text-base` / `print:text-lg` actuales como floor — nunca reducir debajo de eso.             |

### Out of scope

- Cambiar el algoritmo de placement (`overstockPutaway.ts`).
- Soporte para tamaños de papel distintos a A4.
- Modo portrait de impresión (landscape es obligatorio para 3 columnas anchas).
- Impresión del panel `SkuDetailPanel` o `ExcludedItemsSummary`.
- Cualquier cambio en la lógica de exclusión, filtros o ranking.

## 5. Conceptos de dominio

| Concepto                 | Definición                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Row**                  | Estante físico del bloque overstock. Existen 3: `31`, `32`, `33`.                                                                          |
| **Sublocation (letter)** | Posición dentro de un row, `A`–`J`. Cada una tiene capacidad de 30 unidades.                                                               |
| **Tower**                | Sublocation ocupada por un solo SKU (mono-SKU, hasta 30u).                                                                                 |
| **Line**                 | Entrada dentro de una sublocation compartida. Hasta 6 lines por sublocation, cada una ≤5u, un SKU por line.                                |
| **Counter-rotation**     | Técnica CSS donde el texto se rota en sentido contrario al contenedor para mantenerse legible. Implementada en `counterRotateTextStyle()`. |
| **Grid rotation**        | Rotación visual de toda la grilla (`transform: rotate(Ndeg)`) controlada por el botón ↻. Valores posibles: 0°, 90°, 180°, 270°.            |

## 6. Requerimientos funcionales

### RF-1: Headers de ROW reflejan posición visual

Cuando `rotation` es 180° o 270°, el array `ROWS` debe renderizarse en orden
invertido (`['33','32','31']` en vez de `['31','32','33']`) para que el header
izquierdo (post-rotación) muestre el row que efectivamente está a la izquierda
visual del usuario.

**Verificable**: rotar a 180° y confirmar que el header izquierdo dice "33" y
el derecho dice "31" — lo mismo que leer la grilla de izquierda a derecha en
esa orientación.

### RF-2: Headers de sublocation (letters) reflejan posición visual

Misma lógica para el eje vertical: cuando `rotation` es 180° o 270°, `LETTERS`
se renderiza en orden invertido (`['J','I',…,'A']`), de modo que la letra
superior coincida con la sublocation que visualmente queda arriba.

**Verificable**: rotar a 180° y confirmar que la sublocation superior es "J"
(antes de rotar era "A", que al girar 180° queda abajo).

### RF-3: El contenido de cada celda sigue mapeado al slot correcto

El orden visual de las celdas cambia junto con los headers — la celda que
estaba en `(31, A)` sigue conteniendo el SKU de `(31, A)`. El cambio es solo
en el orden de pintado de la grilla, no en la asociación slot→celda.

**Verificable**: anotar qué SKU está en `31-A` sin rotación. Rotar 180°. Esa
celda ahora aparece abajo-derecha. Confirmar que el header de esa posición
dice "31" y "A", y el SKU es el mismo.

### RF-4: Impresión cabe en una sola hoja A4 landscape

Al abrir `Ctrl+P` / `Cmd+P`, la grilla completa (3 rows × 10 letters = 30
celdas + headers) se renderiza dentro de los márgenes de una hoja A4
landscape (297 × 210 mm) sin overflow ni segunda página.

**Verificable**: abrir print preview en Chrome, seleccionar A4 landscape.
Confirmar que solo hay 1 página y toda la grilla es visible.

### RF-5: Celdas "lines" usan layout inline en impresión

En `@media print`, las celdas con `usage.kind === 'lines'` renderizan sus
entries en una sola línea horizontal separados por comas (ej:
`0344·5u, 1287·3u, 0891·2u`), en vez del stack vertical actual.

**Verificable**: inspeccionar el print preview — una celda de tipo "lines" con
3 SKUs muestra los 3 en una sola línea separados por comas.

### RF-6: Ningún SKU se corta entre dos líneas de texto

En la representación impresa inline, si un token `SKU·Nu` no cabe al final de
una línea de texto, salta completo a la siguiente — nunca se parte a la mitad.
Se usa `white-space: nowrap` en cada token individual envuelto en un contenedor
con `display: inline` + separador coma.

**Verificable**: encontrar una celda con muchos SKUs que causen wrap. Confirmar
que el corte de línea ocurre siempre antes de la coma, nunca dentro del token.

### RF-7: Fuente de impresión maximizada

El tamaño de fuente en `@media print` se incrementa al máximo que la grilla
permita sin desbordar A4. El valor exacto se determina empíricamente durante
la implementación, pero no puede ser menor que los valores actuales
(`print:text-base` para SKU, `print:text-lg` para headers).

**Verificable**: el texto impreso es legible a 1 metro de distancia cuando se
pega en la pared (benchmark subjetivo del warehouse manager).

### RF-8: Rotación de impresión fija a 180°

La impresión siempre produce la grilla a 180° de rotación,
independientemente del ángulo que el usuario tenga seleccionado en pantalla.
Esto coincide con la orientación física del mapa cuando se pega en la pared
del almacén. Solo se imprime la grilla pura — sin títulos, fechas ni
elementos de UI.

**Verificable**: con cualquier rotación en pantalla, abrir print preview.
Confirmar que la grilla sale a 180° (row 33 a la izquierda, letter J arriba)
y no hay título ni fecha en la hoja.

## 7. Requerimientos no funcionales

| ID        | Requerimiento                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------ |
| **RNF-1** | Cero regresión visual en pantalla (no-print): la grilla debe verse idéntica a la actual en rotaciones 0° y 90°.          |
| **RNF-2** | La transición de rotación (`transition: transform 500ms`) debe seguir funcionando fluidamente.                           |
| **RNF-3** | Sin dependencias nuevas — solo CSS y lógica React existente.                                                             |
| **RNF-4** | Compatibilidad de impresión testada en Chrome ≥120 (browser principal del warehouse). Safari y Firefox son nice-to-have. |
| **RNF-5** | El print output sigue siendo monocromático (black on white), como ya dicta el bloque `@media print` en `index.css`.      |

## 8. Criterios de aceptación del MVP

- [ ] **AC-1**: Con rotation=0°, los headers se leen `31→32→33` (izq→der) y `A→J` (top→bottom). Sin cambio respecto a hoy.
- [ ] **AC-2**: Con rotation=180°, los headers se leen `33→32→31` (izq→der) y `J→A` (top→bottom) — coincidiendo con la posición visual real de cada row/letter.
- [ ] **AC-3**: Con rotation=90° y 270°, el reordenamiento es coherente con la dirección de lectura post-giro (90° = invertir letters; 270° = invertir ambos).
- [ ] **AC-4**: Print preview en Chrome muestra exactamente 1 página A4 landscape con la grilla completa.
- [ ] **AC-5**: Celdas "lines" en print preview muestran SKUs inline separados por comas.
- [ ] **AC-6**: Ningún token SKU aparece cortado entre dos líneas en print preview.
- [ ] **AC-7**: La fuente impresa es igual o mayor que `print:text-base` actual.
- [ ] **AC-8**: La grilla en print preview siempre sale a 180° de rotación (row 33 izquierda, J arriba), sin título ni fecha.
- [ ] **AC-9**: Los colores de SKU siguen visibles en pantalla (la regla monocromática solo aplica a print).

## 9. Riesgos y supuestos

| #   | Tipo         | Descripción                                                                                                   | Mitigación                                                                                                                 |
| --- | ------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Supuesto** | El warehouse solo usa Chrome para imprimir.                                                                   | Testar en Chrome. Documentar como requisito.                                                                               |
| 2   | **Riesgo**   | Con 6 lines × 3 rows, el layout inline con comas podría aún exceder una línea de celda y forzar wrap interno. | RF-6 garantiza que el wrap sea limpio (nunca parte un SKU). Si aun así no cabe, reducir font-size de lines un step.        |
| 3   | **Riesgo**   | Invertir el orden DOM de `ROWS`/`LETTERS` puede romper `slotAt()` si se cambia la semántica del mapeo.        | `slotAt` busca por valor (`row === '31'`), no por índice — el reordenamiento del array de renderizado no afecta el lookup. |
| 4   | **Supuesto** | A4 landscape siempre es suficiente para 3 cols × 10 rows + headers.                                           | Correcto mientras `ROWS` sea 3 y `LETTERS` sea 10. Si cambian, revisar.                                                    |
| 5   | **Riesgo**   | Márgenes del diálogo de impresión del browser pueden diferir de los defaults de `@page`.                      | Usar `margin: 5mm` en `@page` para dejar mínimo margen obligatorio y máximo espacio para contenido.                        |
| 6   | **Supuesto** | El usuario siempre imprime desde la vista web (no genera PDF externamente).                                   | N/A — el `@page` aplica a ambos flujos.                                                                                    |
