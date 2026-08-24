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
  fedexCartonGap,
  toAscii,
  FEDEX_CARTON_GAP_LABELS,
  type FedexCartonGap,
} from '../../../utils/fedexCarton';

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

/**
 * Key separator. A model or a size can contain a space, so "ALLEGRO A3" + "" and
 * "ALLEGRO" + "A3" would land on the same bucket with any printable delimiter.
 * NUL cannot occur in either, which makes the key unambiguous — written as an
 * escape so the file stays plain text.
 */
const KEY_SEP = '\u0000';

const MAX_DESCRIPTION = 140;
const MAX_ID = 30;

/**
 * How a stored size is written in a description.
 *
 * Sizes live in the column bare and uppercase — `17`, `L16`, `27.5X14`, `51` —
 * because one column holds both a 17" frame and a 51 cm road size. The unit is
 * decided here: at or under 29 is inches and takes the `''` mark, 44 and above
 * is centimetres and stays bare. `''` rather than `"` because the format
 * forbids a double quote anywhere in the data.
 */
export function renderSize(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = String(raw)
    .toUpperCase()
    .replace(/["‘’“”']/g, '')
    .replace(/\s+/g, '')
    .replace(/\*/g, 'X')
    .replace(/CM$/, '');
  if (!t) return null;

  // Wheel × frame, e.g. 27.5X14 — the frame half carries no mark of its own.
  const compound = t.match(/^(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)$/);
  if (compound) return `${compound[1]}''X${compound[2]}`;

  if (/^700CX\d+(?:\.\d+)?$/.test(t)) return `${t}''`;
  if (/^700C$/.test(t)) return t;

  const plain = t.match(/^(L?)(\d+(?:\.\d+)?)$/);
  if (plain) {
    const n = Number.parseFloat(plain[2]);
    return n <= 29 ? `${plain[1]}${plain[2]}''` : `${plain[1]}${plain[2]}`;
  }
  return t;
}

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
 * Two passes. First one carton per model+size: colours of the same size are
 * measured separately and round differently (8.25 and 8.00 become 9 and 8), so
 * each axis takes the largest value — a carton declared too small is what gets
 * back-billed. Then sizes of one model that landed on the same carton collapse
 * into a single record, which is the merge the whole export exists for.
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
    length: number;
    width: number;
    height: number;
    minL: number;
    minW: number;
    minH: number;
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
    const length = Math.ceil(row.length_in as number);
    const width = Math.ceil(row.height_in as number);
    const height = Math.ceil(row.width_in as number);

    const size = renderSize(row.size);
    const key = `${model}${KEY_SEP}${size ?? ''}`;
    const bucket = bySize.get(key);
    if (!bucket) {
      bySize.set(key, { model, size, length, width, height, minL: length, minW: width, minH: height, skus: [row.sku] });
    } else {
      bucket.length = Math.max(bucket.length, length);
      bucket.width = Math.max(bucket.width, width);
      bucket.height = Math.max(bucket.height, height);
      bucket.minL = Math.min(bucket.minL, length);
      bucket.minW = Math.min(bucket.minW, width);
      bucket.minH = Math.min(bucket.minH, height);
      bucket.skus.push(row.sku);
    }
  }

  for (const [key, b] of bySize.entries()) {
    if (b.length - b.minL > 1 || b.width - b.minW > 1 || b.height - b.minH > 1) {
      for (const sku of b.skus) {
        const row = rowBySku.get(sku);
        if (row) except(row, 'dimension_conflict');
      }
      bySize.delete(key);
    }
  }

  type BoxBucket = {
    model: string;
    length: number;
    width: number;
    height: number;
    sizes: string[];
    skus: string[];
  };
  const byBox = new Map<string, BoxBucket>();

  for (const b of bySize.values()) {
    const key = `${b.model}${KEY_SEP}${b.length}x${b.width}x${b.height}`;
    const bucket = byBox.get(key);
    if (!bucket) {
      byBox.set(key, {
        model: b.model,
        length: b.length,
        width: b.width,
        height: b.height,
        sizes: b.size ? [b.size] : [],
        skus: [...b.skus],
      });
    } else {
      if (b.size) bucket.sizes.push(b.size);
      bucket.skus.push(...b.skus);
    }
  }

  const initialRecords: FedexDimensionRecord[] = [...byBox.values()].map((b) => {
    const sizes = [...b.sizes].sort((x, y) => sizeOrder(x) - sizeOrder(y) || x.localeCompare(y));
    // A span is only honest when the sizes read as one run. "L14''-L16''" over
    // L14, 15, L16 hides the plain 15 sitting between two low-step frames, so a
    // mixed group is listed in full instead. Same reason a 700C wheel size never
    // spans with a frame size.
    const forms = new Set(sizes.map((s) => s.replace(/[0-9.]/g, '')));
    const label =
      sizes.length > 1
        ? forms.size === 1
          ? `${sizes[0]}-${sizes[sizes.length - 1]}`
          : sizes.join('/')
        : (sizes[0] ?? '');
    const description = toAscii([b.model, label].filter(Boolean).join(' ')).slice(0, MAX_DESCRIPTION);

    const natural = `${b.model}${sizes.join('')}`.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const id =
      natural.length <= MAX_ID
        ? natural
        : `${natural.slice(0, MAX_ID - 4)}${shortHash(natural)}`;

    return {
      description,
      id,
      height: b.height,
      length: b.length,
      width: b.width,
      skus: [...b.skus].sort(),
    };
  });

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
