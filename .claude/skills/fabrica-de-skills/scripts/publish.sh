#!/bin/bash

# publish.sh — Publica una skill al portal Hermit
#
# Uso: ./publish.sh skills/nombre-skill
# Ejemplo: ./publish.sh skills/cloudflare-tunnels

set -e

SKILL_DIR="${1:-}"

if [ -z "$SKILL_DIR" ]; then
  echo "Error: Debes especificar el directorio de la skill"
  echo "Uso: ./publish.sh skills/nombre-skill"
  exit 1
fi

if [ ! -f "$SKILL_DIR/SKILL.md" ]; then
  echo "Error: No existe SKILL.md en $SKILL_DIR"
  exit 1
fi

# Cargar variables de entorno
if [ -f ".env" ]; then
  export $(grep -v '^#' .env | xargs)
else
  HERMIT_URL="${HERMIT_URL:-http://localhost:8080}"
  HERMIT_TOKEN="${HERMIT_TOKEN:-}"
fi

if [ -z "$HERMIT_TOKEN" ]; then
  echo "Error: HERMIT_TOKEN no configurado en .env"
  exit 1
fi

# Extraer metadata del frontmatter
SKILL_NAME=$(grep '^name:' "$SKILL_DIR/SKILL.md" | head -1 | sed 's/name:[[:space:]]*//' | tr -d '"' | tr -d "'" | tr -d '[:space:]')
SKILL_VERSION=$(grep '^version:' "$SKILL_DIR/SKILL.md" | head -1 | sed 's/version:[[:space:]]*//' | tr -d '"' | tr -d "'" | tr -d '[:space:]')
SKILL_DESCRIPTION=$(grep '^description:' "$SKILL_DIR/SKILL.md" | head -1 | sed 's/description:[[:space:]]*//' | tr -d '"')
SKILL_DISPLAY=$(grep '^# ' "$SKILL_DIR/SKILL.md" | head -1 | sed 's/^# //')
SKILL_TAGS=$(grep '^  tags:' "$SKILL_DIR/SKILL.md" | head -1 | sed 's/.*\[//' | sed 's/\].*//' | tr -d ' ' | sed 's/,/","/g' | sed 's/^/"/' | sed 's/$/"/')

# Usar displayName del frontmatter o el # heading
if [ -z "$SKILL_DISPLAY" ]; then
  SKILL_DISPLAY="$SKILL_NAME"
fi

echo "📦 Publicando skill..."
echo "   Nombre:  $SKILL_NAME"
echo "   Versión: $SKILL_VERSION"
echo "   Portal:  $HERMIT_URL"
echo ""

PAYLOAD=$(python3 -c "
import json, sys
payload = {
    'slug': '$SKILL_NAME',
    'displayName': '$SKILL_DISPLAY',
    'version': '$SKILL_VERSION',
    'changelog': 'Published via publish.sh',
    'summary': '''$SKILL_DESCRIPTION'''.strip(),
    'tags': [t.strip().strip('\"') for t in '$SKILL_TAGS'.split(',') if t.strip()]
}
print(json.dumps(payload))
")

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$HERMIT_URL/api/v1/skills" \
  -H "Authorization: Bearer $HERMIT_TOKEN" \
  -F "payload=$PAYLOAD" \
  -F "files=@$SKILL_DIR/SKILL.md;filename=SKILL.md")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -1)

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
  echo "✅ Skill publicada exitosamente en el portal"
  echo ""

  # Instalar localmente para que Claude la use en nuevas sesiones
  LOCAL_SKILL_DIR="$HOME/.claude/skills/$SKILL_NAME"
  mkdir -p "$LOCAL_SKILL_DIR"
  cp "$SKILL_DIR/SKILL.md" "$LOCAL_SKILL_DIR/SKILL.md"
  echo "📥 Skill instalada localmente en: $LOCAL_SKILL_DIR"
  echo ""
  echo "🌐 Ver en portal: $HERMIT_URL"
  echo ""
  echo "Verificar en portal:"
  echo "  curl -s $HERMIT_URL/api/v1/skills -H 'Authorization: Bearer $HERMIT_TOKEN' | python3 -m json.tool"
else
  echo "❌ Error al publicar (HTTP $HTTP_CODE)"
  echo "Respuesta: $BODY"
  exit 1
fi
