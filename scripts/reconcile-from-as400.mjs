/**
 * Lo que el watcher leyó del AS400, aplicado a PickD — y lo que no, dicho.
 *
 * Rafael, 12 sep 2026: «trabaja junto con el watcher, dejo a tu criterio qué
 * registrar en pickd y qué mejor dejar en reporte; definitivamente actualízame
 * las ubicaciones y cantidades, en los pesos sí regístralos también».
 *
 * El watcher lee la pantalla `02. Stock File Inquiry` y guarda la pantalla
 * entera en `sku_metadata.as400_snapshot`. Esto la aplica. Es idempotente:
 * correrlo otra vez cuando el watcher haya leído más sólo toca lo nuevo.
 *
 * QUÉ SE ESCRIBE
 *   - **El peso**, por `apply_as400_weight` (la regla vive en SQL, no aquí):
 *     gana AS400 salvo que sea una BICI cuyo peso no sea el default de 45 y
 *     además pese más que el suyo. Un `Weight: 0` del AS400 no es un peso.
 *   - **La cantidad, sólo donde PickD no tiene nada que decir**: total 0, una
 *     sola fila, y esa fila en `UNKNOWN` — el placeholder que el alta creó. Ahí
 *     el número del AS400 es la única información que existe, y convierte un
 *     «no hay» que es falso en un «hay N, búscalas».
 *
 * QUÉ NO, Y POR QUÉ
 *   - **PickD tiene unidades en un estante y AS400 dice 0.** Poner a cero once
 *     HUDSON que están en ROW 24 es borrar inventario real por una diferencia
 *     que igual es un envío no registrado en uno de los dos lados. Es una lista
 *     de conteo físico, no un write.
 *   - **PickD reparte el SKU en varias filas.** AS400 da un total y PickD lo
 *     tiene por estante: repartir la diferencia sería inventar dónde está.
 *   - **PickD tiene UNA fila real (un estante) y el número no cuadra.** Alguien
 *     contó eso y lo puso ahí; un total de otro sistema no lo tumba sin que
 *     alguien vaya a mirar.
 *
 * Uso:  node scripts/reconcile-from-as400.mjs [--apply] [--out informe.md]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Qué hacer con la cantidad de un SKU. Puro, para que la decisión se pueda leer. */
export function planQty(row) {
  const as400 = row.as400_nj;
  if (as400 === null || as400 === undefined) return { do: 'skip', why: 'AS400 no dio número' };
  if (row.filas === 0) return { do: 'report', why: 'sin fila de inventario' };
  if (row.pickd === as400) return { do: 'skip', why: 'ya cuadra' };
  if (row.filas > 1) return { do: 'report', why: 'PickD lo reparte en varias filas' };
  if (row.pickd > 0 && as400 === 0)
    return { do: 'report', why: 'PickD tiene unidades y AS400 dice 0 — conteo físico' };
  // Una fila sola en cero es «no tengo información», no «conté y no hay» —
  // en dos formas: el placeholder que el alta crea en UNKNOWN, y la lápida
  // (fila inactiva, sin nombre) que queda cuando un SKU se vació hace meses y
  // la fila sobrevive sólo para anclar historial. En las dos, el número del
  // AS400 es lo único que existe.
  if (row.pickd === 0 && as400 > 0 && (row.location === 'UNKNOWN' || row.activa === false))
    return {
      do: 'write',
      delta: as400,
      why: row.location === 'UNKNOWN' ? 'placeholder en UNKNOWN' : 'fila inactiva en cero (lápida)',
    };
  return { do: 'report', why: 'una fila real en un estante — no la tumba un total de otro sistema' };
}

