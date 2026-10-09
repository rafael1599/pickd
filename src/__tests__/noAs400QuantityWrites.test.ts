import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Decisión de Rafael (9 oct 2026): «AS400 no es la verdad absoluta y no debe usarse para
 * reconciliar». Un script que lee el AS400 señala (lista de recount, idea-263); nunca escribe
 * cantidades. Ver .claude/rules/as400.md («El AS400 no reconcilia el inventario»).
 */
const MESSAGE =
  'Rafael, 9 oct 2026: el AS400 no reconcilia el inventario; lo que no cuadra se cuenta en el piso. Ver .claude/rules/as400.md (“El AS400 no reconcilia el inventario”).';

const QUANTITY_WRITE =
  /adjust_inventory_quantity\s*\(|update\s+(public\.)?inventory\s+set[\s\S]{0,200}?\bquantity\b/i;

export function findAs400QuantityWrites(source: string): number[] {
  if (!/as400/i.test(source)) return [];
  const lines: number[] = [];
  source.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|--)/.test(line)) return;
    if (QUANTITY_WRITE.test(line)) lines.push(i + 1);
  });
  return lines;
}

describe('el AS400 no escribe cantidades (Rafael, 9 oct 2026)', () => {
  it('ningún script que lee el AS400 escribe cantidades', () => {
    const dir = join(__dirname, '..', '..', 'scripts');
    const hits = readdirSync(dir)
      .filter((f) => /\.(m?js|ts|sql)$/.test(f))
      .flatMap((f) =>
        findAs400QuantityWrites(readFileSync(join(dir, f), 'utf8')).map((l) => `scripts/${f}:${l}`)
      );
    expect(hits, `${MESSAGE} (${hits.join(', ')})`).toEqual([]);
  });

  it('el detector dispara con una escritura y calla sin ella', () => {
    expect(
      findAs400QuantityWrites(
        "// as400\nawait sql`select adjust_inventory_quantity(${sku}, 'LUDLOW')`"
      )
    ).toEqual([2]);
    expect(findAs400QuantityWrites('// as400\nupdate inventory set quantity = 3')).toEqual([2]);
    expect(
      findAs400QuantityWrites('// as400 solo lee\nselect * from v_inventory_vs_as400')
    ).toEqual([]);
    expect(findAs400QuantityWrites('adjust_inventory_quantity(x)')).toEqual([]);
  });
});
