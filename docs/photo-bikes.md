# Photo bikes (PH)

Estado al 5 oct 2026. Medido contra prod ese día. **Todavía no hay código**: este documento junta
lo que se sabe, lo que falta saber y el camino propuesto, para que la investigación (agy) y la
implementación partan de aquí. Las decisiones se **agregan al final** con fecha; el cuerpo no se
reescribe.

## 1. Qué es una photo bike

Rafael, 5 oct: «photo o PH significa que esta es un prototipo o bicicleta destinada a abrirse y
fotografiarse y por eso cambia su tipo o etiqueta, no es nueva, no es sd, pero es photo y debe ser
posible etiquetarla como tal».

- **No es nueva y no es S/D.** Es un tercer tipo. Una bici no puede ser PH y S/D a la vez.
- **No confundir con la faceta Photo de Stock** (`With photo` / `Needs photo`, `stockFacets.ts`):
  esa dice si el SKU tiene foto subida y no cambia.
- **Vive físicamente en la ubicación `PHOTO`** (LUDLOW), creada el 5 oct 2026.

## 2. Lo que pidió Rafael (5 oct)

1. Un **filtro PH** en Stock: opción en Filters → Condition **y** pestaña propia, junto a S/D.
2. Un **tipo PH que funciona como la marca S/D**: marca manual en la ficha y **` PH` al final del
   nombre**, puesto y quitado por la base como ` S/D` (`sd_item_name()`). Sin número `#n`.
3. **Separada de una bici normal aunque compartan SKU.** «Si tiene el mismo sku que una bicicleta
   regular no tratarlas como iguales, debe ser separada para que detalles como un cambio en el nombre,
   una foto y otros no afecten las bicicletas que no son photo».
4. **Pedidos:** una PH solo sale si la línea de la orden dice PH. «Si no dice ph no se toma una; si no
   hay stock regular pero sí una PH, se puede informar al usuario pero no mandarle a recoger una ph».
   No son compras frecuentes.

## 3. Por qué el punto 3 es el difícil

Nombre, foto, notas de ficha y `serial_number` cuelgan de `sku_metadata`, **una fila por SKU**. Una
marca a nivel de SKU (como S/D) marca todas las unidades de ese SKU. La propia S/D no lo resolvió:
154 de las 196 S/D usan un SKU normal (`DD-NNNN[CCC]`) y el resto usa el serial como SKU.

**Registrar bici por serial todavía no es posible.** `sku_serials` (21 sep 2026) guarda una fila por
caja escaneada (23 filas al 5 oct), pero es un registro de observaciones, no la identidad de la
unidad: el inventario sigue siendo SKU × ubicación × cantidad. Mover el inventario a unidades con
serial es un rediseño mucho mayor que PH.

## 4. Lo que hay en `PHOTO` (5 oct 2026)

**10 SKUs `02-` (11 u).** El AS400 registra las photo bikes con SKU `02-` (Rafael: «la mayor parte
del tiempo estas comienzan con 02-»). Para estas no hay conflicto: el SKU `02-` ya es solo de la PH, y
una marca en la ficha basta.

| SKU                                                                         | u     | Nota                                                                                                                  |
| --------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| 02-3054TL                                                                   | 2     |                                                                                                                       |
| 02-3510BL, 02-3517BL, 02-3524BK, 02-3987GY, 02-4009SL, 02-4092BL, 02-4614GN | 1 c/u | Movidas de `RETURN TO STOCK` el 5 oct (MOVE, sin nota)                                                                |
| 02-3661GY                                                                   | 1     | **Marcada S/D por error** (sin `#n` ni categoría): es PH. Nota de inventario: «Missing rear wheel, missing handlebar» |

Se quedaron fuera los dos `02-` que son pedales (02-2404BL, 02-5352WH, en E47): empiezan por `02-`
pero no son bicis. **`02-` no basta para decir PH; hace falta `is_bike`.** De las 29 bicis `02-` del
catálogo, 13 están marcadas S/D: alguna puede ser una PH mal marcada.

**25 SKUs que no son `02-` (26 u): 20 `03-` y 5 `07-`.** Rafael confirma que son photo bikes. Estas
comparten SKU con la bici normal, que es el caso del punto 3:

- Con stock normal en otra fila: 03-3919GN (ROW 24), 03-4229BL (ROW 37), 03-4230BL (ROW 38),
  03-4627BR (ROW 9), 03-4631GY (ROW 29), 03-4666BR (ROW 3 y 4).
