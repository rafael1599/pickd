#!/usr/bin/env python3
"""Stock rotation report summarised by MODEL — HTML + PDF, print-ready A4.

Usage:
    python3 scripts/build-model-rotation-report.py <combined.csv> [output_basename]

Input CSV holds the three groups stacked, each introduced by a title line with
empty trailing cells, then a `SKU,Location,Stock` header:

    Movers,,
    SKU,Location,Stock
    03-3981GY,ROW 43,160
    ...
    NON-MOVERS & high stock,,
    ...

The SKU -> model map lives in scripts/sku-model-map.json. Regenerate it against
production with:

    WITH named AS (
      SELECT sku, max(item_name) AS raw FROM inventory
      WHERE is_active AND quantity > 0 GROUP BY sku
    ), cleaned AS (
      SELECT sku, btrim(split_part(raw, '|', 1)) AS name FROM named
    )
    SELECT sku,
      CASE WHEN name IS NULL OR name = '' OR name = sku THEN '(sin nombre)'
           ELSE btrim(COALESCE(
             (regexp_match(name, '^(.*?)\\s+\\S+\\s+(?:19|20)\\d{2}(\\s|$)'))[1],
             (regexp_match(name, '^(.*?)\\s+(?:\\d+X\\d+|\\d{1,3})(\\s|$)'))[1],
             name))
      END AS model
    FROM cleaned ORDER BY sku;

item_name encodes "MODEL SIZE YEAR COLOR", so the model is everything before
the size token. Sizes are detected by the year that follows them, falling back
to the first bare number when the name carries no year.
"""

import html
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

TOP_MODELS = 12
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

GROUP_STYLE = {
    "movers": ("Movers", "active rotation", "#059669"),
    "high": ("Non-movers · high stock", "tied-up capital", "#b45309"),
    "low": ("Non-movers · low stock", "scattered leftovers", "#be123c"),
}


def read_groups(path: Path):
    groups, current = {}, None
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        cells = [c.strip() for c in line.split(",")]
        if cells[0] and len(cells) > 2 and not cells[1] and not cells[2]:
            current = cells[0]
            groups[current] = []
            continue
        if not cells[0] or cells[0].upper() == "SKU":
            continue
        try:
            stock = int(float(cells[2]))
        except (ValueError, IndexError):
            stock = 0
        loc = cells[1] if len(cells) > 1 else ""
        groups[current].append({"sku": cells[0], "stock": stock, "loc": loc})
    return groups


def key_for(title: str) -> str:
    t = title.lower()
    if "low" in t or "bajo" in t:
        return "low"
    if "high" in t or "alto" in t:
        return "high"
    return "movers"


import re

SKU_SHAPED = re.compile(r"^\d{2}-?\w+$")
# Sizes also show up as "54CM", which the SQL-side split doesn't catch.
CM_SIZE = re.compile(r"\s+\d+\s*CM\b.*$", re.IGNORECASE)

# Names that cannot be derived from item_name because the field holds bad data.
# Each entry records how the real model was established.
OVERRIDES = {
    # item_name is the string "03-4070BK" — a SKU, not a name. The alias chain
    # (03-4070BL > 03-4070BK) plus the numeric neighbours settle it: odd codes
    # are DEEP BLUE, even are GLOSS BLACK, and 4069/4071 are both EXPLORER A2.
    "03-4070BL": "EXPLORER A2",
}

# The spreadsheet export strips leading zeros from numeric SKUs, so "010539"
# arrives as "10539" and misses the map.
def lookup(sku: str, mapping: dict) -> str:
    for candidate in (sku, sku.zfill(6), f"0{sku}"):
        if candidate in mapping:
            return mapping[candidate]
    return ""


