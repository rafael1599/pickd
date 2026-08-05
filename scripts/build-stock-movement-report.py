#!/usr/bin/env python3
"""Stock rotation report — HTML + PDF, print-ready A4.

Usage:
    python3 scripts/build-stock-movement-report.py <source.csv> [output_basename]

The source CSV is expected to hold one row per SKU with these columns, in this
order (header names are matched case-insensitively when present):

    SKU, Location, Stock, Movement

`Movement` is the order/shipment count that separates movers from non-movers.
If the file only has three columns, every row is treated as an already-filtered
movers list and the two non-mover groups are reported as missing.

Grouping matches the spreadsheet formulas this replaces:
    Movement  > 5                 -> Movers
    Movement <= 5 and Stock >= 15 -> Non-movers, high stock
    Movement <= 5 and Stock <  15 -> Non-movers, low stock
"""

import csv
import html
import subprocess
import sys
from datetime import date
from pathlib import Path

MOVEMENT_THRESHOLD = 5
HIGH_STOCK_THRESHOLD = 15
TOP_N = 15

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def read_rows(path: Path):
    with path.open(newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.reader(fh))
    if not rows:
        sys.exit(f"{path} is empty")

    header = [c.strip().lower() for c in rows[0]]
    has_header = "sku" in header
    body = rows[1:] if has_header else rows

    out = []
    for r in body:
        if not r or not r[0].strip():
            continue
        try:
            stock = int(float(r[2])) if len(r) > 2 and r[2].strip() else 0
        except ValueError:
            stock = 0
        movement = None
        if len(r) > 3 and r[3].strip():
            try:
                movement = int(float(r[3]))
            except ValueError:
                movement = None
        out.append(
            {
                "sku": r[0].strip(),
                "location": r[1].strip() if len(r) > 1 else "",
                "stock": stock,
                "movement": movement,
            }
        )
    return out


def group(rows):
    has_movement = any(r["movement"] is not None for r in rows)
    if not has_movement:
        return {"movers": rows, "high": None, "low": None}

    movers, high, low = [], [], []
    for r in rows:
        m = r["movement"] or 0
        if m > MOVEMENT_THRESHOLD:
            movers.append(r)
        elif r["stock"] >= HIGH_STOCK_THRESHOLD:
            high.append(r)
        else:
            low.append(r)
    return {"movers": movers, "high": high, "low": low}


def units(rows):
    return sum(r["stock"] for r in rows)


def table(rows, accent, show_movement):
    if not rows:
        return '<p class="muted">Sin registros en este grupo.</p>'

    ordered = sorted(rows, key=lambda r: -r["stock"])
    shown = ordered[:TOP_N]
    rest = len(ordered) - len(shown)

    head = "<th>SKU</th><th>Ubicación</th><th class='num'>Stock</th>"
    if show_movement:
        head += "<th class='num'>Movimiento</th>"

    body = ""
    for r in shown:
        body += (
            f"<tr><td class='sku'><span class='dot' style='background:{accent}'></span>"
            f"{html.escape(r['sku'])}</td>"
            f"<td class='loc'>{html.escape(r['location'])}</td>"
            f"<td class='num'>{r['stock']}</td>"
        )
        if show_movement:
            body += f"<td class='num'>{r['movement'] if r['movement'] is not None else '—'}</td>"
        body += "</tr>"

    more = (
        f"<p class='muted'>+ {rest} SKU adicionales en este grupo "
        f"({units(ordered[TOP_N:])} unidades).</p>"
        if rest > 0
        else ""
    )
    return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>{more}"


def section(title, subtitle, rows, accent, show_movement=True):
    if rows is None:
        return f"""
        <section class="group">
          <div class="group-head">
            <span class="chip" style="--c:{accent}">{html.escape(title)}</span>
            <span class="muted">{html.escape(subtitle)}</span>
          </div>
          <p class="pending">Pendiente: falta la columna de movimiento en el archivo de origen.</p>
        </section>"""

    return f"""
    <section class="group">
      <div class="group-head">
        <span class="chip" style="--c:{accent}">{html.escape(title)}</span>
        <span class="muted">{html.escape(subtitle)}</span>
      </div>
      <div class="stats">
        <div><strong>{len(rows)}</strong><span>SKU</span></div>
        <div><strong>{units(rows):,}</strong><span>unidades</span></div>
      </div>
      {table(rows, accent, show_movement)}
    </section>"""


