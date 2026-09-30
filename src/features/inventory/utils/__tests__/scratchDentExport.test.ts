import { describe, expect, it } from 'vitest';
import {
  buildScratchDentExportRows,
  scratchDentExportFileName,
  type ScratchDentInventoryRow,
  type ScratchDentMetadataRow,
} from '../scratchDentExport';

const inv = (over: Partial<ScratchDentInventoryRow> = {}): ScratchDentInventoryRow => ({
  id: 1,
  warehouse: 'LUDLOW',
  location: 'ROW 20',
  quantity: 1,
  is_active: true,
  item_name: 'EXPLORER A1 2022 17 BLUE SD',
  internal_note: null,
  ...over,
});

const meta = (over: Partial<ScratchDentMetadataRow> = {}): ScratchDentMetadataRow => ({
  sku: '01-0288',
  category: 'bike',
  condition: 'scratch',
  condition_description: 'Scuffed top tube',
  serial_number: 'SN123',
  upc: null,
  msrp: 899,
  standard_price: 600,
  sd_price: 450,
  as400_description: 'S/D EXPLORER A1',
  received_year: 2022,
  image_url: null,
  pdf_link: null,
  inventory: [inv()],
  ...over,
});

describe('buildScratchDentExportRows', () => {
  it('shows the full name alone, without model, size, colour, warehouse or square columns', () => {
    const [row] = buildScratchDentExportRows([meta()], { includeInactive: false });
    expect(row).not.toHaveProperty('Model');
    expect(row).not.toHaveProperty('Size');
    expect(row).not.toHaveProperty('Color');
    expect(row).not.toHaveProperty('Warehouse');
    expect(row).not.toHaveProperty('Square');
  });

  it('writes one row per live shelf row with catalogue and shelf side by side', () => {
    const [row] = buildScratchDentExportRows([meta()], { includeInactive: false });
    expect(row).toMatchObject({
      SKU: '01-0288',
      Name: 'EXPLORER A1 2022 17 BLUE SD',
      Condition: 'scratch',
      'S/D price': 450,
      Location: 'ROW 20',
      Qty: 1,
      Status: 'In stock',
    });
  });

  it('leaves sold units and shelf-less SKUs out unless Deleted & Qty 0 is on', () => {
    const data = [
      meta({ sku: 'A', inventory: [inv({ quantity: 0, is_active: false })] }),
      meta({ sku: 'B', inventory: [] }),
      meta({ sku: 'C', inventory: [inv({ warehouse: 'ATS' })] }),
    ];
    expect(buildScratchDentExportRows(data, { includeInactive: false })).toEqual([]);
    const all = buildScratchDentExportRows(data, { includeInactive: true });
    expect(all.map((r) => [r.SKU, r.Status])).toEqual([
      ['B', 'Sold / 0'],
      ['A', 'Sold / 0'],
    ]);
  });

  it('sorts by location the way the floor reads it', () => {
    const data = [
      meta({ sku: 'X', inventory: [inv({ location: 'ROW 24' })] }),
      meta({ sku: 'Y', inventory: [inv({ location: 'ROW 3' })] }),
    ];
    expect(buildScratchDentExportRows(data, { includeInactive: false }).map((r) => r.SKU)).toEqual([
      'Y',
      'X',
    ]);
  });
});

it('names the file by date', () => {
  expect(scratchDentExportFileName(new Date(2026, 8, 30))).toBe('SD_BIKES_20260930.xlsx');
});
