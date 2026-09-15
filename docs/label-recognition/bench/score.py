"""R6 · puntuacion por campo y por motor contra gt.json.

Motores:
  zxing_S0      una llamada read_barcodes por foto, parametros por defecto
  zxing_union   union de 15 variantes (escala, rotacion fina, mosaico, CLAHE, binarizador)
  <ocr>         cada carpeta raw/<engine>/ con salidas de OCR

Campos: sku, upc (UPC-12, o GTIN-14 = 00+UPC), gtin, gw, serial (tabla §6) y frame_A (aparte).

Niveles de acierto para OCR:
  box    el valor normalizado (A-Z0-9) esta dentro del texto de UNA caja
  line   aparece al unir las cajas de una misma linea (tokens partidos)
  near   subcadena a distancia de edicion <= 2 (se guarda el snippet: confusiones de glifo)
  miss
Para GW:
  bound  asociacion espacial: el numero-con-KG mas cercano a la derecha de la etiqueta G.W es el correcto
  seq    asociacion por ORDEN DE LECTURA: el primer numero-con-KG que sigue a G.W en el texto plano
  value  el numero con KG aparece, pero ninguna de las dos asociaciones lo liga a G.W
Extraccion ciega (sin mirar la verdad): regex de SKU por caja y UPC/GTIN con digito de control.

Salida: results.json y results.md
"""
import json
import re
from pathlib import Path

from ocr_common import group_lines

HERE = Path(__file__).parent
GT = json.loads((HERE / "gt.json").read_text())["photos"]
FIELDS = ["sku", "upc", "gtin", "gw", "serial"]
HIT = {"hit", "box", "line", "bound"}


def norm(s):
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def upc_ok(d):
    if not re.fullmatch(r"\d{12}", d):
        return False
    s = sum(int(c) * (3 if i % 2 == 0 else 1) for i, c in enumerate(d[:11]))
    return (10 - s % 10) % 10 == int(d[11])


def gtin14_ok(d):
    if not re.fullmatch(r"\d{14}", d):
        return False
    s = sum(int(c) * (3 if i % 2 == 0 else 1) for i, c in enumerate(d[:13]))
    return (10 - s % 10) % 10 == int(d[13])


def approx_substring(pattern, text):
    """Sellers: minima distancia de edicion de pattern contra cualquier subcadena de text."""
    m, n = len(pattern), len(text)
    if n == 0:
        return m, ""
    prev = [0] * (n + 1)
    start_prev = list(range(n + 1))
    for i in range(1, m + 1):
        cur = [i] + [0] * n
        start_cur = [0] * (n + 1)
        for j in range(1, n + 1):
            cost = 0 if pattern[i - 1] == text[j - 1] else 1
            opts = [(prev[j - 1] + cost, start_prev[j - 1]), (prev[j] + 1, start_prev[j]), (cur[j - 1] + 1, start_cur[j - 1])]
            cur[j], start_cur[j] = min(opts, key=lambda t: t[0])
        prev, start_prev = cur, start_cur
    best_j = min(range(n + 1), key=lambda j: prev[j])
    return prev[best_j], text[start_prev[best_j]:best_j]


# ---------------------------------------------------------------- barras
def load_barcodes():
    data = json.loads((HERE / "raw" / "barcodes.json").read_text())
    out = {}
    for rec in data:
        s0 = [f for f in rec["variants"][0]["found"] if f["valid"] and f["text"]]
        union = [u for u in rec["union"].values() if u["valid"] and u["text"]]
        invalid = [u for u in rec["union"].values() if not u["valid"] and u["text"]]
        out[rec["id"]] = {"S0": s0, "union": union, "invalid": invalid,
                          "S0_ms": rec["variants"][0]["ms"], "union_ms": rec["total_ms"]}
    return out


def score_barcodes(p, codes):
    texts = [c["text"] for c in codes]
    r = {}
    if p["sku"]:
        r["sku"] = "hit" if any(norm(t) == norm(p["sku"]) for t in texts) else "miss"
    if p["upc"]:
        r["upc"] = "hit" if any(t in (p["upc"], "0" + p["upc"], "00" + p["upc"]) for t in texts) else "miss"
    if p["gtin"]:
        r["gtin"] = "hit" if p["gtin"] in texts else "miss"
    if p["gw"]:
        r["gw"] = "n/a"  # ningun codigo de estas etiquetas lleva el peso
    if p["serial"]:
        r["serial"] = "hit" if any(p["serial"] in t for t in texts) else "miss"
    if p.get("frame_A"):
        r["frame_A"] = "hit" if any(p["frame_A"] in t for t in texts) else "miss"
    return r


