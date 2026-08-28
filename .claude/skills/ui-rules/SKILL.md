---
name: ui-rules
version: 1.0.0
description: >
  Reglas de UI obligatorias para nuevas pantallas en Pickd. Cubre safe-area
  para la BottomNavigation flotante, layout, scroll, focus states, search
  bar pattern. Usar SIEMPRE al crear o modificar Screens, Sheets, Drawers,
  o cualquier vista de pantalla completa. Triggers: "nueva pantalla",
  "crear screen", "nuevo Screen", "new screen", "agregar ruta", "add route",
  "scrollable view", "modal a pantalla completa", "drawer", "sheet",
  "mobile UI".
license: MIT
author: "Rafael Lopez"
metadata:
  category: ui
  tags:
    - pickd
    - mobile
    - tailwind
    - layout
allowed-tools:
  - Read
  - Edit
  - Write
  - Grep
  - Bash
---

# Pickd UI Rules

Reglas de UI que se aplican a **toda** pantalla nueva o modificada en Pickd. Estas son normas de producto, no recomendaciones — el QA las va a marcar como bugs si no se cumplen.

---

## 1. Safe area para la BottomNavigation flotante

**Regla**: cualquier contenido scrolleable que pueda llegar al fondo de la pantalla DEBE usar `pb-32` (128px) de padding inferior. Cualquier botón fijo al fondo (action bar dentro de la screen) usa `pb-28` y se posiciona con `fixed bottom-0`.

**Por qué**: la `BottomNavigation` (componente `src/components/layout/BottomNavigation.tsx`) es un bar flotante posicionado `fixed bottom-0 left-0 right-0` con altura `h-24` (96px) — y un padding interno de `p-4` (16px) en su contenedor. Sin reserva de espacio, los últimos items de la lista, botones de acción, o footers quedan cubiertos por la nav.

### Convenciones de padding inferior

| Caso | Clase | Notas |
|---|---|---|
| Lista scrolleable que llega al final de la pantalla | **`pb-32`** | Default seguro. Cubre nav + safe-area en iOS. |
| Form en pantalla completa con submit al final del flujo | `pb-32` | Igual que lista. |
| Action bar fijo en la parte inferior (botones grandes) | `pb-28` en el `fixed bottom-0` | El bar mismo respeta safe-area. |
| Modal a pantalla completa (no encima de BottomNav) | `pb-24` o `pb-20` | Solo si está claro que la nav está oculta debajo del modal. |
| Bottom sheet / drawer a media pantalla | `max-h-[90vh]` + scroll interno | El sheet no debe llegar al borde de la pantalla. |

### Cómo verificarlo

1. En el navegador, abrir DevTools en modo dispositivo (iPhone 13 Pro o similar — el viewport más pequeño común).
2. Scrollear la nueva pantalla hasta el final.
3. El último elemento DEBE quedar visible **encima** de la BottomNavigation, con al menos ~16px de respiro.
4. Si la pantalla tiene un Action Bar fijo (ej. "Confirm Move"), el botón debe estar arriba de la nav, no detrás.

### Ejemplos en el código

- ✅ `src/features/picking/OrdersScreen.tsx:1033` — `pb-32`
- ✅ `src/features/picking/components/DoubleCheckView.tsx:1487` — `pb-32`
- ✅ `src/features/consolidation/ConsolidationScreen.tsx` — `pb-32`
- ✅ `src/features/labels/LabelGeneratorScreen.tsx:541` — `pb-32` para scroll, `pb-28` para action bars fijos

### Anti-patrones

- ❌ `pb-24` o menos en una lista scrolleable de pantalla completa. Funciona en desktop, falla en mobile.
- ❌ Olvidarse del padding cuando hay un sticky header (la nav inferior sigue existiendo).
- ❌ Usar `mb-*` en lugar de `pb-*` en el contenedor scrolleable — el browser ignora el margin del último child para scroll.

### 1b. Z-index para modales / sheets / drawers

