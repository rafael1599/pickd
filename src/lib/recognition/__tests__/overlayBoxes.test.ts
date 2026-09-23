import { describe, expect, it } from 'vitest';
import { mapBoxToRotation } from '../clientOcr';
import { toOverlayRect, unmapBoxFromRotation } from '../overlayBoxes';

const PHOTO = { width: 1000, height: 2000 };
const LABEL = { x: 100, y: 400, width: 300, height: 200 };

describe('unmapBoxFromRotation — deshace la vuelta que dio el OCR', () => {
  it('ida y vuelta devuelve la misma caja, en los tres giros', () => {
    for (const rotation of [0, 90, 270] as const) {
      const turned = mapBoxToRotation(LABEL, rotation, PHOTO.width, PHOTO.height);
      expect(unmapBoxFromRotation(turned, rotation, PHOTO.width, PHOTO.height)).toEqual(LABEL);
    }
  });

  it('sin giro no toca nada', () => {
    expect(unmapBoxFromRotation(LABEL, 0, PHOTO.width, PHOTO.height)).toEqual(LABEL);
  });
});

describe('toOverlayRect — de píxeles a un sitio en la pantalla', () => {
  it('una etiqueta arriba a la izquierda se pinta arriba a la izquierda', () => {
    expect(toOverlayRect(LABEL, PHOTO)).toEqual({
      leftPct: 10,
      topPct: 20,
      widthPct: 30,
      heightPct: 10,
    });
  });

  it('una foto que el OCR leyó de lado se pinta derecha igual', () => {
    const turned = mapBoxToRotation(LABEL, 90, PHOTO.width, PHOTO.height);
    const rect = toOverlayRect(turned, { ...PHOTO, rotationUsed: 90 });
    expect(rect).toEqual(toOverlayRect(LABEL, PHOTO));
  });

  it('sin medidas de la foto no se pinta nada — mejor eso que pintar en otro sitio', () => {
    expect(toOverlayRect(LABEL, {})).toBeNull();
    expect(toOverlayRect(LABEL, { width: 0, height: 2000 })).toBeNull();
  });

  it('una caja que se sale del borde se recorta, nunca desborda la foto', () => {
    const rect = toOverlayRect({ x: 900, y: 1900, width: 400, height: 400 }, PHOTO)!;
    expect(rect.leftPct + rect.widthPct).toBeLessThanOrEqual(100);
    expect(rect.topPct + rect.heightPct).toBeLessThanOrEqual(100);
  });
});
