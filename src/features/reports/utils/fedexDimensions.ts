/**
 * Builds the Dimensions table FedEx Ship Manager imports.
 *
 * FSM v3313 imports this at Databases → File Maintenance → Import with template
 * DIMENTIONS1 in "Replace current data" mode. Replace wipes the table first, so
 * every export carries the whole catalog — a delta would delete everything it
 * left out.
 *
 * Two conventions worth stating once, because both are invisible in the output:
 *
 * 1. The axes are not the same on both sides. Pickd stores length/width/height
 *    as longest/thinnest/middle — the floor sheets are written L × H × W, which
 *    is why 20260814120000 lands the third reading in `width_in`. FSM wants
 *    Length, Width, Height as longest, middle, thinnest. So Width comes from
 *    `height_in` and Height from `width_in`. Getting this backwards produces a
 *    file that imports cleanly and misrates every shipment.
 *
 * 2. Only measured cartons ship. `dimensions_verified` is the gate; a row still
 *    holding the defaults trigger's numbers would overwrite a real measurement
 *    in FSM with one nobody took.
 */

import {
  cartonGroupKey,
  fedexCartonGap,
  renderSize,
  toAscii,
  FEDEX_CARTON_GAP_LABELS,
  type FedexCartonGap,
} from '../../../utils/fedexCarton';

// Re-exported because it moved to utils/fedexCarton on 2026-09-09, where the
// measuring queue and the Double Check warning can read it too: whether a
// carton is already in the file is the same question as which record it lands
// in, and the two must not answer it with different keys.
export { renderSize };

/** A SKU as the export reads it. Mirrors the selected columns, nothing more. */
export interface DimensionSourceRow {
  sku: string;
  model: string | null;
  size: string | null;
  length_in: number | null;
  width_in: number | null;
  height_in: number | null;
  dimensions_verified: boolean;
}

/** One row of the FSM Dimensions table. */
export interface FedexDimensionRecord {
  description: string;
  id: string;
  /** Thinnest side, from `width_in`. */
  height: number;
  /** Longest side, from `length_in`. */
  length: number;
  /** Middle side, from `height_in`. */
  width: number;
  /** Every SKU this record covers, sorted. Not exported — shown on screen. */
  skus: string[];
}

/**
 * Why a row was held back. The list lives in utils/fedexCarton because
 * DoubleCheckView warns on the same set before a FedEx order ships, and two
 * copies of this rule would mean the export quietly drops a SKU nobody on the
 * floor was ever told about.
 */
export type ExceptionReason = FedexCartonGap | 'dimension_conflict';

export interface FedexDimensionException {
  sku: string;
  model: string | null;
  size: string | null;
  length_in: number | null;
  width_in: number | null;
  height_in: number | null;
  reason: ExceptionReason;
  location?: string | null;
}

export interface FedexDimensionsResult {
  records: FedexDimensionRecord[];
  exceptions: FedexDimensionException[];
}

const MAX_DESCRIPTION = 140;
const MAX_ID = 30;

/** Sort key for sizes so `15''-23''` never comes out as `15''-9''`. */
function sizeOrder(size: string): number {
  const n = Number.parseFloat(size.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * FNV-1a, base36. Used only to disambiguate an ID that would otherwise collide
 * or overflow 30 characters. A hash of the record's own key keeps the result
 * stable no matter what else is in the export — a running counter would not.
 */
function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).toUpperCase().padStart(4, '0').slice(0, 4);
}

/**
 * Groups measured SKUs into FSM records and returns everything it could not
 * place, with the reason.
 *
 * Three passes:
 *
 * 1. One carton per model+size: colours of the same size are the same box, so
 *    when they disagree each axis takes their **average** — the gap is slack in
 *    how each one was measured, not two different cartons, and the largest
 *    reading declared a box no colour actually has (Rafael, 16 sep 2026:
 *    «cuando se trate de diferencias muy pequeñas hay que ir con el promedio»,
 *    y no va a volver a medir lo que ya está confirmado). A group that disagrees
 *    by more than an inch on any axis is still held back as a conflict, and the
 *    average is still ceil'd, so nothing is ever declared under its own reading
 *    — which is what FedEx re-bills.
 *
 * 2. All model+size buckets that land on the SAME exact dimensions collapse
 *    into one record — even across models (Rafael, 16 sep 2026: two boxes
 *    declared identical do not need two rows). This is what drops the table
 *    from ~187 to ~82 rows.
 *
 * 3. The id MUST carry model names so Rafael can find the row in FSM by
 *    typing the model. When the models in a merged row do not fit in 30
 *    characters the row splits: each chunk gets the models that fit, with
 *    the same dimensions. Models are sorted by SKU count so the dominant
 *    model leads.
 */
