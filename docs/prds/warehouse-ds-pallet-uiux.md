> **Superseded 2026-08-28 (idea-170):** el plan DS-pallet (pestaña Plan) fue borrado con la fase F4; el mapa medido en
> `src/features/warehouse-map/` lo reemplaza. Ver `docs/prds/warehouse-map-measured.md`.

# Análisis UI/UX: DS-Pallets, Curación de No-movers y Pull First

**Complementa:** `docs/prds/warehouse-ds-pallet-blocks.md` (el PRD funcional)
**Alcance:** capa 3 del plan de trabajo — interfaz. Las capas 1 (motor) y 2 (persistencia) van por separado.
**Fecha:** 2026-07-28 · **Regla aplicable:** `.claude/skills/ui-rules`

---

## 1) Qué existe hoy

### Mapa de componentes

```
/warehouse-map  →  WarehouseMapScreen.tsx
├── Header propio: [← Back]  "Visual Layout"      [ Plan | ● Live ]
└── Body (flex-1, overflow-hidden)
    ├── tab plan → WarehouseMap.tsx
    │   ├── "Warehouse Top View" + "Saved Plan · Updated <fecha> (<user>)"
    │   ├── Barra de acciones: [Filters ▾] [⟳ Recalculate Map] [🖨 Print Landscape] [↻ 90°]
    │   ├── ExcludedItemsSummary        (resumen siempre visible de excluidos)
    │   ├── WarehouseGrid               (grid en pantalla + grid paralelo solo-print)
    │   │   └── SkuCell × 30            (4 variantes: empty · reserved · tower · lines)
    │   └── SkuDetailPanel              (absolute top-4 right-4, z-30)
    └── tab live → WarehouseLiveMap.tsx (selector de row + mismo WarehouseGrid)
```

### El popover de filtros

`WarehouseMapFilters.tsx` esconde **cuatro** herramientas distintas detrás de un botón `[Filters ▾]`:

1. Lista de exclusiones por SKU con búsqueda y toggle individual
2. Rango de peso (min / max)
3. Sliders de ranking (`qty` y `moved`, 0-3)
4. Caja de pegado de SKUs prioritarios (con normalización `064638bk` → `06-4638BK`)

### Flujo actual del manager

```
Abre /warehouse-map
  → cae en tab Plan, ve el plan guardado (o vacío si nunca se calculó)
  → abre [Filters ▾], ajusta exclusiones / pesos / prioridades a ciegas
  → [Recalculate Map]  ← el plan entero se rehace y se guarda, sin preview
  → mira el grid, si no le gusta vuelve a filtros
  → [Print Landscape]
```

**El problema de fondo:** no hay paso de decisión. El manager toca perillas abstractas (un slider "moved" de 0 a 3) y aprieta un botón que reescribe el plan guardado sin mostrarle antes qué va a cambiar. La decisión real —qué SKU se queda y cuál se va— no tiene lugar en la interfaz.

---

## 2) Auditoría contra `ui-rules` (deuda actual)

`/warehouse-map` está montada **dentro de `LayoutMain`** (`App.tsx:162`), que renderiza `BottomNavigation` (`fixed bottom-0`, `h-24`, `z-[100]`). Con eso:

| Regla                        | Estado           | Detalle                                                                                                                                                                                                                                                                 |
| ---------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 · `pb-32` en scrolleables | ❌ **Incumple**  | No hay un solo `pb-32` / `pb-28` en toda la feature. `WarehouseMap.tsx:143` usa `p-6` + `overflow-auto`, así que en mobile los últimos ~96px del mapa quedan detrás de la nav flotante.                                                                                 |
| §1b · Overlays en `z-[110]`  | ⚠️ **Riesgo**    | `SkuDetailPanel` es `absolute top-4 right-4 z-30`. No es modal, pero en viewport corto el panel de 288px puede llegar al fondo y quedar bajo la nav (`z-[100]`). Además es `absolute` dentro del contenedor scrolleable: **se va con el scroll** en vez de quedar fijo. |
| §3 · `SearchInput`           | ❌ **Incumple**  | El buscador del popover de filtros es un input custom, sin `preferenceId` ni debounce.                                                                                                                                                                                  |
| §4 · Loading / empty / error | ⚠️ **Parcial**   | Hay loading y error. **Falta el empty state**: sin plan guardado y sin pool, el grid renderiza 30 celdas vacías sin explicar por qué.                                                                                                                                   |
| §7 · Gating por permiso      | ⚠️ **A decidir** | `/warehouse-map` **no** está gateada, a diferencia de `/consolidation` y `/registrar-container` que sí exigen `isAdmin`. La pantalla de curación decide qué se queda en el almacén — debería estar al mismo nivel.                                                      |
| §8 · Lazy load               | ✅ Cumple        | `lazyWithRetry` en `App.tsx:82-84`.                                                                                                                                                                                                                                     |

