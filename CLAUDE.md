# Instrucciones para Claude — PickD

PWA de gestión de inventario y warehouse operations. Multi-usuario con sync en tiempo real.

## Tech Stack

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS
- **State:** TanStack Query v5 + Supabase Realtime
- **DB:** PostgreSQL via Supabase (RLS habilitado)
- **Auth:** Supabase Auth
- **AI:** Gemini 2.5 Flash (primary) + GPT-4o (fallback)
- **Package manager:** pnpm

## Estructura clave

- `src/features/` — Feature-Sliced Design (cada feature tiene `hooks/`, `components/`, `api/`)
- `src/lib/` — Clientes core (supabase, query-client, mutationRegistry)
- `src/schemas/` — Validación Zod (deben coincidir con columnas de DB)
- `supabase/migrations/` — Migraciones PostgreSQL
- `supabase/functions/` — Edge functions (snapshots, reportes, auto-cancel)
- `.agent/management/BACKLOG.md` — Source of truth del backlog

## Convenciones

- **No imports cross-feature.** Compartir via context o utils.
- **Optimistic updates** en todas las mutaciones (rollback automático si falla el RPC).
- **TypeScript strict mode.** No usar `any`.
- **Antes de refactors o migraciones grandes:** preguntar si quiero análisis profundo primero.
- **Git:** ejecutar `git add`, `git commit`, `git push` como comandos separados (compatibilidad PowerShell).
- **Formatting:** NUNCA ejecutar `prettier --write .` ni formatear todo el proyecto. Solo formatear archivos que se van a commitear: `prettier --write <archivo>`. Las migraciones SQL, scripts, y reports están protegidos en `.prettierignore`.
- **Scripts temporales:** no agregar scripts one-time al proyecto. Usar `/tmp` o guardarlos en la skill correspondiente (`.claude/skills/`).
- **PostgREST selects:** Al cambiar un `.select()` de `table(*)` a columnas explícitas `table(col1, col2)`, verificar que TODAS las columnas existan en la tabla real de producción. PostgREST retorna HTTP 400 si se referencia una columna inexistente, rompiendo el query completo. Los schemas Zod (`src/schemas/`) pueden tener campos que no existen en DB (nullish/optional) — la fuente de verdad son las migraciones en `supabase/migrations/`.
- **Nuevas columnas DB:** Al agregar una columna a una tabla, actualizar **4 lugares**: (1) migración SQL, (2) schema Zod en `src/schemas/`, (3) tipos Supabase en `src/integrations/supabase/types.ts` y `src/lib/database.types.ts`, (4) queries con select explícito (ej. `inventoryApi.ts`). Si falta alguno, PostgREST ignora silenciosamente la columna en reads/writes.
- **Tests:** Correr `pnpm vitest run` antes de cada deploy. Los tests corren local sin necesidad de DB (mocks de Supabase).
- **Modals/Sheets:** SIEMPRE usar el Modal Manager (`useModal()` + `ModalProvider` en LayoutMain). Ningún modal crítico debe vivir dentro del componente que lo abre. Ver `docs/modal-pattern.md`. Excepciones: tooltips, dropdowns, popovers efímeros.

## Picking workflow

```
idle (UI) → active (DB — via generatePickingPath)
  → ready_to_double_check → double_checking
    → completed (terminal) | needs_correction → active (loop)
  → cancelled (terminal — manual o auto-cancel)
completed → reopened (via Reopen Order — requires reason)
  → completed (re-complete with inventory delta) | cancelled (cancel reopen — restores snapshot)
```

7 estados DB: `active`, `ready_to_double_check`, `double_checking`, `needs_correction`, `completed`, `cancelled`, `reopened`. Órdenes completadas tienen triple protección contra reversión. Órdenes `reopened` tienen snapshot para delta calculation y auto-cancel a 2h si se abandonan.

`building` mode fue eliminado (idea-032). `OrderBuilderMode.tsx`, `PickingSessionView.tsx`, y `returnToBuilding()` fueron eliminados. Edit Order mode (CorrectionModeView) reemplaza sus funciones. InventoryCards muestran +/- inline en picking mode.

**Correcciones con razón (idea-043):** Todas las acciones de corrección (remove, swap, adjust_qty, add) requieren una razón via `ReasonPicker`. Las notas se generan con formato rico: "Removed SKU: Out of stock" en vez de genérico. `CorrectionAction` tiene campo `reason?: string`. Si el item tiene `insufficient_stock`, la razón "Out of stock" se pre-selecciona.

**Órdenes stuck en reopened:** Si una orden queda en `reopened` (browser cerrado, sesión perdida), OrderSidebar muestra "Continue Editing" (mismo usuario) o "Take Over & Edit" (otro usuario). `resumeReopenedOrder` carga sin llamar al RPC reopen de nuevo.

