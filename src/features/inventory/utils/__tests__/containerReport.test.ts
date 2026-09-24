import { describe, expect, it } from 'vitest';
import {
  summarizeContainerReport,
  toContainerReport,
  type ContainerReportSourceRow,
} from '../containerReport';

const base = {
  snapshot_date: '2026-09-13',
  snapshot_taken_at: '2026-09-14T13:40:00Z',
  first_registered_at: '2026-09-14T20:53:00Z',
};

// Filas de la hoja impresa del 17 sep 2026 (6436N).
const sheet: ContainerReportSourceRow[] = [
  { ...base, sku: '03-3995PD', arrived: 29, is_bike: true, ludlow_qty: 0, ludlow_locations: [] },
  {
    ...base,
    sku: '06-4450BL',
    arrived: 20,
    is_bike: true,
    ludlow_qty: 16,
    ludlow_locations: [{ location: 'ROW 23', qty: 16 }],
  },
  {
    ...base,
    sku: '03-3999PD',
    arrived: 1,
    is_bike: true,
    ludlow_qty: 8,
    ludlow_locations: [{ location: 'ROW 2', qty: 8 }],
  },
];

describe('toContainerReport', () => {
  it('DIST cuenta sólo lo que llegó, @12', () => {
    const { rows } = toContainerReport(sheet);
    expect(rows.map((r) => [r.sku, r.dist])).toEqual([
      ['03-3995PD', 3],
      ['06-4450BL', 2],
      ['03-3999PD', 1],
    ]);
  });

  it('TOTAL es lo que llegó más lo que Ludlow ya tenía', () => {
    const { rows } = toContainerReport(sheet);
    expect(rows.find((r) => r.sku === '06-4450BL')?.total).toBe(36);
    expect(rows.find((r) => r.sku === '03-3995PD')?.total).toBe(29);
  });

  it('LOC lista cada ubicación con su cantidad, en orden natural, o — si no hay', () => {
    const { rows } = toContainerReport([
      {
        ...base,
        sku: 'X',
        arrived: 3,
        is_bike: true,
        ludlow_qty: 5,
        ludlow_locations: [
          { location: 'ROW 10', qty: 2 },
          { location: 'row 2', qty: 3 },
        ],
      },
      ...sheet.slice(0, 1),
    ]);
    expect(rows[0].locLabel).toBe('ROW 2 (3), ROW 10 (2)');
    expect(rows[0].firstLocation).toBe('ROW 2');
    expect(rows[1].locLabel).toBe('—');
    expect(rows[1].firstLocation).toBeNull();
  });

  it('LOC lleva la letra del cuadro cuando el snapshot la guardó', () => {
    const { rows } = toContainerReport([
      {
        ...base,
        sku: 'X',
        arrived: 1,
        is_bike: true,
        ludlow_qty: 18,
        ludlow_locations: [
          { location: 'ROW 23', sublocation: ['c'], qty: 16 },
          { location: 'ROW 37', sublocation: ['C', 'A'], qty: 2 },
        ],
      },
    ]);
    expect(rows[0].locLabel).toBe('ROW 23 C (16), ROW 37 A,C (2)');
  });

  it('una parte no pide strapped pallet', () => {
    const { rows } = toContainerReport([
      { ...base, sku: 'P', arrived: 30, is_bike: false, ludlow_qty: 0, ludlow_locations: [] },
    ]);
    expect(rows[0].dist).toBe(0);
  });

  it('ignora ubicaciones malformadas en el jsonb', () => {
    const { rows } = toContainerReport([
      {
        ...base,
        sku: 'X',
        arrived: 1,
        is_bike: true,
        ludlow_qty: 1,
        ludlow_locations: [null, { location: '', qty: 3 }, { location: 'ROW 5', qty: 0 }, 'x'],
      },
    ]);
    expect(rows[0].locLabel).toBe('—');
  });

  it('lleva el snapshot que se usó', () => {
    const report = toContainerReport(sheet);
    expect(report.snapshotDate).toBe('2026-09-13');
    expect(report.firstRegisteredAt).toBe('2026-09-14T20:53:00Z');
    expect(toContainerReport([]).snapshotDate).toBeNull();
  });
});

describe('summarizeContainerReport', () => {
  it('SKUs y pallets', () => {
    expect(summarizeContainerReport(toContainerReport(sheet).rows)).toEqual({
      skus: 3,
      pallets: 6,
    });
  });
});