Estas fallas no las introduce el rediseño, pero al tocar la pantalla hay que corregirlas — el checklist de `ui-rules` es de cumplimiento obligatorio al mergear.

---

## 3) Qué se elimina, qué se transforma, qué es nuevo

### 🗑 Se elimina

| Elemento                                                        | Motivo                                                                                       |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Variante `tower` de `SkuCell`                                   | Ya no existe el concepto.                                                                    |
| Variante `lines` de `SkuCell` (el `.map()` de hasta 6 entradas) | Una celda = un SKU. Desaparece el multi-SKU.                                                 |
| Sliders de ranking (`qty` / `moved`, 0-3) en el popover         | El criterio de entrada ya no es un score ponderado, es una lista curada.                     |
| Caja de SKUs prioritarios                                       | La priorización se absorbe en la lista de no-movers (estar en la lista **es** la prioridad). |
| Etiqueta `"25u tower"` bajo el SKU                              | Pasa a `"25u"` + estado del pallet.                                                          |

### 🔄 Se transforma

| Elemento               | De → A                                                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---- | ------------------------------------------------------- |
| `SkuCell`              | 4 variantes → **3**: `empty` · `reserved` · `pallet`. La variante `pallet` gana un indicador de llenado (25 = lleno, 20-24 = parcial).                                        |
| `WarehouseMap` header  | Un plan → **selector de bloque** (A · ROW 31/32/33 · B · ROW 28/29/30) con su propio timestamp, Recalculate y Print por bloque.                                               |
| `WarehouseMapFilters`  | Popover de 4 herramientas → popover de 2 (exclusiones por SKU + rango de peso). Los criterios de clasificación salen del popover y suben a la pantalla de curación, visibles. |
| `ExcludedItemsSummary` | Se mantiene, pero cambia de vecino: convive con el nuevo resumen de Pull First.                                                                                               |
| `SkuDetailPanel`       | `absolute z-30` dentro del scroll → **`fixed z-[110]`**, para cumplir §1b y no irse con el scroll.                                                                            |
| Segmented control      | `[Plan                                                                                                                                                                        | Live]`→`[No-movers | Plan | Live]`, en ese orden — el orden expresa la dependencia. |

### ✨ Es nuevo

1. **Pantalla de curación de no-movers** (§4) — la pieza con diseño de verdad.
2. **Sección Pull First** por bloque (§5.3).
3. **Selector de bloque** en el tab Plan (§5.1).
4. **Banda de criterios activos** — recencia y mínimo de unidades, siempre visibles (RF-002b/d).

---

## 4) Pantalla nueva: Curación de No-movers

Tercer tab, primero en el orden. Es una pantalla de trabajo: lista larga, decisiones repetitivas, necesita búsqueda y acciones en lote.

### Wireframe

```
┌─ Visual Layout ──────────────────────[ No-movers | Plan | Live ]─┐
│                                                                   │
│  CRITERIOS ACTIVOS                                                │
│  Mover = despachó en los últimos [ 30 ▾] días        ← RF-002b   │
│  DS-Pallet = mínimo 20 unidades                       ← RF-002d   │
│  ↳ Cambiar a 45 días movería 6 SKUs de mover a no-mover ← RF-002c │
│                                                                   │
│  🔍 [ Search SKU, name, row…                            ]        │
│  Bloque: ( Todos | A · 31/32/33 | B · 28/29/30 )                 │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ NO-MOVERS · 85 SKUs · 486u · 7 ganan pallet               │   │
│  ├───────────────────────────────────────────────────────────┤   │
│  │ ✓ 03-4065BL   50u   ROW 31·A   últ. 19-jun   → DS-Pallet │   │
│  │ ✓ 06-4588BL   45u   ROW 29·E   nunca         → DS-Pallet │   │
│  │ ✓ 03-4266BK   16u   ROW 31·B/C últ. 09-jun   → Pull First│   │
│  │ ✓ 01-0440      1u   ROW 33     nunca         → Pull First│   │
│  │   …                                                       │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ MOVERS · 31 SKUs · 461u · se sacan del bloque             │   │
│  ├───────────────────────────────────────────────────────────┤   │
│  │   03-3726RD   42u   ROW 29·F   últ. 17-jul                │   │
│  │   03-3743GN   37u   ROW 28·E   últ. 17-jul                │   │
│  │   …                                                       │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                        (pb-32)    │
└───────────────────────────────────────────────────────────────────┘
```

### Decisiones de diseño

