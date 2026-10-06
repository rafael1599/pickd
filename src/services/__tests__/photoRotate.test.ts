import { describe, expect, it } from 'vitest';
import { rotateTarget } from '../photoRotate.service';
import { resolvePhotoUrl, setPhotoOverride } from '../../lib/photoOverrides';
import { toThumbUrl } from '../../components/orders/PalletPhotoRail';

const R2 = 'https://pub-1a61139939fa4f3ba21ee7909510985c.r2.dev';
const id = '704751fe-0e56-4f17-9c97-d999b7e41cb9';

describe('rotateTarget', () => {
  it('fotos de pallet, proyectos y SKU múltiples: la galería', () => {
    expect(rotateTarget(`${R2}/photos/gallery/${id}.webp`)).toEqual({
      kind: 'gallery',
      photoId: id,
    });
    expect(rotateTarget(`${R2}/photos/gallery/thumbs/${id}.webp?v=1`)).toEqual({
      kind: 'gallery',
      photoId: id,
    });
  });
  it('la foto de un SKU', () => {
    expect(rotateTarget(`${R2}/photos/03-4537GY.webp?v=17`)).toEqual({
      kind: 'sku',
      sku: '03-4537GY',
    });
  });
  it('las de catálogo (las comparten muchos SKUs) y lo local no se giran', () => {
    expect(rotateTarget(`${R2}/catalog/hudson.png`)).toBeNull();
    expect(rotateTarget('blob:http://localhost/abc')).toBeNull();
    expect(rotateTarget(`${R2}/photos/returns/1234.webp`)).toBeNull();
  });
});

describe('toThumbUrl', () => {
  it('conserva la versión de una foto girada', () => {
    expect(toThumbUrl(`${R2}/photos/gallery/${id}.webp?v=9`)).toBe(
      `${R2}/photos/gallery/thumbs/${id}.webp?v=9`
    );
    expect(toThumbUrl(`${R2}/photos/gallery/${id}.webp`)).toBe(
      `${R2}/photos/gallery/thumbs/${id}.webp`
    );
  });
});

describe('resolvePhotoUrl', () => {
  it('después de girarla, la foto y su miniatura llevan la versión nueva', () => {
    setPhotoOverride(`${R2}/photos/gallery/${id}.webp`, `${R2}/photos/gallery/${id}.webp?v=42`);
    expect(resolvePhotoUrl(`${R2}/photos/gallery/${id}.webp`)).toBe(
      `${R2}/photos/gallery/${id}.webp?v=42`
    );
    expect(resolvePhotoUrl(`${R2}/photos/gallery/thumbs/${id}.webp`)).toBe(
      `${R2}/photos/gallery/thumbs/${id}.webp?v=42`
    );
    expect(resolvePhotoUrl(`${R2}/photos/gallery/57fa5724-3078-41ed-adae-c7cd3dad398c.webp`)).toBe(
      `${R2}/photos/gallery/57fa5724-3078-41ed-adae-c7cd3dad398c.webp`
    );
  });
});
