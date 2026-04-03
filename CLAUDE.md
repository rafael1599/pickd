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
- **Tests:** Correr `pnpm vitest run` antes de cada deploy. Los tests corren local sin necesidad de DB (mocks de Supabase).

## Picking workflow

```
idle (UI) → active (DB — via generatePickingPath)
  → ready_to_double_check → double_checking
    → completed (terminal) | needs_correction → active (loop)
  → cancelled (terminal — manual o auto-cancel)
```

6 estados DB: `active`, `ready_to_double_check`, `double_checking`, `needs_correction`, `completed`, `cancelled`. Órdenes completadas tienen triple protección contra reversión.

> **⚠️ EN PROCESO:** `building` mode está siendo eliminado (idea-032). El flujo anterior era `idle → building → active`. El nuevo flujo es `idle → active` directo. Edit Order mode reemplaza las funciones de building (agregar/editar/eliminar items). `OrderBuilderMode.tsx` y `returnToBuilding()` serán eliminados.

## Base de datos compartida

Esta app comparte la misma DB Supabase con **pickd-2d** (dashboard de visualizacion 2D/3D).
Ver `JAMIS/SHARED-DB-CONTRACT.md` para ownership de tablas, RPCs, y reglas de migracion.

- pickd es owner de: `picking_lists`, `profiles`, `customers`, `order_groups`, `picking_list_notes`
- pickd-2d lee: `inventory`, `sku_metadata`, `locations` y escribe solo via consolidation RPCs
- **`sku_metadata` columns (prod):** `sku`, `length_in`, `width_in`, `height_in`, `length_ft`, `weight_lbs`, `image_url`, `created_at` — NO tiene columna `name`

## Branching & Deployment

- **`main`** — Producción. Despliega automáticamente a `roman-app.vercel.app`.
- **`develop`** — Staging/preview. Despliega automáticamente a un URL de preview de Vercel. Misma DB de producción (Supabase compartida).
- **Flujo:** feature branches → PR a `develop` → testing en staging → PR a `main` → producción.
- **Regla de migraciones:** Como staging y producción comparten la misma DB, los cambios de esquema deben ser **aditivos** (agregar columnas/funciones OK, renombrar/eliminar NO hasta que producción también se actualice).
- **Banner de staging:** `StagingBanner.tsx` muestra un banner amarillo "STAGING" automáticamente cuando el hostname no es producción ni localhost.

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
