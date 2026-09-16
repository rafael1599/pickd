"""R9 · puntua las lecturas de `run_vlm_agy.sh` y escupe las tablas de R9-vlm-bench.md.

    python3 score_vlm.py raw/

Un campo solo cuenta si la verdad de terreno lo tiene: null en gt.json significa «no impreso en esa
foto», asi que una respuesta ahi no se anota como error. Modelo, talla y color no estan en gt.json
porque ningun codigo de barras los lleva: su verdad sale de la tabla §6 de 01-lo-aprendido.md.
"""
import collections
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
DOC = HERE.parent / '01-lo-aprendido.md'
RAW = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else HERE / 'raw')

photos = json.load(open(HERE / 'gt.json'))['photos']
gt = {p['file']: p for p in photos}
ids = {p['file']: p['id'] for p in photos}

# Modelo · talla · color, leidos de la tercera columna de la tabla §6.
texto = {}
for line in DOC.read_text().splitlines():
    m = re.match(r'\|\s*(\d+)\s*\|([^|]+)\|([^|]+)\|([^|]+)\|', line)
    if m:
        parts = [p.strip() for p in m.group(4).split('·')]
        if len(parts) >= 3:
            texto[m.group(1).strip()] = dict(zip(('model', 'size', 'color'), parts[:3]))

alnum = lambda v: re.sub(r'[^A-Z0-9]', '', str(v).upper()) if v is not None else None
digits = lambda v: re.sub(r'\D', '', str(v)) if v is not None else None


def kg(v):
    m = re.search(r'\d+(?:[.,]\d+)?', str(v)) if v is not None else None
    return round(float(m.group().replace(',', '.')), 2) if m else None


NAMES = {
    'gemini-3.8-flash-low': 'Gemini 3.8 Flash (Low)',
    'gemini-3.8-flash-high': 'Gemini 3.8 Flash (High)',
    'gemini-3.1-pro-high': 'Gemini 3.1 Pro (High)',
}
BAR = [('sku', 'SKU'), ('upc', 'UPC'), ('gtin', 'GTIN'), ('gw_kg', 'G.W.'), ('serial', 'Serie')]
TXT = [('model', 'Modelo'), ('size', 'Talla'), ('color', 'Color')]

bar = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
txt = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
secs = collections.defaultdict(list)
diffs = []

for f in sorted(RAW.glob('*.json')):
    model, photo_file = f.name[:-5].split('__')
    try:
        env = json.loads(f.read_text())
    except json.JSONDecodeError:
        print(f'# sin JSON (fallo de la corrida): {f.name}', file=sys.stderr)
        continue
    out = env.get('structured_output') or {}
    secs[model].append(env.get('duration_seconds') or 0)
    photo, pid = gt[photo_file], ids[photo_file]

    for key, _ in BAR:
        truth = photo.get({'gw_kg': 'gw'}.get(key, key))
        if key == 'serial':
            truth = truth or photo.get('frame_A')
        got = out.get(key)
        if not truth:
            continue
        if got in (None, '', 'null'):
            bar[model][key]['vacio'] += 1
            continue
        ok = (
            kg(got) == kg(truth) if key == 'gw_kg'
            else digits(got) == digits(truth) if key in ('upc', 'gtin')
            else alnum(got) in {alnum(x) for x in (photo.get('serial'), photo.get('frame_A')) if x}
            if key == 'serial'
            else alnum(got) == alnum(truth)
        )
        bar[model][key]['ok' if ok else 'mal'] += 1
        if not ok:
            diffs.append((NAMES.get(model, model), pid, key, got, truth))

    want = texto.get(pid.rstrip('ab'))  # 3a y 3b son la misma caja
    for key, _ in (TXT if want else []):
        got, exp = alnum(out.get(key)), alnum(want[key])
        if not got:
            txt[model][key]['vacio'] += 1
        elif exp and (exp in got or got in exp):
            txt[model][key]['ok'] += 1
        else:
            txt[model][key]['mal'] += 1
            diffs.append((NAMES.get(model, model), pid, key, out.get(key), want[key]))


def tabla(data, cols, con_tiempo):
    filas = ['| Modelo | ' + ' | '.join(c[1] for c in cols) + (' | Segundos por foto |' if con_tiempo else ' |'),
             '| --- |' + ' --- |' * (len(cols) + (1 if con_tiempo else 0))]
    for model in NAMES:
        if model not in secs:
            continue
        celdas = []
        for key, _ in cols:
            c = data[model][key]
            total = c['ok'] + c['mal'] + c['vacio']
            celdas.append(f"{c['ok']}/{total}" + (f" · {c['mal']} mal" if c['mal'] else ''))
        fila = f'| {NAMES[model]} | ' + ' | '.join(celdas)
        t = secs[model]
        filas.append(fila + (f' | {sum(t) / len(t):.0f} |' if con_tiempo else ' |'))
    return '\n'.join(filas)


print('## Campos que el codigo de barras ya da exactos\n')
print(tabla(bar, BAR, True))
print('\n## Campos que ningun codigo de barras lleva\n')
print(tabla(txt, TXT, False))
print('\n## Diferencias contra la verdad de terreno\n')
print('| Modelo | Foto | Campo | Dijo | Era |')
print('| --- | --- | --- | --- | --- |')
for name, pid, key, got, exp in diffs:
    print(f'| {name} | {pid} | {key} | `{got}` | `{exp}` |')
