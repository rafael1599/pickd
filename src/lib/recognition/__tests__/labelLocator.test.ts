import { describe, it, expect } from 'vitest';
import {
  approxClosed,
  homography,
  applyH,
  locateLabels,
  minAreaRect,
  orderQuad,
  quadIoU,
  rectifyLabel,
  type Pt,
  type Rgba,
} from '../labelLocator';

/** Cartón marrón con una etiqueta blanca girada: dos franjas negras, un código de barras y texto. */
function scene(
  W: number,
  H: number,
  cx: number,
  cy: number,
  w: number,
  h: number,
  deg: number
): { img: Rgba; quad: Pt[] } {
  const data = new Uint8ClampedArray(W * H * 4);
  const th = (deg * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const u = dx * c + dy * s + w / 2;
      const v = -dx * s + dy * c + h / 2;
      let rgb = [184, 154, 118];
      if (u >= 0 && u < w && v >= 0 && v < h) {
        rgb = [245, 245, 242];
        const fv = v / h;
        const fu = u / w;
        if (fu > 0.06 && fu < 0.9 && ((fv > 0.1 && fv < 0.17) || (fv > 0.4 && fv < 0.48)))
          rgb = [20, 20, 20];
        if (fu > 0.06 && fu < 0.7 && fv > 0.55 && fv < 0.65 && Math.floor(u / 3) % 2 === 0)
          rgb = [15, 15, 15];
        if (
          fu > 0.06 &&
          fu < 0.5 &&
          fv > 0.72 &&
          fv < 0.9 &&
          Math.floor(v / 6) % 2 === 0 &&
          Math.floor(u / 5) % 3 !== 0
        )
          rgb = [30, 30, 30];
      }
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = 255;
    }
  const corner = (u: number, v: number): Pt => [
    cx + (u - w / 2) * c - (v - h / 2) * s,
    cy + (u - w / 2) * s + (v - h / 2) * c,
  ];
  return {
    img: { width: W, height: H, data },
    quad: [corner(0, 0), corner(w, 0), corner(w, h), corner(0, h)],
  };
}

describe('geometría', () => {
  it('homografía: lleva cada esquina a su destino', () => {
    const src: Pt[] = [
      [10, 20],
      [300, 40],
      [280, 400],
      [5, 380],
    ];
    const dst: Pt[] = [
      [0, 0],
      [100, 0],
      [100, 200],
      [0, 200],
    ];
    const h = homography(src, dst);
    for (let i = 0; i < 4; i++) {
      const [x, y] = applyH(h, src[i][0], src[i][1]);
      expect(x).toBeCloseTo(dst[i][0], 6);
      expect(y).toBeCloseTo(dst[i][1], 6);
    }
  });

  it('rectángulo de área mínima de un rectángulo girado', () => {
    const r = minAreaRect([
      [0, 0],
      [10, 10],
      [5, 15],
      [-5, 5],
    ]);
    expect(r.w * r.h).toBeCloseTo(Math.hypot(10, 10) * Math.hypot(5, 5), 4);
  });

  it('Douglas–Peucker deja un cuadrado en sus 4 esquinas', () => {
    const sq: Pt[] = [];
    for (let i = 0; i < 10; i++) sq.push([i * 10, 0]);
    for (let i = 0; i < 10; i++) sq.push([100, i * 10]);
    for (let i = 10; i > 0; i--) sq.push([i * 10, 100]);
    for (let i = 10; i > 0; i--) sq.push([0, i * 10]);
    expect(approxClosed(sq, 3)).toHaveLength(4);
  });

  it('orden de esquinas: arriba-izq. primero, en sentido horario', () => {
    expect(
      orderQuad([
        [100, 100],
        [0, 0],
        [0, 100],
        [100, 0],
      ])
    ).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]);
  });
});

describe('locateLabels', () => {
  it('encuentra una etiqueta girada 12° y ajusta su contorno', () => {
    const { img, quad } = scene(900, 600, 450, 300, 160, 300, 12);
    const found = locateLabels(img);
    expect(found).toHaveLength(1);
    expect(quadIoU(found[0], quad, img.width, img.height)).toBeGreaterThan(0.85);
  });

  it('no encuentra nada en cartón liso', () => {
    const { img } = scene(600, 400, -1000, -1000, 10, 10, 0);
    expect(locateLabels(img)).toHaveLength(0);
  });

  it('endereza la etiqueta en vertical y no la deja boca abajo', () => {
    const { img } = scene(900, 600, 450, 300, 160, 300, 188);
    const [q] = locateLabels(img);
    const r = rectifyLabel(img, q);
    const W = r.image.width;
    const H = r.image.height;
    expect(H).toBeGreaterThan(W);
    const dark = (y: number) => {
      let d = 0;
      for (let x = 0; x < W; x++) if (r.image.data[(y * W + x) * 4] < 90) d++;
      return d / W;
    };
    // la primera franja negra (10–17 % del alto de la etiqueta) queda arriba
    const first = Array.from({ length: H }, (_, y) => dark(y)).findIndex((v) => v > 0.5);
    expect(first).toBeGreaterThan(0);
    expect(first / H).toBeLessThan(0.3);
  });

  it('toPhoto lleva las esquinas del recorte a las de la etiqueta', () => {
    const { img } = scene(900, 600, 450, 300, 160, 300, 20);
    const [q] = locateLabels(img);
    const r = rectifyLabel(img, q);
    const corners = [
      r.toPhoto(0, 0),
      r.toPhoto(r.image.width, 0),
      r.toPhoto(r.image.width, r.image.height),
      r.toPhoto(0, r.image.height),
    ];
    expect(quadIoU(corners, q, img.width, img.height)).toBeGreaterThan(0.95);
  });
});
