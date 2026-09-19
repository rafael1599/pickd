#!/usr/bin/env python3
"""Runner local para Track B (sub-fase B2) usando Ollama en Linux / RTX 3060.

Lee las fotos disponibles en LABEL_PHOTOS_DIR, consulta a Ollama (ej. qwen3.5:9b)
con el esquema estructurado docs/label-recognition/bench/vlm_schema.json,
mide el tiempo de inferencia y evalúa contra docs/label-recognition/bench/gt.json.
"""

import base64
import json
import os
import pathlib
import re
import sys
import time
import urllib.request

HERE = pathlib.Path(__file__).parent.resolve()
REPO_ROOT = HERE.parent.parent.parent
BENCH_DIR = REPO_ROOT / "docs" / "label-recognition" / "bench"
DOC_LEARNED = REPO_ROOT / "docs" / "label-recognition" / "01-lo-aprendido.md"
RAW_DIR = HERE / "raw"
RAW_DIR.mkdir(exist_ok=True)

DEFAULT_PHOTOS_DIR = "/home/confi/.claude/uploads/26a63557-6830-40d9-9d43-85353dc4aa09"
LABEL_PHOTOS_DIR = pathlib.Path(os.environ.get("LABEL_PHOTOS_DIR", DEFAULT_PHOTOS_DIR))
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")

PROMPT = (
    "Extrae los campos impresos en la etiqueta de la foto directamente en formato JSON según el esquema:\n"
    "- sku = STOCK NO / ITEM NO (ej. 09-4807CL, 07-3692-BL, PP1202JC).\n"
    "- upc = UPC NO de 12 digitos.\n"
    "- gtin = GTIN-14 si aparece (14 digitos).\n"
    "- gw_kg = valor numerico de G.W. en kg (peso bruto, ej. 7, 12.00, 14.80, NO el N.W.).\n"
    "- serial = numero de serie o frame no del cuadro.\n"
    "- model = nombre del modelo tal como este impreso.\n"
    "- size = talla tal como este impresa.\n"
    "- color = color tal como este impreso.\n"
    "Usa null en todo lo que NO este impreso. No hagas razonamiento extenso, genera el JSON directamente."
)


def get_ground_truth():
    gt_data = json.loads((BENCH_DIR / "gt.json").read_text())
    photos = gt_data["photos"]
    return {p["file"]: p for p in photos}, {p["file"]: p["id"] for p in photos}


def get_catalog_text():
    """Lee model, size, color de la tabla §6 de 01-lo-aprendido.md para fotos 1..13."""
    texto = {}
    if DOC_LEARNED.exists():
        for line in DOC_LEARNED.read_text().splitlines():
            m = re.match(r"\|\s*(\d+)\s*\|([^|]+)\|([^|]+)\|([^|]+)\|", line)
            if m:
                parts = [p.strip() for p in m.group(4).split("·")]
                if len(parts) >= 3:
                    texto[m.group(1).strip()] = dict(zip(("model", "size", "color"), parts[:3]))
    return texto