const SQL = `
  select m.sku,
         m.is_bike,
         m.weight_lbs::numeric               as pickd_peso,
         (m.as400_snapshot->>'weight_lbs')::numeric as as400_peso,
         m.weight_verified,
         m.as400_description,
         (m.as400_snapshot->'on_hand'->>'NJ')::int  as as400_nj,
         coalesce(f.total, 0)                as pickd,
         coalesce(f.n, 0)                    as filas,
         f.una_location                      as location,
         f.activa                            as activa,
         f.donde
  from sku_metadata m
  left join (
    select sku, count(*)::int n, sum(quantity)::int total,
           min(location) filter (where true) as una_location,
           bool_or(is_active)                 as activa,
           string_agg(location || ':' || quantity, ' ' order by location) as donde
    from inventory where warehouse = 'LUDLOW' group by sku
  ) f on f.sku = m.sku
  where jsonb_typeof(m.as400_snapshot->'on_hand'->'NJ') = 'number'
  order by m.is_bike desc nulls last, m.sku
`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const APPLY = process.argv.includes('--apply');
  const outIdx = process.argv.indexOf('--out');
  const outFile = outIdx > -1 ? process.argv[outIdx + 1] : null;

  const env = fs.readFileSync(path.join(HERE, '..', '.env'), 'utf8');
  const m = env.match(/^PROD_DB_URL=(.*)$/m);
  if (!m) throw new Error('No hay PROD_DB_URL en .env');
  const sql = postgres(m[1].trim().replace(/^["']|["']$/g, ''), { ssl: 'require', max: 1 });

  try {
    const rows = await sql.unsafe(SQL);
    const pesos = { written: [], kept: [], skipped: [], unchanged: [] };
    const qty = { write: [], report: [], skip: [] };

    for (const r of rows) {
      const p = planQty(r);
      qty[p.do === 'write' ? 'write' : p.do === 'report' ? 'report' : 'skip'].push({ ...r, ...p });
    }

    console.log(`${rows.length} SKUs leídos por el watcher\n`);

    // ── pesos ────────────────────────────────────────────────────────────────
    for (const r of rows) {
      if (!APPLY) {
        const w = r.as400_peso;
        const bici = r.is_bike === true;
        let action = 'unchanged';
        if (w === null || Number(w) <= 0) action = 'skipped';
        else if (bici && r.pickd_peso !== null && Number(r.pickd_peso) < 45 && Number(r.pickd_peso) > Number(w)) action = 'kept';
        else if (Number(r.pickd_peso) !== Number(w)) action = 'written';
        pesos[action].push(`${r.sku} ${r.pickd_peso} → ${w}`);
      } else {
        const [res] = await sql`select apply_as400_weight(${r.sku}, ${r.as400_peso}) r`;
        const a = res.r.action;
        pesos[a === 'written' ? 'written' : a === 'kept' ? 'kept' : a === 'unchanged' ? 'unchanged' : 'skipped']
          .push(a === 'written' ? `${r.sku} ${res.r.from} → ${res.r.to}` : r.sku);
      }
    }
    console.log(`PESOS  escritos ${pesos.written.length} · PickD gana ${pesos.kept.length} · sin peso en AS400 ${pesos.skipped.length} · ya iguales ${pesos.unchanged.length}`);
    for (const l of pesos.written.slice(0, 20)) console.log(`   ${l}`);

    // ── cantidades ───────────────────────────────────────────────────────────
    console.log(`\nCANTIDADES  a escribir ${qty.write.length} · a reporte ${qty.report.length} · ya cuadran ${qty.skip.length}`);
    for (const r of qty.write) {
      console.log(`   ${r.sku.padEnd(11)} ${(r.location || '?').padEnd(9)} 0 → ${String(r.as400_nj).padStart(4)}   ${r.as400_description}`);
      if (APPLY) {
        await sql`select adjust_inventory_quantity(
          ${r.sku}, 'LUDLOW', ${r.location}, ${r.delta}, 'system: as400-sync',
          null, 'admin', null, null, null, false,
          ${'AS400 On Hand NJ al ' + new Date().toISOString().slice(0, 10)})`;
      }
    }

    // ── el informe ───────────────────────────────────────────────────────────
    const grupos = {};
    for (const r of qty.report) (grupos[r.why] ||= []).push(r);
    console.log('\nREPORTE (no se escribe nada de esto):');
    for (const [why, rs] of Object.entries(grupos)) {
      console.log(`\n  ${why} — ${rs.length}`);
      for (const r of rs.slice(0, 12))
        console.log(`    ${r.sku.padEnd(11)} PickD ${String(r.pickd).padStart(5)} vs AS400 ${String(r.as400_nj).padStart(5)}   ${r.donde || '(sin fila)'}`);
      if (rs.length > 12) console.log(`    … y ${rs.length - 12} más`);
    }

    if (outFile) {
      const md = [
        `# PickD vs AS400 — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        ``,
        `${rows.length} SKUs leídos por el watcher.`,
        ``,
        ...Object.entries(grupos).flatMap(([why, rs]) => [
          `## ${why} (${rs.length})`,
          ``,
          `| SKU | PickD | AS400 | dónde | nombre |`,
          `|---|---:|---:|---|---|`,
          ...rs.map((r) => `| ${r.sku} | ${r.pickd} | ${r.as400_nj} | ${r.donde || '—'} | ${r.as400_description || ''} |`),
          ``,
        ]),
      ].join('\n');
      fs.writeFileSync(outFile, md);
      console.log(`\ninforme → ${outFile}`);
    }
    if (!APPLY) console.log('\n(previsualización — añade --apply para escribir)');
  } finally {
    await sql.end();
  }
}
