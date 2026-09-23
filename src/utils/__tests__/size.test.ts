import { describe, it, expect } from 'vitest';
import { formatSize, renderSizeForExport, displaySize, withSizeUnit } from '../size';
import { renderSize } from '../fedexCarton';

describe('formatSize', () => {
  it('decide la unidad por la magnitud', () => {
    expect(formatSize('17')).toBe('17"');
    expect(formatSize('15.5')).toBe('15.5"');
    expect(formatSize('29')).toBe('29"');
    expect(formatSize('48')).toBe('48cm');
    expect(formatSize('61')).toBe('61cm');
  });

  it('no inventa una unidad para un número que no es ninguna de las dos escalas', () => {
    expect(formatSize('35')).toBe('35');
  });

  it('es idempotente sobre lo que ya viene marcado', () => {
    expect(formatSize('15"')).toBe('15"');
    expect(formatSize('54cm')).toBe('54cm');
    expect(formatSize('56 cm')).toBe('56cm');
    expect(formatSize('61CM')).toBe('61cm');
  });

  it('conserva el prefijo de cuadro bajo', () => {
    expect(formatSize('L16')).toBe('L16"');
    expect(formatSize('L48')).toBe('L48cm');
  });

  it('marca las dos mitades de un compuesto, que son pulgadas en cualquier orden', () => {
    expect(formatSize('15X27')).toBe('15"×27"');
    expect(formatSize('27.5X14')).toBe('27.5"×14"');
  });

  it('el 700 es un estándar de rueda (con o sin C), y el cuadro lleva su propia unidad sin la C', () => {
    expect(formatSize('700C')).toBe('700');
    expect(formatSize('700')).toBe('700');
    expect(formatSize('700Cx58cm')).toBe('700×58cm');
    expect(formatSize('700CX16')).toBe('700×16"');
    expect(formatSize('700x54cm')).toBe('700×54cm');
    expect(formatSize('700X19')).toBe('700×19"');
    expect(formatSize('700 x 54 cm')).toBe('700×54cm');
    expect(formatSize('700c*19')).toBe('700×19"');
  });

  it('deja en paz lo que no es una medida', () => {
    expect(formatSize('L')).toBe('L');
    expect(formatSize('Adult')).toBe('Adult');
    expect(formatSize('MD/17')).toBe('MD/17');
    expect(formatSize(null)).toBeNull();
    expect(formatSize('   ')).toBeNull();
  });
});

describe('renderSizeForExport', () => {
  it('es lo que el export de FedEx siempre escribió (rueda sin C y con regla de magnitud)', () => {
    expect(renderSizeForExport('17')).toBe("17''");
    expect(renderSizeForExport('58')).toBe('58');
    expect(renderSizeForExport('15X27')).toBe("15''X27");
    expect(renderSizeForExport('700CX16')).toBe("700X16''");
    expect(renderSizeForExport('700Cx58cm')).toBe('700X58');
    expect(renderSizeForExport('700C')).toBe('700');
    expect(renderSizeForExport('700 x 54 cm')).toBe('700X54');
  });

  it('`renderSize` delega aquí, así que la clave de agrupación no se mueve', () => {
    for (const v of ['17', '58', 'L16', '15X27', '700C', '700Cx58cm', 'Adult', '56 cm']) {
      expect(renderSize(v)).toBe(renderSizeForExport(v));
    }
  });
});

/** Las 95 grafías reales medidas en prod en sku_metadata.size */
const PROD_SIZE_SPELLINGS_95 = [
  '-',
  '05',
  '06',
  '08',
  '09',
  '10',
  '10"',
  '10"x20"',
  '10X20',
  '11',
  '12',
  '12X27',
  '13',
  '13X27',
  '14',
  '14"',
  '15',
  '15.5',
  '15.5"',
  '15"',
  '15X27',
  '16',
  '16"',
  '17',
  '17"',
  '17X29',
  '18',
  '18"',
  '19',
  '19"',
  '19X29',
  '20',
  '20"x10"',
  '21',
  '21"',
  '21X29',
  '23',
  '23"',
  '24',
  '24"',
  '24"x12"',
  '26',
  '26"',
  '26"*18"',
  '26”x13”',
  '26"x17"',
  '26"x18"',
  '26"X18"',
  '26*21',
  '26X18',
  '27.5"x12"',
  '27.5"x16"',
  '27.5"X16"',
  '27.5X14',
  '27.5X19',
  '29',
  '29"x17 "',
  '29"x17"',
  '31.8',
  '44',
  '48',
  '48cm',
  '51',
  '51cm',
  '54',
  '54cm',
  '56',
  '56 cm',
  '56cm',
  '58',
  '58 cm',
  '58cm',
  '58CM',
  '61',
  '61 cm',
  '61cm',
  '61CM',
  '7.25"',
  '7.5"',
  '7.75"',
  '7"',
  '700 x 54 cm',
  '700C x 54cm',
  '700c x 61cm',
  '700c*19',
  '700CX16',
  '700Cx54cm',
  '700Cx58cm',
  '8"',
  '8”*16”',
  'Adult ',
  'L',
  'MD/17',
  'S',
  'X',
];

