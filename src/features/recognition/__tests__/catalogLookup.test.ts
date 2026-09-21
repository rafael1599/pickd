import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  normalizeValue,
  compareField,
  formatCatalogSummary,
  formatAllCatalogSummaries,
  lookupCatalogSku,
  lookupAllCatalogSkus,
  type CatalogLookupResult,
} from '../catalogLookup';
import { supabase } from '../../../lib/supabase';

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe('catalogLookup', () => {
  describe('normalizeValue', () => {
    it('normalizes whitespace, punctuation and case', () => {
      expect(normalizeValue(' CITIZEN 3-STEP-THRU ')).toBe('citizen 3 step thru');
      expect(normalizeValue('700C*16"')).toBe('700c 16');
      expect(normalizeValue(null)).toBe('');
      expect(normalizeValue(undefined)).toBe('');
    });
  });

  describe('compareField', () => {
    it('returns catalog_only when ocr is empty', () => {
      const res = compareField('CITIZEN 3 STEP-THRU', null);
      expect(res.status).toBe('catalog_only');
      expect(res.catalogValue).toBe('CITIZEN 3 STEP-THRU');
      expect(res.ocrValue).toBeNull();
    });

    it('returns ocr_only when catalog is empty', () => {
      const res = compareField(null, 'FAULTLINE 29');
      expect(res.status).toBe('ocr_only');
      expect(res.ocrValue).toBe('FAULTLINE 29');
    });

    it('returns match when values match exactly after normalization', () => {
      const res = compareField('CITIZEN 3 STEP THRU', 'CITIZEN 3-STEP-THRU');
      expect(res.status).toBe('match');
    });

    it('returns match when one is a substring of the other', () => {
      // E.g., catalog says "16" and OCR says "700C*16"
      const resSize = compareField('16', '700C*16');
      expect(resSize.status).toBe('match');

      // E.g., catalog says "VANILLA MINT" and OCR says "MINT"
      const resColor = compareField('VANILLA MINT', 'MINT');
      expect(resColor.status).toBe('match');
    });

    it('returns discrepancy when values differ', () => {
      const res = compareField('16', '18');
      expect(res.status).toBe('discrepancy');
      expect(res.detail).toContain('Catálogo dice "16", foto dice "18"');

      const resColor = compareField('VANILLA MINT', 'STORM GREY');
      expect(resColor.status).toBe('discrepancy');
    });
  });

  describe('formatCatalogSummary', () => {
    it('formats not_found status cleanly', () => {
      const result: CatalogLookupResult = {
        status: 'not_found',
        sku: '03-9999XX',
        data: null,
      };
      const text = formatCatalogSummary(result);
      expect(text).toContain('SKU: 03-9999XX — SKU no registrado en PickD');
    });

    it('formats found catalog with stock locations and comparisons', () => {
      const result: CatalogLookupResult = {
        status: 'found',
        sku: '03-3973MN',
        data: {
          sku: '03-3973MN',
          source: 'catalog',
          model: 'CITIZEN 3 STEP-THRU',
          size: '16',
          color: 'VANILLA MINT',
          isBike: true,
          as400Description: 'CITIZEN 3 ST 16 V-MINT',
          totalStock: 12,
          inStock: true,
          stockLocations: [{ location: 'ROW 25', quantity: 12 }],
        },
        comparisons: {
          model: {
            status: 'match',
            catalogValue: 'CITIZEN 3 STEP-THRU',
            ocrValue: 'CITIZEN 3-STEP-THRU',
          },
          size: { status: 'match', catalogValue: '16', ocrValue: '700C*16' },
          color: { status: 'catalog_only', catalogValue: 'VANILLA MINT', ocrValue: null },
        },
      };

      const text = formatCatalogSummary(result);
      expect(text).toContain('SKU Canónico: 03-3973MN');
      expect(text).toContain('Modelo: CITIZEN 3 STEP-THRU [Coincide con foto]');
      expect(text).toContain('Talla: 16 [Coincide con foto]');
      expect(text).toContain('Color: VANILLA MINT [Sugerencia de catálogo]');
      expect(text).toContain('Stock total: 12 unidades (En stock)');
      expect(text).toContain('Ubicaciones: ROW 25 (12)');
    });
  });

  describe('lookupCatalogSku', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('handles Case 1: SKU with complete catalog data', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              sku: '03-3973MN',
              model: 'CITIZEN 3 STEP-THRU',
              size: '16',
              color: 'VANILLA MINT',
              is_bike: true,
              as400_description: 'CITIZEN 3 ST 16 V-MINT',
              inventory: [
                {
                  location: 'ROW 25',
                  quantity: 12,
                  item_name: 'CITIZEN 3 STEP-THRU 16 VANILLA MINT',
                  is_active: true,
                },
              ],
            },
            error: null,
          }),
        }),
      });

      (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        select: mockSelect,
      });

      const res = await lookupCatalogSku('03-3973-MN', {
        model: 'CITIZEN 3-STEP-THRU',
        size: null,
        color: null,
      });

      expect(res.status).toBe('found');
      expect(res.data?.model).toBe('CITIZEN 3 STEP-THRU');
      expect(res.data?.size).toBe('16');
      expect(res.data?.color).toBe('VANILLA MINT');
      expect(res.data?.source).toBe('catalog');
      expect(res.data?.totalStock).toBe(12);
      expect(res.data?.inStock).toBe(true);
      expect(res.comparisons?.model.status).toBe('match');
      expect(res.comparisons?.size.status).toBe('catalog_only');
    });

    it('handles Case 2: SKU with only AS400 description (inferred via parseBikeName)', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              sku: '03-3970BL',
              model: null,
              size: null,
              color: null,
              is_bike: true,
              as400_description: 'CITIZEN 3 ST 14 2026 NAVY PEARL',
              inventory: [
                {
                  location: 'UNKNOWN',
                  quantity: 0,
                  item_name: 'CITIZEN 3 ST 14 2026 NAVY PEARL',
                  is_active: true,
                },
              ],
            },
            error: null,
          }),
        }),
      });

      (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        select: mockSelect,
      });

      const res = await lookupCatalogSku('03-3970BL');

      expect(res.status).toBe('found');
      expect(res.data?.source).toBe('as400_inferred');
      expect(res.data?.model).toBe('CITIZEN 3 ST');
      expect(res.data?.size).toBe('14');
      expect(res.data?.color).toBe('NAVY PEARL');
      expect(res.data?.totalStock).toBe(0);
      expect(res.data?.inStock).toBe(false);
    });

    it('handles Case 3: SKU not found in PickD', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
        }),
      });

      (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        select: mockSelect,
      });

      const res = await lookupCatalogSku('03-9999ZZ');

      expect(res.status).toBe('not_found');
      expect(res.data).toBeNull();
    });
  });

  describe('lookupAllCatalogSkus & formatAllCatalogSummaries (Sub-fase A3k)', () => {
    it('queries multiple SKUs and deduplicates normalized keys', async () => {
      const mockSelect = vi.fn().mockImplementation(() => ({
        eq: vi.fn().mockImplementation((_col, val) => ({
          maybeSingle: vi.fn().mockImplementation(async () => {
            if (val === '033858BL') {
              return {
                data: {
                  sku: '03-3858BL',
                  model: 'DXT A1 STEP-OVER',
                  size: '18',
                  color: 'DEEP BLUE',
                  is_bike: true,
                  as400_description: null,
                  inventory: [{ location: 'ROW 10', quantity: 5, is_active: true }],
                },
                error: null,
              };
            }
            return { data: null, error: null };
          }),
        })),
      }));

      (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        select: mockSelect,
      });

      const results = await lookupAllCatalogSkus(['01-0448', '03-3858BL', '03-3858-BL'], {
        model: 'DXT A1 STEP-OVER',
        size: '18',
        color: 'DEEP BLUE',
      });

      // Deduplicated: 03-3858BL and 03-3858-BL share same key, so only 2 calls made
      expect(results).toHaveLength(2);
      expect(results[0].sku).toBe('01-0448');
      expect(results[0].status).toBe('not_found');
      expect(results[1].sku).toBe('03-3858BL');
      expect(results[1].status).toBe('found');
      expect(results[1].comparisons?.model.status).toBe('match');

      // Test formatAllCatalogSummaries
      const formatted = formatAllCatalogSummaries(results);
      expect(formatted).toContain('=== FICHAS DE CATÁLOGO PICKD (2 CANDIDATOS) ===');
      expect(formatted).toContain('--- CANDIDATO 1: SKU 01-0448 ---');
      expect(formatted).toContain('SKU no registrado en PickD');
      expect(formatted).toContain('--- CANDIDATO 2: SKU 03-3858BL ---');
      expect(formatted).toContain('Modelo: DXT A1 STEP-OVER [Coincide con foto]');
      expect(formatted).toContain('Stock total: 5 unidades');
    });
  });
});
