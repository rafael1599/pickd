import { describe, it, beforeEach, afterEach, vi, expect } from 'vitest';
import { generateShipLabel, type ShipLabelData } from '../generateShipLabel';
import {
  createRecorder,
  expectGrayscaleOnly,
  expectNoTextOverlap,
  expectOrderedText,
  expectContains,
  type PdfRecorder,
} from '../../../test/pdfRecorder';

vi.mock('jspdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jspdf')>();
  const { wrapJsPDFConstructor } = await import('../../../test/pdfRecorder');
  const Wrapped = wrapJsPDFConstructor(actual.default);
  return { ...actual, default: Wrapped, jsPDF: Wrapped };
});

const base: ShipLabelData = {
  customerName: 'Acme Bikes',
  street: '123 Main St',
  city: 'Springfield',
  state: 'IL',
  zip: '62704',
  orderNumber: '880123',
  pallets: 1,
  bikeCount: 3,
  partCount: 2,
  weightLbs: 140,
  loadNumber: 'L-7',
  // The sideways last label is checked on its own below: the recorder measures
  // text as if it were horizontal, so turned text reads as overlapping.
  sideLabel: false,
};

/** A stand-in logo: 3:1, like most carriers'. The recorder never decodes it. */
const logo = {
  dataUrl: 'data:image/png;base64,AAAA',
  width: 300,
  height: 100,
  rotatedDataUrl: 'data:image/png;base64,BBBB',
};

describe('generateShipLabel', () => {
  let rec: PdfRecorder;
  beforeEach(() => {
    rec = createRecorder();
  });
  afterEach(() => rec.restore());

  it('info label: B&W, ordered, nothing overlapping, complete', async () => {
    await generateShipLabel(base);

    expectGrayscaleOnly(rec);
    expectNoTextOverlap(rec);
    expectContains(rec, [
      'ACME BIKES',
      '123 MAIN ST',
      'SPRINGFIELD, IL 62704',
      'ORDER #: 880123',
      'PALLETS: 1',
      'BIKES: 3',
      'PARTS: 2',
      'LOAD: L-7',
      'WEIGHT: 140 LBS',
      'SHIPMENT', // the thank-you message rendered
    ]);
    expectOrderedText(
      rec,
      ['ACME BIKES', '123 MAIN ST', 'SPRINGFIELD', 'ORDER #: 880123', 'PALLETS: 1', 'LOAD: L-7'],
      1
    );
  });

  it('multi-pallet: adds a centred PALLET "i of N" page per pallet', async () => {
    await generateShipLabel({ ...base, pallets: 2 });

    expectGrayscaleOnly(rec);
    expectNoTextOverlap(rec);
    expectContains(rec, ['PALLET', '1 of 2', '2 of 2']);
  });

  it('falls back to UNITS: 0 and GENERIC CUSTOMER for empty data', async () => {
    await generateShipLabel({
      ...base,
      customerName: null,
      bikeCount: 0,
      partCount: 0,
      weightLbs: 0,
    });

    expectGrayscaleOnly(rec);
    expectContains(rec, ['UNITS: 0', 'WEIGHT: N/A']);
  });

  it('the carrier logo sits top right of every label and no text runs into it', async () => {
    await generateShipLabel({ ...base, pallets: 2, logo, carrier: 'R+L' });

    expectGrayscaleOnly(rec);
    expectNoTextOverlap(rec); // includes image ↔ text
    const images = rec.images();
    expect(images).toHaveLength(4); // info + «PALLET i of N», for each of 2 pallets
    for (const img of images) {
      expect(img.x + img.w).toBeCloseTo(6 - 0.2);
      expect(img.y).toBeCloseTo(0.2);
    }
  });

  it('adds one last label turned 90° to the right: order #, shop, pallets, big logo', async () => {
    await generateShipLabel({
      ...base,
      customerName: "Archer's Bikes",
      orderNumber: '881774',
      pallets: 2,
      logo,
      carrier: 'R+L',
      sideLabel: true,
    });

    const last = Math.max(...rec.texts().map((t) => t.page));
    const side = rec.texts().filter((t) => t.page === last);
    expect(side.map((t) => t.text)).toEqual(['881774', "ARCHER'S BIKES", '2 PALLETS']);
    // The order number is the biggest thing on the label.
    expect(side[0].fontSize).toBeGreaterThan(side[1].fontSize);
    expect(side[0].fontSize).toBeGreaterThan(side[2].fontSize);
    // Columns run from the right edge leftwards, and the logo fills what is left.
    expect(side[0].x).toBeGreaterThan(side[1].x);
    expect(side[1].x).toBeGreaterThan(side[2].x);
    const bigLogo = rec.images().filter((i) => i.page === last);
    expect(bigLogo).toHaveLength(1);
    expect(bigLogo[0].x + bigLogo[0].w).toBeLessThan(side[2].x);
    // Turned, the logo is taller than it is wide.
    expect(bigLogo[0].h).toBeGreaterThan(bigLogo[0].w);
    expectGrayscaleOnly(rec);
  });

  it('without a logo (PICK UP) the side label names the carrier instead', async () => {
    await generateShipLabel({ ...base, carrier: 'PICK UP', logo: null, sideLabel: true });
    const last = Math.max(...rec.texts().map((t) => t.page));
    expect(
      rec
        .texts()
        .filter((t) => t.page === last)
        .map((t) => t.text)
    ).toContain('PICK UP');
    expect(rec.images()).toHaveLength(0);
  });
});
