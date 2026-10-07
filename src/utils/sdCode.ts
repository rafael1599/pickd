/**
 * The code an S/D number prints as on its box (Rafael, 7 Oct 2026): numbers
 * never come back, so past 99 they go on with a letter to stay short.
 *
 *   1 … 99 · 1A … 9Z · 100 … 999 · 10A … 99Z · 1000 … 9999 · 100A … 999Z · …
 *
 * Capital letters only, without I, L and O (they read as 1 and 0 on a box).
 * The database keeps the plain integer (`sku_metadata.sd_number`, sequence
 * `sd_number_seq`): it sorts and stays unique; this is only how it is shown.
 *
 * Copied in SQL as `public.sd_code(int)` (20261007150000) and in the sd-sheet
 * edge function; if it changes here, change it there.
 */
export const SD_CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';

export function sdCode(n: number): string {
  if (!Number.isInteger(n) || n < 1) return String(n);
  if (n <= 99) return String(n);
  const L = SD_CODE_LETTERS.length;
  let rest = n - 100;
  for (let p = 1; ; p += 1) {
    const low = 10 ** (p - 1);
    const lettered = 9 * low * L;
    if (rest < lettered) return `${low + Math.floor(rest / L)}${SD_CODE_LETTERS[rest % L]}`;
    rest -= lettered;
    const digits = 9 * 10 ** (p + 1);
    if (rest < digits) return String(10 ** (p + 1) + rest);
    rest -= digits;
  }
}
