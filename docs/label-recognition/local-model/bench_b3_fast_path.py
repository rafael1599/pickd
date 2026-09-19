#!/usr/bin/env python3
"""Benchmark B3: Camino rápido con OCR local (RapidOCR v5mobile y v6medium) + Códigos de Barras (zxing-cpp).

Mide en esta máquina (Linux / i9-10900KF / RTX 3060):
1. zxing-cpp (S0 y unión)
2. rapidocr3 v5mobile (CPU y GPU)
3. rapidocr3 v6medium (CPU y GPU)
4. Fusión determinista: Barras + OCR (con posiciones para GW/Serial y extracción de Model/Size/Color).

Compara precisión por campo y latencia real por foto contra el umbral de ≤ 3–5 segundos.
"""

import json
import os
import pathlib
import re
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
from PIL import Image, ImageOps
import zxingcpp
from rapidocr import RapidOCR, OCRVersion, ModelType, LangDet, LangRec

HERE = pathlib.Path(__file__).parent.resolve()
REPO_ROOT = HERE.parent.parent.parent
BENCH_DIR = REPO_ROOT / "docs" / "label-recognition" / "bench"
RESULTS_R6_FILE = BENCH_DIR / "results.md"
GT_FILE = BENCH_DIR / "gt.json"

DEFAULT_PHOTOS_DIR = "/home/confi/.claude/uploads/26a63557-6830-40d9-9d43-85353dc4aa09"
LABEL_PHOTOS_DIR = pathlib.Path(os.environ.get("LABEL_PHOTOS_DIR", DEFAULT_PHOTOS_DIR))

# Configurar librerías CUDA si están disponibles
os.environ["LD_LIBRARY_PATH"] = f"/usr/lib:{os.environ.get('LD_LIBRARY_PATH', '')}"


def norm(s: Optional[str]) -> str:
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def upc_ok(d: str) -> bool:
    if not re.fullmatch(r"\d{12}", d):
        return False
    s = sum(int(c) * (3 if i % 2 == 0 else 1) for i, c in enumerate(d[:11]))
    return (10 - s % 10) % 10 == int(d[11])


def gtin14_ok(d: str) -> bool:
    if not re.fullmatch(r"\d{14}", d):
        return False
    s = sum(int(c) * (3 if i % 2 == 0 else 1) for i, c in enumerate(d[:13]))
    return (10 - s % 10) % 10 == int(d[13])


def kg(v: Any) -> Optional[float]:
    m = re.search(r"\d+(?:[.,]\d+)?", str(v)) if v is not None else None
    return round(float(m.group().replace(",", ".")), 2) if m else None


# -------------------------------------------------------------------------
# Carga de Verdad de Terreno
# -------------------------------------------------------------------------
def load_gt() -> List[Dict[str, Any]]:
    return json.loads(GT_FILE.read_text())["photos"]


# -------------------------------------------------------------------------
# Decodificación de Códigos de Barras (zxing-cpp)
# -------------------------------------------------------------------------
def read_barcodes_photo(img_bgr: np.ndarray) -> Dict[str, Any]:
    """Ejecuta zxing-cpp S0 (1 llamada directa) y variantes básicas."""
    t0 = time.perf_counter()
    res_s0 = zxingcpp.read_barcodes(img_bgr)
    ms_s0 = (time.perf_counter() - t0) * 1000

    # Unión con rotación y resize
    t_union_0 = time.perf_counter()
    all_res = list(res_s0)
    for scale in [0.5, 0.75]:
        h, w = img_bgr.shape[:2]
        small = cv2.resize(img_bgr, (int(w * scale), int(h * scale)))
        all_res.extend(zxingcpp.read_barcodes(small))
    for angle in [90, 180, 270]:
        rot = cv2.rotate(img_bgr, {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}[angle])
        all_res.extend(zxingcpp.read_barcodes(rot))
    ms_union = (time.perf_counter() - t_union_0) * 1000 + ms_s0

    def parse_codes(res_list):
        codes = []
        seen = set()
        for r in res_list:
            if r.valid and r.text and r.text not in seen:
                seen.add(r.text)
                codes.append({"format": str(r.format).split(".")[-1], "text": r.text})
        return codes

    return {
        "s0": parse_codes(res_s0),
        "union": parse_codes(all_res),
        "ms_s0": ms_s0,
        "ms_union": ms_union,
    }


