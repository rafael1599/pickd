/**
 * backfill-catalog-from-as400.mjs — llena `model` y `size` desde lo que el
 * AS400 dijo, y solo donde PickD no tiene nada.
 *
 *   node --experimental-strip-types scripts/backfill-catalog-from-as400.mjs
 *   node --experimental-strip-types scripts/backfill-catalog-from-as400.mjs --apply
 *
 * Sin `--apply` no escribe: imprime lo que haría, fila por fila. Es el mismo
 * Preview/Apply de la fase F1 del watchdog.
 *
 * ── Qué cuenta como seguro (Rafael, 11 sep 2026) ────────────────────────────
 *
 * Rellenar un hueco vacío es seguro; pisar lo que alguien escribió no lo es.
 * Así que esto toca EXCLUSIVAMENTE `model` y `size` cuando están en NULL o
 * vacíos, y solo cuando el parser sacó un resultado de verdad.
 *
 * Lo confuso se queda fuera a propósito y vive en el backlog:
 *   · `color` — PickD tiene un cubo genérico ("Blue") y AS400 el nombre
 *     comercial ("INK"). Eso no es un hueco, es un reemplazo.
 *   · `model` ya ocupado pero sucio — «T» donde AS400 dice HUDSON. Pisarlo
 *     sigue siendo pisarlo, y merece su regla.
 *
 * ── Por qué el parser decide, y no una heurística de aquí ───────────────────
 *
 * `parseBikeName` es el mismo módulo que usa la app: se importa, no se copia
 * (node corre el .ts con --experimental-strip-types). Y su forma de fallar es
 * lo que hace seguro todo esto: cuando no encuentra un año `20xx` con una
 * talla delante devuelve el string entero como `model` y deja `size` vacío.
 * Ese fallback es detectable, y es la señal de NO escribir:
 *
 *     TRAIL X1 2009 14 GLOSS BLACK   → año y talla al revés, no se parsea
 *     S/D ALLEGRO A3 S/O 14" MING …  → sin año, trae número de serie
 *
 * De diez descripciones reales del 11 sep, ocho salieron limpias y esas dos se
 * negaron solas. Prefiero que se nieguen.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import { parseBikeName } from '../src/features/inventory/utils/parseBikeName.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');

function dbUrl() {
  const env = fs.readFileSync(path.join(HERE, '..', '.env'), 'utf8');
  const m = env.match(/^PROD_DB_URL=(.*)$/m);
  if (!m) throw new Error('No hay PROD_DB_URL en .env');
  return m[1].trim().replace(/^["']|["']$/g, '');
}

const empty = (v) => v === null || v === undefined || String(v).trim() === '';

/** Lo que esta fila ganaría, o null si no hay nada seguro que darle. Pura. */
export function planRow(row) {
  const parsed = parseBikeName(row.as400_description);
  // El fallback del parser: sin año no hay talla, y sin talla no hay nada que
  // podamos afirmar sobre dónde acaba el modelo.
  if (!parsed.size || !parsed.year) return null;

  const plan = {};
  if (empty(row.model)) plan.model = parsed.model;
  if (empty(row.size)) plan.size = parsed.size;
  return Object.keys(plan).length ? plan : null;
}

const sql = postgres(dbUrl(), { ssl: 'require', max: 1 });

try {
  const rows = await sql`
    SELECT sku, model, size, color, as400_description
    FROM sku_metadata
    WHERE as400_description IS NOT NULL
    ORDER BY sku`;

  const write = [];
  const skip = [];
  for (const row of rows) {
    const plan = planRow(row);
    if (plan) write.push({ row, plan });
    else skip.push(row);
  }

  console.log(`\n${APPLY ? 'APLICANDO' : 'PREVIEW (sin escribir)'} · ${rows.length} SKU leídos del AS400\n`);

  for (const { row, plan } of write) {
    const bits = Object.entries(plan).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
    console.log(`  ${row.sku}  ${bits.join('  ')}          ← ${row.as400_description}`);
  }

  if (skip.length) {
    console.log(`\n  Sin tocar (${skip.length}):`);
    for (const row of skip) {
      const why = parseBikeName(row.as400_description).size
        ? 'model y size ya estaban puestos'
        : 'el parser no pudo con la descripción';
      console.log(`  ${row.sku}  ${why.padEnd(34)} ← ${row.as400_description}`);
    }
  }

  if (!APPLY) {
    console.log(`\n  ${write.length} fila(s) cambiarían. Repite con --apply para escribir.\n`);
  } else {
    let done = 0;
    for (const { row, plan } of write) {
      // Por clave primaria y solo sobre el hueco: el WHERE repite la condición
      // de vacío para que una edición hecha entre el preview y el apply gane.
      const res = await sql`
        UPDATE sku_metadata SET ${sql(plan)}
        WHERE sku = ${row.sku}
          AND (${'model' in plan ? sql`(model IS NULL OR btrim(model) = '')` : sql`TRUE`})
          AND (${'size' in plan ? sql`(size IS NULL OR btrim(size) = '')` : sql`TRUE`})
        RETURNING sku`;
      if (res.length) done += 1;
      else console.log(`  ${row.sku}: alguien lo llenó entre el preview y ahora — no tocado`);
    }
    console.log(`\n  ${done} fila(s) escritas.\n`);
  }
} catch (e) {
  console.error('ERROR:', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
