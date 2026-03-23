# Instrucciones para Claude — PickD (Roman-app)

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

## Picking workflow

```
idle (UI) → building (UI-only, no DB) → active (DB)
  → ready_to_double_check → double_checking
    → completed (terminal) | needs_correction → active (loop)
  → cancelled (terminal — manual o auto-cancel >15min/24hrs)
```

6 estados DB: `active`, `ready_to_double_check`, `double_checking`, `needs_correction`, `completed`, `cancelled`. Órdenes completadas tienen triple protección contra reversión.

## Skills

Skills compartidas via symlinks en `.claude/skills/` (personal-skills, external-skills, template).
Skills de proyecto en `.claude/skills/project-skills/pickd/` (daily-report, supabase).
