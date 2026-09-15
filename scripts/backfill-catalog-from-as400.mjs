/**
 * backfill-catalog-from-as400.mjs — pasa a PickD lo que el AS400 sabe del
 * catálogo: `model`, `size` y `color`.
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
 * Y tres reemplazos acotados, decididos con los datos delante (11 sep 2026):
 *
 *   · `color` solo si lo que hay es un CUBO GENÉRICO. La columna ya estaba
 *     medio migrada al nombre comercial —`GLOSS BLACK` (41), `THUNDER GREY`
 *     (18), `INK` (14)— contra los cubos `Blue` (62) y `Black` (33). El cubo no
 *     es una convención, es lo que quedó sin enriquecer. Así que `BLUE` → `INK`
 *     sí; `THUNDER GREY` no se toca jamás.
 *
 *   · `model` de dos letras o menos. Son 5 en todo el catálogo, y «T» no es un
 *     modelo: AS400 dice HUDSON.
 *
 *   · `model` que es PREFIJO ESTRICTO del de AS400: `QUEST` → `QUEST SPORT`.
 *     Estrictamente más información, imposible que empeore.
 *
 * Lo que sigue fuera, en idea-177: un `model` con la talla dentro
 * (`CITIZEN 3 S/T 14 VANILLA`). Son 202 filas, el 25% de las bicis, y merecen
 * una pasada revisada y no ir de polizón aquí.
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
import { expandModelAbbreviation } from '../src/utils/modelAbbreviations.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');

function dbUrl() {
  const env = fs.readFileSync(path.join(HERE, '..', '.env'), 'utf8');
  const m = env.match(/^PROD_DB_URL=(.*)$/m);
  if (!m) throw new Error('No hay PROD_DB_URL en .env');
  return m[1].trim().replace(/^["']|["']$/g, '');
}

const empty = (v) => v === null || v === undefined || String(v).trim() === '';
const norm = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

/** Los cubos: el color que alguien puso cuando no tenía el nombre de verdad. */
const BUCKETS = new Set([
  'BLUE', 'BLACK', 'GREY', 'GRAY', 'RED', 'WHITE', 'GREEN', 'SILVER',
  'BROWN', 'ORANGE', 'YELLOW', 'PURPLE', 'PINK', 'TAN', 'BEIGE', 'GOLD',
]);

/**
 * Marcas que el AS400 pega detrás del color y que no son color: una `T` suelta
 * (`AMBER WAVE T`), la etiqueta de foto de catálogo (`MOSS PHTO`, `CRLN PHOTO`),
 * `DEMO` y el `S/D` de scratch & dent. Se quitan del final, una tras otra,
 * porque a veces vienen juntas.
 */
const TRAILING_MARKERS = /\s+(T|PHT|PHTO|PHOTO|DEMO|S\/D)$/i;

/** Abreviaturas que el AS400 escribe y la página de Jamis deletrea. */
const SPELLED_OUT = new Map([
  ['BK', 'BLACK'],
  ['CRLN', 'CERULEAN'],
  ['BLU', 'BLUE'],
  ['GRN', 'GREEN'],
]);

/** El color como lo diría Jamis, o null si lo que queda no dice nada. Pura. */
export function cleanAs400Color(raw) {
  let s = String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  let prev;
  do {
    prev = s;
    s = s.replace(TRAILING_MARKERS, '').trim();
  } while (s !== prev);
  if (!s) return null;
  const words = s.split(' ').map((w) => SPELLED_OUT.get(w.toUpperCase()) ?? w);
  return words.join(' ') || null;
}

/** ¿El modelo que hay es claramente no-un-modelo, o una versión corta del real? */
export function modelIsSafeToReplace(current, as400Model) {
  const a = norm(current);
  const b = norm(as400Model);
  if (!a || !b || a === b) return false;
  if (a.length <= 2) return true; // «T» donde AS400 dice HUDSON
  // Prefijo estricto por palabras: QUEST ⊂ QUEST SPORT. Por palabras y no por
  // caracteres, o «CITIZEN 1» se comería «CITIZEN 12».
  const aw = a.split(' ');
  const bw = b.split(' ');
  return aw.length < bw.length && aw.every((w, i) => w === bw[i]);
}

