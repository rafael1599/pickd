# PRD: Mapa — editar en Plan y editar en Live, con el mismo gesto

**Estado:** Estudio, esperando las ❓ de Rafael — nada construido · **Fecha:** 2026-08-28 · **Autor:**
Rafael + PickD (`pickd-product-designer`) · **Backlog:** idea-173 · **Relacionado:** idea-170 (el mapa
medido, F1–F4 hechas), idea-171 (la capa "Propuesta"), `docs/design/LESSONS.md`,
`src/features/warehouse-map/`

---

## 1) Contexto y problema

Rafael (28 ago 2026): "quiero herramientas de edición live separadas de herramientas de edición
plan… poder mover un SKU a cualquier cuadro en plan y tener un botón de plan completado para que se
ejecute ese plan y se convierta en live… seleccionar un SKU y después seleccionar un cuadro para
moverlo, y que eso rearrange todo si se necesita o si está vacío el cuadro solo moverlo. Esa
funcionalidad y funcionalidad parecida era lo que me gustaba y por eso quise reemplazar con esto al
mapa antiguo. Quiero minimalism, intuitivo."

**Lo que hay hoy.** El mapa medido (`/warehouse-map?zone=…`) pinta el stock de `inventory` en cada
`ROW n · letra` y lista lo que no cabe, pero es **de solo lectura**: tocar un slot enseña sus SKUs,
tocar un SKU abre el detalle. Mover stock se hace fuera del mapa y con texto: **Consolidation**
("Where to put?", chips de letra, `ConsolidationMoveModal`) o el detalle del ítem → Movement. Nada
permite dibujar primero adónde va cada cosa y ejecutarlo después.

**Lo que había en el mapa viejo y se fue** (F4): pines y "move & pin" sobre la cuadrícula del plan
DS-pallet, y el SLOTTING VIEW de `zone.html` (mover un SKU de slot, exportar la lista de
movimientos). Vivían en un `localStorage` y no tocaban inventario: un plan que nadie más veía y que
había que ejecutar a mano.

**El dolor de hoy, en piso.** Bay 3 Norte y Bay 2 acaban de pasar a una letra por cuadro con una regla
razonable, "en el piso ya los iremos actualizando": cada corrección es abrir el ítem, cambiar la
letra, guardar — línea por línea, sin ver la fila. Y un reacomodo (vaciar una fila, juntar un modelo)
se decide en la cabeza y se ejecuta de memoria.

## 2) Objetivo

Sobre el **mismo dibujo**, dos herramientas separadas:

- **PLAN** — dibujar adónde va cada línea. Nada se mueve. Un botón, **PLAN COMPLETED**, ejecuta el
  plan y lo convierte en Live.
- **LIVE** — el mismo gesto, pero cada movimiento ocurre ahora, en `inventory`, con su log.

**Métrica:** una corrección de letra en piso = dos toques; un reacomodo de fila = un plan que otro
puede ver, y un botón.

## 3) Conceptos

- **Live** = lo que dice `inventory` (`location` + `sublocation`). Es lo que el mapa ya pinta.
- **Plan** = una lista de **movimientos** sobre Live (línea → cuadro destino), guardada en la base de
  datos por zona, visible para todos, con estado `draft → executed | discarded`. Se dibuja sobre
  Live como fantasmas. Hay **un plan borrador por zona** (❓ Q4).
- **Línea** = una fila de `inventory` (SKU · fila · cantidad · letras). En Plan una línea se mueve
  **entera**; la cantidad no se parte (❓ Q3).
- **Cuadro** = `ROW n · letra`. Un cuadro puede tener varias líneas (así está la DB: un estante de
  partes es un cuadro con 17 SKUs).
- **Mover dentro de la fila** = cambiar la letra: en la DB es `updateItem` (log `EDIT`), porque
  `move_inventory_stock` rechaza origen = destino. **Mover a otra fila** = `moveItem` con cantidad y
  letra destino (log `MOVE`). El plan sabe cuál es cuál (`kind: relabel | move`).

## 4) El gesto (igual en Plan y en Live)