describe('95 grafías reales de prod', () => {
  it('formatSize es idempotente: formatSize(formatSize(x)) === formatSize(x)', () => {
    expect(PROD_SIZE_SPELLINGS_95.length).toBe(95);
    for (const raw of PROD_SIZE_SPELLINGS_95) {
      const once = formatSize(raw);
      const twice = formatSize(once);
      expect(twice).toBe(once);
    }
  });

  it('renderSizeForExport(formatSize(x)) === renderSizeForExport(x) para todas las grafías', () => {
    for (const raw of PROD_SIZE_SPELLINGS_95) {
      const formatted = formatSize(raw);
      expect(renderSizeForExport(formatted)).toBe(renderSizeForExport(raw));
    }
  });

  it('las 7 grafías de rueda producen su clave sin C y con la regla de magnitud para centímetros', () => {
    expect(renderSizeForExport(formatSize('700 x 54 cm'))).toBe('700X54');
    expect(renderSizeForExport(formatSize('700C x 54cm'))).toBe('700X54');
    expect(renderSizeForExport(formatSize('700c x 61cm'))).toBe('700X61');
    expect(renderSizeForExport(formatSize('700c*19'))).toBe("700X19''");
    expect(renderSizeForExport(formatSize('700CX16'))).toBe("700X16''");
    expect(renderSizeForExport(formatSize('700Cx54cm'))).toBe('700X54');
    expect(renderSizeForExport(formatSize('700Cx58cm'))).toBe('700X58');
  });
});

describe('displaySize', () => {
  it('sólo pone unidad cuando la fila es una bici', () => {
    expect(displaySize('17', true)).toBe('17"');
    // `JRP GRIP LASER 2.0 2006` guarda `06` en size: es un año, no un cuadro.
    expect(displaySize('06', false)).toBe('06');
    expect(displaySize('17', null)).toBe('17');
  });

  it('un cuadro suelto es parte, pero su talla sí es de cuadro', () => {
    // `FRAME RENEGADE S1 UDH 54` — mismo criterio que el export de FedEx.
    expect(displaySize('54', false, 'frame')).toBe('54cm');
    expect(displaySize('54', null, 'Frame')).toBe('54cm');
  });

  it('ninguna otra categoría de parte abre la puerta', () => {
    // `JRP DER HNGR TRAIL-X SERIES 2008` guarda `08`: 300 unidades con un año dentro.
    expect(displaySize('08', false, 'hanger')).toBe('08');
    expect(displaySize('16', false, null)).toBe('16');
  });
});

describe('withSizeUnit', () => {
  it('marca la talla escrita dentro del nombre', () => {
    expect(withSizeUnit('TRAIL XR 15 NICKEL', '15', true)).toBe('TRAIL XR 15" NICKEL');
    expect(withSizeUnit('ALLEGRO A2 15 2025 GLOSS BLACK', '15', true)).toBe(
      'ALLEGRO A2 15" 2025 GLOSS BLACK'
    );
    expect(withSizeUnit('RENEGADE C1 58 2025 SPYDER GREEN', '58', true)).toBe(
      'RENEGADE C1 58cm 2025 SPYDER GREEN'
    );
  });

  it('no toca un número que no es la talla', () => {
    // El año queda intacto, y `15` no coincide dentro de `15X27`.
    expect(withSizeUnit('DIVIDE 15X27 2026 GOLDEN POP', '15', true)).toBe(
      'DIVIDE 15X27 2026 GOLDEN POP'
    );
  });

  it('se traga la unidad que el nombre ya traía suelta', () => {
    // Sin esto salía `61cm cm`.
    expect(withSizeUnit('Renegade C2 61 cm Moss', '61 cm', true)).toBe('Renegade C2 61cm Moss');
  });

  it('es idempotente, incluso con el nombre escrito dos veces', () => {
    const doble = 'ALLEGRO A1 23 THUNDER GREY 23 THUNDER GREY';
    const una = withSizeUnit(doble, '23', true);
    expect(una).toBe('ALLEGRO A1 23" THUNDER GREY 23 THUNDER GREY');
    expect(withSizeUnit(una, '23', true)).toBe(una);
  });

  it('nunca toca una parte ni un nombre sin talla conocida', () => {
    expect(withSizeUnit('JRP GRIP LASER 2.0 06', '06', false)).toBe('JRP GRIP LASER 2.0 06');
    expect(withSizeUnit('TRAIL XR 15 NICKEL', null, true)).toBe('TRAIL XR 15 NICKEL');
  });

  it('el cuadro suelto sí', () => {
    expect(withSizeUnit('FRAME RENEGADE S1 UDH 54 2025 CHARCOAL', '54', false, 'frame')).toBe(
      'FRAME RENEGADE S1 UDH 54cm 2025 CHARCOAL'
    );
  });
});