La `BottomNavigation` está en `z-[100]`. Cualquier overlay que pueda llegar al borde inferior de la pantalla (modales con `items-end`, bottom sheets, drawers, fullscreen confirmations) DEBE estar en `z-[110]` o superior. Si está debajo, los botones de acción quedan tapados visualmente por la nav y el usuario no puede confirmar.

**Convención del codebase**:

| z-index | Caso de uso |
|---|---|
| `z-50` ⚠️ | Solo si el modal está garantizado a estar centrado y NO toca el borde inferior. Si dudás, no uses esto. |
| `z-[60]` | Dropdowns / popovers dentro de un screen sin nav (raro). |
| `z-[110]` | **Default para modales** que cubren toda la pantalla. Por encima de la nav. |
| `z-[150]` | Lightboxes de imágenes que tapan modales. |
| `z-[200]` | Toasts globales que tapan todo lo demás. |

**Bonus**: para modales tipo bottom-sheet en iOS, sumar `pb-[env(safe-area-inset-bottom)]` al panel interno para no chocar con el home indicator.

### Anti-patrones modales

- ❌ `fixed inset-0 z-50` en un modal con `items-end` o que pueda tocar el fondo. Garantizado a quedar bajo el nav en mobile.
- ❌ Asumir que `bg-black/60` (backdrop opaco) hace innecesario subir el z-index. El backdrop tapa el contenido detrás del modal, pero el nav tiene su propio z y se renderiza encima.
- ❌ Z-index arbitrarios (`z-[51]`, `z-[99]`, etc.). Usar las cifras del tabla de arriba.

### 1c. Cards clickeables con botones adentro

Si una card entera es clickeable (ej. abre un detail view) y además tiene botones de acción adentro (ej. un Move secundario), el contenedor exterior NO puede ser `<button>` — HTML prohíbe anidar buttons y React tira `validateDOMNesting` warning + hydration error.

**Pattern correcto**:

```tsx
<div
  role="button"
  tabIndex={0}
  onClick={onOpenDetail}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpenDetail();
    }
  }}
  className="... cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
>
  ... contenido ...
  <button
    onClick={(e) => {
      e.stopPropagation();  // ← crítico: el click del botón no debe disparar el de la card
      onSecondaryAction();
    }}
  >
    Action
  </button>
</div>
```

Checklist:
- `role="button"` + `tabIndex={0}` para a11y.
- `onKeyDown` para Enter / Space (no se dispara solo con click).
- `focus-visible:ring-*` para visualizar el focus de teclado.
- Botones internos hacen `e.stopPropagation()` en su onClick.

---

## 2. Sticky headers de pantalla

Reglas:
- El header de la pantalla es `sticky top-0 z-10 bg-surface border-b border-subtle`.
- Los row headers / section headers usan `sticky top-[<height-del-header>]` para que se apilen correctamente debajo del header de pantalla.
- Si la pantalla tiene filtros + buscador, sumar al `top-` el alto del bloque completo (header + filters + search).

Ejemplo en `ConsolidationScreen.tsx`:
```tsx
{/* Header sticky */}
<div className="sticky top-0 z-10 bg-surface border-b border-subtle px-4 py-3">
  ...header + filters + SearchInput...
</div>

{/* Row headers sticky DEBAJO del header */}
<div className="sticky top-[120px] z-[5] -mx-4 px-4 py-2 bg-surface/95 backdrop-blur border-b border-subtle">
  <h2>ROW 10</h2>
</div>
```

Si cambiás la altura del header de pantalla, ajustar el `top-[Npx]` de los section headers en consecuencia.

---

## 3. Search bar — usar `SearchInput`

Para cualquier pantalla con búsqueda usar el componente `src/components/ui/SearchInput.tsx`. **No** instanciar inputs custom para search.

Props críticas:
- `variant`: `'sticky'` para search principal de pantalla, `'inline'` cuando va dentro de otro bloque (filters, modal).
- `preferenceId`: string único por pantalla. Persiste la preferencia del toggle Hash/Type del usuario.
- `placeholder`: usar texto que describa los campos buscables ("Search SKU, name, row…").

