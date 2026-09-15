import { describe, it, expect } from 'vitest';
import { isBikeSku, isSmallBikeSku } from '../bikeDetection';

describe('bikeDetection (Canonical DB is_bike Source of Truth)', () => {
  describe('isBikeSku', () => {
    it('returns true when is_bike is explicitly true in metadata', () => {
      expect(isBikeSku('03-4664YL', { is_bike: true, weight_lbs: 45 })).toBe(true);
      expect(isBikeSku('SPECIAL-BIKE', { is_bike: true })).toBe(true);
      expect(isBikeSku({ sku: '12-3456BK', is_bike: true })).toBe(true);
    });

    it('returns false when is_bike is explicitly false in metadata regardless of SKU format', () => {
      expect(isBikeSku('03-4664YL', { is_bike: false, weight_lbs: 45 })).toBe(false);
      expect(isBikeSku('12-3456BK', { is_bike: false, weight_lbs: 2.7 })).toBe(false);
      expect(isBikeSku('PEDAL-SET', { is_bike: false, weight_lbs: 1.5 })).toBe(false);
    });

    it('falls back to weight heuristic (>= 15 lbs) ONLY when is_bike is uncataloged / null in DB', () => {
      expect(isBikeSku('UNKNOWN-HEAVY-SKU', { is_bike: null, weight_lbs: 35 })).toBe(true);
      expect(isBikeSku({ sku: 'UNCATALOGED-ITEM', weight_lbs: 2.7 })).toBe(false);
    });
  });
});

describe('isSmallBikeSku (la línea juvenil y la rueda chica)', () => {
  it('el prefijo 07- basta, aunque la fila no tenga nada más', () => {
    expect(isSmallBikeSku('07-3741RD')).toBe(true);
    expect(isSmallBikeSku({ sku: '07-3746PU', model: 'JUV LASER 2.0' })).toBe(true);
    // Un SKU que el registrador acaba de crear y el escáner aún no ha leído.
    expect(isSmallBikeSku({ sku: '07-9999XX', model: null, as400_description: null })).toBe(true);
  });

  it('recoge la juvenil que quedó fuera del prefijo', () => {
    expect(
      isSmallBikeSku({ sku: '02-3683GN', as400_description: 'JUV XR.24 2025 NINJA GREEN' })
    ).toBe(true);
  });

  it('la Taxi es chica por la rueda, y la de 26" no lo es', () => {
    expect(
      isSmallBikeSku({ sku: '06-4284TL', as400_description: 'TAXI 16" BAMBOO BEACH TEAL' })
    ).toBe(true);
    expect(
      isSmallBikeSku({
        sku: '06-4731BK',
        model: 'TAXI 24 S/O',
        as400_description: 'TAXI 24" 2026 GLOSS BLACK',
      })
    ).toBe(true);
    expect(isSmallBikeSku({ sku: '06-4293MG', as400_description: 'TAXI 10X20 2022 MANGO' })).toBe(
      true
    );
    // 121 unidades en stock: declararla chica la sacaría de los pallets.
    expect(
      isSmallBikeSku({
        sku: '06-4735BK',
        model: 'TAXI 26 S/O',
        as400_description: 'TAXI 26" S/O L18 2026 GLOSS BLACK',
      })
    ).toBe(false);
    expect(isSmallBikeSku({ sku: '06-4652BK', model: 'TAXI TRIKE' })).toBe(false);
  });

  it('las filas viejas escaneadas se reconocen por el modelo', () => {
    expect(isSmallBikeSku({ sku: 'Y21G008530', model: 'Starlite' })).toBe(true);
    expect(isSmallBikeSku({ sku: 'G220513120', model: 'XR.20' })).toBe(true);
    expect(isSmallBikeSku({ sku: 'M21I014707', model: 'XR.24' })).toBe(true);
  });

  it('no confunde una adulta con una juvenil', () => {
    // `TRAIL XR S/O 12` lleva XR y un número, pero sin punto: es una bici entera.
    expect(
      isSmallBikeSku({
        sku: '03-4090BL',
        model: 'TRAIL XR S/O 12 POWDER',
        as400_description: 'TRAIL XR S/O 12 2026 POWDER BLUE',
      })
    ).toBe(false);
    expect(
      isSmallBikeSku({
        sku: '03-4084SL',
        model: 'TRAIL XR',
        as400_description: 'TRAIL XR 17 2026 NICKEL',
      })
    ).toBe(false);
    // Pesa 31 lb, menos que una CAPRI 2.4, y es una bici de carretera entera.
    expect(
      isSmallBikeSku({
        sku: '03-3780BL',
        model: 'VENTURA A1',
        as400_description: 'VENTURA A1 48 2026 MIDNIGHT BLUE',
      })
    ).toBe(false);
    expect(isSmallBikeSku(null)).toBe(false);
  });

  it('las partes contestan que sí, y por eso sólo se le pregunta a una bici', () => {
    // Documenta el contrato: `resolveBikeSets` cruza con el conjunto de bicis.
    expect(isSmallBikeSku({ sku: '99-2943', model: 'JRP GRIP LASER 2.0' })).toBe(true);
  });
});