# ---------------------------------------------------------------- OCR
def box_geom(b):
    xs = [q[0] for q in b["poly"]]
    ys = [q[1] for q in b["poly"]]
    return sum(ys) / 4, max(ys) - min(ys), min(xs)


def find_text(target, boxes, lines, digits_only=False):
    t = norm(target)
    f = (lambda s: re.sub(r"\D", "", s)) if digits_only else norm
    for b in boxes:
        if t in f(b["text"]):
            return {"level": "box", "evidence": b["text"]}
    for ln in lines:
        if t in "".join(f(b["text"]) for b in ln):
            return {"level": "line", "evidence": " | ".join(b["text"] for b in ln)}
    best = (99, "", "")
    cands = [(f(b["text"]), b["text"]) for b in boxes] + [("".join(f(b["text"]) for b in ln), " | ".join(b["text"] for b in ln)) for ln in lines]
    for s, ev in cands:
        d, snip = approx_substring(t, s)
        if d < best[0]:
            best = (d, snip, ev)
    if best[0] <= 2 and len(best[1]) >= len(t) - 2:
        return {"level": "near", "dist": best[0], "snippet": best[1], "evidence": best[2]}
    return {"level": "miss", "closest": best[1], "dist": best[0]}


KG_RE = re.compile(r"(\d+(?:[.,]\d{1,2})?)\s*(KGS|KG5|KG|K|G)?(?![\d])")
GW_LABEL = re.compile(r"G\s*[.,:]?\s*W|GROSS")


def kg_numbers(lines):
    """Numeros con contexto de kilos, en orden de lectura: [(valor, caja, indice_plano)]."""
    out, k = [], 0
    for ln in lines:
        for i, b in enumerate(ln):
            txt = b["text"].upper()
            nxt = ln[i + 1]["text"].upper() if i + 1 < len(ln) else ""
            for m in KG_RE.finditer(txt):
                if m.group(2) or nxt.strip().startswith("KG"):
                    try:
                        out.append((float(m.group(1).replace(",", ".")), b, k))
                    except ValueError:
                        pass
            k += 1
    return out


def score_gw(p, boxes, lines):
    gt = float(p["gw"])
    cands = kg_numbers(lines)
    flat = [b for ln in lines for b in ln]
    value = any(abs(v - gt) < 1e-6 for v, _, _ in cands)
    labels = [(k, b) for k, b in enumerate(flat) if GW_LABEL.search(b["text"].upper())]
    # espacial
    picked = None
    for _, lab in labels:
        own = [v for v, b, _ in cands if b is lab]
        if own:
            picked = own[0]
        else:
            ly, lh, lx = box_geom(lab)
            best = None
            for v, b, _ in cands:
                cy, ch, cx = box_geom(b)
                if cx <= lx or abs(cy - ly) > 1.5 * max(lh, ch):
                    continue
                sc = abs(cy - ly) * 3 + (cx - lx) * 0.2
                if best is None or sc < best[0]:
                    best = (sc, v)
            picked = best[1] if best else None
        if picked is not None:
            break
    # orden de lectura: primer numero-KG a partir de la etiqueta (incluida), en las 3 cajas siguientes
    seq = None
    if labels:
        k0 = labels[0][0]
        after = [v for v, _, k in cands if k0 <= k <= k0 + 3]
        seq = after[0] if after else None
    bound = picked is not None and abs(picked - gt) < 1e-6
    seq_ok = seq is not None and abs(seq - gt) < 1e-6
    level = "bound" if bound else ("value" if value else "miss")
    return {"level": level, "seq_ok": seq_ok, "value": value, "picked": picked, "seq": seq,
            "has_label": bool(labels), "candidates": sorted({v for v, _, _ in cands})}


SKU_RE = re.compile(r"(?<![0-9])(\d{2})\s*[-.]?\s*(\d{4})\s*-?\s*([A-Z]{2,3})(?![A-Z])")


def blind(boxes, lines):
    box_texts = [b["text"].upper() for b in boxes]
    # SKU solo dentro de una caja: al unir la linea, "A21JC-A27A-81 | 0122JC" fabricaba 81-0122JC
    skus = {f"{m.group(1)}-{m.group(2)}{m.group(3)}" for t in box_texts for m in SKU_RE.finditer(t)}
    texts = box_texts + ["".join(b["text"].upper() for b in ln) for ln in lines]
    upcs, bad = set(), set()
    for t in texts:
        for d in re.findall(r"\d{11,14}", re.sub(r"[\s|]", "", t)):
            for k in range(len(d) - 11):
                w = d[k:k + 12]
                if w.startswith("845436"):
                    (upcs if upc_ok(w) else bad).add(w)
            for k in range(len(d) - 13):
                w = d[k:k + 14]
                if w.startswith("00845436"):
                    (upcs.add(w[2:]) if gtin14_ok(w) else bad.add(w))
    return sorted(skus), sorted(upcs), sorted(bad)


