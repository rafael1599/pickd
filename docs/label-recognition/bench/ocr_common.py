"""Utilidades compartidas por los runners de OCR: carga de fotos y volcado crudo.

Formato crudo por foto (raw/<engine>/<id>.json):
  {"id", "file", "engine", "ms", "size": [w, h], "boxes": [{"poly": [[x,y]x4], "text", "score"}]}
y un <id>.txt con las cajas agrupadas en lineas (orden y, luego x) para leerlo a ojo.
"""
import os
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

HERE = Path(__file__).parent
# Las fotos no están en el repo (una trae datos personales): se pasan por entorno.
UPLOADS = Path(os.environ["LABEL_PHOTOS_DIR"])


def photos():
    return json.loads((HERE / "gt.json").read_text())["photos"]


def load_rgb(file):
    return np.asarray(ImageOps.exif_transpose(Image.open(UPLOADS / file)).convert("RGB"))


def group_lines(boxes):
    """Agrupa cajas en lineas por solape vertical; devuelve lista de listas ordenadas por x."""
    items = []
    for b in boxes:
        ys = [p[1] for p in b["poly"]]
        xs = [p[0] for p in b["poly"]]
        items.append((min(ys), max(ys), min(xs), b))
    items.sort(key=lambda t: (t[0] + t[1]) / 2)
    lines = []
    for y0, y1, x0, b in items:
        cy = (y0 + y1) / 2
        for ln in lines:
            if ln["y0"] <= cy <= ln["y1"]:
                ln["items"].append((x0, b))
                ln["y0"], ln["y1"] = min(ln["y0"], y0), max(ln["y1"], y1)
                break
        else:
            lines.append({"y0": y0, "y1": y1, "items": [(x0, b)]})
    return [[b for _, b in sorted(ln["items"], key=lambda t: t[0])] for ln in lines]


def dump(engine, photo, ms, size, boxes):
    d = HERE / "raw" / engine
    d.mkdir(parents=True, exist_ok=True)
    rec = {"id": photo["id"], "file": photo["file"], "engine": engine, "ms": round(ms, 1), "size": size, "boxes": boxes}
    (d / f'{photo["id"]}.json').write_text(json.dumps(rec, indent=1, ensure_ascii=False))
    txt = "\n".join(" | ".join(f'{b["text"]}' for b in ln) for ln in group_lines(boxes))
    (d / f'{photo["id"]}.txt').write_text(txt + "\n")
    return rec
