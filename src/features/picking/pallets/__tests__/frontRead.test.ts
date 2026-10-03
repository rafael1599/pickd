import { describe, expect, it } from 'vitest';
import { FRONT_MIN_LABELS, LABEL_SHORT_IN, readFront, type FrontLabel } from '../frontRead';

type Pt = [number, number];

/**
 * Una etiqueta en la cara, en pulgadas (x a la derecha, y hacia arriba), vista
 * por una cámara: `k` px por pulgada que crece hacia abajo (perspectiva), la
 * foto girada `rot` radianes. Esquinas en orden de lectura de la etiqueta
 * enderezada; `upright` = derecha (caja de pie), si no tumbada (acostada).
 */
function label(
  sku: string,
  x: number,
  y: number,
  upright = true,
  rot = 0,
  flip = false
): FrontLabel {
  const w = LABEL_SHORT_IN;
  const h = 8.8;
  const k = (yy: number) => 40 * (1 + (40 - yy) * 0.004);
  const toPx = ([u, v]: Pt): Pt => {
    const px = u * k(v);
    const py = (60 - v) * k(v);
    return [
      px * Math.cos(rot) - py * Math.sin(rot) + 2000,
      px * Math.sin(rot) + py * Math.cos(rot) + 500,
    ];
  };
  // En la cara: derecha → arriba-izq, arriba-der, abajo-der, abajo-izq.
  let face: Pt[] = upright
    ? [
        [x - w / 2, y + h / 2],
        [x + w / 2, y + h / 2],
        [x + w / 2, y - h / 2],
        [x - w / 2, y - h / 2],
      ]
    : // Tumbada: el lado largo a lo ancho; su «arriba» mira a la derecha.
      [
        [x + h / 2, y + w / 2],
        [x + h / 2, y - w / 2],
        [x - h / 2, y - w / 2],
        [x - h / 2, y + w / 2],
      ];
  if (flip) face = [face[2], face[3], face[0], face[1]];
  return { sku, corners: face.map(toPx) };
}

describe('readFront', () => {
  const scene = (rot = 0) => [
    label('A', 0, 20, true, rot),
    label('B', 8.5, 21, true, rot),
    label('C', 17, 19, true, rot),
    label('D', 25.5, 20, true, rot),
    label('E', 2, 52, true, rot),
    label('F', 11, 51, true, rot),
    label('G', 20, 53, true, rot),
    label('H', 12, 70, false, rot),
  ];

  it('dos niveles de pie y una acostada encima, en orden de izquierda a derecha', () => {
    const f = readFront(scene());
    expect(f.isFront).toBe(true);
    const at = (lv: number | null) => f.boxes.filter((b) => b.level === lv).map((b) => b.sku);
    expect(at(0)).toEqual(['A', 'B', 'C', 'D']);
    expect(at(1)).toEqual(['E', 'F', 'G']);
    expect(at(null)).toEqual(['H']);
    expect(f.boxes.find((b) => b.sku === 'H')!.upright).toBe(false);
  });

  it('la separación entre vecinas sale en pulgadas: ~8,5" (el grueso de una caja)', () => {
    const f = readFront(scene());
    const row = f.boxes.filter((b) => b.level === 0);
    for (let i = 1; i < row.length; i += 1) {
      expect(row[i].x_in - row[i - 1].x_in).toBeGreaterThan(7.5);
      expect(row[i].x_in - row[i - 1].x_in).toBeLessThan(9.5);
    }
    expect(f.fitRmsIn!).toBeLessThan(0.3);
  });

  it('con la foto girada 15° sale lo mismo', () => {
    const f = readFront(scene(0.26));
    expect(f.boxes.filter((b) => b.level === 0).map((b) => b.sku)).toEqual(['A', 'B', 'C', 'D']);
    expect(f.boxes.filter((b) => b.level === 1).map((b) => b.sku)).toEqual(['E', 'F', 'G']);
  });

  it('una etiqueta pegada boca abajo no da la vuelta a la cara', () => {
    const labels = scene();
    labels[1] = label('B', 8.5, 21, true, 0, true);
    const f = readFront(labels);
    expect(f.boxes.filter((b) => b.level === 0).map((b) => b.sku)).toEqual(['A', 'B', 'C', 'D']);
  });

  it(`con menos de ${FRONT_MIN_LABELS} etiquetas es un acercamiento; las que no tienen SKU o esquinas no cuentan`, () => {
    const f = readFront([
      label('A', 0, 20),
      label('B', 8.5, 20),
      label('C', 17, 20),
      { sku: null, corners: label('X', 25, 20).corners },
      { sku: 'Y', corners: null },
    ]);
    expect(f.isFront).toBe(false);
    expect(f.skipped).toBe(2);
    expect(f.boxes).toHaveLength(3);
  });

  // Frente real del 30 sep 2026 (foto 547ced7f): arriba, de izquierda a
  // derecha, 07-3689WH, 78-0696 (etiqueta boca abajo) y 03-4537MN; abajo
  // 03-4585BL y 03-4618GN. Las otras tres etiquetas no se leyeron.
  it('el frente real de dos niveles, con una etiqueta boca abajo', () => {
    const f = readFront([
      {
        sku: '03-4537MN',
        corners: [
          [1382, 1069],
          [1519, 1063],
          [1497, 1486],
          [1375, 1504],
        ],
      },
      {
        sku: '78-0696',
        corners: [
          [1119, 1521],
          [966, 1551],
          [945, 1248],
          [1107, 1224],
        ],
      },
      {
        sku: null,
        corners: [
          [1723, 1218],
          [1836, 1227],
          [1806, 1636],
          [1692, 1627],
        ],
      },
      {
        sku: '07-3689WH',
        corners: [
          [312, 1356],
          [516, 1332],
          [543, 1650],
          [348, 1683],
        ],
      },
      {
        sku: '03-4618GN',
        corners: [
          [991, 2630],
          [1130, 2575],
          [1155, 2831],
          [1034, 2901],
        ],
      },
      {
        sku: '03-4585BL',
        corners: [
          [486, 2880],
          [657, 2811],
          [687, 3099],
          [531, 3177],
        ],
      },
    ]);
    expect(f.isFront).toBe(true);
    expect(f.boxes.filter((b) => b.level === 0).map((b) => b.sku)).toEqual([
      '03-4585BL',
      '03-4618GN',
    ]);
    expect(f.boxes.filter((b) => b.level === 1).map((b) => b.sku)).toEqual([
      '07-3689WH',
      '78-0696',
      '03-4537MN',
    ]);
    expect(f.boxes.every((b) => b.upright)).toBe(true);
  });
});
