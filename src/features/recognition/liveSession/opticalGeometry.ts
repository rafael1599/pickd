/**
 * opticalGeometry.ts
 *
 * Fundamentos matemáticos y justificación óptica para la captura en vivo
 * en la sesión caja por caja (Fase F2 / MVP de Orden).
 *
 * Basado en los hallazgos de R11 (Bloque 2) y R12:
 * - Umbral mínimo de Nyquist para decodificación 1D: >= 1.45 px/módulo
 * - Zona robusta recomendada: >= 1.80 px/módulo
 * - Altura mínima de glifo legible para PP-OCRv6: >= 16 px
 */

export interface CameraOpticalProfile {
  name: string;
  horizontalFovDeg: number; // e.g. 68° for Galaxy S25 Ultra 1x main lens
  minFocusDistanceMm: number; // 150 mm (15 cm) macro safety limit to avoid LapVar < 30
}

export const GALAXY_S25_ULTRA_PROFILE: CameraOpticalProfile = {
  name: 'Samsung Galaxy S25 Ultra (1x Main Wide)',
  horizontalFovDeg: 68.0,
  minFocusDistanceMm: 150.0,
};

export interface OpticalCalculationResult {
  distanceMm: number;
  frameWidthPx: number;
  frameHeightPx: number;
  sceneWidthMm: number;
  pixelDensityPxPerMm: number;
  barcodeModulePixels: number; // For standard 13-mil Code 39/UPC (0.33 mm narrow bar)
  smallestGlyphPixels: number; // For 2.8 mm small label text (G.W., C/NO)
  isBarcodeInSafeZone: boolean; // >= 1.45 px/module
  isOcrInSafeZone: boolean; // >= 16 px glyph
  isMacroBlurSafe: boolean; // distance >= minFocusDistanceMm
}

/**
 * Calcula la densidad de píxeles y resolución efectiva de glifos/barras
 * a una distancia dada del paquete.
 */
export function calculateOpticalParameters(
  distanceMm: number,
  frameWidthPx: number = 1920,
  frameHeightPx: number = 1080,
  camera: CameraOpticalProfile = GALAXY_S25_ULTRA_PROFILE,
  narrowBarMm: number = 0.33,
  glyphHeightMm: number = 2.8
): OpticalCalculationResult {
  // Ancho visible en mm a la distancia dada: W = 2 * D * tan(HFOV / 2)
  const halfFovRad = (camera.horizontalFovDeg * Math.PI) / 360.0;
  const sceneWidthMm = 2.0 * distanceMm * Math.tan(halfFovRad);

  const pixelDensityPxPerMm = frameWidthPx / Math.max(1.0, sceneWidthMm);
  const barcodeModulePixels = narrowBarMm * pixelDensityPxPerMm;
  const smallestGlyphPixels = glyphHeightMm * pixelDensityPxPerMm;

  return {
    distanceMm,
    frameWidthPx,
    frameHeightPx,
    sceneWidthMm: Math.round(sceneWidthMm),
    pixelDensityPxPerMm: Number(pixelDensityPxPerMm.toFixed(2)),
    barcodeModulePixels: Number(barcodeModulePixels.toFixed(2)),
    smallestGlyphPixels: Number(smallestGlyphPixels.toFixed(1)),
    isBarcodeInSafeZone: barcodeModulePixels >= 1.45,
    isOcrInSafeZone: smallestGlyphPixels >= 16.0,
    isMacroBlurSafe: distanceMm >= camera.minFocusDistanceMm,
  };
}

/**
 * Recomienda la distancia óptima de escaneo en mm basada en resolución seleccionada.
 */
export function getRecommendedDistanceRange(
  frameWidthPx: number = 1920,
  camera: CameraOpticalProfile = GALAXY_S25_ULTRA_PROFILE
): { minSafeMm: number; maxSafeMm: number; optimalMm: number } {
  // Distancia mínima para evitar macro blur
  const minSafeMm = camera.minFocusDistanceMm; // 150 mm

  // Distancia máxima donde el módulo de la barra se mantiene >= 1.45 px
  // 1.45 = narrowBarMm * (frameWidthPx / (2 * D_max * tan(halfFov)))
  const halfFovRad = (camera.horizontalFovDeg * Math.PI) / 360.0;
  const narrowBarMm = 0.33;
  const maxSafeMm = Math.floor((narrowBarMm * frameWidthPx) / (2.0 * 1.45 * Math.tan(halfFovRad)));

  // Distancia óptima (donde barcodeModule >= 2.0 px y operador tiene encuadre cómodo)
  const optimalMm = Math.round((minSafeMm + Math.min(maxSafeMm, 350)) / 2.0);

  return {
    minSafeMm,
    maxSafeMm,
    optimalMm,
  };
}