def build_html(groups, source_name):
    movers, high, low = groups["movers"], groups["high"], groups["low"]
    total_sku = len(movers) + (len(high) if high else 0) + (len(low) if low else 0)
    total_units = units(movers) + (units(high) if high else 0) + (units(low) if low else 0)
    show_movement = any(r["movement"] is not None for r in movers)

    def kpi(label, rows, accent):
        if rows is None:
            return f"""<div class="kpi"><span class="kpi-label" style="--c:{accent}">{label}</span>
                       <span class="kpi-value muted">—</span><span class="kpi-sub">pendiente</span></div>"""
        return f"""<div class="kpi"><span class="kpi-label" style="--c:{accent}">{label}</span>
                   <span class="kpi-value">{len(rows)}</span>
                   <span class="kpi-sub">{units(rows):,} unidades</span></div>"""

    return f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Inventario por rotación</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         color:#1e293b; background:#fff; font-size:11px; line-height:1.45; }}
  .page {{ max-width:190mm; margin:0 auto; padding:14mm 12mm; }}
  header {{ border-bottom:2px solid #0f172a; padding-bottom:10px; margin-bottom:16px;
            display:flex; justify-content:space-between; align-items:flex-end; }}
  h1 {{ font-size:19px; margin:0; letter-spacing:-.3px; font-weight:800; }}
  .sub {{ color:#64748b; font-size:10.5px; margin-top:3px; }}
  .totals {{ text-align:right; color:#64748b; font-size:10px; }}
  .totals strong {{ display:block; font-size:16px; color:#0f172a; }}

  .kpis {{ display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:18px; }}
  .kpi {{ border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; display:flex;
          flex-direction:column; gap:2px; background:#f8fafc; }}
  .kpi-label {{ font-size:8.5px; font-weight:800; text-transform:uppercase; letter-spacing:.7px;
                color:var(--c); }}
  .kpi-value {{ font-size:22px; font-weight:800; line-height:1.1; }}
  .kpi-sub {{ font-size:9.5px; color:#64748b; }}

  .group {{ margin-bottom:16px; break-inside:avoid; }}
  .group-head {{ display:flex; align-items:baseline; gap:8px; margin-bottom:6px; }}
  .chip {{ font-size:9px; font-weight:800; text-transform:uppercase; letter-spacing:.7px;
           color:var(--c); border:1px solid var(--c); border-radius:999px; padding:2px 8px; }}
  .stats {{ display:flex; gap:16px; margin-bottom:6px; }}
  .stats div {{ display:flex; align-items:baseline; gap:4px; }}
  .stats strong {{ font-size:13px; font-weight:800; }}
  .stats span {{ font-size:9.5px; color:#64748b; }}

  table {{ width:100%; border-collapse:collapse; }}
  thead th {{ text-align:left; font-size:8.5px; text-transform:uppercase; letter-spacing:.6px;
              color:#64748b; border-bottom:1px solid #cbd5e1; padding:4px 6px; font-weight:700; }}
  td {{ padding:3.5px 6px; border-bottom:1px solid #f1f5f9; }}
  .num {{ text-align:right; font-variant-numeric:tabular-nums; }}
  .sku {{ font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-weight:700; font-size:10.5px; }}
  .loc {{ color:#475569; font-size:10px; }}
  .dot {{ display:inline-block; width:5px; height:5px; border-radius:50%; margin-right:6px;
          vertical-align:middle; }}
  .muted {{ color:#94a3b8; font-size:9.5px; margin:5px 0 0; }}
  .pending {{ color:#b45309; background:#fffbeb; border:1px solid #fde68a; border-radius:6px;
              padding:7px 10px; font-size:10px; margin:4px 0 0; }}
  footer {{ margin-top:14px; padding-top:8px; border-top:1px solid #e2e8f0; color:#94a3b8;
            font-size:9px; display:flex; justify-content:space-between; }}
  @page {{ size:A4; margin:0; }}
</style></head>
<body><div class="page">
  <header>
    <div>
      <h1>Inventario por rotación</h1>
      <div class="sub">Clasificación de SKU según movimiento de salida y nivel de stock</div>
    </div>
    <div class="totals"><strong>{total_sku}</strong>SKU · {total_units:,} unidades</div>
  </header>

  <div class="kpis">
    {kpi("Movers", movers, "#059669")}
    {kpi("No-movers · stock alto", high, "#b45309")}
    {kpi("No-movers · stock bajo", low, "#be123c")}
  </div>

  {section("Movers", f"más de {MOVEMENT_THRESHOLD} salidas — rotación activa", movers, "#059669", show_movement)}
  {section("No-movers · stock alto", f"hasta {MOVEMENT_THRESHOLD} salidas y {HIGH_STOCK_THRESHOLD} o más unidades — capital inmovilizado", high, "#b45309")}
  {section("No-movers · stock bajo", f"hasta {MOVEMENT_THRESHOLD} salidas y menos de {HIGH_STOCK_THRESHOLD} unidades — saldos dispersos", low, "#be123c")}

  <footer>
    <span>Criterio: movimiento &gt; {MOVEMENT_THRESHOLD} = mover · stock &ge; {HIGH_STOCK_THRESHOLD} = alto</span>
    <span>{date.today().strftime("%d/%m/%Y")} · {html.escape(source_name)}</span>
  </footer>
</div></body></html>"""


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    source = Path(sys.argv[1]).expanduser()
    base = sys.argv[2] if len(sys.argv) > 2 else "inventario-por-rotacion"

    rows = read_rows(source)
    groups = group(rows)
    out_html = Path(f"{base}.html").resolve()
    out_pdf = Path(f"{base}.pdf").resolve()

    out_html.write_text(build_html(groups, source.name), encoding="utf-8")

    subprocess.run(
        [CHROME, "--headless", "--disable-gpu", "--no-pdf-header-footer",
         f"--print-to-pdf={out_pdf}", out_html.as_uri()],
        check=True, capture_output=True,
    )

    print(f"HTML: {out_html}")
    print(f"PDF:  {out_pdf}")
    for name, rows_ in (("movers", groups["movers"]), ("stock alto", groups["high"]),
                        ("stock bajo", groups["low"])):
        print(f"  {name}: {'pendiente' if rows_ is None else f'{len(rows_)} SKU / {units(rows_)}u'}")


if __name__ == "__main__":
    main()
