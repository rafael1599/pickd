# La tarjeta de Stock: foto primero (propuesta C)

Estudio, 6 oct 2026. Nada de esto está construido. Rafael pidió «tus mejores 3 propuestas de la card
de stock con sus diferentes variantes en un html local» (`docs/design/stock-card-proposals.html`) y
eligió **la C**: «la elegida es la opción C».

## 1. Las cifras (prod, 6 oct 2026, bicis con stock en LUDLOW)

| Tipo       | SKUs | Con foto      | Sin foto |
| ---------- | ---- | ------------- | -------- |
| Nueva      | 470  | 387           | 83       |
| S/D        | 112  | 32            | 80       |
| PH         | 35   | 5             | 30       |
| Devolución | 61   | 59 (etiqueta) | 2        |

| Tarjeta (430 px)                      | Alto       | Caben en 932 px |
| ------------------------------------- | ---------- | --------------- |
| Hoy                                   | 245–324 px | 2,8–3,7         |
| C, una unidad (sin distribución)      | ~124 px    | ~7              |
| C, varias unidades (con distribución) | ~145 px    | ~6              |

**C pone el doble de tarjetas en pantalla.** Pero **una de cada cinco bicis con stock no tiene
foto**: 83 nuevas, 80 S/D y 30 PH. En C el hueco de la foto es lo primero que se ve.

## 2. La tarjeta

```
┌──────────┬──────────────────────────────────┐
│ [S/D]    │ 03-4470BK                  [H] 1 │
│  foto    │ RENEGADE S2 700×51CM CHARCOAL S/D│
│          │ WMGC00005                        │
│ [#75]    │ [ − ]   [ ⇄ ]   [ + ]      [⋯]   │
└──────────┴──────────────────────────────────┘
┌──────────┬──────────────────────────────────┐
│          │ 03-3978BL                [H] 247 │
│  foto    │ CITIZEN 2 17" 2026 MONTEREY BLUE │
│          │ ▤ 8×30 │ ▯ 1×5 │ ▯ 1×4           │
│          │ [ − ]   [ ⇄ ]   [ + ]      [⋯]   │
└──────────┴──────────────────────────────────┘
```

- **Izquierda, la foto** (104 px de ancho, toda la altura): la de catálogo, la de la unidad (S/D, PH)
  o **la etiqueta de FedEx** en una devolución. Encima, el chip del tipo (relleno, idea-251) y, en una
  S/D, su `#n` grande, como en la caja.
- **Derecha:** SKU · casilla ámbar · cantidad verde en una línea; el nombre; una línea de datos; y
  − ⇄ + ⋯.
- **La línea de datos** dice lo de cada tipo:
  - nueva: la distribución;
  - S/D: el serial;
  - PH: el defecto (la nota);
  - devolución: `RMA 865617 · 1 d`;
  - y la nota de posición (`📍 Over 03-4024BL`) cuando la hay.
- **La distribución, compacta** (boceto de Rafael, 6 oct): un dibujo por cada tipo de caja con la
  misma cantidad por caja y, al lado, `cuántas × de cuánto` en vertical. 03-3978BL pasa de 10 cajas
  dibujadas a 3 grupos (torre `8×30`, línea `1×5`, línea `1×4`). Dos líneas con cantidades distintas
  no se juntan.
- **Con una sola unidad no hay distribución** (Rafael: «para las bicicletas de las cuales solo queda
  una unidad no vale la pena usar el espacio»).
- **Se va:** la caja de distribución de arriba con su dibujo, y el «STOCK» repetido: la cantidad
  sale una vez.

## 3. Requisitos

1. **`InventoryCard` con el diseño C**, en teléfono y escritorio. Hoy el escritorio ya tiene la foto
   a la izquierda (`sm:`): pasa a ser el mismo diseño a todo ancho.
2. **La distribución compacta** es una regla pura (`compactDistribution(distribution, quantity)` →
   grupos `{type, count, unitsEach}`, vacía si `quantity <= 1`), con test. El dibujo de cada grupo
   reutiliza los glifos de `DistributionJengaViz`.
