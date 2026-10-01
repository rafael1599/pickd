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
  warpQuad,
  textAxisLog,
  refineQuad,
  residualAngle,
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

  it('una etiqueta casi cuadrada y apaisada no se gira 90° por tener el lado largo acostado', () => {
    const { img } = scene(900, 600, 450, 300, 300, 270, 6);
    const [q] = locateLabels(img);
    const r = rectifyLabel(img, q);
    expect(r.image.width).toBeGreaterThan(r.image.height);
    expect(textAxisLog(r.image)).toBeGreaterThan(0);
  });

  it('las esquinas guardadas reproducen la etiqueta de pie (el 3D de Ship)', () => {
    const { img } = scene(900, 600, 450, 300, 160, 300, 188);
    const [q] = locateLabels(img);
    const r = rectifyLabel(img, q);
    const W = r.image.width;
    const H = r.image.height;
    const corners = [r.toPhoto(0, 0), r.toPhoto(W, 0), r.toPhoto(W, H), r.toPhoto(0, H)];
    const again = warpQuad(img, corners as [Pt, Pt, Pt, Pt], Math.max(W, H));
    expect(Math.abs(again.width - W)).toBeLessThanOrEqual(2);
    expect(Math.abs(again.height - H)).toBeLessThanOrEqual(2);
    let same = 0;
    let n = 0;
    for (let y = 4; y < Math.min(H, again.height) - 4; y += 3)
      for (let x = 4; x < Math.min(W, again.width) - 4; x += 3) {
        const a = r.image.data[(y * W + x) * 4] < 90;
        const b = again.data[(y * again.width + x) * 4] < 90;
        if (a === b) same++;
        n++;
      }
    expect(same / n).toBeGreaterThan(0.95);
  });

  it('un contorno con cartón de más se ajusta a la pegatina', () => {
    const { img, quad } = scene(900, 600, 450, 300, 160, 300, 8);
    const c = [quad.reduce((a, p) => a + p[0], 0) / 4, quad.reduce((a, p) => a + p[1], 0) / 4];
    const loose = quad.map(([x, y]) => [
      c[0] + (x - c[0]) * 1.18,
      c[1] + (y - c[1]) * 1.18,
    ]) as typeof quad;
    const tight = refineQuad(img, loose as never);
    expect(tight).not.toBeNull();
    expect(quadIoU(tight!, quad, img.width, img.height)).toBeGreaterThan(
      quadIoU(loose, quad, img.width, img.height) + 0.1
    );
  });
});

describe('residualAngle', () => {
  it('mide la inclinación que queda en una etiqueta ya enderezada', () => {
    // etiqueta derecha (0°) y girada 3° dentro del recorte
    const flat = scene(300, 560, 150, 280, 280, 540, 0).img;
    expect(Math.abs(residualAngle(flat))).toBeLessThanOrEqual(0.4);
    const tilted = scene(300, 560, 150, 280, 260, 520, 3).img;
    expect(Math.abs(Math.abs(residualAngle(tilted)) - 3)).toBeLessThanOrEqual(0.6);
  });
});
