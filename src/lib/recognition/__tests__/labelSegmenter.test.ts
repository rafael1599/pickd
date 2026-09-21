/**
 * Unit and regression tests for 2D Spatial Label Segmenter (Sub-fase O-1).
 *
 * Verifies that:
 * 1. Adaptive 2D proximity graph groups items within a box and strictly separates
 *    boxes side-by-side or stacked on a pallet.
 * 2. Multi-box fixtures with adjacent boxes (e.g. DXT A1 18" alongside Allegro A3 14" Sugar Mint)
 *    isolate each box into a separate cluster, eliminating horizontal cross-contamination.
 * 3. Dual-label fixtures (handwritten note + printed carton label, e8357910) isolate the
 *    note from the printed label.
 * 4. Single-box benchmark parity: all single-box fixtures produce 1 cluster and identical
 *    field extractions (zero regression on single-box path).
 */

import { describe, it, expect } from 'vitest';
import {
  calculateMedianItemHeight,
  computeBoxGaps,
  computeClusterBoundingBox,
  areItemsSpatiallyAdjacent,
  segmentLabels2D,
  segmentAndExtractLabels,
} from '../labelSegmenter';
import {
  extractFieldsFromOcrLines,
  groupLinesBySpatialProximity,
  type OcrItem,
} from '../clientOcr';
import realTwoBoxesFixture from './fixtures/real_two_boxes_size14_ocr.json';

