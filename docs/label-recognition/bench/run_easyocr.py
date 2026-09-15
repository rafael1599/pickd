"""R6 · OCR con EasyOCR (CRAFT + CRNN 'en', PyTorch CPU) sobre las 14 fotos.

Modelos en bench/models/easyocr (nunca en ~/.EasyOCR). Corre con .venv-easy.
Uso: python run_easyocr.py [canvas_size] [id,id,...]   (2560 = default de la libreria)
Ojo: en segundo plano macOS lo baja a QoS de fondo y tarda ~15x mas (242 s/foto); correr en primer plano.
"""
import sys
import time
from pathlib import Path

import easyocr
import numpy as np

from ocr_common import HERE, dump, load_rgb, photos

canvas = int(sys.argv[1]) if len(sys.argv) > 1 else 2560
engine_name = f"easyocr_en_{canvas}"
only = set(sys.argv[2].split(",")) if len(sys.argv) > 2 else None
mdir = HERE / "models" / "easyocr"
mdir.mkdir(parents=True, exist_ok=True)
t0 = time.perf_counter()
reader = easyocr.Reader(["en"], gpu=False, model_storage_directory=str(mdir), user_network_directory=str(mdir / "user"), verbose=False)
print(f"load {time.perf_counter()-t0:.1f}s")
reader.readtext(np.full((200, 600, 3), 255, np.uint8))  # warm-up

total = 0.0
for p in photos():
    if only and p["id"] not in only:
        continue
    rgb = load_rgb(p["file"])
    t0 = time.perf_counter()
    res = reader.readtext(rgb, canvas_size=canvas)
    ms = (time.perf_counter() - t0) * 1000
    total += ms
    boxes = [
        {"poly": [[float(x), float(y)] for x, y in box], "text": text, "score": round(float(score), 4)}
        for box, text, score in res
    ]
    dump(engine_name, p, ms, [rgb.shape[1], rgb.shape[0]], boxes)
    print(f'{p["id"]:>3} {ms:7.0f} ms  {len(boxes):3d} cajas', flush=True)
print(f"total {total/1000:.1f} s")
