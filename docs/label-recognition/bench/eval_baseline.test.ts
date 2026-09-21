import { describe, it } from 'vitest';
import { extractFieldsFromOcrLines, type OcrItem } from '../../../src/lib/recognition/clientOcr';
import { parseJamisFactoryQr } from '../../../src/lib/recognition/barcodeText';

interface BenchItem {
  id: string;
  name: string;
  labelType: string;
  condition: string;
  lines: OcrItem[][];
  barcodeDecoder?: 'native' | 'zxing' | 'none';
  barcodeSku?: string | null;
  barcodeUpc?: string | null;
  factoryQrRaw?: string | null;
  gt: {
    sku: string | null;
    upc: string | null;
    gtin: string | null;
    model: string | null;
    size: string | null;
    color: string | null;
    gw_kg: number | null;
    serial: string | null;
    carton: string | null;
    po: string | null;
  };
}

describe('PARTE 0: Evaluación exhaustiva de línea base', () => {
  it('ejecuta el motor actual sobre todo el banco y corridas recientes', () => {
    const benchmarkSuite: BenchItem[] = [
      {
        id: '1',
        name: '7f6a8d3e',
        labelType: 'Tipo A',
        condition: 'normal',
        barcodeDecoder: 'zxing',
        barcodeSku: '03-4270BK',
        barcodeUpc: '845436092959',
        factoryQrRaw: '0023JC-7RA1-G541,WRDH01637,1,SET,A129,A23JC-744,0003',
        lines: [
          [
            {
              text: 'JAMIS BICYCLES',
              box: { x: 10, y: 10, width: 200, height: 20 },
              confidence: 0.99,
            },
          ],
          [
            {
              text: 'SKU: 03-4270BK',
              box: { x: 10, y: 40, width: 150, height: 20 },
              confidence: 0.98,
            },
          ],
          [
            {
              text: 'UPC: 845436092959',
              box: { x: 10, y: 70, width: 160, height: 20 },
              confidence: 0.98,
            },
          ],
          [
            {
              text: 'G.W.: 17 KGS',
              box: { x: 10, y: 100, width: 120, height: 20 },
              confidence: 0.97,
            },
          ],
          [
            {
              text: 'FRAME: WRDH01637',
              box: { x: 10, y: 130, width: 140, height: 20 },
              confidence: 0.95,
            },
          ],
        ],
        gt: {
          sku: '03-4270BK',
          upc: '845436092959',
          gtin: null,
          model: null,
          size: null,
          color: null,
          gw_kg: 17,
          serial: 'WRDH01637',
          carton: 'A129',
          po: null,
        },
      },
      {
        id: '2',
        name: '324f78b1',
        labelType: 'Tipo B',
        condition: 'normal',
        barcodeDecoder: 'zxing',
        barcodeSku: null,
        barcodeUpc: '845436086774',
        lines: [
          [{ text: '03-3868BL', box: { x: 10, y: 10, width: 120, height: 20 }, confidence: 0.99 }],
          [
            {
              text: '00845436086774',
              box: { x: 10, y: 40, width: 180, height: 20 },
              confidence: 0.99,
            },
          ],
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
        ],
        gt: {
          sku: '03-3868BL',
          upc: '845436086774',
          gtin: '00845436086774',
          model: null,
          size: null,
          color: null,
          gw_kg: 18,
          serial: 'G220307348',
          carton: null,
          po: null,
        },
      },
      {
        id: '3a',
        name: 'febd6b50',
        labelType: 'Tipo A',
        condition: 'dañada',
        barcodeDecoder: 'zxing',
        barcodeSku: '03-4149BR',
        barcodeUpc: null,
        lines: [
          [{ text: '03-4149BR', box: { x: 10, y: 10, width: 120, height: 20 }, confidence: 0.95 }],
          [
            {
              text: '845436091594',
              box: { x: 10, y: 40, width: 150, height: 20 },
              confidence: 0.96,
            },
          ],
          [
            {
              text: 'G.W.: 16 KGS',
              box: { x: 10, y: 70, width: 120, height: 20 },
              confidence: 0.95,
            },
          ],
          [
            {
              text: 'FRAME: WMEI00065',
              box: { x: 10, y: 100, width: 140, height: 20 },
              confidence: 0.94,
            },
          ],
        ],
        gt: {
          sku: '03-4149BR',
          upc: '845436091594',
          gtin: null,
          model: null,
          size: null,
          color: null,
          gw_kg: 16,
          serial: 'WMEI00065',
          carton: null,
          po: null,
        },
      },
      {
        id: '3b',
        name: '8533301f',
        labelType: 'Tipo A',
        condition: 'dañada',
        barcodeDecoder: 'zxing',
        barcodeSku: null,
        barcodeUpc: null,
        factoryQrRaw: '0023JC-7RA1-G541,WMEI00065,1,SET,A042,A23JC-744,0002',
        lines: [
          [{ text: '03-4149BR', box: { x: 10, y: 10, width: 120, height: 20 }, confidence: 0.95 }],
          [
            {
              text: '845436091594',
              box: { x: 10, y: 40, width: 150, height: 20 },
              confidence: 0.96,
            },
          ],
          [
            {
              text: 'G.W.: 16 KGS',
              box: { x: 10, y: 70, width: 120, height: 20 },
              confidence: 0.95,
            },
          ],
          [
            {
              text: 'FRAME: WMEI00065',
              box: { x: 10, y: 100, width: 140, height: 20 },
              confidence: 0.94,
            },
          ],
        ],
        gt: {
          sku: '03-4149BR',
          upc: '845436091594',
          gtin: null,
          model: null,
          size: null,
          color: null,
          gw_kg: 16,
          serial: 'WMEI00065',
          carton: 'A042',
          po: null,
        },
      },
      {
        id: '4',
        name: 'e9308020',
        labelType: 'Tipo A',
        condition: 'normal',
        barcodeDecoder: 'zxing',
        barcodeSku: '09-4807CL',
        barcodeUpc: '845436091679',
        factoryQrRaw: '0023JC-7RA1-G541,WMEI00094,1,SET,A094,A23JC-744,0004',
        lines: [
          [{ text: '09-4807CL', box: { x: 10, y: 10, width: 120, height: 20 }, confidence: 0.99 }],
          [
            {
              text: '845436091679',
              box: { x: 10, y: 40, width: 150, height: 20 },
              confidence: 0.99,
            },
          ],
          [
            {
              text: 'G.W.: 7 KGS',
              box: { x: 10, y: 70, width: 100, height: 20 },
              confidence: 0.98,
            },
          ],
          [
            {
              text: 'FRAME: WMEI00094',
              box: { x: 10, y: 100, width: 140, height: 20 },
              confidence: 0.95,
            },
          ],
        ],
        gt: {
          sku: '09-4807CL',
          upc: '845436091679',
          gtin: null,
          model: null,
          size: null,
          color: null,
          gw_kg: 7,
          serial: 'WMEI00094',
          carton: 'A094',
          po: null,
        },
      },
      {
        id: '5',
        name: 'b01cca62',
        labelType: 'Tipo A',
        condition: 'normal',
        barcodeDecoder: 'zxing',
        barcodeSku: '09-4796CL',
        barcodeUpc: '845436089485',
        factoryQrRaw: '0023JC-7RA1-G541,WMCJ00296,1,SET,A296,A23JC-744,0005',
        lines: [
          [{ text: '09-4796CL', box: { x: 10, y: 10, width: 120, height: 20 }, confidence: 0.99 }],
          [
            {
              text: '845436089485',
              box: { x: 10, y: 40, width: 150, height: 20 },
              confidence: 0.99,
            },
          ],
          [
            {
              text: 'G.W.: 15 KGS',
              box: { x: 10, y: 70, width: 110, height: 20 },
              confidence: 0.97,
            },
          ],
          [
            {
              text: 'FRAME: WMCJ00296',
              box: { x: 10, y: 100, width: 140, height: 20 },
              confidence: 0.96,
            },
          ],
        ],
        gt: {
          sku: '09-4796CL',
          upc: '845436089485',
          gtin: null,
          model: null,
          size: null,
          color: null,
          gw_kg: 15,
          serial: 'WMCJ00296',
          carton: 'A296',
          po: null,
        },
      },
      {
        id: '6',
        name: 'ca3f76eb',
        labelType: 'Tipo B',
        condition: 'normal',
        barcodeDecoder: 'zxing',
        barcodeSku: null,
        barcodeUpc: '845436088099',
        lines: [
          [
            {
              text: 'ITEM: 03-4000-BL',
              box: { x: 10, y: 10, width: 150, height: 20 },
              confidence: 0.98,
            },
          ],
          [
            {
              text: '00845436088099',
              box: { x: 10, y: 40, width: 180, height: 20 },
              confidence: 0.99,
            },
          ],
          [
            {
              text: 'G.W.: 20.30 KGS',
              box: { x: 10, y: 70, width: 130, height: 20 },
              confidence: 0.97,
            },
          ],
        ],
        gt: {
          sku: '03-4000BL',
          upc: '845436088099',
          gtin: '00845436088099',
          model: null,
          size: null,
          color: null,
          gw_kg: 20.3,
          serial: null,
          carton: null,
          po: null,
        },
      },
      {
        id: '7',
        name: 'afce3b6e',
        labelType: 'Tipo A',
        condition: 'normal',
        barcodeDecoder: 'zxing',
        barcodeSku: '03-3845BL',
        barcodeUpc: '845436086545',
        factoryQrRaw: '0023JC-7RA1-G541,WAKCJ2676,1,SET,A676,A23JC-744,0007',
        lines: [
          [{ text: '03-3845BL', box: { x: 10, y: 10, width: 120, height: 20 }, confidence: 0.99 }],
          [
            {
              text: '845436086545',
              box: { x: 10, y: 40, width: 150, height: 20 },
              confidence: 0.99,
            },
          ],
          [
            {
              text: 'G.W.: 18 KGS',
              box: { x: 10, y: 70, width: 110, height: 20 },
              confidence: 0.98,
            },
          ],
          [
            {
              text: 'FRAME: WAKCJ2676',
              box: { x: 10, y: 100, width: 140, height: 20 },
              confidence: 0.96,
            },
          ],
        ],
        gt: {
          sku: '03-3845BL',
          upc: '845436086545',
          gtin: null,
          model: null,
          size: null,
          color: null,
          gw_kg: 18,
          serial: 'WAKCJ2676',
          carton: 'A676',
          po: null,
        },
      },
      {
        id: '8',
        name: '912021ea',
        labelType: 'Tipo B',
        condition: 'normal',
        barcodeDecoder: 'zxing',
        barcodeSku: null,
        barcodeUpc: '845436089331',
        lines: [
          [{ text: '06-4638-BK', box: { x: 10, y: 10, width: 130, height: 20 }, confidence: 0.99 }],
          [
            {
              text: '00845436089331',
              box: { x: 10, y: 40, width: 180, height: 20 },
              confidence: 0.99,
            },
          ],
          [
            {
              text: 'G.W.: 17.80 KGS',
              box: { x: 10, y: 70, width: 130, height: 20 },
              confidence: 0.98,
            },
          ],
        ],
        gt: {
          sku: '06-4638BK',
          upc: '845436089331',
          gtin: '00845436089331',
          model: null,
          size: null,
          color: null,
          gw_kg: 17.8,
          serial: null,
          carton: null,
          po: null,
        },
      },
      {
        id: '9',
        name: 'a60a30e3',
        labelType: 'Tipo C',
        condition: 'antigua',
        barcodeDecoder: 'zxing',
        barcodeSku: null,
        barcodeUpc: null,
        lines: [
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
        ],
        gt: {
          sku: '03-3925BK',
          upc: null,
          gtin: null,
          model: null,
          size: null,
          color: null,
          gw_kg: 15.23,
          serial: 'U226U03952',
          carton: null,
          po: null,
        },
      },
      {
        id: '10',
        name: 'b6ca630d',
        labelType: 'Tipo C',
        condition: 'antigua',
        barcodeDecoder: 'zxing',
        barcodeSku: null,
        barcodeUpc: null,
        lines: [
          [{ text: '03-3850BK', box: { x: 10, y: 10, width: 120, height: 20 }, confidence: 0.98 }],
          [
            {
              text: 'FRAME NO: WAKCA0252',
              box: { x: 10, y: 40, width: 160, height: 20 },
              confidence: 0.97,
            },
          ],
          [
            {
              text: 'G.W.: 18 KGS',
              box: { x: 10, y: 70, width: 110, height: 20 },
              confidence: 0.96,
            },
          ],
        ],
        gt: {
          sku: '03-3850BK',
          upc: null,
          gtin: null,
          model: null,
          size: null,
          color: null,
          gw_kg: 18,
          serial: 'WAKCA0252',
          carton: null,
          po: null,
        },
      },
      {
        id: '11',
        name: 'f2a7e8b0',
        labelType: 'Tipo C',
        condition: 'antigua',
        barcodeDecoder: 'none',
        barcodeSku: null,
        barcodeUpc: null,
        lines: [
          [{ text: '03-3934MN', box: { x: 10, y: 10, width: 120, height: 20 }, confidence: 0.98 }],
          [
            {
              text: 'SERIAL: U226U02808',
              box: { x: 10, y: 40, width: 160, height: 20 },
              confidence: 0.97,
            },
          ],
        ],
        gt: {
          sku: '03-3934MN',
          upc: null,
          gtin: null,
          model: null,
          size: null,
          color: null,
          gw_kg: null,
          serial: 'U226U02808',
          carton: null,
          po: null,
        },
      },
      {
        id: '12',
        name: '22b02909',
        labelType: 'Tipo B',
        condition: 'sin-sku',
        barcodeDecoder: 'zxing',
        barcodeSku: null,
        barcodeUpc: '845436087757',
        lines: [
          [
            {
              text: '00845436087757',
              box: { x: 10, y: 10, width: 180, height: 20 },
              confidence: 0.99,
            },
          ],
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
        ],
        gt: {
          sku: null,
          upc: '845436087757',
          gtin: '00845436087757',
          model: null,
          size: null,
          color: null,
          gw_kg: 19.6,
          serial: 'Y22G002832',
          carton: null,
          po: null,
        },
      },
      {
        id: '13',
        name: 'a0d97504',
        labelType: 'Tipo B',
        condition: 'sin-sku',
        barcodeDecoder: 'none',
        barcodeSku: null,
        barcodeUpc: null,
        lines: [
          [
            {
              text: 'SERIAL: M21I014353',
              box: { x: 10, y: 10, width: 180, height: 20 },
              confidence: 0.98,
            },
          ],
        ],
        gt: {
          sku: null,
          upc: null,
          gtin: null,
          model: null,
          size: null,
          color: null,
          gw_kg: null,
          serial: 'M21I014353',
          carton: null,
          po: null,
        },
      },
      {
        id: '14',
        name: '72b5ea51',
        labelType: 'Tipo A',
        condition: 'normal',
        barcodeDecoder: 'zxing',
        barcodeSku: '09-4807CL',
        barcodeUpc: '845436091679',
        factoryQrRaw: '0023JC-7RA1-G541,WMEI00094,1,SET,A094,PO2023-35,0001',
        lines: [
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
          [
            {
              text: 'G.W.: 7 KGS',
              box: { x: 10, y: 130, width: 100, height: 20 },
              confidence: 0.98,
            },
          ],
          [
            {
              text: 'P/O NO: PO2023-35',
              box: { x: 10, y: 160, width: 140, height: 20 },
              confidence: 0.96,
            },
          ],
        ],
        gt: {
          sku: '09-4807CL',
          upc: '845436091679',
          gtin: null,
          model: 'RENEGADE S1 FRAMEKIT',
          size: '700C x 54cm',
          color: 'CHARCOAL',
          gw_kg: 7,
          serial: null,
          carton: 'A094',
          po: 'PO2023-35',
        },
      },
      {
        id: '15',
        name: 'f29b9727',
        labelType: 'Tipo E',
        condition: 'repuestos',
        barcodeDecoder: 'none',
        barcodeSku: null,
        barcodeUpc: null,
        lines: [
          [{ text: 'PP1202JC', box: { x: 10, y: 10, width: 110, height: 20 }, confidence: 0.99 }],
          [{ text: 'JAMIS', box: { x: 10, y: 35, width: 80, height: 20 }, confidence: 0.99 }],
          [
            {
              text: 'ITEM: CHIAN STAY',
              box: { x: 10, y: 60, width: 180, height: 20 },
              confidence: 0.97,
            },
          ],
          [
            {
              text: 'MODEL: FAULTLINE 29',
              box: { x: 10, y: 85, width: 180, height: 20 },
              confidence: 0.98,
            },
          ],
          [
            {
              text: 'COLOR: BLACK',
              box: { x: 10, y: 110, width: 140, height: 20 },
              confidence: 0.98,
            },
          ],
          [
            {
              text: "Q'TY: 10 PCS",
              box: { x: 160, y: 110, width: 100, height: 20 },
              confidence: 0.96,
            },
          ],
          [
            {
              text: 'N.W.: 11.00 KGS',
              box: { x: 10, y: 135, width: 140, height: 20 },
              confidence: 0.97,
            },
          ],
          [
            {
              text: 'G.W.: 12.00 KGS',
              box: { x: 10, y: 160, width: 140, height: 20 },
              confidence: 0.98,
            },
          ],
        ],
        gt: {
          sku: 'PP1202JC',
          upc: null,
          gtin: null,
          model: 'FAULTLINE 29',
          size: null,
          color: 'BLACK',
          gw_kg: 12,
          serial: null,
          carton: null,
          po: null,
        },
      },
      {
        id: '16',
        name: '2ef103e2',
        labelType: 'Tipo B',
        condition: 'normal',
        barcodeDecoder: 'zxing',
        barcodeSku: null,
        barcodeUpc: '845436082769',
        lines: [
          [
            {
              text: 'SKU: 07-3692-BL',
              box: { x: 10, y: 10, width: 150, height: 20 },
              confidence: 0.98,
            },
          ],
          [
            {
              text: '00845436082769',
              box: { x: 10, y: 40, width: 180, height: 20 },
              confidence: 0.99,
            },
          ],
          [
            {
              text: 'MODEL: LASER 1.6',
              box: { x: 10, y: 70, width: 160, height: 20 },
              confidence: 0.98,
            },
          ],
          [
            {
              text: 'SIZE: 8"*16"',
              box: { x: 10, y: 100, width: 120, height: 20 },
              confidence: 0.97,
            },
          ],
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
        ],
        gt: {
          sku: '07-3692BL',
          upc: '845436082769',
          gtin: '00845436082769',
          model: 'LASER 1.6',
          size: '8"*16"',
          color: 'DEEP BLUE',
          gw_kg: 14.8,
          serial: null,
          carton: null,
          po: '2025-07',
        },
      },
      {
        id: '17',
        name: '9b8ccfb4',
        labelType: 'Tipo D',
        condition: 'normal',
        barcodeDecoder: 'none',
        barcodeSku: null,
        barcodeUpc: null,
        lines: [
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
        ],
        gt: {
          sku: '02-3662BL',
          upc: null,
          gtin: null,
          model: 'LASER 1.6',
          size: null,
          color: 'ANO DEEP BLUE',
          gw_kg: null,
          serial: null,
          carton: null,
          po: null,
        },
      },
      {
        id: '18',
        name: 'e3f27e0a',
        labelType: 'Tipo A',
        condition: 'normal',
        barcodeDecoder: 'zxing',
        barcodeSku: '03-3919GN',
        barcodeUpc: '845436092157',
        factoryQrRaw: '0023JC-7RA1-G541,WAKCA2052,1,SET,B2,UCC sample,0001',
        lines: [
          [{ text: '03-3919GN', box: { x: 10, y: 10, width: 120, height: 20 }, confidence: 0.99 }],
          [
            {
              text: '845436092157',
              box: { x: 10, y: 40, width: 150, height: 20 },
              confidence: 0.99,
            },
          ],
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
          [
            {
              text: 'G.W.: 17 KGS',
              box: { x: 10, y: 160, width: 110, height: 20 },
              confidence: 0.98,
            },
          ],
          [
            {
              text: 'FRAME: WAKCA2052',
              box: { x: 10, y: 190, width: 150, height: 20 },
              confidence: 0.97,
            },
          ],
          [
            {
              text: 'PO NO.: UCC sample',
              box: { x: 10, y: 220, width: 160, height: 20 },
              confidence: 0.96,
            },
          ],
        ],
        gt: {
          sku: '03-3919GN',
          upc: '845436092157',
          gtin: null,
          model: 'CODA S1 FEMME',
          size: '700Cx16"',
          color: 'Misty Green',
          gw_kg: 17,
          serial: 'WAKCA2052',
          carton: 'B2',
          po: 'UCC sample',
        },
      },
      {
        id: '19',
        name: '63806c1a',
        labelType: 'Tipo B',
        condition: 'lejana',
        barcodeDecoder: 'none',
        barcodeSku: null,
        barcodeUpc: null,
        lines: [
          [{ text: '03-3855GY', box: { x: 10, y: 10, width: 120, height: 20 }, confidence: 0.98 }],
          [
            {
              text: '00845436086644',
              box: { x: 10, y: 40, width: 180, height: 20 },
              confidence: 0.99,
            },
          ],
          [
            {
              text: 'MODEL: DXT A1',
              box: { x: 10, y: 70, width: 140, height: 20 },
              confidence: 0.98,
            },
          ],
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
          [
            {
              text: 'P/O: 2022-15',
              box: { x: 10, y: 220, width: 130, height: 20 },
              confidence: 0.96,
            },
          ],
        ],
        gt: {
          sku: '03-3855GY',
          upc: '845436086644',
          gtin: '00845436086644',
          model: 'DXT A1',
          size: '700Cx21"',
          color: 'Monterey Grey',
          gw_kg: 18.64,
          serial: 'M21I008523',
          carton: '23',
          po: '2022-15',
        },
      },
      {
        id: '20',
        name: 'citizen2_03-3989GY',
        labelType: 'PRODUCT ID',
        condition: 'screenshot-recomprimido',
        barcodeDecoder: 'none',
        barcodeSku: null,
        barcodeUpc: null,
        lines: [
          [
            { text: '03-396', box: { x: 253, y: 200, width: 200, height: 30 }, confidence: 0.8 },
            { text: 'C', box: { x: 725, y: 200, width: 50, height: 30 }, confidence: 0.7 },
            { text: '1', box: { x: 847, y: 200, width: 30, height: 30 }, confidence: 0.7 },
            { text: '9.', box: { x: 853, y: 200, width: 40, height: 30 }, confidence: 0.8 },
            { text: '-GY', box: { x: 931, y: 200, width: 80, height: 30 }, confidence: 0.85 },
          ],
          [
            {
              text: 'CITIZEN 2 STEP-THRU',
              box: { x: 250, y: 260, width: 300, height: 30 },
              confidence: 0.95,
            },
          ],
        ],
        gt: {
          sku: '03-3989GY',
          upc: null,
          gtin: null,
          model: 'CITIZEN 2 STEP-THRU',
          size: null,
          color: 'Storm Grey',
          gw_kg: null,
          serial: null,
          carton: null,
          po: null,
        },
      },
      {
        id: '21',
        name: 'laser_rotated_90',
        labelType: 'Tipo B',
        condition: 'rotada-90',
        barcodeDecoder: 'none',
        barcodeSku: null,
        barcodeUpc: null,
        lines: [
          [
            {
              text: 'JAMIS LASER 1.6',
              box: { x: 100, y: 200, width: 250, height: 30 },
              confidence: 0.98,
            },
          ],
          [
            {
              text: '07-3743-PK',
              box: { x: 100, y: 250, width: 180, height: 30 },
              confidence: 0.98,
            },
          ],
          [
            {
              text: 'COLOR: Popstar Pink',
              box: { x: 100, y: 300, width: 220, height: 30 },
              confidence: 0.97,
            },
          ],
          [
            {
              text: 'N. W.: 10.20 KG',
              box: { x: 100, y: 350, width: 160, height: 30 },
              confidence: 0.95,
            },
          ],
          [
            {
              text: 'G.W.: 13 KG',
              box: { x: 100, y: 400, width: 140, height: 30 },
              confidence: 0.96,
            },
          ],
        ],
        gt: {
          sku: '07-3743PK',
          upc: '845438006710',
          gtin: '00845436006710',
          model: 'LASER 1.6',
          size: null,
          color: 'Popstar Pink',
          gw_kg: 13,
          serial: null,
          carton: '09',
          po: '2027-05',
        },
      },
      {
        id: '22',
        name: 'citizen2_rotated_90',
        labelType: 'PRODUCT ID',
        condition: 'rotada-90',
        barcodeDecoder: 'none',
        barcodeSku: null,
        barcodeUpc: null,
        lines: [
          [
            {
              text: 'CITIZEN 2',
              box: { x: 360, y: 250, width: 200, height: 35 },
              confidence: 0.98,
            },
          ],
          [
            {
              text: 'SHZE:700G 17"',
              box: { x: 362, y: 337, width: 250, height: 35 },
              confidence: 0.95,
            },
          ],
          [
            {
              text: 'cOLO:5oorm Grey',
              box: { x: 365, y: 400, width: 230, height: 35 },
              confidence: 0.92,
            },
          ],
          [
            {
              text: '03-3979GY',
              box: { x: 360, y: 500, width: 220, height: 40 },
              confidence: 0.99,
            },
          ],
          [
            { text: 'M.W:', box: { x: 375, y: 1167, width: 90, height: 32 }, confidence: 0.94 },
            {
              text: '15,8D KG',
              box: { x: 540, y: 1167, width: 140, height: 32 },
              confidence: 0.91,
            },
          ],
          [
            { text: 'G.W:', box: { x: 377, y: 1227, width: 90, height: 32 }, confidence: 0.95 },
            {
              text: '15.60 Kn',
              box: { x: 542, y: 1235, width: 140, height: 32 },
              confidence: 0.94,
            },
          ],
        ],
        gt: {
          sku: '03-3979GY',
          upc: null,
          gtin: null,
          model: 'CITIZEN 2',
          size: '17"',
          color: 'Storm Grey',
          gw_kg: 15.6,
          serial: null,
          carton: null,
          po: null,
        },
      },
      {
        id: '23',
        name: 'hudson_e1_12mp',
        labelType: 'Formato 2026',
        condition: '12mp-nitida',
        barcodeDecoder: 'native',
        barcodeSku: '03-4869MN',
        barcodeUpc: '845436098432',
        lines: [
          [
            { text: 'M QDEL:', box: { x: 614, y: 1756, width: 140, height: 35 }, confidence: 0.94 },
            {
              text: 'HUDSON E1 Step-Over',
              box: { x: 780, y: 1756, width: 320, height: 35 },
              confidence: 0.96,
            },
          ],
          [
            {
              text: '03-4869MN',
              box: { x: 948, y: 1238, width: 220, height: 35 },
              confidence: 0.93,
            },
          ],
          [
            {
              text: 'G.W.: 24.60 KG',
              box: { x: 500, y: 2100, width: 200, height: 35 },
              confidence: 0.95,
            },
          ],
        ],
        gt: {
          sku: '03-4869MN',
          upc: '845436098432',
          gtin: null,
          model: 'HUDSON E1 STEP-OVER',
          size: null,
          color: null,
          gw_kg: 24.6,
          serial: null,
          carton: null,
          po: null,
        },
      },
      {
        id: '24',
        name: 'macro_blur_2dc22d99',
        labelType: 'Tipo B',
        condition: 'macro-blur (LapVar 9.2)',
        barcodeDecoder: 'none',
        barcodeSku: null,
        barcodeUpc: null,
        lines: [],
        gt: {
          sku: '03-3850BK',
          upc: null,
          gtin: null,
          model: null,
          size: null,
          color: null,
          gw_kg: 18,
          serial: null,
          carton: null,
          po: null,
        },
      },
      {
        id: '25',
        name: 'macro_blur_3be4ecae',
        labelType: 'Tipo B',
        condition: 'macro-blur (LapVar 29.4)',
        barcodeDecoder: 'none',
        barcodeSku: null,
        barcodeUpc: null,
        lines: [],
        gt: {
          sku: '03-3973MN',
          upc: null,
          gtin: null,
          model: 'CITIZEN 3 STEP-THRU',
          size: '16"',
          color: 'VANILLA MINT',
          gw_kg: null,
          serial: null,
          carton: null,
          po: null,
        },
      },
      {
        id: '26',
        name: 'e8357910_multibox',
        labelType: 'Multietiqueta',
        condition: 'multibox (2 etiquetas)',
        barcodeDecoder: 'none',
        barcodeSku: null,
        barcodeUpc: null,
        lines: [
          [
            { text: '23"', box: { x: 280, y: 110, width: 95, height: 45 }, confidence: 0.92 },
            {
              text: 'Allegro A3',
              box: { x: 390, y: 110, width: 260, height: 45 },
              confidence: 0.94,
            },
          ],
          [{ text: '01-0448', box: { x: 340, y: 170, width: 220, height: 40 }, confidence: 0.95 }],
          [{ text: 'JAMIS', box: { x: 180, y: 550, width: 220, height: 50 }, confidence: 0.99 }],
          [
            { text: 'MODEL:', box: { x: 180, y: 620, width: 140, height: 35 }, confidence: 0.98 },
            {
              text: 'DXT A1 Step-Over',
              box: { x: 330, y: 620, width: 320, height: 35 },
              confidence: 0.97,
            },
          ],
          [
            {
              text: 'ITEM NO.:',
              box: { x: 180, y: 680, width: 160, height: 35 },
              confidence: 0.96,
            },
            {
              text: '03-3858BL',
              box: { x: 350, y: 680, width: 240, height: 35 },
              confidence: 0.98,
            },
          ],
          [
            { text: 'SIZE:', box: { x: 180, y: 740, width: 100, height: 35 }, confidence: 0.97 },
            { text: '700Cx18"', box: { x: 290, y: 740, width: 180, height: 35 }, confidence: 0.96 },
          ],
          [
            { text: 'COLOR:', box: { x: 180, y: 800, width: 130, height: 35 }, confidence: 0.97 },
            {
              text: 'Deep Blue',
              box: { x: 320, y: 800, width: 190, height: 35 },
              confidence: 0.98,
            },
          ],
          [
            { text: 'UPC:', box: { x: 180, y: 860, width: 90, height: 35 }, confidence: 0.96 },
            {
              text: '845436086651',
              box: { x: 280, y: 860, width: 260, height: 35 },
              confidence: 0.99,
            },
          ],
          [
            { text: 'GTIN:', box: { x: 180, y: 920, width: 100, height: 35 }, confidence: 0.96 },
            {
              text: '00845436086651',
              box: { x: 290, y: 920, width: 300, height: 35 },
              confidence: 0.99,
            },
          ],
          [
            {
              text: "Q'TY: 1 PC",
              box: { x: 180, y: 980, width: 170, height: 35 },
              confidence: 0.95,
            },
          ],
          [
            {
              text: 'N.W.: 12.80 KG',
              box: { x: 180, y: 1040, width: 220, height: 35 },
              confidence: 0.96,
            },
          ],
          [
            {
              text: 'G.W.: 15.40 KG',
              box: { x: 180, y: 1100, width: 220, height: 35 },
              confidence: 0.97,
            },
          ],
          [
            {
              text: 'PORT: NEW YORK',
              box: { x: 180, y: 1160, width: 250, height: 35 },
              confidence: 0.95,
            },
          ],
        ],
        gt: {
          sku: '03-3858BL',
          upc: '845436086651',
          gtin: '00845436086651',
          model: 'DXT A1 STEP-OVER',
          size: '700Cx18"',
          color: 'Deep Blue',
          gw_kg: 15.4,
          serial: null,
          carton: null,
          po: null,
        },
      },
    ];

    type FieldKey =
      | 'sku'
      | 'upc'
      | 'gtin'
      | 'model'
      | 'size'
      | 'color'
      | 'gw_kg'
      | 'serial'
      | 'carton'
      | 'po';
    const fields: FieldKey[] = [
      'sku',
      'upc',
      'gtin',
      'model',
      'size',
      'color',
      'gw_kg',
      'serial',
      'carton',
      'po',
    ];

    interface FieldStats {
      hits: number;
      errors: number;
      validNulls: number;
      misses: number;
      total: number;
    }

    const fieldStats = {} as Record<FieldKey, FieldStats>;
    for (const f of fields) {
      fieldStats[f] = { hits: 0, errors: 0, validNulls: 0, misses: 0, total: 0 };
    }

    const byType: Record<
      string,
      { total: number; skuHits: number; skuErrors: number; skuMisses: number; skuNulls: number }
    > = {};
    const byCondition: Record<
      string,
      { total: number; skuHits: number; skuErrors: number; skuMisses: number; skuNulls: number }
    > = {};

    let barcodeDecodedCount = 0;
    let barcodeNativeCount = 0;
    let barcodeZxingCount = 0;
    let barcodeOcrConcordanceHits = 0;
    let barcodeOcrConcordanceTotal = 0;

    for (const item of benchmarkSuite) {
      const extracted = extractFieldsFromOcrLines(item.lines, { width: 1000, height: 1000 });

      // Fusion barcodes + OCR + QR
      let cartonResolved: string | null = null;
      let poResolved: string | null = null;
      if (item.factoryQrRaw) {
        const qr = parseJamisFactoryQr(item.factoryQrRaw);
        if (qr) {
          cartonResolved = qr.carton;
          poResolved = qr.order;
        }
      }

      const resolvedSku = item.barcodeSku ?? extracted.sku;
      const resolvedUpc = item.barcodeUpc ?? extracted.upc;

      if (item.barcodeDecoder === 'native') {
        barcodeDecodedCount++;
        barcodeNativeCount++;
      } else if (item.barcodeDecoder === 'zxing') {
        barcodeDecodedCount++;
        barcodeZxingCount++;
      }

      if (item.barcodeSku) {
        barcodeOcrConcordanceTotal++;
        if (extracted.sku && extracted.sku === item.barcodeSku) {
          barcodeOcrConcordanceHits++;
        }
      }

      const currentResolved: Record<FieldKey, string | number | null> = {
        sku: resolvedSku,
        upc: resolvedUpc,
        gtin: extracted.gtin,
        model: extracted.model,
        size: extracted.size,
        color: extracted.color,
        gw_kg: extracted.gw_kg,
        serial: extracted.serial,
        carton: cartonResolved,
        po: poResolved,
      };

      for (const f of fields) {
        const pred = currentResolved[f];
        const truth = item.gt[f];
        fieldStats[f].total++;

        if (truth === null) {
          if (pred === null) {
            fieldStats[f].validNulls++;
          } else {
            fieldStats[f].errors++;
          }
        } else {
          if (pred === null) {
            fieldStats[f].misses++;
          } else {
            let isMatch = false;
            if (typeof truth === 'number' && typeof pred === 'number') {
              isMatch = Math.abs(truth - pred) < 0.05;
            } else if (typeof truth === 'string' && typeof pred === 'string') {
              const cleanT = truth.toUpperCase().replace(/[^A-Z0-9]/g, '');
              const cleanP = pred.toUpperCase().replace(/[^A-Z0-9]/g, '');
              isMatch = cleanT === cleanP || cleanP.includes(cleanT) || cleanT.includes(cleanP);
            }
            if (isMatch) {
              fieldStats[f].hits++;
            } else {
              fieldStats[f].errors++;
            }
          }
        }
      }

      // Breakdown by Type
      if (!byType[item.labelType]) {
        byType[item.labelType] = { total: 0, skuHits: 0, skuErrors: 0, skuMisses: 0, skuNulls: 0 };
      }
      byType[item.labelType].total++;
      if (item.gt.sku === null) {
        if (resolvedSku === null) byType[item.labelType].skuNulls++;
        else byType[item.labelType].skuErrors++;
      } else {
        if (resolvedSku === null) byType[item.labelType].skuMisses++;
        else {
          const cleanT = item.gt.sku.toUpperCase().replace(/[^A-Z0-9]/g, '');
          const cleanP = resolvedSku.toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (cleanT === cleanP) byType[item.labelType].skuHits++;
          else byType[item.labelType].skuErrors++;
        }
      }

      // Breakdown by Condition
      if (!byCondition[item.condition]) {
        byCondition[item.condition] = {
          total: 0,
          skuHits: 0,
          skuErrors: 0,
          skuMisses: 0,
          skuNulls: 0,
        };
      }
      byCondition[item.condition].total++;
      if (item.gt.sku === null) {
        if (resolvedSku === null) byCondition[item.condition].skuNulls++;
        else byCondition[item.condition].skuErrors++;
      } else {
        if (resolvedSku === null) byCondition[item.condition].skuMisses++;
        else {
          const cleanT = item.gt.sku.toUpperCase().replace(/[^A-Z0-9]/g, '');
          const cleanP = resolvedSku.toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (cleanT === cleanP) byCondition[item.condition].skuHits++;
          else byCondition[item.condition].skuErrors++;
        }
      }
    }

    console.log('\n======================================================');
    console.log('=== TABLA DE PRECISIÓN CAMPO POR CAMPO (PARTE 0.2) ===');
    console.log('======================================================');
    console.log(
      'Campo      | Aciertos (Hits) | Fallos (Errors) | Nulos Válidos | Omisiones (Misses) | Total Casos'
    );
    console.log(
      '-----------+-----------------+-----------------+---------------+--------------------+------------'
    );
    for (const f of fields) {
      const s = fieldStats[f];
      console.log(
        `${f.padEnd(10)} | ${String(s.hits).padEnd(15)} | ${String(s.errors).padEnd(15)} | ${String(s.validNulls).padEnd(13)} | ${String(s.misses).padEnd(18)} | ${s.total}`
      );
    }

    console.log('\n======================================================');
    console.log('=== DESGLOSE POR TIPO DE ETIQUETA (PARTE 0.3) ===');
    console.log('======================================================');
    console.log(
      'Tipo Etiqueta | Casos | SKU Aciertos | SKU Fallos | SKU Omisiones | SKU Nulos Válidos'
    );
    console.log(
      '--------------+-------+--------------+------------+---------------+------------------'
    );
    for (const [t, s] of Object.entries(byType)) {
      console.log(
        `${t.padEnd(13)} | ${String(s.total).padEnd(5)} | ${String(s.skuHits).padEnd(12)} | ${String(s.skuErrors).padEnd(10)} | ${String(s.skuMisses).padEnd(13)} | ${s.skuNulls}`
      );
    }

    console.log('\n======================================================');
    console.log('=== DESGLOSE POR CONDICIÓN DE LA FOTO (PARTE 0.3) ===');
    console.log('======================================================');
    console.log(
      'Condición                   | Casos | SKU Aciertos | SKU Fallos | SKU Omisiones | SKU Nulos'
    );
    console.log(
      '----------------------------+-------+--------------+------------+---------------+----------'
    );
    for (const [c, s] of Object.entries(byCondition)) {
      console.log(
        `${c.padEnd(27)} | ${String(s.total).padEnd(5)} | ${String(s.skuHits).padEnd(12)} | ${String(s.skuErrors).padEnd(10)} | ${String(s.skuMisses).padEnd(13)} | ${s.skuNulls}`
      );
    }

    console.log('\n======================================================');
    console.log('=== CÓDIGOS DE BARRA Y CONCORDANCIA (PARTE 0.4) ===');
    console.log('======================================================');
    console.log(`Total fotos analizadas: ${benchmarkSuite.length}`);
    console.log(
      `Fotos con barras decodificadas: ${barcodeDecodedCount} / ${benchmarkSuite.length} (${((barcodeDecodedCount / benchmarkSuite.length) * 100).toFixed(1)}%)`
    );
    console.log(`- Motor nativo (BarcodeDetector / Hardware): ${barcodeNativeCount}`);
    console.log(`- Motor WASM (zxing-wasm / Fallback): ${barcodeZxingCount}`);
    console.log(
      `Concordancia SKU Barras vs OCR: ${barcodeOcrConcordanceHits} / ${barcodeOcrConcordanceTotal} (${((barcodeOcrConcordanceHits / barcodeOcrConcordanceTotal) * 100).toFixed(1)}%)`
    );
  });
});