def run_ollama_vlm(model_name: str, image_path: pathlib.Path, schema: dict):
    with open(image_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode("utf-8")

    payload = {
        "model": model_name,
        "messages": [
            {
                "role": "user",
                "content": PROMPT,
                "images": [img_b64],
            }
        ],
        "format": schema,
        "stream": False,
        "options": {
            "temperature": 0.0,
            "num_ctx": 16384,
        },
    }

    req = urllib.request.Request(
        f"{OLLAMA_HOST}/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )

    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=300) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    duration = time.perf_counter() - t0

    content_str = data.get("message", {}).get("content", "{}")
    try:
        structured = json.loads(content_str)
    except Exception as e:
        structured = {"_raw": content_str, "_error": str(e)}

    return {
        "model": model_name,
        "image": image_path.name,
        "duration_seconds": round(duration, 3),
        "structured_output": structured,
        "ollama_eval_count": data.get("eval_count"),
        "ollama_eval_duration_ms": (data.get("eval_duration", 0) / 1e6),
    }


def evaluate(model_name: str, results_list: list, gt: dict, ids: dict, texto: dict):
    alnum = lambda v: re.sub(r"[^A-Z0-9]", "", str(v).upper()) if v is not None else None
    digits = lambda v: re.sub(r"\D", "", str(v)) if v is not None else None

    def kg(v):
        m = re.search(r"\d+(?:[.,]\d+)?", str(v)) if v is not None else None
        return round(float(m.group().replace(",", ".")), 2) if m else None

    BAR = [("sku", "SKU"), ("upc", "UPC"), ("gtin", "GTIN"), ("gw_kg", "G.W."), ("serial", "Serie")]
    TXT = [("model", "Modelo"), ("size", "Talla"), ("color", "Color")]

    bar_scores = {k: {"ok": 0, "mal": 0, "vacio": 0} for k, _ in BAR}
    txt_scores = {k: {"ok": 0, "mal": 0, "vacio": 0} for k, _ in TXT}
    diffs = []
    durations = []

    for res in results_list:
        photo_file = res["image"]
        if photo_file not in gt:
            continue
        photo = gt[photo_file]
        pid = ids[photo_file]
        out = res.get("structured_output") or {}
        durations.append(res.get("duration_seconds", 0))

        # 1. Campos de barra
        for key, _ in BAR:
            truth = photo.get({"gw_kg": "gw"}.get(key, key))
            if key == "serial":
                truth = truth or photo.get("frame_A")
            got = out.get(key)
            if not truth:
                # Si en gt.json es null pero el VLM devolvió un valor no nulo
                if got not in (None, "", "null"):
                    # Solo es error si inventó algo donde no había nada
                    pass
                continue

            if got in (None, "", "null"):
                bar_scores[key]["vacio"] += 1
                diffs.append((model_name, pid, key, got, truth, "vacio"))
                continue

            ok = False
            if key == "gw_kg":
                ok = (kg(got) == kg(truth))
            elif key in ("upc", "gtin"):
                ok = (digits(got) == digits(truth))
            elif key == "serial":
                allowed = {alnum(x) for x in (photo.get("serial"), photo.get("frame_A")) if x}
                ok = (alnum(got) in allowed)
            else:  # sku
                # Soporte para printed_sku o sku normalizado
                allowed_sku = {alnum(x) for x in (photo.get("sku"), photo.get("printed_sku")) if x}
                ok = (alnum(got) in allowed_sku)

            if ok:
                bar_scores[key]["ok"] += 1
            else:
                bar_scores[key]["mal"] += 1
                diffs.append((model_name, pid, key, got, truth, "mal"))

        # 2. Campos de texto (model, size, color)
        # Buscar en gt.json primero (fotos 14..19), o en texto (§6 de 01-lo-aprendido.md)
        want = {}
        for k, _ in TXT:
            if photo.get(k) is not None:
                want[k] = photo[k]
        if not want:
            want = texto.get(pid.rstrip("ab"), {})

        for key, _ in TXT:
            exp_val = want.get(key)
            if not exp_val:
                continue
            got_val = out.get(key)
            got_clean = alnum(got_val)
            exp_clean = alnum(exp_val)

            if not got_clean:
                txt_scores[key]["vacio"] += 1
                diffs.append((model_name, pid, key, got_val, exp_val, "vacio"))
            elif exp_clean and (exp_clean in got_clean or got_clean in exp_clean):
                txt_scores[key]["ok"] += 1
            else:
                txt_scores[key]["mal"] += 1
                diffs.append((model_name, pid, key, got_val, exp_val, "mal"))

    return {
        "bar_scores": bar_scores,
        "txt_scores": txt_scores,
        "durations": durations,
        "diffs": diffs,
    }


def main():
    model_name = sys.argv[1] if len(sys.argv) > 1 else "qwen3.5:9b"
    print(f"=== Corriendo benchmark local B2 con modelo {model_name} ===")
    print(f"Directorio de fotos: {LABEL_PHOTOS_DIR}")

    gt, ids = get_ground_truth()
    texto = get_catalog_text()
    schema = json.loads((BENCH_DIR / "vlm_schema.json").read_text())

    available_photos = [p for p in gt.values() if (LABEL_PHOTOS_DIR / p["file"]).exists()]
    print(f"Fotos encontradas en disco: {len(available_photos)} / {len(gt)}")
    for p in available_photos:
        print(f" - #{p['id']}: {p['file']}")

    if not available_photos:
        print("ERROR: No se encontraron fotos en LABEL_PHOTOS_DIR", file=sys.stderr)
        sys.exit(1)

    results = []
    clean_model_tag = model_name.replace(":", "_")

    for p in available_photos:
        f_name = p["file"]
        img_path = LABEL_PHOTOS_DIR / f_name
        dest = RAW_DIR / f"{clean_model_tag}__{f_name}.json"

        if dest.exists() and dest.stat().st_size > 5:
            try:
                cached = json.loads(dest.read_text())
                if "structured_output" in cached:
                    print(f"[{p['id']}] Usando cache existente {dest.name}")
                    results.append(cached)
                    continue
            except Exception:
                pass

        print(f"[{p['id']}] Procesando {f_name} con {model_name}...", end="", flush=True)
        res = run_ollama_vlm(model_name, img_path, schema)
        dest.write_text(json.dumps(res, indent=2, ensure_ascii=False))
        print(f" {res['duration_seconds']}s")
        results.append(res)

    print("\n=== EVALUACIÓN ===")
    eval_res = evaluate(model_name, results, gt, ids, texto)

    print("\n## Campos que el código de barras ya da exactos:")
    print("| Modelo | SKU | UPC | GTIN | G.W. | Serie | Segundos por foto |")
    print("| --- | --- | --- | --- | --- | --- | --- |")
    bar = eval_res["bar_scores"]
    durs = eval_res["durations"]
    avg_s = sum(durs) / len(durs) if durs else 0
    row_bar = [
        model_name,
        f"{bar['sku']['ok']}/{bar['sku']['ok']+bar['sku']['mal']+bar['sku']['vacio']}" + (f" · {bar['sku']['mal']} mal" if bar['sku']['mal'] else ""),
        f"{bar['upc']['ok']}/{bar['upc']['ok']+bar['upc']['mal']+bar['upc']['vacio']}" + (f" · {bar['upc']['mal']} mal" if bar['upc']['mal'] else ""),
        f"{bar['gtin']['ok']}/{bar['gtin']['ok']+bar['gtin']['mal']+bar['gtin']['vacio']}" + (f" · {bar['gtin']['mal']} mal" if bar['gtin']['mal'] else ""),
        f"{bar['gw_kg']['ok']}/{bar['gw_kg']['ok']+bar['gw_kg']['mal']+bar['gw_kg']['vacio']}" + (f" · {bar['gw_kg']['mal']} mal" if bar['gw_kg']['mal'] else ""),
        f"{bar['serial']['ok']}/{bar['serial']['ok']+bar['serial']['mal']+bar['serial']['vacio']}" + (f" · {bar['serial']['mal']} mal" if bar['serial']['mal'] else ""),
        f"{avg_s:.1f}s",
    ]
    print("| " + " | ".join(row_bar) + " |")

    print("\n## Campos que ningún código de barras lleva:")
    print("| Modelo | Modelo | Talla | Color |")
    print("| --- | --- | --- | --- |")
    txt = eval_res["txt_scores"]
    row_txt = [
        model_name,
        f"{txt['model']['ok']}/{txt['model']['ok']+txt['model']['mal']+txt['model']['vacio']}" + (f" · {txt['model']['mal']} mal" if txt['model']['mal'] else ""),
        f"{txt['size']['ok']}/{txt['size']['ok']+txt['size']['mal']+txt['size']['vacio']}" + (f" · {txt['size']['mal']} mal" if txt['size']['mal'] else ""),
        f"{txt['color']['ok']}/{txt['color']['ok']+txt['color']['mal']+txt['color']['vacio']}" + (f" · {txt['color']['mal']} mal" if txt['color']['mal'] else ""),
    ]
    print("| " + " | ".join(row_txt) + " |")

    print("\n## Diferencias detalladas:")
    print("| ID | Campo | Predicción | Verdad de terreno | Tipo |")
    print("| --- | --- | --- | --- | --- |")
    for m, pid, key, got, exp, kind in eval_res["diffs"]:
        print(f"| #{pid} | {key} | `{got}` | `{exp}` | {kind} |")


if __name__ == "__main__":
    main()
