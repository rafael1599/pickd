import { describe, expect, it } from 'vitest';
import {
  areNeighbours,
  lookalikesNear,
  neighbourLocations,
  photoSuspects,
  skuDiffPositions,
} from '../lookalikeSkus';

describe('skuDiffPositions', () => {
  it('#881828: 03-4537GY y 03-4547MN — un dígito y el color', () => {
    expect(skuDiffPositions('03-4537GY', '03-4547MN')).toEqual([5, 7, 8]);
  });

  it('03-3855GY y 03-3955GN', () => {
    expect(skuDiffPositions('03-3855GY', '03-3955GN')).toEqual([4, 8]);
  });

  it('dos dígitos vecinos cambiados de lugar', () => {
    expect(skuDiffPositions('03-4537GY', '03-4573GY')).toEqual([5, 6]);
  });

  it('el caso de siempre: el mismo número con otro color o otra línea', () => {
    expect(skuDiffPositions('03-4614BK', '03-4614GY')).toEqual([7, 8]);
    expect(skuDiffPositions('01-3744BK', '03-3744BK')).toEqual([1]);
  });

  it('03-4637MN, en la misma ROW 2 que la 03-4537GY, también', () => {
    expect(skuDiffPositions('03-4537GY', '03-4637MN')).toEqual([4, 7, 8]);
  });

  it('no se parecen: dos dígitos sueltos, el mismo SKU, o no es de bici', () => {
    expect(skuDiffPositions('03-4537GY', '03-4647GY')).toBeNull();
    expect(skuDiffPositions('03-4537GY', '03-4537gy')).toBeNull();
    expect(skuDiffPositions('98-857', '98-858')).toBeNull();
  });
});

describe('areNeighbours / neighbourLocations', () => {
  const walk = ['ROW 10', 'ROW 9', 'ROW 8', 'ROW 14'];
  it('la misma fila, la de número vecino o la siguiente del recorrido', () => {
    expect(areNeighbours('ROW 2', 'ROW 3')).toBe(true);
    expect(areNeighbours('ROW 2', 'ROW 2')).toBe(true);
    expect(areNeighbours('ROW 8', 'ROW 14', walk)).toBe(true);
    expect(areNeighbours('ROW 2', 'ROW 4')).toBe(false);
  });
  it('pide el stock de ella y sus vecinas', () => {
    expect(neighbourLocations('ROW 8', walk).sort()).toEqual(
      ['ROW 14', 'ROW 7', 'ROW 8', 'ROW 9'].sort()
    );
  });
});

describe('lookalikesNear', () => {
  it('#881828: avisa por la 03-4547MN de ROW 3, no por una lejos', () => {
    const map = lookalikesNear(
      [{ sku: '03-4537GY', location: 'ROW 2', warehouse: 'LUDLOW' }],
      [
        { sku: '03-4547MN', location: 'ROW 3', warehouse: 'LUDLOW' },
        { sku: '03-4538GY', location: 'ROW 30', warehouse: 'LUDLOW' },
        { sku: '03-4537GY', location: 'ROW 2', warehouse: 'LUDLOW' },
      ]
    );
    expect(map.get('03-4537GY')?.near).toEqual([{ sku: '03-4547MN', location: 'ROW 3' }]);
    expect([...(map.get('03-4537GY')?.positions ?? [])].sort()).toEqual([5, 7, 8]);
  });
});

describe('photoSuspects', () => {
  it('#881828: la foto leyó dos 03-4547MN, la orden pide 03-4537GY', () => {
    const map = photoSuspects(
      [null, '03-4547MN', '03-4547MN', '03-3927BK'],
      ['03-4537GY', '03-3927BK', '03-3922BL']
    );
    expect(map.get('03-4537GY')).toEqual([
      { readSku: '03-4547MN', count: 2, positions: [5, 7, 8] },
    ]);
    expect(map.size).toBe(1);
  });
});
