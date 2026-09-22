# Añadir una parte a una orden ya completada, desde Ship

> Estudio previo al código. Cada pregunta abierta va con ❓ y una respuesta por defecto: si no se
> contesta, se construye el default.
>
> Rafael, 22 sep 2026: «el sistema crasheó cuando pongo una part extra en la orden manualmente, lo
> cual debería llevarme a edit order en add item to order con el buscador en escrito part, sin aun
> reabrir la orden hasta que presione recomplete, en donde recién se reabre, se agrega el ítem
> seleccionado y se completa de nuevo».

## 1) Qué pasa hoy

Once gestos y **dos razones para un solo hecho**, con la orden fuera de `completed` en medio:

| #     | Gesto                                                                                    | Qué escribe                                                  |
| ----- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1-2   | `⋯` → **Reopen Order**                                                                   | —                                                            |
| 3-4   | razón (obligatoria, `disabled={!reopenReason}`) → **Reopen**                             | `status = reopened`, `completed_snapshot`, auto-cancel a 2 h |
| 5     | el drawer se abre a pantalla completa; Edit Order se abre solo (`reopenedAutoOpenedRef`) | —                                                            |
| 6-7   | bajar hasta **Add Item** → teclear                                                       | búsqueda                                                     |
| 8-9   | tocar el resultado → **razón otra vez**                                                  | —                                                            |
| 10    | **Add to Order**                                                                         | `items`                                                      |
| 11-12 | **Done Editing** → **Re-Complete**                                                       | delta contra el snapshot                                     |

En una combinada, dos gestos más: el selector de sub-orden y los chips de «Add to».

**Cinco defectos medidos, no opiniones:**

1. **La orden vive en `reopened` del gesto 4 al 12.** Si el teléfono se bloquea ahí se queda así —
   es la misma familia que las stuck-in-reopened con su «Continue Editing / Take Over», y el estado
   donde `process_picking_list` y el snapshot se pisan (17 sep 2026).
2. **El buscador trae bicis primero.** `CorrectionModeView` lanza dos consultas de 15
   (`showParts:false` + `showParts:true`) y las concatena: para una parte hay que pasar por encima
   de hasta quince bicis en un teléfono. La API ya sabe filtrar; aquí nadie usa el filtro.
3. **`.filter(inv => inv.quantity > 0)`**: una parte sin stock **no se puede añadir**, que es justo
   el caso del add-on que llega suelto al mostrador.
4. **Dos razones** para un solo hecho: el cliente pidió algo más.
5. Edit Order ocupa la pantalla entera: la estación pierde de vista Ship — los cuatro números, la
   dirección, el carrier — justo mientras decide.

### 1.1 El campo `PARTS` a 0 es una puerta falsa

`ShipScreen.tsx` — `avgPartWeight = partUnits > 0 ? … : 0.1`.

En una orden **sin partes**, teclear `PARTS 1` declara un bulto que **pesa 0,1 lb**, no tiene SKU, no
sale en el packing slip, no se descuenta de inventario y no aparece en ninguna fila. Es un número que
sólo viaja a Audit Source y miente en todo lo demás. Interceptar ese toque no le quita el gesto a
nadie: tapa un agujero.

**Con partes el mismo campo sí sirve:** 3 unidades pueden ir en 1 caja y corregir lo que se teclea en
el portal es legítimo. Ahí el promedio es real y el peso se mueve de verdad. De ahí sale la asimetría
de §3.

## 2) Alcance

**Sólo partes.** Una parte no cambia nada más: no fuerza Regular (la regla es ≥5 bicis), no entra en
la geometría del bulto y su peso va por el promedio que Ship ya calcula. Una **bici** cambia el
reparto de pallets, la clasificación FedEx y la ruta de recogida: eso sigue siendo Edit Order con
reopen, y está bien que cueste más.

## 3) La interacción: una hoja, dos puertas

|                  | **0 partes**                                    | **≥1 partes**                                                                           |
| ---------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| La cifra `PARTS` | enseña `–` y **es un botón**: abre _Add a part_ | sigue siendo el campo que se teclea (hoy)                                               |
| Dónde se añade   | en la propia cifra                              | fila **`+ part`** al pie del bloque _Parts Weight_, que ya lista cada parte con su peso |
| Qué se abre      | **la misma hoja**                               | **la misma hoja**                                                                       |

Dos puertas, cada una donde el operador ya está mirando, y **cero furniture nueva** para la mayoría de
órdenes, que no llevan partes.

### 3.1 La hoja (Modal Manager, no dentro de la tarjeta)