export function buildFedexDimensions(rows: DimensionSourceRow[]): FedexDimensionsResult {
  const exceptions: FedexDimensionException[] = [];
  const except = (row: DimensionSourceRow, reason: ExceptionReason) =>
    exceptions.push({
      sku: row.sku,
      model: row.model,
      size: row.size,
      length_in: row.length_in,
      width_in: row.width_in,
      height_in: row.height_in,
      reason,
    });

  type SizeBucket = {
    model: string;
    size: string | null;
    /** Whole inches, the largest reading — only to measure the spread. */
    length: number;
    width: number;
    height: number;
    minL: number;
    minW: number;
    minH: number;
    /** Raw readings, so the average is of what the tape said, not of its ceiling. */
    sumL: number;
    sumW: number;
    sumH: number;
    n: number;
    skus: string[];
  };
  const bySize = new Map<string, SizeBucket>();
  const rowBySku = new Map<string, DimensionSourceRow>();

  for (const row of rows) {
    rowBySku.set(row.sku, row);
    // The gate itself is shared with DoubleCheckView's pre-ship warning; see
    // utils/fedexCarton for the reasons and the axis swap they both apply.
    const gap = fedexCartonGap(row);
    if (gap) {
      except(row, gap);
      continue;
    }
    const model = toAscii(row.model ?? '').toUpperCase();
    // Non-null past the gate, which already rejected missing and out-of-range.
    const rawL = row.length_in as number;
    const rawW = row.height_in as number;
    const rawH = row.width_in as number;
    const length = Math.ceil(rawL);
    const width = Math.ceil(rawW);
    const height = Math.ceil(rawH);

    const size = renderSize(row.size);
    const key = cartonGroupKey(row) as string; // non-null: the gap check passed
    const bucket = bySize.get(key);
    if (!bucket) {
      bySize.set(key, {
        model,
        size,
        length,
        width,
        height,
        minL: length,
        minW: width,
        minH: height,
        sumL: rawL,
        sumW: rawW,
        sumH: rawH,
        n: 1,
        skus: [row.sku],
      });
    } else {
      bucket.length = Math.max(bucket.length, length);
      bucket.width = Math.max(bucket.width, width);
      bucket.height = Math.max(bucket.height, height);
      bucket.minL = Math.min(bucket.minL, length);
      bucket.minW = Math.min(bucket.minW, width);
      bucket.minH = Math.min(bucket.minH, height);
      bucket.sumL += rawL;
      bucket.sumW += rawW;
      bucket.sumH += rawH;
      bucket.n += 1;
      bucket.skus.push(row.sku);
    }
  }

  for (const [key, b] of bySize.entries()) {
    // More than an inch apart is not slack in the tape: it is two cartons, and
    // averaging them would invent a third. Those are held back, as before.
    if (b.length - b.minL > 1 || b.width - b.minW > 1 || b.height - b.minH > 1) {
      for (const sku of b.skus) {
        const row = rowBySku.get(sku);
        if (row) except(row, 'dimension_conflict');
      }
      bySize.delete(key);
      continue;
    }
    // Within an inch the colours are the same box read twice: the average is
    // the better estimate of it. Still ceil'd, so the declared carton is never
    // under what the average says.
    b.length = Math.ceil(b.sumL / b.n);
    b.width = Math.ceil(b.sumW / b.n);
    b.height = Math.ceil(b.sumH / b.n);
  }

  // -- Step 2: merge by box dimensions, now across models (Rafael, 16 sep 2026) ---
  //
  // Two records that declare EXACTLY the same box do not need two rows in FSM.
  // Before this grouped by model+dimensions; now the key is dimensions alone.
  // This drops the table from ~187 rows to ~82, and no measurement changes.

  /** One model's contribution to a box bucket: its name, sizes, and SKU count. */
  type ModelEntry = {
    model: string;
    sizes: string[];
    skuCount: number;
    skus: string[];
  };

  type BoxBucket = {
    length: number;
    width: number;
    height: number;
    /** Every model that lands on this exact box, keyed by model name. */
    models: Map<string, ModelEntry>;
    skus: string[];
  };
  const byBox = new Map<string, BoxBucket>();

  for (const b of bySize.values()) {
    // Key is dimensions only — identical boxes merge regardless of model.
    const key = `${b.length}x${b.width}x${b.height}`;
    const bucket = byBox.get(key);
    if (!bucket) {
      const models = new Map<string, ModelEntry>();
      models.set(b.model, { model: b.model, sizes: b.size ? [b.size] : [], skuCount: b.skus.length, skus: [...b.skus] });
      byBox.set(key, {
        length: b.length,
        width: b.width,
        height: b.height,
        models,
        skus: [...b.skus],
      });
    } else {
      bucket.skus.push(...b.skus);
      const existing = bucket.models.get(b.model);
      if (existing) {
        if (b.size) existing.sizes.push(b.size);
        existing.skuCount += b.skus.length;
        existing.skus.push(...b.skus);
      } else {
        bucket.models.set(b.model, { model: b.model, sizes: b.size ? [b.size] : [], skuCount: b.skus.length, skus: [...b.skus] });
      }
    }
  }

  // -- Step 3: build records with multi-model descriptions and ids -----------
  //
  // The id MUST carry model names — never bare dimensions like BIKE56X31X9 —
  // because Rafael searches FSM by typing the model name. Models are sorted by
  // SKU count (most SKUs first) so the dominant model leads the id.
  //
  // When the concatenated models overflow MAX_ID (30 chars), the row splits:
  // each chunk carries the models that fit and the SAME dimensions. Better two
  // findable rows than one that is too long for the field or has no model name.

  /** Build a per-model label: "MODEL 15''-19''" or "MODEL" if sizeless. */
  function modelLabel(entry: ModelEntry): string {
    const sizes = [...entry.sizes].sort((x, y) => sizeOrder(x) - sizeOrder(y) || x.localeCompare(y));
    const forms = new Set(sizes.map((s) => s.replace(/[0-9.]/g, '')));
    const span =
      sizes.length > 1
        ? forms.size === 1
          ? `${sizes[0]}-${sizes[sizes.length - 1]}`
          : sizes.join('/')
        : (sizes[0] ?? '');
    return toAscii([entry.model, span].filter(Boolean).join(' '));
  }

  /** Model name stripped to uppercase alphanumeric, the way ids are built. */
  function modelIdPart(entry: ModelEntry): string {
    const sizes = [...entry.sizes].sort((x, y) => sizeOrder(x) - sizeOrder(y) || x.localeCompare(y));
    return `${entry.model}${sizes.join('')}`.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  const initialRecords: FedexDimensionRecord[] = [];

  for (const b of byBox.values()) {
    // Sort models by SKU count descending, then alphabetically for determinism.
    // The dominant model leads the id, so Rafael finds it first.
    const entries = [...b.models.values()].sort(
      (a, c) => c.skuCount - a.skuCount || a.model.localeCompare(c.model)
    );

    // Split models into chunks that fit MAX_ID. Each chunk becomes a row with
    // the same dimensions — better two findable rows than one invisible one.
    const chunks: ModelEntry[][] = [];
    let current: ModelEntry[] = [];
    let currentLen = 0;

    for (const entry of entries) {
      const part = modelIdPart(entry);
      if (current.length === 0) {
        // First model always starts a new chunk, even if it alone overflows.
        current.push(entry);
        currentLen = part.length;
      } else if (currentLen + part.length <= MAX_ID) {
        current.push(entry);
        currentLen += part.length;
      } else {
        chunks.push(current);
        current = [entry];
        currentLen = part.length;
      }
    }
    if (current.length > 0) chunks.push(current);

    for (const chunk of chunks) {
      const description = chunk.map(modelLabel).join(' / ').slice(0, MAX_DESCRIPTION);

      const natural = chunk.map(modelIdPart).join('');
      const id =
        natural.length <= MAX_ID
          ? natural
          : `${natural.slice(0, MAX_ID - 4)}${shortHash(natural)}`;

      initialRecords.push({
        description,
        id,
        height: b.height,
        length: b.length,
        width: b.width,
        skus: chunk.flatMap((e) => e.skus).sort(),
      });
    }
  }

  // Collision resolution by ID: two truncated ids that hash the same way still
  // need distinct values. The resolution uses the natural key (description) so
  // the result is stable across exports — a running counter would shuffle ids
  // every time an unrelated model appeared.
  const byId = new Map<string, FedexDimensionRecord[]>();
  for (const r of initialRecords) {
    const group = byId.get(r.id) ?? [];
    group.push(r);
    byId.set(r.id, group);
  }

  const records: FedexDimensionRecord[] = [];

  for (const group of byId.values()) {
    if (group.length === 1) {
      records.push(group[0]);
    } else {
      // Collisions from splitting share the same dimensions by construction,
      // so they never conflict. Collisions from truncation may differ: check.
      const minL = Math.min(...group.map((r) => r.length));
      const maxL = Math.max(...group.map((r) => r.length));
      const minW = Math.min(...group.map((r) => r.width));
      const maxW = Math.max(...group.map((r) => r.width));
      const minH = Math.min(...group.map((r) => r.height));
      const maxH = Math.max(...group.map((r) => r.height));

      if (maxL - minL <= 1 && maxW - minW <= 1 && maxH - minH <= 1) {
        const merged = { ...group[0] };
        merged.length = maxL;
        merged.width = maxW;
        merged.height = maxH;
        merged.skus = [...new Set(group.flatMap((r) => r.skus))].sort();
        records.push(merged);
      } else {
        for (const r of group) {
          for (const sku of r.skus) {
            const row = rowBySku.get(sku);
            if (row) except(row, 'dimension_conflict');
          }
        }
      }
    }
  }

  // Deterministic order, so unchanged data produces a byte-identical file.
  records.sort((a, b) => a.description.localeCompare(b.description) || a.id.localeCompare(b.id));

  // Truncation can still collide. Resolve against the natural key rather than a
  // position, so an ID does not move when an unrelated record appears.
  const seen = new Map<string, number>();
  for (const r of records) {
    const n = seen.get(r.id) ?? 0;
    seen.set(r.id, n + 1);
    if (n > 0) r.id = `${r.id.slice(0, MAX_ID - 4)}${shortHash(`${r.id}#${r.description}`)}`;
  }

  exceptions.sort((a, b) => a.sku.localeCompare(b.sku));
  return { records, exceptions };
}

/**
 * The file FSM reads: five quoted fields, no header, CRLF, ASCII.
 * Field order is Description, ID, Height, Length, Width — not L/W/H.
 */
export function toFsmCsv(records: FedexDimensionRecord[]): string {
  const line = (r: FedexDimensionRecord) =>
    [r.description, r.id, String(r.height), String(r.length), String(r.width)]
      .map((f) => `"${f}"`)
      .join(',');
  // Trailing CRLF: FSM counts rows by terminator, and a final bare row is
  // reported as an error in the import summary.
  return records.map(line).join('\r\n') + (records.length ? '\r\n' : '');
}

/** Why a SKU was held back, in the words the exceptions report uses. */
export const EXCEPTION_LABELS: Record<ExceptionReason, string> = {
  ...FEDEX_CARTON_GAP_LABELS,
  dimension_conflict: 'Duplicate ID with different dimensions',
};

/**
 * The companion file. Unlike the FSM export this one is for a person, so it
 * carries a header row and the stored dimensions as they actually are — the
 * point is to show what needs measuring.
 */
export function toExceptionsCsv(exceptions: FedexDimensionException[]): string {
  const cell = (v: string | number | null) =>
    `"${String(v ?? '').replace(/"/g, "'")}"`;
  const header = ['SKU', 'Model', 'Size', 'Length (in)', 'Width (in)', 'Height (in)', 'Reason']
    .map(cell)
    .join(',');
  const lines = exceptions.map((e) =>
    [e.sku, e.model, e.size, e.length_in, e.width_in, e.height_in, EXCEPTION_LABELS[e.reason]]
      .map(cell)
      .join(',')
  );
  return [header, ...lines].join('\r\n') + '\r\n';
}

/** `DIMENSIONS_FEDEX_YYYYMMDD.csv`, dated in the operator's local day. */
export function fedexDimensionsFilename(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `DIMENSIONS_FEDEX_${y}${m}${d}.csv`;
}