Ejemplo:
```tsx
<SearchInput
  value={searchQuery}
  onChange={setSearchQuery}
  placeholder="Search SKU, name, row…"
  variant="inline"
  preferenceId="consolidation"
/>
```

Debounce: usar `useDebounce(searchQuery, 200)` (200ms) antes de pasar el query a la lógica de filtro.

---

## 4. Loading + empty + error states

Toda lista en pantalla debe tener los tres estados visibles:

```tsx
{isLoading ? (
  <div className="flex items-center justify-center py-12">
    <Loader2 className="animate-spin text-accent w-6 h-6 opacity-30" />
  </div>
) : filtered.length === 0 ? (
  <div className="text-center text-muted text-sm py-12">
    {query ? `No matches for "${query}".` : 'No items match the current filters.'}
  </div>
) : (
  // lista
)}
```

Diferenciar el empty state según haya o no filtro/query activo — ayuda al usuario a entender si ajustar o si literalmente no hay data.

---

## 5. Refresh / refetch

Pantallas que muestran data en vivo (no analítica histórica):

- `staleTime: 0` en `useQuery` y `refetchOnWindowFocus: true`.
- Botón de refresh visible en el header (`RefreshCw` icon, `animate-spin` cuando `isFetching`).
- Después de mutaciones que afectan la lista, invalidar el queryKey explícitamente con `queryClient.invalidateQueries({ queryKey: [...] })`.

Pantallas que son reportes/snapshots (no cambian segundo a segundo):

- `staleTime: 60_000` o más.
- Sin refetchOnWindowFocus.

---

## 6. Acción destructiva o que muta

Las mutaciones que cambian inventario / orders / similar:

1. Pre-check defensivo: re-fetch el item por `id` antes de la mutación para validar que sigue en el estado esperado. Si no, mostrar toast claro y refrescar la lista.
2. Disable del botón mientras `isFetching` está activo (evita el race del doble-click contra una lista stale).
3. Después del éxito: invalidar el queryKey + ocultamiento optimista del item.
4. Toast con el detalle: `Moved 03-3768BLD → ROW 25` (no solo "success").

Ver `src/features/consolidation/ConsolidationMoveModal.tsx` como referencia.

---

## 7. Permisos / admin-only

Rutas que solo admin debe ver:

```tsx
<Route
  path="/feature"
  element={isAdmin ? <FeatureScreen /> : <Navigate to="/" replace />}
/>
```

Y el link en `UserMenu.tsx` también gateado por `{isAdmin && (...)}`.

---

## 8. Lazy load la screen

Toda screen nueva que se añada a `App.tsx` se hace lazy via `lazyWithRetry`:

```tsx
const FeatureScreen = lazyWithRetry(() =>
  import('./features/feature/FeatureScreen.tsx').then((m) => ({
    default: m.FeatureScreen,
  }))
);
```

Esto evita aumentar el bundle inicial.

---

---

## 9. Data integrity — `inventory.location` ↔ `location_id`

La tabla `inventory` tiene **dos** representaciones de la ubicación: el texto (`location`) y la FK (`location_id`). El trigger `trg_zz_inventory_sync_location` las mantiene sincronizadas — si tocás una sin la otra, la sincroniza sola; si las pasás con valores conflictivos, RAISES.

**Reglas para nuevas RPCs / queries / scripts**:

- Si vas a hacer un UPDATE manual via psql, podés pasar solo una de las dos columnas y el trigger resuelve la otra. No hace falta ser exhaustivo.
- Si pasás las dos, deben coincidir o el trigger aborta.
- Si en una query/RPC hacés `JOIN locations`, preferí **`COALESCE(i.location, l.location)`** (texto primero, FK como fallback). Eso matchea InventoryScreen, ItemDetailView, picking_lists.items[].location snapshots, y move_inventory_stock params.
- Para monitoreo: `SELECT * FROM public.v_inventory_location_drift` — debería estar siempre en cero. Si aparece algo, alguien deshabilitó el trigger o lo bypaseó.