def normalise(model: str) -> str:
    """item_name is typed by hand, so the same model arrives as 'Divide' and
    'DIVIDE'. Some rows also carry a SKU code where the name should be — those
    are missing names, not models."""
    model = CM_SIZE.sub("", model)
    model = " ".join(model.split()).upper()
    if not model or SKU_SHAPED.match(model):
        return "(unnamed)"
    return model


# Scratch-and-dent stock is damaged goods sold off separately, so it does not
# belong in a rotation read. Note S/O ("DIVIDE S/O", "TAXI 26 S/O", …) is a
# different thing entirely and stays in.
SCRATCH_DENT = re.compile(r"(^|\s)S/D(\s|$)")


def is_scratch_dent(model: str) -> bool:
    return bool(SCRATCH_DENT.search(model))


def by_model(rows, mapping):
    agg = {}
    for r in rows:
        model = OVERRIDES.get(r["sku"]) or normalise(lookup(r["sku"], mapping))
        if is_scratch_dent(model):
            continue
        entry = agg.setdefault(
            model, {"model": model, "skus": 0, "stock": 0, "locs": {}}
        )
        entry["skus"] += 1
        entry["stock"] += r["stock"]
        if r.get("loc"):
            entry["locs"][r["loc"]] = entry["locs"].get(r["loc"], 0) + r["stock"]
    return sorted(agg.values(), key=lambda e: (-e["stock"], e["model"]))


def locations_of(entry, limit=3):
    """Where the model actually sits, busiest aisle first."""
    ranked = sorted(entry["locs"].items(), key=lambda kv: -kv[1])
    names = [loc for loc, _ in ranked[:limit]]
    extra = len(ranked) - len(names)
    return ", ".join(names) + (f" +{extra}" if extra > 0 else "")


def table(models, accent):
    shown = models[:TOP_MODELS]
    rest = models[TOP_MODELS:]

    body = ""
    for m in shown:
        variants = f"{m['skus']} variant" + ("s" if m["skus"] != 1 else "")
        body += (
            f"<tr><td class='model'><span class='dot' style='background:{accent}'></span>"
            f"{html.escape(m['model'])}</td>"
            f"<td class='var'>{variants}</td>"
            f"<td class='num'>{m['stock']:,}</td></tr>"
        )

    more = ""
    if rest:
        more = (
            f"<p class='muted'>+ {len(rest)} more models, "
            f"{sum(m['stock'] for m in rest):,} units.</p>"
        )

    return f"""<table><thead><tr><th>Model</th><th>Variants</th>
      <th class='num'>Units</th></tr></thead><tbody>{body}</tbody></table>{more}"""


def section(key, models):
    title, caption, accent = GROUP_STYLE[key]
    total_units = sum(m["stock"] for m in models)
    total_skus = sum(m["skus"] for m in models)
    top5 = sum(m["stock"] for m in models[:5])
    share = round(100 * top5 / total_units) if total_units else 0

    return f"""
    <section class="group">
      <div class="group-head">
        <span class="chip" style="--c:{accent}">{html.escape(title)}</span>
        <span class="muted">{html.escape(caption)}</span>
      </div>
      <div class="stats">
        <div><strong>{len(models)}</strong><span>models</span></div>
        <div><strong>{total_skus}</strong><span>variants</span></div>
        <div><strong>{total_units:,}</strong><span>units</span></div>
        <div class="share">Top 5 account for <strong>{share}%</strong></div>
      </div>
      {table(models, accent)}
    </section>"""


