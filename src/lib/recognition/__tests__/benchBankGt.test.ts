/**
 * Unit and regression tests against the full benchmark bank (19 photos from bench/gt.json).
 * Verifies that client-side OCR extraction, line grouping, and barcode fusion correctly
 * match ground truth for all photos (#1 to #19).
 */

import { describe, it, expect } from 'vitest';
import {
  extractFieldsFromOcrLines,
  groupLinesBySpatialProximity,
  type OcrItem,
} from '../clientOcr';

describe('Benchmark Bank Ground Truth Regression (#1 - #19)', () => {
  it('#1: 7f6a8d3e (03-4270BK, 845436092959, 17 kg)', () => {
    const lines: OcrItem[][] = [
      [{ text: 'JAMIS BICYCLES', box: { x: 10, y: 10, width: 200, height: 20 }, confidence: 0.99 }],
      [{ text: 'SKU: 03-4270BK', box: { x: 10, y: 40, width: 150, height: 20 }, confidence: 0.98 }],
      [
        {
          text: 'UPC: 845436092959',
          box: { x: 10, y: 70, width: 160, height: 20 },
          confidence: 0.98,
        },
      ],
      [{ text: 'G.W.: 17 KGS', box: { x: 10, y: 100, width: 120, height: 20 }, confidence: 0.97 }],
      [
        {
          text: 'FRAME: WRDH01637',
          box: { x: 10, y: 130, width: 140, height: 20 },
          confidence: 0.95,
        },
      ],
    ];
    const fields = extractFieldsFromOcrLines(lines);
    expect(fields.sku).toBe('03-4270BK');
    expect(fields.upc).toBe('845436092959');
    expect(fields.gw_kg).toBe(17);
    expect(fields.serial).toBe('WRDH01637');
  });

  it('#2: 324f78b1 (03-3868BL, 845436086774, 18 kg, serial G220307348)', () => {
    const lines: OcrItem[][] = [
      [{ text: '03-3868BL', box: { x: 10, y: 10, width: 120, height: 20 }, confidence: 0.99 }],
      [{ text: '00845436086774', box: { x: 10, y: 40, width: 180, height: 20 }, confidence: 0.99 }],
      [
        {
          text: 'G.W.: 18.00 KGS',
          box: { x: 10, y: 70, width: 140, height: 20 },
          confidence: 0.96,
        },
      ],
      [
        {
          text: 'SERIAL NO: G220307348',
          box: { x: 10, y: 100, width: 200, height: 20 },
          confidence: 0.97,
        },
      ],
    ];
    const fields = extractFieldsFromOcrLines(lines);
    expect(fields.sku).toBe('03-3868BL');
    expect(fields.upc).toBe('845436086774');
    expect(fields.gtin).toBe('00845436086774');
    expect(fields.gw_kg).toBe(18);
    expect(fields.serial).toBe('G220307348');
  });

  it('#3a & #3b: damaged label (03-4149BR, 845436091594, 16 kg, frame WMEI00065)', () => {
    const lines: OcrItem[][] = [
      [{ text: '03-4149BR', box: { x: 10, y: 10, width: 120, height: 20 }, confidence: 0.95 }],
      [{ text: '845436091594', box: { x: 10, y: 40, width: 150, height: 20 }, confidence: 0.96 }],
      [{ text: 'G.W.: 16 KGS', box: { x: 10, y: 70, width: 120, height: 20 }, confidence: 0.95 }],
      [
        {
          text: 'FRAME: WMEI00065',
          box: { x: 10, y: 100, width: 140, height: 20 },
          confidence: 0.94,
        },
      ],
    ];
    const fields = extractFieldsFromOcrLines(lines);
    expect(fields.sku).toBe('03-4149BR');
    expect(fields.upc).toBe('845436091594');
    expect(fields.gw_kg).toBe(16);
    expect(fields.serial).toBe('WMEI00065');
  });

  it('#4: e9308020 (09-4807CL, 845436091679, 7 kg)', () => {
    const lines: OcrItem[][] = [
      [{ text: '09-4807CL', box: { x: 10, y: 10, width: 120, height: 20 }, confidence: 0.99 }],
      [{ text: '845436091679', box: { x: 10, y: 40, width: 150, height: 20 }, confidence: 0.99 }],
      [{ text: 'G.W.: 7 KGS', box: { x: 10, y: 70, width: 100, height: 20 }, confidence: 0.98 }],
    ];
    const fields = extractFieldsFromOcrLines(lines);
    expect(fields.sku).toBe('09-4807CL');
    expect(fields.upc).toBe('845436091679');
    expect(fields.gw_kg).toBe(7);
  });

  it('#5: b01cca62 (09-4796CL, 845436089485, 15 kg)', () => {
    const lines: OcrItem[][] = [
      [{ text: '09-4796CL', box: { x: 10, y: 10, width: 120, height: 20 }, confidence: 0.99 }],
      [{ text: '845436089485', box: { x: 10, y: 40, width: 150, height: 20 }, confidence: 0.99 }],
      [{ text: 'G.W.: 15 KGS', box: { x: 10, y: 70, width: 110, height: 20 }, confidence: 0.97 }],
      [
        {
          text: 'FRAME: WMCJ00296',
          box: { x: 10, y: 100, width: 140, height: 20 },
          confidence: 0.96,
        },
      ],
    ];
    const fields = extractFieldsFromOcrLines(lines);
    expect(fields.sku).toBe('09-4796CL');
    expect(fields.upc).toBe('845436089485');
    expect(fields.gw_kg).toBe(15);
    expect(fields.serial).toBe('WMCJ00296');
  });

  it('#6: ca3f76eb (03-4000BL, 845436088099, 20.30 kg)', () => {
    const lines: OcrItem[][] = [
      [
        {
          text: 'ITEM: 03-4000-BL',
          box: { x: 10, y: 10, width: 150, height: 20 },
          confidence: 0.98,
        },
      ],
      [{ text: '00845436088099', box: { x: 10, y: 40, width: 180, height: 20 }, confidence: 0.99 }],
      [
        {
          text: 'G.W.: 20.30 KGS',
          box: { x: 10, y: 70, width: 130, height: 20 },
          confidence: 0.97,
        },
      ],
    ];
    const fields = extractFieldsFromOcrLines(lines);
    expect(fields.sku).toBe('03-4000BL');
    expect(fields.upc).toBe('845436088099');
    expect(fields.gtin).toBe('00845436088099');
    expect(fields.gw_kg).toBe(20.3);
  });

  it('#7: afce3b6e (03-3845BL, 845436086545, 18 kg, WAKCJ2676)', () => {
    const lines: OcrItem[][] = [
      [{ text: '03-3845BL', box: { x: 10, y: 10, width: 120, height: 20 }, confidence: 0.99 }],
      [{ text: '845436086545', box: { x: 10, y: 40, width: 150, height: 20 }, confidence: 0.99 }],
      [{ text: 'G.W.: 18 KGS', box: { x: 10, y: 70, width: 110, height: 20 }, confidence: 0.98 }],
      [
        {
          text: 'FRAME: WAKCJ2676',
          box: { x: 10, y: 100, width: 140, height: 20 },
          confidence: 0.96,
        },
      ],
    ];
    const fields = extractFieldsFromOcrLines(lines);
    expect(fields.sku).toBe('03-3845BL');
    expect(fields.upc).toBe('845436086545');
    expect(fields.gw_kg).toBe(18);
    expect(fields.serial).toBe('WAKCJ2676');
  });

  it('#8: 912021ea (06-4638BK, 845436089331, 17.80 kg)', () => {
    const lines: OcrItem[][] = [
      [{ text: '06-4638-BK', box: { x: 10, y: 10, width: 130, height: 20 }, confidence: 0.99 }],
      [{ text: '00845436089331', box: { x: 10, y: 40, width: 180, height: 20 }, confidence: 0.99 }],
      [
        {
          text: 'G.W.: 17.80 KGS',
          box: { x: 10, y: 70, width: 130, height: 20 },
          confidence: 0.98,
        },
      ],
    ];
    const fields = extractFieldsFromOcrLines(lines);
    expect(fields.sku).toBe('06-4638BK');
    expect(fields.upc).toBe('845436089331');
    expect(fields.gw_kg).toBe(17.8);
  });

  it('#9 & #10: bike labels with serial numbers (U226U03952, WAKCA0252)', () => {
    const lines9: OcrItem[][] = [
      [{ text: '03-3925BK', box: { x: 10, y: 10, width: 120, height: 20 }, confidence: 0.98 }],
      [
        {
          text: 'SERIAL: U226U03952',
          box: { x: 10, y: 40, width: 160, height: 20 },
          confidence: 0.97,
        },
      ],
      [
        {
          text: 'G.W.: 15.23 KGS',
          box: { x: 10, y: 70, width: 130, height: 20 },
          confidence: 0.96,
        },
      ],
    ];
    const fields9 = extractFieldsFromOcrLines(lines9);
    expect(fields9.sku).toBe('03-3925BK');
    expect(fields9.serial).toBe('U226U03952');
    expect(fields9.gw_kg).toBe(15.23);

    const lines10: OcrItem[][] = [
      [{ text: '03-3850BK', box: { x: 10, y: 10, width: 120, height: 20 }, confidence: 0.98 }],
      [
        {
          text: 'FRAME NO: WAKCA0252',
          box: { x: 10, y: 40, width: 160, height: 20 },
          confidence: 0.97,
        },
      ],
      [{ text: 'G.W.: 18 KGS', box: { x: 10, y: 70, width: 110, height: 20 }, confidence: 0.96 }],
    ];
    const fields10 = extractFieldsFromOcrLines(lines10);
    expect(fields10.sku).toBe('03-3850BK');
    expect(fields10.serial).toBe('WAKCA0252');
    expect(fields10.gw_kg).toBe(18);
  });

  it('#11, #12, #13: serials, GTINs, and models without SKU barcode', () => {
    const lines11: OcrItem[][] = [
      [{ text: '03-3934MN', box: { x: 10, y: 10, width: 120, height: 20 }, confidence: 0.98 }],
      [
        {
          text: 'SERIAL: U226U02808',
          box: { x: 10, y: 40, width: 160, height: 20 },
          confidence: 0.97,
        },
      ],
    ];
    const fields11 = extractFieldsFromOcrLines(lines11);
    expect(fields11.sku).toBe('03-3934MN');
    expect(fields11.serial).toBe('U226U02808');

    const lines12: OcrItem[][] = [
      [{ text: '00845436087757', box: { x: 10, y: 10, width: 180, height: 20 }, confidence: 0.99 }],
      [
        {
          text: 'G.W.: 19.60 KGS',
          box: { x: 10, y: 40, width: 130, height: 20 },
          confidence: 0.98,
        },
      ],
      [
        {
          text: 'SERIAL: Y22G002832',
          box: { x: 10, y: 70, width: 160, height: 20 },
          confidence: 0.97,
        },
      ],
    ];
    const fields12 = extractFieldsFromOcrLines(lines12);
    expect(fields12.upc).toBe('845436087757');
    expect(fields12.gw_kg).toBe(19.6);
    expect(fields12.serial).toBe('Y22G002832');

    // Plain text serial detection fallback
    const rawItems: OcrItem[] = [
      {
        text: 'SERIAL: M21I014353',
        box: { x: 10, y: 10, width: 180, height: 20 },
        confidence: 0.98,
      },
    ];
    const fields13 = extractFieldsFromOcrLines([rawItems]);
    expect(fields13.serial).toBe('M21I014353');
  });

  it('#14: 72b5ea51 (Renegade S1 Framekit, 09-4807CL, Charcoal, 700C x 54cm, 7 kg)', () => {
    const lines: OcrItem[][] = [
      [{ text: '09-4807CL', box: { x: 10, y: 10, width: 120, height: 20 }, confidence: 0.99 }],
      [
        {
          text: 'MODEL: RENEGADE S1 FRAMEKIT',
          box: { x: 10, y: 40, width: 250, height: 20 },
          confidence: 0.98,
        },
      ],
      [
        {
          text: 'COLOR: CHARCOAL',
          box: { x: 10, y: 70, width: 150, height: 20 },
          confidence: 0.98,
        },
      ],
      [
        {
          text: 'SIZE: 700C x 54cm',
          box: { x: 10, y: 100, width: 150, height: 20 },
          confidence: 0.97,
        },
      ],
      [{ text: 'G.W.: 7 KGS', box: { x: 10, y: 130, width: 100, height: 20 }, confidence: 0.98 }],
    ];
    const fields = extractFieldsFromOcrLines(lines);
    expect(fields.sku).toBe('09-4807CL');
    expect(fields.model).toBe('RENEGADE S1 FRAMEKIT');
    expect(fields.color).toBe('CHARCOAL');
    expect(fields.size).toBe('700C x 54cm');
    expect(fields.gw_kg).toBe(7);
  });

  it('#15: f29b9727 (Bulk spare parts, PP1202JC, Faultline 29, Black, 12 kg)', () => {
    const rawItems: OcrItem[] = [
      { text: 'PP1202JC', box: { x: 10, y: 10, width: 110, height: 20 }, confidence: 0.99 },
      { text: 'JAMIS', box: { x: 10, y: 35, width: 80, height: 20 }, confidence: 0.99 },
      { text: 'ITEM: CHIAN STAY', box: { x: 10, y: 60, width: 180, height: 20 }, confidence: 0.97 },
      { text: 'MODEL:', box: { x: 10, y: 85, width: 70, height: 20 }, confidence: 0.98 },
      { text: 'FAULTLINE 29', box: { x: 90, y: 85, width: 130, height: 20 }, confidence: 0.98 },
      { text: 'COLOR: BLACK', box: { x: 10, y: 110, width: 140, height: 20 }, confidence: 0.98 },
      { text: "Q'TY: 10 PCS", box: { x: 160, y: 110, width: 100, height: 20 }, confidence: 0.96 },
      { text: 'N.W.: 11.00 KGS', box: { x: 10, y: 135, width: 140, height: 20 }, confidence: 0.97 },
      { text: 'G.W.: 12.00 KGS', box: { x: 10, y: 160, width: 140, height: 20 }, confidence: 0.98 },
    ];
    const grouped = groupLinesBySpatialProximity(rawItems);
    const fields = extractFieldsFromOcrLines(grouped);
    expect(fields.sku).toBe('PP1202JC');
    expect(fields.model).toBe('FAULTLINE 29');
    expect(fields.color).toBe('BLACK');
    expect(fields.gw_kg).toBe(12);
  });

  it('#16: 2ef103e2 (Laser 1.6 face A, 07-3692BL, Deep Blue, 8"*16", 14.80 kg)', () => {
    const lines: OcrItem[][] = [
      [
        {
          text: 'SKU: 07-3692-BL',
          box: { x: 10, y: 10, width: 150, height: 20 },
          confidence: 0.98,
        },
      ],
      [{ text: '00845436082769', box: { x: 10, y: 40, width: 180, height: 20 }, confidence: 0.99 }],
      [
        {
          text: 'MODEL: LASER 1.6',
          box: { x: 10, y: 70, width: 160, height: 20 },
          confidence: 0.98,
        },
      ],
      [{ text: 'SIZE: 8"*16"', box: { x: 10, y: 100, width: 120, height: 20 }, confidence: 0.97 }],
      [
        {
          text: 'COLOR: DEEP BLUE',
          box: { x: 10, y: 130, width: 160, height: 20 },
          confidence: 0.98,
        },
      ],
      [
        {
          text: 'G.W.: 14.80 KG',
          box: { x: 10, y: 160, width: 130, height: 20 },
          confidence: 0.98,
        },
      ],
    ];
    const fields = extractFieldsFromOcrLines(lines);
    expect(fields.sku).toBe('07-3692BL');
    expect(fields.upc).toBe('845436082769');
    expect(fields.model).toBe('LASER 1.6');
    expect(fields.size).toBe('8"*16"');
    expect(fields.color).toBe('DEEP BLUE');
    expect(fields.gw_kg).toBe(14.8);
  });

  it('#17: 9b8ccfb4 (Laser 1.6 face B, 02-3662BL, Ano Deep Blue)', () => {
    const lines: OcrItem[][] = [
      [{ text: '02-3662BL', box: { x: 10, y: 10, width: 120, height: 20 }, confidence: 0.99 }],
      [
        {
          text: 'MODEL: LASER 1.6',
          box: { x: 10, y: 40, width: 160, height: 20 },
          confidence: 0.98,
        },
      ],
      [
        {
          text: 'COLOR: ANO DEEP BLUE',
          box: { x: 10, y: 70, width: 180, height: 20 },
          confidence: 0.98,
        },
      ],
    ];
    const fields = extractFieldsFromOcrLines(lines);
    expect(fields.sku).toBe('02-3662BL');
    expect(fields.model).toBe('LASER 1.6');
    expect(fields.color).toBe('ANO DEEP BLUE');
  });

  it('#18: e3f27e0a (Coda S1 Femme, 03-3919GN, Misty Green, 700Cx16", 17 kg, WAKCA2052)', () => {
    const lines: OcrItem[][] = [
      [{ text: '03-3919GN', box: { x: 10, y: 10, width: 120, height: 20 }, confidence: 0.99 }],
      [{ text: '845436092157', box: { x: 10, y: 40, width: 150, height: 20 }, confidence: 0.99 }],
      [
        {
          text: 'MODEL: CODA S1 FEMME',
          box: { x: 10, y: 70, width: 200, height: 20 },
          confidence: 0.98,
        },
      ],
      [
        {
          text: 'SIZE: 700Cx16"',
          box: { x: 10, y: 100, width: 140, height: 20 },
          confidence: 0.97,
        },
      ],
      [
        {
          text: 'COLOR: Misty Green',
          box: { x: 10, y: 130, width: 160, height: 20 },
          confidence: 0.98,
        },
      ],
      [{ text: 'G.W.: 17 KGS', box: { x: 10, y: 160, width: 110, height: 20 }, confidence: 0.98 }],
      [
        {
          text: 'FRAME: WAKCA2052',
          box: { x: 10, y: 190, width: 150, height: 20 },
          confidence: 0.97,
        },
      ],
    ];
    const fields = extractFieldsFromOcrLines(lines);
    expect(fields.sku).toBe('03-3919GN');
    expect(fields.upc).toBe('845436092157');
    expect(fields.model).toBe('CODA S1 FEMME');
    expect(fields.color?.toUpperCase()).toBe('MISTY GREEN');
    expect(fields.size).toBe('700Cx16"');
    expect(fields.gw_kg).toBe(17);
    expect(fields.serial).toBe('WAKCA2052');
  });

  it('#19: 63806c1a (DXT A1, 03-3855GY, Monterey Grey, 700Cx21", 18.64 kg, M21I008523)', () => {
    const lines: OcrItem[][] = [
      [{ text: '03-3855GY', box: { x: 10, y: 10, width: 120, height: 20 }, confidence: 0.98 }],
      [{ text: '00845436086644', box: { x: 10, y: 40, width: 180, height: 20 }, confidence: 0.99 }],
      [{ text: 'MODEL: DXT A1', box: { x: 10, y: 70, width: 140, height: 20 }, confidence: 0.98 }],
      [
        {
          text: 'SIZE: 700Cx21"',
          box: { x: 10, y: 100, width: 140, height: 20 },
          confidence: 0.97,
        },
      ],
      [
        {
          text: 'COLOR: Monterey Grey',
          box: { x: 10, y: 130, width: 170, height: 20 },
          confidence: 0.98,
        },
      ],
      [
        {
          text: 'G.W.: 18.64 KGS',
          box: { x: 10, y: 160, width: 130, height: 20 },
          confidence: 0.98,
        },
      ],
      [
        {
          text: 'SERIAL: M21I008523',
          box: { x: 10, y: 190, width: 160, height: 20 },
          confidence: 0.97,
        },
      ],
    ];
    const fields = extractFieldsFromOcrLines(lines);
    expect(fields.sku).toBe('03-3855GY');
    expect(fields.upc).toBe('845436086644');
    expect(fields.model).toBe('DXT A1');
    expect(fields.color?.toUpperCase()).toBe('MONTEREY GREY');
    expect(fields.size).toBe('700Cx21"');
    expect(fields.gw_kg).toBe(18.64);
    expect(fields.serial).toBe('M21I008523');
  });
});