**Dos listas, no una con filtro.** Movers y no-movers son dos decisiones distintas ("se va" / "se queda") y el manager las revisa en momentos distintos. Un solo listado con un toggle obliga a recordar en qué modo está.

**La fila muestra el porqué.** Cada fila lleva último envío y destino calculado (`DS-Pallet` / `Pull First`) para que la clasificación sea auditable sin abrir nada. Es lo que hace innecesario el detalle en un panel aparte.

**Acciones en lote, no solo por SKU.** Del análisis de datos: ROW 33 tiene ~30 SKUs `01-xxxx`/`02-xxxx` de 1 unidad y cero envíos. Aceptarlos de a uno es inaceptable en el primer uso. Hacen falta:

- Selección múltiple con checkbox + "Descartar seleccionados"
- Un filtro rápido **"solo 1 unidad"** / **"nunca despachado"** que permita barrer la cola larga de un tirón

**El cambio de ventana muestra su impacto antes de aplicarse** (RF-002c). Sin eso, mover el número de 30 a 45 es a ciegas — que es exactamente el vicio del slider actual que estamos eliminando.

**Estados** (§4 de ui-rules):

- _Loading_ — `Loader2` centrado, `py-12`
- _Empty sin query_ — "No hay stock en los bloques 28-33." (caso real si el almacén se vacía)
- _Empty con query_ — `No matches for "<query>".`
- _Error_ — mensaje + botón de reintento

**Refresh** (§5): es data operativa en vivo → `staleTime: 0`, `refetchOnWindowFocus: true`, botón `RefreshCw` en el header con `animate-spin` mientras `isFetching`.

---

## 5) Cambios al tab Plan

### 5.1 Los dos bloques, lado a lado

En pantalla se ven **los dos bloques simultáneamente**, uno al lado del otro. `WarehouseGrid` ya acepta `customRows` / `customLetters`, así que son dos instancias con parámetros distintos — no hace falta componente nuevo.

```
Warehouse Top View
[Filters ▾] [🖨 Print (2 hojas)] [↻ 90°]

┌── BLOQUE A · ROW 31/32/33 ──────┐  ┌── BLOQUE B · ROW 28/29/30 ──────┐
│ ✓ Updated 28 jul 09:14 (rafael) │  │ ✓ Updated 27 jul 16:02 (rafael) │
│ [⟳ Recalculate bloque A]        │  │ [⟳ Recalculate bloque B]        │
│                                  │  │                                  │
│   31    32    33                 │  │   28    29    30                 │
│  ┌───┬─────┬───┐                │  │  ┌───┬─────┬───┐                │
│  │   │     │   │                 │  │  │   │     │   │                │
│  └───┴─────┴───┘                │  │  └───┴─────┴───┘                │
│                                  │  │                                  │
│ ▸ PULL FIRST · 54 SKUs · 191u   │  │ ▸ PULL FIRST · 24 SKUs · 128u   │
└──────────────────────────────────┘  └──────────────────────────────────┘
```

Aunque se vean juntos, siguen siendo **planes independientes**: cada uno con su timestamp, su botón de Recalculate y su Pull First. El botón nombra el bloque (`Recalculate bloque A`) para que sea imposible recalcular el equivocado.

### 5.1b Impresión en dos hojas

`Print` genera **una hoja por bloque**, cada una con su mapa y su Pull First debajo. Se implementa con `break-after: page` entre los dos contenedores del grid solo-print, manteniendo el `@page { size: A4 landscape }` que ya inyecta `handlePrintLandscape` (`WarehouseMap.tsx:49-63`).

En pantalla van lado a lado; en papel, separados. La razón es operativa: cada hoja acompaña el trabajo físico de un bloque distinto y va a manos distintas.

### 5.2 La celda de pallet

```
┌────────────────────┐   ┌────────────────────┐   ┌────────────────────┐
│▌03-4065BL          │   │▌03-3852GY          │   │                    │
│ 25u  ● lleno       │   │ 22u  ◐ parcial     │   │      empty         │
└────────────────────┘   └────────────────────┘   └────────────────────┘
```

Se conserva `skuColor()` para la barra lateral y el fondo, y `counterRotateTextStyle()` para que el texto siga legible con el mapa rotado. El indicador de llenado es tipográfico (`● lleno` / `◐ parcial`), **no** un color nuevo: el color ya está saturado como identificador de familia y agregarle una segunda semántica lo vuelve ilegible.

### 5.3 Sección Pull First

Va **debajo del grid**, colapsable, abierta por defecto cuando tiene contenido:

```
┌─ PULL FIRST · bloque A · 54 SKUs · 191u ──────────────── [▼] ─┐
│ SKU          Qty   Desde        Motivo                        │
│ 03-4266BK    16u   ROW 31·B/C   16u < 20u mínimo             │
│ 03-4531GY     7u   ROW 31·B     7u < 20u mínimo              │
│ 01-0440       1u   ROW 33       1u < 20u mínimo              │
└───────────────────────────────────────────────────────────────┘
```

