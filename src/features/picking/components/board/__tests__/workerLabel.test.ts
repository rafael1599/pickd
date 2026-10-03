import { describe, expect, it } from 'vitest';
import { getWorkerLabel } from '../SortableOrderCard';
import type { PickingList } from '../../../hooks/useDoubleCheckList';

const order = (o: Partial<PickingList>) => o as PickingList;

describe('getWorkerLabel', () => {
  it('enviada a Double Check: «Picked by» quien la envió (Rafael, 3 oct 2026)', () => {
    expect(
      getWorkerLabel(
        order({
          status: 'ready_to_double_check',
          sent_to_dc_profile: { full_name: 'Carlos Ruiz' } as PickingList['sent_to_dc_profile'],
          profiles: { full_name: 'Otro Nombre' } as PickingList['profiles'],
        })
      )
    ).toBe('Picked by Carlos');
  });

  it('sin enviar: sólo el nombre de quien la recoge', () => {
    expect(
      getWorkerLabel(
        order({
          status: 'ready_to_double_check',
          profiles: { full_name: 'Ana Paz' } as PickingList['profiles'],
        })
      )
    ).toBe('Ana');
  });

  it('mientras alguien la verifica: el que verifica, con ✓', () => {
    expect(
      getWorkerLabel(
        order({
          status: 'double_checking',
          checked_by: 'u2',
          checker_profile: { full_name: 'Luis Mora' } as PickingList['checker_profile'],
          sent_to_dc_profile: { full_name: 'Carlos Ruiz' } as PickingList['sent_to_dc_profile'],
        })
      )
    ).toBe('✓ Luis');
  });
});
