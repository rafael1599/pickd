import { describe, it, beforeEach, afterEach, vi, expect } from 'vitest';
import { generateBikeLabels, type LabelItem } from '../generateBikeLabel';
import { createRecorder, type PdfRecorder } from '../../../../test/pdfRecorder';

vi.mock('jspdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jspdf')>();
  const { wrapJsPDFConstructor } = await import('../../../../test/pdfRecorder');
  const Wrapped = wrapJsPDFConstructor(actual.default);
  return { ...actual, default: Wrapped, jsPDF: Wrapped };
});

// Capture what gets encoded into the QR.
const qr = vi.hoisted(() => ({
  calls: [] as Array<{ payload: string; opts: { errorCorrectionLevel?: string } }>,
}));
vi.mock('qrcode', () => {
  const toDataURL = async (payload: string, opts: { errorCorrectionLevel?: string }) => {
    qr.calls.push({ payload, opts });
    return 'mock-qr';
  };
  return { default: { toDataURL }, toDataURL };
});

const UUID = '7f3e4d2a-1b2c-4d5e-8f90-1a2b3c4d5e6f';
const base: LabelItem = {
  sku: '03-4614BK',
  item_name: 'Faultline A1',
  short_code: 'PK-000A1',
  public_token: UUID,
  color: 'Sandstorm',
  layout: 'standard',
};

describe('generateBikeLabels — QR payload', () => {
  let rec: PdfRecorder;
  beforeEach(() => {
    rec = createRecorder();
    qr.calls.length = 0;
  });
  afterEach(() => rec.restore());

  it('QR carries only the SKU (/s/<sku>), no short_code or token, EC level L', async () => {
    await generateBikeLabels([base]);

    expect(qr.calls.length).toBeGreaterThan(0);
    const { payload, opts } = qr.calls[0];

    expect(payload).toMatch(/\/s\/03-4614BK$/); // /s/<sku>, nothing after
    expect(payload).not.toContain('/tag/'); // no token route
    expect(payload).not.toContain('PK-000A1'); // no short_code
    expect(payload).not.toContain(UUID); // no token
    expect(opts.errorCorrectionLevel).toBe('L');
  });

  it('URL-encodes SKUs with special characters', async () => {
    await generateBikeLabels([{ ...base, sku: '03/46 14' }]);
    expect(qr.calls[0].payload).toMatch(/\/s\/03%2F46%2014$/);
  });
});