El motivo se escribe con el número concreto (`16u < 20u mínimo`), no con una etiqueta genérica — es lo que hace que RF-002d se cumpla sin una leyenda aparte.

En **print** va después del mapa, sin el control de colapso y sin colores de fondo (tinta).

### 5.4 Impacto del volumen en el diseño

Con los datos actuales, Pull First del bloque A tendría **54 filas** y el del bloque B **24**. No es una nota al pie: es media pantalla. Por eso va colapsable y con contador en el encabezado, y por eso la pantalla de curación necesita el barrido en lote — si la cola larga no se descarta antes, Pull First se vuelve ilegible.

---

## 6) Flujo objetivo del manager

```
1. Tab No-movers
   ├── revisa criterios activos (30 días / 20u)
   ├── barre la cola larga con "solo 1 unidad" → Descartar seleccionados
   ├── confirma qué se queda y qué se va
   └── la lista queda guardada en Supabase (compartida)
2. Tab Plan · bloque A
   ├── [⟳ Recalculate bloque A]
   ├── revisa el grid + Pull First
   └── [🖨 Print bloque A]
3. Tab Plan · bloque B  → mismo ciclo
4. Piso: saca los movers, arma los pallets, resuelve Pull First a mano
```

El paso 1 bloquea al 2: sin lista, `Recalculate` va deshabilitado con el texto _"Definí primero la lista de no-movers"_ (RF-001).

---

## 7) Checklist `ui-rules` para esta entrega

- [ ] `pb-32` en el scroll de la pantalla de curación y en el body del tab Plan — **hoy falta en toda la feature**
- [ ] `SkuDetailPanel` a `fixed` + `z-[110]` (hoy `absolute z-30`)
- [ ] `SearchInput` con `variant="inline"`, `preferenceId="warehouse-curation"` + `useDebounce(query, 200)`
- [ ] Loading / empty-sin-query / empty-con-query / error en ambas listas
- [ ] `staleTime: 0` + `refetchOnWindowFocus` + botón de refresh en curación
- [ ] Mutaciones de la lista: pre-check, disable mientras `isFetching`, `invalidateQueries`, toast con detalle (`03-4065BL → no-mover, bloque A`)
- [ ] Decidir gating `isAdmin` de `/warehouse-map` (hoy abierta; `/consolidation` sí está gateada)
- [ ] Probado en viewport iPhone 13 Pro

---

## 8) Decisiones de diseño resueltas

1. **La pantalla de clasificación es un tab**, no una ruta propia: `[No-movers | Plan | Live]`, y el orden expresa la secuencia.
2. **`/warehouse-map` queda abierta**, sin gating por `isAdmin`. Tampoco se gatea el tab de No-movers.
3. **Los dos bloques se ven uno al lado del otro** en pantalla (`WarehouseGrid` ya soporta N columnas). **Al imprimir salen en 2 hojas separadas**, una por bloque — ver §5.1.
4. **El tab Live no marca** las celdas por debajo del mínimo. Solo se alinea el vocabulario (el `>= 15` huérfano de `useRealInventoryMap.ts:98`).
5. **El mínimo de unidades es editable** por el usuario y visible junto a la ventana de recencia. El máximo (25) es fijo: capacidad física del pallet.
6. **Consolidation no cambia**: sigue recomendando slow movers hacia bay 3 (ROW 20-38), solapando con ambos bloques. Ante conflicto sobre ROW 28-33, el plan manda.

7. **El grid deriva sus posiciones de configuración, no de una constante.** Hasta ahora dos torres compartían una sublocación (por eso en los datos solo aparecen A-F); con DS-Pallets cada una tiene la suya, así que el rotulado por row se duplica. **Ese re-rotulado es un plan aparte y manual**, fuera de este trabajo — el grid debe leer cuántas posiciones tiene cada row en lugar de asumir diez (RF-011b).
8. **La última posición de cada row va reservada**, y solo dentro de los bloques A y B.

### Consecuencia para el diseño del grid

`WarehouseGrid` ya acepta `customRows` / `customLetters` — el tab Live lo usa para sublocaciones dinámicas. El tab Plan debe adoptar el mismo mecanismo en vez de la constante `LETTERS = A..J`. Sin eso, el día que la operación termine de re-rotular una row, el mapa va a dibujar celdas que no existen o va a ocultar posiciones reales.

La pantalla de clasificación es el lugar natural para exponer y corregir esa configuración: es donde ya viven los otros criterios visibles (ventana de recencia, mínimo de unidades).