1. **Tocar un cuadro con stock** → sus SKUs como chips (existe). En VIEW un chip abre el detalle
   (existe). En PLAN o LIVE, **tocar un chip lo levanta**: el chip se ilumina y aparece la barra
   `Moving 03-4085BK · 41 u — tap a square · ✕`. Un long-press en el chip sigue abriendo el detalle.
   Las líneas de **NOT ON THIS PLAN** (letra K/L, sin letra, `ROW 20B`) se levantan igual, tocándolas
   en la lista: así es como el piso las coloca.
2. **Tocar el cuadro destino:**
   - **vacío** → la línea va ahí.
   - **con una línea** → **intercambio**: la otra línea va al cuadro de origen (❓ Q2 — la
     alternativa es "empujar" la ocupante al siguiente cuadro vacío de su fila).
   - **con varias líneas** (un estante de partes) → la línea **se une**; no se reacomoda nada.
   - **en otra fila** → mismas reglas; el destino es `ROW m · letra`.
   - **el propio cuadro de origen** → nada, se suelta.
3. **En PLAN:** el movimiento se anota (fantasma en el destino, origen atenuado). Tocar un fantasma →
   `Remove from plan`. La barra dice `PLAN · 12 moves · 340 u` y ofrece **DISCARD** y
   **PLAN COMPLETED**.
4. **En LIVE:** una hoja de confirmación (`03-4085BK · 41 u · ROW 33 A → ROW 30 E · Move`) y el
   movimiento se ejecuta con las mutaciones que ya existen (`updateItem` si es la misma fila,
   `moveItem` si cambia de fila); el log es el de siempre; el mapa se refresca.
5. **PLAN COMPLETED:** una hoja con la lista (`12 moves · 340 u · 4 rows`). **Execute** los corre en
   orden, cada uno por la misma mutación que Live, y antes de cada uno **revalida la línea** (sigue
   viva; para un `move`, la cantidad planificada sigue disponible). Un movimiento que ya no aplica
   se marca `changed since planned` y se salta; el resto sigue. Al final: `11 of 12 moved · 1
skipped`; el plan queda `executed` con el resultado por movimiento; el mapa es Live otra vez.

## 5) Modos y herramientas — separadas, visiblemente

Un control segmentado en la cabecera de la zona: **VIEW | PLAN | LIVE**. VIEW es lo de hoy.

| Modo | Lo que se ve                                                                                                                         | Lo que hace un toque          | Color                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------- |
| VIEW | El stock; chips → detalle                                                                                                            | Leer                          | Como hoy                                                      |
| PLAN | Fantasmas del plan (borde **punteado** violeta, SKU al 60 %, `→`); origen atenuado; barra `PLAN · n moves`; DISCARD · PLAN COMPLETED | Anotar un movimiento          | **Violeta** (`#a78bfa`, el color "buried" del mapa), punteado |
| LIVE | El stock, sin fantasmas; barra `LIVE — moves happen now`                                                                             | Mover ahora, con confirmación | **Verde** de la app (`accent`), sólido                        |

Nada más aparece en ningún modo: ni cantidades (❓ Q3), ni arrastre, ni menús. Los sliders y toggles
del layout siguen visibles: un plan está en **letras**, no en píxeles, así que cambiar el pallet no
lo rompe — si el layout deja de dibujar una letra destino, ese movimiento se lista como el stock que
no cabe. El modo va en la URL (`&mode=plan`): un plan es un enlace.

## 6) Datos

**Se reusa, sin tocar:** `move_inventory_stock` (cantidad, letra destino, log `MOVE`) vía
`useInventory().moveItem`; `updateItem` para el cambio de letra (log `EDIT`) — es el "inventory
update path" que la propia RPC indica; `useOpenSkuDetail`; el stock del mapa (`useWarehouseStock`,
`zoneStock`); el Modal Manager para las hojas.

**Nuevo (una migración):**

