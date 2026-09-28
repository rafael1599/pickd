import { describe, expect, it } from 'vitest';
import { parseBikeSkuText } from '../clientOcr';

const sku = (txt: string) => parseBikeSkuText(txt)?.sku ?? null;

describe('parseBikeSkuText — lo que el OCR devolvió de verdad (sombra, 28 sep 2026)', () => {
  it.each([
    ['06-4588-BL', '06-4588BL'],
    ['03-3990-TL', '03-3990TL'],
    ['03-4713BR', '03-4713BR'],
    ['03.4704GY', '03-4704GY'],
    // El color partido por un espacio.
    ['06-4524-K W', '06-4524KW'],
    // Espacio y guion juntos, y el color partido.
    ['03 -3921 B K', '03-3921BK'],
    // Una letra del color leída como número.
    ['03-47030Y', '03-4703GY'],
    ['03-47108R', '03-4710BR'],
    // Lo que viene después, tras un espacio, no cuenta.
    ['03-3990-TL 845436', '03-3990TL'],
    ['D6-4588-BL', null],
  ])('%s → %s', (txt, expected) => {
    expect(sku(txt)).toBe(expected);
  });

  it('una letra suelta que no forma un color no se une', () => {
    // «B» y luego la G de GTIN: BG no es un color.
    expect(sku('06-4588-B GTIN')).toBe('06-4588B');
  });

  it('ni la unión de letras ni la reparación de números saltan a otro fragmento', () => {
    // Renglón unido de verdad: «034707Y» + «1» + «2». La etiqueta dice 03-4707GY.
    expect(sku('034707Y 1 2')).toBe('03-4707Y');
    expect(parseBikeSkuText('034707Y LASER', { joinSpacedColor: false })?.sku).toBe('03-4707Y');
  });

  it('el color termina donde termina la palabra', () => {
    expect(sku('01-0448 ALLEGRO A3')).toBe('01-0448');
  });

  it('la letra que el OCR perdió no se inventa', () => {
    expect(sku('03-3979-G')).toBe('03-3979G');
  });
});

describe('parseBikeSkuText — no lee SKU donde no los hay', () => {
  it.each([
    '845436087993',
    '00845436087887',
    '6845 36077215',
    'MK NO.:202202041',
    'P/0 NO.:2022-23',
    'Y228006219',
    '19.60 KG',
  ])('%s → nada', (txt) => {
    expect(sku(txt)).toBeNull();
  });

  it('seis dígitos seguidos sin color ni separador no son un SKU', () => {
    expect(sku('034707')).toBeNull();
  });
});
