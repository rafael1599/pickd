# Ejemplo: Ship Card (pickd)

Origen del skill: el artifact «Ship Card Layout Lab» (28 ago 2026) con el que Rafael reacomodó
`src/components/orders/ShipOrderCard.tsx` de pickd. Sirve como referencia de cómo se ven un
`atoms.html` y un `presets.json` bien hechos (35 átomos, datos reales, `today` = layout de
entonces a 520 px, `proposal` = sugerencia a 800 px).

Regenerar el lab idéntico al original:

```bash
python3 ../../scripts/build.py --title "Ship Card Layout Lab" --key pickd:ship-card \
  --atoms atoms.html --presets presets.json --out /tmp/ship-card-lab.html \
  --widths "Teléfono 360=360" "40 % · 520=520" "60 % · 800=800" "Ancho · 1000=1000"
```

Los anchos 40 %/60 % son las columnas del split view de Ship en pickd; por eso no son los
chips genéricos.