- Solo en PHOTO: 03-3300BL, 03-3313GY, 03-3933WH, 03-4638GY, 03-4639GN, 03-4648BK, 03-4649PU,
  03-4657GN, 03-4660BL, 03-4667BK, 03-4674BL, 03-4680BK, 03-4686GY, 03-4698BL, 07-3709BK,
  07-3718BL (2 u), 07-3721RD, 07-3722PU, 07-3723BK.

## 5. Riesgo vigente: el picking puede mandar a PHOTO

`PHOTO` nació con `pick_priority = 'normal'` (`.claude/rules/database.md`), igual que un estante. Hoy:

- Para los 6 SKUs con stock normal, el plan puede elegir PHOTO si queda antes en el recorrido.
- Para los 19 que solo están en PHOTO, una orden normal va directo a la PH.
- Las 8 `02-` que salieron de `RETURN TO STOCK` (`last`) pasaron a una ubicación `normal`: el
  movimiento del 5 oct las volvió **más** fáciles de recoger.

**Mitigación mínima propuesta, sin aplicar:** `pick_priority = 'last'` en `LUDLOW / PHOTO`. Así PHOTO
nunca gana a un estante normal. No cubre los 19 que solo están en PHOTO, porque `last` igual se toma
cuando es la única opción. Para eso falta la regla «nunca una PH, solo avisar» (punto 2.4).
El 5 oct el `UPDATE` lo bloqueó el permiso de la sesión; queda para que Rafael lo autorice o lo
aplique:

```sql
update locations set pick_priority = 'last', updated_at = now()
where warehouse = 'LUDLOW' and location = 'PHOTO';
```

`pick_priority` todavía no se edita desde PickD (idea-216).

## 6. Camino propuesto (sin decidir)

1. `sku_metadata.is_photo`, exclusiva con `is_scratch_dent`. Al marcarla, ` PH` al final del nombre
   (mismo patrón que `tr_sku_metadata_sd_item_name` / `tr_inventory_sd_item_name`).
2. Pestaña PH en Stock y opción `PH` en Filters → Condition (`stockFacets.ts`, `cond`).
3. Marcar las 10 `02-` de PHOTO. 02-3661GY pasa de S/D a PH.
4. **Para las PH con SKU normal (`03-`, `07-`):** un SKU propio con sufijo, `03-4229BL-PH`. Se mueve
   la unidad al SKU nuevo con una copia de la ficha. Desde ahí nombre, foto y notas quedan separados,
   y el picking no la ve como la bici normal. `canonical_sku()` deja `-PH` intacto (probado en prod
   el 5 oct). Depende de la pregunta 7.1.
5. Picking: si la línea no dice PH y solo hay PH, avisar sin asignarla.

## 7. Preguntas abiertas (para agy y para el piso)

1. **¿El AS400 cuenta las PH `03-`/`07-` dentro de su SKU?** (5 oct: no se sabe.) Si las cuenta,
   `v_inventory_vs_as400` tiene que sumar `-PH` a su SKU base o aparecerán como faltantes. Si no, o
   si existe un `02-` para esa bici, conviene usar el `02-` en vez de inventar `-PH`.
2. **¿Cómo se corresponde un `02-` con su SKU normal?** Hace falta para el aviso «no hay normal, hay
   PH» del punto 6.5.
3. **¿Cómo llega una línea PH en el PDF de la orden** que lee el watchdog? ¿SKU `02-`, nombre
   terminado en PH, otra cosa?
4. **¿Cuáles de las 13 bicis `02-` marcadas S/D son PH?**

## Decisiones

- **5 oct 2026 — Lo mínimo hasta tener más información** (Rafael: «avancemos con lo mínimo hasta
  tener más información sobre cómo manejar esto»). Solo se documenta. No hay marca PH, ni filtro, ni
  SKU `-PH` hasta responder 7.1. La mitigación del punto 5 queda pendiente de autorización.

## Hallazgos verificados

