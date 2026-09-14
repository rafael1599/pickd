/**
 * What unit does a frame size carry, and how is it written.
 *
 * One column holds both a 17" mountain frame and a 51 cm road frame, so the
 * number is stored bare and the unit is decided from its magnitude. That rule
 * already existed inside `renderSize` (fedexCarton.ts) for the FedEx export;
 * it lives here now because the screens and the printed label need the same
 * answer, written for a person instead of for a file.
 *
 * `parseBikeName.ts` says it out loud: "two functions in one repo disagreeing
 * about what a size looks like is the whole bug". So there is one parser, and
 * the two renderers are two views of its result — the FedEx one byte-for-byte
 * what it always produced (that string is a grouping key; changing it would
 * silently re-bucket every carton), the human one with a real `"`.
 */

/** At or under this, the number is inches. */
const MAX_INCHES = 29;
/** At or over this, the number is centimetres. Nothing real lands between. */
const MIN_CM = 44;

export type ParsedSize =
  /** A frame size, optionally low-step: `17`, `L16`, `15.5`. */
  | { kind: 'plain'; lowStep: string; n: string }
  /** Two measurements written together: `15X27`, `27.5X14`. Both are inches. */
  | { kind: 'pair'; a: string; b: string }
  /** A 700C wheel with its frame: `700CX58`. The frame half carries the unit. */
  | { kind: 'wheel700'; frame: string }
  /** `700C` on its own — a wheel standard, not a measurement. */
  | { kind: 'wheel700bare' }
  /** Anything else: `L`, `S`, `ADULT`. Passed through untouched. */
  | { kind: 'free'; text: string };

/**
 * Strip the decoration a size may have been typed with, so `15`, `15"` and
 * `15 CM` all reach the parser as the same thing. Idempotence starts here.
 */
