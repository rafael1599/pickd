"""R6 · chequeos para contrastar con §5 de 01-lo-aprendido.md.

1. Texto blanco sobre negro: nombre de modelo en la caja negra (tipos A y B) y SKU en caja negra.
2. Catalogo de confusiones de glifo: pares verdad->lectura en los `near` de igual longitud.
3. Validacion determinista que las atrapa: digito de control, G.W. - N.W. = 3,90 (tipo B).

Salida: extra.md
"""
import json
import re
from collections import Counter
from pathlib import Path

from ocr_common import group_lines
from score import norm

HERE = Path(__file__).parent
GT = {p["id"]: p for p in json.loads((HERE / "gt.json").read_text())["photos"]}
R = json.loads((HERE / "results.json").read_text())
ENGINES = [e for e in R["engines"] if not e.startswith("zxing")]

# modelo impreso en caja negra (texto blanco); 3b esta rayado a proposito
MODEL_BLACK = {"1": "RENEGADE A1 LTD", "2": "DXT A3", "3a": "RENEGADE S2", "3b": "RENEGADE S2", "4": "RENEGADE S1 FRAMEKIT",
               "5": "RENEGADE S1 FRAMEKIT", "6": "CITIZEN 1", "7": "SEQUEL S2", "8": "EARTH CRUISER 3"}
SKU_BLACK = ["1", "2", "3a", "3b", "4", "5", "6", "7", "8", "9"]  # 9: caja negra de la etiqueta C
FILM = ["3a", "3b", "8"]  # film plastico / cinta con brillo encima de la etiqueta


def texts(e, pid):
    rec = json.loads((HERE / "raw" / e / f"{pid}.json").read_text())
    lines = group_lines(rec["boxes"])
    return [norm(b["text"]) for b in rec["boxes"]] + ["".join(norm(b["text"]) for b in ln) for ln in lines]


out = ["# R6 · chequeos extra (extra_checks.py)", ""]
out += ["## Texto blanco sobre negro", "", "| motor | modelo en caja negra (9) | SKU en caja negra (10) |", "|---|---|---|"]
for e in ENGINES:
    m = sum(any(norm(v) in t for t in texts(e, pid)) for pid, v in MODEL_BLACK.items())
    s = sum(R["photos"][pid][e]["score"]["sku"] in ("box", "line") for pid in SKU_BLACK)
    out.append(f"| {e} | {m}/9 | {s}/10 |")

out += ["", "## Confusiones de glifo (sustituciones en lecturas a <=2 ediciones de igual longitud)", ""]
pairs = Counter()
examples = {}
shifted = set()
for pid, pr in R["photos"].items():
    for e in ENGINES:
        for f, d in pr[e]["detail"].items():
            if not isinstance(d, dict) or d.get("level") != "near":
                continue
            truth = norm(GT[pid][f]) if f != "gtin" else GT[pid][f]
            snip = d["snippet"]
            if len(snip) != len(truth):
                continue
            if sum(a != b for a, b in zip(truth, snip)) > 2:
                shifted.add(f"{pid}:{f} `{truth}`→`{snip}`")  # desplazamiento (UPC-A partido), no sustitucion
                continue
            for a, b in zip(truth, snip):
                if a != b:
                    pairs[(a, b)] += 1
                    examples.setdefault((a, b), set()).add(f"{pid}:{f} `{truth}`→`{snip}`")
out += ["| verdad → lectura | veces (todas las corridas OCR) | ejemplos |", "|---|---|---|"]
for (a, b), n in pairs.most_common():
    out.append(f"| `{a}` → `{b}` | {n} | " + "; ".join(sorted(examples[(a, b)])[:3]) + " |")
out += ["", "Desplazamientos (misma longitud por casualidad, no son sustituciones de glifo): " + "; ".join(sorted(shifted))]

out += ["", "## Film plastico / cinta encima (3a, 3b, 8): aciertos exactos por campo", "", "| motor | SKU | UPC | G.W. | ", "|---|---|---|---|"]
for e in ["zxing_union"] + ENGINES:
    cells = []
    for f in ("sku", "upc", "gw"):
        xs = [R["photos"][pid][e]["score"].get(f) for pid in FILM if GT[pid].get(f)]
        cells.append(f'{sum(x in ("hit", "box", "line", "bound") for x in xs)}/{len(xs)}')
    out.append(f"| {e} | " + " | ".join(cells) + " |")

# G.W. - N.W. en tipo B (dos decimales): 6 y 8 y 12
out += ["", "## Regla G.W. − N.W. = 3,90 (tipo B) sobre lo que leyo cada OCR", ""]
for pid in ("6", "8", "12"):
    row = []
    for e in ENGINES:
        rec = json.loads((HERE / "raw" / e / f"{pid}.json").read_text())
        joined = " ".join(b["text"] for ln in group_lines(rec["boxes"]) for b in ln).upper()
        nums = [float(x.replace(",", ".")) for x in re.findall(r"(\d{1,2}[.,]\d{2})\s*K?G", joined)]
        row.append(f"{e}: {nums}")
    out.append(f"- foto {pid} (verdad GW {GT[pid]['gw']}): " + " · ".join(row))
(HERE / "extra.md").write_text("\n".join(out) + "\n")
print("\n".join(out))