- **5 oct 2026 — estudio de agy (`docs/photo-bikes-agy-2026-10-05.md`, gemini-3.1-pro-high),
  verificado contra prod el mismo día.** Propone dos opciones: sufijo `-PH` con `base_sku`, o el
  serial como SKU con `base_model_sku` (recomienda esta). Son las dos que ya estaban sobre la mesa.
  Lo que se sostiene y lo que no:
  - **Cierto: el AS400 marca las PH con `PHTO` al final de la descripción.** Solo en SKUs `02-`: 13 de
    las 29 bicis `02-` del catálogo. Entre las 13 suman **2 u** en NJ, así que el AS400 casi no tiene
    PH en mano. Es el detector fiable de una PH `02-`; `02-` sin `PHTO` no basta.
  - **Probable, no probado: el AS400 no cuenta las PH `03-`/`07-`.** En `v_inventory_vs_as400`, 5 de
    los 6 SKUs con stock normal y una PH dan exactamente **+1** para PickD (03-3919GN, 03-4229BL,
    03-4230BL, 03-4627BR, 03-4631GY). 03-4666BR da −8. Pero la lectura del AS400 es del **12–13 sep**,
    no de hoy, y el 31 % de los SKUs de la vista (616 de 2000) ya difieren por otras razones. agy lo
    presenta como un «NO» rotundo con hora de hoy: exagera.
  - **Falso: que el sufijo `-PH` obliga a cambiar el picking.** Un SKU distinto es invisible al plan
    de una orden normal, igual con `03-4229BL-PH` que con un serial. La fila «Protección en picking»
    de su tabla comparativa está mal y pesa a favor de su recomendación.
  - **Rutas equivocadas:** `src/features/stock/api/stockFacets.ts` no existe (es
    `src/features/inventory/utils/stockFacets.ts`). `generatePickingPath` vive en `src/`
    (`PickingContext.tsx`, `usePickingActions.ts`), no en `supabase/functions/`.
  - **Le faltó:** casi ninguna afirmación trae archivo:línea ni consulta, aunque el brief lo pedía.
    Además, pasar una PH `02-` a su serial la separa del SKU con el que la pide el AS400 en una orden.
- **5 oct 2026 — estudio propio de Claude: `docs/stock-bicis-estudio-2026-10-05.md`.** Hallazgo
  central: el AS400 ya da número propio a cada bici especial (`01-NNNN` por S/D con el serial en la
  descripción; `02-` para photo y demo). Recomienda la opción A (artículo propio, `unit_kind` +
  `base_sku`, SKU provisional que se renombra con `rename_sku_everywhere`) ahora, y la capa de
  unidades (B) cuando idea-244 haga fiable el serial. Responde 7.4: las 13 bicis `02-` marcadas S/D
  son 12 DEMO y la PH `02-3661GY`.
- **5 oct 2026 — Rafael responde las ❓ del estudio:**
  - **DEMO cuenta como PH.** Las 12 `02-` DEMO marcadas S/D son PH. `unit_kind` queda en tres valores:
    `new` / `sd` / `photo`.
  - **Los SKUs nuevos los asigna Jayme en el AS400, y a veces reusa los de bicis ya vendidas.** Solo
    asigna cuando la bici tiene precio y está revisada por completo, con cada punto que el comprador
    necesita saber. Consecuencias para la opción A:
    - **El SKU provisional no es un estado raro: es la regla mientras la bici no esté lista para
      venderse**, y puede durar semanas. Coincide con `sd_for_sale = 'not_yet'`: «sin número del
      AS400» y «todavía no se vende» describen la misma etapa.
    - **Reusar un número es práctica, no error** (bug-055 deja de ser un bug del AS400). Renombrar
      provisional → número reusado **no puede ser `rename_sku_everywhere` a secas**: si el destino
      existe, fusiona y se queda con los valores de la bici vieja, rellenando solo los huecos
      (`20260826220000_canonical_sku.sql`). Antes hay que archivar la ficha vendida (qty 0) bajo otro
      nombre, o hacer una variante del rename que gane la ficha nueva.
- **5 oct 2026 — `LUDLOW / PHOTO` pasa a `pick_priority = 'last'`** (autorizado por Rafael, aplicado y
  verificado en prod). PHOTO ya no le gana a un estante normal. Los 19 SKUs que solo tienen stock en
  PHOTO todavía se pueden recoger ahí; eso lo cierra la separación por SKU de la opción A.
- **5 oct 2026 — Confirmado: el AS400 no cuenta las PH dentro del SKU del modelo.** Rafael miró
  `03-4229BL` en NJ: **5**. PickD tiene 6 (5 en ROW 37 + la PH en PHOTO). Responde 7.1: sacar cada PH
  `03-`/`07-` a su propio SKU **arregla** el +1 contra el AS400 en vez de crearlo, y no hace falta que
  `v_inventory_vs_as400` sume nada a su SKU base.
