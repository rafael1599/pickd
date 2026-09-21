import { describe, it, expect, beforeEach } from 'vitest';
import { extractCandidateFromBarcode, TemporalConsensusFilter } from '../liveBarcodeScanner';

describe('liveBarcodeScanner', () => {
  describe('extractCandidateFromBarcode', () => {
    it('extracts canonical Jamis SKU formats', () => {
      expect(extractCandidateFromBarcode('03-3989GY')).toEqual({ sku: '03-3989GY' });
      expect(extractCandidateFromBarcode('06-4573-GY')).toEqual({ sku: '06-4573GY' });
      expect(extractCandidateFromBarcode('  01-044817  ')).toEqual({ sku: '01-044817' });
    });

    it('extracts SKU with Mod-43 Code 39 checksum attached', () => {
      // 03-4869MN has Mod-43 checksum 'P'
      expect(extractCandidateFromBarcode('03-4869MNP')).toEqual({ sku: '03-4869MN' });
    });

    it('extracts Jamis serial number pattern', () => {
      expect(extractCandidateFromBarcode('U226U03779')).toEqual({ serial: 'U226U03779' });
      expect(extractCandidateFromBarcode('M22E009702')).toEqual({ serial: 'M22E009702' });
      expect(extractCandidateFromBarcode('G220303752')).toEqual({ serial: 'G220303752' });
    });

    it('returns empty object for unknown formats', () => {
      expect(extractCandidateFromBarcode('')).toEqual({});
      expect(extractCandidateFromBarcode('HELLO-WORLD')).toEqual({});
    });
  });

  describe('TemporalConsensusFilter', () => {
    let filter: TemporalConsensusFilter;

    beforeEach(() => {
      filter = new TemporalConsensusFilter({ requiredFrames: 2, windowMs: 600 });
    });

    it('does not emit candidate on the first frame', () => {
      const candidate = filter.pushFrame({
        rawValue: '03-3989GY',
        format: 'code_39',
        timestamp: 1000,
      });

      expect(candidate).toBeNull();
      expect(filter.getActiveCandidate()).toBeNull();
    });

    it('emits proposed box candidate upon reaching required consecutive frames within window', () => {
      // Frame 1
      filter.pushFrame({
        rawValue: '03-3989GY',
        format: 'code_39',
        timestamp: 1000,
      });

      // Frame 2 at +50ms
      const candidate = filter.pushFrame({
        rawValue: '03-3989GY',
        format: 'code_39',
        timestamp: 1050,
      });

      expect(candidate).not.toBeNull();
      expect(candidate?.sku).toBe('03-3989GY');
      expect(candidate?.consecutiveFrames).toBe(2);
      expect(candidate?.confidence).toBeGreaterThanOrEqual(0.8);
      expect(candidate?.firstDetectedAt).toBe(1000);
      expect(candidate?.lastDetectedAt).toBe(1050);
      expect(filter.getActiveCandidate()).toEqual(candidate);
    });

    it('expires stale frames that fall outside windowMs', () => {
      // Frame 1 at t=1000
      filter.pushFrame({
        rawValue: '03-3989GY',
        format: 'code_39',
        timestamp: 1000,
      });

      // Frame 2 at t=1700 (delta = 700ms > 600ms window)
      const candidate = filter.pushFrame({
        rawValue: '03-3989GY',
        format: 'code_39',
        timestamp: 1700,
      });

      // Stale frame dropped, so count is only 1
      expect(candidate).toBeNull();
    });

    it('clears active candidate and history on reset', () => {
      filter.pushFrame({
        rawValue: '03-3989GY',
        format: 'code_39',
        timestamp: 1000,
      });
      filter.pushFrame({
        rawValue: '03-3989GY',
        format: 'code_39',
        timestamp: 1050,
      });
      expect(filter.getActiveCandidate()).not.toBeNull();

      filter.reset();
      expect(filter.getActiveCandidate()).toBeNull();
    });
  });
});