def build_html(sections, source_name):
    total_units = sum(sum(m["stock"] for m in ms) for ms in sections.values())
    all_models = set()
    for ms in sections.values():
        all_models.update(m["model"] for m in ms)

    def kpi(key):
        title, _, accent = GROUP_STYLE[key]
        ms = sections.get(key, [])
        return f"""<div class="kpi"><span class="kpi-label" style="--c:{accent}">{html.escape(title)}</span>
          <span class="kpi-value">{len(ms)}</span>
          <span class="kpi-sub">models · {sum(m['stock'] for m in ms):,} units</span></div>"""

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Stock rotation by model</title>
<style>
  * {{ box-sizing:border-box; }}
  body {{ margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         color:#1e293b; background:#fff; font-size:11px; line-height:1.45; }}
  .page {{ max-width:190mm; margin:0 auto; padding:13mm 12mm; }}
  header {{ border-bottom:2px solid #0f172a; padding-bottom:10px; margin-bottom:14px;
            display:flex; justify-content:space-between; align-items:flex-end; }}
  h1 {{ font-size:19px; margin:0; letter-spacing:-.3px; font-weight:800; }}
  .sub {{ color:#64748b; font-size:10.5px; margin-top:3px; }}
  .totals {{ text-align:right; color:#64748b; font-size:10px; }}
  .totals strong {{ display:block; font-size:16px; color:#0f172a; }}

  .kpis {{ display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:16px; }}
  .kpi {{ border:1px solid #e2e8f0; border-radius:8px; padding:9px 12px; display:flex;
          flex-direction:column; gap:1px; background:#f8fafc; }}
  .kpi-label {{ font-size:8.5px; font-weight:800; text-transform:uppercase; letter-spacing:.7px;
                color:var(--c); }}
  .kpi-value {{ font-size:22px; font-weight:800; line-height:1.15; }}
  .kpi-sub {{ font-size:9.5px; color:#64748b; }}

  .group {{ margin-bottom:15px; break-inside:avoid; }}
  .group-head {{ display:flex; align-items:baseline; gap:8px; margin-bottom:5px; }}
  .chip {{ font-size:9px; font-weight:800; text-transform:uppercase; letter-spacing:.7px;
           color:var(--c); border:1px solid var(--c); border-radius:999px; padding:2px 8px; }}
  .stats {{ display:flex; gap:14px; margin-bottom:6px; align-items:baseline; flex-wrap:wrap; }}
  .stats > div {{ display:flex; align-items:baseline; gap:4px; }}
  .stats strong {{ font-size:13px; font-weight:800; }}
  .stats span {{ font-size:9.5px; color:#64748b; }}
  .share {{ font-size:9.5px; color:#64748b; margin-left:auto; }}
  .share strong {{ font-size:10.5px; color:#0f172a; }}

  table {{ width:100%; border-collapse:collapse; }}
  thead th {{ text-align:left; font-size:8.5px; text-transform:uppercase; letter-spacing:.6px;
              color:#64748b; border-bottom:1px solid #cbd5e1; padding:4px 6px; font-weight:700; }}
  td {{ padding:3.5px 6px; border-bottom:1px solid #f1f5f9; }}
  .num {{ text-align:right; font-variant-numeric:tabular-nums; font-weight:600; }}
  .model {{ font-weight:700; font-size:11px; }}
  .var {{ color:#64748b; font-size:10px; }}
  .dot {{ display:inline-block; width:5px; height:5px; border-radius:50%; margin-right:7px;
          vertical-align:middle; }}
  .muted {{ color:#94a3b8; font-size:9.5px; margin:5px 0 0; }}
  footer {{ margin-top:12px; padding-top:8px; border-top:1px solid #e2e8f0; color:#94a3b8;
            font-size:9px; display:flex; justify-content:space-between; }}
  @page {{ size:A4; margin:0; }}
</style></head>
<body><div class="page">
  <header>
    <div>
      <h1>Stock rotation by model</h1>
      <div class="sub">Models grouped by outbound movement and stock level</div>
    </div>
    <div class="totals"><strong>{len(all_models)}</strong>models · {total_units:,} units</div>
  </header>

  <div class="kpis">{kpi("movers")}{kpi("high")}{kpi("low")}</div>

  {section("movers", sections.get("movers", []))}
  {section("high", sections.get("high", []))}
  {section("low", sections.get("low", []))}

  <footer>
    <span>Each model groups its size and colour variants · scratch-and-dent excluded</span>
    <span>{date.today().strftime("%b %d, %Y")} · {html.escape(source_name)}</span>
  </footer>
</div></body></html>"""


SUMMARY_TOP = 8


def build_summary_html(sections, _source_name):
    """One-page read: model, where it sits, how much. Nothing else."""

    def block(key):
        title, caption, accent = GROUP_STYLE[key]
        models = sections.get(key, [])[:SUMMARY_TOP]
        rows = "".join(
            f"<tr><td class='model'>{html.escape(m['model'])}</td>"
            f"<td class='loc'>{html.escape(locations_of(m))}</td>"
            f"<td class='num'>{m['stock']:,}</td></tr>"
            for m in models
        )
        return f"""
        <section>
          <h2 style="--c:{accent}">{html.escape(title)}<em>{html.escape(caption)}</em></h2>
          <table><tbody>{rows}</tbody></table>
        </section>"""

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Stock rotation — summary</title>
<style>
  * {{ box-sizing:border-box; }}
  body {{ margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         color:#1e293b; background:#fff; font-size:12px; line-height:1.5; }}
  .page {{ max-width:190mm; margin:0 auto; padding:18mm 16mm; }}
  h1 {{ font-size:21px; margin:0 0 2px; font-weight:800; letter-spacing:-.3px; }}
  .sub {{ color:#64748b; font-size:11px; margin-bottom:22px; }}
  section {{ margin-bottom:22px; break-inside:avoid; }}
  h2 {{ font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:1px;
        color:var(--c); margin:0 0 7px; padding-bottom:5px;
        border-bottom:1.5px solid var(--c); display:flex; justify-content:space-between;
        align-items:baseline; }}
  h2 em {{ font-style:normal; font-weight:600; text-transform:none; letter-spacing:0;
           color:#94a3b8; font-size:10px; }}
  table {{ width:100%; border-collapse:collapse; }}
  td {{ padding:5px 0; border-bottom:1px solid #f1f5f9; vertical-align:baseline; }}
  .model {{ font-weight:700; font-size:12.5px; width:45%; }}
  .loc {{ color:#64748b; font-size:11px; }}
  .num {{ text-align:right; font-variant-numeric:tabular-nums; font-weight:700;
          font-size:12.5px; width:18%; }}
  footer {{ margin-top:26px; color:#94a3b8; font-size:9.5px; }}
  @page {{ size:A4; margin:0; }}
</style></head>
<body><div class="page">
  <h1>Stock rotation</h1>
  <div class="sub">Top models by units on hand — {date.today().strftime("%b %d, %Y")}</div>
  {block("movers")}{block("high")}{block("low")}
  <footer>Scratch-and-dent excluded.</footer>
</div></body></html>"""


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    summary = "--summary" in sys.argv
    source = Path(args[0]).expanduser()
    base = args[1] if len(args) > 1 else "inventario-por-rotacion-modelos"

    mapping = json.loads((Path(__file__).parent / "sku-model-map.json").read_text())
    groups = read_groups(source)
    sections = {key_for(title): by_model(rows, mapping) for title, rows in groups.items()}

    out_html = Path(f"{base}.html").resolve()
    out_pdf = Path(f"{base}.pdf").resolve()
    render = build_summary_html if summary else build_html
    out_html.write_text(render(sections, source.name), encoding="utf-8")

    subprocess.run(
        [CHROME, "--headless", "--disable-gpu", "--no-pdf-header-footer",
         f"--print-to-pdf={out_pdf}", out_html.as_uri()],
        check=True, capture_output=True,
    )

    print(f"PDF:  {out_pdf}")
    for key in ("movers", "high", "low"):
        ms = sections.get(key, [])
        print(f"  {GROUP_STYLE[key][0]:<26} {len(ms):>3} models / "
              f"{sum(m['stock'] for m in ms):>5} units")


if __name__ == "__main__":
    main()