def blind_outcome(found, gt):
    if not gt:
        return "n/a" if not found else "extra"
    if gt in found:
        return "ok" if len(found) == 1 else "ok+extra"
    return "WRONG" if found else "none"


def score_ocr(p, rec):
    boxes = rec["boxes"]
    lines = group_lines(boxes)
    r, detail = {}, {}
    for f in ["sku", "upc", "gtin", "serial", "frame_A"]:
        if not p.get(f):
            continue
        if f == "upc":
            a = find_text(p["upc"], boxes, lines, digits_only=True)
        else:
            a = find_text(p[f], boxes, lines, digits_only=(f == "gtin"))
        r[f] = a["level"]
        detail[f] = a
    if p["gw"]:
        g = score_gw(p, boxes, lines)
        r["gw"] = g["level"]
        r["gw_seq"] = "hit" if g["seq_ok"] else "miss"
        detail["gw"] = g
    skus, upcs, bad = blind(boxes, lines)
    detail["blind_sku"] = {"found": skus, "outcome": blind_outcome(skus, p["sku"] and (p["sku"][:2] + "-" + norm(p["sku"])[2:]))}
    detail["blind_upc"] = {"found": upcs, "rejected_by_checksum": bad, "outcome": blind_outcome(upcs, p["upc"])}
    return r, detail


def frac(xs, hit=HIT):
    return f"{sum(x in hit for x in xs)}/{len(xs)}"


