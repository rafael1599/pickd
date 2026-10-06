import { describe, expect, it } from 'vitest';
import { angleFromGravity, gravitySign, photoTurn, sharpness, uprightSize } from '../cameraCapture';

const pattern = (w: number, h: number, at: (x: number, y: number) => number) => {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const v = at(x, y);
      const p = (y * w + x) * 4;
      out[p] = out[p + 1] = out[p + 2] = v;
      out[p + 3] = 255;
    }
  return out;
};

describe('sharpness', () => {
  it('bordes nítidos dan más que los mismos bordes corridos', () => {
    const sharp = pattern(32, 32, (x) => (x % 8 < 4 ? 0 : 255));
    // El mismo patrón, difuminado como un movimiento horizontal.
    const blur = pattern(32, 32, (x) => 127 + 120 * Math.sin((x / 8) * 2 * Math.PI));
    expect(sharpness(sharp, 32, 32)).toBeGreaterThan(sharpness(blur, 32, 32) * 5);
  });
  it('una pared lisa da 0', () => {
    expect(
      sharpness(
        pattern(16, 16, () => 128),
        16,
        16
      )
    ).toBe(0);
  });
});

describe('angleFromGravity', () => {
  it('derecho, de lado a la izquierda y a la derecha', () => {
    expect(angleFromGravity(0, 9.8)).toBe(0);
    expect(angleFromGravity(9.8, 0.5)).toBe(90);
    expect(angleFromGravity(-9.8, 0.5)).toBe(-90);
    expect(angleFromGravity(0.3, -9.8)).toBe(0);
  });
  it('cerca de 45° o plano sobre la mesa se queda como estaba', () => {
    expect(angleFromGravity(6.9, 6.9, 90)).toBe(90);
    expect(angleFromGravity(6.9, 6.9, 0)).toBe(0);
    expect(angleFromGravity(0.2, 0.1, -90)).toBe(-90);
    expect(angleFromGravity(null, null, 90)).toBe(90);
  });
});

describe('uprightSize', () => {
  it('de lado, la foto vertical se guarda horizontal', () => {
    expect(uprightSize(2160, 3840, 90)).toEqual({ width: 3840, height: 2160, rotateDeg: -90 });
    expect(uprightSize(2160, 3840, -90)).toEqual({ width: 3840, height: 2160, rotateDeg: 90 });
    expect(uprightSize(2160, 3840, 0)).toEqual({ width: 2160, height: 3840, rotateDeg: 0 });
  });
});

describe('photoTurn', () => {
  it('la pantalla no giró (bloqueada o giro automático apagado): se gira todo', () => {
    expect(photoTurn(90, 0)).toBe(90);
    expect(photoTurn(-90, 0)).toBe(-90);
  });
  it('la pantalla giró con el teléfono: el vídeo ya viene derecho', () => {
    expect(photoTurn(90, 90)).toBe(0);
    expect(photoTurn(-90, -90)).toBe(0);
  });
  it('sin sensor no se gira, y boca abajo cuenta como derecho', () => {
    expect(photoTurn(null, 0)).toBe(0);
    expect(photoTurn(90, -90)).toBe(0);
  });
});

describe('gravitySign', () => {
  it('Chrome da +9,8 derecho, Safari −9,8; sin lectura clara, la de la plataforma', () => {
    expect(gravitySign(9.7, -1)).toBe(1);
    expect(gravitySign(-9.7, 1)).toBe(-1);
    expect(gravitySign(2, -1)).toBe(-1);
  });
});
