/**
 * Sub-phase A3c: Read-only catalog lookup & cross-check for detected SKUs.
 *
 * Runs a single read-only SELECT against sku_metadata (with inventory join)
 * using sku_key for hyphen-agnostic matching.
 *
 * ZERO INSERT / UPDATE. Uses standard Supabase client with existing RLS.
 */

import { supabase } from '../../lib/supabase';
import { withSupabaseRetry } from '../../lib/supabaseRetry';
import { parseBikeName } from '../inventory/utils/parseBikeName';

export interface CatalogStockLocation {
  location: string;
  quantity: number;
}

export interface CatalogSuggestion {
  sku: string;
  source: 'catalog' | 'as400_inferred';
  model: string | null;
  size: string | null;
  color: string | null;
  isBike: boolean | null;
  as400Description: string | null;
  totalStock: number;
  inStock: boolean;
  stockLocations: CatalogStockLocation[];
}

export interface FieldComparison {
  status: 'match' | 'discrepancy' | 'catalog_only' | 'ocr_only';
  catalogValue: string | null;
  ocrValue: string | null;
  detail?: string;
}

export interface CatalogLookupResult {
  status: 'found' | 'not_found' | 'error';
  sku: string;
  data: CatalogSuggestion | null;
  error?: string;
  comparisons?: {
    model: FieldComparison;
    size: FieldComparison;
    color: FieldComparison;
  };
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

interface SkuMetadataRow {
  sku: string;
  model: string | null;
  size: string | null;
  color: string | null;
  is_bike: boolean | null;
  as400_description: string | null;
  inventory: Array<{
    location: string | null;
    quantity: number | null;
    item_name: string | null;
    is_active: boolean | null;
  }> | null;
}

/**
 * Queries catalog data for a given SKU (read-only).
 * Normalizes dashes and spaces using sku_key.
 */
export async function lookupCatalogSku(
  rawSku: string,
  ocrFields?: {
    model?: string | null;
    size?: string | null;
    color?: string | null;
  }
): Promise<CatalogLookupResult> {
  const cleanKey = rawSku.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleanKey) {
    return {
      status: 'not_found',
      sku: rawSku,
      data: null,
    };
  }

