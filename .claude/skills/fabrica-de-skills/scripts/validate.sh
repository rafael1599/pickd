#!/bin/bash

# validate.sh — Valida una skill contra el spec de agentskills.io
#
# Orden de resolución de skills-ref:
#   1. En PATH (venv activado o instalado globalmente)
#   2. En ~/agentskills/skills-ref/.venv/bin/skills-ref (instalación local)
#   3. Auto-instalación: clona agentskills/agentskills y corre uv sync
#   4. Fallback: validación básica local
#
# Uso: ./validate.sh skills/nombre-skill

set -e

SKILL_DIR="${1:-}"

if [ -z "$SKILL_DIR" ]; then
  echo "Error: Debes especificar el directorio de la skill"
  echo "Uso: ./validate.sh skills/nombre-skill"
  exit 1
fi

SKILL_FILE="$SKILL_DIR/SKILL.md"

if [ ! -f "$SKILL_FILE" ]; then
  echo "Error: No existe $SKILL_FILE"
  exit 1
fi

echo "🔍 Validando: $SKILL_FILE"
echo ""

# ── Resolver skills-ref ───────────────────────────────────────────────────────

SKILLS_REF_BIN=""

# 1. En PATH
if command -v skills-ref &> /dev/null; then
  SKILLS_REF_BIN="skills-ref"

# 2. Instalación local estándar (Unix: bin/, Windows: Scripts/)
elif [ -x "$HOME/agentskills/skills-ref/.venv/bin/skills-ref" ]; then
  SKILLS_REF_BIN="$HOME/agentskills/skills-ref/.venv/bin/skills-ref"
elif [ -x "$HOME/agentskills/skills-ref/.venv/Scripts/skills-ref.exe" ]; then
  SKILLS_REF_BIN="$HOME/agentskills/skills-ref/.venv/Scripts/skills-ref.exe"

# 3. Auto-instalación via uv
elif command -v uv &> /dev/null; then
  echo "skills-ref no encontrado. Instalando desde repo oficial..."
  echo ""
  git clone --quiet https://github.com/agentskills/agentskills "$HOME/agentskills" 2>/dev/null \
    || git -C "$HOME/agentskills" pull --quiet
  (cd "$HOME/agentskills/skills-ref" && uv sync --quiet)
  # Detectar ruta según OS
  if [ -x "$HOME/agentskills/skills-ref/.venv/bin/skills-ref" ]; then
    SKILLS_REF_BIN="$HOME/agentskills/skills-ref/.venv/bin/skills-ref"
  elif [ -x "$HOME/agentskills/skills-ref/.venv/Scripts/skills-ref.exe" ]; then
    SKILLS_REF_BIN="$HOME/agentskills/skills-ref/.venv/Scripts/skills-ref.exe"
  fi
  echo "✓ skills-ref instalado en ~/agentskills/skills-ref/.venv"
  echo ""
fi

# ── Validación oficial ────────────────────────────────────────────────────────
if [ -n "$SKILLS_REF_BIN" ]; then
  echo "Usando skills-ref (validación oficial)..."
  "$SKILLS_REF_BIN" validate "$SKILL_DIR"
  exit $?
fi

# ── Fallback: validación básica local ────────────────────────────────────────
echo "skills-ref no disponible (instala uv para habilitarlo). Ejecutando validación básica..."
echo ""

ERRORS=0
WARNINGS=0

check() {
  local label="$1"
  local condition="$2"
  local is_error="${3:-true}"

  if eval "$condition"; then
    echo "  ✓ $label"
  else
    if [ "$is_error" = "true" ]; then
      echo "  ✗ $label"
      ERRORS=$((ERRORS + 1))
    else
      echo "  ⚠ $label"
      WARNINGS=$((WARNINGS + 1))
    fi
  fi
}

# Verificar frontmatter existe
check "Frontmatter presente (---)" \
  "head -1 '$SKILL_FILE' | grep -q '^---$'"

# Verificar campos obligatorios
check "Campo 'name' presente" \
  "grep -q '^name:' '$SKILL_FILE'"

check "Campo 'version' presente" \
  "grep -q '^version:' '$SKILL_FILE'"

check "Campo 'description' presente" \
  "grep -q '^description:' '$SKILL_FILE'"

check "Campo 'license' presente" \
  "grep -q '^license:' '$SKILL_FILE'"

check "Campo 'allowed-tools' presente" \
  "grep -q '^allowed-tools:' '$SKILL_FILE'"

# Verificar formato name (kebab-case)
NAME=$(grep '^name:' "$SKILL_FILE" | head -1 | sed 's/name: //' | tr -d '"' | tr -d "'" | tr -d ' ')
check "Nombre en kebab-case (sin espacios, sin mayúsculas)" \
  "echo '$NAME' | grep -qE '^[a-z][a-z0-9-]+$'"

# Verificar versión semver
VERSION=$(grep '^version:' "$SKILL_FILE" | head -1 | sed 's/version: //' | tr -d '"' | tr -d "'" | tr -d ' ')
check "Versión en formato semver (X.Y.Z)" \
  "echo '$VERSION' | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'"

# Verificar secciones del body (acepta español e inglés)
check "Sección de instrucciones presente (## Instrucciones o ## Instructions)" \
  "grep -qE '^## (Instrucciones|Instructions)' '$SKILL_FILE'"

check "Al menos 1 bloque de código presente" \
  "grep -q '^\`\`\`' '$SKILL_FILE'"

# Verificar longitud description
DESC=$(grep '^description:' "$SKILL_FILE" | head -1 | sed 's/description: //' | tr -d '"')
DESC_LEN=${#DESC}
check "Description menor a 200 caracteres (actual: ${DESC_LEN})" \
  "[ $DESC_LEN -lt 200 ]" "true"

# Warnings (no bloquean)
check "Sección de decisiones/edge cases presente (## Decisiones o ## Prerequisites)" \
  "grep -qE '^## (Decisiones|Prerequisites)' '$SKILL_FILE'" "false"

check "Sección de errores presente (## Errores comunes o ## Common Issues)" \
  "grep -qE '^## (Errores comunes|Common Issues)' '$SKILL_FILE'" "false"

check "Sección de referencias presente (## Referencias o ## References)" \
  "grep -qE '^## (Referencias|References)' '$SKILL_FILE'" "false"

echo ""
echo "────────────────────────────────────────"

if [ $ERRORS -gt 0 ]; then
  echo "❌ Validación fallida: $ERRORS error(s), $WARNINGS advertencia(s)"
  echo ""
  echo "Para validación oficial instala uv:"
  echo "  curl -LsSf https://astral.sh/uv/install.sh | sh"
  echo "  # Luego vuelve a correr ./validate.sh — se instala automáticamente"
  exit 1
else
  echo "✅ Validación pasada: 0 errores, $WARNINGS advertencia(s)"
  echo ""
  if [ $WARNINGS -gt 0 ]; then
    echo "Considera agregar las secciones opcionales para mejorar la skill."
  fi
fi
