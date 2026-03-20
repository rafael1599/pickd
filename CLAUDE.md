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

Building → Ready (`ready_to_double_check`) → Double Check → Completed (deducción server-side). Órdenes completadas tienen triple protección contra reversión.

## Skills

Las skills se gestionan desde el repo `my-agent-skills` (source of truth).

- `.skills-config.json` declara qué skills usa este proyecto y de dónde vienen.
- `scripts/sync-skills.ps1` copia los SKILL.md al proyecto (`.claude/commands/` y `.agents/skills/`).
- **Nunca editar las skills copiadas directamente.** Editar en `my-agent-skills` y correr `.\scripts\sync-skills.ps1` para sincronizar.
