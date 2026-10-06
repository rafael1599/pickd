# La ficha de una devolución de FedEx

Estudio, 6 oct 2026. Nada de esto está construido. Rafael: «más adelante refinaremos el flujo de
item detail para fdx returns… comencemos con un análisis y propuesta».

Desde idea-250 una devolución es una unidad (`unit_kind = 'return'`, SKU = tracking, `base_sku` =
el modelo, `rma`, `is_misship`, la etiqueta en `sku_photos`). El alta ya vive en la ficha. Lo que
falta es lo que pasa **después** del alta.

## 1. Lo que hay en prod (6 oct 2026)

| Dato                                 | Cifra                                                            |
| ------------------------------------ | ---------------------------------------------------------------- |
| Devoluciones                         | **64**; **62 u** siguen en el piso                               |
| Resueltas en 6 meses                 | **3**: 1 dispuesta (30 jul), 2 pasadas a su modelo (15–16 sep)   |
| Con modelo identificado (`base_sku`) | **4** (06-4438BK ×3, 12-8352KW)                                  |
| Con RMA / misship                    | 55 / 4                                                           |
| Nombre                               | 17 vacíos, el resto «FedEx Return <tracking>»: no dicen qué bici |
| Ubicación                            | FDX RETURNS 43 u · FDX 1 12 u · FDX 7 u                          |
| La más vieja en el piso              | 13 abr 2026: **176 días**                                        |

Las notas que la gente escribió dicen lo que la ficha no deja decir: «Kid bike», «Starlite» (qué
bici es) e «In row 20» (dónde está de verdad, aunque la fila diga FDX RETURNS).

**El módulo viejo tenía una salida y nadie la usaba.** Recibido → «processing» → (identificar el
modelo, condición, ubicación destino → `process_fedex_return_item` movía la unidad a su modelo) o
Dispose o S/D intake. En seis meses salieron 3 de 64. El alta funcionaba; el resto pedía demasiado.

## 2. Lo que hace hoy la ficha con una devolución (leído en `ItemCardView.tsx`)

1. **RMA, misship y modelo se ven pero no se editan** (una línea gris de solo lectura). Un RMA
   mal tecleado en el alta se queda así.
2. **La pegatina enseña nombre, modelo, talla, color y serial como «tap to add»**: campos de una
   bici de catálogo que en una devolución no se conocen.
3. **HOW MANY y Distribution** aparecen, y una devolución es siempre 1.
4. **⋯ → «Mark as S/D» aparece** en una devolución. Marcarla pone `is_scratch_dent`, el trigger
   `a_unit_kind_sync` la pasa a `sd` y deja de ser devolución sin decirlo.
5. **Rename SKU la convierte en unidad normal**: pierde `unit_kind`, RMA y misship (6 oct, ya
   anotado). Es el camino natural para corregir un tracking mal leído.
6. **No hay salida.** Para devolver una bici a su stock hay que editar dos fichas a mano (bajar
   aquí, subir allá) y el historial no las une. Disponer es Delete.
7. **Nada dice cuánto lleva esperando.**

## 3. La idea

**Una devolución es una pregunta abierta: qué bici es y a dónde va.** La ficha enseña sólo eso:
la etiqueta de FedEx, el tracking, cuánto lleva, el RMA y el modelo; y abajo **un solo botón,
RESOLVE**, con las tres salidas que existen en el piso.

```
┌──────────────────────────────────────────┐
│ ←  Item                              ⋯   │
├──────────────────────────────────────────┤
│ ┌──────────────────────────────────────┐ │
│ │ [foto etiqueta FedEx]          RET   │ │
│ │ 792270157942                         │ │
│ │ FedEx return · 162 d                 │ │
│ └──────────────────────────────────────┘ │
│  RMA      WC#: 8241                  ›   │
│  MODEL    06-4438BK  Hudson E1 …     ›   │
│  MISSHIP  ○                              │
│ ┌──────────────┐                         │
│ │ WHERE        │                         │
│ │ FDX 1        │                         │
│ └──────────────┘                         │
│  Shelf note · In row 20                  │
│                                          │
│ ┌──────────────────────────────────────┐ │
│ │              RESOLVE                 │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘

RESOLVE →  Back to stock   (as 06-4438BK, where?)
           S/D             (serial required)
           Dispose         (why?)
```

## 4. Requisitos

### F1 — la ficha dice lo que es (solo front, sin migración)

1. **Pegatina `skuOnly`** con la etiqueta de FedEx como foto, badge RET y debajo
   `FedEx return · N d` (días desde `created_at`). Sin nombre/modelo/talla/color/serial.
2. **Tres líneas editables**, cada una un toque: **RMA** (texto), **MODEL** (buscador de SKU de
   catálogo → `base_sku`; enseña el nombre del modelo), **MISSHIP** (interruptor). Se guardan con
   el Save de siempre.
