/**
 * Comparar un campo leído en la foto con el del catálogo. Puro: no importa
 * Supabase, así que el motor (`recognizeMultiBoxClient`) lo puede usar dentro
 * de un Worker sin arrastrar el cliente — la sombra de Double Check lee ahí
 * con `catalog: false` (`docs/label-recognition/09-plan-de-evaluacion.md`, E4).
 */

export interface FieldComparison {
  status: 'match' | 'discrepancy' | 'catalog_only' | 'ocr_only';
  catalogValue: string | null;
  ocrValue: string | null;
  detail?: string;
}

export function normalizeValue(val: string | null | undefined): string {
  if (!val) return '';
  return val
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function compareField(
  catalogVal: string | null | undefined,
  ocrVal: string | null | undefined
): FieldComparison {
  const cat = catalogVal?.trim() || null;
  const ocr = ocrVal?.trim() || null;

  if (!cat && !ocr) {
    return { status: 'catalog_only', catalogValue: null, ocrValue: null };
  }
  if (!ocr) {
    return { status: 'catalog_only', catalogValue: cat, ocrValue: null };
  }
  if (!cat) {
    return { status: 'ocr_only', catalogValue: null, ocrValue: ocr };
  }

  const normCat = normalizeValue(cat);
  const normOcr = normalizeValue(ocr);

  // Exact match after normalization (e.g. "CITIZEN 3 STEP THRU" vs "CITIZEN 3-STEP-THRU")
  if (normCat === normOcr) {
    return { status: 'match', catalogValue: cat, ocrValue: ocr };
  }

  // Substring inclusion (e.g. "VANILLA MINT" contains "MINT", or "700C*16" contains "16")
  if (normCat.includes(normOcr) || normOcr.includes(normCat)) {
    return { status: 'match', catalogValue: cat, ocrValue: ocr };
  }

  // Word token overlap
  const catTokens = new Set(normCat.split(' ').filter(Boolean));
  const ocrTokens = normOcr.split(' ').filter(Boolean);
  if (ocrTokens.length > 0 && ocrTokens.every((t) => catTokens.has(t))) {
    return { status: 'match', catalogValue: cat, ocrValue: ocr };
  }

  return {
    status: 'discrepancy',
    catalogValue: cat,
    ocrValue: ocr,
    detail: `Catálogo dice "${cat}", foto dice "${ocr}"`,
  };
}