/**
 * El color, y sólo el color, para las filas que el parser rechaza.
 *
 * `parseBikeName` exige una talla de una o dos cifras antes del año, así que se
 * niega ante `KROMO S 2026 MASH` (sin número), `PORTAL A2 15.5`, `DIVIDE 13X27`
 * y `TAXI 24"`. Esa negativa es correcta para el modelo —sin saber dónde acaba
 * la talla no se puede decir dónde acaba el modelo— pero el color no depende de
 * eso: es lo que va detrás del año, y ahí el AS400 dice MASH, STORM GREY,
 * OXBLOOD o COSMO BLUE mientras la columna guarda GREEN, GREY, RED o BLUE.
 *
 * Se niega si lo que sigue al año empieza por un número (`TRAIL X1 2009 14
 * GLOSS BLACK` tiene el año y la talla al revés): ahí el `14` no es color.
 */
export function colorAfterYear(description) {
  const m = String(description ?? '').match(/(?:19|20)\d{2}\s+(.*)$/);
  if (!m) return null;
  const rest = m[1].trim().replace(/\s+/g, ' ');
  if (!rest || /^\d/.test(rest)) return null;
  return cleanAs400Color(rest);
}

/** Lo que esta fila ganaría, o null si no hay nada seguro que darle. Pura. */
export function planRow(row) {
  const parsed = parseBikeName(row.as400_description);
  // El fallback del parser: sin año no hay talla, y sin talla no hay nada que
  // podamos afirmar sobre dónde acaba el modelo. El color sí se puede rescatar.
  if (!parsed.size || !parsed.year) {
    const solo = colorAfterYear(row.as400_description);
    if (solo && (empty(row.color) || BUCKETS.has(norm(row.color))) && norm(row.color) !== norm(solo)) {
      return { color: solo };
    }
    return null;
  }

  const plan = {};
  // `EC3` se guarda `EARTH CRUISER 3 EC3` (Rafael, 15 sep 2026): el completo delante,
  // la abreviatura detrás, para que el buscador encuentre las dos formas.
  const as400Model = expandModelAbbreviation(parsed.model);
  if (empty(row.model)) plan.model = as400Model;
  else if (modelIsSafeToReplace(row.model, as400Model)) plan.model = as400Model;
  else if (
    norm(row.model) !== norm(as400Model) &&
    norm(expandModelAbbreviation(row.model)) === norm(as400Model)
  )
    plan.model = as400Model; // la misma bici con el nombre a medias: `EC3`, `EARTH CRUISER 3`

  if (empty(row.size)) plan.size = parsed.size;

  // El color solo pisa un cubo. Lo específico que ya esté escrito se respeta,
  // venga de donde venga.
  const as400Color = cleanAs400Color(parsed.color);
  if (as400Color && (empty(row.color) || BUCKETS.has(norm(row.color)))) {
    if (norm(row.color) !== norm(as400Color)) plan.color = as400Color;
  }

  return Object.keys(plan).length ? plan : null;
}

const sql = postgres(dbUrl(), { ssl: 'require', max: 1 });

try {
  const rows = await sql`
    SELECT sku, model, size, color, as400_description
    FROM sku_metadata
    WHERE as400_description IS NOT NULL
      AND is_bike
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
      // Contra lo que se vio en el preview, no contra «sigue vacío»: ahora hay
      // campos que se reemplazan a propósito. Si alguien lo editó en medio,
      // gana esa persona y esta fila se salta.
      const res = await sql`
        UPDATE sku_metadata SET ${sql(plan)}
        WHERE sku = ${row.sku}
          AND model IS NOT DISTINCT FROM ${row.model}
          AND size IS NOT DISTINCT FROM ${row.size}
          AND color IS NOT DISTINCT FROM ${row.color}
        RETURNING sku`;
      if (res.length) done += 1;
      else console.log(`  ${row.sku}: cambió entre el preview y ahora — no tocado`);
    }
    console.log(`\n  ${done} fila(s) escritas.\n`);
  }
} catch (e) {
  console.error('ERROR:', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
