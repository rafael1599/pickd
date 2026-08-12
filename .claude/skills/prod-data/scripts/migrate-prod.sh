#!/usr/bin/env bash
# migrate-prod.sh — "botón" seguro para aplicar migraciones pendientes a la DB de prod.
#
# DISEÑO DE SEGURIDAD
#   - sin args      -> SOLO dry-run: muestra el SQL que correría, NO toca prod.
#   - --apply       -> aplica de verdad (correr SOLO después de revisar el dry-run).
#   - Lee la URL de prod de <repo>/.env.prod (session pooler :5432). No la imprime.
#   - Usa `supabase db push`. ⚠️ ABORTA si el repo usa la convención
#     .up.sql/.down.sql en supabase/migrations/ (p.ej. DRIVLY) — ahí db push es
#     INCOMPATIBLE; los cambios van por el MCP `apply_migration`. Ver el guard abajo
#     y <repo>/docs/supabase-cli-workflow.md.
#
# ⚠️ IMPORTANTE
#   Para que el AGENTE pueda correr esto (remoto/celular), la sesión de Claude Code
#   debe lanzarse con  `claude --remote-control --dangerously-skip-permissions`.
#   En modo normal el clasificador bloquea toda conexión a prod, incluido este script.
#   El script NO saltea el guardarraíl — solo empaqueta el flujo seguro.
#
# FLUJO RECOMENDADO (phone-friendly)
#   1) ./migrate-prod.sh            # dry-run -> el agente te muestra el SQL
#   2) (vos confirmás por chat: "dale")
#   3) ./migrate-prod.sh --apply    # aplica a prod

set -euo pipefail

REPO="${DRIVLY_REPO:-$HOME/Projects/drivly}"
ENV_PROD="${ENV_PROD:-$REPO/.env.prod}"

APPLY=0
for a in "$@"; do [[ "$a" == "--apply" ]] && APPLY=1; done

[[ -f "$ENV_PROD" ]] || { echo "FATAL: no existe $ENV_PROD (URL de prod)"; exit 1; }
PROD_URL="$(grep -m1 '^DATABASE_URL=' "$ENV_PROD" | cut -d= -f2- | tr -d '"'"'")"
[[ -n "$PROD_URL" ]] || { echo "FATAL: no hay DATABASE_URL en $ENV_PROD"; exit 1; }
MASKED="$(printf '%s' "$PROD_URL" | sed -E 's#(://[^:]+:)[^@]+(@)#\1***\2#')"

cd "$REPO"
echo "═══ migrate-prod ═══"
echo "  Repo:    $REPO"
echo "  Target:  $MASKED"
echo ""

# GUARD — `supabase db push` es INCOMPATIBLE con repos que usan la convención
# .up.sql/.down.sql en supabase/migrations/ (DOS archivos por versión): el CLI ve
# cada versión duplicada e intentaría aplicar los .down (un REVERT) o explota por
# versión duplicada. Drivly es uno de esos repos (verificado 2026-05-30; el schema
# está sano, el problema es el MECANISMO). Reconciliar el tracking NO lo arregla.
if ls "$REPO"/supabase/migrations/*.down.sql >/dev/null 2>&1; then
  echo "✋ ABORT: $REPO usa la convención .up.sql/.down.sql en supabase/migrations/."
  echo "   'supabase db push' es INCOMPATIBLE con eso — NO lo corras acá."
  echo "   Aplicá cada cambio de schema vía el MCP de Supabase:"
  echo "     mcp__claude_ai_Supabase__apply_migration(name, query)   # aplica + registra el tracking"
  echo "   Ref: $REPO/docs/supabase-cli-workflow.md"
  exit 1
fi

echo "→ DRY-RUN (no toca prod): supabase db push --dry-run"
npx supabase db push --db-url "$PROD_URL" --dry-run

if [[ $APPLY -eq 0 ]]; then
  echo ""
  echo "── Solo dry-run. Revisá el SQL de arriba."
  echo "── Si está OK (solo lo esperado, sin DROP/.down), corré:  $0 --apply"
  exit 0
fi

echo ""
echo "→ APLICANDO a prod: supabase db push"
npx supabase db push --db-url "$PROD_URL"
echo ""
echo "✓ Migraciones aplicadas a prod."
