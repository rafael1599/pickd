/**
 * compare-schemas.js
 *
 * Compara el esquema de la BD local (Docker) contra producción (Supabase).
 * Detecta columnas, tablas y funciones que difieren entre ambos entornos.
 *
 * Uso:
 *   PROD_DB_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" \
 *   node scripts/compare-schemas.js
 *
 * O agrega PROD_DB_URL a tu .env:
 *   PROD_DB_URL=postgresql://postgres:PASSWORD@db.xexkttehzpxtviebglei.supabase.co:5432/postgres
 */

import postgres from 'postgres';
import * as dotenv from 'dotenv';
dotenv.config();

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const PROD_DB_URL = process.env.PROD_DB_URL;

// ── Queries ──────────────────────────────────────────────────────────────────

const COLUMNS_QUERY = `
  SELECT
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
  ORDER BY table_name, ordinal_position;
`;

const TABLES_QUERY = `
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name;
`;

const FUNCTIONS_QUERY = `
  SELECT
    p.proname AS function_name,
    pg_get_function_arguments(p.oid) AS arguments,
    pg_get_function_result(p.oid) AS return_type
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
  ORDER BY p.proname;
`;

const INDEXES_QUERY = `
  SELECT
    t.relname AS table_name,
    i.relname AS index_name,
    ix.indisunique AS is_unique,
    array_to_string(array_agg(a.attname ORDER BY k.ordinality), ', ') AS columns
  FROM pg_class t
  JOIN pg_index ix ON t.oid = ix.indrelid
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality) ON TRUE
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
  WHERE n.nspname = 'public' AND t.relkind = 'r'
  GROUP BY t.relname, i.relname, ix.indisunique
  ORDER BY t.relname, i.relname;
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function colKey(row) {
  return `${row.table_name}.${row.column_name}`;
}

function colDetail(row) {
  return `${row.data_type} | nullable:${row.is_nullable} | default:${row.column_default ?? 'NULL'}`;
}

function fnKey(row) {
  return `${row.function_name}(${row.arguments})`;
}

// ── Diff helpers ──────────────────────────────────────────────────────────────

function diffTables(local, prod) {
  const localSet = new Set(local.map(r => r.table_name));
  const prodSet = new Set(prod.map(r => r.table_name));

  const onlyLocal = [...localSet].filter(t => !prodSet.has(t));
  const onlyProd = [...prodSet].filter(t => !localSet.has(t));

  return { onlyLocal, onlyProd };
}

function diffColumns(local, prod) {
  const localMap = Object.fromEntries(local.map(r => [colKey(r), r]));
  const prodMap = Object.fromEntries(prod.map(r => [colKey(r), r]));

  const onlyLocal = [];
  const onlyProd = [];
  const different = [];

  for (const key of Object.keys(localMap)) {
    if (!prodMap[key]) {
      onlyLocal.push(localMap[key]);
    } else {
      const l = localMap[key];
      const p = prodMap[key];
      if (l.data_type !== p.data_type || l.is_nullable !== p.is_nullable) {
        different.push({ key, local: colDetail(l), prod: colDetail(p) });
      }
    }
  }

  for (const key of Object.keys(prodMap)) {
    if (!localMap[key]) {
      onlyProd.push(prodMap[key]);
    }
  }

  return { onlyLocal, onlyProd, different };
}

function diffFunctions(local, prod) {
  const localSet = new Set(local.map(fnKey));
  const prodSet = new Set(prod.map(fnKey));

  const onlyLocal = [...local.map(fnKey)].filter(f => !prodSet.has(f));
  const onlyProd = [...prod.map(fnKey)].filter(f => !localSet.has(f));

  return { onlyLocal, onlyProd };
}

// ── Print ─────────────────────────────────────────────────────────────────────

function section(title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

function ok(msg) { console.log(`  ✅ ${msg}`); }
function warn(msg) { console.log(`  ⚠️  ${msg}`); }
function err(msg) { console.log(`  ❌ ${msg}`); }

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!PROD_DB_URL) {
    console.error('\n❌ Falta PROD_DB_URL. Agrégalo a tu .env:');
    console.error('   PROD_DB_URL=postgresql://postgres:[PASSWORD]@db.xexkttehzpxtviebglei.supabase.co:5432/postgres\n');
    process.exit(1);
  }

  console.log('🔌 Conectando a local y producción...');

  const local = postgres(LOCAL_DB_URL, { ssl: false, max: 1 });
  const prod  = postgres(PROD_DB_URL,  { ssl: 'require', max: 1 });

  try {
    const [
      localTables, prodTables,
      localCols,   prodCols,
      localFns,    prodFns,
    ] = await Promise.all([
      local.unsafe(TABLES_QUERY),
      prod.unsafe(TABLES_QUERY),
      local.unsafe(COLUMNS_QUERY),
      prod.unsafe(COLUMNS_QUERY),
      local.unsafe(FUNCTIONS_QUERY),
      prod.unsafe(FUNCTIONS_QUERY),
    ]);

    // ── Tables ────────────────────────────────────────────────────────────────
    section('TABLAS');
    const tables = diffTables(localTables, prodTables);
    if (tables.onlyLocal.length === 0 && tables.onlyProd.length === 0) {
      ok('Mismas tablas en ambos entornos');
    } else {
      tables.onlyLocal.forEach(t => warn(`Solo en LOCAL:   ${t}`));
      tables.onlyProd.forEach(t  => err(`Solo en PROD:    ${t}`));
    }

    // ── Columns ───────────────────────────────────────────────────────────────
    section('COLUMNAS');
    const cols = diffColumns(localCols, prodCols);

    if (cols.onlyLocal.length > 0) {
      console.log('\n  ⬇️  Columnas en LOCAL que NO están en PROD (hay que migrarlas):');
      cols.onlyLocal.forEach(c =>
        warn(`  ${c.table_name}.${c.column_name}  [${c.data_type}]`)
      );
    }

    if (cols.onlyProd.length > 0) {
      console.log('\n  ⬆️  Columnas en PROD que NO están en LOCAL (el código las usa pero el local no las tiene):');
      cols.onlyProd.forEach(c =>
        err(`  ${c.table_name}.${c.column_name}  [${c.data_type}]`)
      );
    }

    if (cols.different.length > 0) {
      console.log('\n  ⚡ Columnas con tipo o nullability DISTINTO:');
      cols.different.forEach(d => {
        console.log(`\n  • ${d.key}`);
        console.log(`      LOCAL: ${d.local}`);
        console.log(`      PROD:  ${d.prod}`);
      });
    }

    if (cols.onlyLocal.length === 0 && cols.onlyProd.length === 0 && cols.different.length === 0) {
      ok('Columnas idénticas en ambos entornos');
    }

    // ── Functions ─────────────────────────────────────────────────────────────
    section('FUNCIONES RPC');
    const fns = diffFunctions(localFns, prodFns);
    if (fns.onlyLocal.length > 0) {
      console.log('\n  ⬇️  Solo en LOCAL:');
      fns.onlyLocal.forEach(f => warn(`  ${f}`));
    }
    if (fns.onlyProd.length > 0) {
      console.log('\n  ⬆️  Solo en PROD:');
      fns.onlyProd.forEach(f => err(`  ${f}`));
    }
    if (fns.onlyLocal.length === 0 && fns.onlyProd.length === 0) {
      ok('Mismas funciones en ambos entornos');
    }

    // ── Focused check: columnas que causan los errores conocidos ──────────────
    section('DIAGNÓSTICO ESPECÍFICO (errores reportados)');
    const knownProblems = [
      { table: 'inventory', column: 'internal_note' },
      { table: 'inventory', column: 'sku_note' },
      { table: 'inventory', column: 'item_name' },
      { table: 'daily_inventory_snapshots', column: 'sku_note' },
      { table: 'daily_inventory_snapshots', column: 'item_name' },
      { table: 'daily_inventory_snapshots', column: 'internal_note' },
    ];

    const localColSet = new Set(localCols.map(colKey));
    const prodColSet  = new Set(prodCols.map(colKey));

    for (const { table, column } of knownProblems) {
      const key = `${table}.${column}`;
      const inLocal = localColSet.has(key);
      const inProd  = prodColSet.has(key);
      const status = inLocal && inProd ? '✅ AMBOS' :
                     inLocal           ? '⚠️  solo LOCAL' :
                     inProd            ? '❌ solo PROD' :
                                         '🚫 NINGUNO';
      console.log(`  ${status.padEnd(18)} → ${key}`);
    }

    // ── Migration SQL sugerido ────────────────────────────────────────────────
    if (cols.onlyLocal.length > 0 || cols.onlyProd.length > 0) {
      section('SQL SUGERIDO PARA SINCRONIZAR');

      if (cols.onlyLocal.length > 0) {
        console.log('\n  -- Agregar en PROD las columnas que solo están en LOCAL:');
        cols.onlyLocal.forEach(c => {
          const nullable = c.is_nullable === 'YES' ? '' : ' NOT NULL';
          const def = c.column_default ? ` DEFAULT ${c.column_default}` : '';
          console.log(`  ALTER TABLE public.${c.table_name} ADD COLUMN IF NOT EXISTS ${c.column_name} ${c.data_type}${nullable}${def};`);
        });
      }

      if (cols.onlyProd.length > 0) {
        console.log('\n  -- Agregar en LOCAL las columnas que solo están en PROD:');
        cols.onlyProd.forEach(c => {
          const nullable = c.is_nullable === 'YES' ? '' : ' NOT NULL';
          const def = c.column_default ? ` DEFAULT ${c.column_default}` : '';
          console.log(`  ALTER TABLE public.${c.table_name} ADD COLUMN IF NOT EXISTS ${c.column_name} ${c.data_type}${nullable}${def};`);
        });
      }
    }

    console.log('\n');

  } finally {
    await Promise.all([local.end(), prod.end()]);
  }
}

main().catch(e => {
  console.error('❌ Error fatal:', e.message);
  process.exit(1);
});
