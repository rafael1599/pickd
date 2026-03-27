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

## Picking workflow

```
idle (UI) → building (UI-only, no DB) → active (DB)
  → ready_to_double_check → double_checking
    → completed (terminal) | needs_correction → active (loop)
  → cancelled (terminal — manual o auto-cancel >15min/24hrs)
```

6 estados DB: `active`, `ready_to_double_check`, `double_checking`, `needs_correction`, `completed`, `cancelled`. Órdenes completadas tienen triple protección contra reversión.

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