**Long-Waiting Orders (idea-053):** Órdenes que esperan inventario (días, semanas, meses) viven en `needs_correction` con `is_waiting_inventory = true`. Admin marca/desmarca via RPCs `mark_picking_list_waiting` / `unmark_picking_list_waiting`. Verification queue las oculta por defecto (toggle "Waiting for Inventory"). Cross-customer SKU conflicts se detectan al abrir DoubleCheckView (`useWaitingConflicts`) y se resuelven via `take_over_sku_from_waiting` RPC o editando la orden. La rama `auto_cancel_stale_orders` verification 24h fue **eliminada** (era conceptualmente equivocada, bug-017). El cómputo de reservas client-side (`usePickingActions.ts`) ya itera `needs_correction`, así que waiting orders son respetadas automáticamente.

**Verification Board (idea-055):** La Verification Queue es un overlay full-screen con zonas: Priority (auto-populated por status), FedEx/Regular lanes (drag-reclasificar `shipping_type`), In Progress Projects (read-only), Recently Completed (drag=reopen), Waiting (colapsable). Auto-clasificación: item >50 lbs o ≥5 items → Regular, else → FedEx. `shipping_type` columna en `picking_lists` (NULL = auto). DnD usa `@dnd-kit/sortable` con `useBoardDnD` hook. Componentes en `src/features/picking/components/board/`.

**Activity Report layout:** Editor panel on the left (desktop) with: selectable greeting toggle ("Hi Carine!"), Win of the Day, PickD Updates (collapsible dropdown, closed by default), On the Floor routine checklist (editable items via gear icon, persisted in localStorage), and Notes (multiline textarea, one per line). Preview on the right updates with green highlight flash on each edit. "Save & Copy Report" button at bottom saves + copies to clipboard in one action. Report section order: Win → PickD Updates → Done Today → On the Floor → In Progress → Coming Up Next → Inventory Accuracy → Waiting. Footer shows date only (no timestamp). `/pickd-report` public route shows the HTML daily report for the current date with date navigation.

## Base de datos compartida

Esta app comparte la misma DB Supabase con **pickd-2d** (dashboard de visualizacion 2D/3D).
Ver `JAMIS/SHARED-DB-CONTRACT.md` para ownership de tablas, RPCs, y reglas de migracion.

- pickd es owner de: `picking_lists`, `profiles`, `customers`, `order_groups`, `picking_list_notes`
- pickd-2d lee: `inventory`, `sku_metadata`, `locations` y escribe solo via consolidation RPCs
- **`sku_metadata` columns (prod):** `sku`, `length_in`, `width_in`, `height_in`, `length_ft`, `weight_lbs`, `image_url`, `is_bike`, `upc`, `created_at` — NO tiene columna `name`
- **`inventory.sublocation`** (idea-024): posición dentro de un ROW (A-F). CHECK constraints: `^[A-Z]{1,3}$` y solo para `location ILIKE 'ROW%'`. Se auto-limpia a NULL al mover a non-ROW. UI: chips en ItemDetailView/MovementModal, badge en InventoryCard/DoubleCheckView.

## Branching & Deployment

- **`main`** — Producción. Despliega automáticamente a `roman-app.vercel.app`.
- **`develop`** — Staging/preview. Despliega automáticamente a un URL de preview de Vercel. Misma DB de producción (Supabase compartida).
- **Flujo:** feature branches → PR a `develop` → testing en staging → PR a `main` → producción.
- **Regla de migraciones:** Como staging y producción comparten la misma DB, los cambios de esquema deben ser **aditivos** (agregar columnas/funciones OK, renombrar/eliminar NO hasta que producción también se actualice).
- **Banner de staging:** `StagingBanner.tsx` muestra un banner amarillo "STAGING" automáticamente cuando el hostname no es producción ni localhost.
- **Reports prebuild:** `pnpm prebuild` copies `reports/daily/*.html` to `public/reports/daily/` for static serving. Runs automatically before `pnpm build`. The `/pickd-report` route serves these via iframe.

## Servicios externos

- **watchdog-pickd** — Daemon Python que monitorea PDFs y auto-crea órdenes. Corre en la **MacBook de Bay 2** (no en esta máquina) como servicio launchd (`com.antigravity.watchdog-pickd`). Usa `service_role` key (bypasses RLS). Repo: `~/Documents/Projects/JAMIS/watchdog-pickd/`. Para reinstalar: `python watcher.py --install`.

## Known Issues

- **`react-hook-form@7.71.1` TS error:** `tsc --noEmit` reports `Module '"react-hook-form"' has no exported member 'useForm'`. This is an upstream packaging bug — the `.d.ts` re-exports from `../src/useForm` but the `src/` directory isn't included in the npm package. **Vite builds fine, do not attempt to fix.**

## Skills

Este proyecto usa skills de `.claude/skills/` (symlink a `~/Documents/Projects/skills`). Para actualizar: `cd .claude/skills && git pull`

### Skills disponibles para este proyecto

- `commit-craft` — commits convencionales automáticos
- `project-standardize` — estandarización de proyectos
- `skills-hub` — gestión de skills entre proyectos
- `daily-report` — reportes diarios de progreso (project-skill)
- `supabase` — operaciones de base de datos Supabase (project-skill)

### Preferencias de conexión

- Siempre usar **symlink** para conectar skills (nunca git clone dentro del proyecto)
