/**
 * What a serial read off a carton label can prove about that carton.
 *
 * The batch intake counts boxes by serial: two photos of the same SKU are two
 * cartons, or one carton photographed twice, and only the serial can tell
 * which. That makes the OCR's worst reads expensive, and `sku_serials` already
 * holds both of them (23 sep 2026):
 *
 *   - `SERIALLOE` — the label's own caption «SERIAL NO.» read as the value;
 *   - `M25HO00435` beside `M25H000432` — the letter O and the digit 0 are the
 *     same glyph on these labels.
 *
 * So there are two questions, kept apart on purpose. {@link serialLooksReal}
 * says whether a reading may count as evidence at all. {@link serialKey} folds
 * the confusable glyphs so two readings of one carton compare equal — **only
 * for comparing**, inside one SKU of one batch. What gets stored is always the
 * reading as it was ({@link normalizeSerial}), never the folded key.
 */

/** Normalised the same way on write and on read, so a rescan matches. */
export function normalizeSerial(serial: string): string {
  return serial.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Whether a reading is credible enough to tell two cartons apart. Rejects the
 * caption itself (anything containing `SERIAL`), anything under 6 characters,
 * and anything with fewer than 3 digits — every real serial in the table has
 * far more.
 */
export function serialLooksReal(serial: string | null | undefined): boolean {
  if (!serial) return false;
  const s = normalizeSerial(serial);
  if (s.length < 6) return false;
  if (s.includes('SERIAL')) return false;
  return (s.match(/\d/g) ?? []).length >= 3;
}

/**
 * The comparison key: `O`→`0` and `I`→`1`, the two confusions these labels
 * produce. `null` when the reading is not credible — an uncredible reading
 * never makes two photos "the same box".
 */
export function serialKey(serial: string | null | undefined): string | null {
  if (!serialLooksReal(serial)) return null;
  return normalizeSerial(serial as string)
    .replace(/O/g, '0')
    .replace(/I/g, '1');
}