```
slot_plans        id uuid pk · zone_id text · warehouse text default 'LUDLOW'
                  status text (draft | executed | discarded) · note text
                  created_by uuid · created_at · updated_at · executed_by uuid · executed_at
                  unique (zone_id) where status = 'draft'          -- un borrador por zona (❓ Q4)
slot_plan_moves   id bigserial · plan_id fk · position int
                  inventory_id bigint · sku text · qty int
                  from_location text · from_sublocation text[] · to_location text · to_sublocation text[]
                  kind text (relabel | move)                         -- misma fila | otra fila
                  status text (planned | done | skipped | failed) · executed_at · error text
RLS: authenticated lee y escribe; borrar un plan = status 'discarded' (append-only de facto).
```

Un intercambio son dos movimientos. `warehouse_overstock_plans` (forma DS-pallet) se queda como está.

**Ejecución:** en el cliente, en orden, por las mismas mutaciones que Live (❓ Q5). No es atómica —
una RPC `execute_slot_plan` lo sería, pero duplicaría la lógica de `updateItem` que hoy vive en TS
(`inventory.service`), y una segunda copia es cómo divergen los logs. Cada movimiento deja el log
que dejaría a mano, más la nota `Plan <zona> <fecha>: A → C` para que el cambio de letra (que es
`EDIT`, sin origen/destino en el log) sea rastreable.

## 7) Pantalla

```
← MAP   BAY 3 NORTH · PALLET LAYOUT                       VIEW | PLAN | LIVE      ⟳
PALLETS 138   TOTAL BIKES 4,140   FAST PICKING 90   HITS 2   IN STOCK 2,323
PALLET ──●── 60" D × ──●── 62" W   N–S ROWS  E–W ROWS   ☑ WEST HALL   HALLS 1 CENTER 0 HALLS
PLAN · 12 moves · 340 u                                       DISCARD   PLAN COMPLETED
Moving 06-4735BK · 142 u — tap a square · ✕
┌──────────────────────── the drawing ────────────────────────┐
│  33-A  [06-4735BK 142]  → atenuado, "↗"                      │
│  33-C  [03-3983GY 230]  ┆ 06-4735BK 142 ┆  fantasma punteado │
└─────────────────────────────────────────────────────────────┘
NOT ON THIS PLAN · ROW 33 · K · 03-3777RD · 21 u   (tocar = levantar)
```

**Teléfono (430 px):** la barra `Moving…` es pegajosa sobre el dibujo; al entrar en PLAN o LIVE el zoom
pasa a ×2.5 para que un cuadro mida ≥ 28 px (❓ Q6); el dibujo se desplaza en horizontal como hoy. Los
chips y la lista NOT ON THIS PLAN ya son botones de tamaño de dedo.

## 8) Fases

- **P1 — PLAN.** Tablas, modo, levantar/soltar con las cuatro reglas, fantasmas, DISCARD, PLAN
  COMPLETED con revalidación y resultado. Es lo que pidió.
- **P2 — LIVE.** El mismo gesto con hoja de confirmación e inmediato. Pequeña: reusa P1 sin el plan.
- **P3 — cantidades** (mover parte de una línea a otra fila) si tras P1/P2 hace falta (❓ Q3).
- **P4 — reacomodo asistido** ("compactar esta fila", "juntar este modelo") solo si las cuatro reglas
  de P1 se quedan cortas en piso.

## 9) Casos de verificación (cifras de prod, 28 ago 2026)

