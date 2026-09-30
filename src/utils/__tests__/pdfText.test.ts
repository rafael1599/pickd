import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import { guardPdfText, pdfSafeText } from '../pdfText';

describe('pdfSafeText', () => {
  it('turns the arrows PickD writes into ASCII', () => {
    expect(pdfSafeText('Replaced 03-3768BL → 03-3768BLD')).toBe('Replaced 03-3768BL -> 03-3768BLD');
    expect(pdfSafeText('ROW 12 ← CAGE')).toBe('ROW 12 <- CAGE');
    expect(pdfSafeText('26"×18" ≥ 5 ✕ 2')).toBe('26"×18" >= 5 x 2');
  });

  it('keeps what the built-in fonts can draw', () => {
    const ok = 'Niño · 3/4" — “SD” #12 ½ 45° café • €';
    expect(pdfSafeText(ok)).toBe(ok);
    expect(pdfSafeText('line 1\nline 2')).toBe('line 1\nline 2');
  });

  it('drops emoji and keeps the base letter of accents outside Latin-1', () => {
    expect(pdfSafeText('OK ✅ done')).toBe('OK  done');
    expect(pdfSafeText('Erdős Łódź')).toBe('Erdos ódz');
  });
});

describe('guardPdfText', () => {
  it('sanitises drawn and measured text, arrays included', () => {
    const doc = guardPdfText(new jsPDF());
    expect(doc.getTextWidth('A → B')).toBeCloseTo(doc.getTextWidth('A -> B'));
    expect(doc.splitTextToSize('A → B', 200)).toEqual(['A -> B']);
    expect(() => doc.text(['a → b', 'c'], 10, 10)).not.toThrow();
  });
});
