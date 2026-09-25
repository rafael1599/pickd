import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  recognizeMultiBoxClient,
  isBarcodeAssociatedWithCluster,
} from '../recognizeMultiBoxClient';
import { readBarcodesOffThread } from '../useBarcodeReader';
import { runClientOcr, type ClientOcrResult, type OcrItem } from '../clientOcr';
import { lookupCatalogSku } from '../../../features/recognition/catalogLookup';
import realTwoBoxesFixture from './fixtures/real_two_boxes_size14_ocr.json';

vi.mock('../useBarcodeReader', () => ({
  readBarcodesOffThread: vi.fn(),
}));

vi.mock('../clientOcr', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../clientOcr')>();
  return {
    ...mod,
    runClientOcr: vi.fn(),
  };
});

vi.mock('../../../features/recognition/catalogLookup', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../features/recognition/catalogLookup')>();
  return {
    ...mod,
    lookupCatalogSku: vi.fn(),
  };
});

describe('recognizeMultiBoxClient (Sub-fase O-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isBarcodeAssociatedWithCluster', () => {
    it('associates barcode inside or near cluster bounding box', () => {
      const clusterBbox = { x: 500, y: 500, width: 300, height: 400 };
      // Barcode inside
      const insideBarcode = { x: 550, y: 600, width: 100, height: 40 };
      expect(isBarcodeAssociatedWithCluster(insideBarcode, clusterBbox)).toBe(true);

      // Barcode near border within margin
      const nearBarcode = { x: 460, y: 500, width: 80, height: 40 };
      expect(isBarcodeAssociatedWithCluster(nearBarcode, clusterBbox)).toBe(true);

      // Barcode far away on adjacent carton
      const farBarcode = { x: 950, y: 500, width: 100, height: 40 };
      expect(isBarcodeAssociatedWithCluster(farBarcode, clusterBbox)).toBe(false);
    });
  });

  describe('Real Two-Box Warehouse Scene (35e415f5: Bug Talla 14")', () => {
    it('isolates both boxes, extracts discrete attributes, and builds complete multi-box summary', async () => {
      const realItems = realTwoBoxesFixture.items as OcrItem[];

      const mockOcrResult: ClientOcrResult = {
        lines: [realItems],
        fullText: realItems.map((i) => i.text).join(' '),
        extracted: {
          sku: '03-3858BL',
          model: 'ALLEGRO A3', // Demonstrates legacy global unsegmented failure
          size: null,
          color: 'DEEP BLUE',
          upc: null,
          gtin: null,
          gw_kg: 14.44,
          serial: null,
        },
        elapsedMs: 380,
        imageDimensions: { width: 1500, height: 2000 },
      };

      vi.mocked(readBarcodesOffThread).mockResolvedValueOnce([]);
      vi.mocked(runClientOcr).mockResolvedValueOnce(mockOcrResult);

      // Mock catalog lookup for 03-3858BL
      vi.mocked(lookupCatalogSku).mockImplementation(async (sku) => {
        if (sku.includes('3858')) {
          return {
            status: 'found',
            sku: '03-3858BL',
            data: {
              sku: '03-3858BL',
              source: 'catalog',
              model: 'DXT A1 STEP-OVER',
              size: '18',
              color: 'DEEP BLUE',
              isBike: true,
              as400Description: 'DXT A1 18 DEEP BLUE',
              totalStock: 5,
              inStock: true,
              stockLocations: [{ location: 'ROW 10', quantity: 5 }],
            },
          };
        }
        return { status: 'not_found', sku, data: null };
      });

      const dummyBlob = new Blob(['two-boxes-test'], { type: 'image/jpeg' });
      const result = await recognizeMultiBoxClient(dummyBlob, '35e415f5-image.jpg', {
        catalog: lookupCatalogSku,
      });

      // 1. Boxes count
      expect(result.totalBoxes).toBeGreaterThanOrEqual(2);

      // 2. Identify Box with 03-3858BL (Left Box)
      const leftBox = result.boxes.find((b) => b.sku.photoValue === '03-3858BL');
      expect(leftBox).toBeDefined();
      expect(leftBox!.sku.source).toBe('ocr:pp-ocrv6');
      expect(leftBox!.model.photoValue).toBe('DXT A1 STEP-OVER');
      expect(leftBox!.model.status).toBe('match'); // Matches catalog DXT A1 STEP-OVER
      expect(leftBox!.size.photoValue).toBe('700Cx18"');
      expect(leftBox!.size.status).toBe('match'); // Matches catalog 18
      expect(leftBox!.color.photoValue).toBe('DEEP BLUE');
      expect(leftBox!.color.status).toBe('match'); // Matches catalog DEEP BLUE
      expect(leftBox!.gw_kg.value).toBe(14.44);
      expect(leftBox!.serial.value).toBe('M22F008455');
      expect(leftBox!.catalogStatus).toBe('found');

      // STRICT ISOLATION: Left box must NOT have size 14" or Sugar Mint!
      expect(leftBox!.size.photoValue).not.toBe('14"');
      expect(leftBox!.color.photoValue).not.toBe('SUGAR MINT');
      expect(leftBox!.model.photoValue).not.toBe('ALLEGRO A3');

      // 3. Identify Box with Allegro A3 (Right Box)
      const rightBox = result.boxes.find(
        (b) => b.model.photoValue === 'ALLEGRO A3' || b.bbox.x > 800
      );
      expect(rightBox).toBeDefined();
      expect(rightBox!.model.photoValue).toBe('ALLEGRO A3');
      expect(rightBox!.size.photoValue).toBe('14"');
      expect(rightBox!.color.photoValue).toBe('SUGAR MINT');
      expect(rightBox!.model.status).toBe('photo_only');
      expect(rightBox!.size.status).toBe('photo_only');

      // STRICT ISOLATION: Right box must NOT steal 03-3858BL or 700Cx18"!
      expect(rightBox!.sku.photoValue).toBeNull();
      expect(rightBox!.size.photoValue).not.toBe('700Cx18"');
      expect(rightBox!.color.photoValue).not.toBe('DEEP BLUE');

      // 4. Summary Text validation
      expect(result.summaryText).toContain('=== RECONOCIMIENTO MULTI-CAJA');
      expect(result.summaryText).toContain('Foto: 35e415f5-image.jpg');
      expect(result.summaryText).toContain('SKU: 03-3858BL');
      expect(result.summaryText).toContain('Modelo: DXT A1 STEP-OVER [COINCIDE CON FOTO]');
      expect(result.summaryText).toContain('Talla: 700Cx18" [COINCIDE CON FOTO]');
      expect(result.summaryText).toContain('Color: DEEP BLUE [COINCIDE CON FOTO]');
      expect(result.summaryText).toContain('Modelo: ALLEGRO A3 [FOTO ONLY]');
      expect(result.summaryText).toContain('Talla: 14" [FOTO ONLY]');
      expect(result.summaryText).toContain('Color: SUGAR MINT [FOTO ONLY]');
    });
  });

  describe('Discrepancy Signal Preservation (Point 3: Catálogo vs Foto)', () => {
    it('flags explicit discrepancy when catalog says 23" and photo says 14"', async () => {
      const singleBoxItems: OcrItem[] = [
        { text: '01-0448', box: { x: 100, y: 100, width: 200, height: 35 }, confidence: 0.99 },
        { text: 'ALLEGRO A3', box: { x: 100, y: 150, width: 250, height: 35 }, confidence: 0.98 },
        { text: 'SIZE: 14"', box: { x: 100, y: 200, width: 150, height: 35 }, confidence: 0.97 },
      ];

      const mockOcrResult: ClientOcrResult = {
        lines: [singleBoxItems],
        fullText: singleBoxItems.map((i) => i.text).join('\n'),
        extracted: {
          sku: '01-0448',
          model: 'ALLEGRO A3',
          size: '14"',
          color: null,
          upc: null,
          gtin: null,
          gw_kg: null,
          serial: null,
        },
        elapsedMs: 210,
      };

      vi.mocked(readBarcodesOffThread).mockResolvedValueOnce([]);
      vi.mocked(runClientOcr).mockResolvedValueOnce(mockOcrResult);

      // Catalog has size 23" for this SKU (conflicting with photo's 14"!)
      vi.mocked(lookupCatalogSku).mockResolvedValueOnce({
        status: 'found',
        sku: '01-0448',
        data: {
          sku: '01-0448',
          source: 'catalog',
          model: 'ALLEGRO A3',
          size: '23',
          color: 'SUGAR MINT',
          isBike: true,
          as400Description: 'ALLEGRO A3 23 SUGAR MINT',
          totalStock: 2,
          inStock: true,
          stockLocations: [{ location: 'ROW 12', quantity: 2 }],
        },
      });

      const dummyBlob = new Blob(['discrepancy-test'], { type: 'image/jpeg' });
      const result = await recognizeMultiBoxClient(dummyBlob, 'discrepancy-test.jpg', {
        catalog: lookupCatalogSku,
      });

      expect(result.totalBoxes).toBe(1);
      const box = result.boxes[0];

      // Discrepancy detected and preserved!
      expect(box.size.status).toBe('discrepancy');
      expect(box.size.photoValue).toBe('14"');
      expect(box.size.catalogValue).toBe('23');
      expect(box.size.discrepancyDetail).toContain('Catálogo dice "23", foto dice "14""');

      expect(result.discrepanciesCount).toBe(1);

      // Warning block in summaryText
      expect(result.summaryText).toContain('DISCREPANCIA: catálogo="23", foto="14""');
      expect(result.summaryText).toContain('⚠️ DISCREPANCIAS DETECTADAS (FOTO VS CATÁLOGO)');
      expect(result.summaryText).toContain('Caja 1, Talla: Catálogo dice "23", foto dice "14""');
    });
  });

  describe('Single-box Scene (Zero regression on single carton)', () => {
    it('returns totalBoxes: 1 for single-box capture', async () => {
      const items14: OcrItem[] = [
        { text: '09-4807CL', box: { x: 50, y: 50, width: 180, height: 30 }, confidence: 0.99 },
        {
          text: 'MODEL: RENEGADE S1 FRAMEKIT',
          box: { x: 50, y: 100, width: 320, height: 30 },
          confidence: 0.98,
        },
        {
          text: 'SIZE: 700C x 54cm',
          box: { x: 50, y: 150, width: 220, height: 30 },
          confidence: 0.97,
        },
      ];

      vi.mocked(readBarcodesOffThread).mockResolvedValueOnce([]);
      vi.mocked(runClientOcr).mockResolvedValueOnce({
        lines: [items14],
        fullText: items14.map((i) => i.text).join('\n'),
        extracted: {
          sku: '09-4807CL',
          model: 'RENEGADE S1 FRAMEKIT',
          size: '700C x 54cm',
          color: null,
          upc: null,
          gtin: null,
          gw_kg: null,
          serial: null,
        },
        elapsedMs: 250,
      });

      vi.mocked(lookupCatalogSku).mockResolvedValueOnce({
        status: 'not_found',
        sku: '09-4807CL',
        data: null,
      });

      const dummyBlob = new Blob(['single-box'], { type: 'image/jpeg' });
      const result = await recognizeMultiBoxClient(dummyBlob, 'renegade.jpg', {
        catalog: lookupCatalogSku,
      });

      expect(result.totalBoxes).toBe(1);
      expect(result.boxes[0].sku.photoValue).toBe('09-4807CL');
      expect(result.boxes[0].model.photoValue).toBe('RENEGADE S1 FRAMEKIT');
      expect(result.boxes[0].size.photoValue).toBe('700C x 54cm');
    });
  });

  describe('catalog: false (la sombra de DCV y el banco)', () => {
    it('never asks the catalogue and marks every box skipped', async () => {
      const items: OcrItem[] = [
        { text: '09-4807CL', box: { x: 50, y: 50, width: 180, height: 30 }, confidence: 0.99 },
        {
          text: 'MODEL: RENEGADE S1 FRAMEKIT',
          box: { x: 50, y: 100, width: 320, height: 30 },
          confidence: 0.98,
        },
      ];
      vi.mocked(readBarcodesOffThread).mockResolvedValueOnce([]);
      vi.mocked(runClientOcr).mockResolvedValueOnce({
        lines: [items],
        fullText: items.map((i) => i.text).join('\n'),
        extracted: {
          sku: '09-4807CL',
          model: 'RENEGADE S1 FRAMEKIT',
          size: null,
          color: null,
          upc: null,
          gtin: null,
          gw_kg: null,
          serial: null,
        },
        elapsedMs: 250,
      });
      vi.mocked(lookupCatalogSku).mockClear();

      const result = await recognizeMultiBoxClient(new Blob(['x']), 'shadow.jpg', {
        catalog: false,
      });

      expect(lookupCatalogSku).not.toHaveBeenCalled();
      expect(result.boxes[0].sku.photoValue).toBe('09-4807CL');
      expect(result.boxes[0].catalogStatus).toBe('skipped');
    });
  });
});
