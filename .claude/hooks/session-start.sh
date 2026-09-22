#!/bin/sh
# Lo primero de cada sesión: traer el remoto y decir en voz alta si este árbol
# no es lo que está en línea.
#
# Por qué existe (22 sep 2026): una sesión analizó "el estado actual" con
# `git rev-list --left-right --count origin/main...HEAD`, obtuvo `0 0` y escribió
# "todo desplegado". `origin/main` es una copia local que sólo se mueve cuando la
# traes, y llevaba cuatro días sin tocarse: el checkout iba **70 commits por
# detrás** — reconocimiento de etiquetas, /live-check, sku_serials y tres
# migraciones. Un ref sin refrescar no dice "estamos al día", dice "no he mirado",
# y las dos cosas se leen igual. Aquí se mira siempre, antes de que nadie razone
# sobre el estado.
#
# Este repo es un checkout compartido por varias sesiones a la vez, así que
# también cuenta lo que hay sin commitear: puede no ser tuyo.
#
# Nunca falla: sin red, sin remoto o fuera de un repo, calla y sale con 0.

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

git fetch --quiet origin 2>/dev/null || true

base=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || echo origin/main)
behind=$(git rev-list --count "HEAD..$base" 2>/dev/null || echo 0)
ahead=$(git rev-list --count "$base..HEAD" 2>/dev/null || echo 0)
dirty=$(git status --porcelain 2>/dev/null | grep -c . || echo 0)
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')

msg="git: $branch — al día con $base"
[ "$behind" -gt 0 ] && msg="git: $branch va $behind commits POR DETRÁS de $base (recién traído). Este árbol no es lo que está en línea: pull antes de analizar el estado, planear o commitear."
[ "$ahead" -gt 0 ] && msg="$msg · $ahead commit(s) locales sin empujar."
[ "$dirty" -gt 0 ] && msg="$msg · $dirty archivo(s) sin commitear — checkout compartido, puede que no sean tuyos."

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"},"systemMessage":"%s"}\n' "$msg" "$msg"