3. **⋯ sigue siendo el menú de hoy** (Distribution con sus + / −, imprimir, foto, historial), que
   hoy cuelga de la caja de distribución.
4. **Modo picking:** «Fully reserved», «n Res / n Avail» y el selector del carrito siguen debajo de
   los botones, como hoy.
5. **La búsqueda trae lo que la tarjeta enseña**: `search_inventory_with_metadata` añade
   `sd_number`, `rma` y, para una devolución, la primera foto de `sku_photos` como `image_url` cuando
   este es NULL (DROP + CREATE con los mismos argumentos, como `20261006125642`). Se actualizan los
   cuatro lugares (migración, Zod, tipos ×2, `inventoryApi`).
6. **`InventoryCard` es la única tarjeta**: Stock, búsqueda, filtros y el modo picking la comparten.

## 4. Casos de verificación (430 px)

| #   | Caso                    | Resultado esperado                                                          |
| --- | ----------------------- | --------------------------------------------------------------------------- |
| 1   | 03-3978BL (247 u)       | foto Citizen; `H 247`; distribución `8×30 │ 1×5 │ 1×4`; ~145 px             |
| 2   | 03-4470BK (S/D #75)     | chip S/D y `#75` sobre la foto; serial WMGC00005; sin distribución          |
| 3   | 02-3661GY (PH, 1 u)     | chip PH; «Missing rear wheel, missing handlebar»; sin distribución          |
| 4   | 777420118898            | la etiqueta de FedEx como foto, chip RET; `RMA 865617 · 1 d`                |
| 5   | 03-3982BL en 0          | tarjeta punteada; sin distribución                                          |
| 6   | Una PH sin foto         | lo que diga el ❓1                                                          |
| 7   | Stock con filtro Return | ≥ 6 tarjetas por pantalla, la más nueva arriba                              |
| 8   | Modo picking            | reservas y carrito debajo de los botones; tocar la tarjeta añade al carrito |

## 5. Preguntas (❓ con respuesta por defecto)

1. **❓ Sin foto (193 bicis).** Por defecto el hueco es **gris con una cámara**, y **tocarlo abre la
   cámara** para hacer la foto ahí mismo (como en la ficha); el resto de la tarjeta sigue abriendo la
   ficha. Así el hueco empuja a llenar el catálogo. La alternativa es encoger la columna a nada cuando
   no hay foto.
2. **❓ Tocar la foto con foto.** Por defecto abre la ficha, como el resto de la tarjeta. La
   alternativa es ampliarla (lightbox).
3. **❓ Las partes** (Stock → Parts): por defecto **el mismo diseño**. Casi ninguna tiene foto, así
   que con el ❓1 por defecto todas llevarían el hueco gris. La alternativa es dejar las partes como
   hoy.
4. **❓ La nota de posición y el dato del tipo a la vez** (una S/D con nota): por defecto van en la
   misma línea, primero el dato del tipo, y lo que no cabe se corta con «…».
5. **❓ La distribución con una unidad pero varias cajas** no existe: una unidad es una caja. Con
   `quantity <= 1` no se dibuja nada, sin más casos.

## 6. Fuera

- Cambiar qué se puede hacer desde la tarjeta: sólo cambia cómo se ve.
- La ficha (item card) y Double Check.

## Decisiones

- **6 oct 2026 — Rafael elige la C** entre las tres del HTML (A una lectura, B banda de tipo, C foto
  primero), con la distribución compacta de su boceto y **sin distribución cuando queda una unidad**.
- **6 oct 2026 — Rafael: «bien, elegida C, 4 × 30, fondo de imagen negra siempre que se pueda».**
  El separador de la distribución es `×` (se probó `/` y se descartó). La columna de la foto tiene
  **fondo negro**: una foto de catálogo con fondo transparente queda sobre negro, y una sin foto
  (❓1) también es un hueco negro.
