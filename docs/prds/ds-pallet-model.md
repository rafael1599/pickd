# Todo es pallet: la DS pallet (base + top) y la line pallet (idea-254)

Estudio, 6 oct 2026. Rafael: «ya no existen lines por sí solas, sólo lines sobre una pallet y esa es
otro tipo de pallet. No hay torres, sólo pallets ahora… todo es más seguro y ordenado para el
warehouse». Retoma el dictado del 10 sep (`.agent/management/research/2026-09-10-dictado.md` §11:
«una de 18 unidades y una de 12 que se unen para formar una DS pallet o torre como antes se
llamaba»). Las 17 preguntas se hicieron con una propuesta cada una; Rafael: «las bicis de niño son
excepciones a estas reglas y los usuarios las arman como les parezca, me parece bien todo lo demás».

## 1. Las cifras (prod, 6 oct 2026, filas ROW de bici con stock)

| Grupo guardado hoy | Grupos | Unidades                        |
| ------------------ | ------ | ------------------------------- |
| TOWER              | 146    | 5.408 (100 torres de 30 justas) |
| LINE               | 544    | 2.167                           |
| PALLET             | 44     | 337                             |
| Pallets de 18 o 12 | 0      | —                               |

| Unidades en la fila | Filas |
| ------------------- | ----- |
| ≤ 12                | 391   |
| 13–18               | 28    |
| 19–29               | 37    |
| 30                  | 8     |
| 31–60               | 68    |
| > 60                | 29    |

Caja de adulto típica **55 × 9 × 30"** (mediana de 345 bicis medidas; la más alta 42"); madera **5"**.

## 2. Las reglas (decididas el 6 oct 2026)

**Qué es cada pallet**

1. **Base** = 18 bicis sobre su madera, en el piso. **Top** = 12 sobre su madera, siempre encima de
   una base. **DS** = base + top en un cuadro = 30.
2. **Line pallet** = 1–12 bicis en el piso, sin nada encima. Un top con menos de 12 sigue siendo top:
   lo define estar encima de una base.
3. **Una DS es de un solo SKU.**
4. **Encima de una base sólo va un top**, nunca una line pallet ni otra base.
5. **Un cuadro = una madera en el piso**: una DS, una base sola o una line pallet. Dos line pallets no
   comparten cuadro.

**Cómo cambian con los picks**

6. **Se recoge del top primero.** Cuando el top llega a 0 se quita su madera y la DS queda como base
   («una DS que llega a tener menos de 19 se convierte automáticamente en una base»).
7. **Una base sigue siendo base hasta vaciarse**; no pasa a line pallet.
8. **Un top a medias sigue siendo top** (18 + 7 = 25).

**Cómo se arma lo que llega**

9. N bicis de un SKU: tantas **DS de 30** como quepan; el resto r: **19–29** → DS incompleta (base 18 +
   top r − 18); **13–18** → base de r; **1–12** → line pallet de r. 41 = 1 DS + line pallet de 11;
   52 = 1 DS + DS de 22.
10. **Las bicis de niño son la excepción** (`isSmallBikeSku`, la regla de Ship): los usuarios las
    arman como les parezca. PickD no les propone ni les recalcula pallets; se editan a mano.
11. **Partes y lo que no es almacén** (containers, CAGE, FDX, RETURN TO STOCK) no llevan pallets.

**Los datos de hoy**

12. **Se recalculan los grupos desde la cantidad con la regla 9**, cuadro por cuadro, sin tocar
    unidades; auditoría vieja → nueva; ensayo con rollback contra prod; se aplica con el ok de Rafael.
    Las de niño conservan lo que tienen.
13. **Un cuadro vale máximo 30** (una DS); el tope de 45 se quita. Lo que pase de 30 por cuadro hoy
    (03-4034BK, 137 en ROW 34 · B) sale marcado para repartir, sin bloquear.

**Cómo se ve**

14. La tarjeta y Double Check dicen **`DS ×2 · base 18 · top 7 · line 4`**, con su dibujo, compactos
    por cuadro como hoy.

**La plataforma**