function normalize(raw: string): string {
  return String(raw)
    .toUpperCase()
    .replace(/["‘’“”']/g, '')
    .replace(/\s+/g, '')
    .replace(/\*/g, 'X')
    .replace(/CM$/, '');
}

export function parseSize(raw: string | null | undefined): ParsedSize | null {
  if (!raw) return null;
  const t = normalize(raw);
  if (!t) return null;

  const pair = t.match(/^(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)$/);
  if (pair) return { kind: 'pair', a: pair[1], b: pair[2] };

  const wheel = t.match(/^700CX(\d+(?:\.\d+)?)$/);
  if (wheel) return { kind: 'wheel700', frame: wheel[1] };

  if (t === '700C') return { kind: 'wheel700bare' };

  const plain = t.match(/^(L?)(\d+(?:\.\d+)?)$/);
  if (plain) return { kind: 'plain', lowStep: plain[1], n: plain[2] };

  return { kind: 'free', text: t };
}

/** The unit a bare number carries, or `null` when its magnitude says neither. */
function unitOf(n: string): '"' | 'cm' | null {
  const v = Number.parseFloat(n);
  if (v <= MAX_INCHES) return '"';
  if (v >= MIN_CM) return 'cm';
  return null;
}

/**
 * A size written for a person: `15"`, `54cm`, `L16"`, `15"×27"`.
 *
 * Idempotent — a value that already carries its unit comes back unchanged —
 * and it never invents one: a number in the gap between the two scales, a
 * letter size, or free text is returned as it was typed.
 */
export function formatSize(raw: string | null | undefined): string | null {
  const parsed = parseSize(raw);
  if (!parsed) return null;
  const original = String(raw).trim();

  switch (parsed.kind) {
    case 'plain': {
      const unit = unitOf(parsed.n);
      return unit ? `${parsed.lowStep}${parsed.n}${unit}` : original;
    }
    case 'pair':
      // Frame and wheel are both inches whichever way round they were written,
      // so marking both is safe without knowing which half is which.
      return `${parsed.a}"×${parsed.b}"`;
    case 'wheel700': {
      const unit = unitOf(parsed.frame);
      return `700C×${parsed.frame}${unit ?? ''}`;
    }
    case 'wheel700bare':
      return '700C';
    case 'free':
      // Uppercasing is the export's business, not a screen's.
      return original;
  }
}

/**
 * The same size as the FedEx export has always written it: `''` for inches,
 * centimetres bare, everything uppercase and quote-free because the file
 * format forbids a double quote anywhere in the data.
 *
 * This is a grouping key. Its output must not drift.
 */
export function renderSizeForExport(raw: string | null | undefined): string | null {
  const parsed = parseSize(raw);
  if (!parsed) return null;

  switch (parsed.kind) {
    case 'plain':
      return Number.parseFloat(parsed.n) <= MAX_INCHES
        ? `${parsed.lowStep}${parsed.n}''`
        : `${parsed.lowStep}${parsed.n}`;
    case 'pair':
      return `${parsed.a}''X${parsed.b}`;
    case 'wheel700':
      return `700CX${parsed.frame}''`;
    case 'wheel700bare':
      return '700C';
    case 'free':
      return parsed.text;
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A whole-token matcher for a size, so `15` never matches inside `15X27`. */
function standaloneToken(token: string): RegExp {
  return new RegExp(`(^|\\s)(${escapeRe(token)})(?=\\s|$)`, 'i');
}

/**
 * The same matcher, but it also swallows a unit the name already carries
 * *separately* from the number. Three rows in the live catalogue store the size
 * as `58 cm` and write it that way in the name too; matching the bare `58` and
 * appending the unit would have printed `58cm cm`.
 */
function tokenWithLooseUnit(token: string): RegExp {
  return new RegExp(`(^|\\s)(${escapeRe(token)})(\\s*(?:CM|''|["‘’“”]))?(?=\\s|$)`, 'i');
}

/**
 * Why both display helpers ask what kind of row this is.
 *
 * The magnitude rule is a rule about *frame* sizes, and `size` is not always
 * one. A survey of the 32 parts that carry a size found 10 holding their model
 * year in that column — `JRP GRIP LASER 2.0 2006` has `size = '06'`, and
 * `JRP DER HNGR TRAIL-X SERIES 2008` has `08` across 300 units — plus two
 * holding a number that is not their measurement at all (`JRP HDST PLUG 2009
 * 22MM` says `23`). Dressed up by magnitude those print as `06"`. So nothing is
 * formatted without a positive answer, and an unknown one is treated as a no.
 *
 * **A bare frame is the exception**, and it has its own flag: `category =
 * 'frame'`, the same predicate the FedEx dimensions export uses to include
 * measured frames ("los cuadros son partes pero viajan en un cartón que FedEx
 * tiene registrado"). Those five rows are the only parts whose size is a real
 * frame size — `FRAME RENEGADE S1 UDH 54` is 54 cm — and letting them in drags
 * none of the bad ones with it. Every other part keeps its size exactly as
 * typed: the eleven Taxi pieces already store `24"` and `26"` themselves.
 */
function carriesFrameSize(
  isBike: boolean | null | undefined,
  category: string | null | undefined
): boolean {
  return isBike === true || (category ?? '').trim().toLowerCase() === 'frame';
}

/** A size as a screen should show it: `15"`, `54cm` — bikes and bare frames. */
export function displaySize(
  raw: string | null | undefined,
  isBike: boolean | null | undefined,
  category?: string | null
): string | null {
  if (!carriesFrameSize(isBike, category)) return raw?.trim() || null;
  return formatSize(raw);
}

/**
 * Put the unit on the size that is already written inside a name.
 *
 * Names are stored with the size in the middle of them —
 * `TRAIL XR 15 NICKEL`, `ALLEGRO A2 15 2025 GLOSS BLACK` — so formatting the
 * size *field* alone leaves the line a picker actually reads unchanged. This
 * rewrites that one token and nothing else: the model, the year and the colour
 * come out exactly as they went in.
 *
 * Deliberately narrow, because the alternative is guessing:
 *   - bikes and bare frames only, for the reason in {@link carriesFrameSize};
 *   - it only fires when the catalogue already knows the size, so no number is
 *     promoted to a size on the strength of looking like one;
 *   - it matches the token whole, so `15` does not match inside `15X27`;
 *   - a name that already carries the marked form is left exactly as it is,
 *     which is what makes this idempotent. Two rows in the live catalogue have
 *     their name written twice (`ALLEGRO A1 23 THUNDER GREY 23 THUNDER GREY`);
 *     without that guard a second pass would mark the second copy too.
 */
export function withSizeUnit(
  name: string | null | undefined,
  size: string | null | undefined,
  isBike: boolean | null | undefined,
  category?: string | null
): string {
  const text = (name ?? '').trim();
  if (!text || !size || !carriesFrameSize(isBike, category)) return text;

  const token = normalize(size);
  const formatted = formatSize(size);
  if (!token || !formatted || formatted === token) return text;
  if (standaloneToken(formatted).test(text)) return text;

  return text.replace(tokenWithLooseUnit(token), (_m, before) => `${before}${formatted}`);
}
