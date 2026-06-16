import { describe, it, beforeEach, afterEach, vi, expect } from 'vitest';
import { generateBikeLabels, type LabelItem } from '../generateBikeLabel';
import { encodeTagToken, decodeTagToken } from '../../../../utils/tagToken';
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

  it('embeds a compact base64url token (not the raw UUID), keeps /tag + ?sku, EC level L', async () => {
    await generateBikeLabels([base]);

    expect(qr.calls.length).toBeGreaterThan(0);
    const { payload, opts } = qr.calls[0];

    expect(payload).toContain('/tag/PK-000A1/');
    expect(payload).toContain('?sku=03-4614BK');
    expect(payload).toContain(encodeTagToken(UUID)); // 22-char token present
    expect(payload).not.toContain(UUID); // raw 36-char UUID absent
    expect(decodeTagToken(encodeTagToken(UUID))).toBe(UUID); // still resolves back
    expect(opts.errorCorrectionLevel).toBe('L');

    // The tag portion is shorter than the old UUID-based form.
    const oldForm = `/tag/PK-000A1/${UUID}?sku=03-4614BK`;
    const newForm = payload.slice(payload.indexOf('/tag/'));
    expect(newForm.length).toBeLessThan(oldForm.length);
  });
});
