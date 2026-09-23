import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeToUpcA, persistSkuUpcMapping } from '../skuUpc';

describe('normalizeToUpcA', () => {
  it('lleva GTIN-14 y EAN-13 a la forma UPC-12 de Jamis', () => {
    expect(normalizeToUpcA('00845436088143')).toBe('845436088143');
    expect(normalizeToUpcA('845436088143')).toBe('845436088143');
    expect(normalizeToUpcA('0845436088143')).toBe('845436088143');
  });

  it('un SKU o un serial no son un UPC', () => {
    expect(normalizeToUpcA('03-4005-MN')).toBeNull();
    expect(normalizeToUpcA('U226U03779')).toBeNull();
  });
});

describe('persistSkuUpcMapping: aprender sin pisar el catálogo', () => {
  const buildClient = (stored: { sku: string; upc: string | null } | null) => {
    const update = vi.fn().mockReturnValue({
      eq: () => ({ is: () => Promise.resolve({ error: null }) }),
    });
    const client = {
      from: vi.fn().mockReturnValue({
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: stored, error: null }) }),
        }),
        update,
      }),
    };
    return { client: client as unknown as SupabaseClient, raw: client, update };
  };

  it('rellena el UPC cuando el SKU no tenía ninguno', async () => {
    const { client, raw, update } = buildClient({ sku: '03-3869BL', upc: null });
    await expect(persistSkuUpcMapping(client, '03-3869BL', '845436086781')).resolves.toBe('saved');
    expect(raw.from).toHaveBeenCalledWith('sku_metadata');
    expect(update).toHaveBeenCalledWith({ upc: '845436086781' });
  });

  it('no escribe nada cuando el catálogo ya tiene ese mismo UPC', async () => {
    const { client, update } = buildClient({ sku: '03-3869BL', upc: '845436086781' });
    await expect(persistSkuUpcMapping(client, '03-3869BL', '845436086781')).resolves.toBe(
      'unchanged'
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('NO pisa un UPC distinto ya guardado: lo reporta como conflicto', async () => {
    const { client, update } = buildClient({ sku: '03-3869BL', upc: '845436086774' });
    await expect(persistSkuUpcMapping(client, '03-3869BL', '845436086781')).resolves.toBe(
      'conflict'
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('no inventa la fila de un SKU que no está en el catálogo', async () => {
    const { client, update } = buildClient(null);
    await expect(persistSkuUpcMapping(client, '99-0000XX', '845436086781')).resolves.toBe(
      'skipped'
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('encuentra la fila aunque el SKU traiga un guion de más (bug-138)', async () => {
    // `03-4005-MN` y `03-4005MN` son la misma bici — la CITIZEN 1 Sugar Mint —,
    // y compararlas como texto declaraba que el SKU no existe.
    const { client } = buildClient({ sku: '03-4005MN', upc: null });
    await expect(persistSkuUpcMapping(client, '03-4005-MN', '845436088143')).resolves.toBe('saved');
  });
});