```
ADD A PART                                        ✕
┌──────────────────────────────────────────────┐
│ 🔍 Search parts…                             │
└──────────────────────────────────────────────┘
  12-8338KW   FORK HYENA 26          H28   120 avail
  71-0380     TUBE 26×1.95            E5   514 avail
  ── no stock ─────────────────────────────────────
  66-0382BK   SEATPOST                E47    0
  ──────────────────────────────────────────────
  + Ship a box PickD doesn't know
```

- **Buscador acotado a partes** — una consulta en vez de dos, y todo lo que sale es del tipo que se
  busca. **No** lleva la palabra «part» escrita en la caja: eso buscaría SKUs llamados «part». Lleva
  el alcance dicho arriba y el foco puesto.
- **Con stock arriba, sin stock abajo y marcadas.** La caja está en el mostrador; negarse a
  declararla es peor que declararla.
- Cantidad **1** por defecto.
- **Una razón**, con `Customer add-on` preseleccionada (ya existe en `ReasonPicker`).

### 3.2 El bulto que el catálogo no conoce

Rafael, 22 sep 2026: «con opción de enviar part no registrada en pick, donde se le pide peso y en qué
pallet va al usuario, con opción de pallet separada».

Al pie de la hoja, una entrada propia que pregunta **tres cosas y nada más**:

```
SHIP A BOX PICKD DOESN'T KNOW
  Label (optional)   [ HYENA FORK — no SKU        ]
  Weight             [ 12 ] lbs
  Rides on           [ #1 ] [ #2 ] [ OWN PALLET ]
```

- El **peso** es obligatorio: sin SKU no hay catálogo de donde sacarlo, y el peso es para lo que
  existe Ship.
- **En qué bulto va** es la misma pregunta de §8.2 del PRD de pallets, contestada aquí por primera
  vez. `OWN PALLET` añade una fila a la tabla de bultos con sus medidas a mano.
- No toca inventario **nunca**: PickD no tiene esa caja registrada, así que no hay nada que
  descontar. Ver D3.

### 3.3 Lo elegido queda pendiente, no escrito

El resultado **no escribe nada todavía**. Queda en la tarjeta como una fila ámbar y aparece un botón:

```
  + 1 × 12-8338KW  FORK HYENA 26 · pending          [ RE-COMPLETE ]
```

Si el navegador se cierra antes de pulsar, se pierde lo elegido y **la orden sigue completada y
correcta** — estrictamente mejor que el fallo de hoy, donde lo que se queda colgado es la orden.

**Cinco gestos en vez de once, una razón en vez de dos, cero segundos en `reopened`.**

## 4) Qué se escribe, y cuándo

Dos caminos, y la regla que los separa es una sola: **si el catálogo lo conoce es un ítem de la
orden; si no, es un bulto declarado.**

### 4.1 Parte del catálogo → una transacción

`add_items_and_recomplete(p_list_id, p_items jsonb, p_reason, p_pallets_qty, p_total_units,
p_performed_by, p_user_id, p_user_role)`: reabre, añade las líneas, recompleta por delta. Precedente
exacto: `cancel_combined_order` — a mitad de un bucle del cliente que falla queda la orden en el
estado que la RPC vino a arreglar.

**Verificado que la secuencia es segura:** `compensate_picking_list_changes` es un **noop** mientras
`NEW.status = 'reopened' OR OLD.status = 'reopened'` (`20260505200000`, caso 7), así que el descuento
lo hace el delta del recomplete y sólo él. Es lo que ya ocurre hoy, sin los minutos de ventana humana
en medio.

### 4.2 Bulto no registrado → una declaración, sin reabrir

No es un ítem: no hay SKU, no hay stock, no hay nada que descontar. Va a un side-car en la misma fila,
hermano de `pallet_dims` y con el mismo contrato (se guarda **sólo lo que tecleó una persona**, todo
lo demás se recalcula):

```sql
alter table picking_lists
  add column if not exists extra_cartons jsonb not null default '[]'::jsonb;
-- [{ "id": "…", "label": "HYENA FORK", "weight_lbs": 12, "pallet": 2 }]
-- pallet: número de bulto, o "own" para tarima aparte
```

Se guarda con autosave, la orden **no sale de `completed`** y no hace falta Re-Complete. Cuatro
lugares que actualizar al añadir la columna (migración, Zod, tipos Supabase, selects explícitos) — la
regla de siempre.

## 5) Qué mueve cada cosa en los cuatro números

|                                            | `PALLETS`                    | `BIKES` | `PARTS` | `WEIGHT`                             |
| ------------------------------------------ | ---------------------------- | ------- | ------- | ------------------------------------ |
| Parte del catálogo, con stock              | —                            | —       | +qty    | + peso real del catálogo             |
| Parte del catálogo, sin stock              | —                            | —       | +qty    | + peso real del catálogo             |
| Bulto no registrado, en un bulto existente | —                            | —       | +1      | + el peso tecleado                   |
| Bulto no registrado, `OWN PALLET`          | la tabla enseña una fila más | —       | +1      | + el peso tecleado + 40 lb de tarima |