# -------------------------------------------------------------------------
# Agrupación y Extracción Determinista de Campos desde Cajas OCR
# -------------------------------------------------------------------------
def group_lines(boxes: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    """Agrupa cajas en líneas por solape vertical; devuelve lista de listas ordenadas por x."""
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


def clean_val(v: Optional[str]) -> Optional[str]:
    if not v:
        return None
    v = re.sub(r"^[:.\s|\"']+", "", v)
    v = re.sub(r"[:.\s|\"']+$", "", v)
    return v.strip() if len(v.strip()) > 0 else None


def extract_fields_from_ocr(boxes: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Extrae SKU, UPC, GTIN, G.W., Serie, Modelo, Talla y Color usando agrupación de líneas y proximidad."""
    lines = group_lines(boxes)
    line_strs = [" | ".join(b["text"].strip() for b in ln) for ln in lines]
    full_text = " \n ".join(line_strs)

    # 1. SKU: Buscar formato DD-NNNN[CC] o DD-NNNN-CC
    sku_val = None
    m_sku = re.search(r"\b(\d{2}-\d{4}-?[A-Z]{0,2})\b", full_text)
    if m_sku:
        sku_val = m_sku.group(1).replace("-", "")
    else:
        # Repuesto a granel con ITEM NO (ej. PP1202JC)
        m_part = re.search(r"\b([A-Z]{2}\d{4}[A-Z]{2})\b", full_text)
        if m_part:
            sku_val = m_part.group(1)

    # 2. UPC / GTIN por checksum en texto
    upc_val = None
    gtin_val = None
    for d in re.findall(r"\b\d{12,14}\b", full_text):
        if len(d) == 12 and upc_ok(d):
            upc_val = d
        elif len(d) == 14 and gtin14_ok(d):
            gtin_val = d
            if d.startswith("00") and upc_ok(d[2:]):
                upc_val = d[2:]

    # 3. Modelo
    model_val = None
    for i, ln in enumerate(lines):
        for j, b in enumerate(ln):
            if re.search(r"\bMODEL\b", b["text"], re.IGNORECASE):
                after_txt = " ".join(x["text"] for x in ln[j+1:])
                c = clean_val(after_txt)
                if c:
                    model_val = c
                    break
                if i + 1 < len(lines):
                    next_txt = " ".join(x["text"] for x in lines[i+1])
                    c2 = clean_val(next_txt)
                    if c2 and not re.search(r"\b(SIZE|COLOR|QTY|PO|ITEM|SERIAL)\b", c2, re.IGNORECASE):
                        model_val = c2
                        break
        if model_val:
            break
    if not model_val:
        for known in ["RENEGADE S1 FRAMEKIT", "RENEGADE", "FAULTLINE 29", "FAULTLINE", "LASER 1.6", "CODA S1 FEMME", "CODA S1", "DXT A1"]:
            if known.upper() in full_text.upper():
                model_val = known
                break

    # 4. Talla (Size)
    size_val = None
    for i, ln in enumerate(lines):
        for j, b in enumerate(ln):
            if re.search(r"\bSIZE\b", b["text"], re.IGNORECASE):
                after_txt = " ".join(x["text"] for x in ln[j+1:])
                c = clean_val(after_txt)
                if c:
                    size_val = c
                    break
                if i + 1 < len(lines):
                    next_txt = " ".join(x["text"] for x in lines[i+1])
                    c2 = clean_val(next_txt)
                    if c2 and not re.search(r"\b(MODEL|COLOR|QTY|PO|ITEM|SERIAL)\b", c2, re.IGNORECASE):
                        size_val = c2
                        break
        if size_val:
            break
    if not size_val:
        m_sz = re.search(r"\b(700C\s*[×xX]\s*\d+cm|700Cx\d+\"?|8\"[×*x]\s*16\"?|\d+\s*cm|\d+\")\b", full_text)
        if m_sz:
            size_val = m_sz.group(1)

    # 5. Color
    color_val = None
    for i, ln in enumerate(lines):
        for j, b in enumerate(ln):
            if re.search(r"\bCOLOR\b", b["text"], re.IGNORECASE):
                after_txt = " ".join(x["text"] for x in ln[j+1:])
                c = clean_val(after_txt)
                if c:
                    color_val = c
                    break
                if i + 1 < len(lines):
                    next_txt = " ".join(x["text"] for x in lines[i+1])
                    c2 = clean_val(next_txt)
                    if c2 and not re.search(r"\b(MODEL|SIZE|QTY|PO|ITEM|SERIAL)\b", c2, re.IGNORECASE):
                        color_val = c2
                        break
        if color_val:
            break
    if not color_val:
        for known_col in ["CHARCOAL", "BLACK", "ANO DEEP BLUE", "DEEP BLUE", "MISTY GREEN", "MONTEREY GREY"]:
            if known_col in full_text.upper():
                color_val = known_col
                break

    # 6. G.W. (Gross Weight)
    gw_val = None
    for i, ln in enumerate(lines):
        ln_str = " ".join(b["text"] for b in ln)
        if re.search(r"\bG\.?W\.?\b", ln_str, re.IGNORECASE):
            # En la misma línea
            m_gw = re.search(r"(\d+(?:\.\d+)?)\s*KGS?", ln_str, re.IGNORECASE)
            if m_gw:
                gw_val = m_gw.group(1)
                break
            # En líneas adyacentes
            for off in [1, -1, 2]:
                if 0 <= i + off < len(lines):
                    cand_str = " ".join(b["text"] for b in lines[i+off])
                    m_gw2 = re.search(r"(\d+(?:\.\d+)?)\s*KGS?", cand_str, re.IGNORECASE)
                    if m_gw2:
                        gw_val = m_gw2.group(1)
                        break
            if gw_val:
                break
    if not gw_val:
        # Fallback general a cualquier X KGS que no sea N.W.
        m_any = re.search(r"(?<!N\.W\.[:\s])(\d+(?:\.\d+)?)\s*KGS?\b", full_text, re.IGNORECASE)
        if m_any:
            gw_val = m_any.group(1)

    # 7. Serie / Frame No
    serial_val = None
    for i, ln in enumerate(lines):
        ln_str = " ".join(b["text"] for b in ln)
        m_ser = re.search(r"\b(?:SERIAL|FRAME)\s*(?:NO\.?)?\s*[:.]?\s*([A-Z0-9]{8,12})\b", ln_str, re.IGNORECASE)
        if m_ser:
            serial_val = m_ser.group(1)
            break
        if re.search(r"\b(?:SERIAL|FRAME)\s*NO\b", ln_str, re.IGNORECASE):
            for off in [1, -1]:
                if 0 <= i + off < len(lines):
                    for b in lines[i+off]:
                        if re.fullmatch(r"[A-Z0-9]{8,12}", b["text"].strip()):
                            serial_val = b["text"].strip()
                            break
            if serial_val:
                break

    return {
        "sku": sku_val,
        "upc": upc_val,
        "gtin": gtin_val,
        "gw_kg": gw_val,
        "serial": serial_val,
        "model": model_val,
        "size": size_val,
        "color": color_val,
    }


# -------------------------------------------------------------------------
# Fusión determinista Barras + OCR
# -------------------------------------------------------------------------
def fuse_barcodes_and_ocr(barcodes: List[Dict[str, Any]], ocr_fields: Dict[str, Any]) -> Dict[str, Any]:
    """Combina barras primero (prioridad absoluta para lo que tiene checksum) + OCR para texto libre."""
    fused = dict(ocr_fields)

    # Barras mandan sobre SKU, UPC, GTIN, Serial si están presentes
    for b in barcodes:
        text = b["text"]
        fmt = b.get("format", "")

        # UPC
        if fmt in ("UPC_A", "EAN_13", "Code_128") and re.fullmatch(r"\d{12}", text) and upc_ok(text):
            fused["upc"] = text
        # GTIN
        if re.fullmatch(r"\d{14}", text) and gtin14_ok(text):
            fused["gtin"] = text
            if text.startswith("00") and upc_ok(text[2:]):
                fused["upc"] = text[2:]
        # SKU via Code 39 o Code 128
        if fmt in ("Code_39", "Code_128") and re.search(r"^\d{2}-\d{4}[A-Z]{0,2}$", text):
            fused["sku"] = text.replace("-", "")
        # QR Code en etiquetas Tipo A trae Frame y Carton
        if fmt == "QRCode" and "," in text:
            parts = [p.strip() for p in text.split(",")]
            for p in parts:
                if re.fullmatch(r"[A-Z0-9]{8,12}", p):
                    fused["serial"] = p

    return fused


# -------------------------------------------------------------------------
# Ejecución del Benchmark
# -------------------------------------------------------------------------
def run_benchmark():
    gt = load_gt()
    available_photos = [p for p in gt if (LABEL_PHOTOS_DIR / p["file"]).exists()]
    print(f"=== BANCO RÁPIDO B3 (RapidOCR v5mobile y v6medium + Barras) ===")
    print(f"Fotos disponibles en disco: {len(available_photos)} ({', '.join(p['id'] for p in available_photos)})")

    # Inicializar motores RapidOCR
    mroot = HERE / ".models"
    mroot.mkdir(parents=True, exist_ok=True)

    # 1. v5mobile CPU
    eng_v5_cpu = RapidOCR(params={
        "Global.max_side_len": 2000,
        "Global.log_level": "warning",
        "Global.model_root_dir": str(mroot),
        "Det.ocr_version": OCRVersion.PPOCRV5,
        "Det.model_type": ModelType.MOBILE,
        "Det.lang_type": LangDet.CH,
        "Rec.ocr_version": OCRVersion.PPOCRV5,
        "Rec.model_type": ModelType.MOBILE,
        "Rec.lang_type": LangRec.CH,
    })

    # 2. v5mobile GPU (CUDA)
    eng_v5_gpu = RapidOCR(params={
        "Global.max_side_len": 2000,
        "Global.log_level": "warning",
        "Global.model_root_dir": str(mroot),
        "EngineConfig.onnxruntime.use_cuda": True,
        "Det.ocr_version": OCRVersion.PPOCRV5,
        "Det.model_type": ModelType.MOBILE,
        "Det.lang_type": LangDet.CH,
        "Rec.ocr_version": OCRVersion.PPOCRV5,
        "Rec.model_type": ModelType.MOBILE,
        "Rec.lang_type": LangRec.CH,
    })

    # 3. v6medium CPU
    eng_v6_cpu = RapidOCR(params={
        "Global.max_side_len": 2000,
        "Global.log_level": "warning",
        "Global.model_root_dir": str(mroot),
        "Det.ocr_version": OCRVersion.PPOCRV6,
        "Det.model_type": ModelType.MEDIUM,
        "Rec.ocr_version": OCRVersion.PPOCRV6,
        "Rec.model_type": ModelType.MEDIUM,
    })

    # 4. v6medium GPU (CUDA)
    eng_v6_gpu = RapidOCR(params={
        "Global.max_side_len": 2000,
        "Global.log_level": "warning",
        "Global.model_root_dir": str(mroot),
        "EngineConfig.onnxruntime.use_cuda": True,
        "Det.ocr_version": OCRVersion.PPOCRV6,
        "Det.model_type": ModelType.MEDIUM,
        "Rec.ocr_version": OCRVersion.PPOCRV6,
        "Rec.model_type": ModelType.MEDIUM,
    })

    # Warmup
    dummy = np.full((200, 600, 3), 255, np.uint8)
    eng_v5_cpu(dummy)
    eng_v5_gpu(dummy)
    eng_v6_cpu(dummy)
    eng_v6_gpu(dummy)

    records = []

    for p in available_photos:
        f_name = p["file"]
        img_path = LABEL_PHOTOS_DIR / f_name
        bgr = cv2.imread(str(img_path))

        # A. Barras
        bc = read_barcodes_photo(bgr)

        # B. v5mobile CPU
        t0 = time.perf_counter()
        r_v5_cpu = eng_v5_cpu(bgr)
        t_v5_cpu = (time.perf_counter() - t0) * 1000

        # C. v5mobile GPU
        t0 = time.perf_counter()
        r_v5_gpu = eng_v5_gpu(bgr)
        t_v5_gpu = (time.perf_counter() - t0) * 1000

        # D. v6medium CPU
        t0 = time.perf_counter()
        r_v6_cpu = eng_v6_cpu(bgr)
        t_v6_cpu = (time.perf_counter() - t0) * 1000

        # E. v6medium GPU
        t0 = time.perf_counter()
        r_v6_gpu = eng_v6_gpu(bgr)
        t_v6_gpu = (time.perf_counter() - t0) * 1000

        def to_boxes(r):
            boxes = []
            if r.boxes is not None:
                for box, txt, sc in zip(r.boxes, r.txts, r.scores):
                    boxes.append({"poly": box, "text": txt, "score": float(sc)})
            return boxes

        boxes_v5 = to_boxes(r_v5_cpu)
        boxes_v6 = to_boxes(r_v6_cpu)

        fields_v5 = extract_fields_from_ocr(boxes_v5)
        fields_v6 = extract_fields_from_ocr(boxes_v6)

        fused_v5 = fuse_barcodes_and_ocr(bc["union"], fields_v5)
        fused_v6 = fuse_barcodes_and_ocr(bc["union"], fields_v6)

        rec = {
            "id": p["id"],
            "file": f_name,
            "gt": p,
            "barcodes": bc,
            "time_ms": {
                "barcodes_s0": bc["ms_s0"],
                "barcodes_union": bc["ms_union"],
                "v5mobile_cpu": t_v5_cpu,
                "v5mobile_gpu": t_v5_gpu,
                "v6medium_cpu": t_v6_cpu,
                "v6medium_gpu": t_v6_gpu,
            },
            "fields_v5": fields_v5,
            "fields_v6": fields_v6,
            "fused_v5": fused_v5,
            "fused_v6": fused_v6,
        }
        records.append(rec)
        print(f"[{p['id']}] {f_name}: zxing_S0={bc['ms_s0']:.1f}ms | v5_cpu={t_v5_cpu:.0f}ms | v5_gpu={t_v5_gpu:.0f}ms | v6_cpu={t_v6_cpu:.0f}ms | v6_gpu={t_v6_gpu:.0f}ms")

    return records


# -------------------------------------------------------------------------
# Evaluación contra Verdad de Terreno
# -------------------------------------------------------------------------
def evaluate_records(records: List[Dict[str, Any]]):
    BAR_FIELDS = [("sku", "SKU"), ("upc", "UPC"), ("gtin", "GTIN"), ("gw_kg", "G.W."), ("serial", "Serie")]
    TXT_FIELDS = [("model", "Modelo"), ("size", "Talla"), ("color", "Color")]

    engines = ["barcodes_only", "v5mobile_ocr", "v6medium_ocr", "fused_v5", "fused_v6"]
    stats = {e: {k: {"ok": 0, "total": 0} for k in ["sku", "upc", "gtin", "gw_kg", "serial", "model", "size", "color"]} for e in engines}

    for r in records:
        gt = r["gt"]

        # Determinar valores esperados
        exp_sku = norm(gt.get("sku"))
        exp_printed_sku = norm(gt.get("printed_sku"))
        exp_upc = re.sub(r"\D", "", gt.get("upc") or "")
        exp_gtin = re.sub(r"\D", "", gt.get("gtin") or "")
        exp_gw = kg(gt.get("gw"))
        exp_serial = {norm(x) for x in [gt.get("serial"), gt.get("frame_A")] if x}
        exp_model = norm(gt.get("model"))
        exp_size = norm(gt.get("size"))
        exp_color = norm(gt.get("color"))

        def check(engine_key, pred_fields, is_barcodes=False):
            # SKU
            if exp_sku or exp_printed_sku:
                stats[engine_key]["sku"]["total"] += 1
                pred_s = norm(pred_fields.get("sku"))
                allowed = {s for s in [exp_sku, exp_printed_sku] if s}
                if pred_s in allowed:
                    stats[engine_key]["sku"]["ok"] += 1

            # UPC
            if exp_upc:
                stats[engine_key]["upc"]["total"] += 1
                pred_u = re.sub(r"\D", "", pred_fields.get("upc") or "")
                if pred_u == exp_upc:
                    stats[engine_key]["upc"]["ok"] += 1

            # GTIN
            if exp_gtin:
                stats[engine_key]["gtin"]["total"] += 1
                pred_g = re.sub(r"\D", "", pred_fields.get("gtin") or "")
                if pred_g == exp_gtin:
                    stats[engine_key]["gtin"]["ok"] += 1

            # GW
            if exp_gw is not None and not is_barcodes:
                stats[engine_key]["gw_kg"]["total"] += 1
                pred_gw = kg(pred_fields.get("gw_kg"))
                if pred_gw == exp_gw:
                    stats[engine_key]["gw_kg"]["ok"] += 1

            # Serial
            if exp_serial:
                stats[engine_key]["serial"]["total"] += 1
                pred_ser = norm(pred_fields.get("serial"))
                if pred_ser in exp_serial:
                    stats[engine_key]["serial"]["ok"] += 1

            # Model
            if exp_model and not is_barcodes:
                stats[engine_key]["model"]["total"] += 1
                pred_m = norm(pred_fields.get("model"))
                if pred_m and (pred_m in exp_model or exp_model in pred_m):
                    stats[engine_key]["model"]["ok"] += 1

            # Size
            if exp_size and not is_barcodes:
                stats[engine_key]["size"]["total"] += 1
                pred_sz = norm(pred_fields.get("size"))
                if pred_sz and (pred_sz in exp_size or exp_size in pred_sz):
                    stats[engine_key]["size"]["ok"] += 1

            # Color
            if exp_color and not is_barcodes:
                stats[engine_key]["color"]["total"] += 1
                pred_c = norm(pred_fields.get("color"))
                if pred_c and (pred_c in exp_color or exp_color in pred_c):
                    stats[engine_key]["color"]["ok"] += 1

        # Barras solas
        bc_fields = fuse_barcodes_and_ocr(r["barcodes"]["union"], {})
        check("barcodes_only", bc_fields, is_barcodes=True)

        # OCRs solos
        check("v5mobile_ocr", r["fields_v5"])
        check("v6medium_ocr", r["fields_v6"])

        # Fusiones
        check("fused_v5", r["fused_v5"])
        check("fused_v6", r["fused_v6"])

    return stats


def main():
    records = run_benchmark()
    stats = evaluate_records(records)

    # Calcular tiempos promedios
    avg_times = {
        "barcodes_s0": sum(r["time_ms"]["barcodes_s0"] for r in records) / len(records),
        "barcodes_union": sum(r["time_ms"]["barcodes_union"] for r in records) / len(records),
        "v5mobile_cpu": sum(r["time_ms"]["v5mobile_cpu"] for r in records) / len(records),
        "v5mobile_gpu": sum(r["time_ms"]["v5mobile_gpu"] for r in records) / len(records),
        "v6medium_cpu": sum(r["time_ms"]["v6medium_cpu"] for r in records) / len(records),
        "v6medium_gpu": sum(r["time_ms"]["v6medium_gpu"] for r in records) / len(records),
    }

    print("\n" + "=" * 80)
    print("RESUMEN DE TIEMPOS MEDIDOS EN ESTA MÁQUINA (Linux / i9-10900KF / RTX 3060)")
    print("=" * 80)
    print(f" - zxing_S0 (1 llamada directa):      {avg_times['barcodes_s0']:.1f} ms")
    print(f" - zxing_union (15 variantes):         {avg_times['barcodes_union']:.1f} ms")
    print(f" - RapidOCR v5mobile CPU:              {avg_times['v5mobile_cpu']:.1f} ms ({avg_times['v5mobile_cpu']/1000:.2f} s)")
    print(f" - RapidOCR v5mobile GPU (CUDA):       {avg_times['v5mobile_gpu']:.1f} ms ({avg_times['v5mobile_gpu']/1000:.2f} s)")
    print(f" - RapidOCR v6medium CPU:              {avg_times['v6medium_cpu']:.1f} ms ({avg_times['v6medium_cpu']/1000:.2f} s)")
    print(f" - RapidOCR v6medium GPU (CUDA):       {avg_times['v6medium_gpu']:.1f} ms ({avg_times['v6medium_gpu']/1000:.2f} s)")

    total_fused_v5_cpu_s = (avg_times['barcodes_s0'] + avg_times['v5mobile_cpu']) / 1000
    total_fused_v5_gpu_s = (avg_times['barcodes_s0'] + avg_times['v5mobile_gpu']) / 1000
    print(f"\n >>> TOTAL COMBO BARRAS + v5mobile CPU: {total_fused_v5_cpu_s:.2f} segundos <<<")
    print(f" >>> TOTAL COMBO BARRAS + v5mobile GPU: {total_fused_v5_gpu_s:.2f} segundos <<<")

    print("\n" + "=" * 80)
    print("PRECISIÓN SOBRE LAS 6 FOTOS NUEVAS (#14-#19)")
    print("=" * 80)
    print("| Motor / Combo | SKU | UPC | GTIN | G.W. | Serie | Modelo | Talla | Color |")
    print("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")

    names = {
        "barcodes_only": "zxing-cpp (Barras solas)",
        "v5mobile_ocr": "RapidOCR v5mobile (solo OCR)",
        "v6medium_ocr": "RapidOCR v6medium (solo OCR)",
        "fused_v5": "**FUSIÓN: Barras + v5mobile**",
        "fused_v6": "**FUSIÓN: Barras + v6medium**",
    }
    for k, label in names.items():
        st = stats[k]
        fmt_cell = lambda f: f"{st[f]['ok']}/{st[f]['total']}" if st[f]['total'] > 0 else "—"
        cells = [fmt_cell(f) for f in ["sku", "upc", "gtin", "gw_kg", "serial", "model", "size", "color"]]
        print(f"| {label} | " + " | ".join(cells) + " |")

    # Guardar reporte detallado para documentación
    out_dict = {
        "avg_times_ms": avg_times,
        "stats": stats,
        "records": records,
    }
    (HERE / "raw_b3_fast_path.json").write_text(json.dumps(out_dict, indent=2, default=str))
    print(f"\nDatos guardados en docs/label-recognition/local-model/raw_b3_fast_path.json")


if __name__ == "__main__":
    main()
