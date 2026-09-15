"""R6 · OCR con rapidocr-onnxruntime (PP-OCRv4 det+rec 'ch', cls mobile v2) sobre las 14 fotos.

Uso: python run_rapidocr.py <max_side_len>   (2000 = default de la libreria; 4000 = resolucion completa)
"""
import sys
import time

import numpy as np
from rapidocr_onnxruntime import RapidOCR

from ocr_common import dump, load_rgb, photos

max_side = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
engine_name = f"rapidocr_v4_{max_side}"
eng = RapidOCR(max_side_len=max_side)
eng(np.full((200, 600, 3), 255, np.uint8))  # warm-up

total = 0.0
for p in photos():
    rgb = load_rgb(p["file"])
    bgr = rgb[:, :, ::-1].copy()
    t0 = time.perf_counter()
    res, _ = eng(bgr)
    ms = (time.perf_counter() - t0) * 1000
    total += ms
    boxes = [
        {"poly": [[float(x), float(y)] for x, y in box], "text": text, "score": round(float(score), 4)}
        for box, text, score in (res or [])
    ]
    dump(engine_name, p, ms, [rgb.shape[1], rgb.shape[0]], boxes)
    print(f'{p["id"]:>3} {ms:7.0f} ms  {len(boxes):3d} cajas')
print(f"total {total/1000:.1f} s")
