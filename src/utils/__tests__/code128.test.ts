import { describe, it, expect } from 'vitest';
import { code128Pattern } from '../code128';

describe('code128Pattern', () => {
  it('encodes to a binary module string with bar guards', () => {
    const p = code128Pattern('03-4614BK');
    expect(p).toMatch(/^[01]+$/);
    expect(p.length).toBeGreaterThan(60);
    expect(p[0]).toBe('1'); // starts on a bar
    expect(p.endsWith('11')).toBe(true); // Code 128 stop ends on bars
  });

  it('is deterministic for the same input', () => {
    expect(code128Pattern('00-0000')).toBe(code128Pattern('00-0000'));
  });

  it('differs for different inputs', () => {
    expect(code128Pattern('AAA')).not.toBe(code128Pattern('BBB'));
  });
});