def main():
    engines = sorted(d.name for d in (HERE / "raw").iterdir() if d.is_dir())
    bc = load_barcodes()
    allE = ["zxing_S0", "zxing_union"] + engines
    results = {"engines": allE, "photos": {}}
    for p in GT:
        pr = results["photos"].setdefault(p["id"], {})
        for mode in ("S0", "union"):
            pr[f"zxing_{mode}"] = {"score": score_barcodes(p, bc[p["id"]][mode]), "ms": bc[p["id"]][f"{mode}_ms"],
                                   "codes": [f'{c["format"]}:{c["text"]}' for c in bc[p["id"]][mode]]}
        pr["zxing_invalid"] = [f'{c["format"]}:{c["text"]}' for c in bc[p["id"]]["invalid"] if re.search(r"\d{6,}", c["text"])]
        for e in engines:
            f = HERE / "raw" / e / f'{p["id"]}.json'
            if f.exists():
                rec = json.loads(f.read_text())
                s, d = score_ocr(p, rec)
                pr[e] = {"score": s, "ms": rec["ms"], "detail": d}
    (HERE / "results.json").write_text(json.dumps(results, indent=1, ensure_ascii=False))

    P = results["photos"]
    md = ["# R6 · resultados automaticos (score.py)", ""]
    md += ["## 1. Aciertos exactos por campo (denominador = fotos con el campo impreso)", "",
           "Barras: codigo con lectura valida y valor exacto. OCR: `box`+`line` = exacto; entre parentesis los `near` (<=2 ediciones, inservibles sin correccion). "
           "GW: asociado por posicion a la etiqueta G.W; `seq` = asociado por orden de lectura; `value` = el numero esta pero sin ligar.", "",
           "| motor | SKU | UPC (o GTIN) | GTIN-14 | G.W. (posicion) | G.W. (orden lectura) | serie/frame §6 | frame tipo A | ms/foto |",
           "|---|---|---|---|---|---|---|---|---|"]
    for e in allE:
        cells = []
        for f in ["sku", "upc", "gtin", "gw", "gw_seq", "serial", "frame_A"]:
            xs = [P[i][e]["score"][f] for i in P if e in P[i] and f in P[i][e]["score"]]
            if not xs:
                cells.append("n/a")
                continue
            if all(x == "n/a" for x in xs):
                cells.append(f"— (no codifica)")
                continue
            near = sum(x == "near" for x in xs)
            val = sum(x == "value" for x in xs)
            c = frac(xs)
            if near:
                c += f" (+{near} near)"
            if val:
                c += f" (+{val} sin ligar)"
            cells.append(c)
        ms = [P[i][e]["ms"] for i in P if e in P[i]]
        md.append(f"| {e} | " + " | ".join(cells) + f" | {sum(ms)/len(ms):.0f} |")

    # barras sobre simbolos presentes
    md += ["", "## 2. Barras sobre simbolos presentes en la foto", "",
           "| motor | SKU | UPC/GTIN | serie/frame §6 |", "|---|---|---|---|"]
    for e in ("zxing_S0", "zxing_union"):
        cells = []
        for f in ("sku", "upc", "serial"):
            xs = [P[p["id"]][e]["score"][f] for p in GT if p.get(f) and p["barcode_present"].get(f)]
            cells.append(frac(xs))
        md.append(f"| {e} | " + " | ".join(cells) + " |")
    wrong_valid = 0
    for p in GT:
        for c in P[p["id"]]["zxing_union"]["codes"]:
            t = c.split(":", 1)[1]
            if re.fullmatch(r"0{0,2}845436\d{6}", t) and p["upc"] and not t.endswith(p["upc"]):
                wrong_valid += 1
    md.append(f"\nLecturas VALIDAS con un UPC/GTIN distinto de la verdad: {wrong_valid}.")

    # caja 3 junta
    md += ["", "## 3. Caja 3 (03-4149BR): dos caras danadas juntas", "", "| motor | SKU exacto en alguna cara | UPC exacto en alguna cara | G.W. |", "|---|---|---|---|"]
    for e in allE:
        s = [P[i][e]["score"] for i in ("3a", "3b") if e in P[i]]
        md.append(f"| {e} | " + " | ".join(("si" if any(x.get(f) in HIT for x in s) else "no") for f in ("sku", "upc", "gw")) + " |")

    # fusion
    md += ["", "## 4. Fusion barras (union) + un OCR: el campo cuenta si lo da cualquiera de los dos de forma exacta", "",
           "| combinacion | SKU | UPC/GTIN | G.W. (posicion) | serie/frame §6 |", "|---|---|---|---|---|"]
    for e in engines:
        cells = []
        for f in ("sku", "upc", "gw", "serial"):
            ids = [p["id"] for p in GT if p.get(f)]
            ok = sum((P[i]["zxing_union"]["score"].get(f) in HIT) or (e in P[i] and P[i][e]["score"].get(f) in HIT) for i in ids)
            cells.append(f"{ok}/{len(ids)}")
        md.append(f"| zxing_union + {e} | " + " | ".join(cells) + " |")

    # detalle
    md += ["", "## 5. Detalle por foto", "", "| foto | campo | verdad | " + " | ".join(allE) + " |", "|" + "---|" * (3 + len(allE))]
    for p in GT:
        pr = P[p["id"]]
        for f in FIELDS + ["frame_A"]:
            if not p.get(f):
                continue
            cells = []
            for e in allE:
                if e not in pr or f not in pr[e]["score"]:
                    cells.append("—")
                    continue
                lvl = pr[e]["score"][f]
                if e.startswith("zxing"):
                    cells.append(lvl)
                    continue
                d = pr[e]["detail"][f]
                if f == "gw":
                    cells.append(f'{lvl}/seq {"ok" if d["seq_ok"] else d["seq"]} (pos {d["picked"]}; {d["candidates"]})')
                elif lvl == "near":
                    cells.append(f'near `{d["snippet"]}`')
                elif lvl == "miss":
                    cells.append(f'miss `{d.get("closest", "")}`')
                else:
                    cells.append(lvl)
            md.append(f'| {p["id"]} | {f} | {p[f]} | ' + " | ".join(cells) + " |")

    md += ["", "## 6. Extraccion ciega (regex de SKU por caja; UPC/GTIN con prefijo 845436 y digito de control)", "",
           "`WRONG` = el OCR entrega un valor con forma valida que no es el de la caja. Entre corchetes rojos: candidatos 845436… que el digito de control descarto.", "",
           "| foto | " + " | ".join(engines) + " |", "|" + "---|" * (1 + len(engines))]
    for p in GT:
        pr = P[p["id"]]
        cells = []
        for e in engines:
            d = pr[e]["detail"]
            rej = f' ✗{d["blind_upc"]["rejected_by_checksum"]}' if d["blind_upc"]["rejected_by_checksum"] else ""
            cells.append(f'SKU {d["blind_sku"]["outcome"]} {d["blind_sku"]["found"]} · UPC {d["blind_upc"]["outcome"]}{rej}')
        md.append(f'| {p["id"]} | ' + " | ".join(cells) + " |")

    md += ["", "## 7. Lecturas de barras descartadas por error de control (return_errors=True)", ""]
    for p in GT:
        inv = P[p["id"]]["zxing_invalid"]
        if inv:
            md.append(f'- {p["id"]}: ' + ", ".join(f"`{x}`" for x in inv))
    (HERE / "results.md").write_text("\n".join(md) + "\n")
    print("\n".join(md[:40]))


if __name__ == "__main__":
    main()
