import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isUpcOrGtin,
  normalizeToUpcA,
  SessionUpcCatalog,
  arbitrateCandidates,
  persistSkuUpcMapping,
} from '../upcCatalogResolver';
import {
  extractCandidateFromBarcode,
  TemporalConsensusFilter,
  type ProposedBoxCandidate,
} from '../liveBarcodeScanner';
import { reconcileCandidate, type SessionItemLedger } from '../groupReconciler';

describe('upcCatalogResolver & Bug Rafael S25 Ultra Fix', () => {
  let catalog: SessionUpcCatalog;
  let filter: TemporalConsensusFilter;

  // Ledger de la orden de prueba (con CITIZEN 1 STEP-THRU 16" Sugar Mint)
  const mockOrderItems: SessionItemLedger[] = [
    {
      id: 'order-1-item-1',
      orderId: 'order-881650',
      orderNumber: '881650',
      sku: '03-4005-MN',
      name: 'CITIZEN 1 STEP-THRU, 700C*16, Sugar Mint',
      quantity: 1,
      verifiedQuantity: 0,
      isBike: true,
      model: 'CITIZEN 1 STEP-THRU',
      size: '16',
      color: 'Sugar Mint',
    },
    {
      id: 'order-1-item-2',
      orderId: 'order-881650',
      orderNumber: '881650',
      sku: '03-3989GY',
      name: 'RENEGADE S1 56 Charcoal',
      quantity: 1,
      verifiedQuantity: 0,
      isBike: true,
    },
  ];

  beforeEach(() => {
    catalog = new SessionUpcCatalog();
    filter = new TemporalConsensusFilter({ requiredFrames: 2, windowMs: 600 }, catalog);
  });

  describe('Caso Exacto Rafael (Galaxy S25 Ultra)', () => {
    const rawGtin14 = '00845436088143';
    const upc12 = '845436088143';
    // El catálogo resuelve al nombre que el catálogo tiene: `03-4005MN`. El
    // ledger de arriba lo escribe con un guion de más a propósito —es la grafía
    // que trajo el caso real— y la conciliación tiene que seguir emparejándolos.
    const expectedSku = '03-4005MN';

    it('demuestra por qué la lógica previa fallaba (falsa alarma CAJA AJENA)', () => {
      // LOGICA ANTERIOR (Bug):
      // 1. extractCandidateFromBarcode('00845436088143') retornaba {} porque no reconocía 14 dígitos numéricos
      // 2. liveBarcodeScanner hacía: const sku = parsed.sku || detection.rawValue; -> '00845436088143'
      // 3. reconcileCandidate comparaba '00845436088143' contra ['03-4005-MN'] -> No match -> Población B (CAJA AJENA)
      const buggyCandidate: ProposedBoxCandidate = {
        sku: rawGtin14, // El GTIN usado como SKU por la lógica vieja
        rawBarcode: rawGtin14,
        format: 'itf',
        serial: null,
        consecutiveFrames: 2,
        confidence: 0.9,
        firstDetectedAt: 1000,
        lastDetectedAt: 1050,
      };

      const result = reconcileCandidate(buggyCandidate, mockOrderItems, new Set());

      // La lógica anterior disparaba erróneamente CAJA AJENA
      expect(result.population).toBe('B');
      expect(result.statusMessage).toContain(
        'ALERTA CAJA AJENA: SKU 00845436088143 no pertenece a ninguna orden del grupo'
      );
    });

    it('resuelve correctamente con la nueva lógica (Población A: Bici Válida)', () => {
      // NUEVA LOGICA:
      // 1. extractCandidateFromBarcode reconoce 14 dígitos como UPC/GTIN y NUNCA como SKU
      const extracted = extractCandidateFromBarcode(rawGtin14);
      expect(extracted.sku).toBeUndefined();
      expect(extracted.upc).toBe(upc12);
      expect(extracted.gtin).toBe(rawGtin14);

      // 2. TemporalConsensusFilter resuelve el UPC contra el catálogo determinista
      filter.pushFrame({ rawValue: rawGtin14, format: 'itf', timestamp: 1000 });
      const candidate = filter.pushFrame({ rawValue: rawGtin14, format: 'itf', timestamp: 1050 });

      expect(candidate).not.toBeNull();
      expect(candidate?.sku).toBe(expectedSku);
      expect(candidate?.upc).toBe(upc12);
      expect(candidate?.gtin).toBe(rawGtin14);
      expect(candidate?.resolvedVia).toBe('catalog_upc');

      // 3. Reconciliación asigna exitosamente a Población A
      const result = reconcileCandidate(candidate!, mockOrderItems, new Set());
      expect(result.population).toBe('A');
      expect(result.targetOrderNumber).toBe('881650');
      // La línea emparejada es la de la orden, con la grafía que la orden trae:
      // el catálogo resolvió `03-4005MN` y aun así encontró a `03-4005-MN`.
      expect(result.matchedItem?.sku).toBe(mockOrderItems[0].sku);
      expect(result.isExcess).toBe(false);
    });

    it('funciona indistintamente con código de barras UPC-A (12 dígitos)', () => {
      filter.pushFrame({ rawValue: upc12, format: 'upc_a', timestamp: 2000 });
      const candidate = filter.pushFrame({ rawValue: upc12, format: 'upc_a', timestamp: 2050 });

      expect(candidate).not.toBeNull();
      expect(candidate?.sku).toBe(expectedSku);
      expect(candidate?.resolvedVia).toBe('catalog_upc');

      const result = reconcileCandidate(candidate!, mockOrderItems, new Set());
      expect(result.population).toBe('A');
      expect(result.targetOrderNumber).toBe('881650');
    });
  });

  describe('Etiquetas Tipo A (Code 39 directo) y Tipo B (Solo UPC/GTIN)', () => {
    it('Tipo A: extrae directamente SKU desde Code 39 y lo confirma', () => {
      filter.pushFrame({ rawValue: '03-3989GY', format: 'code_39', timestamp: 3000 });
      const candidate = filter.pushFrame({
        rawValue: '03-3989GY',
        format: 'code_39',
        timestamp: 3050,
      });

      expect(candidate).not.toBeNull();
      expect(candidate?.sku).toBe('03-3989GY');
      expect(candidate?.resolvedVia).toBe('barcode_sku');

      const result = reconcileCandidate(candidate!, mockOrderItems, new Set());
      expect(result.population).toBe('A');
      expect(result.matchedItem?.sku).toBe('03-3989GY');
    });

    it('Tipo B: etiqueta sin Code 39 resuelve por catálogo determinista', () => {
      // Sequential test with another known UPC from catalog
      filter.pushFrame({ rawValue: '845436088099', format: 'upc_a', timestamp: 4000 });
      const candidate = filter.pushFrame({
        rawValue: '845436088099',
        format: 'upc_a',
        timestamp: 4050,
      });

      expect(candidate).not.toBeNull();
      expect(candidate?.sku).toBe('03-4000BL');
      expect(candidate?.resolvedVia).toBe('catalog_upc');
    });
  });

  describe('Regla de Oro: NUNCA disparar Población B sin SKU resuelto', () => {
    it('un UPC desconocido resulta en Población UNIDENTIFIED, NO en Población B', () => {
      const unknownUpc = '845436999999';

      filter.pushFrame({ rawValue: unknownUpc, format: 'upc_a', timestamp: 5000 });
      const candidate = filter.pushFrame({
        rawValue: unknownUpc,
        format: 'upc_a',
        timestamp: 5050,
      });

      expect(candidate).not.toBeNull();
      expect(candidate?.sku).toBeNull();
      expect(candidate?.upc).toBe(unknownUpc);

      const result = reconcileCandidate(candidate!, mockOrderItems, new Set());

      // NUNCA debe ser 'B'
      expect(result.population).not.toBe('B');
      expect(result.population).toBe('UNIDENTIFIED');
      expect(result.matchedItem).toBeNull();
      expect(result.statusMessage).toContain('SKU no identificado en catálogo');
    });

    it('un verdadero SKU ajeno (e.g. 99-9999ZZ) SÍ dispara Población B', () => {
      const alienCandidate: ProposedBoxCandidate = {
        sku: '99-9999ZZ',
        rawBarcode: '99-9999ZZ',
        format: 'code_39',
        serial: null,
        consecutiveFrames: 2,
        confidence: 0.9,
        firstDetectedAt: 6000,
        lastDetectedAt: 6050,
      };

      const result = reconcileCandidate(alienCandidate, mockOrderItems, new Set());
      expect(result.population).toBe('B');
      expect(result.statusMessage).toContain(
        'ALERTA CAJA AJENA: SKU 99-9999ZZ no pertenece a ninguna orden'
      );
    });
  });

  describe('Manejo de conflictos y arbitraje multi-canal', () => {
    it('UPC ambiguo con múltiples SKUs produce Población CONFLICT sin resolver en silencio', () => {
      const ambiguousCatalog = new SessionUpcCatalog();
      // Registrar un UPC a dos SKUs distintos
      ambiguousCatalog.register('845436777777', '03-1111AA');
      ambiguousCatalog.register('845436777777', '03-2222BB');

      const ambiguousFilter = new TemporalConsensusFilter(
        { requiredFrames: 2, windowMs: 600 },
        ambiguousCatalog
      );
      ambiguousFilter.pushFrame({ rawValue: '845436777777', format: 'upc_a', timestamp: 7000 });
      const candidate = ambiguousFilter.pushFrame({
        rawValue: '845436777777',
        format: 'upc_a',
        timestamp: 7050,
      });

      expect(candidate).not.toBeNull();
      expect(candidate?.sku).toBeNull();
      expect(candidate?.conflict).toContain('ambiguo: asignado a múltiples SKUs');

      const result = reconcileCandidate(candidate!, mockOrderItems, new Set());
      expect(result.population).toBe('CONFLICT');
      expect(result.statusMessage).toContain('CONFLICTO DE IDENTIDAD');
    });

    it('Arbitraje: concordancia entre barras/catálogo y OCR confirma con alta confianza', () => {
      const arbitrated = arbitrateCandidates({
        catalogSku: '03-4005-MN',
        ocrSku: '03-4005-MN',
        upc: '845436088143',
      });

      expect(arbitrated.status).toBe('resolved');
      expect(arbitrated.sku).toBe('03-4005-MN');
      expect(arbitrated.source).toBe('concordance');
    });

    it('Arbitraje: discrepancia entre barras/catálogo y OCR levanta CONFLICTO', () => {
      const arbitrated = arbitrateCandidates({
        catalogSku: '03-4005-MN',
        ocrSku: '03-3845BL',
        upc: '845436088143',
      });

      expect(arbitrated.status).toBe('conflict');
      expect(arbitrated.sku).toBeNull();
      expect(arbitrated.conflictDetail).toContain(
        'Conflicto entre canales: Barras/Catálogo (03-4005-MN) ≠ OCR (03-3845BL)'
      );
    });
  });

  describe('Funciones auxiliares de normalización', () => {
    it('isUpcOrGtin valida exactamente longitudes de 12 a 14 dígitos numéricos', () => {
      expect(isUpcOrGtin('845436088143')).toBe(true); // UPC-12
      expect(isUpcOrGtin('0845436088143')).toBe(true); // EAN-13
      expect(isUpcOrGtin('00845436088143')).toBe(true); // GTIN-14
      expect(isUpcOrGtin('03-4005-MN')).toBe(false); // SKU
      expect(isUpcOrGtin('U226U03779')).toBe(false); // Serial
      expect(isUpcOrGtin('12345')).toBe(false); // Corto
    });

    it('normalizeToUpcA normaliza GTIN-14 a UPC-12 removiendo ceros prefijos', () => {
      expect(normalizeToUpcA('00845436088143')).toBe('845436088143');
      expect(normalizeToUpcA('845436088143')).toBe('845436088143');
      expect(normalizeToUpcA('0845436088143')).toBe('845436088143');
    });
  });

  describe('persistSkuUpcMapping: aprender sin pisar el catálogo', () => {
    /** Devuelve el cliente simulado y el espía de la escritura. */
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
      return { client, update };
    };

    it('rellena el UPC cuando el SKU no tenía ninguno', async () => {
      const { client, update } = buildClient({ sku: '03-3869BL', upc: null });

      await expect(persistSkuUpcMapping(client, '03-3869BL', '845436086781')).resolves.toBe(
        'saved'
      );
      expect(client.from).toHaveBeenCalledWith('sku_metadata');
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
      // `03-4005-MN` y `03-4005MN` son la misma bici — la CITIZEN 1 Sugar Mint
      // del caso de Rafael. Buscando por `sku` tal cual, la fila no aparecía y
      // la función contestaba lo mismo que ante un SKU inexistente; la única
      // pregunta que el catálogo sabe contestar es por `sku_key`.
      const consultas: Array<[string, string]> = [];
      const update = vi.fn().mockReturnValue({
        eq: (col: string, val: string) => {
          consultas.push([col, val]);
          return { is: () => Promise.resolve({ error: null }) };
        },
      });
      const client = {
        from: vi.fn().mockReturnValue({
          select: () => ({
            eq: (col: string, val: string) => {
              consultas.push([col, val]);
              // La base sólo responde por la columna generada.
              const fila =
                col === 'sku_key' && val === '034005MN' ? { sku: '03-4005MN', upc: null } : null;
              return { maybeSingle: () => Promise.resolve({ data: fila, error: null }) };
            },
          }),
          update,
        }),
      };

      await expect(persistSkuUpcMapping(client, '03-4005-MN', '845436088143')).resolves.toBe(
        'saved'
      );
      expect(update).toHaveBeenCalledWith({ upc: '845436088143' });
      expect(consultas).toEqual([
        ['sku_key', '034005MN'],
        ['sku_key', '034005MN'],
      ]);
    });

    it('precarga asociaciones tanto de sku_metadata como de asset_tags', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'sku_metadata') {
            return {
              select: () => ({
                in: () => ({
                  not: () =>
                    Promise.resolve({
                      data: [{ sku: '03-1111AA', upc: '845436111111' }],
                      error: null,
                    }),
                }),
              }),
            };
          }
          if (table === 'asset_tags') {
            return {
              select: () => ({
                in: () => ({
                  not: () =>
                    Promise.resolve({
                      data: [{ sku: '03-2222BB', upc: '845436222222' }],
                      error: null,
                    }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      const testCat = new SessionUpcCatalog();
      await testCat.preloadFromDatabase(mockSupabase, ['03-1111AA', '03-2222BB']);

      expect(testCat.resolve('845436111111')).toEqual({
        status: 'resolved',
        sku: '03-1111AA',
        upc: '845436111111',
        source: 'session_cache',
      });
      expect(testCat.resolve('845436222222')).toEqual({
        status: 'resolved',
        sku: '03-2222BB',
        upc: '845436222222',
        source: 'session_cache',
      });
    });
  });
});
