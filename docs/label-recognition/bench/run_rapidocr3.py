"""R6 · OCR con rapidocr 3.x (ONNX Runtime) y modelos PP-OCRv5 / PP-OCRv6.

Los modelos se descargan una vez de ModelScope a bench/models/rapidocr3 (solo bajan modelos;
ninguna foto sale de la maquina).
Uso: python run_rapidocr3.py <preset> [max_side_len] [id,id,...]
  presets: v6small (default de la libreria 3.9.2), v6medium, v5mobile, v5server
"""
import sys
import time

import numpy as np
from rapidocr import LangDet, LangRec, ModelType, OCRVersion, RapidOCR

from ocr_common import HERE, dump, load_rgb, photos

preset = sys.argv[1] if len(sys.argv) > 1 else "v6small"
max_side = int(sys.argv[2]) if len(sys.argv) > 2 else 2000
only = set(sys.argv[3].split(",")) if len(sys.argv) > 3 else None

PRESETS = {
    "v6small": dict(ver=OCRVersion.PPOCRV6, det_lang=None, rec_lang=None, mt=ModelType.SMALL),
    "v6medium": dict(ver=OCRVersion.PPOCRV6, det_lang=None, rec_lang=None, mt=ModelType.MEDIUM),
    "v5mobile": dict(ver=OCRVersion.PPOCRV5, det_lang=LangDet.CH, rec_lang=LangRec.CH, mt=ModelType.MOBILE),
    "v5server": dict(ver=OCRVersion.PPOCRV5, det_lang=LangDet.CH, rec_lang=LangRec.CH, mt=ModelType.SERVER),
}
cfg = PRESETS[preset]
mroot = HERE / "models" / "rapidocr3"
mroot.mkdir(parents=True, exist_ok=True)
params = {
    "Global.max_side_len": max_side,
    "Global.log_level": "warning",
    "Global.model_root_dir": str(mroot),
    "Det.ocr_version": cfg["ver"],
    "Det.model_type": cfg["mt"],
    "Rec.ocr_version": cfg["ver"],
    "Rec.model_type": cfg["mt"],
}
# v6 es multilingue: se deja el lang_type por defecto de la libreria (la clave del modelo es multi_*)
if cfg["det_lang"]:
    params["Det.lang_type"] = cfg["det_lang"]
    params["Rec.lang_type"] = cfg["rec_lang"]
engine_name = f"rapidocr3_{preset}_{max_side}"
t0 = time.perf_counter()
eng = RapidOCR(params=params)
print(f"load {time.perf_counter()-t0:.1f}s")
eng(np.full((200, 600, 3), 255, np.uint8))

total = 0.0
for p in photos():
    if only and p["id"] not in only:
        continue
    rgb = load_rgb(p["file"])
    bgr = rgb[:, :, ::-1].copy()
    t0 = time.perf_counter()
    r = eng(bgr)
    ms = (time.perf_counter() - t0) * 1000
    total += ms
    boxes = []
    if r.boxes is not None:
        for box, text, score in zip(r.boxes, r.txts, r.scores):
            boxes.append({"poly": [[float(x), float(y)] for x, y in box], "text": text, "score": round(float(score), 4)})
    dump(engine_name, p, ms, [rgb.shape[1], rgb.shape[0]], boxes)
    print(f'{p["id"]:>3} {ms:7.0f} ms  {len(boxes):3d} cajas', flush=True)
print(f"total {total/1000:.1f} s")
