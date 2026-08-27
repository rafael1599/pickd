import { describe, expect, it } from 'vitest';
import { carrierCandidates, fitCarriers } from '../carrierPicker';

const ALL = [
  'R+L',
  '2-DAY',
  'RIST',
  'TFORCE',
  'DAYLIGHT',
  'PAV EXPRESS',
  'ESTES',
  'FEDEX',
  'PICK UP',
];
const W = 100; // every chip 100px wide in these tests
const width = () => W;

describe('carrierCandidates — who may sit on the row', () => {
  it('a regular order ranks by use and never offers FedEx', () => {
    expect(carrierCandidates(ALL, false, null)).toEqual([
      'R+L',
      'RIST',
      'PICK UP',
      'DAYLIGHT',
      'PAV EXPRESS',
      '2-DAY',
      'ESTES',
      'TFORCE',
    ]);
  });

  it('a FedEx order offers FedEx alone', () => {
    expect(carrierCandidates(ALL, true, null)).toEqual(['FEDEX']);
    expect(carrierCandidates(ALL, true, 'FEDEX')).toEqual(['FEDEX']);
  });

  it('the selected carrier is a candidate even when the lane would hide it', () => {
    expect(carrierCandidates(ALL, false, 'FEDEX')[0]).toBe('FEDEX');
    expect(carrierCandidates(ALL, true, 'PICK UP')).toEqual(['FEDEX', 'PICK UP']);
  });
});

describe('fitCarriers — what fits on one line', () => {
  const cands = carrierCandidates(ALL, false, null);

  it('takes as many as fit, in order, counting the gaps', () => {
    // 3 chips = 300 + 2 gaps of 8 = 316; a 4th needs 424
    expect(fitCarriers(cands, width, 316, 8, null)).toEqual(['R+L', 'RIST', 'PICK UP']);
    expect(fitCarriers(cands, width, 423, 8, null)).toEqual(['R+L', 'RIST', 'PICK UP']);
    expect(fitCarriers(cands, width, 424, 8, null)).toEqual(['R+L', 'RIST', 'PICK UP', 'DAYLIGHT']);
  });

  it('a wide desktop shows them all, a phone shows one — never zero', () => {
    expect(fitCarriers(cands, width, 5000, 8, null)).toEqual(cands);
    expect(fitCarriers(cands, width, 50, 8, null)).toEqual(['R+L']);
  });

  it('the selected carrier always makes the cut, taking the last slot', () => {
    expect(fitCarriers(cands, width, 316, 8, 'ESTES')).toEqual(['R+L', 'RIST', 'ESTES']);
    expect(fitCarriers(cands, width, 316, 8, 'RIST')).toEqual(['R+L', 'RIST', 'PICK UP']);
  });
});
