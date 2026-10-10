import { describe, it, expect } from 'vitest';
import { reconcileCheckedKeys, type PalletLike } from '../reconcileCheckedKeys';

describe('reconcileCheckedKeys — conciliación segura de marcas por unidades (idea-261)', () => {
  // Caso real #881856: en ROW 43 hay 8× 03-3981GY, el plan pone 3 en la tarima 2 y 5 en la 3.
  const prev881856: PalletLike[] = [
    {
      id: 2,
      items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 3 }],
    },
    {
      id: 3,
      items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 5 }],
    },
  ];

  it('#881856: «3 → T2» marcado; nuevo reparto 4 + 4 → nada marcado de ese SKU y lost = 3 unidades', () => {
    // El picker marcó solo «3 → T2»
    const checked = new Set(['2-03-3981GY-ROW 43']);

    // Alguien guarda una tarima a mano y el reparto de ese SKU pasa a 4 y 4
    const next4Plus4: PalletLike[] = [
      {
        id: 2,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 4 }],
      },
      {
        id: 3,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 4 }],
      },
    ];

    const result = reconcileCheckedKeys(prev881856, next4Plus4, checked);

    // Ni 4 ni 4 caben en las 3 unidades tomadas sin pasarse -> nada marcado
    expect(result.keys).toEqual([]);
    expect(result.lost).toEqual([
      {
        sku: '03-3981GY',
        location: 'ROW 43',
        units: 3,
      },
    ]);
  });

  it('#881856: «3 → T2» marcado; nuevo reparto 3 (otro pallet id) + 5 → se marca la porción de 3', () => {
    const checked = new Set(['2-03-3981GY-ROW 43']);

    // El reparto mueve las 3 a la tarima 4 y las 5 a la tarima 5
    const next3Plus5: PalletLike[] = [
      {
        id: 4,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 3 }],
      },
      {
        id: 5,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 5 }],
      },
    ];

    const result = reconcileCheckedKeys(prev881856, next3Plus5, checked);

    expect(result.keys).toEqual(['4-03-3981GY-ROW 43']);
    expect(result.lost).toEqual([]);
  });

  it('todas las porciones marcadas, el reparto cambia → todas las nuevas marcadas, lost vacío', () => {
    const checked = new Set(['2-03-3981GY-ROW 43', '3-03-3981GY-ROW 43']);

    const next4Plus4: PalletLike[] = [
      {
        id: 1,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 4 }],
      },
      {
        id: 2,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 4 }],
      },
    ];

    const result = reconcileCheckedKeys(prev881856, next4Plus4, checked);

    expect(result.keys).toEqual(['1-03-3981GY-ROW 43', '2-03-3981GY-ROW 43']);
    expect(result.lost).toEqual([]);
  });

  it('ninguna marcada → nada cambia', () => {
    const checked = new Set<string>();

    const next: PalletLike[] = [
      {
        id: 2,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 4 }],
      },
      {
        id: 3,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 4 }],
      },
    ];

    const result = reconcileCheckedKeys(prev881856, next, checked);

    expect(result.keys).toEqual([]);
    expect(result.lost).toEqual([]);
  });

  it('un SKU sin partir (una porción) que cambia de tarima → la marca lo sigue', () => {
    const prev: PalletLike[] = [
      {
        id: 1,
        items: [{ sku: '01-0357', location: 'ROW 10', pickingQty: 2 }],
      },
    ];
    const checked = new Set(['1-01-0357-ROW 10']);

    const next: PalletLike[] = [
      {
        id: 2,
        items: [{ sku: '01-0357', location: 'ROW 10', pickingQty: 2 }],
      },
    ];

    const result = reconcileCheckedKeys(prev, next, checked);

    expect(result.keys).toEqual(['2-01-0357-ROW 10']);
    expect(result.lost).toEqual([]);
  });

  it('reparto idéntico (solo cambió una medida) → mismas llaves exactas, sin escritura', () => {
    const prev: PalletLike[] = [
      {
        id: 1,
        items: [{ sku: '01-0357', location: 'ROW 10', pickingQty: 2 }],
      },
      {
        id: 2,
        items: [{ sku: '02-0357', location: 'ROW 12', pickingQty: 5 }],
      },
    ];
    const checked = new Set(['1-01-0357-ROW 10']);

    // Mismo reparto de items y tarimas
    const next: PalletLike[] = [
      {
        id: 1,
        items: [{ sku: '01-0357', location: 'ROW 10', pickingQty: 2 }],
      },
      {
        id: 2,
        items: [{ sku: '02-0357', location: 'ROW 12', pickingQty: 5 }],
      },
    ];

    const result = reconcileCheckedKeys(prev, next, checked);

    expect(result.keys).toEqual(['1-01-0357-ROW 10']);
    expect(result.lost).toEqual([]);
  });

  it('dos SKUs distintos en la misma ubicación no se mezclan', () => {
    const prev: PalletLike[] = [
      {
        id: 1,
        items: [
          { sku: '03-3980BL', location: 'ROW 34', pickingQty: 5 },
          { sku: '03-3983GY', location: 'ROW 34', pickingQty: 5 },
        ],
      },
    ];
    // Solo se marcó el primero
    const checked = new Set(['1-03-3980BL-ROW 34']);

    const next: PalletLike[] = [
      {
        id: 2,
        items: [
          { sku: '03-3980BL', location: 'ROW 34', pickingQty: 5 },
          { sku: '03-3983GY', location: 'ROW 34', pickingQty: 5 },
        ],
      },
    ];

    const result = reconcileCheckedKeys(prev, next, checked);

    expect(result.keys).toEqual(['2-03-3980BL-ROW 34']);
    expect(result.lost).toEqual([]);
  });

  it('conserva primero las porciones con mismo pallet id y misma cantidad, luego ajusta lo restante', () => {
    const prev: PalletLike[] = [
      {
        id: 1,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 3 }],
      },
      {
        id: 2,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 5 }],
      },
    ];
    // Ambas tarimas marcadas
    const checked = new Set(['1-03-3981GY-ROW 43', '2-03-3981GY-ROW 43']);

    // Pallet 1 se mantiene con 3, pero Pallet 2 se divide en T2 (2) y T3 (3)
    const next: PalletLike[] = [
      {
        id: 1,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 3 }],
      },
      {
        id: 2,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 2 }],
      },
      {
        id: 3,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 3 }],
      },
    ];

    const result = reconcileCheckedKeys(prev, next, checked);

    // Como estaban todas marcadas, todas las nuevas quedan marcadas
    expect(result.keys).toEqual(['1-03-3981GY-ROW 43', '2-03-3981GY-ROW 43', '3-03-3981GY-ROW 43']);
    expect(result.lost).toEqual([]);
  });

  it('conserva porción idéntica cuando solo parte del SKU estaba marcado', () => {
    const prev: PalletLike[] = [
      {
        id: 1,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 3 }],
      },
      {
        id: 2,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 5 }],
      },
    ];
    // Solo T1 marcado (3 unidades de 8)
    const checked = new Set(['1-03-3981GY-ROW 43']);

    // Nuevo reparto: T1 sigue teniendo 3, T2 tiene 3, T3 tiene 2
    const next: PalletLike[] = [
      {
        id: 1,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 3 }],
      },
      {
        id: 2,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 3 }],
      },
      {
        id: 3,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 2 }],
      },
    ];

    const result = reconcileCheckedKeys(prev, next, checked);

    // T1 se conserva exacto en Paso 1 (mismo pallet id y misma qty = 3). Capacidad restante = 0.
    expect(result.keys).toEqual(['1-03-3981GY-ROW 43']);
    expect(result.lost).toEqual([]);
  });

  it('elige la combinación que más unidades conserve sin pasarse cuando las unidades cambian', () => {
    const prev: PalletLike[] = [
      {
        id: 1,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 5 }],
      },
      {
        id: 2,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 5 }],
      },
    ];
    // 5 de 10 marcadas (T1)
    const checked = new Set(['1-03-3981GY-ROW 43']);

    // Nuevo reparto: T3 (3), T4 (2), T5 (5)
    const next: PalletLike[] = [
      {
        id: 3,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 3 }],
      },
      {
        id: 4,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 2 }],
      },
      {
        id: 5,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 5 }],
      },
    ];

    const result = reconcileCheckedKeys(prev, next, checked);

    // T5 (5) o la combinación [T3 (3), T4 (2)] suman 5. T5 tiene 1 sola porción, por lo que es elegida
    // En ambos casos suma 5 unidades sin pasarse de 5
    expect(result.lost).toEqual([]);
    const totalPreservedUnits = result.keys.reduce((sum, k) => {
      const palletId = parseInt(k.split('-')[0], 10);
      const pallet = next.find((p) => p.id === palletId);
      const item = pallet?.items.find((i) => i.sku === '03-3981GY');
      return sum + (item?.pickingQty ?? 0);
    }, 0);
    expect(totalPreservedUnits).toBe(5);
  });

  it('marca de menos cuando no hay combinación exacta y reporta lost', () => {
    const prev: PalletLike[] = [
      {
        id: 1,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 3 }],
      },
      {
        id: 2,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 5 }],
      },
    ];
    // 3 unidades marcadas
    const checked = new Set(['1-03-3981GY-ROW 43']);

    // Nuevo reparto: T3 (2), T4 (6)
    const next: PalletLike[] = [
      {
        id: 3,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 2 }],
      },
      {
        id: 4,
        items: [{ sku: '03-3981GY', location: 'ROW 43', pickingQty: 6 }],
      },
    ];

    const result = reconcileCheckedKeys(prev, next, checked);

    // T3 (2) cabe en 3 sin pasarse. Queda 1 unidad sin cuadrar exacto.
    expect(result.keys).toEqual(['3-03-3981GY-ROW 43']);
    expect(result.lost).toEqual([
      {
        sku: '03-3981GY',
        location: 'ROW 43',
        units: 1,
      },
    ]);
  });

  it('maneja ubicación null correctamente', () => {
    const prev: PalletLike[] = [
      {
        id: 1,
        items: [{ sku: '12-2501', location: null, pickingQty: 2 }],
      },
    ];
    const checked = new Set(['1-12-2501-null']);

    const next: PalletLike[] = [
      {
        id: 2,
        items: [{ sku: '12-2501', location: null, pickingQty: 2 }],
      },
    ];

    const result = reconcileCheckedKeys(prev, next, checked);

    expect(result.keys).toEqual(['2-12-2501-null']);
    expect(result.lost).toEqual([]);
  });

  it('conserva llaves que no eran de ninguna porción vieja si siguen existiendo en el nuevo', () => {
    const prev: PalletLike[] = [
      {
        id: 1,
        items: [{ sku: '01-0357', location: 'ROW 10', pickingQty: 2 }],
      },
    ];
    // Key '2-02-0357-ROW 12' no pertenecía a prev
    const checked = new Set(['1-01-0357-ROW 10', '2-02-0357-ROW 12']);

    const next: PalletLike[] = [
      {
        id: 1,
        items: [{ sku: '01-0357', location: 'ROW 10', pickingQty: 2 }],
      },
      {
        id: 2,
        items: [{ sku: '02-0357', location: 'ROW 12', pickingQty: 3 }],
      },
    ];

    const result = reconcileCheckedKeys(prev, next, checked);

    expect(result.keys).toContain('1-01-0357-ROW 10');
    expect(result.keys).toContain('2-02-0357-ROW 12');
  });

  it('descarta llaves viejas que no pertenecían a prev y tampoco existen en next', () => {
    const prev: PalletLike[] = [
      {
        id: 1,
        items: [{ sku: '01-0357', location: 'ROW 10', pickingQty: 2 }],
      },
    ];
    const checked = new Set(['1-01-0357-ROW 10', '99-GHOST-UNKNOWN']);

    const next: PalletLike[] = [
      {
        id: 1,
        items: [{ sku: '01-0357', location: 'ROW 10', pickingQty: 2 }],
      },
    ];

    const result = reconcileCheckedKeys(prev, next, checked);

    expect(result.keys).toEqual(['1-01-0357-ROW 10']);
    expect(result.keys).not.toContain('99-GHOST-UNKNOWN');
  });

  it('acepta checkedKeys como array de strings', () => {
    const prev: PalletLike[] = [
      {
        id: 1,
        items: [{ sku: '01-0357', location: 'ROW 10', pickingQty: 2 }],
      },
    ];
    const checkedArray = ['1-01-0357-ROW 10'];

    const next: PalletLike[] = [
      {
        id: 2,
        items: [{ sku: '01-0357', location: 'ROW 10', pickingQty: 2 }],
      },
    ];

    const result = reconcileCheckedKeys(prev, next, checkedArray);

    expect(result.keys).toEqual(['2-01-0357-ROW 10']);
    expect(result.lost).toEqual([]);
  });
  it('todo marcado pero Edit Order subió la línea de 5 a 7 → no se marcan bicis que nadie tomó', () => {
    const prev: PalletLike[] = [
      { id: 1, items: [{ sku: '03-3980BL', location: 'ROW 34', pickingQty: 5 }] },
    ];
    const next: PalletLike[] = [
      { id: 1, items: [{ sku: '03-3980BL', location: 'ROW 34', pickingQty: 7 }] },
    ];

    const result = reconcileCheckedKeys(prev, next, new Set(['1-03-3980BL-ROW 34']));

    expect(result.keys).toEqual([]);
    expect(result.lost).toEqual([{ sku: '03-3980BL', location: 'ROW 34', units: 5 }]);
  });

  it('la llave es la misma que escribe Double Check, también con ubicación undefined', () => {
    const prev: PalletLike[] = [{ id: 1, items: [{ sku: '12-2501', pickingQty: 2 }] }];
    const next: PalletLike[] = [{ id: 2, items: [{ sku: '12-2501', pickingQty: 2 }] }];

    const result = reconcileCheckedKeys(prev, next, new Set(['1-12-2501-undefined']));

    expect(result.keys).toEqual(['2-12-2501-undefined']);
    expect(result.lost).toEqual([]);
  });
  it('dos renglones con la misma llave en una tarima cuentan juntos (5 a mano + 3 y 7 en la 2)', () => {
    // Caso local TEST-261: 15 en 8 + 7; se marca la de 8 y se arma la 1 a mano con 5.
    const prev: PalletLike[] = [
      { id: 1, items: [{ sku: '03-3978BL', location: 'ROW 42', pickingQty: 8 }] },
      { id: 2, items: [{ sku: '03-3978BL', location: 'ROW 42', pickingQty: 7 }] },
    ];
    const next: PalletLike[] = [
      { id: 1, items: [{ sku: '03-3978BL', location: 'ROW 42', pickingQty: 5 }] },
      {
        id: 2,
        items: [
          { sku: '03-3978BL', location: 'ROW 42', pickingQty: 3 },
          { sku: '03-3978BL', location: 'ROW 42', pickingQty: 7 },
        ],
      },
    ];

    const result = reconcileCheckedKeys(prev, next, new Set(['1-03-3978BL-ROW 42']));

    expect(result.keys).toEqual(['1-03-3978BL-ROW 42']);
    expect(result.lost).toEqual([{ sku: '03-3978BL', location: 'ROW 42', units: 3 }]);
  });
});
