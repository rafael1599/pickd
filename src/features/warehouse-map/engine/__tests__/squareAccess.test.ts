// row_squares in the database is a copy of the engine's accessible squares
// (idea-253). If the map changes, this fails and prints the rows to seed.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { squareAccessRows } from '../squareAccess';
import { parseEngineState } from '../../hooks/useZoneState';

const MIGRATIONS = join(process.cwd(), 'supabase/migrations');

function seededRows(): string[] {
  const file = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .reverse()
    .find((f) =>
      readFileSync(join(MIGRATIONS, f), 'utf8').includes('INSERT INTO public.row_squares')
    );
  const sql = readFileSync(join(MIGRATIONS, file!), 'utf8');
  return [...sql.matchAll(/\('(ROW \d+)','([A-Z])',(true|false)\)/g)].map(
    (m) => `${m[1]}|${m[2]}|${m[3]}`
  );
}

describe('squareAccess', () => {
  const rows = squareAccessRows((config) => parseEngineState(new URLSearchParams(), config));

  it('the database copy matches the engine', () => {
    const engine = rows.map((r) => `${r.location}|${r.letter}|${r.isFast}`);
    const values = rows.map((r) => `('${r.location}','${r.letter}',${r.isFast})`).join(', ');
    expect(seededRows(), `row_squares drifted from the map; seed:\n${values}`).toEqual(engine);
  });

  it('buries only the middle rows of a block', () => {
    const buried = rows.filter((r) => !r.isFast);
    expect(buried).toHaveLength(64);
    expect([...new Set(buried.map((r) => r.location))]).toEqual([
      'ROW 14',
      'ROW 21',
      'ROW 24',
      'ROW 27',
      'ROW 28',
      'ROW 31',
      'ROW 32',
      'ROW 37',
    ]);
    // ROW 31: A and K face the open floor, B–J are behind them.
    expect(rows.filter((r) => r.location === 'ROW 31' && r.isFast).map((r) => r.letter)).toEqual([
      'A',
      'K',
    ]);
  });
});
