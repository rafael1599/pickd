"""R6 · barras con zxing-cpp sobre las 14 fotos de verdad de terreno.

Para cada foto prueba una escalera de variantes (original, escalas, binarizador global,
rotaciones finas, mosaicos a resolucion completa, CLAHE) y guarda TODO lo decodificado, con
la variante que lo encontro y el tiempo. La union de variantes es "lo mejor que zxing saca";
S0 (una sola llamada por defecto) es lo que haria una app ingenua.

Salida: raw/barcodes.json
"""
import os
import json
import time
from pathlib import Path

import cv2
import numpy as np
import zxingcpp
from PIL import Image, ImageOps

HERE = Path(__file__).parent
# Las fotos no están en el repo (una trae datos personales): se pasan por entorno.
UPLOADS = Path(os.environ["LABEL_PHOTOS_DIR"])


def load_bgr(path):
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    return cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2BGR)


def rotate(img, angle):
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    cos, sin = abs(m[0, 0]), abs(m[0, 1])
    nw, nh = int(h * sin + w * cos), int(h * cos + w * sin)
    m[0, 2] += nw / 2 - w / 2
    m[1, 2] += nh / 2 - h / 2
    return cv2.warpAffine(img, m, (nw, nh), borderValue=(255, 255, 255))


def tiles(img, n, overlap=0.25):
    h, w = img.shape[:2]
    th, tw = int(h / n * (1 + overlap)), int(w / n * (1 + overlap))
    for i in range(n):
        for j in range(n):
            y = min(int(i * h / n), h - th) if n > 1 else 0
            x = min(int(j * w / n), w - tw) if n > 1 else 0
            yield f"t{n}_{i}{j}", img[max(0, y):y + th, max(0, x):x + tw]


def variants(bgr):
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    yield "S0_default", bgr, {}
    yield "S1_gray_globalhist", gray, {"binarizer": zxingcpp.Binarizer.GlobalHistogram}
    for s in (0.5, 0.35, 0.25):
        yield f"S2_scale{s}", cv2.resize(gray, None, fx=s, fy=s, interpolation=cv2.INTER_AREA), {}
    for a in (-30, -15, 15, 30, 45):
        yield f"S3_rot{a}", rotate(gray, a), {}
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(gray)
    yield "S5_clahe", clahe, {}
    for n in (2, 3):
        for name, t in tiles(gray, n):
            yield f"S4_{name}", t, {}


def main():
    gt = json.loads((HERE / "gt.json").read_text())
    out_path = HERE / "raw" / "barcodes.json"
    existing = {}
    if out_path.exists():
        try:
            for r in json.loads(out_path.read_text()):
                existing[r["file"]] = r
        except Exception:
            pass
    out = []
    for p in gt["photos"]:
        path = UPLOADS / p["file"]
        if not path.exists():
            if p["file"] in existing:
                out.append(existing[p["file"]])
            continue
        bgr = load_bgr(path)
        rec = {"id": p["id"], "file": p["file"], "size": [bgr.shape[1], bgr.shape[0]], "variants": [], "union": {}}
        t_all = time.perf_counter()
        for name, img, kw in variants(bgr):
            t0 = time.perf_counter()
            try:
                res = zxingcpp.read_barcodes(img, return_errors=True, **kw)
            except Exception as e:  # noqa: BLE001
                rec["variants"].append({"variant": name, "error": repr(e)})
                continue
            dt = time.perf_counter() - t0
            found = []
            for r in res:
                item = {
                    "format": str(r.format).split(".")[-1],
                    "text": r.text,
                    "valid": r.valid,
                    "error": str(r.error) if r.error else None,
                    "symbology": r.symbology_identifier,
                }
                found.append(item)
                key = f'{item["format"]}|{item["text"]}|{"ok" if r.valid else "err"}'
                u = rec["union"].setdefault(key, {**item, "variants": []})
                u["variants"].append(name)
            rec["variants"].append({"variant": name, "ms": round(dt * 1000, 1), "found": found})
        rec["total_ms"] = round((time.perf_counter() - t_all) * 1000, 1)
        s0 = rec["variants"][0]
        print(f'{p["id"]:>3} S0 {s0.get("ms")}ms -> {[f["text"] for f in s0.get("found", [])]}')
        print(f'    union ({rec["total_ms"]}ms): {sorted(k for k in rec["union"])}')
        out.append(rec)
    (HERE / "raw").mkdir(exist_ok=True)
    (HERE / "raw" / "barcodes.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