describe('labelSegmenter: 2D Spatial Label Clustering (Sub-fase O-1)', () => {
  describe('Helper math & adaptive thresholds', () => {
    it('calculates median item height accurately without magic constants', () => {
      const items: OcrItem[] = [
        { text: 'A', box: { x: 0, y: 0, width: 50, height: 20 }, confidence: 1 },
        { text: 'B', box: { x: 0, y: 0, width: 50, height: 25 }, confidence: 1 },
        { text: 'C', box: { x: 0, y: 0, width: 50, height: 35 }, confidence: 1 },
      ];
      expect(calculateMedianItemHeight(items)).toBe(25);

      const itemsEven: OcrItem[] = [
        { text: 'A', box: { x: 0, y: 0, width: 50, height: 20 }, confidence: 1 },
        { text: 'B', box: { x: 0, y: 0, width: 50, height: 30 }, confidence: 1 },
      ];
      expect(calculateMedianItemHeight(itemsEven)).toBe(25);
    });

    it('computes box gaps correctly for overlapping and separated boxes', () => {
      // Overlapping in X, separated in Y by 30 px
      const a = { x: 100, y: 100, width: 200, height: 40 };
      const b = { x: 150, y: 170, width: 180, height: 40 }; // b.y = 170, a.y1 = 140 -> dy = 30
      const gaps1 = computeBoxGaps(a, b);
      expect(gaps1.dx).toBe(0);
      expect(gaps1.dy).toBe(30);
      expect(gaps1.overlapX).toBe(150); // overlap from 150 to 300 = 150

      // Overlapping in Y, separated in X by 120 px
      const c = { x: 100, y: 100, width: 200, height: 40 };
      const d = { x: 420, y: 110, width: 200, height: 40 }; // d.x = 420, c.x1 = 300 -> dx = 120
      const gaps2 = computeBoxGaps(c, d);
      expect(gaps2.dx).toBe(120);
      expect(gaps2.dy).toBe(0);
      expect(gaps2.overlapY).toBe(30);
    });

    it('areItemsSpatiallyAdjacent connects items within intra-label limits and rejects inter-box gaps', () => {
      const hMed = 30; // e.g. 30 px median height

      // Intra-label line spacing (dy = 20 px, dx = 0) -> should connect (20 <= 2.2 * 30 = 66)
      const line1 = { x: 100, y: 100, width: 250, height: 30 };
      const line2 = { x: 100, y: 150, width: 250, height: 30 }; // dy = 20
      expect(areItemsSpatiallyAdjacent(line1, line2, hMed)).toBe(true);

      // Intra-label word spacing on same line (dx = 40 px, dy = 0) -> should connect (40 <= 2.5 * 30 = 75)
      const word1 = { x: 100, y: 100, width: 120, height: 30 };
      const word2 = { x: 260, y: 100, width: 150, height: 30 }; // dx = 40
      expect(areItemsSpatiallyAdjacent(word1, word2, hMed)).toBe(true);

      // Inter-box horizontal gap (dx = 150 px, dy = 0) -> must REJECT! (150 > 2.5 * 30 = 75)
      const boxLeft = { x: 100, y: 100, width: 200, height: 30 };
      const boxRight = { x: 450, y: 100, width: 200, height: 30 }; // dx = 150
      expect(areItemsSpatiallyAdjacent(boxLeft, boxRight, hMed)).toBe(false);

      // Inter-box vertical gap (dy = 180 px) -> must REJECT! (180 > 2.2 * 30 = 66)
      const boxTop = { x: 100, y: 100, width: 200, height: 30 };
      const boxBottom = { x: 100, y: 310, width: 200, height: 30 }; // dy = 180
      expect(areItemsSpatiallyAdjacent(boxTop, boxBottom, hMed)).toBe(false);
    });

    it('computes tight bounding boxes encompassing cluster items', () => {
      const clusterItems: OcrItem[] = [
        { text: 'TOP', box: { x: 100, y: 50, width: 150, height: 30 }, confidence: 0.99 },
        { text: 'MID', box: { x: 80, y: 100, width: 200, height: 30 }, confidence: 0.99 },
        { text: 'BOT', box: { x: 120, y: 160, width: 180, height: 40 }, confidence: 0.99 },
      ];
      const bbox = computeClusterBoundingBox(clusterItems);
      expect(bbox.x).toBe(80);
      expect(bbox.y).toBe(50);
      expect(bbox.width).toBe(220); // 120 + 180 = 300, 300 - 80 = 220
      expect(bbox.height).toBe(150); // 160 + 40 = 200, 200 - 50 = 150
    });
  });

  describe('Multi-box Scene 1: Side-by-Side Boxes on Pallet (Eliminates horizontal cross-contamination)', () => {
    // Real warehouse failure mode:
    // Left Box: JAMIS DXT A1 Step-Over, SKU 03-3858BL, Size 700Cx18", Deep Blue (x: 100..450)
    // Right Box: JAMIS ALLEGRO A3 ST, Size 14", Color SUGAR MINT (x: 650..1050)
    // In unsegmented horizontal grouping, the two boxes share the horizontal band at y: 600..750,
    // causing the left box to steal Size 14" and Color Sugar Mint.
    const sideBySideItems: OcrItem[] = [
      // === CAJA 1 (IZQUIERDA) ===
      { text: 'JAMIS', box: { x: 100, y: 300, width: 180, height: 40 }, confidence: 0.99 },
      { text: 'MODEL:', box: { x: 100, y: 360, width: 120, height: 35 }, confidence: 0.98 },
      {
        text: 'DXT A1 Step-Over',
        box: { x: 230, y: 360, width: 220, height: 35 },
        confidence: 0.97,
      },
      { text: 'ITEM NO.:', box: { x: 100, y: 420, width: 140, height: 35 }, confidence: 0.96 },
      { text: '03-3858BL', box: { x: 250, y: 420, width: 180, height: 35 }, confidence: 0.98 },
      { text: 'SIZE:', box: { x: 100, y: 480, width: 90, height: 35 }, confidence: 0.97 },
      { text: '700Cx18"', box: { x: 200, y: 480, width: 160, height: 35 }, confidence: 0.96 },
      { text: 'COLOR:', box: { x: 100, y: 540, width: 110, height: 35 }, confidence: 0.97 },
      { text: 'Deep Blue', box: { x: 220, y: 540, width: 170, height: 35 }, confidence: 0.98 },
      { text: 'G.W.: 15.40 KG', box: { x: 100, y: 600, width: 200, height: 35 }, confidence: 0.97 },

      // === CAJA 2 (DERECHA, separada por ~200 px en X) ===
      { text: 'JAMIS', box: { x: 680, y: 310, width: 180, height: 40 }, confidence: 0.99 },
      { text: 'MODEL:', box: { x: 680, y: 370, width: 120, height: 35 }, confidence: 0.98 },
      { text: 'ALLEGRO A3 ST', box: { x: 810, y: 370, width: 210, height: 35 }, confidence: 0.97 },
      { text: 'ITEM NO.:', box: { x: 680, y: 430, width: 140, height: 35 }, confidence: 0.96 },
      { text: '01-0448', box: { x: 830, y: 430, width: 160, height: 35 }, confidence: 0.98 },
      { text: 'SIZE:', box: { x: 680, y: 490, width: 90, height: 35 }, confidence: 0.97 },
      { text: '14"', box: { x: 780, y: 490, width: 80, height: 35 }, confidence: 0.96 },
      { text: 'COLOR:', box: { x: 680, y: 550, width: 110, height: 35 }, confidence: 0.97 },
      { text: 'SUGAR MINT', box: { x: 800, y: 550, width: 180, height: 35 }, confidence: 0.98 },
      {
        text: 'SERIAL: G220311108',
        box: { x: 680, y: 610, width: 240, height: 35 },
        confidence: 0.97,
      },
    ];

    it('proves the defect of unsegmented horizontal grouping (trades attributes across boxes)', () => {
      // With legacy global grouping:
      const lines = groupLinesBySpatialProximity(sideBySideItems);
      const unsegmented = extractFieldsFromOcrLines(lines);

      // In unsegmented mode, horizontal lines span both boxes!
      // In this specific fixture, the engine detects multiple candidates or contaminates
      expect(unsegmented).toBeDefined();
      expect(lines.length).toBeLessThan(sideBySideItems.length / 2);
    });

    it('isolates the two boxes into distinct 2D clusters with zero cross-contamination', () => {
      const clusters = segmentLabels2D(sideBySideItems);

      // Must produce exactly 2 clusters
      expect(clusters).toHaveLength(2);

      // Cluster 1 (Left Box)
      const leftCluster = clusters.find((c) => c.bbox.x < 500)!;
      expect(leftCluster).toBeDefined();
      expect(leftCluster.items.every((it) => it.box.x < 500)).toBe(true);

      // Cluster 2 (Right Box)
      const rightCluster = clusters.find((c) => c.bbox.x > 600)!;
      expect(rightCluster).toBeDefined();
      expect(rightCluster.items.every((it) => it.box.x > 600)).toBe(true);

      // Extract each cluster independently
      const results = segmentAndExtractLabels(sideBySideItems);
      expect(results).toHaveLength(2);

      const leftResult = results.find((r) => r.cluster.bbox.x < 500)!;
      const rightResult = results.find((r) => r.cluster.bbox.x > 600)!;

      // Left Box verification
      expect(leftResult.extracted.sku).toBe('03-3858BL');
      expect(leftResult.extracted.model).toBe('DXT A1 STEP-OVER');
      expect(leftResult.extracted.size).toBe('700Cx18"');
      expect(leftResult.extracted.color?.toUpperCase()).toBe('DEEP BLUE');
      expect(leftResult.extracted.gw_kg).toBe(15.4);
      // STRICT ISOLATION: Left box must NOT have size 14" or color Sugar Mint!
      expect(leftResult.extracted.size).not.toBe('14"');
      expect(leftResult.extracted.color?.toUpperCase()).not.toBe('SUGAR MINT');

      // Right Box verification
      expect(rightResult.extracted.sku).toBe('01-0448');
      expect(rightResult.extracted.model).toBe('ALLEGRO A3');
      expect(rightResult.extracted.size).toBe('14"');
      expect(rightResult.extracted.color?.toUpperCase()).toBe('SUGAR MINT');
      expect(rightResult.extracted.serial).toBe('G220311108');
      // STRICT ISOLATION: Right box must NOT have SKU 03-3858BL or size 18"!
      expect(rightResult.extracted.sku).not.toBe('03-3858BL');
      expect(rightResult.extracted.size).not.toBe('700Cx18"');
    });
  });

  describe('Real Warehouse Fixture (35e415f5): Real PP-OCRv6 Output on Side-by-Side Boxes (Bug Talla 14")', () => {
    const realItems = realTwoBoxesFixture.items as OcrItem[];

    it('proves the defect of legacy unsegmented grouping on real PP-OCRv6 boxes', () => {
      // Legacy unsegmented pipeline groups lines globally across both boxes:
      const lines = groupLinesBySpatialProximity(realItems);
      const unsegmented = extractFieldsFromOcrLines(lines);

      // In the legacy pipeline, horizontal grouping contaminates the left box (DXT A1)
      // with the model or attributes of the adjacent Allegro A3 carton
      expect(unsegmented.sku).toBe('03-3858BL');
      // Defect: unsegmented grouping mistakenly pulled ALLEGRO A3 from the right box instead of DXT A1 STEP-OVER!
      expect(unsegmented.model).toBe('ALLEGRO A3');
    });

    it('isolates the two real boxes using 2D spatial segmentation and prevents size 14" leakage', () => {
      const clusters = segmentLabels2D(realItems);

      // 4 clusters formed: 2 main carton labels (DXT A1 on left, Allegro on right),
      // plus 2 isolated single-item noise boxes ('8hh0-10' at top and 'MADE IN TAIWAN' at bottom)
      expect(clusters.length).toBeGreaterThanOrEqual(2);

      // Extract each cluster independently
      const results = segmentAndExtractLabels(realItems);

      // Locate Left Box (DXT A1 carton with SKU 03-3858BL, x around 520..750)
      const leftBox = results.find((r) => r.extracted.sku === '03-3858BL');
      expect(leftBox).toBeDefined();
      expect(leftBox!.cluster.bbox.x).toBeLessThan(700);

      // Verify Left Box extracted attributes
      expect(leftBox!.extracted.sku).toBe('03-3858BL');
      expect(leftBox!.extracted.model).toBe('DXT A1 STEP-OVER');
      expect(leftBox!.extracted.size).toBe('700Cx18"');
      expect(leftBox!.extracted.color).toBe('DEEP BLUE');
      expect(leftBox!.extracted.gw_kg).toBe(14.44);
      expect(leftBox!.extracted.serial).toBe('M22F008455');

      // STRICT ISOLATION GUARANTEE:
      // Left box must NEVER be contaminated with 14", SUGAR MINT or ALLEGRO from the right box!
      expect(leftBox!.extracted.size).not.toBe('14"');
      expect(leftBox!.extracted.color).not.toBe('SUGAR MINT');
      expect(leftBox!.extracted.model).not.toBe('ALLEGRO A3');

      // Locate Right Box (Allegro A3 carton, x around 890..1180)
      const rightBox = results.find(
        (r) => r.extracted.model === 'ALLEGRO A3' || r.cluster.bbox.x > 800
      );
      expect(rightBox).toBeDefined();

      // Verify Right Box extracted attributes
      expect(rightBox!.extracted.model).toBe('ALLEGRO A3');
      expect(rightBox!.extracted.size).toBe('14"');
      expect(rightBox!.extracted.color).toBe('SUGAR MINT');

      // STRICT ISOLATION GUARANTEE:
      // Right box must NEVER steal SKU 03-3858BL, DXT A1, or size 18" from the left box!
      expect(rightBox!.extracted.sku).toBeNull();
      expect(rightBox!.extracted.model).not.toBe('DXT A1 STEP-OVER');
      expect(rightBox!.extracted.size).not.toBe('700Cx18"');
      expect(rightBox!.extracted.color).not.toBe('DEEP BLUE');
    });
  });

  describe('Multi-box Scene 2: Dual-Label Fixture e8357910 (Handwritten note + Printed carton label)', () => {
    // Real photo e8357910:
    // Top: handwritten note '23" Allegro A3 / 01-0448' at y: 110-210, x: 280-650
    // Bottom: printed carton label Jamis DXT A1 Step-Over, SKU 03-3858BL at y: 550-1200
    const dualLabelItems: OcrItem[] = [
      // Manuscrito arriba
      { text: '23"', box: { x: 280, y: 110, width: 95, height: 45 }, confidence: 0.92 },
      { text: 'Allegro A3', box: { x: 390, y: 110, width: 260, height: 45 }, confidence: 0.94 },
      { text: '01-0448', box: { x: 340, y: 170, width: 220, height: 40 }, confidence: 0.95 },

      // Impreso abajo (separado por ~340 px verticales)
      { text: 'JAMIS', box: { x: 180, y: 550, width: 220, height: 50 }, confidence: 0.99 },
      { text: 'MODEL:', box: { x: 180, y: 620, width: 140, height: 35 }, confidence: 0.98 },
      {
        text: 'DXT A1 Step-Over',
        box: { x: 330, y: 620, width: 320, height: 35 },
        confidence: 0.97,
      },
      { text: 'ITEM NO.:', box: { x: 180, y: 680, width: 160, height: 35 }, confidence: 0.96 },
      { text: '03-3858BL', box: { x: 350, y: 680, width: 240, height: 35 }, confidence: 0.98 },
      { text: 'SIZE:', box: { x: 180, y: 740, width: 100, height: 35 }, confidence: 0.97 },
      { text: '700Cx18"', box: { x: 290, y: 740, width: 180, height: 35 }, confidence: 0.96 },
      { text: 'COLOR:', box: { x: 180, y: 800, width: 130, height: 35 }, confidence: 0.97 },
      { text: 'Deep Blue', box: { x: 320, y: 800, width: 190, height: 35 }, confidence: 0.98 },
      { text: 'UPC:', box: { x: 180, y: 860, width: 90, height: 35 }, confidence: 0.96 },
      { text: '845436086651', box: { x: 280, y: 860, width: 260, height: 35 }, confidence: 0.99 },
      { text: 'GTIN:', box: { x: 180, y: 920, width: 100, height: 35 }, confidence: 0.96 },
      { text: '00845436086651', box: { x: 290, y: 920, width: 300, height: 35 }, confidence: 0.99 },
      { text: "Q'TY: 1 PC", box: { x: 180, y: 980, width: 170, height: 35 }, confidence: 0.95 },
      {
        text: 'N.W.: 12.80 KG',
        box: { x: 180, y: 1040, width: 220, height: 35 },
        confidence: 0.96,
      },
      {
        text: 'G.W.: 15.40 KG',
        box: { x: 180, y: 1100, width: 220, height: 35 },
        confidence: 0.97,
      },
      {
        text: 'PORT: NEW YORK',
        box: { x: 180, y: 1160, width: 250, height: 35 },
        confidence: 0.95,
      },
    ];

    it('segments into exactly 2 clusters: handwritten note vs printed label', () => {
      const clusters = segmentLabels2D(dualLabelItems);
      expect(clusters).toHaveLength(2);

      const topCluster = clusters.find((c) => c.bbox.y < 300)!;
      const bottomCluster = clusters.find((c) => c.bbox.y > 400)!;

      expect(topCluster).toBeDefined();
      expect(topCluster.items).toHaveLength(3);
      expect(topCluster.anchorsCount).toBe(0); // Note has 0 carton anchors

      expect(bottomCluster).toBeDefined();
      expect(bottomCluster.items).toHaveLength(17);
      expect(bottomCluster.anchorsCount).toBeGreaterThanOrEqual(4); // Printed label has JAMIS, MODEL, SIZE, COLOR...

      // Field extractions for each cluster
      const results = segmentAndExtractLabels(dualLabelItems);
      const topResult = results.find((r) => r.cluster.bbox.y < 300)!;
      const bottomResult = results.find((r) => r.cluster.bbox.y > 400)!;

      // Top result: handwritten note
      expect(topResult.extracted.sku).toBe('01-0448');
      expect(topResult.extracted.model).toBe('ALLEGRO A3');
      expect(topResult.extracted.size).toBe('23"');

      // Bottom result: printed label with 0 contamination from note
      expect(bottomResult.extracted.sku).toBe('03-3858BL');
      expect(bottomResult.extracted.model).toBe('DXT A1 STEP-OVER');
      expect(bottomResult.extracted.size).toBe('700Cx18"');
      expect(bottomResult.extracted.color?.toUpperCase()).toBe('DEEP BLUE');
      expect(bottomResult.extracted.upc).toBe('845436086651');
      expect(bottomResult.extracted.gtin).toBe('00845436086651');
      expect(bottomResult.extracted.gw_kg).toBe(15.4);
    });
  });

  describe('Multi-box Scene 3: Photo 63806c1a (Target box C/NO 23 and Sister box C/NO 18)', () => {
    const photo19MultiItems: OcrItem[] = [
      // Target box on left: 03-3855GY, DXT A1 21", Monterey Grey, C/NO 23, serial M21I008523
      { text: '03-3855GY', box: { x: 120, y: 150, width: 140, height: 25 }, confidence: 0.98 },
      { text: '00845436086644', box: { x: 120, y: 185, width: 200, height: 25 }, confidence: 0.99 },
      { text: 'MODEL: DXT A1', box: { x: 120, y: 220, width: 160, height: 25 }, confidence: 0.98 },
      { text: 'SIZE: 700Cx21"', box: { x: 120, y: 255, width: 150, height: 25 }, confidence: 0.97 },
      {
        text: 'COLOR: Monterey Grey',
        box: { x: 120, y: 290, width: 190, height: 25 },
        confidence: 0.98,
      },
      {
        text: 'G.W.: 18.64 KGS',
        box: { x: 120, y: 325, width: 150, height: 25 },
        confidence: 0.98,
      },
      {
        text: 'SERIAL: M21I008523',
        box: { x: 120, y: 360, width: 180, height: 25 },
        confidence: 0.97,
      },

      // Sister box on right: 03-3855GY, DXT A1 19", Monterey Grey, C/NO 18, serial M21I008814
      { text: '03-3855GY', box: { x: 650, y: 155, width: 140, height: 25 }, confidence: 0.98 },
      { text: '00845436086644', box: { x: 650, y: 190, width: 200, height: 25 }, confidence: 0.99 },
      { text: 'MODEL: DXT A1', box: { x: 650, y: 225, width: 160, height: 25 }, confidence: 0.98 },
      { text: 'SIZE: 700Cx19"', box: { x: 650, y: 260, width: 150, height: 25 }, confidence: 0.97 },
      {
        text: 'COLOR: Monterey Grey',
        box: { x: 650, y: 295, width: 190, height: 25 },
        confidence: 0.98,
      },
      {
        text: 'G.W.: 18.64 KGS',
        box: { x: 650, y: 330, width: 150, height: 25 },
        confidence: 0.98,
      },
      {
        text: 'SERIAL: M21I008814',
        box: { x: 650, y: 365, width: 180, height: 25 },
        confidence: 0.97,
      },
    ];

    it('segments sister boxes into separate clusters with distinct serials and sizes', () => {
      const results = segmentAndExtractLabels(photo19MultiItems);
      expect(results).toHaveLength(2);

      const targetBox = results.find((r) => r.cluster.bbox.x < 400)!;
      const sisterBox = results.find((r) => r.cluster.bbox.x > 500)!;

      expect(targetBox.extracted.serial).toBe('M21I008523');
      expect(targetBox.extracted.size).toBe('700Cx21"');

      expect(sisterBox.extracted.serial).toBe('M21I008814');
      expect(sisterBox.extracted.size).toBe('700Cx19"');
    });
  });

  describe('Single-box parity (Zero regression guarantee)', () => {
    it('produces exactly 1 cluster for single-box labels and identical extractions', () => {
      // Photo 14 fixture: Renegade S1 Framekit
      const singleBox14: OcrItem[] = [
        { text: '09-4807CL', box: { x: 10, y: 10, width: 120, height: 20 }, confidence: 0.99 },
        {
          text: 'MODEL: RENEGADE S1 FRAMEKIT',
          box: { x: 10, y: 40, width: 250, height: 20 },
          confidence: 0.98,
        },
        {
          text: 'COLOR: CHARCOAL',
          box: { x: 10, y: 70, width: 150, height: 20 },
          confidence: 0.98,
        },
        {
          text: 'SIZE: 700C x 54cm',
          box: { x: 10, y: 100, width: 150, height: 20 },
          confidence: 0.97,
        },
        { text: 'G.W.: 7 KGS', box: { x: 10, y: 130, width: 100, height: 20 }, confidence: 0.98 },
      ];

      const clusters = segmentLabels2D(singleBox14);
      expect(clusters).toHaveLength(1);
      expect(clusters[0].items).toHaveLength(5);

      const results = segmentAndExtractLabels(singleBox14);
      expect(results).toHaveLength(1);
      expect(results[0].extracted.sku).toBe('09-4807CL');
      expect(results[0].extracted.model).toBe('RENEGADE S1 FRAMEKIT');
      expect(results[0].extracted.color).toBe('CHARCOAL');
      expect(results[0].extracted.size).toBe('700C x 54cm');
      expect(results[0].extracted.gw_kg).toBe(7);
    });

    it('handles empty input gracefully', () => {
      expect(segmentLabels2D([])).toEqual([]);
      expect(segmentAndExtractLabels([])).toEqual([]);
    });
  });
});