`pallets_qty` lo sigue tecleando la estación: cuando la tabla no coincide, la cabecera lo dice en
ámbar (`· Pallets says N`) y manda el número tecleado. Mecanismo que ya existe; no se añade otro.

## 6) Decisiones

- **D1 — La puerta depende de lo que hay, la hoja no.** Dos entradas, una sola pantalla de añadir. Un
  gesto distinto para el mismo trabajo se olvida.
- **D2 — Con 0 partes la cifra deja de ser campo.** No se pierde nada: lo que se perdía era un bulto
  de 0,1 lb sin SKU. Quien de verdad quiera declarar una caja suelta tiene §3.2, que además pregunta
  el peso.
- **D3 — Lo que PickD no conoce no toca inventario.** Ni se registra al vuelo: el alta de un SKU es
  un gesto deliberado con tipo, ubicación y cantidad (el agujero de las 96 huérfanas de agosto). Un
  bulto declarado no es un alta de catálogo.
- **D4 — Sin stock se declara, no se descuenta.** La línea nace `insufficient_stock`, que es
  exactamente lo que `process_picking_list` ya sabe saltar. El papel y el peso salen bien y el
  estante no afirma unidades que no tiene.
- **D5 — Una razón.** La de reabrir y la de añadir son el mismo hecho. La RPC escribe las dos notas
  con ese texto.
- **D6 — Nada se escribe hasta Re-Complete.** Es lo que pidió Rafael y además invierte el modo de
  fallar: hoy se pierde la orden, así se pierde una elección de diez segundos.
- **D7 — Sólo partes.** §2.
- **D8 — Orden ya enviada (`is_shipped`): la puerta no aparece.** Añadir a algo que salió del
  edificio es otra conversación (la misma frontera que ya marca `requires_unship` al cancelar).

## 7) Preguntas abiertas

- ❓ **En una combinada, ¿a qué sub-orden va la parte?** _Default:_ a la que esté filtrada; sin
  filtro, los mismos chips `#881514 · #881513` que ya usa Edit Order.
- ❓ **¿La parte añadida cambia las medidas del bulto donde viaja?** _Default:_ no. Las medidas son de
  quien tiene la cinta; la fila queda tecleable como siempre.
- ❓ **¿Se puede añadir más de una parte antes de Re-Complete?** _Default:_ sí — la RPC recibe un
  array. Es gratis y evita dos reopens seguidos.
- ❓ **¿El bulto no registrado sale en el packing slip?** _Default:_ sí, con su label y su peso, al pie
  de la tabla de ítems. Un bulto que va en el camión y no está en el papel es una reclamación.

## 8) Casos de verificación (números exactos)

1. **Orden de 10 bicis, 0 partes, 1 pallet.** Antes: `1 · 10 · – · 490`. Se añade `71-0380` ×1
   (0,3 lb, 514 en E5). Después: `1 · 10 · 1 · 490` (490,3 redondea a 490), E5 pasa a 513, un log
   `DEDUCT`, `completed_snapshot` borrado al terminar y la orden **nunca se ve en `reopened`**.
2. **La misma con una parte sin stock** (`66-0382BK`, 0 en E47, 1,2 lb): `1 · 10 · 1 · 491`,
   **inventario intacto**, línea marcada `insufficient_stock`.
3. **Bulto no registrado de 12 lb en el bulto #1:** `1 · 10 · 1 · 502`, cero escrituras en
   `inventory`, cero en `items`, una entrada en `extra_cartons`.
4. **El mismo con `OWN PALLET`:** la tabla enseña `#1` y `#2`; `#2` va sin bicis, 52 lb (12 + 40 de
   tarima) y sus tres casillas vacías; la cabecera avisa `· Pallets says 1` hasta que la estación
   teclee 2.
5. **Combinada de dos órdenes, filtro en `#881513`:** la parte cae en `881513` y el `items` de
   `881514` no cambia.

## 9) Fases

- **F1 — La hoja y la transacción.** Las dos puertas, el buscador acotado, el pendiente, la RPC.
  Cubre el caso que Rafael reportó.
- **F2 — El bulto que PickD no conoce.** `extra_cartons`, peso, bulto y `OWN PALLET`, y su fila en la
  tabla de bultos.
- **F3 — La columna `parts` de la tabla** (§8.2 de `ship-pallet-dimensions.md`): repartir a mano las
  partes que ya trae la orden. F2 deja el sitio donde se guarda.

## 10) Revisión

430 px apaisado antes de darlo por hecho: la hoja a pantalla completa, y la fila pendiente en la
tarjeta sin partir el renglón de los cuatro números.