**Anti-patrones**:

- ❌ Confiar solo en `l.location` (FK join) sin coalesce — si alguna vez se desincroniza, mostrás algo distinto a Stock/Inventory.
- ❌ Asumir que un script ad-hoc puede tocar solo `location` sin tocar `location_id` y "lo arreglamos después" — el trigger ya lo hace por vos, no hace falta evitarlo.

---

## 10. Color de texto explícito en fondos claros

El root de la app monta con `dark` en `<html>`. Cualquier elemento que **no** fije su propio color hereda el texto casi blanco del tema oscuro — y si además tiene fondo claro (`bg-white`, `bg-slate-50`), queda **blanco sobre blanco**.

**Regla**: en un contenedor con fondo claro, todo texto lleva color explícito. No confiar en la herencia.

Los que más se olvidan, porque no parecen "texto":

| Elemento | Falla | Arreglo |
|---|---|---|
| `<input>` / `<select>` con `bg-white` | No se ve lo que el usuario escribe | `text-slate-800` |
| Códigos en `font-mono` (SKU, IDs) | Invisibles | `text-slate-800` |
| Cifras sueltas (`50u`, contadores) | Invisibles | `text-slate-700` |

```tsx
// ❌ hereda el claro del tema oscuro
<span className="font-mono font-bold text-xs">{sku}</span>
<input className="border rounded px-2 py-1 bg-white" />

// ✅
<span className="font-mono font-bold text-xs text-slate-800">{sku}</span>
<input className="border rounded px-2 py-1 bg-white text-slate-800" />
```

Poner el color en el contenedor y dejar que los hijos hereden **sí** es válido — `<div className="text-slate-400">` cubre a sus hijos sin color propio. Lo que no vale es no ponerlo en ningún nivel.

**Cómo verificarlo**: mirar la pantalla, no el código. Un `grep` de clases con `text-xs` sin ningún `text-<color>` cerca encuentra la mayoría de los casos.

---

## Checklist antes de mergear una screen nueva

- [ ] `pb-32` (o `pb-28` para action bars) — contenido no oculto detrás de BottomNavigation
- [ ] Modales en `z-[110]` o superior si pueden tocar el fondo. `pb-[env(safe-area-inset-bottom)]` en el panel interno para iOS.
- [ ] Sticky header con `top-0 z-10`
- [ ] Section headers (si aplica) con `top-[height-del-header]`
- [ ] `SearchInput` (no input custom) si hay búsqueda
- [ ] `useDebounce(query, 200)` antes del filtro
- [ ] Loading, empty (con/sin query), error states explícitos
- [ ] Texto con color explícito en todo contenedor de fondo claro (el root está en `dark`) — incluidos inputs y selects
- [ ] `staleTime` / `refetchOnWindowFocus` apropiados al tipo de data
- [ ] Mutaciones con pre-check + disable + invalidate + toast con detalle
- [ ] Ruta gateada por permiso si aplica
- [ ] Lazy-loaded con `lazyWithRetry`
- [ ] Probado en viewport mobile (iPhone 13 Pro o más chico)

Si tildaste todo, mergeá. Si no, ajustá antes.

## 7. Ship: cifras, no frases

Rafael, 27 ago 2026, sobre la declaración de e-bikes: "el operario no quiere un texto largo, solo
cosas puntuales — 1 cartón, 1 Hudson E1, 78.6 libras". Todo lo que en Ship le dice a la estación
qué teclear (en Audit Source, en FedEx Ship Manager) se muestra **como los cuatro números grandes**
— cifra grande + etiqueta de 1-2 palabras (`StatField` / `Figure` en `ElectricCartonDeclaration`) —
nunca como párrafo ni banner con explicación. Un dato que falta es un `?` ámbar, no una frase.
