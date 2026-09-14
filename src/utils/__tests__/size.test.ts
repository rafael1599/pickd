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

  it('el 700C es un estándar de rueda, y el cuadro lleva su propia unidad', () => {
    expect(formatSize('700C')).toBe('700C');
    expect(formatSize('700Cx58cm')).toBe('700C×58cm');
    expect(formatSize('700CX16')).toBe('700C×16"');
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
  it('es lo que el export de FedEx siempre escribió', () => {
    expect(renderSizeForExport('17')).toBe("17''");
    expect(renderSizeForExport('58')).toBe('58');
    expect(renderSizeForExport('15X27')).toBe("15''X27");
    expect(renderSizeForExport('700CX16')).toBe("700CX16''");
  });

  it('`renderSize` delega aquí, así que la clave de agrupación no se mueve', () => {
    for (const v of ['17', '58', 'L16', '15X27', '700C', '700Cx58cm', 'Adult', '56 cm']) {
      expect(renderSize(v)).toBe(renderSizeForExport(v));
    }
  });
});

describe('displaySize', () => {
  it('sólo pone unidad cuando la fila es una bici', () => {
    expect(displaySize('17', true)).toBe('17"');
    // `JRP GRIP LASER 2.0 2006` guarda `06` en size: es un año, no un cuadro.
    expect(displaySize('06', false)).toBe('06');
    expect(displaySize('17', null)).toBe('17');
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
});
