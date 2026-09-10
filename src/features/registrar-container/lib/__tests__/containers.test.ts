import { describe, it, expect } from 'vitest';
import {
  isWarehouseContainer,
  summarizeIntakes,
  worksheetContainer,
  type IntakeLog,
} from '../containers';

const add = (to: string, qty: number, by: string, at: string, reversed = false): IntakeLog => ({
  to_location: to,
  action_type: 'ADD',
  quantity_change: qty,
  performed_by: by,
  created_at: at,
  is_reversed: reversed,
});

describe('isWarehouseContainer', () => {
  it('is a Jamis North PO: four digits and N', () => {
    expect(isWarehouseContainer('7005N')).toBe(true);
    expect(isWarehouseContainer('6438F')).toBe(false); // FL Breakdown — Miami
    expect(isWarehouseContainer('6433FL')).toBe(false); // Direct Containers — a customer
    expect(isWarehouseContainer(null)).toBe(false);
  });
});

describe('summarizeIntakes', () => {
  it('knows a container whose stock already went to the rows', () => {
    // 7004N, 10 Sep 2026: 235 bikes registered at 9:22 and the location empty
    // by the afternoon. register_container's guard only looks at stock, so on
    // its own it would take the same 235 again.
    const intakes = summarizeIntakes(
      ['7004N', '6436N'],
      [
        add('7004N', 200, 'Warehouse Team', '2026-09-10T13:22:28Z'),
        add('7004N', 35, 'Warehouse Team', '2026-09-10T13:22:28Z'),
      ],
      []
    );
    expect(intakes.get('7004N')).toEqual({
      location: '7004N',
      firstAt: '2026-09-10T13:22:28Z',
      units: 235,
      stock: 0,
    });
    expect(intakes.has('6436N')).toBe(false); // left out on purpose, still to come
  });

  it('knows a container that still holds its stock', () => {
    const intakes = summarizeIntakes(
      ['7005N'],
      [add('7005N', 249, 'Warehouse Team', '2026-09-10T20:30:57Z')],
      [
        { location: '7005N', quantity: 200 },
        { location: '7005N', quantity: 49 },
      ]
    );
    expect(intakes.get('7005N')).toMatchObject({ units: 249, stock: 249 });
  });

  it('counts people, not stock coming back, as the intake', () => {
    // 7003N: an order cancelled after picking put units back where they came
    // from. That proves the container was registered; it is not what came in.
    const intakes = summarizeIntakes(
      ['7003N', '7002N'],
      [
        add('7003N', 60, 'Warehouse Team', '2026-07-02T17:51:13Z'),
        add('7003N', 2, 'System Auto-Cancel', '2026-07-20T10:00:00Z'),
        add('7002N', 1, 'system: unpick', '2026-05-06T17:12:59Z'),
      ],
      []
    );
    expect(intakes.get('7003N')).toMatchObject({ units: 60, firstAt: '2026-07-02T17:51:13Z' });
    expect(intakes.get('7002N')).toMatchObject({ units: 0, firstAt: '2026-05-06T17:12:59Z' });
  });

  it('forgets an intake that was undone', () => {
    const intakes = summarizeIntakes(
      ['6436N'],
      [add('6436N', 284, 'Warehouse Team', '2026-09-10T21:00:00Z', true)],
      []
    );
    expect(intakes.has('6436N')).toBe(false);
  });

  it('ignores what is not an ADD into that very name', () => {
    const intakes = summarizeIntakes(
      ['9001N'],
      [
        { ...add('9001N', 5, 'Warehouse Team', '2026-09-10T20:00:00Z'), action_type: 'MOVE' },
        add('9001N', 0, 'Warehouse Team', '2026-09-10T20:00:00Z'),
        add('9001NX', 5, 'Warehouse Team', '2026-09-10T20:00:00Z'),
      ],
      [{ location: 'ROW 9', quantity: 5 }]
    );
    expect(intakes.has('9001N')).toBe(false);
  });

  it('has no date for stock that no ADD accounts for', () => {
    const intakes = summarizeIntakes(['3446N'], [], [{ location: ' 3446n ', quantity: 12 }]);
    expect(intakes.get('3446N')).toEqual({ location: '3446N', firstAt: null, units: 0, stock: 12 });
  });
});

describe('worksheetContainer', () => {
  it('names a PDF worksheet after its PO', () => {
    const c = worksheetContainer(
      'PO 6430N.pdf',
      [
        {
          po: '6430n',
          sku: '12-8341BL',
          qty: 75,
          itemName: 'Chainguard',
          model: null,
          size: null,
          color: null,
        },
      ],
      75
    );
    expect(c).toMatchObject({ po: '6430N', sheet: 'PO 6430N.pdf', total: 75 });
  });
});
