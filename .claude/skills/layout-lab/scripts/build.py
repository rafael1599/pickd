#!/usr/bin/env python3
"""
layout-lab/build.py — ensambla un laboratorio de layout listo para publicar como Artifact.

    python3 build.py --title "Ship Card" --key pickd:ship-card \
        --atoms atoms.html --presets presets.json --out lab.html

Entradas:
  atoms.html    <style>…</style> opcional + un <div class="item" data-id data-label>…</div> por átomo.
  presets.json  {"today": {"width", "pad", "pos": [[id, x, y, hidden?]…], "groups": [[ids]…]}, "proposal": {…}}
                "today" es obligatorio (cómo se ve el componente hoy). "proposal" es opcional.

El template vive en ../template/layout-lab.html y no se edita por lab: todo lo que varía
entra por los slots {{TITLE}} {{SUBTITLE}} {{STORAGE_KEY}} {{WIDTH_CHIPS}} {{ATOM_CSS}} {{ATOMS}} {{PRESETS}}.
Sólo stdlib.
"""
import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEMPLATE = HERE.parent / "template" / "layout-lab.html"
DEFAULT_SUBTITLE = "Cada cosa es un átomo: arrástralo donde quieras. Sin padding ni separación por defecto."
DEFAULT_WIDTHS = ["Teléfono 360=360", "Angosto 520=520", "Medio 800=800", "Ancho 1000=1000"]


def die(msg: str) -> None:
    sys.exit(f"build.py: {msg}")


def split_atoms(html: str) -> tuple[str, str]:
    """Separa el <style> (CSS de los átomos) del markup."""
    css = "\n".join(m.group(1).strip("\n") for m in re.finditer(r"<style[^>]*>(.*?)</style>", html, re.S))
    body = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.S).strip("\n")
    return css, body


def validate(atoms: str, presets: dict) -> list[str]:
    """Errores fatales → die(); avisos → lista."""
    warnings: list[str] = []
    ids = re.findall(r'<div class="item"[^>]*\bdata-id="([^"]+)"', atoms)
    if not ids:
        die('atoms.html no tiene ningún <div class="item" data-id="…">')
    dup = sorted({i for i in ids if ids.count(i) > 1})
    if dup:
        die(f"data-id duplicados: {dup}")
    sin_label = [i for i in ids if not re.search(rf'data-id="{re.escape(i)}"[^>]*data-label=|data-label="[^"]*"[^>]*data-id="{re.escape(i)}"', atoms)]
    if sin_label:
        die(f"átomos sin data-label (la etiqueta es lo que vuelve en la estructura): {sin_label}")
    if "today" not in presets:
        die('presets.json necesita el preset "today" (cómo se ve el componente hoy)')
    known = set(ids)
    for name, p in presets.items():
        for key in ("width", "pos"):
            if key not in p:
                die(f'preset "{name}" sin "{key}"')
        placed = set()
        for row in p["pos"]:
            if not (isinstance(row, list) and 3 <= len(row) <= 4 and isinstance(row[0], str)):
                die(f'preset "{name}": entrada inválida en pos: {row!r} (esperado [id, x, y] o [id, x, y, true])')
            if row[0] not in known:
                die(f'preset "{name}" posiciona "{row[0]}", que no existe en atoms.html')
            placed.add(row[0])
        faltan = sorted(known - placed)
        if faltan:
            warnings.append(f'preset "{name}" no posiciona {faltan}: quedarán apilados en (0,0)')
        for grp in p.get("groups", []):
            for i in grp:
                if i not in known:
                    die(f'preset "{name}": el grupo {grp} referencia "{i}", que no existe')
    return warnings


def width_chips(specs: list[str]) -> tuple[str, int, int]:
    chips, widths = [], []
    for spec in specs:
        if "=" not in spec:
            die(f'--widths espera "Etiqueta=px", recibí {spec!r}')
        label, px = spec.rsplit("=", 1)
        try:
            w = int(px)
        except ValueError:
            die(f"ancho no numérico en {spec!r}")
        widths.append(w)
        chips.append(f'        <button class="chip" data-w="{w}">{label.strip()}</button>')
    lo = min(320, (min(widths) // 10) * 10)
    hi = max(1100, -(-max(widths) // 10) * 10)
    return "\n".join(chips), lo, hi


def main() -> None:
    ap = argparse.ArgumentParser(description="Ensambla un layout lab a partir del template + átomos + presets.")
    ap.add_argument("--title", required=True, help='Nombre del lab, p. ej. "Ship Card Layout Lab"')
    ap.add_argument("--key", required=True, help="Clave única proyecto:componente para localStorage, p. ej. pickd:ship-card")
    ap.add_argument("--atoms", required=True, type=Path, help="atoms.html")
    ap.add_argument("--presets", required=True, type=Path, help="presets.json")
    ap.add_argument("--out", type=Path, default=Path("lab.html"))
    ap.add_argument("--subtitle", default=DEFAULT_SUBTITLE)
    ap.add_argument("--widths", nargs="+", default=DEFAULT_WIDTHS, metavar="ETIQUETA=PX",
                    help='Chips de ancho, p. ej. "Teléfono 360=360" "40 %% · 520=520"')
    ap.add_argument("--standalone", action="store_true",
                    help="Envuelve en <!doctype html> + <meta viewport> para abrirlo en local (el Artifact no lo necesita)")
    args = ap.parse_args()

    if not re.fullmatch(r"[a-z0-9][a-z0-9:_-]*", args.key):
        die("--key: usar minúsculas, dígitos, ':' '_' '-' (p. ej. pickd:ship-card)")
    if not TEMPLATE.exists():
        die(f"no encuentro el template en {TEMPLATE}")

    atoms_raw = args.atoms.read_text(encoding="utf-8")
    try:
        presets = json.loads(args.presets.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        die(f"presets.json inválido: {e}")
    if not isinstance(presets, dict):
        die("presets.json debe ser un objeto {nombre: preset}")

    atom_css, atoms = split_atoms(atoms_raw)
    for w in validate(atoms, presets):
        print(f"build.py: aviso: {w}", file=sys.stderr)

    chips, wmin, wmax = width_chips(args.widths)
    html = TEMPLATE.read_text(encoding="utf-8")
    repl = {
        "{{TITLE}}": args.title,
        "{{SUBTITLE}}": args.subtitle,
        "{{STORAGE_KEY}}": args.key,
        "{{WIDTH_CHIPS}}": chips,
        "{{WIDTH_MIN}}": str(wmin),
        "{{WIDTH_MAX}}": str(wmax),
        "{{ATOM_CSS}}": atom_css,
        "{{ATOMS}}": atoms,
        "{{PRESETS}}": json.dumps(presets, ensure_ascii=False, separators=(",", ":")),
    }
    for k, v in repl.items():
        html = html.replace(k, v)
    left = re.findall(r"\{\{[A-Z_]+\}\}", html)
    if left:
        die(f"slots sin rellenar en el template: {sorted(set(left))}")

    if args.standalone:
        html = '<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n' + html

    args.out.write_text(html, encoding="utf-8")
    n = len(re.findall(r'<div class="item"', atoms))
    print(f"build.py: {args.out} listo — {n} átomos, presets: {', '.join(presets)}, {len(html.encode()) // 1024} KB")


if __name__ == "__main__":
    main()
