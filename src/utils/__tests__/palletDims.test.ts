import { describe, it, expect } from 'vitest';
import {
  estimatePallet,
  boxesPerLevel,
  dimensionSource,
  effectivePalletSize,
  formatPalletSize,
  palletSizeForClipboard,
  sanitizeInches,
  DECK_WIDTH_IN,
  type PalletBoxMeta,
  type PalletDimsEntry,
  type PalletLine,
} from '../palletDims';

/** Una bici sobre los defaults del trigger: 55 × 8.5 × 30.5, 45 lb, sin medir. */
const DEFAULT_BIKE: PalletBoxMeta = {};
const measured = (over: Partial<PalletBoxMeta>): PalletBoxMeta => ({
  length_in: 55,
  width_in: 8.5,
  height_in: 30.5,
  weight_lbs: 45,
  dimensions_verified: true,
  ...over,
});

/** Un pallet de n bicis idénticas, todas sobre los defaults. */
const defaultPallet = (n: number) =>
  estimatePallet([{ sku: '03-0001BK', pickingQty: n }], () => DEFAULT_BIKE);

/** Cajas distintas, cada una en su línea, en el orden en que se recogen. */
const inOrder = (boxes: PalletBoxMeta[]) => {
  const lines: PalletLine[] = boxes.map((_, i) => ({ sku: `SKU-${i}`, pickingQty: 1 }));
  const bySku = new Map(boxes.map((box, i) => [`SKU-${i}`, box]));
  return estimatePallet(lines, (sku) => bySku.get(sku));
};

describe('estimatePallet — los tamaños que arma el almacén', () => {
  // La tabla que Rafael validó el 22 sep 2026. 8 / 10 / 12 son las capacidades
  // que calculatePallets ya usaba: esta geometría es de dónde salieron.
  it.each([
    [8, { levels: 2, flat: 0 }, { length: 55, width: 40, height: 66 }, 400],
    [9, { levels: 2, flat: 1 }, { length: 55, width: 40, height: 74.5 }, 445],
    [10, { levels: 2, flat: 2 }, { length: 55, width: 40, height: 83 }, 490],
    [11, { levels: 2, flat: 1 }, { length: 55, width: 42.5, height: 74.5 }, 535],
    [12, { levels: 2, flat: 2 }, { length: 55, width: 42.5, height: 83 }, 580],
  ])('%i bicis por default', (n, armado, size, lbs) => {
    const e = defaultPallet(n)!;
    expect({ levels: e.levels, flat: e.flat }).toEqual(armado);
    expect({ length: e.length, width: e.width, height: e.height }).toEqual(size);
    expect(e.weightLbs).toBe(lbs);
  });

  it('cuatro por nivel hasta diez, cinco de once en adelante', () => {
    expect(boxesPerLevel(10)).toBe(4);
    expect(boxesPerLevel(11)).toBe(5);
    expect(defaultPallet(10)!.perLevel).toBe(4);
    expect(defaultPallet(12)!.perLevel).toBe(5);
  });

  it('un solo nivel cuando no llega a llenar dos', () => {
    const e = defaultPallet(4)!;
    expect(e.levels).toBe(1);
    expect(e.flat).toBe(0);
    expect(e.height).toBe(35.5); // 30.5 de canto + 5 de tarima
  });
});

describe('estimatePallet — el orden de recogida decide el armado', () => {
  // Nueve cajas: la PRIMERA es ancha. Lo que se acuesta encima es la ÚLTIMA
  // recogida, no la más ancha — si se eligiera «la más ancha» el alto daría
  // 86 en vez de 74.5, y el ancho del nivel sería 34 en vez de 45.5.
  const nueve = [measured({ width_in: 20 }), ...Array(8).fill(measured({}))];

  it('acuesta las últimas, no las mayores', () => {
    const e = inOrder(nueve)!;
    expect(e.flat).toBe(1);
    expect(e.height).toBe(74.5); // 30.5 + 30.5 + 8.5 acostada + 5
  });

  it('el ancho es el del nivel más ancho', () => {
    // nivel 1 = 20 + 8.5 + 8.5 + 8.5 = 45.5 · nivel 2 = 4 × 8.5 = 34
    expect(inOrder(nueve)!.width).toBe(45.5);
  });

  it('el alto de un nivel lo manda su caja más alta', () => {
    const e = inOrder([
      measured({ height_in: 40 }),
      ...Array(3).fill(measured({})),
      ...Array(4).fill(measured({})),
    ])!;
    expect(e.height).toBe(75.5); // 40 del nivel 1 + 30.5 del nivel 2 + 5
  });

  it('una línea de tres bicis son tres cajas, no una', () => {
    const e = estimatePallet([{ sku: '03-0001BK', pickingQty: 3 }], () => DEFAULT_BIKE)!;
    expect(e.boxes).toBe(3);
  });
});

describe('estimatePallet — la tarima', () => {
  it('el bulto nunca es más chico que el deck', () => {
    // Cuatro cajas de canto suman 34", pero se apoyan en 48 × 40.
    const e = defaultPallet(4)!;
    expect(e.width).toBe(DECK_WIDTH_IN);
    expect(e.length).toBe(55); // la bici vuela 7" sobre los 48 del deck
  });

  it('una caja más corta que el deck no encoge el bulto', () => {
    const e = inOrder([measured({ length_in: 30 })])!;
    expect(e.length).toBe(48);
  });

  it('suma 5 pulgadas y 40 libras, una vez', () => {
    const e = defaultPallet(1)!;
    expect(e.height).toBe(35.5);
    expect(e.weightLbs).toBe(85); // 45 de la bici + 40 de la tarima
  });
});

