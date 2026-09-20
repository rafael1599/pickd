import { describe, it, expect } from 'vitest';
import {
  asStockNumber,
  checkCode39Mod43,
  gtinCheckDigitOk,
  interpretBarcode,
  parseJamisFactoryQr,
  toUpcA,
} from '../barcodeText';

// Every UPC here was read off a real box on 15 Sep 2026 (docs/label-recognition/01 §6).
const REAL_UPCS = [
  '845436092959',
  '845436086774',
  '845436091594',
  '845436091679',
  '845436089485',
  '845436088099',
  '845436086545',
  '845436089331',
  '845436087757',
];

describe('gtinCheckDigitOk / toUpcA', () => {
  it.each(REAL_UPCS)('accepts the real UPC %s', (upc) => {
    expect(gtinCheckDigitOk(upc)).toBe(true);
    expect(toUpcA(upc)).toBe(upc);
  });

  it('reads the UPC inside EAN-13 (0+UPC) and GTIN-14 (00+UPC)', () => {
    expect(toUpcA('0845436092959')).toBe('845436092959');
    expect(toUpcA('00845436086774')).toBe('845436086774');
  });

  it('rejects the misread that the check digit caught on the damaged box (…02459…)', () => {
    expect(toUpcA('845436024594')).toBeNull();
  });

  it('rejects a single changed digit in every position', () => {
    const upc = '845436091594';
    for (let i = 0; i < upc.length; i++) {
      const wrong = upc.slice(0, i) + ((Number(upc[i]) + 1) % 10) + upc.slice(i + 1);
      expect(toUpcA(wrong)).toBeNull();
    }
  });

  it('rejects an EAN-13 that is not a UPC and non-digits', () => {
    expect(toUpcA('4006381333931')).toBeNull(); // valid EAN-13, but not 0-prefixed
    expect(toUpcA('84543609159X')).toBeNull();
  });
});

describe('asStockNumber', () => {
  it.each([
    ['03-4149BR', '03-4149BR'],
    ['03-4000-BL', '03-4000BL'],
    ['033774BK', '03-3774BK'],
    ['09-4807CL', '09-4807CL'],
    ['07-3680PD', '07-3680PD'],
  ])('%s → %s', (input, sku) => {
    expect(asStockNumber(input)).toBe(sku);
  });

  it.each(['R14', 'P1493', 'WMEI00065', '845436091594', '03-414BR'])(
    '%s is not a stock number',
    (t) => {
      expect(asStockNumber(t)).toBeNull();
    }
  );
});

describe('parseJamisFactoryQr', () => {
  it('reads the QR of a type-A factory label', () => {
    expect(parseJamisFactoryQr('0023JC-7RA1-G541,WRDH01637,1,SET,A129,A23JC-744,0003')).toEqual({
      factoryCode: '0023JC-7RA1-G541',
      frame: 'WRDH01637',
      quantity: 1,
      carton: 'A129',
      order: 'A23JC-744-0003',
    });
  });

  it('ignores a PickD asset-tag QR and plain text', () => {
    expect(parseJamisFactoryQr('https://pickd.pages.dev/s/03-4149BR')).toBeNull();
    expect(parseJamisFactoryQr('hello')).toBeNull();
  });
});

describe('interpretBarcode', () => {
  it('a verified UPC from EAN-13 is a UPC', () => {
    expect(interpretBarcode('0845436092959', 'EAN13')).toEqual({
      kind: 'upc',
      upc: '845436092959',
    });
  });

  it('the GTIN-14 in a Code 128 is the same UPC', () => {
    expect(interpretBarcode('00845436088099', 'Code128')).toEqual({
      kind: 'upc',
      upc: '845436088099',
    });
  });

  it('a Code 39 SKU is only a stock-number candidate', () => {
    expect(interpretBarcode('03-4149BR', 'Code39')).toEqual({
      kind: 'stock-number',
      sku: '03-4149BR',
    });
  });

  it('a FedEx tracking number in Code 128 stays text', () => {
    expect(interpretBarcode('776247882650', 'Code128')).toEqual({
      kind: 'text',
      text: '776247882650',
    });
  });

  it('validates Code 39 mod-43 and extracts verified SKU', () => {
    expect(interpretBarcode('03-4869MNP', 'Code39')).toEqual({
      kind: 'stock-number',
      sku: '03-4869MN',
      mod43Verified: true,
    });
  });

  it('validates Code 39 mod-43 and extracts verified UPC', () => {
    expect(interpretBarcode('845436098432D', 'Code39')).toEqual({
      kind: 'upc',
      upc: '845436098432',
      mod43Verified: true,
    });
  });
});

describe('checkCode39Mod43', () => {
  it('verifies 03-4869MNP (sum 111, mod 43 = 25 -> P)', () => {
    const res = checkCode39Mod43('03-4869MNP');
    expect(res).toEqual({
      valid: true,
      payload: '03-4869MN',
      checkChar: 'P',
      expectedChar: 'P',
    });
  });

  it('verifies 845436098432D (sum 56, mod 43 = 13 -> D)', () => {
    const res = checkCode39Mod43('845436098432D');
    expect(res).toEqual({
      valid: true,
      payload: '845436098432',
      checkChar: 'D',
      expectedChar: 'D',
    });
  });

  it('rejects string with wrong check character', () => {
    const res = checkCode39Mod43('03-4869MNX');
    expect(res).toEqual({
      valid: false,
      payload: '03-4869MN',
      checkChar: 'X',
      expectedChar: 'P',
    });
  });

  it('returns null for strings with invalid characters or too short', () => {
    expect(checkCode39Mod43('A')).toBeNull();
    expect(checkCode39Mod43('03-4869MN@P')).toBeNull();
  });
});