15. **Se mide con cinta** el alto de una base, de un top y de una DS en tres cuadros reales. Mientras,
    con cajas de canto (30") en capas de 6: base ≈ **95"**, top ≈ **65"**, DS ≈ **160"**.
16. **Plataforma cuando la caja a recoger empieza por encima de 60"** del piso. Con esas medidas, todo
    top la necesita y una base no; Double Check lo dice en la línea (`J · top · 🪜`).
17. **Alcance cómodo del picker más bajo: 72"** (6 ft).

## 3. Cómo encaja con lo que ya existe

- **El grupo de cajas lleva su cuadro** desde idea-253 (`square`): sirve igual con los tipos nuevos.
  Los tipos pasan de `TOWER | LINE | PALLET | OTHER` a **`BASE | TOP | LINE_PALLET`**; los viejos se
  siguen leyendo (un undo puede traerlos: 4.654 logs guardan la forma vieja) y el trigger los
  normaliza al escribir.
- **De qué cuadro se recoge** (`plan_square_picks`) no cambia; dentro del cuadro, el orden pasa a ser
  **top → base → line pallet**, que cumple la regla 6 sin pasos extra.
- **El mapa** ya vale una DS de 30 por cuadro (`PALLET_UNITS`); sólo quita el 45.
- **Los pallets de Ship** (8/10/12 por pallet de envío) son otra cosa y no se tocan.

## 4. Fases

- **F1 — La regla.** `palletsFor(qty)` pura (TS) con su espejo SQL, el tipo nuevo en Zod/tipos y en
  `calculate_bike_distribution` (lo que nace nuevo ya nace en pallets). Test con los ejemplos del §2.
- **F2 — El descuento.** `deduct_from_groups` en orden top → base → line pallet; un top que llega a 0
  desaparece (la DS queda base). Validado con rollback.
- **F3 — Cómo se ve.** Dibujos de base, top y line pallet; tarjeta, editor de la tarjeta (+ elige
  Base / Top / Line pallet) y Double Check.
- **F4 — Los datos.** Recalcular las filas de adulto con auditoría; ensayo; **espera el ok**.
- **F5 — La plataforma.** Con las medidas de cinta, el aviso `🪜` en Double Check.

## Decisiones

- **6 oct 2026 — Rafael confirma las 17 propuestas** salvo la 10: «las bicis de niño son excepciones
  a estas reglas y los usuarios las arman como les parezca».
- **6 oct 2026 — Rafael: «sí, que se muestre de colores dependiendo si se va a necesitar plataforma
  para recoger bicicletas que se estén recogiendo en DCV».** F1 + F2 hechos (`20261007025547`):
  - `palletsFor` (TS) y `calculate_bike_distribution` (SQL) arman lo nuevo en base / top / line
    pallet; comparadas en prod para 0–150 unidades, 0 diferencias. Las de niño siguen con torres y
    líneas como punto de partida (`is_small_bike`, copia de `isSmallBikeSku`: 1.003 bicis, 0 que
    clasifiquen distinto).
  - El descuento va top → base → line pallet; un top en 0 desaparece y la DS queda base (validado: D
    base 18 + top 2, pick de 5 → base 15).
  - `plan_square_picks` dice cuántas salen de un top. **Double Check pinta la ubicación en rosa con
    `🪜 top` cuando el pick sale de un top**; sin top sigue en ámbar. Rosa porque los demás colores ya
    tienen dueño (ámbar = cuadro y sin guardar, morado = FedEx, naranja = S/D, celeste = PH, rojo =
    error, verde = comprobado).
  - **Ojo con la regla 16 al medir:** con mis propias estimaciones, la capa de arriba de una base
    completa (3 capas de 30") empieza a 65", sobre los 60". Si la cinta lo confirma, la plataforma
    también hará falta para las primeras 6 de una base llena; hoy sólo la marca el top.
  - Editor de la tarjeta: `+` ofrece Base (18) / Top (12) / Line pallet.
  - Sin hacer: F3 completo (el dibujo es provisional), F4 (recalcular los datos, espera ok) y el 45 →
    30 del mapa.
- **7 oct 2026 — Rafael: «dejar en loose todas las distribuciones que no son pallets… ojo no quitar la
  sublocation».** Hecho en `20261007165830` (ensayado con rollback; respaldo en
  `inventory_distribution_cleanup`): 2.352 filas (708 de bici adulta, 1.644 de partes) sin TOWER / LINE /
  OTHER; el PALLET viejo pasó a line pallet (≤ 12) o a la regla 18/12; 0 bicis de niño, 0 cantidades y 0
  letras tocadas. Quedan 120 grupos de pallet vivos. El trigger de cajas sólo arma al crear una fila en un
  ROW, y una fila con loose conserva sus letras. La tarjeta no enseña chip si la fila no tiene cajas.
  F4 deja de ser recalcular: el piso pone las pallets reales. Falta limpiar el código de torres y lines.