3. **Al elegir el modelo**, el nombre de la devolución pasa a ser el del modelo (❓4), así buscar
   «Hudson» en Stock la encuentra. La caja (medidas y peso) se lee del modelo, no se copia.
4. **Fuera para una devolución:** HOW MANY, Distribution, Mark as S/D, Mark as PH. Se queda:
   Print label (imprime la de FedEx), Add/Change photo, Shelf note, Full history, Rename SKU.
5. **Rename SKU corrige el tracking y la deja devolución**: la ficha escribe `unit_kind`, `rma`,
   `is_misship` y `base_sku` en el SKU nuevo, como ya hace con una PH. Si el SKU nuevo ya existe se
   bloquea igual que hoy («already exists»): una devolución nunca se fusiona con otra ficha.

### F2 — RESOLVE: tres salidas, una RPC

6. **Back to stock** (❓1). Pide el modelo si no lo tiene y **dónde** (el `WherePicker` de
   siempre). Una transacción: la devolución queda en 0 e inactiva, el modelo +1 en esa ubicación,
   un MOVE con `previous_sku` = tracking y nota «FedEx return <tracking>» (lo mismo que escribía
   `process_fedex_return_item`). La ficha de la devolución no se borra: sigue contando en el
   informe de recibidas.
7. **S/D** (❓2). La devolución pasa a `unit_kind = 'sd'` **en su sitio**, con el tracking como
   SKU provisional hasta que Jayme le dé su `01-` (mismo criterio que una S/D nueva:
   `sd_for_sale = 'not_yet'`). Pide el serial, como toda S/D. `base_sku` se conserva.
8. **Dispose** (❓3). Pide una razón de una lista corta; DEDUCT a `DISPOSED` con la razón como
   nota, como el `dispose_fedex_return` que se borró.
9. **Una RPC**, `resolve_return(p_sku, p_action, p_model_sku, p_location, p_serial, p_reason, …)`,
   `authenticated` y `service_role`. Rechaza una ficha que no sea `return` o que ya esté en 0.

### F3 — los datos de hoy (tras ❓5)

10. Unificar FDX y FDX 1 en FDX RETURNS si son el mismo sitio. Revisar las dos «In row 20».

## 5. Casos de verificación

| #   | Caso                                                   | Resultado esperado                                                                           |
| --- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 1   | Abrir 792270157942                                     | RET, `FedEx return · 162 d`, RMA, MODEL 06-4438BK; sin HOW MANY ni Mark as S/D               |
| 2   | Corregir el RMA y guardar                              | `rma` nuevo en `sku_metadata`; 1 cambio en el Save                                           |
| 3   | Rename 792270157942 → 792270157943                     | la ficha nueva es `return` con el mismo RMA y modelo; las fotos se mudan (trigger del 6 oct) |
| 4   | Back to stock de 792270157942 a ROW 5                  | 06-4438BK +1 en ROW 5; la devolución en 0; un MOVE con `previous_sku` = tracking             |
| 5   | Lo mismo, visto desde una orden de 06-4438BK sin stock | el aviso «Not new» de Double Check pasa de 3 devoluciones a 2                                |
| 6   | S/D sin serial                                         | RESOLVE no se habilita: `Serial?`                                                            |
| 7   | Dispose                                                | DEDUCT con razón; la devolución en 0; sigue en el informe de recibidas de su semana          |
| 8   | Resolver una ya resuelta (otra pestaña)                | la RPC la rechaza; la ficha lo dice                                                          |

## 6. Preguntas (❓ con respuesta por defecto)

1. **❓ Back to stock = se suma al stock del modelo y la ficha de la devolución queda en 0.**
   Por defecto sí. ¿O una devolución en buen estado debe quedar marcada de algún modo (no «nueva»)?
2. **❓ Dañada → S/D en su sitio, con el tracking como SKU provisional.** Por defecto sí, y Jayme
   le asigna el `01-` después (Rename).
3. **❓ Razones de Dispose:** por defecto «Scrapped», «Kept for parts», «Sent back». ¿Hay otras
   salidas en el piso (devolver al cliente, garantía al fabricante)?
4. **❓ Al elegir el modelo, el nombre pasa a ser el del modelo.** Por defecto sí; el badge RET
   la distingue. La alternativa es «<nombre> RET» como el sufijo PH.
5. **❓ FDX, FDX 1 y FDX RETURNS ¿son el mismo sitio?** Por defecto sí y se unifican en FDX
   RETURNS (21 u se mueven solo de nombre).
6. **❓ Estado intermedio («inspected», condición good/damaged).** Por defecto **no**: el módulo
   viejo lo tenía y en seis meses resolvió 3 de 64. La decisión de RESOLVE ya es la inspección.
7. **❓ Antigüedad en Stock:** por defecto el filtro Return ordena de la más vieja a la más nueva.

## 7. Fuera de este estudio

- El alta (F2 de idea-250, hecha) y registrar desde la foto (idea-252).
- Color por tipo de unidad (idea-251).
