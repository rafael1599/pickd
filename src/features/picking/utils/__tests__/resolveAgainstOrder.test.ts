import { describe, expect, it } from 'vitest';
import { resolveAgainstOrder, skuKey } from '../resolveAgainstOrder';

// Los diez errores de la sombra del 28 sep 2026, con la orden de cada foto.
const TAXI = ['03-4040BK', '06-4519BK', '06-4523BK', '06-4524KW', '06-4588BL', '06-4590BL'];
const CITIZEN = ['03-3979GY', '03-3986TL', '03-3988TL', '03-3989GY', '03-3990TL'];
const WILMETTE = ['03-3921BK', '03-3922BL', '03-4703GY', '03-4704GY', '03-4707GY', '03-4709BR'];
const MIX = ['03-3740BK', '03-3768BL', '03-3777RD', '03-3778BK', '07-3744BL'];
const CATALOG = new Set(
  [...TAXI, ...CITIZEN, ...WILMETTE, ...MIX, '03-3982BL', '03-3980BL', '70-1410P'].map(skuKey)
);
const inCatalog = CATALOG;

describe('resolveAgainstOrder — los casos reales del 28 sep', () => {
  it.each([
    ['06-4588B', TAXI, '06-4588BL', 'truncated'],
    ['06-4524K', TAXI, '06-4524KW', 'truncated'],
    ['03-3979G', CITIZEN, '03-3979GY', 'truncated'],
    ['03-4707Y', WILMETTE, '03-4707GY', 'one_char'],
    ['CONFLICTO: 90-7290A ≠ 06-4590BL', TAXI, '06-4590BL', 'conflict'],
    ['CONFLICTO: 03-4704GY ≠ 70-1410P', WILMETTE, '03-4704GY', 'conflict'],
    ['CONFLICTO: 84-5436AE ≠ 03-3777RD', MIX, '03-3777RD', 'conflict'],
    ['CONFLICTO: 27-0040C ≠ 03-3921B', WILMETTE, '03-3921BK', 'truncated'],
  ])('%s → %s', (read, order, sku, how) => {
    expect(resolveAgainstOrder(read, order, inCatalog)).toEqual({ sku, how });
  });

  it('la basura no se resuelve', () => {
    expect(resolveAgainstOrder('14-0021O', WILMETTE, inCatalog)).toBeNull();
  });

  it('una lectura exacta es exacta, venga escrita como venga', () => {
    expect(resolveAgainstOrder('064588BL', TAXI, inCatalog)).toEqual({
      sku: '06-4588BL',
      how: 'exact',
    });
  });
});

describe('resolveAgainstOrder — nunca un verde falso', () => {
  it('una lectura que es otra bici real no se hace pasar por la de la orden', () => {
    // El picker puso 03-3980BL; la orden pide 03-3982BL. Un dígito, pero existe.
    expect(resolveAgainstOrder('03-3980BL', ['03-3982BL'], inCatalog)).toBeNull();
  });

  it('03-3902BL no se resuelve: está a un carácter de 03-3982BL (orden) y de 03-3922BL (catálogo)', () => {
    expect(resolveAgainstOrder('03-3902BL', ['03-3982BL', '03-4705GY'], inCatalog)).toBeNull();
  });

  it('03-3902BL por 03-3982BL sí se resuelve si ninguna otra bici del catálogo está a un carácter', () => {
    const cat = new Set([...CATALOG].filter((k) => k !== skuKey('03-3922BL')));
    expect(resolveAgainstOrder('03-3902BL', ['03-3982BL', '03-4705GY'], cat)).toEqual({
      sku: '03-3982BL',
      how: 'one_char',
    });
  });

  it('con dos candidatos posibles en la orden no se elige', () => {
    // 03-3988T puede ser 03-3988TL… y una hermana 03-3988TK si la orden la tuviera.
    expect(
      resolveAgainstOrder('03-3988T', ['03-3988TL', '03-3988TK'], new Set<string>())
    ).toBeNull();
  });

  it('sin catálogo sólo resuelve lo exacto', () => {
    expect(resolveAgainstOrder('06-4588B', TAXI)).toBeNull();
    expect(resolveAgainstOrder('06-4588BL', TAXI)).toEqual({ sku: '06-4588BL', how: 'exact' });
  });

  it('sin orden no hay nada contra qué resolver', () => {
    expect(resolveAgainstOrder('06-4588BL', [], inCatalog)).toBeNull();
    expect(resolveAgainstOrder(null, TAXI, inCatalog)).toBeNull();
  });
});

describe('resolveAgainstOrder — una hermana de color en el catálogo (leave-true-out, 30 sep 2026)', () => {
  const cat = new Set(
    ['03-4710BL', '03-4710BR', '03-3843BL', '03-3843BR', '03-3990TL'].map(skuKey)
  );

  it('«03-4710BA» no es la BL de la orden: también podría ser la BR del catálogo', () => {
    expect(resolveAgainstOrder('03-4710BA', ['03-4710BL', '03-3990TL'], cat)).toBeNull();
  });

  it('un color cortado no se completa con el de la orden si hay otro color en el catálogo', () => {
    expect(resolveAgainstOrder('03-3843', ['03-3843BR', '03-3990TL'], cat)).toBeNull();
  });

  it('sin rival en el catálogo sigue resolviendo', () => {
    expect(resolveAgainstOrder('03-3990T', ['03-4710BL', '03-3990TL'], cat)).toEqual({
      sku: '03-3990TL',
      how: 'truncated',
    });
  });
});