  try {
    const { data: rawData, error } = await withSupabaseRetry(
      () =>
        supabase
          .from('sku_metadata')
          .select(
            `
            sku,
            model,
            size,
            color,
            is_bike,
            as400_description,
            inventory (
              location,
              quantity,
              item_name,
              is_active
            )
          `
          )
          .eq('sku_key', cleanKey)
          .maybeSingle(),
      { label: 'catalogLookup.lookupCatalogSku' }
    );

    if (error) {
      return {
        status: 'error',
        sku: rawSku,
        data: null,
        error: error.message,
      };
    }

    if (!rawData) {
      return {
        status: 'not_found',
        sku: rawSku,
        data: null,
      };
    }

    const data = rawData as unknown as SkuMetadataRow;
    const invRows = data.inventory || [];
    const activeRows = invRows.filter((r) => r.is_active !== false && (r.quantity ?? 0) > 0);
    const totalStock = activeRows.reduce((sum, r) => sum + (r.quantity ?? 0), 0);
    const inStock = totalStock > 0;
    const stockLocations: CatalogStockLocation[] = activeRows.map((r) => ({
      location: r.location || 'UNKNOWN',
      quantity: r.quantity ?? 0,
    }));

    const rawModel = data.model?.trim() || null;
    const rawSize = data.size?.trim() || null;
    const rawColor = data.color?.trim() || null;
    const as400Desc = data.as400_description?.trim() || null;

    let model: string | null = rawModel;
    let size: string | null = rawSize;
    let color: string | null = rawColor;
    let source: 'catalog' | 'as400_inferred' = 'catalog';

    // Case 2: SKU has no discrete model, but has AS400 description or inventory item_name
    if (!model) {
      const fallbackName = as400Desc || invRows[0]?.item_name?.trim() || '';
      if (fallbackName) {
        source = 'as400_inferred';
        const parsed = parseBikeName(fallbackName);
        model = parsed.model || fallbackName;
        size = rawSize || (parsed.size ? parsed.size : null);
        color = rawColor || (parsed.color ? parsed.color : null);
      }
    }

    const suggestion: CatalogSuggestion = {
      sku: data.sku,
      source,
      model,
      size,
      color,
      isBike: data.is_bike,
      as400Description: as400Desc,
      totalStock,
      inStock,
      stockLocations,
    };

    const comparisons = ocrFields
      ? {
          model: compareField(suggestion.model, ocrFields.model),
          size: compareField(suggestion.size, ocrFields.size),
          color: compareField(suggestion.color, ocrFields.color),
        }
      : undefined;

    return {
      status: 'found',
      sku: data.sku,
      data: suggestion,
      comparisons,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al consultar catálogo';
    return {
      status: 'error',
      sku: rawSku,
      data: null,
      error: msg,
    };
  }
}

function formatComparisonTag(c?: FieldComparison): string {
  if (!c) return '';
  if (c.status === 'match') return ' [Coincide con foto]';
  if (c.status === 'discrepancy') {
    return ` [DISCREPANCIA: catálogo="${c.catalogValue ?? '—'}", foto="${c.ocrValue ?? '—'}"]`;
  }
  if (c.status === 'catalog_only') return ' [Sugerencia de catálogo]';
  return '';
}

export function formatCatalogSummary(catalog: CatalogLookupResult): string {
  const lines: string[] = ['=== SUGERENCIA DEL CATÁLOGO (PICKD) ==='];

  if (catalog.status === 'not_found') {
    lines.push(`SKU: ${catalog.sku} — SKU no registrado en PickD`);
    return lines.join('\n');
  }

  if (catalog.status === 'error') {
    lines.push(`Error al consultar catálogo: ${catalog.error}`);
    return lines.join('\n');
  }

  const data = catalog.data!;
  lines.push(`SKU Canónico: ${data.sku}`);
  lines.push(`Origen: ${data.source === 'catalog' ? 'Catálogo oficial' : 'Inferido de AS400'}`);
  lines.push(
    `Tipo: ${data.isBike === true ? 'Bicicleta' : data.isBike === false ? 'Repuesto / Parte' : 'No especificado'}`
  );
  lines.push(`Modelo: ${data.model ?? '—'}${formatComparisonTag(catalog.comparisons?.model)}`);
  lines.push(`Talla: ${data.size ?? '—'}${formatComparisonTag(catalog.comparisons?.size)}`);
  lines.push(`Color: ${data.color ?? '—'}${formatComparisonTag(catalog.comparisons?.color)}`);
  lines.push(
    `Stock total: ${data.totalStock} unidades (${data.inStock ? 'En stock' : 'Sin stock'})`
  );

  if (data.stockLocations.length > 0) {
    const locs = data.stockLocations.map((l) => `${l.location} (${l.quantity})`).join(', ');
    lines.push(`Ubicaciones: ${locs}`);
  } else {
    lines.push('Ubicaciones: Ninguna');
  }

  return lines.join('\n');
}

/**
 * Queries catalog data for multiple candidate SKUs (read-only) (A3k).
 * Deduplicates by sku_key to prevent redundant database requests.
 */
export async function lookupAllCatalogSkus(
  skus: string[],
  ocrFields?: {
    model?: string | null;
    size?: string | null;
    color?: string | null;
  }
): Promise<CatalogLookupResult[]> {
  const cleanSkus: string[] = [];
  const seenKeys = new Set<string>();

  for (const s of skus) {
    const key = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (key && !seenKeys.has(key)) {
      seenKeys.add(key);
      cleanSkus.push(s);
    }
  }

  const results: CatalogLookupResult[] = [];
  for (const sku of cleanSkus) {
    const res = await lookupCatalogSku(sku, ocrFields);
    results.push(res);
  }
  return results;
}

/**
 * Formats catalog summaries for one or multiple SKU candidates (A3k).
 */
export function formatAllCatalogSummaries(catalogResults: CatalogLookupResult[]): string {
  if (!catalogResults || catalogResults.length === 0) return '';
  if (catalogResults.length === 1) {
    return formatCatalogSummary(catalogResults[0]);
  }

  const lines: string[] = [
    `=== FICHAS DE CATÁLOGO PICKD (${catalogResults.length} CANDIDATOS) ===`,
  ];

  catalogResults.forEach((res, idx) => {
    lines.push('');
    lines.push(`--- CANDIDATO ${idx + 1}: SKU ${res.sku} ---`);
    if (res.status === 'not_found') {
      lines.push('  SKU no registrado en PickD');
    } else if (res.status === 'error') {
      lines.push(`  Error al consultar catálogo: ${res.error}`);
    } else if (res.data) {
      const data = res.data;
      lines.push(`  SKU Canónico: ${data.sku}`);
      lines.push(
        `  Origen: ${data.source === 'catalog' ? 'Catálogo oficial' : 'Inferido de AS400'}`
      );
      lines.push(
        `  Tipo: ${data.isBike === true ? 'Bicicleta' : data.isBike === false ? 'Repuesto / Parte' : 'No especificado'}`
      );
      lines.push(`  Modelo: ${data.model ?? '—'}${formatComparisonTag(res.comparisons?.model)}`);
      lines.push(`  Talla: ${data.size ?? '—'}${formatComparisonTag(res.comparisons?.size)}`);
      lines.push(`  Color: ${data.color ?? '—'}${formatComparisonTag(res.comparisons?.color)}`);
      lines.push(
        `  Stock total: ${data.totalStock} unidades (${data.inStock ? 'En stock' : 'Sin stock'})`
      );
      if (data.stockLocations.length > 0) {
        const locs = data.stockLocations.map((l) => `${l.location} (${l.quantity})`).join(', ');
        lines.push(`  Ubicaciones: ${locs}`);
      } else {
        lines.push('  Ubicaciones: Ninguna');
      }
    }
  });

  return lines.join('\n');
}
