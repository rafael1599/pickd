import { describe, it, expect } from 'vitest';
import {
  calculateOpticalParameters,
  getRecommendedDistanceRange,
  GALAXY_S25_ULTRA_PROFILE,
} from '../opticalGeometry';

describe('opticalGeometry', () => {
  describe('calculateOpticalParameters', () => {
    it('calculates valid optical parameters in the safe scanning zone (250 mm)', () => {
      const result = calculateOpticalParameters(250, 1920, 1080, GALAXY_S25_ULTRA_PROFILE);

      // At 250 mm with 68° HFOV:
      // sceneWidthMm ~ 2 * 250 * tan(34°) = 500 * 0.6745 = 337.25 mm
      // pixelDensity ~ 1920 / 337.25 = 5.69 px/mm
      expect(result.distanceMm).toBe(250);
      expect(result.pixelDensityPxPerMm).toBeGreaterThan(5.0);
      expect(result.pixelDensityPxPerMm).toBeLessThan(6.5);

      // Barcode module 13-mil (0.33 mm) -> 0.33 * 5.69 ~ 1.88 px/module
      expect(result.barcodeModulePixels).toBeGreaterThanOrEqual(1.8);
      expect(result.isBarcodeInSafeZone).toBe(true);

      // Small glyph (2.8 mm) -> 2.8 * 5.69 ~ 15.9 - 16.0 px
      expect(result.smallestGlyphPixels).toBeGreaterThan(15.0);

      // Focus distance >= 150 mm
      expect(result.isMacroBlurSafe).toBe(true);
    });

    it('flags macro blur risk when distance is below minimum lens focus distance (< 150 mm)', () => {
      const result = calculateOpticalParameters(100, 1920, 1080, GALAXY_S25_ULTRA_PROFILE);
      expect(result.isMacroBlurSafe).toBe(false);
    });

    it('flags barcode out of safe zone when distance is too far (> 700 mm)', () => {
      const result = calculateOpticalParameters(800, 1920, 1080, GALAXY_S25_ULTRA_PROFILE);
      expect(result.isBarcodeInSafeZone).toBe(false);
      expect(result.barcodeModulePixels).toBeLessThan(1.45);
    });
  });

  describe('getRecommendedDistanceRange', () => {
    it('returns consistent distance range for Galaxy S25 Ultra at 1080p', () => {
      const range = getRecommendedDistanceRange(1920, GALAXY_S25_ULTRA_PROFILE);

      expect(range.minSafeMm).toBe(150);
      expect(range.maxSafeMm).toBeGreaterThan(range.minSafeMm);
      expect(range.optimalMm).toBeGreaterThanOrEqual(range.minSafeMm);
      expect(range.optimalMm).toBeLessThanOrEqual(range.maxSafeMm);
    });
  });
});
