/**
 * Strips out system messages, cancel/restore log chatter, and verification timeout
 * tags from item names/notes so that only bike names, models, and relevant product
 * information are displayed and stored.
 */
export function sanitizeItemName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let text = raw.trim();
  if (!text) return null;

  // Patterns for system chatter to remove (case-insensitive)
  const systemPatterns = [
    /\|\s*AUTO-CANCEL[^|]*/gi,
    /\|\s*AUTO-RESTORE[^|]*/gi,
    /\|\s*VERIFICATION TIMEOUT[^|]*/gi,
    /AUTO-CANCEL\s+VERIFICATION\s+TIMEOUT/gi,
    /AUTO-RESTORE\s+ON\s+CANCEL/gi,
    /AUTO-CANCEL[^|]*/gi,
    /AUTO-RESTORE[^|]*/gi,
    /VERIFICATION TIMEOUT[^|]*/gi,
  ];

  for (const pattern of systemPatterns) {
    text = text.replace(pattern, '');
  }

  // Clean up any double pipes, leading/trailing pipes, or excess whitespace
  text = text
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(' | ');

  return text.trim() || null;
}
