import { describe, it, expect } from 'vitest';
import { nameAfterSave, yearInName, type NameInput } from '../itemName';

const edit = (over: Partial<NameInput>): NameInput => ({
  mode: 'edit',
  isBike: true,
  model: '',
  size: '',
  color: '',
  baseline: { model: '', size: '', color: '' },
  itemName: '',
  ...over,
});

describe('nameAfterSave', () => {
  it('a SKU without a model keeps its name — the 99-4807CL case', () => {
    expect(
      nameAfterSave(
        edit({
          isBike: false,
          size: '54cm',
          color: 'CHARCOAL',
          baseline: { model: '', size: '54cm', color: 'CHARCOAL' },
          itemName: 'JRP FRAME RENEGADE S1 54 2024 CHARCOAL',
        })
      )
    ).toBe('JRP FRAME RENEGADE S1 54 2024 CHARCOAL');
  });

  it('an edit that does not touch model, size or colour keeps the name', () => {
    // PEDAL was put in front on purpose (31 Jul 2026); a quantity change must not drop it.
    const baseline = { model: 'TAXI', size: '20', color: 'GLOSS BLACK' };
    expect(
      nameAfterSave(
        edit({
          isBike: false,
          ...baseline,
          baseline,
          itemName: 'PEDAL TAXI 2020 20 GLOSS BLACK',
        })
      )
    ).toBe('PEDAL TAXI 2020 20 GLOSS BLACK');
  });

  it('correcting the model renames: a bike is "model size colour"', () => {
    expect(
      nameAfterSave(
        edit({
          model: 'RENEGADE C2',
          size: '700×54cm',
          color: 'GRAPHITE',
          baseline: { model: 'RENEGADE', size: '700×54cm', color: 'GRAPHITE' },
          itemName: 'RENEGADE 700×54cm GRAPHITE',
        })
      )
    ).toBe('RENEGADE C2 700×54cm GRAPHITE');
  });

  it('a part is named by its model alone, so nothing is appended twice', () => {
    expect(
      nameAfterSave(
        edit({
          isBike: false,
          model: 'JRP FRAME RENEGADE S1 54 2024 CHARCOAL',
          size: '54cm',
          color: 'CHARCOAL',
          baseline: { model: 'JRP FRAME RENEGADE S1 54 2024', size: '54cm', color: 'CHARCOAL' },
        })
      )
    ).toBe('JRP FRAME RENEGADE S1 54 2024 CHARCOAL');
  });

  it('a new registration builds the name from its fields', () => {
    expect(
      nameAfterSave({
        mode: 'add',
        isBike: true,
        model: 'XR24',
        size: '24"×12"',
        color: 'COBALT BLUE',
        baseline: { model: '', size: '', color: '' },
        itemName: '',
      })
    ).toBe('XR24 24"×12" COBALT BLUE');
  });

  it('nothing to go on is null, never an empty string', () => {
    expect(nameAfterSave(edit({}))).toBeNull();
  });

  it('a colour change keeps the year the name had (CODA S2, 1 oct 2026)', () => {
    const baseline = { model: 'CODA S2', size: 'L16', color: 'GLOSS BLACK' };
    expect(
      nameAfterSave(
        edit({
          ...baseline,
          color: 'MATTE BLACK',
          baseline,
          itemName: 'CODA S2 L16 2025 GLOSS BLACK',
        })
      )
    ).toBe('CODA S2 L16 2025 MATTE BLACK');
  });

  it('registering from Double Check keeps the AS400 year', () => {
    expect(
      nameAfterSave({
        mode: 'add',
        isBike: true,
        model: 'EXPLORER A2',
        size: '15',
        color: 'GLOSS BLAC',
        baseline: { model: '', size: '', color: '' },
        itemName: 'EXPLORER A2 15 2026 GLOSS BLAC',
      })
    ).toBe('EXPLORER A2 15 2026 GLOSS BLAC');
  });

  it('a year already in the model is not written twice', () => {
    expect(
      nameAfterSave(
        edit({
          model: 'TRAIL X1 2009',
          size: '14',
          color: 'RED',
          baseline: { model: 'TRAIL X1 2009', size: '14', color: 'BLUE' },
          itemName: 'TRAIL X1 2009 14 BLUE',
        })
      )
    ).toBe('TRAIL X1 2009 14 RED');
  });
});

describe('yearInName', () => {
  it('reads the last 20xx, and nothing else', () => {
    expect(yearInName('HUDSON 19 2025 ANO MIDNIGHT SKY')).toBe('2025');
    expect(yearInName('PEDAL TAXI 2020 20 GLOSS BLACK')).toBe('2020');
    expect(yearInName('XR24 24"×12" COBALT BLUE')).toBeNull();
    expect(yearInName('S/D HUDSON 17" GLOSS BLACK Y216014314')).toBeNull();
  });
});