| #   | Caso                                                                                | Esperado                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | PLAN · levantar 33-A (06-4735BK 142 u) · soltar en 33-C (03-3983GY 230 u)           | 2 movimientos `relabel` (A→C, C→A); fantasmas en C y A. PLAN COMPLETED → 2 `updateItem` → 2 logs `EDIT` con nota; 33-A = 230, 33-C = 142          |
| V2  | PLAN · levantar 33-K (03-3777RD 21 u, listado "no slot K") · soltar en 33-D (vacío) | 1 `relabel` K→D; ejecutado: la línea sale de NOT ON THIS PLAN; IN STOCK pasa de 5 a 6 slots en la fila                                            |
| V3  | PLAN · levantar 27-K (03-4071BL 53 u) · soltar en 30-E (vacío)                      | 1 `move`; ejecutado: `moveItem` 53 u a `ROW 30` con `['E']` → log `MOVE` −53/+53; la línea de ROW 27 queda en 0 e inactiva                        |
| V4  | PLAN · soltar 33-A sobre 20-G (estante: 15 líneas de 1 u)                           | 1 `move` a `ROW 20 · G`; el cuadro pasa a 16 SKUs; nadie se mueve                                                                                 |
| V5  | LIVE · levantar 22-K (01-0557 1 u) · soltar en 22-J · Move                          | Hoja de confirmación; `updateItem` inmediato → log `EDIT`; el mapa se refresca; `slot_plans` intacta                                              |
| V6  | Deriva · plan con `move` de 53 u; antes de ejecutar la línea baja a 40 u            | PLAN COMPLETED marca `changed since planned · 40 u left`, lo salta, ejecuta el resto: `n−1 of n moved · 1 skipped`; el movimiento sigue `planned` |
| V7  | Deriva · plan con `relabel` de una línea que ya se movió de fila                    | Se salta (`line no longer in ROW 33`); nunca se ejecuta contra otra fila                                                                          |
| V8  | Dos personas · Jed abre la zona con el borrador de Rafael                           | Ve los mismos fantasmas (plan en la DB, refetch al enfocar). Sin realtime en P1                                                                   |
| V9  | Teléfono 430 px · entrar en PLAN                                                    | Zoom ×2.5; barra `Moving…` pegajosa; cada cuadro ≥ 28 px; nada se corta                                                                           |

## 10) ❓ Preguntas — cada una con la respuesta por defecto (un "ok todo" las cierra)

- **Q1 — ¿Tres modos VIEW | PLAN | LIVE?** _Default:_ **sí**, un control segmentado. VIEW conserva
  "chip → detalle"; en los modos de edición el chip **levanta** y el long-press abre el detalle. Así
  las herramientas de edición no existen hasta que se piden.
- **Q2 — Cuadro ocupado por una línea.** _Default:_ **intercambio** (la ocupante va al origen): dos
  toques, reversible, sin sorpresas. Alternativa: **empujar** al siguiente cuadro vacío de su fila
  hacia el fondo. "Rearrange todo si se necesita" puede ser P4 (compactar fila) si el intercambio no
  alcanza en piso.
- **Q3 — Cantidades.** _Default:_ en P1 y P2 una línea se mueve **entera**; mover parte de una
  línea a otra fila es P3 (dentro de la misma fila la DB no admite partir: una línea tiene un solo
  sitio, aunque abarque letras).
- **Q4 — ¿Un borrador por zona, de todos?** _Default:_ **sí** — "el plan de Bay 3 Norte", que ve
  cualquiera con sesión y ejecuta cualquiera. Alternativa: planes con nombre y dueño.
- **Q5 — Ejecución.** _Default:_ en el cliente, en orden, con las mutaciones de Live y revalidación
  por línea (no atómica; un fallo para y muestra cuál). Alternativa: una RPC atómica, con la lógica
  de `updateItem` duplicada en SQL.
- **Q6 — Teléfono.** _Default:_ entrar en PLAN/LIVE pone zoom ×2.5 a menos de 640 px. Alternativa:
  pedir el zoom a mano.

## 11) Riesgos

- **Deriva entre planear y ejecutar.** El inventario cambia a diario; por eso cada movimiento se
  revalida al ejecutar y se salta con motivo, nunca se fuerza.
- **`EDIT` no dice de dónde a dónde.** El cambio de letra deja un log sin origen/destino; la nota
  `Plan …: A → C` lo cubre. Si hiciera falta un log `MOVE` para la misma fila, es un cambio en la
  RPC (hoy lo rechaza a propósito), no en la UI.
- **Líneas que abarcan letras** (`['G','H','I','J']`): al levantarlas van enteras a un cuadro; el
  abarcar se pierde, que es lo correcto si alguien las está colocando de verdad.
- **Toques en el teléfono.** Sin el zoom automático un cuadro mide ~12 px; V9 lo comprueba.
- **Dos personas editando el mismo plan** a la vez: el último guarda. Aceptable en P1 (un plan por
  zona, pocas manos); realtime si aparece el problema.
