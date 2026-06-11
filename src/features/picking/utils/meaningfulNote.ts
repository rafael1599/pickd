// Filter order-import notes ("picking_lists.notes") down to the ones worth
// showing. The notes column is a mixed bag: useful shipping instructions live
// next to boilerplate freight noise ("FREE FREIGHT", "FREIGHT $65.00") and
// system/cancel chatter. Now that the header auto-hides, we don't want to flash
// noise — but we must NEVER drop a note that carries a real instruction.
//
// Rule: if the note contains ANY "keep" signal (ship/not/wait/hold/…), keep it
// verbatim — even if it also mentions freight. Otherwise, if it's a known noise
// phrase, drop it. Anything else unknown is KEPT (better a little noise than
// losing information).

// Real instructions / problems. Short, ambiguous words use boundaries so they
// don't match inside another word (e.g. "not" inside "notation").
const KEEP_PATTERNS: RegExp[] = [
  /\bship/i, // ship, shipping, shipment
  /\bnot\b/i, // "do not …", "not until …"
  /\bwait/i,
  /\bhold/i,
  /\bdo\s*not\b/i,
  /\bback\s*order/i,
  /\burgent\b/i,
  /\basap\b/i,
  /\battn\b/i,
  /\brush\b/i,
  /\bcall\b/i,
  /\bcancel/i,
  /\bdamage/i,
  /\bshort/i,
  /\bmissing/i,
  /\bbefore\b/i,
  /\bafter\b/i,
  /\bpick\s*up/i,
  /\bwill\s*call/i,
  /\bdate\b/i,
];

// Pure freight/billing boilerplate that, on its own, is just noise.
const NOISE_PATTERNS: RegExp[] = [
  /free\s*freight/i,
  /freight\s*\$?\s*[\d.,]+/i, // "FREIGHT $65.00"
  /^\s*freight\s*$/i,
  /\bprepaid\b/i,
  /\bf\.?o\.?b\.?\b/i,
];

/** Return the note if it's worth showing, else null (filtered as noise). */
export function meaningfulNote(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  if (KEEP_PATTERNS.some((re) => re.test(text))) return text; // real instruction → keep
  if (NOISE_PATTERNS.some((re) => re.test(text))) return null; // pure freight noise → drop
  return text; // unknown → keep (never lose information)
}
