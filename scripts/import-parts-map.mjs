/**
 * Registra en PickD las partes de un mapa de piso (CSV) que el catálogo no tiene.
 *
 * Rafael, 11 sep 2026, mandando `PA_Inventory_Map.csv`: «estas son algunas
 * partes que puede que no estén en pickd y tienen ubicación real algunas».
 *
 * Qué escribe y qué no:
 *   - Da de alta por `register_sku_from_as400`: metadata + una fila de
 *     inventario en **qty 0**. La cantidad del mapa NO se escribe — para
 *     `66-0131BK` el mapa dice 204 y PickD tiene 94, así que es un mapa, no un
 *     conteo. Va como nota (`PA map: J10 · 204 u`) para que quien vaya al
 *     estante sepa qué esperaba encontrar el mapa.
 *   - Ubicación: el `Bin Location` cuando nombra **un** sitio (`J12`); si está
 *     vacío o nombra varios (`D19/D20`, `H12-H28`) va a `UNKNOWN` y el texto
 *     del mapa queda en la nota. Un rango no es una dirección.
 *   - `is_bike = false` siempre: es un mapa de partes. Si apareciera un
 *     departamento de bici (01/02/03/06/07) la fila se salta y se avisa, en vez
 *     de registrar una bici por accidente con 45 lb y caja de bici.
 *   - Lo que ya está en el catálogo no se toca (ni ubicación ni cantidad).
 *
 * Idempotente: correrlo dos veces no cambia nada la segunda.
 *
 * Uso:  node scripts/import-parts-map.mjs <archivo.csv> [--apply]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const BIKE_DEPTS = new Set(['01', '02', '03', '06', '07']);
const ONE_BIN = /^[A-Z]\d{1,2}$/;

/** CSV con campos entre comillas y comas dentro. No vale una librería para esto. */
export function parseCsv(text) {
  const rows = [];
  let row = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x !== ''));
}

/** `66` + `0140` + `BL` → `66-0140BL`. El CSV trae las tres piezas por separado. */
export function skuOf(rec) {
  const dept = (rec['Cat. Code'] || '').trim().padStart(2, '0');
  const num = (rec['Part #'] || '').trim().padStart(4, '0');
  const color = (rec['Color'] || '').trim().toUpperCase();
  return `${dept}-${num}${color}`;
}

/** Dónde darlo de alta, y qué contarle a quien vaya a buscarlo. */
export function placementOf(rec) {
  const bin = (rec['Bin Location'] || '').trim().toUpperCase();
  const qty = (rec['Qty'] || '').trim();
  const status = (rec['Status'] || '').trim();
  const parts = ['PA map'];
  if (bin) parts.push(bin);
  if (qty) parts.push(`${qty} u`);
  if (status) parts.push(status);
  return {
    location: ONE_BIN.test(bin) ? bin : 'UNKNOWN',
    note: parts.join(' · '),
  };
}

export function planImport(records, known) {
  const seen = new Set();
  const plan = [];
  const skipped = { ya_en_pickd: [], repetido: [], mal_formado: [], bici: [] };
  for (const rec of records) {
    const sku = skuOf(rec);
    const name = (rec['Item name'] || '').trim();
    if (!/^\d{2}-\d{4}[A-Z]{0,3}$/.test(sku) || !name) {
      skipped.mal_formado.push(sku);
      continue;
    }
    if (BIKE_DEPTS.has(sku.slice(0, 2))) {
      skipped.bici.push(sku);
      continue;
    }
    if (known.has(sku)) {
      skipped.ya_en_pickd.push(sku);
      continue;
    }
    if (seen.has(sku)) {
      skipped.repetido.push(sku);
      continue;
    }
    seen.add(sku);
    const { location, note } = placementOf(rec);
    plan.push({ sku, name, location, note });
  }
  return { plan, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  const APPLY = process.argv.includes('--apply');
  if (!file) {
    console.error('uso: node scripts/import-parts-map.mjs <archivo.csv> [--apply]');
    process.exit(1);
  }
  const env = fs.readFileSync(path.join(HERE, '..', '.env'), 'utf8');
  const m = env.match(/^PROD_DB_URL=(.*)$/m);
  if (!m) throw new Error('No hay PROD_DB_URL en .env');
  const url = m[1].trim().replace(/^["']|["']$/g, '');
  const records = (() => {
    const rows = parseCsv(fs.readFileSync(file, 'utf8'));
    const head = rows.shift().map((h) => h.trim());
    return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
  })();

  const sql = postgres(url, { ssl: 'require', max: 1 });
  try {
    const skus = [...new Set(records.map(skuOf))];
    const known = new Set((await sql`select sku from sku_metadata where sku = any(${skus})`).map((r) => r.sku));
    const { plan, skipped } = planImport(records, known);

    console.log(`${records.length} filas · ${skus.length} SKUs distintos`);
    console.log(`  ya en el catálogo : ${skipped.ya_en_pickd.length}`);
    console.log(`  repetidos en el CSV: ${skipped.repetido.length} ${skipped.repetido.join(' ')}`);
    console.log(`  mal formados      : ${skipped.mal_formado.length} ${skipped.mal_formado.join(' ')}`);
    console.log(`  departamento bici : ${skipped.bici.length} ${skipped.bici.join(' ')}`);
    const conBin = plan.filter((p) => p.location !== 'UNKNOWN');
    console.log(`\nA REGISTRAR: ${plan.length} — ${conBin.length} en su estante real, ${plan.length - conBin.length} en UNKNOWN`);
    for (const p of plan.slice(0, 15)) console.log(`  ${p.sku.padEnd(11)} → ${p.location.padEnd(8)} ${p.name}  [${p.note}]`);
    if (plan.length > 15) console.log(`  … y ${plan.length - 15} más`);

    if (!APPLY) {
      console.log('\n(previsualización — añade --apply para escribir)');
    } else {
      let hechos = 0;
      for (const p of plan) {
        const [r] = await sql`select register_sku_from_as400(
          ${p.sku}, ${p.name}, false, ${p.location}, 'LUDLOW', null, null, ${p.note}) r`;
        if (r.r.action === 'registered') hechos++;
        else console.log(`  ! ${p.sku}: ${r.r.action}`);
      }
      console.log(`\nregistrados: ${hechos} de ${plan.length}`);
    }
  } finally {
    await sql.end();
  }
}
