#!/bin/zsh
# R9 · pasa las fotos de la verdad de terreno por varios modelos de Gemini, usando el CLI de
# Antigravity (`agy`) que ya esta autenticado en esta maquina. Coste 0: va contra el plan de
# Antigravity, no por API de pago.
#
#   LABEL_PHOTOS_DIR=/ruta/a/las/fotos ./run_vlm_agy.sh raw/
#
# Las fotos NO estan en el repo: una lleva una etiqueta de FedEx con el nombre y la direccion de
# una persona, y esa se excluye aqui a proposito (no debe salir de la maquina).
set -e
: ${LABEL_PHOTOS_DIR:?falta LABEL_PHOTOS_DIR}
OUT=${1:-raw}
HERE=${0:a:h}
mkdir -p "$OUT"

FEDEX=22b02909-image.jpg   # nombre y direccion de una persona
MODELOS=(gemini-3.8-flash-low gemini-3.8-flash-high gemini-3.1-pro-high)
FOTOS=($(python3 -c "
import json
print('\n'.join(p['file'] for p in json.load(open('$HERE/gt.json'))['photos'] if p['file'] != '$FEDEX'))
"))

PREGUNTA='Mira la foto %s con tu herramienta de ver archivos y devuelve los campos impresos en la etiqueta. sku = STOCK NO / ITEM NO. upc = UPC NO de 12 digitos. gtin = GTIN-14 si aparece. gw_kg = valor de G.W. en kg (NO el N.W.). serial = numero de serie del cuadro. model, size, color = como esten impresos. Usa null en todo lo que NO este impreso. No adivines.'

for m in $MODELOS; do
  for f in $FOTOS; do
    dest="$OUT/${m}__${f}.json"
    [ -s "$dest" ] && head -c 1 "$dest" | grep -q '{' && continue
    agy -p "$(printf "$PREGUNTA" "$LABEL_PHOTOS_DIR/$f")" \
      --model "$m" --output-format json --json-schema "$HERE/vlm_schema.json" \
      --add-dir "$LABEL_PHOTOS_DIR" --sandbox --dangerously-skip-permissions \
      --print-timeout 300s > "$dest" 2>&1 || true
  done
done
echo "$(ls -1 "$OUT" | wc -l) lecturas en $OUT"