describe('estimatePallet — la e-bike ocupa sitio y cuenta, pero no pesa', () => {
  // Rafael, 22 sep 2026: "de las e-bike sólo quiero tomar el peso, las
  // dimensiones que se queden en la pallet a la que pertenece". Su caja está
  // apilada ahí y hace el bulto más alto; su peso va al cartón aparte, igual que
  // el WEIGHT de Ship ya la excluye. 24 sep 2026 (orden 881701): como bici sí
  // cuenta — «9 bikes / 339 lb + carton 108.5».
  const conEbike = () =>
    estimatePallet(
      [
        { sku: '03-0001BK', pickingQty: 8 },
        { sku: '03-3604BL', pickingQty: 1, isElectric: true },
      ],
      () => DEFAULT_BIKE
    )!;

  it('su caja entra en la geometría', () => {
    // 9 cajas: 4+4 de canto y una echada encima, que el pallet de 8 no tenía.
    expect(conEbike()).toMatchObject({ boxes: 9, flat: 1, height: 74.5 });
    expect(defaultPallet(8)!.height).toBe(66);
  });

  it('su peso no', () => {
    // 8 bicis × 45 + 40 de tarima: la novena no pesa aquí.
    expect(conEbike().weightLbs).toBe(400);
  });

  it('pero sí cuenta como bici', () => {
    expect(conEbike().bikes).toBe(9);
  });

  it('un bulto de sólo eléctricas no es un bulto', () => {
    expect(estimatePallet([], () => DEFAULT_BIKE)).toBeNull();
    expect(
      estimatePallet([{ sku: '03-3604BL', pickingQty: 1, isElectric: true }], () => DEFAULT_BIKE)
    ).toBeNull();
  });
});

describe('estimatePallet — con cajas sin medir', () => {
  it('estima igual y dice cuántas faltan', () => {
    const e = inOrder([measured({}), measured({}), DEFAULT_BIKE, DEFAULT_BIKE])!;
    expect(e.unmeasured).toBe(2);
    expect(e.height).toBeGreaterThan(0);
  });

  it('cero cuando el pallet entero está medido', () => {
    expect(inOrder([measured({}), measured({})])!.unmeasured).toBe(0);
  });
});

describe('sanitizeInches — lo que se deja teclear', () => {
  it('vacío es «nadie midió», no cero', () => {
    expect(sanitizeInches('')).toBeNull();
    expect(sanitizeInches('   ')).toBeNull();
    expect(sanitizeInches(null)).toBeNull();
  });

  it('acepta enteros y un decimal', () => {
    expect(sanitizeInches('48')).toBe(48);
    expect(sanitizeInches('42.5')).toBe(42.5);
    expect(sanitizeInches('42.5.7')).toBe(42.57); // el segundo punto se cae
  });

  it('limpia lo que no es número', () => {
    expect(sanitizeInches('48 in')).toBe(48);
    expect(sanitizeInches('48"')).toBe(48);
  });

  // El caso real de 03-4046MN: 8.75 tecleado 875. Tres caracteres, así que un
  // chequeo de ancho de campo lo deja pasar tal cual al portal.
  it('rechaza el decimal perdido', () => {
    expect(sanitizeInches('875')).toBeNull();
    expect(sanitizeInches('0')).toBeNull();
  });
});

describe('dimensionSource — de dónde salió la cifra', () => {
  const entry = (over: Partial<PalletDimsEntry> = {}): PalletDimsEntry => ({
    pallet: 1,
    length_in: null,
    width_in: null,
    height_in: null,
    units: 12,
    ...over,
  });

  it('sin nada tecleado es calculada', () => {
    expect(dimensionSource(entry())).toBe('computed');
    expect(dimensionSource(null)).toBe('computed');
  });

  it('sólo el alto es parcial, y se guarda', () => {
    expect(dimensionSource(entry({ height_in: 80 }))).toBe('partial');
  });

  it('los tres tecleados es manual', () => {
    expect(dimensionSource(entry({ length_in: 55, width_in: 43, height_in: 80 }))).toBe('manual');
  });
});

describe('effectivePalletSize — lo tecleado manda, lo que falta lo pone el cálculo', () => {
  const estimate = defaultPallet(12)!;
  const base: PalletDimsEntry = {
    pallet: 1,
    length_in: null,
    width_in: null,
    height_in: null,
    units: 12,
  };

  it('sin entrada, la estimación entera', () => {
    const size = effectivePalletSize(null, estimate, 12)!;
    expect(size).toMatchObject({ length: 55, width: 42.5, height: 83, source: 'computed' });
  });

  it('el alto tecleado pisa al calculado y deja el resto', () => {
    const size = effectivePalletSize({ ...base, height_in: 74 }, estimate, 12)!;
    expect(size).toMatchObject({ length: 55, width: 42.5, height: 74, source: 'partial' });
  });

  it('sin estimación ni medida no hay bulto que declarar', () => {
    expect(effectivePalletSize(base, null, 12)).toBeNull();
  });

  it('una medida tomada con otras unidades queda marcada, no borrada', () => {
    const size = effectivePalletSize({ ...base, height_in: 74, units: 12 }, estimate, 10)!;
    expect(size.stale).toBe(true);
    expect(size.height).toBe(74);
  });

  it('una entrada sin nada tecleado nunca está vencida', () => {
    expect(effectivePalletSize(base, estimate, 8)!.stale).toBe(false);
  });
});

describe('formatPalletSize — nunca más chico de lo que es', () => {
  it('redondea hacia arriba', () => {
    expect(formatPalletSize({ length: 55, width: 42.5, height: 83 })).toBe('55×43×83');
  });

  it('el portapapeles va en ASCII', () => {
    expect(palletSizeForClipboard({ length: 55, width: 42.5, height: 83 })).toBe('55x43x83');
  });
});
